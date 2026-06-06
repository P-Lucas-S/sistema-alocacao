# Sistema de Alocação de Equipes — Progresso e Decisões

> **Propósito deste documento.** Registro vivo do estado de execução do projeto. O `PLANO_FINAL.md` descreve *o que* construir; este documento registra *o que já foi construído*, *as decisões tomadas durante a implementação* e *como continuar*. Serve de contexto para qualquer pessoa — ou qualquer sessão futura do Claude Code — que pegar o projeto daqui em diante.
>
> **Última atualização:** fim da Fase 2 / C2 (grid de alocação completo). Próximo passo: C3 (horas realizadas).

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
- **`admin`** — administração técnica.
- **Colaborador NÃO é usuário** — é uma entidade de dados. Não tem login, não bate ponto. Tudo é cadastrado pelos gestores.

### Branches
- **`feat/alocacao-fase-1`** — Fases 0, 1 e o C1 da Fase 2 (até o commit `65aea36`).
- **`feat/alocacao-fase-2`** — Fase 2 / C2 inteiro (criado a partir do C1). Todo o trabalho do grid vive aqui.
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
- **Projetos são arquivados, nunca deletados.** O código fica preso para sempre, mesmo arquivado (nunca reutilizável).
- **Planejado E realizado:** ambos digitados pelo gestor (colaborador não acessa nada). O realizado entra no C3. O teto é sobre o **planejado**.
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
| **Fase 2 — C3** | Horas realizadas + comparação planejado vs. realizado | ⬜ **Próximo passo** |
| **Fase 3** | Fechamento mensal + log de auditoria de edições | ⬜ Pendente |
| **Fase 4** | Remanejamento broadcast entre gestores | ⬜ Pendente |
| **Fase 5** | Relatórios da coordenação + escala (virtualização do grid + navegabilidade — ver §7) | ⬜ Pendente |
| Transversal | Identidade visual geral | ⬜ Pendente |

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
- **Esta é a única tela onde se cria/edita a estrutura de macros e micros.** O grid e o painel do C2 NÃO criam micros novas — só alocam horas nas que já existem.

### Fase 2 — C1 — Núcleo do teto de 220h (commit `65aea36`)

**Tabela `alocacoes`** (migration `20260602000003_fase2_alocacoes`)
- Campos: `colaboradorId`, `projetoId`, `macroEntregaId`, `microEntregaId`, `ano`, `mes`, `horasPlanejadas` (`Decimal(6,2)`), `horasRealizadas` (`Decimal(6,2)` nullable — preparado para o C3), `createdById`/`updatedById` (auditoria), timestamps.
- **Índice único** em `(colaboradorId, projetoId, macroEntregaId, microEntregaId, ano, mes)` — impede a mesma alocação duplicada (o que bagunçaria a soma do teto).
- **Índice** em `(colaboradorId, ano, mes)` — é o que torna a soma do teto (e o lock) eficiente.
- Todas as FKs com `ON DELETE RESTRICT` — coerente com "arquivar, não deletar".

**Rota de alocação com lock** (`backend/src/routes/alocacoes.ts`)
- A verificação do teto e a gravação acontecem dentro de **uma única transação interativa** do Prisma.
- **Mecanismo do lock:** `SELECT id FROM colaboradores WHERE id = ? FOR UPDATE` adquire um lock exclusivo na linha do colaborador (serializa o acesso — o segundo gestor espera o primeiro terminar). A soma das horas usa `LOCK IN SHARE MODE` para ler os dados *committed* mais recentes, não o snapshot antigo. O lock é ancorado no colaborador (que sempre existe) e não nas linhas de alocação (que podem não existir na primeira alocação).
- Bloqueio retorna 409 com `totalAlocado`, `horasDisponiveis` e a `distribuicao` (projetos, horas e gestores).
- Permissão: só gestor e admin alocam; coordenação 403.
- **Validado com teste de concorrência:** `backend/test-concorrencia.mjs` dispara duas requisições simultâneas (via `Promise.all`) contra o mesmo colaborador/mês e confere o total real no banco. **16/16 rodadas corretas no C1, o teto nunca furou.** Este arquivo deve ser mantido e re-executado sempre que algo perto da lógica de alocação mudar. (Re-rodado no C2 a cada mexida na rota do grid: 8/8 OK em cada execução.)
- Ajuste no B3: as rotas de delete de macro/micro agora checam alocações antes de deletar e retornam 400 com mensagem clara (consequência do `RESTRICT`).

### Fase 2 — C2 — Grid de alocação (branch `feat/alocacao-fase-2`)

Interface rica de alocação: **colaboradores nas linhas, projetos do gestor nas colunas, um mês por vez**. Tudo em `frontend/src/pages/GridAlocacao.tsx` (rota `/grid`). O grid consome a rota de alocação do C1 (POST/DELETE) sem alterá-la — **o teto e o lock seguem intocados** (test-concorrencia re-rodado, sempre OK).

**Rota de leitura** `GET /api/alocacoes/grid?ano=&mes=` (em `alocacoes.ts`):
- Colunas = projetos do gestor logado (admin vê todos; coordenação não é dona de projetos, então vê grid vazio — esperado, a visão dela é da Fase 5).
- Linhas = colaboradores com ≥1 alocação nos projetos do gestor naquele mês.
- Por linha: `saldo { totalMeusProj, totalOutros, totalGeral, disponivel }` — `totalGeral` soma TODOS os gestores (base correta do teto).
- `celulas[projetoId] = { totalHoras, detalhes: [{ alocacaoId, macroNome, microNome, macroEntregaId, microEntregaId, horas }] } | null` — agrega por (colaborador, projeto) somando todas as micros.
- `defaultMacroId` / `defaultMicroId` por projeto = a micro "Geral", destino do clique rápido na célula.

**D1 — estrutura e leitura** (commit `7cf45bb`)
- Seletor de mês/ano (setas ◀▶ + dropdown/input). Colunas **sticky**: Colaborador (left:0) e Saldo (left:200px) ficam paradas; os projetos rolam na horizontal.
- **BarraSaldo** (decisão de design validada): **COR** = lotação total (verde <80% / âmbar 80–99% / vermelho ≥100%); **TEXTURA** = posse (sólido = horas do gestor logado; hachurado 45° na mesma cor = outros gestores); **fundo** `var(--surface-3)` = livre. Legenda no topo: "■ você · ▦ outros gestores". A cor responde "essa pessoa ainda cabe?", a textura responde "quanto disso é meu". Abaixo da barra, **em todas as linhas**, a linha de disponível ("Xh disponíveis" / "Capacidade esgotada").
- Célula mostra o planejado + placeholder "— real." reservado pro C3.

**D2 — edição inline** (commit `62675cf`)
- Célula vira input com máquina de estados `idle → editing → saving → idle`. Confirma com Enter/blur, cancela com Escape (guard `activeRef` evita o double-fire Enter+blur).
- **Sem otimismo reverso:** mostra "…", aguarda o backend, só então firma ou mostra o bloqueio.
- Clique rápido cai na micro **"Geral"** por padrão. Zerar/esvaziar uma célula com alocação → DELETE.
- "**máx Xh**" durante a digitação = `220 − totalGeral + horas da célula` (calculado local, sem chamada extra) — previne o bloqueio na maioria dos casos.
- Popover de bloqueio 409 usa o `totalGeral` da linha (coerente com a barra) + "Máximo nesta célula: Xh" + a distribuição que o backend manda. `position: fixed` via `getBoundingClientRect` para não ser cortado pelo overflow da tabela.

**D3-a — busca e localizador universal** (commit `d4429b3`)
- Campo de busca (debounce 300ms) → `GET /api/colaboradores?search=&ativo=true` (rota existente; só ativos).
- Selecionar quem **não** está no grid → vira linha nova com saldo calculado no frontend (`GET /api/alocacoes?colaboradorId=&ano=&mes=`), sem endpoint novo. Linhas extras persistem no mês, somem ao trocar de mês ou ao ganhar alocação natural.
- Selecionar quem **já** está → selo discreto "no grid"; ao clicar, a tela rola até a linha (`scrollIntoView`) e aplica um flash de ~2s (não duplica).

**D3-b etapa 1 — leitura da composição macro/micro** (commit `07c3096`)
- A célula passa a mostrar a **soma** do projeto (todas as micros). Ícone de lista **sempre montado** (opacity 0.5, nítido no hover) abre o painel — clicar nele não dispara a edição inline.
- Clique inline opera **só na "Geral"** (localizada via `defaultMicroId`) — as outras micros ficam intactas.
- **Painel (drawer) de leitura:** colaborador, [código] projeto, capacidade no mês, composição agrupada por macro → micros, badge "padrão" na Geral.
- **Lição:** esconder o ícone só no hover era frágil (loop mount/unmount fazia ele nunca aparecer). Manter sempre montado e variar só a opacidade resolveu.

**D3-b etapa 2 — edição dentro do painel + polimento (C2 completo)** (commit `bd5f631`)
- O painel busca a estrutura completa via `GET /api/projetos/:projetoId/macros` (rota do B3) ao abrir — lista **todas** as micros, inclusive as zeradas.
- Componente `MicroLinha`: cada micro salva **individualmente** pela rota do C1, uma de cada vez (nunca em lote; cada uma passa pelo teto + lock). Sem otimismo reverso; zerar → DELETE; "máx Xh" por micro; bloqueio 409 inline na linha da micro com distribuição.
- Após salvar: total do projeto e capacidade no painel atualizam, o grid por baixo atualiza, e o painel **não fecha** (`detalheMap` como estado local + `refreshSaldo()` recalcula o `totalGeral` sem fechar).
- **Polimento final do C2:** refetch silencioso (`fetchGrid(silent)`; o save dentro do painel usa `fetchGrid(true)` → o grid não pisca atrás do painel); a linha de disponível passou a aparecer em **todas** as linhas (antes só ≥90%); acentos das strings do painel restaurados.

**Decisão de UX travada no C2:** o clique rápido na célula cai na "Geral"; o ícone de lista abre o painel para detalhar/editar macro/micro. **Criar micros novas continua só na tela de detalhe do projeto (B3)** — nunca pelo grid ou painel. Isso mantém a separação "estrutura de entregas" (B3) vs. "alocar horas" (C2).

**Seed de teste (`backend/src/db.ts`) — IMPORTANTE para futuras sessões:**
- O seed agora cria um cenário realista além dos usuários: **30 colaboradores** (IDs `sc-01`..`sc-30`), **10 projetos** (G1=4, G2=3, G3=3; IDs `sp-01`..`sp-10`, cada um com 1–2 macros + micro "Geral"), **40 alocações** em **junho/julho/agosto de 2026**. Gestores com IDs fixos `seed-gestor-001/002/003`. Idempotente (rodar 2× dá o mesmo resultado).
- **Casos de propósito para testar o grid na tela:** Enzo Carvalho (jun) = 220h cheio (barra vermelha); Daniela Rocha (jun) = 200h (âmbar); Brenda Vieira (ago) = 200h; cross-gestor / barra bicolor (sólido + hachurado): Fabiana Costa (jun), Leonardo Alves e Marina Souza (jul), Nicolas Barbosa (jul, sem G1), Ulisses Ribeiro (ago).
- **CUIDADO NA IMPLANTAÇÃO:** o seed apaga e recria tudo a cada restart do servidor. NÃO rodar em produção — só serve para desenvolvimento.

---

## 5. Sobre alocar "no nível da macro" (sem descer até micro)

Pergunta recorrente: *é possível atribuir um colaborador a uma macro, sem escolher uma micro?*

**Resposta prática: sim — usando a micro "Geral".** A alocação no banco sempre aponta para uma micro específica (`microEntregaId` é obrigatório). Mas como toda macro nasce automaticamente com uma micro "Geral", alocar "na macro" significa, na prática, alocar na "Geral" daquela macro. Na tela isso se apresenta como alocar na macro; por baixo, registra na "Geral".

**Por que não tornar `microEntregaId` opcional?** Seria uma mudança de modelagem desaconselhada: quebraria a regra de unicidade da alocação e a integridade da soma do teto (uma alocação "solta" na macro não teria âncora estável, e o remanejamento da Fase 4 não teria onde pousar as horas cedidas). A micro "Geral" atende exatamente a mesma necessidade sem nenhum desses riscos. **Recomendação: manter como está.**

**Como ficou na interface (resolvido no C2):** o clique rápido na célula do grid cai na "Geral" daquele projeto; o ícone de lista na célula abre o painel lateral, que lista todas as micros (inclusive zeradas) e permite distribuir horas entre elas. A "Geral" aparece com um rótulo "padrão" discreto. Sem impacto no modelo de dados.

---

## 6. Método de trabalho (manter)

O projeto vem sendo construído com um método que está funcionando e vale preservar:

- **Fases pequenas, testadas e aprovadas uma a uma** antes de seguir. Cada sub-bloco (B1, B2, B3, C1, D1, D2, D3-a, D3-b…) fecha com um commit, que vira um ponto de retorno seguro.
- **Operações estruturais (migrations, mudanças de schema) são mostradas ANTES de aplicar.** Especialmente quando há dados a preservar — ver o SQL e o antes/depois evita perda silenciosa.
- **Validação no navegador**, não só via API. Os testes automatizados provam a lógica; clicar na tela revela o que o plano no papel não captura. Várias melhorias (múltiplas datas de prestação, a confirmação de duplicata, o bug de fuso, a barra de saldo refeita, o ícone do painel, o disponível sempre visível) surgiram exatamente assim.
- **Lógica crítica é testada isoladamente, com interface mínima, antes da interface rica.** O teto (C1) foi construído e provado com tela feia justamente para isolar o risco antes de construir o grid (C2).
- **Concorrência exige teste de concorrência.** Bugs de corrida não aparecem em teste manual — precisam de requisições paralelas disparadas de propósito, conferindo o estado real no banco.
- **Brainstorm com IAs externas** vale quando a decisão é estrutural, com vários caminhos defensáveis, e errar custa caro de refazer (foi assim com o design do grid — registrado em `CRITICA_DESIGN_v2.md`). NÃO vale para confirmar decisões já tomadas ou detalhes localizados, baratos de iterar.

### Ruído de teste a ignorar
- Avisos de PowerShell como `Join-String` inexistente, `$pid` reservado, `ConvertFrom-Json`, `.Count`/`Measure-Object` retornando `null` em coleção de 1 item ou vazia — são da versão de PowerShell 5.1 da máquina, não do sistema. (Geram falsos "❌" em testes; conferir o valor real no output antes de acreditar.)
- `EADDRINUSE` (porta ocupada) — instância anterior do servidor ainda rodando; matar processos node resolve.
- Avisos `LF will be replaced by CRLF` no git — inofensivos (Windows).
- "Código já em uso" / código não liberado ao arquivar em testes repetidos — é o teste reusando um código já criado, não um bug.
- Acento corrompido no banco (ex.: `Conte<U+FFFD>do`, bytes `EFBFBD`) vindo de teste via **PowerShell 5.1**: o PS5 manda o corpo HTTP em Latin-1, não UTF-8, então acentos digitados em scripts viram `U+FFFD`. O navegador sempre manda UTF-8, então **não afeta o sistema real**, e o dado sujo some no próximo restart do seed. O banco, a conexão e os headers estão todos corretos em utf8mb4.

### Gotchas de ferramenta (Claude Code / ambiente)
- **Claude Code travando com "Usage credits required for 1M context"** mesmo com a cota do plano sobrando (ex.: 20% na sessão, 79% na semana): NÃO é limite real, é um **portão de cobrança da feature de contexto 1M**. Uma atualização do Claude Code passou a usar, por padrão, um modelo de janela 1M, e no plano Pro o contexto 1M exige **créditos de uso** (extra usage), que ficam desativados por padrão. Costuma disparar na **compactação** (que pega um modelo 1M sozinho). Soluções, do mais barato pro mais caro: fixar contexto padrão (`/model` → Sonnet 4.6, ou abrir com `--model claude-sonnet-4-6`, ou a variável `CLAUDE_CODE_DISABLE_1M_CONTEXT=1`); rodar `/clear` se travar na compactação; atualizar o Claude Code; e, por último, ligar os créditos de uso (pay-as-you-go a preço de API) em `claude.ai/settings/usage`. Vários relatos no GitHub do `anthropics/claude-code` confirmam o comportamento.
- **Editar strings acentuadas:** edite direto no arquivo (que está em UTF-8) ou via `str_replace` buscando o texto SEM acento (ASCII puro, o match não falha) e substituindo pelo com acento. **NÃO escrever strings acentuadas via heredoc do PowerShell** — foi o que comeu os acentos do painel uma vez (precisou de uma passada de correção depois).

---

## 7. Próximo passo: Fase 2 — C3 (Realizado)

Com o planejamento (C1 + C2) fechado e confiável, o C3 adiciona o **realizado** — o complemento que fecha a Fase 2.

Escopo do C3:
- **Horas realizadas** digitadas pelo gestor (opcional de preencher). A coluna `horasRealizadas` (`Decimal(6,2)`, nullable) já existe na tabela `alocacoes` desde o C1 — não precisa de migration nova.
- **UX de "copiar planejado → realizado"** (atalho para preencher o realizado a partir do que foi planejado).
- **Comparação planejado vs. realizado** por colaborador / projeto / mês. A célula do grid já reserva o espaço "— real." para isso.

Pontos de atenção para o C3:
- O **teto é sobre o planejado** — o realizado, em princípio, NÃO conta para o teto de 220h. Confirmar na hora se o realizado fica fora do lock (provavelmente sim — ver dívida técnica #1 abaixo).
- Decidir onde o realizado é editado: na própria célula do grid (um segundo campo), no painel, ou numa tela própria. Vale alinhar a UX antes de codar.
- O realizado é manual e pode nunca ser preenchido — o sistema tem que continuar útil mesmo se ninguém tocar nele.

### Item de navegabilidade do grid — PENDENTE (Fase 5 ou polimento dedicado)
Apareceu durante o C2 e foi conscientemente adiado. Com muitas colunas/projetos: (a) é difícil perceber que dá pra rolar na horizontal, (b) é difícil **achar um projeto específico** entre muitas colunas, e (c) é difícil achar as células com alocação no meio das vazias. Tratar **junto da virtualização da Fase 5** (a escala de 200+ colaboradores × projetos já exige virtualização lá), ou num polimento dedicado do grid. Ideias na mesa: um campo que **filtra as colunas** por nome/código; um seletor "**ir para o projeto**" que rola na horizontal até a coluna e dá um flash (igual ao localizador de colaborador do D3-a); **fixar/reordenar** colunas. É uma decisão de UX estrutural — merece um desenho com calma, não um remendo.

### Dívida técnica anotada (não urgente)
1. No C3, reavaliar se o lock precisa cobrir também atualizações de horas realizadas, ou se elas ficam fora do teto (provavelmente fora — o teto é sobre planejado — mas confirmar na hora).
2. A busca de similaridade de nome (B1) carrega todos os colaboradores e compara um a um. Para 200–300 está ótimo; só seria um problema em escala de milhares.

> Nota: a dívida anterior sobre o comentário contraditório do `innodb_lock_wait_timeout` em `alocarComLock` foi **resolvida** ainda no C1 (o texto do comentário foi corrigido junto do commit `65aea36`).

---

## 8. Documentos relacionados no projeto

- **`PLANO_FINAL.md`** — o plano consolidado (o "o quê" e "por quê" de todas as fases). Reflete as decisões finais. (Obs.: o `PLANO_FINAL` rotula o realizado/comparação como "Fase 3"; aqui neste documento o mesmo trabalho é o "C3 da Fase 2" — é só diferença de rótulo, o conteúdo é o mesmo.)
- **`ANALISE_ADAPTACAO_OBSOLETO.md`** — análise antiga, superada. Mantida só por histórico. **Ignorar** (premissas abandonadas: aprovação vertical, TimeEntry, projeto-gestor M:N).
- **`CRITICA_DESIGN_v2.md`** — o prompt de crítica que foi levado às IAs externas (registro do brainstorm de design do grid).
- **`PROGRESSO_E_DECISOES.md`** — este documento.