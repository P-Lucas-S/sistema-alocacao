# Sistema de Alocação de Equipes — Progresso e Decisões

> **Propósito deste documento.** Registro vivo do estado de execução do projeto. O `PLANO_FINAL.md` descreve *o que* construir; este documento registra *o que já foi construído*, *as decisões tomadas durante a implementação* e *como continuar*. Serve de contexto para qualquer pessoa — ou qualquer sessão futura do Claude Code — que pegar o projeto daqui em diante.
>
> **Última atualização:** **Tarifa por colaborador × categoria completa, e a spec de papéis (chefe/diretor) + posse/exclusão fechada.** Duas frentes desde os programas de fomento: (1) a **tarifa por colaborador × categoria** — evolução do pedido #3 (valor-hora), **já completa** (resolvedor + relatório + grid + tela de edição + blindagem contra apagar override), ver §4-bis; (2) uma **segunda leva de pedidos da cliente** (via o `Manual`), cujo item estrutural — **papéis novos (chefe, diretor), delegação de projeto e exclusão permanente** — passou por **brainstorm de 4 IAs** e virou a **`Spec_Papeis_Posse_Exclusao.md`** (decisões travadas), ver §4-ter. **Fases 0 a 4 + a tarifa completas.** Próximos passos: o **bug de macro/micro** (defeito atual), depois implementar a **spec de papéis** (6 passos), e então **priorização → dashboards (3) → Fase 5** — ver §7. A tela de histórico do log (E2-b) segue como extra deferido.

---

## 1. O que é o sistema

Sistema de **planejamento de alocação de equipes** para uma organização com cerca de 20 gestores, 200+ colaboradores e 200+ projetos. Adaptado de um sistema legado de registro de ponto (que foi quase inteiramente removido).

O objetivo central é **comunicação entre gestores e documentação da equipe**: cada gestor planeja quantas horas cada colaborador dedicará a cada projeto por mês, e o sistema garante que ninguém ultrapasse o teto mensal de horas — mesmo quando vários gestores disputam os mesmos colaboradores.

### Stack
- **Backend:** Node + Express + Prisma + MariaDB (provider `mysql`).
- **Frontend:** React + Vite + Tailwind.
- **Execução local:** `npm run dev` na raiz (usa `concurrently`). Backend em `:3001`, frontend em `:5173`. MariaDB local, banco `registro_horas`, `root`/`123`.

### Perfis de usuário
- **`gestor`** — cadastra colaboradores e projetos, aloca horas, (futuro) cede horas no remanejamento.
- **`coordenacao`** — somente leitura em tudo (relatórios, visão global). Não aloca, não arbitra, não cede.
- **`admin`** — administração técnica. Também é quem **fecha e reabre meses** (Fase 3).
- **Colaborador NÃO é usuário** — é uma entidade de dados. Não tem login, não bate ponto. Tudo é cadastrado pelos gestores.

> **Em expansão:** a `Spec_Papeis_Posse_Exclusao.md` (§4-ter) adiciona **`chefe`** (cria/delega projetos, aprova exclusão, **também** fecha/reabre mês) e **`diretor`** (leitura executiva, só dashboards), mantendo os três acima. **Ainda não implementado** — esta lista reflete o estado atual.

### Branches
- **`feat/alocacao-fase-1`** — Fases 0, 1 e o C1 da Fase 2 (até o commit `65aea36`).
- **`feat/alocacao-fase-2`** — Fase 2 (C2/C3), **toda a Fase 3** (fechamento + auditoria) **e toda a Fase 4** (remanejamento — backend + frontend). Todo o trabalho recente vive aqui.
- **Backup externo no GitHub privado** (`origin` → `P-Lucas-S/sistema-alocacao`) — as 4 branches estão lá. **Workflow em vigor:** `git push` após **cada** commit mantém o backup em dia (upstream já setado; `git push` sozinho resolve).

---

## 2. Decisões de produto travadas (não reabrir sem motivo forte)

Estas decisões foram debatidas (inclusive com revisão de IAs externas) e estão fechadas:

- **Teto de 220h fixo para todos**, por colaborador por mês, somando todas as alocações em todos os projetos de todos os gestores. É uma constante global no código (`TETO_HORAS_MES = 220`), não um campo por pessoa. Exceções (férias/licença) ficam para uma fase futura.
- **Ao atingir o teto, o sistema BLOQUEIA** (não pede aprovação a ninguém). Mostra ao gestor a distribuição atual: em quais projetos o colaborador já tem horas, quanto em cada, e de qual gestor é cada projeto. O destravamento, quando vier, será por **remanejamento entre gestores** (Fase 4), não por aprovação vertical.
- **Hierarquia:** Projeto → Macro-entrega → Micro-entrega. A alocação aponta para `colaborador + projeto + macro + micro + ano/mês`.
- **Micro "Geral" automática:** toda macro nasce com uma micro chamada "Geral". É o destino padrão de alocação quando o gestor não quer detalhar entregas. (Ver seção 5 sobre alocar "no nível da macro".)
- **Horas em `Decimal(6,2)`** — nunca `Float`.
- **Cadastro de colaborador:** qualquer gestor cadastra livremente. **E-mail é a chave única** (trava dura contra duplicata). **Nome** dispara uma busca de similaridade que apenas AVISA e pede confirmação — nunca bloqueia (dois "João Silva" legítimos podem coexistir).
- **Projeto:** tem um único gestor dono (relação 1:N), um código único e imutável, um nome, e **várias datas de prestação de contas** (1:N). Para priorização, conta a **próxima prestação ainda não vencida**.
- **Projetos são arquivados, nunca deletados.** O código fica preso para sempre, mesmo arquivado (nunca reutilizável). **Projeto arquivado (status ≠ 'ativo') não aparece no grid e não é tocado pela cópia de realizado** — o escopo editável é sempre o dos projetos ativos.
- **Planejado E realizado:** ambos digitados pelo gestor (colaborador não acessa nada). O teto é sobre o **planejado**; o **realizado fica FORA do teto e do lock** (ver C3). O realizado só pode ser lançado onde já existe uma alocação (não há realizado "solto").
- **Fechamento mensal (Fase 3) — explícito e por mês inteiro.** Um mês é fechado/reaberto **explicitamente pelo admin** — não automático por data de prestação (isso deixaria o grid "meio-travado", confuso). Mês fechado = **somente leitura para TODOS, inclusive admin**: bloqueia os **quatro** caminhos de escrita de alocação (criar/alterar planejado, lançar realizado, deletar, copiar-realizado). Só uma **reabertura explícita** destrava. Coordenação continua só-leitura (não fecha nem reabre).
- **Log de auditoria (Fase 3) — só do planejado, ciclo completo, imutável.** Toda vez que o **planejado** de uma alocação nasce / muda / some, grava-se uma linha de log (`criou` / `alterou` / `removeu`) com **quem** e **quando**, **dentro da mesma transação** da escrita (atômico: nunca muda sem log, nunca log sem mudança). O realizado fica de fora. O log guarda o **contexto denormalizado** (colaborador/projeto/macro/micro/mês) **sem FK** nesses campos, justamente pra **sobreviver à deleção** da alocação; só o `usuarioId` é FK real.
- **Remanejamento (Fase 4) — modelo broadcast, transferência net-zero:** o gestor sinaliza interesse num colaborador lotado e solicita uma parcela de horas com **destino** concreto (projeto+macro+micro+mês); a pendência vai a todos os gestores que têm esse colaborador **naquele mês**; cada um pode **ceder uma parcela** indicando a **alocação de origem** dele. A cessão é uma **transferência net-zero**: X sai da origem (do cedente) e entra no destino (do solicitante), do **mesmo colaborador no mesmo mês** — então o **teto é preservado por construção** (o total do colaborador não muda), sem precisar checá-lo na cessão. Cessão **nunca ultrapassa o pedido** (ajusta pro saldo e avisa); ao completar, a solicitação **fecha atomicamente** (`atendida`). Prioridade por data de prestação é só visual. **Concorrência:** tudo serializado pelo **mesmo lock pessimista do colaborador** que protege o teto (sem lock novo) — ele serializa cessões, alocações e os cancelamentos/encerramentos. As transações da Fase 4 usam **`isolationLevel: ReadCommitted`** (ver a história do `ER_CHECKREAD` no §4). **Ciclo de vida da solicitação:** `aberta` → `atendida` (auto, ao completar) / `cancelada` (só sem cessões) / `encerrada_parcial` (encerrada à mão depois de ceder algo; horas cedidas ficam definitivas). Hora cedida é definitiva, não reverte o passado.

### Riscos aceitos conscientemente
- Coordenação só-leitura pode "travar" o broadcast se os gestores não cederem horas — é uma aposta na transparência, não um bug.
- O realizado, sendo manual, pode nunca ser preenchido — o valor garantido do sistema está no planejamento; o realizado é um complemento.

---

## 3. Estado de execução por fase

| Fase | Conteúdo | Status |
|------|----------|--------|
| **Fase 0** | Fundação: remoção do legado, baseline de migrations, `requireRole`, seed de papéis | ✅ Completa (commit `4bc5683`) |
| **Fase 1** | Cadastros e hierarquia (Colaborador, Projeto, Macro/Micro) | ✅ Completa (`1e56947`, `7826482`, `790a6a8`) |
| **Fase 2 — C1** | Alocação de horas planejadas com teto de 220h + lock transacional | ✅ Completa (`65aea36`) |
| **Fase 2 — C2** | Grid de alocação (interface rica) | ✅ Completa (`7cf45bb`, `62675cf`, `d4429b3`, `07c3096`, `bd5f631`) |
| **Fase 2 — C3** | Horas realizadas + comparação planejado vs. realizado | ✅ Completa (`8ec779f`, `0f8469e`, `a1886f8`) |
| **Fase 3** | Fechamento mensal (read-only) + log de auditoria do planejado | ✅ Completa (`5aa52c4`, `0529b8d`, `af473ac`, `adc477b`) |
| **Fase 4** | Remanejamento broadcast entre gestores | ✅ Completa — backend (`393596f`, `6e87355`, `1b5594a`) + frontend (`02e46fa`, `27ad941`, `bcce21b`, `aae171c`, `18964ed`) |
| **Fase 5** | Relatórios da coordenação + escala (virtualização do grid + navegabilidade — ver §7) | ⬜ Pendente |
| **Pós-demo (1ª leva)** | Preparo do demo, custos, programas de fomento, **tarifa por colaborador × categoria**, regra de priorização — ver §4-bis | 🟡 Custos + programas + **tarifa** ✅; priorização aprovada (falta implementar); dashboard pendente |
| **Pós-demo (2ª leva — Manual)** | Papéis novos (chefe/diretor) + delegação + exclusão permanente (**specado**), bug macro/micro, e itens menores — ver §4-ter | 🟡 Spec fechada (`Spec_Papeis_Posse_Exclusao.md`); implementação a começar |
| Transversal | Identidade visual geral | ✅ Reforma clara aplicada no preparo do demo (`c378876`, `db44f99`) |

> **Fases 0–4 + a tarifa fechadas.** Desde então: a **tarifa por colaborador × categoria** entregue (§4-bis), e uma **2ª leva de pedidos** (via o `Manual`) cujo núcleo estrutural — **papéis chefe/diretor, delegação e exclusão permanente** — está **specado** (`Spec_Papeis_Posse_Exclusao.md`, §4-ter) e pronto pra começar. O que falta: o **bug de macro/micro** (defeito atual), **implementar a spec de papéis**, a **priorização** (regra fechada), os **dashboards (3)**, e a **Fase 5**.

### Credenciais de teste (do seed)
| Papel | E-mail | Senha |
|-------|--------|-------|
| Admin | `admin@sistema.dev` | `admin123` |
| Coordenação | `coord@sistema.dev` | `coord123` |
| Gestor | `gestor1@sistema.dev` (+ gestor2, gestor3) | `gestor123` |

> Estas credenciais são descartáveis (desenvolvimento). Os usuários reais (20 gestores, coordenação) serão criados quando o sistema for implantado.

---

## 4. O que foi construído em detalhe

### Fase 0 — Fundação (commit `4bc5683`)
- Removidas todas as tabelas e código do domínio legado: `Task`, `TaskStep`, `TaskTag`, `TaskHistory`, `TimeEntry`, `Comment`, `Brand`, `Platform`, `Tag` — e o Kanban inteiro do frontend (Dashboard, Settings, modais, contexts).
- Mantida a infraestrutura reaproveitável: autenticação, `User`, notificações, push, password reset.
- Criado `requireRole(...roles)` genérico em `backend/src/middleware/auth.ts` (substituiu o antigo `requireAdmin`).
- Migrations reorganizadas via **baseline** (`20260602000000_fase0_baseline`) para sair do estado dessincronizado deixado por um `db push` anterior. **Lição:** sempre usar `migrate dev` (gera arquivo versionado), nunca `db push`, daqui em diante.
- Seed idempotente em `backend/src/db.ts`: zera e recria 1 admin + 1 coordenação + 3 gestores.

### Fase 1 — Cadastros e hierarquia

**B1 — Colaboradores** (commit `1e56947`)
- `backend/src/routes/colaboradores.ts` + `frontend/src/pages/Colaboradores.tsx`.
- Entidade Colaborador: `nome`, `email` (único), `funcao?`, `ativo`, auditoria.
- **Fluxo de duplicata em dois estágios:** e-mail duplicado → 409 (trava dura, não contornável nem com flag). Nome similar/idêntico → resposta `{ needsConfirmation, similares[] }` SEM criar; o frontend mostra os colaboradores em conflito com `[Cadastrar mesmo assim]` / `[Cancelar]`; só com `confirmarSimilar: true` é que cria. Similaridade via distância de Levenshtein.
- Coordenação lê, não cria.

**B2 — Projetos** (commit `7826482`)
- `backend/src/routes/projetos.ts` + `frontend/src/pages/Projetos.tsx`.
- Projeto: `codigo` (único, imutável, maiúsculo), `nome`, `gestorId` (= usuário logado sempre), `status`.
- **Várias datas de prestação de contas** (entidade `PrestacaoContas`, 1:N, tipo `DATE` puro). Migration preservou os dados existentes (copiou a data antiga antes de dropar a coluna).
- Backend calcula `proximaPrestacao { data, vencida }` (a menor data ainda não vencida; se todas venceram, a mais recente marcada como vencida).
- **Correção de fuso:** `@db.Date` no banco + `{ timeZone: 'UTC' }` na exibição — a data aparece exatamente como digitada, sem voltar um dia.
- Gestor vê só os próprios projetos; admin/coordenação veem todos. Arquiva via mudança de status, nunca deleta.

**B3 — Macro/Micro** (commit `790a6a8` — Fase 1 completa)
- `backend/src/routes/macros.ts` (montado em `/api/projetos/:projetoId/macros`) + `frontend/src/pages/ProjetoDetalhe.tsx` (rota `/projetos/:id`).
- **Ao criar uma Macro, cria junto (mesma transação) uma MicroEntrega "Geral".**
- Hard delete na macro (cascata nas micros via transação). Remover uma micro é bloqueado se ela for a **única** da macro (regra estrutural: uma macro nunca pode ficar sem destino de alocação).
- Gestor dono cria/edita; outros e coordenação só veem.
- **Esta é a única tela onde se cria/edita a estrutura de macros e micros.** O grid e o painel do C2/C3 NÃO criam micros novas — só alocam horas nas que já existem.

### Fase 2 — C1 — Núcleo do teto de 220h (commit `65aea36`)

**Tabela `alocacoes`** (migration `20260602000003_fase2_alocacoes`)
- Campos: `colaboradorId`, `projetoId`, `macroEntregaId`, `microEntregaId`, `ano`, `mes`, `horasPlanejadas` (`Decimal(6,2)`), `horasRealizadas` (`Decimal(6,2)` nullable), `createdById`/`updatedById` (auditoria), timestamps.
- **Índice único** em `(colaboradorId, projetoId, macroEntregaId, microEntregaId, ano, mes)` — impede a mesma alocação duplicada (o que bagunçaria a soma do teto).
- **Índice** em `(colaboradorId, ano, mes)` — é o que torna a soma do teto (e o lock) eficiente.
- Todas as FKs com `ON DELETE RESTRICT` — coerente com "arquivar, não deletar".

**Rota de alocação com lock** (`backend/src/routes/alocacoes.ts`)
- A verificação do teto e a gravação acontecem dentro de **uma única transação interativa** do Prisma.
- **Mecanismo do lock:** `SELECT id FROM colaboradores WHERE id = ? FOR UPDATE` adquire um lock exclusivo na linha do colaborador (serializa o acesso — o segundo gestor espera o primeiro terminar). A soma das horas usa `LOCK IN SHARE MODE` para ler os dados *committed* mais recentes, não o snapshot antigo. O lock é ancorado no colaborador (que sempre existe) e não nas linhas de alocação (que podem não existir na primeira alocação).
- Bloqueio retorna 409 com `totalAlocado`, `horasDisponiveis` e a `distribuicao` (projetos, horas e gestores).
- Permissão: só gestor e admin alocam; coordenação 403.
- **Validado com teste de concorrência:** `backend/test-concorrencia.mjs` dispara duas requisições simultâneas (via `Promise.all`) contra o mesmo colaborador/mês e confere o total real no banco. **16/16 rodadas corretas no C1, o teto nunca furou.** Re-executado a cada mexida perto da lógica de alocação ao longo de C2, C3 e Fase 3: sempre 8/8.
- Ajuste no B3: as rotas de delete de macro/micro agora checam alocações antes de deletar e retornam 400 com mensagem clara (consequência do `RESTRICT`).

### Fase 2 — C2 — Grid de alocação (branch `feat/alocacao-fase-2`)

Interface rica de alocação: **colaboradores nas linhas, projetos do gestor nas colunas, um mês por vez**. Tudo em `frontend/src/pages/GridAlocacao.tsx` (rota `/grid`). O grid consome a rota de alocação do C1 (POST/DELETE) sem alterá-la — **o teto e o lock seguem intocados**.

**Rota de leitura** `GET /api/alocacoes/grid?ano=&mes=` (em `alocacoes.ts`):
- Colunas = projetos do gestor logado **com `status = 'ativo'`** (admin vê todos os ativos; coordenação não é dona de projetos, então vê grid vazio — esperado, a visão dela é da Fase 5).
- Linhas = colaboradores com ≥1 alocação nos projetos do gestor naquele mês.
- Por linha: `saldo { totalMeusProj, totalOutros, totalGeral, disponivel }` — `totalGeral` soma TODOS os gestores (base correta do teto).
- `celulas[projetoId] = { totalHoras, totalRealizado, detalhes: [{ alocacaoId, macroNome, microNome, macroEntregaId, microEntregaId, horas, horasRealizadas }] } | null` (o `totalRealizado` e o `horasRealizadas` por detalhe entraram no C3-b).
- `defaultMacroId` / `defaultMicroId` por projeto = a micro "Geral", destino do clique rápido na célula.
- **(Fase 3)** passou a retornar também `fechado: boolean` do (ano,mes) consultado.

**D1 — estrutura e leitura** (`7cf45bb`)
- Seletor de mês/ano (◀▶ + dropdown). Colunas **sticky**: Colaborador (left:0) e Saldo (left:200px) param; os projetos rolam na horizontal.
- **BarraSaldo:** **COR** = lotação total (verde <80% / âmbar 80–99% / vermelho ≥100%); **TEXTURA** = posse (sólido = horas do gestor logado; hachurado 45° na mesma cor = outros gestores); fundo `var(--surface-3)` = livre. Legenda "■ você · ▦ outros gestores". Linha de disponível ("Xh disponíveis" / "Capacidade esgotada") em **todas** as linhas.

**D2 — edição inline do planejado** (`62675cf`)
- Célula vira input (idle → editing → saving → idle). Enter/blur confirma, Escape cancela (guard `activeRef`). Sem otimismo reverso. Clique cai na micro "Geral". Zerar → DELETE. "máx Xh" durante a digitação (220 − totalGeral + horas da célula). Popover de bloqueio 409 com a distribuição, `position: fixed`.

**D3-a — busca e localizador universal** (`d4429b3`)
- Busca (debounce 300ms) → `GET /api/colaboradores?search=&ativo=true`. Selecionar quem não está no grid → linha nova com saldo calculado no frontend. Quem já está → selo "no grid", scroll + flash de ~2s.

**D3-b — composição macro/micro: leitura (`07c3096`) e edição (`bd5f631`)**
- Célula mostra a **soma** do projeto. Ícone de lista sempre montado (opacity 0.5) abre o painel (drawer). Clique inline opera só na "Geral".
- Painel busca a estrutura via `GET /api/projetos/:projetoId/macros`; lista todas as micros (inclusive zeradas). Cada micro salva individualmente pela rota do C1 (uma de cada vez, com teto + lock). Painel não fecha ao salvar (`detalheMap` local + `refreshSaldo()`); refetch silencioso.

**Decisão de UX travada no C2:** clique rápido na célula → "Geral"; ícone de lista → painel pra detalhar/editar macro/micro. **Criar micros novas continua só na tela de detalhe do projeto (B3).**

### Fase 2 — C3 — Realizado e comparação (branch `feat/alocacao-fase-2`)

Adiciona o **realizado** (horas de fato trabalhadas, digitadas pelo gestor) e a comparação com o planejado. **Decisões travadas:** o realizado fica FORA do teto e do lock (caminho de escrita separado); só é lançado onde já existe alocação; inline na célula cai na "Geral", e o painel edita por micro.

**C3-a — endpoint de escrita do realizado** (`8ec779f`)
- `PATCH /api/alocacoes/:id/realizado`, body `{ horasRealizadas }`: número ≥ 0 (inclusive 0) grava; `null` limpa; campo ausente / não-numérico / negativo → 400; alocação inexistente → 404.
- Atualiza só `horasRealizadas`, seta `updatedById`. **Sem teto, sem lock** (não toca o `alocarComLock`). Ownership igual ao POST (não verifica dono de projeto).
- `0` é tratado de forma assimétrica ao planejado: o POST rejeita 0 (`≤ 0`), o realizado aceita 0 (`< 0`) — "fez 0h" é informação válida.
- Teste `backend/test-c3a.mjs`. (Obs.: o PROGRESSO foi inadvertidamente empacotado neste commit por um `git add -A` — conteúdo correto, só mistura de arquivos.)

**C3-b — entrada do realizado na célula e no painel** (`0f8469e`)
- GET /grid passa a expor o realizado (`horasRealizadas` por detalhe + `totalRealizado` por célula; `null` quando nenhuma micro tem realizado → a célula mostra "—").
- PATCH ganhou um **teto de sanidade**: valor acima de 9999,99 (limite da coluna `Decimal(6,2)`) → 400 em vez de 500.
- Célula: planejado em cima + realizado embaixo, editável inline na "Geral" (sublinhado tracejado + realce no hover sinalizando que é clicável; só-leitura quando a Geral não tem alocação — edita pelo painel). Sem teto/máx/bloqueio; vazio → limpa.
- Painel: cada micro **com alocação** ganha input de realizado ao lado do planejado, com rótulos "Plan."/"Real." colados acima de cada caixa. Salvar planejado **preserva** o realizado da micro.
- CSS (`index.css`): removidas as setinhas dos `input[type=number]`. Corrigido um erro de tipo latente (`Celula`) que o `tsc` acusava.
- `test-c3a.mjs` → 9/9 (inclui >9999,99 → 400).

**C3-c — copiar planejado → realizado + comparação** (`a1886f8`)
- `POST /api/alocacoes/copiar-realizado` { ano, mes }: preenche `horas_realizadas = horas_planejadas` em massa, **só onde está NULL** (não sobrescreve), via `$executeRaw` **parametrizado**, setando `updated_by_id`/`updated_at`. **Escopo = projetos ATIVOS** do gestor (admin: todos os ativos), alinhado com a GET /grid. Sem teto/lock. Retorna `{ atualizadas: N }`. requireRole('admin','gestor'); coordenação 403; ano/mes validados.
- Frontend: botão "Copiar plan. → real." no header + modal de confirmação (estilo da app, fecha no clique fora) com a contagem de células a preencher (Confirmar desabilitado quando não há nada) + feedback "✓ N preenchidas".
- Comparação na célula: **delta discreto** (realizado − planejado) quando os dois existem — âmbar quando acima do planejado, apagado quando abaixo, nada quando igual ou sem realizado.
- Teste `backend/test-c3c.mjs` → 8/8 (403, ano/mes inválido, cópia só do próprio projeto / isolamento entre gestores, idempotência, não-sobrescrever). `test-concorrencia` segue 8/8.

### Fase 3 — Fechamento mensal e auditoria (branch `feat/alocacao-fase-2`)

Adiciona as garantias temporais e de rastreabilidade. Dividida em **E1 (fechamento)** e **E2 (log de auditoria)**. Tudo validado por API/script; a tela de histórico do log (E2-b) ficou para depois (extra). Desenho e migrations foram revisados antes de aplicar, no ritmo de sempre.

**E1-a — fechamento: backend** (`5aa52c4`)
- Migration `20260609131623_fase3_fechamento_mensal`: tabela `fechamentos_mensais` (`ano`, `mes`, `fechado_por_id` FK→`users` `RESTRICT`, `fechado_em`), `UNIQUE(ano, mes)` — um mês só fecha uma vez. Back-reference virtual no `User` (não vira coluna na tabela `users`). Aditiva, nenhuma tabela existente alterada.
- `backend/src/routes/fechamentos.ts` (montado em `/api/fechamentos`): `POST {ano,mes}` fecha (admin; **201**; 409 se já fechado; valida ano 2020–2100 / mes 1–12); `DELETE /:ano/:mes` reabre (admin; **404** se não estava fechado; `{ success: true }`). Gestor/coordenação → **403** nos dois.
- Helper `mesEstaFechado(ano,mes)` aplicado no **início** dos quatro caminhos de escrita em `alocacoes.ts` — POST, PATCH `/:id/realizado`, DELETE `/:id`, POST `/copiar-realizado`: mês fechado → **409** `{ error: 'Mês fechado', mesFechado: true }`, **inclusive para admin**. A trava fica **antes** do `alocarComLock` — o lock não foi tocado (`test-concorrencia` 8/8).
- Teste `backend/test-e1a.mjs` → **18/18** (403/409 de acesso; ciclo fechar → travas nos 4 caminhos → reabrir → destravado; `fechado` no grid true/false).

**E1-b — fechamento: frontend** (`0529b8d`)
- Em `GridAlocacao.tsx`: `const mesFechado = data?.fechado ?? false`. Mês fechado → grid **somente leitura**: a célula não abre input (nem planejado nem realizado), o painel mostra os valores como **texto fixo**, o botão "Copiar plan. → real." **some**, e uma **faixa vermelha** no topo (fora do scroll) avisa "🔒 [Mês]/[Ano] está fechado — somente leitura".
- Botão **Fechar / Reabrir** perto do seletor de mês, **só para admin** (`const isAdmin = user?.role === 'admin'`, à prova de `user` nulo; só aparece com `isAdmin && data`). Modais de confirmação (estilo da app, fecham no clique fora), e **refetch na hora** ao fechar/reabrir → trava/destrava **sem F5**. Erros de corrida (409 já-fechado / 404 não-fechado) → refetch pra ressincronizar.
- Validado no navegador: trava/destrava na hora; gestor **não** vê o botão; a trava é **por mês** (navegar pra outro mês segue editável); painel abre em leitura.
- **Borda conhecida (anotada, não bloqueia):** se o admin fechar enquanto um gestor está com a tela aberta, o gestor só percebe ao recarregar; se tentar editar antes, o backend recusa com 409 `mesFechado`, mas o popover de bloqueio do planejado espera o formato do teto (com distribuição) e pode parecer estranho. Corrida rara — polimento futuro.

**Micro-fix do parking-lot — `shrink` → `flexShrink`** (`af473ac`)
- `ProjetoDetalhe.tsx`: os 3 `style={{ ..., shrink: 0 }}` (propriedade inexistente em CSS-in-JS) viraram `flexShrink: 0` — o encolhimento flex agora vale de fato. As classes Tailwind `shrink-0` (em `className`) foram mantidas. `tsc` limpo. (Era o item do parking-lot; agora resolvido.)

**E2 — log de auditoria do planejado** (`adc477b`)
- Migration `20260611015805_fase3_alocacao_log`: tabela `alocacao_logs` com `id`, contexto denormalizado (`alocacao_id`, `colaborador_id`, `projeto_id`, `macro_entrega_id`, `micro_entrega_id`), `ano`, `mes`, `acao` (`VARCHAR(20)`: 'criou'/'alterou'/'removeu'), `horas_anteriores`/`horas_novas` (`Decimal(6,2)` nuláveis), `usuario_id` (FK→`users` `RESTRICT`), `criado_em`. Índice em `(alocacao_id)`. **Decisão de modelagem:** os campos de contexto são colunas simples **sem FK** (retrato imutável que sobrevive à deleção da alocação); só `usuario_id` é FK real.
- Gravação **dentro da transação** da escrita (`alocacoes.ts`):
  - POST / `alocarComLock`: alocação nova → `criou` (anterior `null`); existente com planejado **mudado** → `alterou` (compara Decimal via `.minus(...).isZero()`); **mesmo valor → não loga**.
  - DELETE: transação atômica (apaga a alocação **e** grava `removeu`, anterior = valor, nova `null`). Como `alocacao_id` não tem FK, a linha de log referencia o id já apagado sem problema.
  - `usuarioId` = usuário autenticado. **Realizado e copiar-realizado NÃO logam** (escopo é só o planejado).
- `GET /api/alocacoes/:id/log` (admin/gestor): histórico por `alocacaoId`, **mais novo primeiro**, com o nome do usuário de cada ação; **funciona mesmo após a alocação ser deletada** (busca direto na tabela de log).
- **Correção no seed (`db.ts`):** as novas FKs (`fechamentos_mensais` e `alocacao_logs` → `users`) quebravam o `user.deleteMany()` do reseed; a **ordem de limpeza** foi corrigida — apaga `alocacao_logs` e `fechamentos_mensais` **antes** de `users`. **Lição:** ao criar qualquer FK nova apontando pra `users`, ajustar a ordem de deleção do seed.
- Teste `backend/test-e2.mjs` → **8/8** (criou/alterou/removeu; mesmo-valor-não-loga; realizado/copiar não logam; ordem desc; log sobrevive à deleção; coordenação 403). Regressão: concorrência 8/8, c3a 9/9, c3c 8/8, e1a 18/18.

**Seed de teste (`backend/src/db.ts`) — IMPORTANTE para futuras sessões:**
- Cenário realista: **30 colaboradores** (`sc-01`..`sc-30`), **10 projetos** (G1=4, G2=3, G3=3; `sp-01`..`sp-10`, cada um com 1–2 macros + micro "Geral"), **40 alocações** em **junho/julho/agosto de 2026**. Gestores com IDs fixos `seed-gestor-001/002/003`. Idempotente.
- Casos de propósito: Enzo Carvalho (jun) = 220h cheio (vermelho); Daniela Rocha (jun) = 200h (âmbar); Brenda Vieira (ago) = 200h; cross-gestor / barra bicolor: Fabiana Costa (jun), Leonardo Alves e Marina Souza (jul), Nicolas Barbosa (jul), Ulisses Ribeiro (ago).
- O seed **não** popula realizado nem logs/fechamentos — o realizado foi validado digitando na tela / via API.
- A **ordem de limpeza do reseed** apaga `alocacao_logs` e `fechamentos_mensais` antes de `users` (FKs novas da Fase 3).
- **CUIDADO NA IMPLANTAÇÃO:** o seed apaga e recria tudo a cada restart do servidor. NÃO rodar em produção.

---

### Fase 4 — Remanejamento broadcast (backend) (branch `feat/alocacao-fase-2`)

A peça de **colaboração entre gestores**: destravar horas de um colaborador lotado movendo-as de um projeto para outro, sem aprovação vertical. É a parte mais concorrente do sistema depois do teto. **Backend completo**, validado por API + testes de concorrência dedicados; **o frontend está logo abaixo** (subseção "frontend"). Schema e migration revisados antes de aplicar, no ritmo de sempre.

**Princípio central — transferência net-zero.** Uma cessão move X horas da alocação de **origem** (do cedente) para a alocação de **destino** (do solicitante), do **mesmo colaborador no mesmo mês**. Como X sai de um lado e entra no outro, o total do colaborador no mês **não muda** → o teto é preservado **por construção**, sem precisar checá-lo na cessão. As contas de horas são feitas **no banco** (`decrement`/`increment`), nunca subtraindo `Decimal` em JS.

**Schema (migration `20260613015114_fase4_remanejamento`)**
- **`solicitacoes_remanejamento`**: `solicitanteId` (FK User), `colaboradorId` (FK), destino `projetoDestinoId`/`macroEntregaDestinoId`/`microEntregaDestinoId` (FK), `ano`, `mes`, `horasSolicitadas` (`Decimal(6,2)`), `status` (`VARCHAR(20)`: 'aberta'|'atendida'|'encerrada_parcial'|'cancelada'), `fechadoEm`, `fechadoPorId` (FK User?, **null** no auto-fecho), timestamps. Índice `(colaboradorId, ano, mes, status)`. **`horasJaCedidas` é derivado** (SUM das cessões), não coluna.
- **`cessoes_remanejamento`**: `solicitacaoId` (FK), `gestorCedenteId` (FK User), `horasCedidas` (`Decimal(6,2)`), `idempotencia` (`@unique`), `alocacaoOrigemId` **sem FK** + retrato da origem `origemProjetoId`/`origemMacroEntregaId`/`origemMicroEntregaId` **sem FK** (sobrevive à deleção, padrão do log).
- **`alocacao_logs`** ganhou **`cessaoId`** (`VARCHAR`, nullable, **sem FK**) — liga os dois lados de uma transferência (o log da origem e o do destino compartilham o mesmo `cessaoId`).
- **CHECK manual** (Prisma não modela): `alocacoes.horas_planejadas >= 0` (a cessão pode **zerar** uma origem, mas nunca negativá-la).
- Todas as FKs `ON DELETE RESTRICT`. Back-references nomeadas em `User` (×3: solicitante, fechadoPor, cedente), `Colaborador`, `Projeto`, `MacroEntrega`, `MicroEntrega`.
- **Seed (`db.ts`):** a ordem de limpeza do reseed apaga `cessoes_remanejamento` e `solicitacoes_remanejamento` **antes** de `users`/`colaboradores`/`projetos`/`macros`/`micros`. **Lição reforçada:** toda FK nova pra `users` (ou pras entidades de domínio) exige ajustar a ordem de deleção do seed.

**F-a — criar e listar solicitações** (`393596f`)
- `backend/src/routes/remanejamento.ts` (montado em `/api/remanejamento`).
- `POST /solicitacoes` (admin/gestor): valida obrigatórios, ano/mes, `horasSolicitadas > 0`, **mês não fechado**, colaborador existe+ativo, projeto destino **existe, é do solicitante e está ativo** (rejeita arquivado), e a cadeia projeto→macro→micro. Cria 'aberta'. **Não checa teto** (deliberado — quem garante o teto é a cessão, e ela é net-zero).
- `GET /solicitacoes` (admin/gestor): `{ minhas, recebidas }`. **minhas** = onde sou solicitante (todos os status). **recebidas** = solicitações 'aberta', não-minhas, **onde eu tenho o colaborador alocado no mesmo (ano,mes)** — é o **broadcast** (admin vê todas as abertas). Cada item traz `horasJaCedidas`/`horasRestantes` (derivados via SUM) + nomes (colaborador, projeto destino, solicitante).
- Teste `backend/test-f-a.mjs` → **13/13** (acessos, validações, broadcast: solicitante vê em "minhas", quem tem o colaborador vê em "recebidas", quem não tem não vê).

**F-b — cessão (o coração concorrente)** (`6e87355`)
- `POST /solicitacoes/:id/cessoes` (admin/gestor), body `{ alocacaoOrigemId, horasCedidas, idempotencia }`.
- **Transação com o lock pessimista do colaborador** (o **mesmo** lock do teto: `SELECT id FROM colaboradores WHERE id=? FOR UPDATE`) — serializa cessões concorrentes, alocações normais e os cancelamentos/encerramentos. **Não** toca o `alocarComLock`. Decisão de concorrência: **um só lock, o do colaborador** — como toda cessão de um pedido é do mesmo colaborador, ele já serializa tudo; não foi preciso um segundo lock na solicitação.
- Ordem dentro do lock: lê a solicitação → trava o colaborador → revalida status 'aberta' → mês fechado? → valida a origem (existe, é do cedente, mesmo colaborador, mesmo ano/mês) → rejeita **origem == destino** → `restante = solicitadas − SUM(cessões)` → `Yefetivo = min(pedido, restante)` (rejeita se a origem não tem `Yefetivo`) → move (origem `−Y`; destino `+Y` via upsert, **destino pertence ao solicitante**) → grava a cessão → **audita os dois lados com o mesmo `cessaoId`** (origem 'alterou', destino 'criou'/'alterou') → **auto-fecha** ('atendida', `fechadoEm`, `fechadoPorId=null`) se `SUM+Y == solicitadas`. Regra de ouro: **validar/ler tudo antes de mover; mover antes de fechar.** O `min(pedido, restante)` garante que nunca passa do pedido, então o `==` do auto-fecho é exato (nunca "pula" o fecho).
- **Idempotência:** pré-checagem por `idempotencia` antes da transação (devolve a cessão existente, 200); guarda final de `P2002` no catch (corrida rara) que também devolve a existente.
- **⚠️ Bug real encontrado e o aprendizado mais importante da fase — `ER_CHECKREAD` (1020):** sob a isolação padrão (`REPEATABLE READ`), quando a 2ª transação (B2) tenta uma **leitura com lock** (`FOR UPDATE`/`LOCK IN SHARE MODE`) em linhas que a 1ª (B1) **inseriu e commitou depois do snapshot de B2** (as cessões e a alocação de destino), o MariaDB lança `ER_CHECKREAD 1020` ("Record has changed since last read") em vez de ler a versão nova → **erro 500**. E pior: uma leitura **sem** lock veria o snapshot velho (restante desatualizado) → risco de ceder **além** do pedido. **A correção é `isolationLevel: ReadCommitted` na transação:** cada statement lê o último *committed*, sem snapshot preso, sem `ER_CHECKREAD`; e o **lock do colaborador continua serializando** (B2 espera B1 commitar e então lê o trabalho dele corretamente). O teto (`alocarComLock`) **não** sofre disso porque as linhas que ele soma já existiam no snapshot das duas transações; **só a cessão**, que **insere** linhas novas sob concorrência, precisava do `ReadCommitted`. **Regra geral pro futuro:** transação que **insere linhas sob concorrência e depois faz leitura com lock** → use `ReadCommitted`.
- Testes: `backend/test-f-b.mjs` → **12/12** (válida; 403/400/409; origem==destino; ajuste pro restante + auto-fecho; ceder mais que a origem; já-atendida; mês fechado; idempotência aplica 1×; auditoria nos 2 lados com o mesmo `cessaoId`; net-zero). **Concorrência dedicada** `backend/test-concorrencia-cessao.mjs` → **8/8 rodadas**: pedido de 30h, B1+B2 cedendo 20h cada em paralelo → total cedido **exatamente 30** (uma ajusta pra 10), 'atendida', **nenhuma origem negativa**, total do colaborador **inalterado** (net-zero).

**F-c — cancelar e encerrar parcial** (`1b5594a`)
- `POST /solicitacoes/:id/cancelar` (solicitante/admin): só com **zero cessões** (senão **409** 'use encerrar'); status 'cancelada'.
- `POST /solicitacoes/:id/encerrar` (solicitante/admin): exige **ao menos uma cessão** (senão **409** 'use cancelar'); status 'encerrada_parcial'; as horas já cedidas **ficam** (definitivas). É o "já cederam algo, mas eu decido parar de esperar o resto".
- Os dois no **mesmo padrão da cessão**: `isolationLevel: ReadCommitted` + `FOR UPDATE` no colaborador, com a **revalidação de status sob o lock**. **Não** movem horas → **não** auditam e **não** checam mês fechado (o gate de mês fechado protege **horas**; aqui é só ciclo de vida do pedido). `fechadoPorId` = quem encerrou à mão (o `null` fica só pro auto-fecho 'atendida'). É o lock que faz cancelar e uma cessão simultânea **não se atropelarem**: quem pega o cadeado primeiro decide, o outro revalida o status e recusa — **nunca fica 'cancelada' com cessão**.
- Teste `backend/test-f-c.mjs` → **9/9** funcionais + **4 rodadas** de corrida cancelar×cessão (invariante "nunca cancelada com cessão" mantido em todas).

**Estado do backend da Fase 4:** completo (criar, listar, ceder, cancelar, encerrar), com a concorrência provada.

---

### Fase 4 — Remanejamento broadcast (frontend) (branch `feat/alocacao-fase-2`)

As telas que põem o remanejamento na mão dos gestores, consumindo os endpoints prontos do backend. Tudo em `frontend/src/pages/Remanejamento.tsx` (rota `/remanejamento`, item no menu com ícone `ArrowLeftRight`, **visível só para gestor/admin** — coordenação recebe 403 e nem vê o item), mais o gancho de "solicitar" dentro do grid. Construído em pedaços pequenos (G1→G4 + a barra), cada um validado no navegador antes do commit. Sem brainstorm externo (decisão de UI, barata de iterar), mas com o fluxo desenhado antes de codar.

**G1 — página em leitura + seed** (`02e46fa`)
- Página com duas seções: **"Minhas solicitações"** (o que eu pedi, todos os status) e **"Recebidas (posso ceder)"** (o broadcast — pedidos de colegas sobre colaboradores que eu tenho no mês). Cards com selo de status colorido (aberta=azul, atendida=verde, encerrada_parcial=âmbar, cancelada=cinza) e barra de progresso. Sem seletor de mês — cada solicitação carrega o seu.
- Seed (`db.ts`) ganhou 3 solicitações abertas cross-gestor (`ssol-001/002/003`) pra dar o que ver na tela: G3 quer Leonardo Alves (jul); G1 quer Nicolas Barbosa (jul); G2 quer Ulisses Ribeiro (ago). O `include` da solicitação passou a trazer macro/micro de destino. **Pegadinha do Prisma:** `UncheckedCreateInput` exige `status` explícito no seed mesmo havendo `default` no schema.

**G2 — solicitar a partir do bloqueio do teto** (`27ad941`)
- No `GridAlocacao.tsx`, o popover de bloqueio (409 do teto) ganhou o botão **"Solicitar horas via remanejamento"**. Abre um modal pré-preenchido: colaborador e destino (a célula, em leitura) fixos; o campo de horas sugere o **incremento bloqueado** (o que a pessoa digitou **menos** o que a célula já tem), não o valor cheio. `POST /solicitacoes`; ao dar certo, fecha modal + popover e mostra feedback — a célula **não** muda (a alocação só acontece quando alguém ceder). Não toca teto nem lock.

**G3 — ceder a partir de uma recebida** (`bcce21b`)
- **Backend (leitura auxiliar):** `GET /api/alocacoes/minhas-do-colaborador?colaboradorId=&ano=&mes=` (admin/gestor) devolve as alocações **do próprio gestor** daquele colaborador no mês — é o que alimenta o seletor de origem da cessão. Read puro; admin recebe vazio (ceder é ação de gestor).
- **Frontend:** botão **Ceder** nos cards de Recebidas → modal com o contexto do pedido, seletor da **alocação de origem** (via o endpoint acima), campo de horas (default = `min(restantes, saldo da origem)`, recalcula ao trocar a origem), aviso de net-zero, e idempotência por `crypto.randomUUID()` a cada abertura. `POST /cessoes`; trata `ajustado`/`horasCedidasEfetivas` no sucesso; erros do backend exibidos.
- **Dois bugs achados no navegador e corrigidos:** (1) "sem alocações" falso — o servidor rodava **código velho** (a rota nova não tinha sido carregada → 404); **reiniciar o backend** resolveu (lembrete reforçado: o backend não tem hot-reload, toda mudança nele exige restart). (2) botão/barras **invisíveis** por usar `var(--brand)`, que **não existe** no tema — trocado pela classe `btn-brand` / `var(--brand-500)`.

**G4 — cancelar e encerrar** (`aae171c`)
- No card de Minhas, o botão certo por estado: **"Cancelar"** (vermelho) pra solicitação aberta **sem** cessões; **"Encerrar"** (âmbar) pra aberta **com** ao menos uma cessão; nenhum botão em estado terminal. `ModalConfirm` novo com o contexto do pedido e descrição contextual (cancelar = encerra sem efeito; encerrar = as horas já cedidas permanecem). `POST /cancelar` ou `/encerrar`, com refetch e feedback.

**Barra de progresso nas Recebidas** (`18964ed`)
- O `ProgressBar` ganhou um `labelRight` opcional (o `MeuCard` ficou inalterado). O `RecebidaCard` passou a mostrar a **mesma barra** do card de Minhas (`horasJaCedidas`/`horasSolicitadas`), com "Xh cedidas" à esquerda e "Faltam Yh" à direita — assim o cedente vê de relance o quão cheio o pedido está (o quanto outros gestores já cederam). A caixinha redundante "Faltam Xh de Yh" saiu; o botão Ceder foi pra baixo da barra.

**Estado da Fase 4:** **completa** — backend (concorrência provada) + frontend (todas as telas validadas no navegador). O remanejamento funciona de ponta a ponta pela interface: solicitar (a partir do bloqueio do teto), ceder (de uma recebida, com origem e parcela), acompanhar o progresso (barra) e cancelar/encerrar o próprio pedido.

---

## 4-bis. Pós-demo — pedidos da cliente (branch `feat/alocacao-fase-2`)

Depois da Fase 4 o sistema foi **demonstrado para a cliente**, que trouxe cinco pedidos. Em ordem de implementação: (1) prestação de contas — **já existia**; (2) **categoria/programa do projeto**; (3) **valor-hora do colaborador**; (4) **priorização automática**; (5) **dashboard**. Além deles, o demo remoto exigiu um preparo. Esta seção registra o que já foi construído dessa leva. Tudo nesta branch, no mesmo método (pedaços pequenos testados/aprovados um a um, commit + push a cada um, migration mostrada antes de aplicar, validação no navegador antes do commit).

### Preparo do demo remoto
- **Segurança — `/auth/register` fechado** (`777b37f`): o endpoint era **público e aceitava `role` do cliente** (qualquer um se cadastrava como `admin`). Passou a responder **403 `Registro desabilitado`**. **Resolve a pendência de segurança que estava no parking-lot** (era a única de pré-implantação).
- **Reforma visual** (`c378876`, `db44f99`): tema **claro/sóbrio com acento índigo** (fonte Inter). Login reescrito (identidade legada LOGAME/RunTask removida); `ThemeContext` padrão claro; telas ForgotPassword/ResetPassword reescritas no mesmo estilo (fluxo por **código de 6 dígitos**, não token na URL); cor de erro padronizada em **`#b42318`** (o `#f87171` claro some no fundo branco).
- **Mensagens de erro do auth em PT** (`efd0a1a`): "Invalid credentials" → "Email ou senha incorretos" (genérico nos dois casos do 401, por segurança).
- **ngrok** (`b3e5b20`): `allowedHosts: true` no `vite.config`. O demo rodou no ar (passos de terminal da gestora, fora do CC: `npm run dev` → `ngrok config add-authtoken …` → `ngrok http 5173`). Cuidado: dados são DEMO e reseedam no restart — **não reiniciar mid-demo**.
- **Lição reforçada:** `tsc` limpo **não** prova cor certa. O `#f87171` sumindo no branco e o `var(--brand)` inexistente foram pegos **só no navegador**. Print é gate.

### Bloco de custos (pedido #3 — valor-hora — que cresceu)
- **Valor-hora do colaborador** (`c3fc0bc`): campo `valorHora Decimal(10,2)?` **opcional** no Colaborador; validado ≥ 0 / null no criar+editar; form com "Valor/hora (R$)". Migration `add_valor_hora_colaborador`. **Gotcha aprendido:** `prisma migrate dev` **mesmo com `--create-only` APLICA migrations pendentes** — conferir se o arquivo foi criado antes de re-rodar.
- **Custo no saldo do grid** (`785f296`): `GET /grid` calcula `saldo.custo` = horas × valorHora (gestor vê **a fatia dele** = totalMeusProj; admin vê o total; `null` sem rate). Seed ganhou valor-hora realista por função nos 30 colaboradores.
- **Total por projeto no rodapé do grid** (`ac7d119`): `custoPorProjeto` por coluna, num `<tfoot>` sticky "Total do projeto".
- **Relatório de custos por projeto** (`d642643`): tela **"Custos"** + `GET /api/relatorios/custos` (requireRole('admin','gestor'); gestor vê seus projetos ativos, admin todos). Por projeto: **custo total somando TODOS os meses** + quebra por colaborador (horas, valor-hora, custo). Somas em **Decimal** (reconcilia ao centavo — arredonda por colaborador e soma os arredondados); colaborador sem valor-hora aparece marcado e **não soma**.
- **Nota:** o custo no grid é **display** (arredondado); o relatório usa **Decimal de verdade**. Coordenação no relatório → **403 hoje** (reavaliar na Fase 5 — é papel de leitura dela). Categoria no relatório + export CSV → futuro.

### Programas de fomento — categoria do projeto (pedido #2 — **COMPLETO**)
Cada projeto pertence a um **programa de fomento** (BNDES, EMBRAPII, FINEP, SENAI, SEBRAE… e "entre outros" → lista **administrável**, não enum fixo).

**Decisões travadas:**
- Programa **obrigatório em todo projeto** (criar/editar exigem; todos os projetos do seed nascem com um). A obrigatoriedade é garantida **no app + seed**; a coluna `categoriaId` no banco é **nullable** (jeito seguro de aditivar sem quebrar projetos existentes — na ida pra produção dá pra apertar pra NOT NULL num passo único).
- Lista **compartilhada** (sem dono — BNDES é BNDES pra todos) e **gestor + admin** cadastram.
- Duplicação no **padrão do colaborador**: nome **idêntico** (ignorando caixa/acento, via collation `utf8mb4_unicode_ci` + check no app + `P2002`) **bloqueia** (409); nome só **parecido** **avisa** e só cria com `confirmarSimilar` (mesma similaridade de `colaboradores.ts`, Levenshtein ≤ 30%).

**Construído:**
- **Backend** (`0a4361a`): entidade `CategoriaProjeto` (`nome` unique, `ativo`), rotas `/api/categorias` (GET admin/gestor/coordenacao; POST/PATCH admin/gestor com o fluxo exato-bloqueia / parecido-avisa). Seed cria os 5 programas e atribui um a cada projeto (**ordem do reseed ajustada**: categorias são PAI de projetos → apagar projetos antes, criar categorias antes). Migration `add_categoria_projeto` (FK **nullable, ON DELETE RESTRICT**). Teste `test-categorias.mjs` **19/19**.
- **Projeto exige programa** (`0497ac6`): POST/PUT validam `categoriaId` (presente, existe, **ativo**); PUT **não deixa apagar** (null → 400) e **preserva o atual** quando não vem no corpo; GET devolve a `categoria`. Teste `test-projeto-categoria.mjs` **19/19**.
- **Tela "Programas"** (`4a2da8a`): admin/gestor listam/criam/renomeiam/ativam-desativam, com o aviso de "parecido". Rota `/programas` + item no menu (gestor+admin).
- **Seletor + selo** (`4f189d3`): seletor de programa **obrigatório** no form do projeto (ao editar, mostra o programa atual **mesmo se inativo** via opção "(inativo)" e **só reenvia `categoriaId` se mudou** — evita travar ao salvar só o nome de um projeto cujo programa foi desativado); **selo** do programa no card e no detalhe.

**Contrato a lembrar (respostas não-uniformes):** `POST /api/categorias` devolve `{ categoria }` (embrulhado); `PATCH` devolve o objeto **direto**; **`needsConfirmation` volta com status 200** → no frontend, checar `data.needsConfirmation` **antes** de `res.ok`.

### Tarifa por colaborador × categoria (evolução do pedido #3 — **COMPLETO**)
O valor-hora único por pessoa virou **tarifa por colaborador × categoria** (a cliente pediu, via 2 áudios): cada pessoa pode ter um valor diferente por programa de fomento. Ex.: um colaborador a R$ 30,70/h no FINEP e R$ 100/h nas demais. **Decisão estrutural → passou por brainstorm de 4 IAs** (`Brainstorm_ValorHora_Categoria.md` → `Tarifa_Colaborador_Categoria_Spec.md`, aprovada). Confusão resolvida no caminho: o texto da gestora dizia "depende da função", o áudio dizia **por colaborador** — ficou **por colaborador** (a função é descritiva, não define tarifa).

**Decisões travadas:**
- **Modelo:** mantém `Colaborador.valorHora` como o **padrão** (NÃO renomeado — evita ripple em backend/API/frontend; campo físico `valor_hora` via `@map`) + tabela nova **`TarifaColaborador`** (`colaboradorId`, `categoriaId`, `valorHora Decimal(10,2)`) UNIQUE(colaboradorId, categoriaId), guarda **só as exceções**.
- **Precedência (o resolvedor):** override (colaborador+categoria) → senão o `valorHora` padrão → senão `sem_tarifa` (defensivo, não soma).
- **Valor-hora padrão agora OBRIGATÓRIO** (decisão da cliente) — validação no app (criar/editar); a coluna segue **nullable** no banco. Logo `sem_tarifa` só existe como guarda; com o padrão obrigatório, toda alocação sempre tem custo.
- **Migração indolor:** o valor único atual vira o padrão; a tabela nova nasce vazia; os custos atuais não mudam.

**Construído:**
- **Resolvedor** `backend/src/lib/tarifa.ts`: `carregarTarifas(ids)` (1 query em lote, sem N+1) + `resolverTarifa(...)` → `{ valor, origem: 'especifica'|'padrao'|'sem_tarifa' }`. Migration `add_tarifa_colaborador` (`20260620004945`; o `@map` faz o SQL **só criar** `tarifas_colaborador`, sem tocar `valor_hora`).
- **Relatório de custos** (`742e438`): passa a usar o resolvedor — cada linha traz a tarifa **resolvida** + a `origem`; tudo Decimal; o seed ganhou 3 overrides FINEP + uma alocação cruzada (Samuel Gomes em FINEP **e** BNDES) pra exercitar. `test-tarifa.mjs` **22/22**.
- **Custo do grid** (`555ad2d`): `saldo.custo` virou **soma por projeto** (cada projeto com a tarifa da sua categoria), não mais horas × um valor só; `custoPorProjeto` usa o override da coluna. Carrega categorias + tarifas em lote (carga extra cobre projetos de outros gestores no caso admin, sem N+1). **Saldo de HORAS, teto, células e fechamento intocados.** `test-grid-custo.mjs` **18/18** (inclui sanidade de que horas/teto não mudaram).
- **Backend da edição** (`3a00e8f`): criar/editar colaborador **exige** `valorHora` (400 claro se ausente/≤0); aceita `tarifas: [{categoriaId, valorHora}]` = **conjunto completo** de overrides (upsert dos enviados + **apaga** os omitidos, numa transação com o colaborador); `tarifas` ausente **preserva**, `[]` **apaga todos** (`notIn: []` do Prisma casa com tudo — confirmado em teste); novo **`GET /colaboradores/:id`** traz os overrides. Validação por item (categoria existe+ativa, valor > 0, sem repetir). `test-tarifa-crud.mjs` **21/21**.
- **Tela** (`d1dd8df`): no form do colaborador, padrão obrigatório no topo + seção "Tarifas por categoria" listando as categorias ativas (em branco = usa o padrão; placeholder mostra o padrão). Editar pré-preenche os overrides via o `GET :id`. **Blindagem contra apagar override sem querer:** o Salvar fica **desabilitado** enquanto as tarifas carregam, e se o `GET :id` **falhar** o PUT **omite** o campo `tarifas` (o backend preserva). (O "Preencha este campo" do padrão é a validação nativa do navegador — funciona.)

**Contrato a lembrar:** o custo no **grid** é display (arredondado); o **relatório** usa Decimal de verdade. O padrão do colaborador é a coluna física `valor_hora` (via `@map`).

### Regra de priorização — **FECHADA, implementação pendente** (pedido #4)
Sintetizada a partir de **brainstorm de 4 IAs externas** (decisão estrutural, cara de refazer → entrou na régua do brainstorm). Documento: **`Regra_Priorizacao.md`** (aprovado pela gestora).

- **Regra:** determinística e **auditável** (não caixa-preta). **Categoria pela faixa de prazo** da próxima prestação de contas (vencido ou ≤ 7 dias → **Alta**; 8–30 → **Média**; > 30 → **Baixa**; sem prazo → fila separada). **Dentro da categoria, ordena por horas pendentes desc** (`horas_pendentes = planejado − realizado`; degrada bem com realizado vazio → usa o planejado inteiro). **Capacidade/gargalo é só SINAL exibido** (🔴 quando ≥ 95% do teto), **não entra na ordenação**. **Override manual** (fixar/pausar). Recálculo em **batch diário**. Todos os limiares numa **tabela de config**.
- **3 decisões da cliente resolvidas:** escalonamento por capacidade **desligado** (só alerta, não reordena) na v1; ordem intra-categoria por **horas pendentes**; cultura de apontamento de realizado vira **pergunta pra cliente** (a precisão degrada — não catastroficamente — sem o realizado).
- **Saída pro usuário:** sempre **categoria + ordenação + um texto curto do "porquê"** (nunca um número solto).
- **Implementação:** **fase futura** (estruturalmente pesada). Os endpoints de leitura existentes são base; vai precisar do cálculo + uma tela.

---

## 4-ter. Segunda leva de pedidos da cliente (via o `Manual`)

Numa segunda conversa, a cliente trouxe um documento (`Manual_Sistema_de_Alocacao.md`, anotado por ela) misturando **o que existe** com a **visão-alvo** + listas de **bug / admin / melhorias**. A triagem separou: já-feito, bugs, decisões de produto, e a peça estrutural grande.

### A peça estrutural — papéis, posse e exclusão (**SPECADO, a implementar**)
A organização real é **diretor → chefe → gestores** (hoje só há `admin`/`gestor`/`coordenacao`). Como mexe na autorização de quase toda tela e na posse dos projetos (decisão cara de refazer), **passou por brainstorm de 4 IAs** → virou a **`Spec_Papeis_Posse_Exclusao.md`** (decisões batidas com a cliente). Resumo travado:
- **Enum plano de 5 papéis:** `admin`, `chefe`, `gestor`, `coordenacao`, `diretor`. `admin` e `chefe` **separados** (técnico vs. negócio), mas **ambos fecham/reabrem mês** (a cliente não quis depender de uma só pessoa; e gestor individual não fecha, porque é ação **global**). `coordenacao` (leitura operacional) e `diretor` (leitura executiva, só dashboards) **coexistem**.
- **Posse:** mantém `gestorId` como **dono operacional** (NÃO renomear — preserva a lógica do grid) + novo `criadoPorId`. Chefe **cria e delega** (`gestorId` = delegado, `criadoPorId` = chefe). Chefe **opera qualquer projeto** (autoriza se `user === gestorId` OU `papel === chefe`), pelo **mesmo `alocarComLock`** (sem atalho — o teto segue protegido). **Re-delegar** = trocar `gestorId` + auditoria; **alocações/histórico não mudam**.
- **Exclusão permanente** (caso "criei sem querer"): **status no projeto** (`pendente_exclusao` + `exclusaoSolicitadaPorId` + motivo), **não** entidade nova. **Bloqueia se houver ALOCAÇÃO** ("virgem" = zero alocações); a estrutura auto-criada (micros → macros → prestações) é apagada junto, **cascata explícita na transação** (FKs seguem `RESTRICT`). `pendente_exclusao` **recusa novas alocações** (mesmo padrão do "mês fechado", fecha a janela de corrida). **Lápide** (`projeto_excluido`) gravada **antes** do delete. **Código liberado pra reuso** após o hard delete (decisão **(a)** da cliente — reverte o "código preso"; a lápide, com data, guarda o histórico). Gestor dono pede, chefe aprova (ou exclui direto).
- **Diretor:** só dashboards (endpoints agregados **próprios**, não o grid com parâmetros omitidos) — entra junto do trabalho de dashboards.
- **Ordem (6 passos):** (1) papéis + migração + `requireRole`; (2) `criadoPorId` + delegação na criação; (3) override do chefe (mesmo lock; **teste de concorrência chefe×gestor**); (4) re-delegação; (5) exclusão + lápide; (6) telas do diretor/dashboards.

### Bugs reportados no Manual (a tratar)
- **Macro/micro não apaga; não dá pra editar/excluir só a micro** — defeito **atual**, core. Precisa de **diagnóstico** (bloqueio por alocação aparecendo como "não apaga"? regressão? função faltando? lembrar que apagar a **única** micro de uma macro é bloqueado por regra). É o trabalho independente sugerido pra começar.
- **Perfil com cores ruins / ilegível** — já conhecido (a tela de Perfil foi feita pro tema **escuro**, quebra no claro). Conserto: retrabalhar pro tema claro.

### Decisões de nomenclatura / produto resolvidas
- **Nomenclatura da classificação do projeto = "Programas"** (a cliente confirmou; **cancela** a ideia anterior de renomear pra "Categorias"). A entidade interna segue `CategoriaProjeto` (só nome de código).
- **"Excluir projeto" = excluir de vez** (não arquivar), via pedido do gestor + aprovação do chefe — é o fluxo de exclusão permanente acima.

### Itens menores / melhorias (fila)
- **Coluna de cargo na aba de Custos** (pequeno).
- **Admin não precisa criar projeto** (ajuste de permissão — confirmar o exato com a cliente).
- **Gerar PDF de Declaração de HT da equipe por mês** (template editável pelo gestor) — a cliente vai mandar o template; fica pro fim.
- **Notificação de solicitações de remanejamento** (dá pra reusar a infra de push do legado).
- **Data de início/fim por período em cada macro-entrega** (campos novos na macro).
- **Hierarquia de visualização de dashboards/relatórios em PDF** — casa com o diretor + dashboards.
- (possível) campo **"área de atuação"** no colaborador — confirmar com a cliente.

### Cosmético pendente
- **"Continuar" → "Salvar"** no botão do **cadastro** de colaborador (o "Continuar" vem do fluxo de duplicata; é só o texto, a confirmação de "parecido" continua igual). **Ainda não aplicado** (prompt já preparado).

---

## 5. Sobre alocar "no nível da macro" (sem descer até micro)

Pergunta recorrente: *é possível atribuir um colaborador a uma macro, sem escolher uma micro?*

**Resposta prática: sim — usando a micro "Geral".** A alocação no banco sempre aponta para uma micro específica (`microEntregaId` é obrigatório). Mas como toda macro nasce automaticamente com uma micro "Geral", alocar "na macro" significa, na prática, alocar na "Geral" daquela macro. Na tela isso se apresenta como alocar na macro; por baixo, registra na "Geral".

**Por que não tornar `microEntregaId` opcional?** Seria uma mudança de modelagem desaconselhada: quebraria a regra de unicidade da alocação e a integridade da soma do teto (uma alocação "solta" na macro não teria âncora estável, e o remanejamento da Fase 4 não teria onde pousar as horas cedidas). A micro "Geral" atende exatamente a mesma necessidade sem nenhum desses riscos. **Recomendação: manter como está.**

**Como ficou na interface (resolvido no C2/C3):** o clique rápido na célula do grid cai na "Geral" daquele projeto (tanto para planejado quanto para realizado); o ícone de lista abre o painel lateral, que lista todas as micros (inclusive zeradas) e permite distribuir planejado e realizado entre elas. A "Geral" aparece com um rótulo "padrão" discreto. Sem impacto no modelo de dados.

---

## 6. Método de trabalho (manter)

O projeto vem sendo construído com um método que está funcionando e vale preservar:

- **Fases pequenas, testadas e aprovadas uma a uma** antes de seguir. Cada sub-bloco (B1, B2, B3, C1, D1, D2, D3-a, D3-b, C3-a, C3-b, C3-c, E1-a, E1-b, E2…) fecha com um commit, que vira um ponto de retorno seguro.
- **Operações estruturais (migrations, mudanças de schema) são mostradas ANTES de aplicar.** Gerar com `prisma migrate dev --create-only`, revisar o SQL (e o antes/depois), e só então aplicar com `prisma migrate dev`. Foi assim com as duas migrations da Fase 3.
- **Validação no navegador**, não só via API. Os testes automatizados provam a lógica; clicar na tela revela o que o plano no papel não captura. Várias melhorias (múltiplas datas de prestação, a confirmação de duplicata, o bug de fuso, a barra de saldo, o ícone do painel, o disponível sempre visível, a afordância do realizado, os rótulos do painel, a faixa de "mês fechado") surgiram exatamente assim.
- **Lógica crítica é testada isoladamente, com interface mínima, antes da interface rica.** O teto (C1), os endpoints do realizado (C3-a, copiar), o fechamento (E1-a) e o log (E2) foram provados via API/script antes de qualquer tela.
- **Concorrência exige teste de concorrência.** Bugs de corrida não aparecem em teste manual — precisam de requisições paralelas disparadas de propósito, conferindo o estado real no banco. `test-concorrencia` é re-rodado a cada mexida perto da alocação (seguiu 8/8 mesmo com a trava de fechamento e a gravação do log entrando no caminho de escrita).
- **Brainstorm com IAs externas** vale quando a decisão é estrutural, com vários caminhos defensáveis, e errar custa caro de refazer (foi assim com o design do grid — `CRITICA_DESIGN_v2.md`). NÃO vale para confirmar decisões já tomadas ou detalhes localizados, baratos de iterar (por isso C3 e a Fase 3 **não** tiveram brainstorm — invariantes travados, escolhas de UI/modelagem baratas de ajustar).

### Ruído de teste a ignorar
- Avisos de PowerShell 5.1: `Join-String` inexistente, `$pid` reservado, `ConvertFrom-Json`, `.Count`/`Measure-Object` retornando `null` em coleção de 1 item ou vazia — são da versão da máquina, não do sistema. (Geram falsos "❌"; conferir o valor real no output.)
- `EADDRINUSE` (porta ocupada) — instância anterior do servidor ainda rodando; matar processos node resolve.
- Avisos `LF will be replaced by CRLF` no git — inofensivos (Windows).
- "Código já em uso" / código não liberado ao arquivar em testes repetidos — é o teste reusando um código já criado, não um bug.
- Acento corrompido (`EFBFBD`/`U+FFFD`) vindo de teste via **PowerShell 5.1**: o PS5 manda o corpo HTTP em Latin-1, não UTF-8. O navegador sempre manda UTF-8, então **não afeta o sistema real**, e o dado sujo some no próximo restart do seed.
- Os testes de fechamento/log/remanejamento registram o usuário de coordenação como `role: 'coordenador'` (o nome real do perfil é `coordenacao`). O 403 vale assim mesmo porque vem de "não é admin/gestor", mas é um desalinhe de nome a corrigir nos testes quando der (mesmo deslize do `test-c3a`/`test-c3c` e agora dos `test-f-a/-b/-c`).

### Gotchas de ferramenta (Claude Code / ambiente)
- **Claude Code travando com "Usage credits required for 1M context"** mesmo com a cota do plano sobrando: NÃO é limite real, é um **portão de cobrança da feature de contexto 1M**. Dispara muito na **compactação**. Saídas, do mais barato pro mais caro: fixar contexto padrão (`/model` → Sonnet 4.6, ou `--model claude-sonnet-4-6`, ou `CLAUDE_CODE_DISABLE_1M_CONTEXT=1`); `/clear` se travar na compactação; atualizar o Claude Code; e, por último, ligar os créditos de uso (pay-as-you-go) em `claude.ai/settings/usage`.
- **`prisma generate` / `migrate dev` falhando com `EPERM: ... rename query_engine-windows.dll.node`:** o backend em execução está segurando o DLL do Prisma. Mate os processos node (`Get-Process -Name node | Stop-Process -Force`), rode `npx prisma generate`, e só então suba de novo. Aconteceu ao aplicar a migration da Fase 3 com o servidor no ar.
- **Editar strings acentuadas:** edite direto no arquivo (UTF-8) ou via `str_replace` buscando o texto SEM acento (ASCII puro). **NÃO escrever strings acentuadas via heredoc do PowerShell** (come os acentos).
- **O Vite não faz type-check** (o esbuild só transpila), então erros de TypeScript **não quebram o runtime** — passam despercebidos rodando a app. Rode `node_modules/.bin/tsc --noEmit` pra pegá-los; foi assim que apareceram o erro latente do tipo `Celula` (corrigido no C3-b) e os erros de `shrink` no `ProjetoDetalhe` (corrigidos em `af473ac`).
- **MariaDB `ER_CHECKREAD` (1020) em transação concorrente que insere linhas (Fase 4):** sob a isolação padrão `REPEATABLE READ`, uma **leitura com lock** (`FOR UPDATE` / `LOCK IN SHARE MODE`) sobre linhas que **outra transação inseriu e commitou depois** do snapshot atual lança `1020` ("Record has changed since last read") → 500. A correção é `isolationLevel: ReadCommitted` na `prisma.$transaction` (cada statement lê o último *committed*; o lock pessimista segue serializando). **Quando aplicar:** transação que **insere linhas sob concorrência e depois lê com lock** (foi o caso da cessão; o teto **não** precisa, porque só soma linhas que já existiam). Detalhes no §4 (Fase 4 → F-b).
- **`git commit -m @'...'@` no PowerShell quebra se a mensagem tiver aspas duplas.** O PowerShell re-divide o argumento nas aspas duplas ao passar pro `git`, e a mensagem vira vários "pathspec" (erro). O commit do G4 (`aae171c`) passou — sem aspas duplas; o da barra das Recebidas (`18964ed`) quebrou — tinha `"Yh solicitadas"` etc. **Regra:** em `git commit -m @'...'@`, **nada de aspas duplas** dentro da mensagem (use aspas simples ou nenhuma) — aí acento passa normal e sem BOM. O atalho de cair pra arquivo via `Out-File -Encoding utf8` resolve a quebra, mas o PowerShell 5.1 escreve UTF-8 **com BOM**, que entra como um caractere invisível no começo da mensagem (foi o que aconteceu no `18964ed` — cosmético, deixado como está).

---

## 7. Próximos passos (bug macro/micro → papéis → priorização → dashboards → Fase 5)

Com as **Fases 0 a 4 + a tarifa completas** e a **spec de papéis fechada** (§4-ter), a fila é:

1. **Bug de macro/micro** — defeito **atual** reportado no Manual (não apaga, não edita/exclui só a micro). Independente e rápido; começa por um **diagnóstico** (bloqueio por alocação? regressão? função faltando?). Bom candidato pra atacar **antes** do build grande.
2. **Spec de papéis (chefe/diretor) + posse + exclusão** — `Spec_Papeis_Posse_Exclusao.md`, em **6 passos** (papéis → `criadoPorId`/delegação → override do chefe → re-delegação → exclusão+lápide → telas do diretor). A decisão estrutural já passou pelo brainstorm; segue como spec. As **telas do diretor** casam com os dashboards (abaixo).
3. **Implementar a priorização** — regra fechada e aprovada (`Regra_Priorizacao.md`, resumo no §4-bis). Falta o cálculo (faixa de prazo → categoria; ordenação por horas pendentes; capacidade como sinal; override; batch diário; tabela de config) e uma tela. Estruturalmente pesada, mas a decisão difícil já passou pelo brainstorm.
4. **Dashboards (3: Geral / Projetos / Capacidade)** (pedido #5, que cresceu pra três) — juntam tudo (custos, priorização, capacidade) e são as telas do **diretor**. O mais "de produto" e caro de refazer → **merece brainstorm de IAs ao escopá-lo**, antes do primeiro prompt.
5. **Itens menores do Manual** (cargo na aba de Custos, PDF de Declaração de HT, notificação de remanejamento, datas na macro, Perfil pro tema claro, o cosmético "Continuar"→"Salvar") — encaixáveis entre os grandes; ver §4-ter.

E, em paralelo ou depois, a **Fase 5**, voltada à **coordenação** e à **escala**:

- **Visão de capacidade global da coordenação:** agregada por padrão, com drill-down sob demanda e filtros obrigatórios. A coordenação é só-leitura e hoje abre o grid vazio (não é dona de projetos) — a visão dela mora aqui.
- **Relatórios:** planejado vs. realizado, ociosidade e sobrecarga; exportação CSV; cópia de planejamento mês a mês.
- **Virtualização + navegabilidade do grid:** a escala de 200+ colaboradores × 200+ projetos exige virtualização; junto dela, resolver a navegabilidade anotada logo abaixo (rolar na horizontal, achar um projeto, achar as células com alocação).

É a fase mais "de produto" depois do núcleo — vale um desenho com calma antes do primeiro prompt, e dá pra quebrar em pedaços pequenos como sempre (ex.: a visão da coordenação primeiro, depois cada relatório, depois a virtualização). Os endpoints de leitura já existentes (grid, log) são a base; alguns vão precisar de variantes agregadas/paginadas.

> **Pré-implantação (segurança):** o `/auth/register` público **já foi fechado** (`777b37f`, ver §4-bis) — era a única pendência de **segurança** de pré-implantação, agora resolvida.

### Extra deferido da Fase 3 — Tela de histórico do log (E2-b)
A captura do log (E2) está pronta; falta a **tela** pra visualizar o histórico de uma célula (quem alterou o planejado, quando, de quanto pra quanto). Já existe o `GET /api/alocacoes/:id/log`. Ideia: um "histórico" no painel lateral da célula. Ao montar, **decidir o acesso da coordenação ao log** (hoje o endpoint é admin/gestor → 403 pra coordenação; como transparência/relatório é o papel dela, faz sentido reavaliar). Também avaliar buscar o histórico **por contexto** (colaborador+projeto+micro+mês), não só por `alocacaoId`, pra cobrir o caso de uma alocação deletada e recriada (id novo).

### Item de navegabilidade do grid — PENDENTE (Fase 5 ou polimento dedicado)
Apareceu no C2 e foi adiado. Com muitas colunas/projetos: (a) é difícil perceber que dá pra rolar na horizontal, (b) é difícil **achar um projeto específico** entre muitas colunas, (c) é difícil achar as células com alocação no meio das vazias. Tratar junto da virtualização da Fase 5 (a escala de 200+ colaboradores × projetos já exige virtualização lá). Ideias: filtro de colunas por nome/código; seletor "ir para o projeto" com scroll + flash; fixar/reordenar colunas. Decisão de UX estrutural — merece desenho com calma.

### Dívida técnica anotada (não urgente)
1. ~~No C3, reavaliar se o lock precisa cobrir atualizações de realizado.~~ **RESOLVIDA:** o realizado ficou FORA do lock (PATCH `/:id/realizado` e o `copiar-realizado` via `$executeRaw` não tocam o `alocarComLock`); o `test-concorrencia` seguiu 8/8 durante C3 e Fase 3.
2. A busca de similaridade de nome (B1) carrega todos os colaboradores e compara um a um. Para 200–300 está ótimo; só seria um problema em escala de milhares.
3. **Corrida do fechamento (TOCTOU) — adiada.** O check de "mês fechado" roda no **início** de cada caminho de escrita, mas há uma janela mínima entre o check e a escrita em que o admin poderia fechar o mês (existe nos 4 caminhos da Fase 3 e nos da cessão/Fase 4). Risco baixo e dano baixo numa ferramenta de **planejamento**. O conserto à prova de bala é um **lock de mês** em todos os caminhos de escrita — **tarefa transversal dedicada**, não pra fazer de passagem. Anotada para quando valer a pena.
4. **Otimizações de escala do remanejamento (Fase 5, se a contenção doer):** (a) trocar o lock do **colaborador** por um lock de **(colaborador, mês)** — reduz contenção, mas mexe no mecanismo já provado do teto, então só com motivo forte; (b) **denormalizar `horasJaCedidas`** numa coluna em vez de SUM derivado — hoje o SUM sob lock + índice está ótimo na escala atual.
5. A lista de **"recebidas"** (`GET /solicitacoes`) carrega as alocações do gestor e as solicitações abertas e filtra em JS — ok na escala atual, candidato a query mais enxuta na Fase 5 (mesma natureza do item 2). Há também `mesEstaFechado`/`generateId` duplicados por arquivo — vira helper compartilhado um dia (cosmético).

### Parking-lot (anotado, fora de fase — tratar quando der / antes de implantar)
- ~~**`ProjetoDetalhe.tsx`: `shrink` → `flexShrink`.**~~ **RESOLVIDO** em `af473ac`.
- ~~**Fechar o `/auth/register` público antes de implantar.**~~ **RESOLVIDO** em `777b37f`: o endpoint agora responde 403 `Registro desabilitado` (não aceita mais `role` do cliente). Era a única pendência de segurança de pré-implantação.

---

## 8. Documentos relacionados no projeto

- **`PLANO_FINAL.md`** — o plano consolidado (o "o quê" e "por quê" de todas as fases). (Obs.: o `PLANO_FINAL` rotula o realizado/comparação como "Fase 3"; aqui isso é o "C3 da Fase 2" — só diferença de rótulo. A "Fase 3" **deste** documento = fechamento mensal + auditoria, que o `PLANO_FINAL` também descreve dentro da sua "Fase 3".)
- **`ANALISE_ADAPTACAO_OBSOLETO.md`** — análise antiga, superada. **Ignorar** (premissas abandonadas: aprovação vertical, TimeEntry, projeto-gestor M:N).
- **`CRITICA_DESIGN_v2.md`** — o prompt de crítica que foi levado às IAs externas (registro do brainstorm de design do grid).
- **`Regra_Priorizacao.md`** — a regra de priorização sintetizada e aprovada (spec da implementação futura; resumo no §4-bis). Saiu do brainstorm de 4 IAs.
- **`Brainstorm_ValorHora_Categoria.md`** / **`Tarifa_Colaborador_Categoria_Spec.md`** — enunciado e spec (aprovada) da **tarifa por colaborador × categoria** (resumo no §4-bis). Saíram do brainstorm de 4 IAs.
- **`Brainstorm_Papeis_Posse_Exclusao.md`** / **`Spec_Papeis_Posse_Exclusao.md`** — enunciado e **spec** (aprovada) dos **papéis novos (chefe/diretor), posse/delegação e exclusão permanente** (resumo no §4-ter). Saíram do brainstorm de 4 IAs. É a base dos prompts dos 6 passos.
- **`Manual_Sistema_de_Alocacao.md`** — manual de uso (gerado), depois anotado pela cliente com a 2ª leva de pedidos (a base do §4-ter).
- **`PROGRESSO_E_DECISOES.md`** — este documento.
