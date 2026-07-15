# Sistema de Alocação de Equipes — Progresso e Decisões

> **Propósito deste documento.** Registro vivo do estado de execução do projeto. O `PLANO_FINAL.md` descreve *o que* construir; este documento registra *o que já foi construído*, *as decisões tomadas durante a implementação* e *como continuar*. Serve de contexto para qualquer pessoa — ou qualquer sessão futura do Claude Code — que pegar o projeto daqui em diante.
>
> **Última atualização:** **Planejamento Inteligente de Equipe — COMPLETA (F0→F6 no ar).** A cliente redefiniu a prioridade (03/07): a dor central é validar as horas alocadas contra a receita necessária do mês (a "meta de apropriação de HT") e montar equipe pra cobrir o déficit. Toda a fila anterior (passo 6 dos papéis, priorização, dashboards, Fase 5) foi **estacionada**. A feature inteira está construída e validada pela cliente: a **metade financeira (F0→F3** — posse na escrita, campos do projeto, motor de meta com cascata simétrica, tela da Meta de Apropriação) e o **motor de sugestão (F4→F6** — núcleo do motor read-only, orquestração multi-mês, wizard com matriz editável, aplicação célula a célula). Tudo no GitHub, `feat/alocacao-fase-2`, ~18 commits (`3310d02` → `33e885f`), ver **§4-septies**. O `alocarComLock`/teto de 220h seguem **intocados** — a aplicação em massa passa pelo `POST /alocacoes` existente, célula a célula. Fontes da verdade: `Spec_Planejamento_Inteligente.md` **v1.4** (financeira) e `Spec_Motor_Sugestao_F4.md` **v1.0** (motor). Próximo: pendências de design/UX levantadas pela cliente e a fila estacionada — ver §7.
>
> **Estado do código e do banco (importante pra próxima sessão):** código em **`d3f4aba`** (último: sincronização da spec v1.4), tudo pushed. Schema e banco **coerentes** — as migrations da feature (`f1_campos_financeiros_projeto`, `f2b_i_pino_meta_mensal`) aplicadas via `migrate deploy` sem reset. `tsc` limpo nos dois lados. **Entidades novas da feature:** 5 campos financeiros em `projetos` (valor_total, valor_oficial, estrategia_oficial, vigencia_inicio, vigencia_fim) e a tabela `meta_mensal_ajustes` (os pinos). Dependência nova no frontend: `react-number-format` (máscara de moeda). **Gotcha recorrente:** backend zumbi pegou 2× nesta frente (reiniciar do diretório errado → processo velho na :3001 servindo código antigo; o /api/health responde ok mesmo assim) — sempre reiniciar de `backend/` e provar que é o processo novo.

> **Os 5 passos da spec de papéis** estão fechados e no GitHub: **(1)** papéis `chefe` e `diretor` + `requireRole` tipado (`cae3015`); **(2)** `criadoPorId` no projeto + delegação na criação (`6861e87`); **(3)** override do chefe nas rotas de operação, teto provado sob concorrência chefe×gestor (`c07d6c7`); **(4)** re-delegação — chefe troca o `gestorId` + auditoria (`c5342d4`); **(5)** exclusão permanente — cascata + lápide + as 4 rotas do fluxo (`2e807d6` schema+cascata, `af2cbb3` rotas+conserto). Tudo provado por teste de API (papéis 11/11, delegação 16/16, override 15/15 + concorrência 8/8, re-delegação 23/23, cascata 36/36, fluxo 53/53).

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

> **Parcialmente implementado:** a `Spec_Papeis_Posse_Exclusao.md` (§4-ter) adiciona **`chefe`** (cria/delega projetos, opera qualquer projeto, aprova exclusão, **também** fecha/reabre mês) e **`diretor`** (leitura executiva, só dashboards), mantendo os três acima. **Os passos 1–5 já estão feitos** (papéis, delegação, override, re-delegação, exclusão permanente — backend COMPLETO, ver §4-ter): o `chefe` já loga e opera no backend. Falta só o passo 6 (as **telas** do chefe e do diretor + dashboards — hoje os dois papéis ainda não têm frontend próprio). A lista acima descreve os três papéis originais; chefe/diretor entram pela §4-ter.

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
| **Pós-demo (1ª leva)** | Preparo do demo, custos, programas de fomento, **tarifa por colaborador × categoria**, regra de priorização, **dashboard Projetos** — ver §4-bis e §4-sexies | 🟡 Custos + programas + **tarifa** ✅; **priorização P1** ✅ (`996f271`); **dashboard Projetos** ✅ (`83ccc4b`, `89b9bc6`); dashboards Geral e Capacidade pendentes |
| **Pós-demo (2ª leva — Manual)** | Papéis novos (chefe/diretor) + delegação + exclusão permanente, bug macro/micro, e itens menores — ver §4-ter | 🟡 **Bug macro/micro ✅** (`acb3383`, `21b44ec`) + painel na célula vazia (`1a2b7bb`); **spec de papéis: passos 1–5 ✅** (`cae3015`, `6861e87`, `c07d6c7`, `c5342d4`, `2e807d6`, `af2cbb3`), **só o passo 6 (frontend) pendente**; **itens menores ✅**: Perfil tema claro (`be7848b`), GET /categorias pra chefe+diretor (`4f08a44`), Cargo em Custos (`0dc3cc7`) |
| **Área de atuação** | Entidade administrável + FK no colaborador + telas — **construída e REVERTIDA** | ⏪ **Revertida** (decisão de produto — ver §4-quater). Código de volta em `0dc3cc7`; 4 commits salvos em `backup/areas-atuacao-58e3f20` |
| **Profissão** | Entidade **plana** que **substitui** a `funcao` + montar equipe por profissão no grid (filtro, faixa de candidatos, alocação inline) — ver §4-quinquies | ✅ **Completa** (`f2395e0`, `e64e6ce`, `cece63c`, `887ac75`, `892721a`, `a8582be`, `efe1317`, `087d61c`, `e2e56ac`, `3f3e9d7`) |
| **Planejamento Inteligente** | Feature COMPLETA (F0→F6): meta de apropriação de HT (campos + meta mensal + cascata + tela) e motor de sugestão de equipe (motor read-only + wizard + aplicação) — ver §4-septies | 🟢 **F0→F6 ✅ (feature completa, validada pela cliente)** — financeira `3310d02`,`1b06ead`,`2047c71`,`9728b4e`,`58b49ec`,`f48dc50`,`aa9fd39`,`29a243f`; motor `d95b233`,`e172f5c`,`6769f94`,`1c36c29`,`7fb89e3`,`33e885f` (+ spec `294c299`, cenários `00c1fc9`, fixes `04e5e7c`) |
| **Priorização P1 + menu + dashboard Projetos** | `calcularPriorizacao()` exportada; menu N1/N2; tela Prioridades; grupo Painéis — ver §4-sexies | ✅ **Completos** (`7179587`, `5f1260e`, `44c45b1`, `996f271`, `83ccc4b`, `89b9bc6`) |
| Transversal | Identidade visual geral | ✅ Reforma clara aplicada no preparo do demo (`c378876`, `db44f99`) |

> **Fases 0–4 + tarifa + passos 1–5 dos papéis fechados.** A **2ª leva de pedidos** (via o `Manual`) tem **todo o backend estrutural implementado** — **papéis chefe/diretor, delegação, override, re-delegação e exclusão permanente** (passos 1–5, §4-ter), com o bug de macro/micro já corrigido (`acb3383`, `21b44ec`) e o arrumo no grid (`1a2b7bb`). O que falta na spec de papéis: só o **passo 6** (as telas do chefe e do diretor + dashboards — frontend). Depois dela: a **priorização** (regra fechada), os **dashboards (3)**, e a **Fase 5**.

### Credenciais de teste (do seed)
| Papel | E-mail | Senha |
|-------|--------|-------|
| Admin | `admin@sistema.dev` | `admin123` |
| Chefe | `chefe@sistema.dev` | `chefe123` |
| Diretor | `diretor@sistema.dev` | `diretor123` |
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
- Entidade Colaborador: `nome`, `email` (único), `profissaoId` (FK → `profissoes`; era `funcao?` string até a feature Profissão — §4-quinquies), `ativo`, auditoria.
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

### A peça estrutural — papéis, posse e exclusão (**passos 1–4 ✅, 5–6 pendentes**)
A organização real é **diretor → chefe → gestores** (antes só havia `admin`/`gestor`/`coordenacao`). Como mexe na autorização de quase toda tela e na posse dos projetos (decisão cara de refazer), **passou por brainstorm de 4 IAs** → virou a **`Spec_Papeis_Posse_Exclusao.md`** (decisões batidas com a cliente). Resumo travado (o que foi efetivamente construído nos passos 1–4 está no bloco logo abaixo):
- **Enum plano de 5 papéis:** `admin`, `chefe`, `gestor`, `coordenacao`, `diretor`. `admin` e `chefe` **separados** (técnico vs. negócio), mas **ambos fecham/reabrem mês** (a cliente não quis depender de uma só pessoa; e gestor individual não fecha, porque é ação **global**). `coordenacao` (leitura operacional) e `diretor` (leitura executiva, só dashboards) **coexistem**.
- **Posse:** mantém `gestorId` como **dono operacional** (NÃO renomear — preserva a lógica do grid) + novo `criadoPorId`. Chefe **cria e delega** (`gestorId` = delegado, `criadoPorId` = chefe). Chefe **opera qualquer projeto** (autoriza se `user === gestorId` OU `papel === chefe`), pelo **mesmo `alocarComLock`** (sem atalho — o teto segue protegido). **Re-delegar** = trocar `gestorId` + auditoria; **alocações/histórico não mudam**.
- **Exclusão permanente** (caso "criei sem querer"): **status no projeto** (`pendente_exclusao` + `exclusaoSolicitadaPorId` + motivo), **não** entidade nova. **Bloqueia se houver ALOCAÇÃO** ("virgem" = zero alocações); a estrutura auto-criada (micros → macros → prestações) é apagada junto, **cascata explícita na transação** (FKs seguem `RESTRICT`). `pendente_exclusao` **recusa novas alocações** (mesmo padrão do "mês fechado", fecha a janela de corrida). **Lápide** (`projeto_excluido`) gravada **antes** do delete. **Código liberado pra reuso** após o hard delete (decisão **(a)** da cliente — reverte o "código preso"; a lápide, com data, guarda o histórico). Gestor dono pede, chefe aprova (ou exclui direto). **(Passo 5 — ainda não implementado.)**
- **Diretor:** só dashboards (endpoints agregados **próprios**, não o grid com parâmetros omitidos) — entra junto do trabalho de dashboards. **(Passo 6.)**
- **Ordem (6 passos):** (1) papéis + migração + `requireRole` ✅; (2) `criadoPorId` + delegação na criação ✅; (3) override do chefe (mesmo lock; **teste de concorrência chefe×gestor**) ✅; (4) re-delegação ✅; (5) exclusão + lápide ⬜; (6) telas do diretor/dashboards ⬜.

#### O que foi construído — passos 1–4 (branch `feat/alocacao-fase-2`)

Backend puro, cada passo provado por teste de API (.mjs), no método de sempre (pequeno, testado, commit + push; migration mostrada antes de aplicar). **A frente de frontend dos novos papéis — telas do chefe e do diretor — foi deliberadamente adiada pro fim** (passo 6): construir a tela do chefe antes da visibilidade completa deixaria um estado pela metade, e a própria spec põe o frontend no passo 6.

**Passo 1 — papéis `chefe` e `diretor`** (`cae3015`)
- **Descoberta que dispensou migração:** `User.role` é `String VARCHAR(50)`, **não um enum de banco** — então adicionar papéis é só código, sem `ALTER TABLE`. (O ponto 1 da seção "Migração" da spec, que previa `MODIFY COLUMN` no enum, não se aplicou.)
- `PAPEIS` (const) + `Papel` (type) viraram a **fonte única** dos 5 papéis em `backend/src/middleware/auth.ts`, e o `requireRole(...)` foi apertado de `(...roles: string[])` pra `(...roles: Papel[])` — agora **um papel digitado errado vira erro de compilação**. As 32 chamadas existentes de `requireRole` compilaram limpas (nenhum typo latente). O check em runtime é idêntico (só mudou o tipo; o JS gerado é o mesmo) → os papéis atuais não mudaram de comportamento.
- Seed (`db.ts`) ganhou 1 `chefe` e 1 `diretor` (credenciais na tabela do §3). Sem FK nova, ordem de limpeza intocada.
- Nenhuma rota mudou: nesse ponto, chefe e diretor logam mas tomam 403 em tudo (o acesso vem nos passos seguintes). Teste `test-papeis.mjs` **11/11**.

**Passo 2 — `criadoPorId` + delegação na criação** (`6861e87`)
- Migration `add_criado_por_projeto` (`20260621175245`): adiciona `criadoPorId` (FK User = quem criou) ao projeto, **mantendo `gestorId`** (= dono operacional, **não renomeado**, pra preservar toda a lógica de grid). A migration foi **editada à mão pro backfill na ordem segura**: `ADD COLUMN ... NULL` → `UPDATE projetos SET criado_por_id = gestor_id` → `MODIFY ... NOT NULL` → `ADD FOREIGN KEY ... ON DELETE RESTRICT`. (O Prisma gerou a versão sem backfill e avisou que quebraria nas linhas existentes; a reescrita resolveu.) As duas relações Projeto→User (`gestor` e `criadoPor`) ganharam **nomes** pra não colidir, com back-references no `User`.
- `POST /projetos`: `criadoPorId = req.user.id` **sempre**. O `gestorId` depende do papel: **gestor** cria só pra si (qualquer `gestorId` no corpo é **ignorado**); **chefe/admin** podem **delegar** passando `body.gestorId` (validado como usuário com role `gestor` de verdade — senão **400**) ou **manter pra si** omitindo o campo. `requireRole` da rota era `('admin','gestor')` → virou `('admin','gestor','chefe')` (nada removido). Os 4 endpoints de projeto passaram a expor `criadoPor` (id + nome). Seed grava `criadoPorId = gestorId`.
- **Decisão travada:** chefe que cria **sem** indicar delegado fica como dono ele mesmo (re-delega depois, no passo 4) — não se força a delegação na criação. Teste `test-delegacao.mjs` **16/16**.

**Passo 3 — override do chefe nas rotas de operação** (`c07d6c7`)
- **Investigação primeiro (mapa rota a rota), depois mudança.** O mapa revelou que **o padrão em todo lugar é `role === 'gestor' && não-dono → 403`** — ou seja, a checagem de dono **só bloqueia gestor**; admin (e qualquer outro papel) já passa. Então o chefe **não precisou de nenhum `OU papel === chefe` adicionado**: como `chefe !== 'gestor'`, ele já bypassa as checagens de dono naturalmente, igual ao admin. Investigar evitou espalhar bypass desnecessário por ~15 lugares.
- A mudança foi só **adicionar `chefe` ao `requireRole`** das rotas de operação: alocações (`POST /`, `PATCH /:id/realizado`, `DELETE /:id`, `POST /copiar-realizado`); as 6 de macros; projetos (`PUT /:id` e `PATCH /:id/status`). Em `copiar-realizado`, a condição de escopo virou `admin || chefe` (cobre **todos** os ativos, como o admin; gestor segue só os dele). O `requireOwner` de macros e as checagens de dono **não** foram tocados. **O `alocarComLock` não foi tocado** — o teto é recalculado dentro do lock independentemente de quem chama, então o chefe **não fura o teto**.
- Provas: `test-chefe-override.mjs` **15/15** (chefe aloca/edita/gerencia macro num projeto que não é dele; coordenação e diretor seguem 403); `test-concorrencia-chefe.mjs` **8/8** (chefe × gestor em paralelo no mesmo colaborador/mês somando > 220h → só um passa, total nunca passa de 220); `test-concorrencia.mjs` original **8/8** (sem regressão no lock).

**Passo 4 — re-delegação** (`c5342d4`)
- Migration `add_redelegacao_log` (`20260622004948`, aditiva): tabela **`redelegacoes`** no padrão do `alocacao_logs` — `projetoId`/`gestorAnteriorId`/`gestorNovoId` são **colunas simples sem FK** (contexto denormalizado que **sobrevive à exclusão do projeto** no passo 5); só `redelegadoPorId` tem FK pra `users` (`RESTRICT`). Índice em `(projetoId)`. **Sem campo de motivo** — re-delegação é administrativa, de baixo atrito (distinto da exclusão, que grava motivo); se a cliente pedir, é coluna nullable aditiva depois.
- Rota `PATCH /projetos/:id/redelegar`, body `{ gestorId }` (novo dono), **`requireRole('chefe')` apenas — admin toma 403** (decisão proposital: posse é do chefe, não do técnico). Valida **tudo antes de mover**: projeto existe (404); `status === 'ativo'` (400 — não re-delega arquivado nem `pendente_exclusao`); `gestorId` presente e é um gestor de verdade (400, mesma validação do passo 2); `gestorId !== dono atual` (400, no-op). A troca do `gestorId` + a gravação da linha em `redelegacoes` vão numa **transação atômica** (nunca troca sem logar, nunca loga sem trocar). **Não toca alocações, histórico nem o `alocarComLock`.**
- **Invariante provado no banco:** a alocação do projeto continua **intacta** após a re-delegação (mesmas horas, mesmo `projetoId`, mesmo macro/micro) — o único efeito é o projeto **sair do grid de um gestor e entrar no do outro** (testado nos dois sentidos via `GET /grid`). Teste `test-redelegacao.mjs` **23/23** (re-delega ok; auditoria com o de/para certo; alocação intocada; troca de grid; 403 pra gestor e admin; 400 pra não-gestor/mesmo-dono/arquivado; 404 pra inexistente).

**Passo 5 — exclusão permanente + lápide** (`2e807d6` schema+cascata, `af2cbb3` rotas+conserto)

> ⚠️ **A "regra de virgem" da spec foi REVERTIDA por decisão da cliente.** A `Spec_Papeis_Posse_Exclusao.md` dizia "bloquear a exclusão se houver qualquer alocação". Na implementação, a cliente decidiu o **oposto**: **nada bloqueia por alocação** — a alocação vira um aviso e a **cascata apaga tudo junto** (mesmo padrão do apagar-macro-cascata `21b44ec`). O **único bloqueio** que sobrou é **mês fechado**. Onde a spec e este documento divergirem sobre exclusão, **vale este documento**.

Construído em 4 sub-passos (5a schema → 5b cascata → 5c rotas → 5d conserto), backend puro, cada parte provada por teste de API. **O `alocarComLock`, o `alocacoes.ts` e o `remanejamento.ts` ficaram intocados** — projeto pendente opera normalmente, e a cascata reconta tudo na hora da aprovação.

- **Schema (5a, migration `add_exclusao_permanente` `20260622101544`, aditiva):** soma o valor **`pendente_exclusao`** ao `status` do projeto (sem `ALTER`/`MODIFY` na coluna — é só um valor novo aceito na aplicação) + `exclusaoSolicitadaPorId` (FK User null) + `motivoExclusao` (Text null, **opcional**). **Tabela-lápide `projeto_excluido`**, gravada **antes** do delete: `codigo` **SEM unique** (o código volta a ficar livre pra reuso — a lápide, com data, guarda o histórico de que existiu, possivelmente mais de uma vez), contexto denormalizado **sem FK** nos campos `*_original` (sobrevive ao delete), só `solicitante` (null no excluir-direto) e `aprovador` (sempre presente) apontam pra `users` `RESTRICT`. **Conserto do 5d (migration `add_status_anterior_exclusao` `20260622113319`, aditiva):** coluna `statusAnteriorExclusao` (String null) — ver o ponto de recusa abaixo.
- **Cascata (5b, `backend/src/lib/exclusaoProjeto.ts` — módulo novo, padrão do `lib/tarifa.ts`):** duas funções. **`precheckExclusao(projetoId)`** classifica `nao_encontrado` / `mes_fechado` (lista os meses distintos com alocação que estão fechados) / **excluível** (conta alocações + horas). **Mês fechado tem precedência:** se há alocação em mês fechado, retorna o bloqueio **sem** oferecer a contagem. **`executarExclusaoCascata(projetoId, {solicitanteId, aprovadorId, motivo})`** roda numa **transação interativa** que **re-valida tudo sob `tx`** (projeto existe, mês fechado — re-checado com a própria `tx`, fecha a janela de corrida) **antes de apagar nada**; para cada alocação grava log **`removeu`** (formato exato do `DELETE /alocacoes/:id`) e apaga — **1:1, nenhuma alocação some sem log** (invariante da Fase 3 mantido); depois **micros → macros → prestações → grava a lápide (retrato) → apaga o projeto**. Mês fechado lança **`ExclusaoBloqueadaError`** (classe identificável) → a transação aborta, **nada é apagado**.
- **Mês fechado barra a exclusão SEM exceção de papel.** Decisão da cliente: gestor **e** chefe tomam o bloqueio se houver alocação em mês fechado. O chefe consegue excluir porque ele **reabre o mês primeiro** (ação separada — ele fecha/reabre mês) e aí a cascata roda limpa. **Não** há "modo chefe que fura o fechamento" — o invariante "ninguém escreve em mês fechado" fica **intacto** (era a opção (b); a (a), de furar, foi rejeitada).
- **As 4 rotas do fluxo (5c, em `projetos.ts`):**
  - `POST /:id/solicitar-exclusao` (`requireRole('gestor')`): **só o dono** solicita (senão 403); **arquivado é solicitável** (decisão da cliente — só rejeita se já `pendente_exclusao`, 409); grava `pendente_exclusao` + `exclusaoSolicitadaPorId` + `motivoExclusao` (opcional) + `statusAnteriorExclusao = status atual`.
  - `POST /:id/aprovar-exclusao` (`requireRole('chefe')`): só se `pendente_exclusao` (senão 409); chama `precheckExclusao` → mês fechado vira **409 com a lista de meses** ("reabra primeiro"); se ok, dispara a cascata com `solicitanteId = exclusaoSolicitadaPorId` (quem pediu), `aprovadorId = o chefe`.
  - `POST /:id/recusar-exclusao` (`requireRole('chefe')`): só se `pendente_exclusao` (senão 409); **restaura `status = statusAnteriorExclusao ?? 'ativo'`** e limpa os campos de exclusão.
  - `DELETE /:id/excluir-direto` (`requireRole('chefe')`): exclui **qualquer** projeto sem precisar de pedido; se já estava `pendente_exclusao`, **preserva** o `solicitanteId` e o motivo do pedido na lápide; senão `solicitanteId = null`.
- **Conserto "recusar-desarquiva" (5d):** antes, `recusar` devolvia o status **sempre** a `'ativo'` — então um projeto que era **arquivado** antes do pedido era reativado indevidamente ao ser recusado. A coluna `statusAnteriorExclusao` (gravada no solicitar, restaurada no recusar, com `?? 'ativo'` de rede de segurança) resolve: arquivado recusado **volta a arquivado**. (A cliente preferiu consertar agora em vez de aceitar a simplificação.)
- **Código liberado pra reuso:** como o projeto é hard-deleted e `projeto_excluido.codigo` não tem unique, recriar um projeto com o mesmo código depois funciona (sem 409) — provado em teste.
- **Decisões travadas:** motivo **opcional** na solicitação e no excluir-direto; lápide **sem** unique no código (reuso); **sem gate novo de alocação** em projeto pendente (a cascata reconta na aprovação, então não precisa bloquear alocação no meio — foi a 3ª decisão da cliente, que dispensou o gate que a spec previa).
- **Testes:** `test-exclusao-cascata.mjs` **36/36** (cascata completa, logs `removeu` sobrevivem com horas certas, lápide com retrato certo, código reusável sem 409, mês fechado bloqueia pré-check e execução com nada apagado) + `test-exclusao-fluxo.mjs` **53/53** (os 4 caminhos do fluxo, guardas de papel 403/409, arquivado solicitável, arquivado recusado volta a arquivado, mês fechado bloqueia a aprovação). *(O teste da cascata importa o módulo `.ts` direto via `node --import tsx/esm`.)*


### Bugs reportados no Manual (a tratar)
- ~~**Macro/micro não apaga; não dá pra editar/excluir só a micro**~~ — **RESOLVIDO** (`acb3383`, `21b44ec`). Diagnóstico: o **backend estava correto e completo**; os dois bugs eram **só no frontend** (`ProjetoDetalhe.tsx`) — o `deleteMacro()` **engolia o erro do backend em silêncio** (macro com alocação ficava na lista sem aviso, parecendo "não apaga"), e a **edição de micro nunca tinha sido implementada** (a rota `PUT .../micros/:id` já existia). Conserto (`acb3383`): `deleteMacro` passou a checar `res.ok` e mostrar a mensagem do backend, e foi adicionada a edição de micro (lápis + modal, no mesmo padrão da macro). **Em cima disso**, a cliente pediu **apagar a macro mesmo com alocação** (em vez de só bloquear) → **cascata com confirmação** (`21b44ec`, Opção A): a 1ª chamada é um **pre-check** que devolve a contagem de alocações/horas **sem apagar**; só `?confirmar=true` apaga, numa **transação** que remove cada alocação (gravando log `removeu`, reusando o formato do `DELETE /alocacoes/:id`) → micros → macro. **Mês fechado bloqueia** o apagar (alocação em mês fechado é read-only — a macro só apaga depois de o mês reabrir). Owner-check intacto (gestor-dono/admin; coordenação 403); FKs seguem `RESTRICT` (deleção explícita e ordenada). A tela mostra **um único `confirm`** (com a contagem quando há alocações). Testado: `backend/test-apagar-macro-cascata.mjs` **35/35**.
- ~~**Perfil com cores ruins / ilegível**~~ — **RESOLVIDO** (`be7848b`): a tela de Perfil era dark-first (`text-white`, `bg-white/5`, inputs transparentes) e quebrava no tema claro. Trocada pelos tokens do tema e classes utilitárias que o resto da app já usa (`var(--text-1/2/3)`, `.card`, `.form-input`, `.btn-brand`, `.btn-ghost`) — mesmo padrão do Login. Conserto 100% cosmético (nome/senha/avatar intocados). Validado no navegador nos dois temas.

### Decisões de nomenclatura / produto resolvidas
- **Nomenclatura da classificação do projeto = "Programas"** (a cliente confirmou; **cancela** a ideia anterior de renomear pra "Categorias"). A entidade interna segue `CategoriaProjeto` (só nome de código).
- **"Excluir projeto" = excluir de vez** (não arquivar), via pedido do gestor + aprovação do chefe — é o fluxo de exclusão permanente acima.

### Itens menores / melhorias (fila)
- ~~**`GET /api/categorias` não inclui `chefe` no `requireRole`**~~ — **RESOLVIDO** (`4f08a44`): o GET de listagem passou a aceitar `chefe` e `diretor` (`requireRole('admin','gestor','coordenacao','chefe','diretor')`). Só a leitura mudou — POST/PATCH (escrita) seguem restritos a admin/gestor. Testado por API (chefe/diretor 200; coordenação segue 200; chefe POST segue 403). Remove a pendência que estava marcada como iminente pro passo 6.
- **Remanejamento do chefe — DEFERIDO** (decisão de UX pendente, anotada no passo 3): o passo 3 **não** mexeu em `remanejamento.ts` — o chefe segue **403** lá. A cessão hoje é "o gestor cede as horas **dele**" (a rota `minhas-do-colaborador` devolve as alocações do próprio gestor); pro chefe, que não "tem" projetos no sentido de `gestorId`, **não está claro de onde ele cederia**. Precisa de uma decisão de UX antes de implementar. Sem isso, nada quebrado.
- **Admin ainda cria projeto:** o `requireRole` do `POST /projetos` é `('admin','gestor','chefe')` — o passo 2 só **acrescentou** chefe, não removeu admin. O item do Manual "admin não precisa criar projeto" segue **em aberto** (ajuste de permissão — confirmar o exato com a cliente).
- ~~**Coluna de cargo na aba de Custos**~~ — **RESOLVIDO** (`0dc3cc7`): "cargo" = o campo `funcao` que existia então. Adicionado ao `GET /api/relatorios/custos` (no select do colaborador que já era carregado) e à tabela de Custos no frontend, coluna entre Colaborador e Horas, com fallback "—". Sem tocar a agregação/somas/escopo. Validado no navegador. *(Atualização: com a feature Profissão — §4-quinquies — essa coluna passou a ler `profissao.nome` no lugar de `funcao`; o campo da resposta de Custos foi renomeado de `funcao` pra `profissao`. A coluna continua intitulada "Cargo".)*
- **Gerar PDF de Declaração de HT da equipe por mês** (template editável pelo gestor) — a cliente vai mandar o template; fica pro fim.
- **Notificação de solicitações de remanejamento** (dá pra reusar a infra de push do legado). *(O `notificationService.ts` tem um `role: { in: ['admin','coordenacao'] }` hardcoded pro broadcast de notificação — se chefe/diretor devem receber, decidir aqui.)*
- **Data de início/fim por período em cada macro-entrega** (campos novos na macro).
- **Hierarquia de visualização de dashboards/relatórios em PDF** — casa com o diretor + dashboards.
- **Campo "área de atuação" no colaborador** — **construído e REVERTIDO** (ver §4-quater). A cliente quer que as **profissões sejam organizadas por área** (hierarquia Área → Profissão), não um campo solto. Decisão de escopo pendente com a cliente antes de retomar; os 4 commits ficam em `backup/areas-atuacao-58e3f20`.

### Cosmético (resolvido)
- ~~**"Continuar" → "Salvar"** no botão do cadastro de colaborador~~ — **RESOLVIDO** (`460df17`): o botão diz "Salvar" (consistente com a edição); a confirmação de "parecido" no fluxo de duplicata segue igual.

---

## 4-quater. "Área de atuação" do colaborador — CONSTRUÍDA e REVERTIDA

> **Resumo:** uma feature inteira foi construída, testada, aprovada no navegador e **commitada** (4 commits), e depois **revertida por decisão de produto** quando a cliente esclareceu o que realmente queria. Não é trabalho perdido — está preservada na branch `backup/areas-atuacao-58e3f20` e o aprendizado está registrado aqui. Esta seção existe pra que uma sessão futura **não reconstrua a feature do zero sem antes ler isto** (saber o que já existe, por que saiu, e qual o problema de modelagem a resolver com a cliente).

### O que foi pedido e construído
A cliente pediu um campo **"área de atuação"** no colaborador. Decidiu-se: **lista administrável** (clone do padrão de Programas/`CategoriaProjeto`), **obrigatória** na aplicação. Foi construída em 3 passos (A, B, C), todos validados e commitados:
- **Passo A** (`8c2de65`): entidade `AreaAtuacao` (id cuid, nome unique, ativo) + CRUD em `/api/areas-atuacao` (clone fiel de `categorias.ts`: fluxo de duplicata idêntico/parecido, GET liberado pros 5 papéis, escrita admin/gestor) + 6 áreas no seed (Desenvolvimento, Design, Dados, Infraestrutura, Gestão, Conteúdo). Teste 22/22.
- **Passo B** (`32afd11`): FK `colaborador.areaAtuacaoId` (nullable no banco, obrigatória na app, molde do `categoriaId` do projeto: POST exige, PUT preserva se omitida). GETs expõem `areaAtuacao {id,nome}`. Seed: ordem invertida (área antes de colaborador na criação, depois na limpeza), 30 colaboradores com área por função. Teste 21/21 (provou que editar só o nome preserva área E tarifas — sem regressão).
- **Passo C1** (`b934c3a`): tela de gestão `/areas` (clone de Programas) + item no menu (ícone Briefcase, `gestorOrAdmin`). Validado no navegador (criar/renomear/ativar-desativar/aviso de parecido).
- **Passo C2** (`58e3f20`): seletor de área obrigatório no form do colaborador (clone do seletor de programa do projeto: mostra a atual mesmo se inativa, só reenvia se mudou) + exibição na lista. Validado no navegador.

### Por que foi revertida
Depois do C2, a cliente esclareceu: **"as profissões fazem parte das áreas"** — ex.: "programador faz parte de Sistemas". Ou seja, ela **não** queria a área como campo solto do colaborador; queria uma **hierarquia Área → Profissão**, onde a área *organiza as profissões* e o colaborador aponta pra uma **profissão** (a área vem por transitividade). Isso é uma mudança de modelo, não um ajuste — `funcao` (hoje string) viraria entidade `Profissao` com FK pra área, e o colaborador trocaria `areaAtuacaoId` por `profissaoId`.

Rodou-se um **brainstorm de 4 IAs** (enunciado completo na conversa que gerou esta seção): todas convergiram no mesmo modelo (Área → Profissão → Colaborador; Profissão como lista administrável; FKs RESTRICT; área derivada, não armazenada; seletor agrupado por `<optgroup>` no form) e nas mesmas recomendações pros pontos de produto (funcao some / tudo obrigatório / 1:N). 

**A cliente, porém, decidiu DESISTIR da área por enquanto** ("era apenas para organizar, mas está dando dor de cabeça demais e resultados de menos; depois vejo o que é mais importante"). Daí a reversão ao estado pré-área (`0dc3cc7`).

### Aprendizado a NÃO perder — o conflito função×área
Antes de fechar a spec do modelo novo, rodou-se um **diagnóstico** (script `diag-funcao-area.mjs`, somente leitura) cruzando o par `(funcao, areaAtuacaoId)` que cada colaborador já tinha — porque esse par É "esta função pertence a esta área". O resultado **no seed** (30 colaboradores): **4 de 7 funções aparecem em mais de uma área** — "Desenvolvedor" em Desenvolvimento/Infraestrutura/Dados, "Motion Designer" em Design/Conteúdo, "Redatora" em Conteúdo/Gestão, "Social Media" em Conteúdo/Gestão. 

**Ressalva importante:** esse conflito no seed foi em boa parte **artefato do seed** (o passo B distribuiu colaboradores pelas áreas de propósito pra "usar todas as 6 áreas"), não necessariamente um retrato da organização real. **Mas o conflito é estruturalmente possível** — então qualquer modelo 1:N futuro (uma profissão pertence a uma área só) **precisa de uma regra explícita** pro caso "mesma profissão, áreas diferentes": ou nome composto ("Desenvolvedor – Dados" como profissões distintas), ou a área mais frequente vence + loga os desviantes, ou a cliente define o mapa função→área na mão. **Quem decide o mapa real é a cliente, não o seed.** Esse é o ponto a resolver com ela antes de retomar.

### Como foi revertida (referência técnica)
Reversão limpa, código + banco, com salvaguarda:
1. **Branch de backup** `backup/areas-atuacao-58e3f20` criada apontando pro C2 e empurrada pro GitHub (preserva os 4 commits).
2. **`git reset --hard 0dc3cc7`** na `feat/alocacao-fase-2` + **force-push** (os 4 commits da área saem da branch de trabalho; o reset apagou também os arquivos das 2 migrations da área do disco).
3. **`prisma migrate reset --force`** (com o gate de consentimento do Prisma) — apagou o banco e reaplicou só as **14 migrations** em disco (sem a área), repovoando via seed. Verificado direto no banco: 14 migrations / `areas_atuacao` não existe / `area_atuacao_id` não existe. *(Nota: o `prisma migrate status` dessa versão (6.19.2) NÃO sinaliza o descompasso de "migration aplicada mas ausente do disco" — foi preciso checar `_prisma_migrations` direto. Não confiar cegamente no texto da CLI.)*
4. Validado: backend sobe, seed repovoa sem mencionar áreas, `tsc` limpo nos dois lados (sem referência órfã), `/api/areas-atuacao` → 404, `/api/colaboradores` sem o campo `areaAtuacao`. Tela de Colaboradores sem o seletor, menu sem o item Áreas.

### Para retomar (se/quando a cliente decidir)
- Recuperar de `backup/areas-atuacao-58e3f20` (ou reconstruir) — mas o modelo provavelmente muda pra **Área → Profissão → Colaborador** (não a área-direta que estava na backup).
- **Decisão de produto pendente com a cliente:** (1) o mapa função→área (como resolver os conflitos); (2) `funcao`-string sai ou coexiste; (3) profissão/área obrigatórias?; (4) 1:N confirmado. O brainstorm de 4 IAs já desenhou o "como" técnico — falta a cliente cravar o "o quê".

### Resíduo de limpeza (não urgente)
- Scripts de diagnóstico `diag-funcao-area.mjs` e `diag-macro-micro.mjs` seguem **untracked** no `backend/` — `del` quando conveniente.
- O `prisma/seed.ts` (órfão, importa `@prisma/adapter-mariadb` não instalado) falha no `migrate reset` — **não é o seed real** (que é `initDb()` em `db.ts`, via `server.ts`). Falha pré-existente e inócua; remover/consertar um dia.

---

## 4-quinquies. Feature "Profissão" — entidade plana + montar equipe por profissão no grid (COMPLETA)

> **Resumo:** a `funcao`-string do colaborador virou uma entidade **Profissão** administrável e **plana** (sem área, sem hierarquia, sem ramos), e em cima dela foi construído o recurso de **montar equipe por profissão direto no grid**. É a continuação — e a versão que deu certo — da "área de atuação" revertida (§4-quater): cortar os **ramos** (a hierarquia Área→Profissão, que tinha explodido) foi o que tornou a feature viável e pequena. Tudo na `feat/alocacao-fase-2`, no método de sempre (pedaços pequenos, testados, commit + push; migrations mostradas antes; UI validada por print). Spec da parte do grid: **`Spec_Candidatos_Por_Profissao.md`** (saiu de brainstorm de 4 IAs). O `alocarComLock` e o teto de 220h **intocados**.

### Por que "plana" (a lição da área)
A área de atuação foi revertida porque a cliente queria **profissões organizadas por área** (hierarquia Área→Profissão), e os "ramos" viravam sessão atrás de sessão, fugindo do escopo (§4-quater). A decisão aqui foi **cortar os ramos**: Profissão é uma **lista administrável simples** (clone do padrão de Programas/`CategoriaProjeto`), igual a área já era — só que **substitui** a `funcao` em vez de ser um campo a mais. Sem área, o conflito "mesma profissão em áreas diferentes" desaparece. As features que o gestor realmente queria (filtrar e montar equipe por profissão) **não precisam dos ramos** — só precisam que a profissão seja um valor consistente. Os dados eram **fictícios/seed** (sem dado real da cliente), então **não houve migração de dados** — o seed reconstrói do zero com 20 profissões-padrão.

### Passos 1–3 — a entidade Profissão substituindo `funcao`

**Passo 1 — entidade + CRUD + tela + seed** (`f2395e0`)
- Migration `add_profissao` (aditiva): `CREATE TABLE profissoes` (`id` cuid, `nome` unique, `ativo`) — sem FK, espelho do `areas_atuacao` da backup.
- `backend/src/routes/profissoes.ts` (montado em `/api/profissoes`): clone do molde de `categorias`/`areas` — mesma função de similaridade (Levenshtein 30%), GET liberado pros 5 papéis, POST/PATCH admin/gestor, fluxo de duplicata (exato → 409; parecido → `needsConfirmation` 200). POST devolve `{ profissao }` embrulhado; PATCH direto.
- `frontend/src/pages/Profissoes.tsx` (clone da tela de Programas, ícone IdCard) + rota `/profissoes` + item no menu (gestor/admin).
- **Fix de scroll:** a tela clonada tinha `overflow: hidden` no wrapper da lista, que zerava o min-height do item flex e **cortava** a lista (não rolava) com 20+ itens. Removido → rola igual à de Colaboradores. (Mesmo bug latente existe na tela de Programas, só não aparece com 5 itens — anotado.)
- Seed: 20 profissões-padrão (`prof-*`, cargos de inovação/tech/pesquisa). **Colaborador/`funcao` intocados** nesse passo. Teste `test-profissoes.mjs` **23/23**.

**Passo 2 — substituir `funcao` por `profissaoId` (backend)** (`e64e6ce`)
- Migration `replace_funcao_with_profissao`: `ADD profissao_id` (VARCHAR nullable) + FK `RESTRICT` pra `profissoes`, e **DROP da coluna `funcao`** na mesma migration (dados fictícios, seed reconstrói — **sem backfill**). `profissaoId` nullable no banco mas **obrigatória na app** (molde do `categoriaId`). *(O `migrate dev --create-only` travou pelo gate de perda de dados — 30 valores não-nulos em `funcao`; contornado com `migrate diff` gerando o SQL e o arquivo montado à mão, idêntico ao que o `--create-only` geraria.)*
- Religados **todos** os pontos que usavam `funcao`: `colaboradores.ts` (selects dos GETs, validação obrigatória no POST, preserva-se-omitida no PUT, objeto `similares` passa a expor `profissao.nome`), `relatorios.ts` (a coluna **Cargo** de Custos passa a ler `profissao.nome` — campo da resposta renomeado de `funcao` pra `profissao`), e **`alocacoes.ts`** (2 selects que o mapa inicial não pegou — **o `tsc` os caçou** depois do DROP). Seed: 30 colaboradores ganham `profissaoId` mapeado; **ordem invertida** (profissões antes de colaboradores na criação, colaboradores antes de profissões na limpeza, por causa do RESTRICT). Filtro `?funcao=` removido. Teste `test-colaborador-profissao.mjs` **24/24** (inclui não-regressão: editar só o nome preserva profissão **e** tarifas).

**Passo 3a — frontend usa profissão** (`cece63c`)
- `Colaboradores.tsx`: removido o bloco inteiro da `funcao` (lista `FUNCOES_COMUNS`, `customFuncao`, `effectiveFuncao`, a opção "Outra (personalizada)") e posto um seletor de Profissão obrigatório (molde do seletor de programa). `Custos.tsx`: coluna Cargo lê `profissao` (título "Cargo" mantido). `GridAlocacao.tsx` e `Alocacoes.tsx`: o subtítulo da linha do colaborador / o select de colaborador exibiam `funcao`, agora `profissao.nome` — **achados pelo `tsc`, não pelo mapa**. `tsc` limpo, zero `funcao` no frontend.

**Passo 3b — atalho de criar profissão no form** (`887ac75`)
- Botão "+ Nova" ao lado do seletor, abre um **mini-modal** que cria profissão sem sair do form, consumindo o mesmo `POST /api/profissoes` e **replicando o fluxo de duplicata** (decisão: não deixar duplicata entrar sem aviso). **Renderizado como irmão** do modal do colaborador (não aninhado), então o clique no backdrop do mini-modal não propaga pro de baixo. Estados isolados (`novaProf*`) — o form do colaborador (campos já digitados) sobrevive intacto. Ao criar, a profissão é adicionada localmente + já fica selecionada + refetch em background.

**Combobox reutilizável** (`892721a`)
- `frontend/src/components/Combobox.tsx` — componente **genérico** (props `options`/`value`/`onChange`/`placeholder`/`disabled`/`required`, não sabe nada sobre profissão), feito na mão sem lib. Substituiu o `<select>` nativo de profissão (com 20+ itens, caçar numa lista nativa é chato; agora digita e filtra). Filtro ignora acento/caixa; clique-fora via listener de `mousedown` no document com ref no container, e as opções usam `onMouseDown`+`preventDefault` (não `onClick`) pra seleção acontecer antes do blur; teclado (setas/Enter/Escape) com o item destacado rolando à vista via `scrollIntoView({ block: 'nearest' })`; opção inativa marcada e ainda selecionável; dropdown `position: absolute` + `maxHeight` + `overflowY: auto` + z-index acima do modal. Como o select custom não honra `required` nativo, a obrigatoriedade virou checagem explícita no submit. **Reutilizável** — candidato a substituir o select de Programas e outros depois.

### Passo 4 — montar equipe por profissão no grid

**4b — filtro de profissão no grid** (`a8582be`)
- Combobox de profissão no topo do grid (reusa o componente) que **esconde** as linhas de colaboradores que não são da profissão — filtro **client-side**. Backend: `GET /colaboradores` ganhou `?profissaoId=` (uma linha no `where`) que alimenta este filtro **e** a busca de adicionar colaborador. Frontend: `linhasExibidas` (useMemo derivado de `todasLinhas`) alimenta só o `.map` do tbody — `todasLinhas` continua intacto alimentando saldo/contadores, então **nenhum cálculo de teto/saldo foi tocado**. O total do rodapé (`custoPorProjeto`) vem pronto do backend sobre todos os colaboradores, então já é o valor **real**, alheio ao filtro. Contador "X de N"; caso vazio com aviso; botão limpar. Teste `test-colaborador-filtro-profissao.mjs` **7/7**.

> **Mudança de objetivo descoberta no 4b:** o filtro de *esconder* (4b) não era o que o gestor queria de verdade — ele queria **ver quem NÃO está nos seus projetos pra alocar** (montar equipe). Isso virou uma decisão estrutural (muda o que o grid mostra, reabre escala 200+) → **brainstorm de 4 IAs** → `Spec_Candidatos_Por_Profissao.md`. O 4b ficou como a base (o combobox de profissão) e complemento (filtrar os alocados por profissão é útil junto da faixa).

**Decisões da spec (do brainstorm + gestor):** a query do grid **não muda** (candidatos vêm de endpoint novo separado — consenso unânime das 4 IAs); profissão é **pré-requisito obrigatório** (limitador de escala nº 1); faixa de candidatos **no próprio grid**, abaixo dos alocados (não painel lateral — mantém o contexto das colunas-projeto); escala por **limite fixo (20) + esconder quem está em 220h** (`disponivel > 0`), ordenado por horas livres desc, sem paginação (quem quer um nome fora do top usa o picker de busca); alocar candidato passa pelo **mesmo `POST /alocacoes`/lock/teto** (consenso unânime); disponibilidade calculada **em lote** (não N+1); rodapé/saldo intocados. "Concorrência fantasma" (o saldo do candidato mudou enquanto ele esperava) é **aceita, não é bug** — é o lock funcionando (409 + refetch).

**4c-backend — endpoint de candidatos** (`efe1317`)
- `GET /api/alocacoes/candidatos?profissaoId=&ano=&mes=` (admin/gestor), **só leitura**. Lista colaboradores ativos da profissão que o gestor **não alocou** naquele mês, com disponibilidade. Reusa o **mesmo `projWhere`** do grid (escopo gestor/admin) pra montar a exclusão, a **mesma fórmula Decimal** do saldo e a constante `TETO_HORAS_MES` (não redefine 220, não reimplementa o saldo). Agregação **em lote** (2 queries, não N+1): exclusão + soma das alocações dos candidatos. Filtra `disponivel > 0`, ordena desc, corta em `MAX_CANDIDATOS = 20`. Teste `test-candidatos.mjs` **17/17** — parâmetros escolhidos **inspecionando o seed real** pra isolar os dois critérios de exclusão (Caso A: exclui quem eu já aloquei, e quem é de outro gestor NÃO some; Caso B: exclui quem está em 220h, isolado da posse — Enzo cheio por *outros* gestores some por teto, não por ser meu).

**4c-frontend — a faixa de candidatos (exibição)** (`087d61c`)
- Faixa abaixo do rodapé de custo, **só** quando há profissão filtrada (senão nem entra no DOM). Implementada como uma **segunda `<table>` irmã** (não dentro do tbody dos alocados), usando o **mesmo `<colgroup>`** (mesmas larguras) e o mesmo container de scroll — então as colunas ficam **pixel-alinhadas** com as de alocados **por construção**, e as colunas Colaborador/Saldo ficam sticky igual. Cada linha-candidato: nome + email, a `BarraSaldo` reusada (alimentada com saldo sintético — `totalMeusProj` 0 porque por definição nunca aloquei o candidato, `disponivel` do backend), células de projeto. Estilo **desidratado** (opacidade menor, bordas tracejadas vs sólidas) — distinção nas colunas sticky. Estados: loading, vazio (aviso distinto do 4b), lista. **Nada de cima tocado.**

**4c-alocar — alocar candidato pela faixa** (`e2e56ac`)
- Botão "+ Alocar" (hover) nas células dos candidatos abre o **mesmo `Drawer`** de alocação, com `celula: null` (mesmo valor de célula vazia de alocado) — sem ramificação condicional, o Drawer não sabe que é candidato. Grava pelo **mesmo `POST /alocacoes`** (lock/teto). Sucesso → refetch grid (vira alocado) + refetch faixa (some dos candidatos). 409 → novo callback `onBlocked` refaz só a faixa.

**4d — alocação inline na célula do candidato + fix de ressync** (`3f3e9d7`)
- A célula do candidato passa a usar o **mesmo componente `CelulaEditavel`** dos alocados (decisão do gestor: "o mais parecido possível com o grid normal"). A investigação confirmou que o `CelulaEditavel` **não tem acoplamento** com o colaborador já estar no grid — opera só com as props. Então a célula do candidato ganha **de graça**: clique vira input, Enter/blur grava na Geral, "máx Xh", popover de bloqueio 409, **e o botão de remanejamento** (que já estava no componente — por isso o "passo 4e" pedido pelo gestor já estava pronto sem código novo). O ícone de painel continua pro macro/micro detalhado. `defaultMacro/Micro` da Geral vem **por projeto** (não por colaborador), então o candidato tem acesso igual.
- **Fix de ressync (bug achado pelo gestor):** alocar um candidato e depois **zerar** as horas fazia ele sumir de tudo (nem candidato nem alocado) até dar F5. Causa: o `CelulaEditavel` é renderizado em **dois pontos** — a linha do candidato (religada ao `fetchCandidatos` no 4d) e a **linha real/alocada** (que só chamava `fetchGrid`). Quando o candidato vira alocado, a célula dele passa a ser renderizada pelo ponto das linhas reais; zerar ali nunca refazia a faixa. Conserto: religar os callbacks das linhas reais (`onSaved`/`onSavedSilent`/`onBlocked`) pra também chamar `fetchCandidatos` (no-op seguro sem profissão filtrada). O timing já estava certo (callbacks após o `await`).

### Estado da feature Profissão
**Completa de ponta a ponta.** O gestor: cadastra profissões (tela própria ou atalho no form do colaborador), atribui ao colaborador (combobox com busca), filtra o grid por profissão, vê os **candidatos** daquela profissão (com disponibilidade), e os aloca **inline na célula ou pelo painel** — com o mesmo comportamento do grid normal (teto, lock, bloqueio 409, remanejamento). 10 commits: `f2395e0` (passo 1), `e64e6ce` (passo 2), `cece63c` (3a), `887ac75` (3b), `892721a` (combobox), `a8582be` (4b), `efe1317` (4c-backend), `087d61c` (4c-frontend), `e2e56ac` (4c-alocar), `3f3e9d7` (4d). Testes de API: profissões 23/23, colaborador-profissão 24/24, filtro 7/7, candidatos 17/17.

### Resíduo anotado (não urgente)
- A tela de **Programas** tem o mesmo bug latente de scroll (`overflow: hidden` no wrapper) — só não aparece com 5 itens; mesmo fix se aplicaria. E o **Combobox** novo é candidato a substituir o `<select>` de Programas (e outros) num passo de polimento futuro.
- O `test-colaborador-area.mjs` da backup virou molde do `test-colaborador-profissao.mjs` — os testes da área seguem só na branch `backup/areas-atuacao-58e3f20`.

---

## 4-sexies. Priorização P1, reorganização do menu e dashboard Projetos (branch `feat/alocacao-fase-2`)

> **Resumo:** em sequência à feature Profissão (`3f3e9d7`) e ao bloco de tarifa (§4-bis, último commit `d1dd8df`), esta sessão fechou três frentes em 5 commits, sem nenhuma migration nova: (1) **priorização P1** — o cálculo da `Regra_Priorizacao_reconstruida.md` virou `calcularPriorizacao()` exportada, provado em 25/25 testes sem alterar a resposta HTTP; (2) **reorganização do menu lateral** em 3 commits (remoção de Alocações, agrupamento em seções, visibilidade fina por papel); (3) **dashboard de Projetos D1+D2** — endpoint enriquecido que reutiliza o cálculo do P1 e a lib de tarifa, e a tela Prioridades. O `alocarComLock` e o teto de 220h **seguem intocados**.

### a) Priorização P1 — cálculo + endpoint (`996f271`)

A `Regra_Priorizacao.md`/`Regra_Priorizacao_reconstruida.md` definia a regra; faltava o código. O P1 implementa o cálculo **sem UX própria**, sem batch diário, sem override manual (ficam pra P2).

**O que foi construído:**
- `backend/src/routes/priorizacao.ts` reestruturado: a lógica saiu do handler e virou **`calcularPriorizacao({role, userId, ano, mes}): Promise<CalcularPriorizacaoResult>`**, exportada. O handler chama a função e devolve só `itens` — **a resposta HTTP de `GET /api/priorizacao` é idêntica à anterior** (regressão zero; provada nos 25/25 testes). O campo `categoriaId` do projeto é selecionado internamente mas **não vaza na resposta do endpoint**.
- **`CalcularPriorizacaoResult`** expõe quatro membros para o dashboard reutilizar sem query nova: `itens` (lista ordenada), `categoriaIdPorProjeto` (Map projeto→categoria, para resolver a tarifa certa no custo), `colabsPorProjeto` (Map projeto→Set de colabIds, para `tamanhoEquipe`), `alocsDoMes` (alocações brutas do mês, para custo e horas).
- **Regra de categorização:** prazo da próxima prestação → `alta` (vencida ou ≤7 dias) / `media` (8–30) / `baixa` (>30) / `sem_prazo` (sem data). Dentro de cada categoria, ordena por `horasPendentes` desc (planejado − realizado; sem realizado → usa o planejado inteiro). `sinalCapacidade` = `true` quando ≥95% do teto mensal — **só um flag, não afeta a ordenação** (conforme a regra: "sinal exibido, não fator de ordem").
- **Escopo por papel:** gestor vê só seus projetos ativos; admin/chefe/coordenação/diretor veem todos (mesma lógica do grid).
- `backend/test-priorizacao.mjs` **25/25** ✅.

### b) Reorganização do menu lateral — três commits

Tudo em `frontend/src/components/Layout.tsx`. Cada commit validado no navegador antes de fechar.

**`7179587` — remove a tela Alocações do menu**
- A rota `/alocacoes` era redundante com `/grid` (mesmo backend, mesmo lock). Removida do menu. **A rota `/alocacoes` foi mantida como redirect → `/grid`** para não quebrar favoritos/links salvos. `Alocacoes.tsx` segue no disco, desconectado da navegação ativa (não importado por ninguém).

**`5f1260e` — menu agrupado em seções (N1)**
- Estrutura de lista plana → 2 níveis: `NavLeaf | NavGroup`, com `isNavGroup()` como type guard. Grupos **sempre expandidos** (sem estado abrir/fechar — decisão deliberada: o menu é curto, toggle seria atrito desnecessário). Grupos criados: **Operação** (Grid + Remanejamento), **Painéis** (placeholder, recebe item no D2), **Cadastros** (Colaboradores + Programas + Profissões). Itens soltos: Início, Projetos, Custos, Equipe. Cabeçalho do grupo some se todos os seus itens forem invisíveis pro papel atual.

**`44c45b1` — visibilidade por papel (N2)**
- Substitui 2 flags binários (`adminOnly` / `gestorOrAdmin`) por `roles?: Role[]` por item — cobrindo os 5 papéis com precisão. `type Role = 'admin' | 'chefe' | 'gestor' | 'coordenacao' | 'diretor'`; `isItemVisible`: `roles` ausente → todos 5 veem; presente → filtro de inclusão.
- **Tabela de visibilidade resultante:** Grid (admin/chefe/gestor/coordenação); Remanejamento (admin/chefe/gestor); Projetos (admin/chefe/gestor/coordenação); Custos (admin/chefe/gestor); **Prioridades/Painéis** (todos 5 — inclusive diretor, que por ora só vê Início e Painéis); Colaboradores (admin/chefe/gestor/coordenação); Programas/Profissões (admin/chefe); Equipe (Usuários) (admin).

**Decisão de rótulos de papel (`ROLE_LABELS`) — tomada, implementação estacionada:** o footer da sidebar exibe `user?.position || user?.role`, então um diretor vê `"diretor"` (código interno). A decisão: mapa **fixo no código**, sem tela de configuração — `'chefe' → 'Coordenação'`, `'coordenacao' → 'Consulta'`, `'diretor' → 'Gerência'` (candidato, vindo do manual da cliente), `'admin' → 'Administrador'`, `'gestor' → 'Gestor'`. Implementação estacionada atrás do Planejamento Inteligente de Equipe (ver §7 — Estacionados).

**Nota sobre chefe em Projetos/Colaboradores:** chefe aparece nessas telas pela visibilidade N2, mas elas usam `canWrite = role === 'admin' || role === 'gestor'` internamente — chefe não consegue criar/editar pela UI. O backend permite, a UI não expõe. Inconsistência a corrigir no passo 6.

### c) Dashboard Projetos — D1 (endpoint) + D2 (tela + grupo Painéis)

**D1 — endpoint (`83ccc4b`)**
- Novo arquivo `backend/src/routes/dashboards.ts`, montado em `/api/dashboards` em `server.ts`. Endpoint `GET /api/dashboards/projetos?ano=&mes=` com `requireRole` abrindo para todos os 5 papéis.
- **Chama `calcularPriorizacao()`** e obtém os 4 resultados sem query duplicada ao banco. Depois faz **uma query extra em lote** (`colaborador.findMany` para `valorHora`) e chama `carregarTarifas(colabIds)` + `resolverTarifa()` de `lib/tarifa.ts` — a **mesma resolução de tarifa do relatório de Custos**, escopada ao mês do dashboard (não o acumulado de `/relatorios/custos`, que é ALL-TIME sem filtro de mês).
- **Loop único sobre `alocsDoMes`** acumula `horasPorProjetoColab` (Map de Maps: projeto→colab→horas) e `horasRealPorProjeto` (soma das realizadas não-nulas), sem query nova. Depois calcula `custoPorProjeto` iterando os Maps × tarifas. A resposta é `itens.map(...)` preservando a **ordem de priorização** do P1.
- `horasRealizadas: null` = nenhuma micro do projeto tem apontamento no mês ("sem apontamento", distinto de "0h"). `custoPlanejado: null` = nenhum colaborador tem tarifa resolvível (defensivo; com padrão obrigatório, na prática não ocorre).
- `backend/test-dashboard-projetos.mjs` **17/17** ✅ (tamanhoEquipe correto; custoPlanejado prova `carregarTarifas`/`resolverTarifa`; ordem = mesma da priorizacao; escopo gestor vs admin).

**D2 — tela Prioridades (`89b9bc6`)**
- `frontend/src/pages/Prioridades.tsx` — nova página, rota `/prioridades`. Busca em `[token, ano, mes]`.
- **`frontend/src/components/SeletorMes.tsx`** — componente **extraído** para ser compartilhado pelas novas páginas (botões ◀▶ + select de mês + input de ano). O `GridAlocacao.tsx` **não foi tocado** — tem sua cópia local `SeletorMes` interna. **Dívida técnica** (ver §7).
- Tabela: ordem + `BadgeCategoria` (alta=vermelho, média=âmbar, baixa=verde, sem_prazo=cinza, inline por item, sem componente novo); código+nome; porquê; próxima prestação (vermelha se `alta`); horas planejadas; horas realizadas (`null` → `"sem apontamento"` em cinza-suave); custo planejado; equipe (contagem); sinal de capacidade (`AlertTriangle` em `<span title="...">` — title direto no componente Lucide gera erro TS, envolvê-lo em `<span>` resolve).
- Grupo **Painéis** adicionado ao menu com o item Prioridades (sem `roles` → todos 5 papéis).
- `frontend/src/App.tsx`: rota `/prioridades` adicionada.
- `tsc --noEmit` limpo nos dois lados; `test-priorizacao` 25/25 e `test-dashboard-projetos` 17/17 passando.

### d) Tarifa por colaborador × categoria — fechamento do bloco (`d1dd8df`, anterior a esta sessão)

O bloco de tarifa (§4-bis) fechou antes desta sessão com a **tela de edição de overrides** (`d1dd8df`): form do colaborador ganhou o campo de valor-hora padrão (obrigatório) no topo + seção "Tarifas por categoria" com as categorias ativas (em branco = usa o padrão). Blindagem anti-apagar-override: Salvar desabilitado enquanto as tarifas carregam; se o `GET :id` falhar, o PUT omite `tarifas` (backend preserva os overrides existentes). Esse é o último commit antes dos trabalhos desta sessão em P1/N1/N2/D1/D2.

**Confirmado por `git log --oneline -25`:** não há commit de tarifa entre `3f3e9d7` (profissão 4d) e `996f271` (P1) — os dois aparecem adjacentes no log. O "ajuste de tarifas" desta sessão é o próprio `d1dd8df`, já registrado em §4-bis.

---

## 4-septies. Planejamento Inteligente de Equipe (COMPLETA — F0→F6 no ar, validada pela cliente)

**A virada de prioridade (03/07/2026).** A cliente redefiniu a prioridade: a dor central não é dashboard/acesso, é que **as horas alocadas não são validadas contra a receita necessária do mês**. O sistema garante o teto, mas não diz se as horas de um mês geram receita suficiente pra cobrir as despesas daquele mês (a "meta de apropriação de Horas Técnicas"). Toda a fila anterior (passo 6 dos papéis, priorização estrutural, dashboards, Fase 5) foi **estacionada**; esta virou a frente ativa. Fonte da verdade: **`Spec_Planejamento_Inteligente.md` v1.4** (no projeto). Concebida via brainstorm de 4 IAs + várias iterações com a cliente.

**O modelo, confirmado pela cliente (03/07 14h34).** O projeto informa **3 números** (vigência, valorTotal, valorOficial) e o sistema **deriva** a meta mensal — SEM cadastro de despesas mês a mês (a cliente matou isso: "o cronograma é resultado, não origem"). `valorHT = valorTotal − valorOficial` (só o que depende de apropriação de HT; o oficial é pago direto pelo financiador). A meta de cada mês é computada sob demanda (medição uniforme − distribuição do oficial), nunca materializada — mesma filosofia da priorização/dashboards.

**A feature inteira (visão) — TODA FEITA.** Metade **financeira** (meta de apropriação — F0→F3): cadastrar os valores do projeto, ver/ajustar a meta mensal com cascata, validar cobertura. Metade **motor** (sugestão de equipe — F4→F6): dado o déficit da meta, o sistema sugere quem alocar (camadas fixados→equipe-atual→externos, consumindo R$ por mês), o gestor revisa numa matriz editável e aplica pelas escritas guardadas, célula a célula. O ciclo fecha ponta a ponta: **meta → sugestão → aplicação → meta atualizada** (a receita sobe, o déficit cai). A cliente testou e aprovou.

**O que está FEITO (backend provado por teste, frontend por print; tudo na `feat/alocacao-fase-2`, pushed):**

- **F0 — Posse na escrita de alocação** (`3310d02`). O furo: `POST/PATCH/DELETE` de alocação não validavam dono — qualquer gestor operava projeto alheio via API (a UI restringia, o teto/lock seguiam seguros). Pré-requisito de segurança da feature (a aplicação em massa não pode nascer herdando o furo). Pré-check `role==='gestor' && projeto.gestorId!==userId → 403` (chefe/admin passam), ANTES da transação/lock. Remanejamento escreve por fora das rotas de alocação (Prisma direto, posse já validada nas duas pontas) — não afetado, confirmado por `test-concorrencia-cessao` 8/8. `test-posse-alocacao` 12/12; os 3 testes de concorrência 8/8 (portão do teto intacto). Também abateu dívida: corrigido o setup dos testes de concorrência (payload obsoleto sem profissaoId/valorHora).

- **F1 — Campos financeiros do Projeto** (`1b06ead`). Migration aditiva (mostrada antes de aplicar): `valor_total`/`valor_oficial` DECIMAL(10,2) nullable, `estrategia_oficial` VARCHAR default 'inicial', `vigencia_inicio`/`vigencia_fim` DATE nullable (não existiam). `estrategiaOficial` é string-constante (não enum Prisma — segue o padrão da casa). POST/PUT validam os 5 campos (oficial>total rejeitado; PUT só processa financeiros se ao menos um vier — preserva ao editar). Frontend: seção Financeiro no form + resumo no detalhe (HT derivado = total−oficial; "—" quando null). **Máscara de moeda:** `react-number-format` (`^5.4.5`), edição livre (selecionar/colar/cursor no meio), entrega número puro (`floatValue`) ao form. O `InputMoeda` virou wrapper fino disso (a versão manual estilo caixa-eletrônico foi substituída — engessava a edição).

- **F2a — Cálculo da meta mensal** (backend, read-only) (`2047c71`). `GET /api/projetos/:id/meta-apropriacao` (posse manual como GET /:id). Por mês: medição (valorTotal÷nº meses), oficialAlocado (por estratégia: 'inicial' esgota nos primeiros meses / 'proporcional' reparte igual), metaHT (medição−oficial), receitaPlanejada (**reusa `carregarTarifas`/`resolverTarifa` de `lib/tarifa.ts` — a MESMA conta do custoPlanejado do dashboard**), deficit. Projeto sem dados → `{configurado:false}`. **Precisão exata:** o ÚLTIMO mês absorve o resíduo de arredondamento → soma(medição)=valorTotal, soma(oficial)=valorOficial, soma(metaHT)=valorHT EXATO ao centavo (invariante testado sem margem). Tudo Prisma.Decimal. `test-meta-apropriacao` 46/46.

- **F2b-i — Persistência do pino** (sem cascata) (`9728b4e`). Migration aditiva: entidade `MetaMensalAjuste` (projetoId FK onDelete Cascade, ano, mes, metaHT Decimal(10,2), UNIQUE(projetoId,ano,mes)) — segue o padrão de PrestacaoContas. Esparsa: só onde o gestor pinou. `PUT /:id/meta-apropriacao/pino {ano,mes,metaHT}` (upsert; valida metaHT≥0, mês na vigência, mês não fechado) e `DELETE .../:ano/:mes`. O GET lê: `metaHTFinal = pino ?? calculado`; cada mês indica `pinado`. Estado intermediário honesto: `somaMetaHT` + `cascataPendente:true` quando há pino e a soma não fecha. `test-pino-meta` 27/27.

- **F2b-ii — Cascata simétrica** (backend, computada sob demanda no GET) (`58b49ec`). O algoritmo mais delicado da feature. Princípio único da cliente: **nunca criar/piorar déficit automaticamente**. Meses editáveis = não-fechados E não-pinados (fechados via `FechamentoMensal`, 1 query batch). Ao pinar o mês M: **LIBERAR** (pino abaixo→sobra saldo): distribui aos editáveis COM DÉFICIT, proporcional ao déficit; sem déficit em nenhum → `saldoNaoPlanejado` reportado. **PUXAR** (pino acima→falta saldo): retira dos editáveis COM FOLGA, proporcional à folga, com TETO na folga (nunca reduz abaixo da receita); folga total insuficiente → `precisaDecisaoManual` reportado. Método: **proporcional-com-teto iterativo** (o mês que estoura a cota é capado e sai, o excedente realoca). Soma fecha EXATO após a cascata (último mês ajustado absorve resíduo). **Correção na revisão:** o CC implementou PUXAR como greedy (drena maior folga primeiro), mas a cliente especificou proporcional; o teste inicial mascarou a diferença (caso onde coincidem) — reescrito pra proporcional + teste que os separa (12k/12k puxar 10k → 5k/5k, não 10k/0). `test-cascata-meta` 87/87.

- **F3a — Seção "Meta de Apropriação" no detalhe** (leitura) (`f48dc50`). Tabela mês/medição/oficial/metaHT/receita/déficit + seletor de estratégia (persiste via PUT ao trocar; a estratégia é decisão do gestor) + resumo (valorHT, somaMetaHT). Estado neutro pra `configurado:false`. Déficit em vermelho; badges pin/fechado. Validado por print: soma=632.000 nas duas estratégias, mês parcial da inicial (32.000,01), resíduo no último mês, troca não corrompe valores.

- **F3b — Edição inline + cascata na tela** (`aa9fd39`). Coluna Meta HT editável (hover→lápis→input com máscara→Enter→PUT pino→refetch→a tabela reflete a cascata). Despino (o `×`→DELETE pino→volta ao automático). Indicador de mês ajustado pela cascata (badge `ajust.` âmbar, distinto de `pin`/`fechado`). Só meses não-fechados editam. Validado por print com projeto de déficits desiguais: pinar Jan liberando saldo → os editáveis sobem PROPORCIONAL ao déficit (meses com receita sobem menos), soma continua = valorHT.

- **F3c — Avisos dos estados-limite** (`29a243f`). Os dois estados que a F2b-ii reporta viram banners: `saldoNaoPlanejado` (banner azul informativo, "R$ X disponíveis, todos os meses já atingiram a meta"); `precisaDecisaoManual` (banner âmbar de alerta, "faltam R$ Y", + Soma Meta âmbar). SEM botões de ação — a UI de decisão manual (escolher meses/forçar déficit/cancelar) é fase futura; aqui só o aviso. Condicionais (os campos só vêm no JSON quando o estado é ativo → somem ao despinar). Validado por print com os dois números exatos (âmbar faltam 2.000, azul 2.000 disponíveis).

**O motor de sugestão (F4→F6) — o coração da feature.** Concebido via brainstorm de 4 IAs, sintetizado em `Spec_Motor_Sugestao_F4.md` v1.0 (`294c299`). Decisões travadas da spec: ordenação por **disponibilidade DESC + id ASC** (tarifa NUNCA ordena — tem dois ótimos contraditórios, ordenar por ela seria política de negócio disfarçada de algoritmo); **waterfall** guloso (enche cada pessoa antes da próxima, não round-robin; freio = máxHoras); **blocos de 4h** com `floorBloco` no teto da pessoa e `ceilBloco` no alvo (fecha o déficit por cima, sobra pequena reportada); **mínimo de 8h** pra novo entrante (duas regras: teto < 8h pula + diagnóstico; alvo < 8h entra com 8h + sobra); **promoção intra-execução** (quem o motor escolhe no mês M entra na camada 2 de M+1 na mesma execução); **fluxo unidirecional com a cascata** (o motor consome o déficit do estado atual da meta, NUNCA escreve meta nem dispara cascata — proibido iterar até ponto fixo).

- **F4a — núcleo do motor, UM mês** (backend, read-only) (`d95b233`). `POST /api/projetos/:id/sugestao-equipe` (posse do GET da meta; gestor não-dono → 403). **Extração mecânica** do cálculo de déficit pra `lib/metaApropriacaoCalc.ts` — o GET da meta passa a chamá-lo e o motor importa (zero duplicação; portão anti-regressão: os 3 testes da meta re-rodados passam idênticos, 46/27/87). Reusa a disponibilidade em lote do grid (`TETO_HORAS_MES=220`), `carregarTarifas`/`resolverTarifa` (exceções por categoria; sem tarifa → fora + aviso). `test-motor-sugestao` 64/64, com os casos que SEPARAM: **waterfall provado** (2 externos folga igual, déficit cabe em 1 → menor id leva tudo, outro 0h; round-robin daria 50/50 — o inverso do teste da cascata proporcional); as duas regras do mínimo; floor vs ceil; camadas; déficit com mês PINADO; determinismo (JSON idêntico); read-only (contagem de alocações idêntica antes/depois).

- **F4b — orquestração multi-mês** (`e172f5c`). Loop cronológico, promoção intra-execução (`equipeAtual = alocações reais ∪ promovidos`), **máxExternos GLOBAL** (nomes novos distintos em toda a execução, não por mês), remanescentes agregados. Disponibilidade escopada ao mês (sem transbordo). Mês fechado: em período multi-mês é PULADO com aviso; retorna 400 só quando o pedido é de um único mês fechado. `test-motor-sugestao` 108/108. Casos que separam: promoção (o mesmo colab aparece camada='novo' em Jul e 'equipe' em Ago na mesma resposta); máxExternos global (ids distintos na resposta inteira ≤ limite; promovido reforça sem consumir cota); determinismo multi-mês.

- **F5a — wizard passo 1** (parâmetros + gerar) (`6769f94`, fix `04e5e7c`). Página própria `/projetos/:id/planejar` (não modal), botão "Planejar equipe" no detalhe perto da Meta de Apropriação. Quadro de cobertura + macro destino OBRIGATÓRIA (o motor é puro; a macro só importa na aplicação; projeto sem macro → CTA de bloqueio) + período multi-seleção (máx 12 meses) + profissões/excluir/fixar/máxExternos + avançados. **Fix `04e5e7c`:** bug num projeto de 24 meses (mexer na seleção de meses deixava a tela aparentemente destruída — não era crash, era scroll: a cobertura com 24 linhas passava de 1600px e o scroll parava mostrando só o rodapé; causa raiz: o wizard mandava 24 meses ignorando o limite de 12 da spec). Correção: limite de 12 (canGerar, UI bloqueia o 13º, contador X/12), tabelas com maxHeight+scroll, scroll resetado ao limpar; layout sem `max-w-6xl` (segue Custos/GridAlocacao); selects digitáveis reusando o Combobox; chips de mês com estado visual; explicação inline; rótulo "Sugerir apenas estas profissões".

- **F5b — matriz de revisão pessoas×meses** (`1c36c29`). Transforma a listagem em MATRIZ (1 linha/pessoa, 1 coluna/mês, células editáveis). **INVARIANTE CENTRAL (contra-intuitivo):** editar uma célula NÃO recalcula as outras linhas (o oposto da cascata da meta — lá é dinheiro/total fixo; aqui é pessoas/o gestor decide). Só os totais do mês recalculam. Estado 100% local (Map de edições, Set de removidos), sem tocar o backend ao editar. Coluna de pessoa sticky-left; badges de camada (fixado/equipe/novo); "Xh livres" por pessoa com aviso soft < 20h (armadilha nº1: consumir a folga coletiva das pessoas compartilhadas entre ~20 gestores); remover linha; idade do snapshot; botão Aplicar (então desabilitado — F6).

- **F6 — aplicação célula a célula** (`7fb89e3`). **Regra de ouro:** cada célula é UMA chamada ao `POST /api/alocacoes` EXISTENTE (lock+teto+mês-fechado+posse por chamada); NENHUM endpoint de lote, NENHUM Prisma direto — o teto de 220h tem um único guardião. Loop SEQUENCIAL em ordem determinística (mês asc → camada → id). Relatório honesto e bloqueante na própria tela: "X de Y aplicadas" (nunca toast verde sobre falha parcial); cada falha com o motivo do backend (teto → com quanto cabe via `horasDisponiveis`; mês fechado; posse); células aplicadas ficam verdes e desabilitadas, falhas ficam vermelhas e editáveis; ajuste ao que cabe em um clique + "Reaplicar falhas" (só as que falharam). Sem rollback (aditivo). Validado: caminho feliz (aplicar no CEN-DEFICIT → horas no grid → déficit da meta cai de 7.100 pra 2.860 — o ciclo fecha) e caminho da falha (alocar a pessoa em outro projeto entre gerar e aplicar → célula falha no teto → relatório com motivo → reaplicar só ela).

- **`fix` dos campos avançados** (`33e885f`). Os campos Min/Max Horas (opções avançadas) tinham `step=4` no input HTML → o browser só aceitava múltiplos de 4 e bloqueava o submit com mensagem nativa quando o gestor digitava, ex., 15 (o `handleGerar` nem rodava). Causa: confundir a regra INTERNA de blocos de 4h com a validação dos parâmetros — um teto/piso não precisa ser múltiplo de 4 (o motor arredonda por baixo respeitando o limite). Correção: `step=1`/`min=1`, campo vazio = default, rótulos e ajuda explicando o propósito (a cliente achou os campos arbitrários).

**Infra de teste — `seed-cenarios.mjs`** (`00c1fc9`). Script avulso (`node seed-cenarios.mjs`), idempotente (apaga os `CEN-` antes de recriar), NÃO mexe no seed do boot. Cria 4 cenários prontos: **CEN-DEFICIT** (6 meses, déficit 7.100/mês, com macro e 2 colaboradores já alocados — exercita a camada 'equipe'); **CEN-SEMMACRO** (sem macro — testa o CTA do wizard); **CEN-COBERTO** (receita cobre a meta com folga — testa "sem déficit" e o banner azul da meta); **CEN-SEMFOLGA** (déficit cheio, folga zero — testa o banner âmbar). O seed do boot recria tudo a cada restart, então os cenários somem no restart — recriar com o script quando preciso.

**Gotchas do motor (pra próxima sessão):**
- **A sugestão NÃO persiste** ao navegar/recarregar — é proposital: ela é uma foto da disponibilidade num instante; persistir criaria o problema de aplicar contra dados velhos. A "idade do snapshot" avisa; o lock real é o juiz na aplicação. Se saiu, gera de novo (dados frescos).
- **Limite de 12 meses por rodada** (da spec) — o wizard bloqueia acima disso. A cliente pediu mais (projetos têm 12+ meses); combinado "de 12 em 12" por ora — ver §7.
- **A extração pra `lib/metaApropriacaoCalc.ts` mexeu em código em produção** (a meta/cascata/tela F3). O portão anti-regressão (os 3 testes da meta re-rodados idênticos) é obrigatório em qualquer mudança futura nesse cálculo.

**Gotchas recorrentes desta frente (registrar pra próxima sessão):**
- **Backend zumbi (pegou 2×):** reiniciar do diretório errado (`frontend/` em vez de `backend/`) faz o `node --import tsx/esm src/server.ts` morrer em silêncio (tsx não está no frontend), e o processo ANTIGO segue na porta 3001 servindo código velho. O `/api/health` responde `ok` mesmo sendo o zumbi. Sempre matar via `Get-NetTCPConnection -LocalPort 3001` e reiniciar de `backend/`; após reiniciar, PROVAR que o backend é o novo (não só que responde). **Quick-win pendente:** boot-timestamp no `/api/health` pra detecção trivial de zumbi.
- **`prisma generate` prematuro quebra o boot:** gerar o client (com `--create-only` ainda não aplicado) deixa o client à frente do banco → P2022 no seed → backend não sobe. Nos prompts de migration: NÃO regenerar o client até o SQL ser aprovado e aplicado.
- **Aspas duplas em here-string PowerShell (`@'...'@`) quebram o commit** (o PS re-divide nelas → `pathspec`/`unknown switch`). Alternativa robusta adotada: `git commit -m "..." -m "..."` múltiplo (um `-m` por parágrafo; aspas duplas OK fora do here-string; tirar `$` dos valores — escrever "2000 reais" não "R$ 2.000").

---

## 5. Sobre alocar "no nível da macro" (sem descer até micro)

Pergunta recorrente: *é possível atribuir um colaborador a uma macro, sem escolher uma micro?*

**Resposta prática: sim — usando a micro "Geral".** A alocação no banco sempre aponta para uma micro específica (`microEntregaId` é obrigatório). Mas como toda macro nasce automaticamente com uma micro "Geral", alocar "na macro" significa, na prática, alocar na "Geral" daquela macro. Na tela isso se apresenta como alocar na macro; por baixo, registra na "Geral".

**Por que não tornar `microEntregaId` opcional?** Seria uma mudança de modelagem desaconselhada: quebraria a regra de unicidade da alocação e a integridade da soma do teto (uma alocação "solta" na macro não teria âncora estável, e o remanejamento da Fase 4 não teria onde pousar as horas cedidas). A micro "Geral" atende exatamente a mesma necessidade sem nenhum desses riscos. **Recomendação: manter como está.**

**Como ficou na interface (resolvido no C2/C3):** o clique rápido na célula do grid cai na "Geral" daquele projeto (tanto para planejado quanto para realizado); o ícone de lista abre o painel lateral, que lista todas as micros (inclusive zeradas) e permite distribuir planejado e realizado entre elas. A "Geral" aparece com um rótulo "padrão" discreto. Sem impacto no modelo de dados.

**Arrumo posterior (`1a2b7bb`):** o painel passou a ser abrível **também a partir da célula vazia** (o ícone aparece no hover; antes só existia em célula com alocação). Isso elimina um desvio: pra alocar numa macro **não-padrão**, o gestor era obrigado a alocar na "Geral" pelo clique rápido e depois **mover** as horas pelo painel; agora ele abre o painel direto da célula vazia e aloca na macro que quiser. O clique rápido (Geral), a barra de saldo, as colunas sticky e o read-only de mês fechado seguem iguais; na célula vazia o ícone fica invisível em repouso (só aparece no hover) pra não poluir o grid.

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

## 7. Próximos passos e prioridade

**A feature Planejamento Inteligente está COMPLETA (F0→F6 no ar, validada pela cliente)** — ver §4-septies. Não há mais fatias dela pendentes. O que segue são pedidos da cliente (pós-entrega) e a fila que estava estacionada.

**PEDIDOS DA CLIENTE (pós-entrega da feature — cada um é decisão de escopo, não emenda rápida):**
1. **A matriz meses×colaboradores no grid geral.** A cliente gostou muito do formato do wizard (colunas = meses, linhas = colaboradores, por projeto) e quer isso no grid principal — hipóteses dela: um filtro, ou na tela de "Ver Entregas" de um projeto. É o feedback mais forte e o maior em escopo; merece desenho próprio (casa com a navegabilidade do grid e a Fase 5).
2. **Limite de meses maior no planejador.** Projetos têm 12+ meses; hoje o wizard limita a 12 por rodada (da spec). Combinado "de 12 em 12" (já funciona), mas ela preferiria mais. Trade-off: a matriz pessoas×meses fica larga (a navegabilidade que já mordeu 2x) — aumentar exige resolver isso (scroll horizontal bom ou paginação por ano na tela).

**ESTACIONADO (retoma agora que a feature fechou):**
- **Passo 6 dos papéis** (frontend chefe/diretor) + os **dashboards (3)** — casam entre si; brainstorm ao escopá-los. Duas pendências no começo: `'chefe'` no `requireRole` de `GET /categorias`; a decisão de UX do remanejamento do chefe.
- **Priorização estrutural** (regra fechada em `Regra_Priorizacao.md`; falta cálculo + tela — a tela Prioridades D2 já existe como base).
- **Filtro do chefe por gestor** (pedido da cliente; backend ignora/rejeita gestorId de gestor comum).
- **Fase 5** (visão da coordenação, relatórios, virtualização + navegabilidade do grid) — casa com o pedido nº1 da cliente.
- **Itens menores do Manual** (PDF Declaração de HT, notificação de remanejamento, datas na macro).

**QUICK-WIN pendente:** boot-timestamp no `/api/health` — o backend zumbi (reiniciar do diretório errado → processo velho na :3001 servindo código antigo, com o health respondendo ok) pegou **2× nesta frente**. Um timestamp de boot no health torna a detecção trivial.

**DECISÕES DE DESIGN COM A CLIENTE (algumas já com desfecho da feature):**
- **Macro automática na criação do projeto?** — Projeto nasce sem macro, e a F6 confirmou que isso atrita (a sugestão precisa de uma macro destino; o wizard bloqueia com CTA quando não há). Perguntar à cliente se o projeto deve nascer com uma macro "Geral" — resolveria o estado-vazio na raiz. **Ficou mais relevante depois da F6.**
- **O grid deve validar a vigência do projeto?** Hoje o grid não conhece vigência (conceito da F1) — deixa alocar em qualquer mês aberto, inclusive fora da vigência. Alinhar se deve restringir ou avisar.
- **Texto obsoleto no grid vazio:** "Use /alocacoes para alocar" referencia a tela removida na reorganização do menu. O caminho certo é a busca "Adicionar colaborador". Uma linha a corrigir.

**PERGUNTAS ANTIGAS PENDENTES:** prorrogação de prestações (vencida legítima não deveria virar "alta" na priorização — futuro status na prestação); se o papel Consulta (ex-coordenacao) será usado; rótulos de exibição dos papéis (Coordenação/Consulta/Gerência — DECIDIDOS, não implementados).

---

### Extra deferido da Fase 3 — Tela de histórico do log (E2-b)
A captura do log (E2) está pronta; falta a **tela** para visualizar o histórico de uma célula (quem alterou o planejado, quando, de quanto pra quanto). Já existe o `GET /api/alocacoes/:id/log`. Ideia: "histórico" no painel lateral da célula. Ao montar, decidir: acesso da coordenação ao log (hoje 403 — mas transparência é o papel dela); buscar por contexto (colaborador+projeto+micro+mês) em vez de só por `alocacaoId`, para cobrir alocações deletadas e recriadas (id novo).

### Item de navegabilidade do grid — PENDENTE (Fase 5)
Com muitas colunas: (a) difícil perceber que dá pra rolar na horizontal; (b) difícil achar um projeto específico; (c) difícil achar células com alocação. Tratar junto da virtualização da Fase 5. **Nota:** a faixa de candidatos (§4-quinquies) é uma segunda `<table>` no mesmo container de scroll — virtualização precisa cobrir as duas juntas, preservando o alinhamento pelo `<colgroup>` compartilhado. Ideias: filtro de colunas por nome/código; seletor "ir para o projeto" com scroll + flash; fixar/reordenar colunas.

### Dívida técnica anotada (não urgente)
1. ~~No C3, reavaliar se o lock precisa cobrir atualizações de realizado.~~ **RESOLVIDA:** realizado fica fora do lock; `test-concorrencia` seguiu 8/8.
2. A busca de similaridade de nome (B1) carrega todos os colaboradores e compara um a um. Para 200–300 está ótimo; só seria um problema em escala de milhares.
3. **Corrida do fechamento (TOCTOU) — adiada.** Check de "mês fechado" no início de cada caminho de escrita, mas há janela mínima entre o check e a escrita. Risco baixo. Conserto à prova de bala: lock de mês em todos os caminhos — tarefa transversal dedicada.
4. **Otimizações de escala do remanejamento (Fase 5, se a contenção doer):** (a) trocar lock do colaborador por lock de (colaborador, mês) — reduz contenção; (b) denormalizar `horasJaCedidas` em coluna.
5. A lista de "recebidas" (`GET /solicitacoes`) filtra em JS — ok na escala atual, candidato a query mais enxuta na Fase 5. `mesEstaFechado`/`generateId` duplicados por arquivo — helper compartilhado um dia.
6. **`SeletorMes` duplicado:** `frontend/src/components/SeletorMes.tsx` (novo, usado por Prioridades e futuras páginas) vs. a função `SeletorMes` interna em `GridAlocacao.tsx` (não tocada por restrição de escopo). Unificar no polimento do passo 6 ou Fase 5: o Grid importa o componente externo e remove a função local.
7. **`canWrite = admin || gestor` em Projetos/Colaboradores não cobre chefe:** chefe aparece no menu N2, mas a UI não expõe criação/edição para ele. A corrigir no passo 6 (§4-sexies-b).
8. **Programas tem bug latente de scroll** (o mesmo `overflow: hidden` corrigido na tela de Profissões — §4-quinquies, passo 1). Aparecerá se a lista de programas crescer. Fix idêntico ao de Profissões.
9. **Testes antigos com payload obsoleto** (`test-c3a`, `test-e1a`): o setup cria colaboradores e projetos sem `valorHora`, `profissaoId` e `categoriaId` — campos hoje obrigatórios na app. Não foi verificado se ainda passam — a passada de limpeza confirma; o ponto é que o setup divergiu da realidade da app. Passada de limpeza tornaria os cenários mais representativos.
10. **Conferir índice pra query quente das agregações sob demanda** (alocação por `projetoId + ano + mes`): `calcularPriorizacao()` e o dashboard filtram `alocsDoMes` por projeto após carregar o mês inteiro. A FK em `alocacoes(projeto_id)` provavelmente cobre — confirmar no `schema.prisma` e, se necessário, adicionar índice composto `(projeto_id, ano, mes)`.
11. **`roles[]` no Layout como espelho manual das permissões de backend:** qualquer mudança de `requireRole` em uma rota exige atualizar manualmente o `roles[]` do item correspondente em `Layout.tsx`. Não há validação cruzada automática. Regra de manutenção: ao adicionar papel a uma rota, atualizar o `roles[]` do item de menu.

### Parking-lot (anotado, fora de fase)
- ~~**`ProjetoDetalhe.tsx`: `shrink` → `flexShrink`.**~~ **RESOLVIDO** em `af473ac`.
- ~~**Fechar o `/auth/register` público.**~~ **RESOLVIDO** em `777b37f`: responde 403 (era a única pendência de segurança de pré-implantação).

---

## 8. Documentos relacionados no projeto

- **`PLANO_FINAL.md`** — o plano consolidado (o "o quê" e "por quê" de todas as fases). (Obs.: o `PLANO_FINAL` rotula o realizado/comparação como "Fase 3"; aqui isso é o "C3 da Fase 2" — só diferença de rótulo. A "Fase 3" **deste** documento = fechamento mensal + auditoria, que o `PLANO_FINAL` também descreve dentro da sua "Fase 3".)
- **`ANALISE_ADAPTACAO_OBSOLETO.md`** — análise antiga, superada. **Ignorar** (premissas abandonadas: aprovação vertical, TimeEntry, projeto-gestor M:N).
- **`CRITICA_DESIGN_v2.md`** — o prompt de crítica que foi levado às IAs externas (registro do brainstorm de design do grid).
- **`Regra_Priorizacao.md`** — a regra de priorização sintetizada e aprovada (spec da implementação futura; resumo no §4-bis). Saiu do brainstorm de 4 IAs.
- **`Brainstorm_ValorHora_Categoria.md`** / **`Tarifa_Colaborador_Categoria_Spec.md`** — enunciado e spec (aprovada) da **tarifa por colaborador × categoria** (resumo no §4-bis). Saíram do brainstorm de 4 IAs.
- **`Brainstorm_Papeis_Posse_Exclusao.md`** / **`Spec_Papeis_Posse_Exclusao.md`** — enunciado e **spec** (aprovada) dos **papéis novos (chefe/diretor), posse/delegação e exclusão permanente** (resumo no §4-ter). Saíram do brainstorm de 4 IAs. É a base dos prompts dos 6 passos.
- **Área de atuação (revertida)** — não há documento de spec no projeto (a feature foi revertida antes de fechar a spec do modelo hierárquico). O enunciado do brainstorm de 4 IAs sobre a hierarquia Área → Profissão, as respostas, e o diagnóstico função×área estão na conversa que gerou o §4-quater. Os 4 commits da implementação (modelo área-direta) estão na branch `backup/areas-atuacao-58e3f20`. Ver §4-quater pro resumo completo.
- **`Brainstorm_Montar_Equipe_Por_Profissao.md`** / **`Spec_Candidatos_Por_Profissao.md`** — enunciado e **spec** (aprovada) do recurso de **montar equipe por profissão no grid** (a faixa de candidatos — passo 4c/4d da feature Profissão, resumo no §4-quinquies). Saíram do brainstorm de 4 IAs. A entidade Profissão em si (passos 1–3) não teve spec formal — é o clone do padrão de Programas/`CategoriaProjeto`, decidido em conversa (ver §4-quinquies).
- **`Manual_Sistema_de_Alocacao.md`** — manual de uso (gerado), depois anotado pela cliente com a 2ª leva de pedidos (a base do §4-ter).
- **`Regra_Priorizacao_reconstruida.md`** — reconstrução da regra de priorização a partir das decisões da cliente (versão usada no P1; complementa/atualiza o `Regra_Priorizacao.md` mais antigo — resumo no §4-bis e §4-sexies-a).
- **`Spec_Dashboards.md`** — spec do bloco de dashboards (3 planejados: Projetos, Geral, Capacidade); base dos prompts D1/D2 e dos próximos dashboards (item 3 do §7).
- **`Spec_Navegacao.md`** — decisões da reorganização do menu lateral: remoção de Alocações, agrupamento em seções, visibilidade fina por papel (N1/N2 — detalhes em §4-sexies-b).
- **`Mini_Brainstorm_Nome_Aba.md`** — registro do mini-brainstorm sobre nomes de abas/seções do menu e rótulos amigáveis de papel (`ROLE_LABELS` — ver §4-sexies-b e "Estacionados" no §7).
- **`Spec_Planejamento_Inteligente.md` (v1.4)** — spec da **feature prioritária ativa**: meta de apropriação de HT + motor de sugestão de equipe. Versão v1.4 é a fonte da verdade do arco F0→F6 (ver §4-septies).
- **`Spec_Motor_Sugestao_F4.md` (v1.0)** — spec do motor de sugestão de equipe (arco F4→F6): decisões travadas de algoritmo (waterfall, blocos de 4h, mínimo de 8h, promoção intra-execução, fluxo unidirecional). Saiu do brainstorm de 4 IAs; aprovada antes da implementação.
- **`seed-cenarios.mjs`** — script avulso de cenários de teste (`node seed-cenarios.mjs`). Cria 4 projetos `CEN-*` idempotentes para exercitar o wizard/motor sem depender do seed do boot.
- **`Brainstorm_Planejamento_Inteligente.md`** — o enunciado do brainstorm de 4 IAs que deu origem ao modelo financeiro da feature.
- **`PROGRESSO_E_DECISOES.md`** — este documento.
