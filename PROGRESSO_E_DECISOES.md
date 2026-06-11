# Sistema de Alocação de Equipes — Progresso e Decisões

> **Propósito deste documento.** Registro vivo do estado de execução do projeto. O `PLANO_FINAL.md` descreve *o que* construir; este documento registra *o que já foi construído*, *as decisões tomadas durante a implementação* e *como continuar*. Serve de contexto para qualquer pessoa — ou qualquer sessão futura do Claude Code — que pegar o projeto daqui em diante.
>
> **Última atualização:** fim da **Fase 3 inteira** (fechamento mensal + log de auditoria do planejado). Fases 0 a 3 completas. Próximo passo: Fase 4 (remanejamento broadcast). A telinha de histórico do log (E2-b) ficou como extra deferido — ver §7.

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

### Branches
- **`feat/alocacao-fase-1`** — Fases 0, 1 e o C1 da Fase 2 (até o commit `65aea36`).
- **`feat/alocacao-fase-2`** — Fase 2 (C2/C3) **e toda a Fase 3** (fechamento + auditoria). Todo o trabalho recente vive aqui.
- Nada foi `git push` ainda — os commits são todos locais. **Risco anotado:** sem backup externo, se a máquina morrer o trabalho some. Vale configurar um remoto/backup em algum momento.

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
- **Remanejamento (Fase 4) — modelo broadcast:** o gestor sinaliza interesse num colaborador lotado e solicita uma parcela de horas; a pendência vai a todos os gestores que têm esse colaborador; cada um pode ceder uma parcela. Prioridade por data de prestação é só visual (ordena a fila, não dá direito automático). Cessão nunca ultrapassa o pedido.

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
| **Fase 4** | Remanejamento broadcast entre gestores | ⬜ **Próximo passo** |
| **Fase 5** | Relatórios da coordenação + escala (virtualização do grid + navegabilidade — ver §7) | ⬜ Pendente |
| Transversal | Identidade visual geral | ⬜ Pendente |

> **Fases 0–3 fechadas.** Já dá pra planejar com teto protegido, operar o grid rico, lançar e comparar o realizado, **fechar/reabrir meses** e **auditar toda mudança no planejado**. Falta a colaboração entre gestores (Fase 4) e os relatórios/escala da coordenação (Fase 5).

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
- Os testes de fechamento/log registram o usuário de coordenação como `role: 'coordenador'` (o nome real do perfil é `coordenacao`). O 403 vale assim mesmo porque vem de "não é admin/gestor", mas é um desalinhe de nome a corrigir nos testes quando der (mesmo deslize do `test-c3a`/`test-c3c`).

### Gotchas de ferramenta (Claude Code / ambiente)
- **Claude Code travando com "Usage credits required for 1M context"** mesmo com a cota do plano sobrando: NÃO é limite real, é um **portão de cobrança da feature de contexto 1M**. Dispara muito na **compactação**. Saídas, do mais barato pro mais caro: fixar contexto padrão (`/model` → Sonnet 4.6, ou `--model claude-sonnet-4-6`, ou `CLAUDE_CODE_DISABLE_1M_CONTEXT=1`); `/clear` se travar na compactação; atualizar o Claude Code; e, por último, ligar os créditos de uso (pay-as-you-go) em `claude.ai/settings/usage`.
- **`prisma generate` / `migrate dev` falhando com `EPERM: ... rename query_engine-windows.dll.node`:** o backend em execução está segurando o DLL do Prisma. Mate os processos node (`Get-Process -Name node | Stop-Process -Force`), rode `npx prisma generate`, e só então suba de novo. Aconteceu ao aplicar a migration da Fase 3 com o servidor no ar.
- **Editar strings acentuadas:** edite direto no arquivo (UTF-8) ou via `str_replace` buscando o texto SEM acento (ASCII puro). **NÃO escrever strings acentuadas via heredoc do PowerShell** (come os acentos).
- **O Vite não faz type-check** (o esbuild só transpila), então erros de TypeScript **não quebram o runtime** — passam despercebidos rodando a app. Rode `node_modules/.bin/tsc --noEmit` pra pegá-los; foi assim que apareceram o erro latente do tipo `Celula` (corrigido no C3-b) e os erros de `shrink` no `ProjetoDetalhe` (corrigidos em `af473ac`).

---

## 7. Próximo passo: Fase 4 (Remanejamento broadcast entre gestores)

Com a Fase 3 fechada (fechamento + auditoria), a Fase 4 entrega a peça de **colaboração entre gestores** — o destravamento das horas, quando alguém está lotado, sem aprovação vertical. É a parte mais concorrente do sistema depois do teto.

- **Solicitação broadcast:** o gestor interessado sinaliza interesse num colaborador lotado e pede uma **parcela** de horas, com **destino** concreto (projeto + macro + micro + mês). A pendência aparece para **todos** os gestores que têm esse colaborador. Fila ordenada por data de prestação de contas — **só visual** (não dá direito automático).
- **Cessão parcial atômica:** cada cedente pode ceder uma parcela, indicando a **alocação de origem**. Dentro de transação com lock: se a soma das cessões + a nova exceder o solicitado, ajusta para o saldo e avisa; ao atingir o pedido, a solicitação **fecha atomicamente** (`atendida`).
- **Cancelamento** só enquanto `horasJaCedidas == 0`; havendo qualquer cessão, o estado final é `atendida` (mesmo parcial). Hora cedida é definitiva (não reverte o passado).
- **Tabelas novas** (ver `PLANO_FINAL.md`): `SolicitacaoRemanejamento` e `CessaoRemanejamento`.
- **Atenção:** o remanejamento mexe nas horas de alocações reais → tem de respeitar o teto, o lock **e** o fechamento mensal (não ceder/mover em mês fechado). E provavelmente deve gerar log de auditoria também.
- **Aceite:** três gestores cedendo simultâneo não estouram o pedido; as horas movem atomicamente; o cedente que tenta ceder horas já movidas falha graciosamente. (Exige teste de concorrência dedicado, como o teto.)

### Extra deferido da Fase 3 — Tela de histórico do log (E2-b)
A captura do log (E2) está pronta; falta a **tela** pra visualizar o histórico de uma célula (quem alterou o planejado, quando, de quanto pra quanto). Já existe o `GET /api/alocacoes/:id/log`. Ideia: um "histórico" no painel lateral da célula. Ao montar, **decidir o acesso da coordenação ao log** (hoje o endpoint é admin/gestor → 403 pra coordenação; como transparência/relatório é o papel dela, faz sentido reavaliar). Também avaliar buscar o histórico **por contexto** (colaborador+projeto+micro+mês), não só por `alocacaoId`, pra cobrir o caso de uma alocação deletada e recriada (id novo).

### Item de navegabilidade do grid — PENDENTE (Fase 5 ou polimento dedicado)
Apareceu no C2 e foi adiado. Com muitas colunas/projetos: (a) é difícil perceber que dá pra rolar na horizontal, (b) é difícil **achar um projeto específico** entre muitas colunas, (c) é difícil achar as células com alocação no meio das vazias. Tratar junto da virtualização da Fase 5 (a escala de 200+ colaboradores × projetos já exige virtualização lá). Ideias: filtro de colunas por nome/código; seletor "ir para o projeto" com scroll + flash; fixar/reordenar colunas. Decisão de UX estrutural — merece desenho com calma.

### Dívida técnica anotada (não urgente)
1. ~~No C3, reavaliar se o lock precisa cobrir atualizações de realizado.~~ **RESOLVIDA:** o realizado ficou FORA do lock (PATCH `/:id/realizado` e o `copiar-realizado` via `$executeRaw` não tocam o `alocarComLock`); o `test-concorrencia` seguiu 8/8 durante C3 e Fase 3.
2. A busca de similaridade de nome (B1) carrega todos os colaboradores e compara um a um. Para 200–300 está ótimo; só seria um problema em escala de milhares.

### Parking-lot (anotado, fora de fase — tratar quando der / antes de implantar)
- ~~**`ProjetoDetalhe.tsx`: `shrink` → `flexShrink`.**~~ **RESOLVIDO** em `af473ac`.
- **Fechar o `/auth/register` público antes de implantar.** Hoje o endpoint de registro é público e aceita o `role` vindo do cliente (é o que permite os testes se registrarem como gestor/coordenador/admin). Em produção isso é um buraco: qualquer um se cadastra como `admin`. Travar antes do deploy (só admin cria usuário, ou role não-setável pelo cliente). **Prioridade alta na pré-implantação.**

---

## 8. Documentos relacionados no projeto

- **`PLANO_FINAL.md`** — o plano consolidado (o "o quê" e "por quê" de todas as fases). (Obs.: o `PLANO_FINAL` rotula o realizado/comparação como "Fase 3"; aqui isso é o "C3 da Fase 2" — só diferença de rótulo. A "Fase 3" **deste** documento = fechamento mensal + auditoria, que o `PLANO_FINAL` também descreve dentro da sua "Fase 3".)
- **`ANALISE_ADAPTACAO_OBSOLETO.md`** — análise antiga, superada. **Ignorar** (premissas abandonadas: aprovação vertical, TimeEntry, projeto-gestor M:N).
- **`CRITICA_DESIGN_v2.md`** — o prompt de crítica que foi levado às IAs externas (registro do brainstorm de design do grid).
- **`PROGRESSO_E_DECISOES.md`** — este documento.
