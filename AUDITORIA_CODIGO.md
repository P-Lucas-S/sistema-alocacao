# Auditoria de Código — Pente-fino

Data: 21/07/2026 · Escopo: backend/src (rotas, middleware, server) + frontend/src (pages, components, contexts) · **Nenhum arquivo foi alterado.**

Legenda de impacto: `segurança` > `funcional` > `cosmético`
Legenda de custo: `trivial` (minutos) · `pequeno` (uma fase) · `grande` (precisa de desenho)

---

## 1. ÓRFÃOS

### 1.1 Fluxo de exclusão de projetos: 5 endpoints sem nenhuma UI — impacto: funcional · custo: grande (ou trivial, decisão de produto)
O backend tem um fluxo completo de exclusão com aprovação que **nenhuma tela chama**:
- `POST /api/projetos/:id/solicitar-exclusao` (gestor) — [projetos.ts:741](backend/src/routes/projetos.ts#L741)
- `POST /api/projetos/:id/aprovar-exclusao` (chefe) — [projetos.ts:782](backend/src/routes/projetos.ts#L782)
- `POST /api/projetos/:id/recusar-exclusao` (chefe) — [projetos.ts:831](backend/src/routes/projetos.ts#L831)
- `DELETE /api/projetos/:id/excluir-direto` (chefe) — [projetos.ts:866](backend/src/routes/projetos.ts#L866)
- `PATCH /api/projetos/:id/redelegar` (chefe) — [projetos.ts:678](backend/src/routes/projetos.ts#L678)

Grep no frontend inteiro: zero ocorrências dessas URLs. É o **mesmo padrão do caso "Início em construção"**, só que invertido: a funcionalidade existe no backend e ninguém sabe, porque não tem porta de entrada. Ou a UI ficou para depois e nunca veio, ou a feature foi abandonada. Decisão de produto: construir a UI (grande) ou remover os endpoints (trivial).

### 1.2 `Alocacoes.tsx` — arquivo inteiro órfão — impacto: cosmético · custo: trivial
[frontend/src/pages/Alocacoes.tsx](frontend/src/pages/Alocacoes.tsx) (com ~4 fetches e UI completa) não é importado por ninguém — a rota `/alocacoes` redireciona para `/grid` ([App.tsx:76](frontend/src/App.tsx#L76)). O caso está documentado em comentário no App.tsx (deliberado), mas o arquivo continua no disco como peso morto: alguém pode editá-lo achando que está ativo. Deletar (o histórico fica no git).

### 1.3 `GET /api/alocacoes/:id/log` sem consumidor — impacto: cosmético · custo: trivial
[alocacoes.ts:805](backend/src/routes/alocacoes.ts#L805). Nenhum fetch no frontend usa `/log`. Ou é para uma tela de auditoria futura, ou sobrou.

### 1.4 `GET /api/priorizacao` (o P1 original) — impacto: cosmético · custo: trivial
[priorizacao.ts:267](backend/src/routes/priorizacao.ts#L267). A tela Prioridades migrou para `GET /api/dashboards/projetos`; do router de priorização o frontend só usa os 4 PATCHes (fixar/desfixar/pausar/despausar). O GET ficou sem consumidor no app (confirmar se algum script/teste externo depende antes de remover).

---

## 2. INCONSISTÊNCIAS DE PERMISSÃO

### 2.1 Remanejamento: menu oferece ao chefe, backend barra — impacto: funcional (403 misterioso) · custo: trivial
- Menu: `roles: ['admin', 'chefe', 'gestor']` — [Layout.tsx:48](frontend/src/components/Layout.tsx#L48)
- Backend: **todos** os 5 endpoints de remanejamento exigem `admin|gestor` — [remanejamento.ts:59](backend/src/routes/remanejamento.ts#L59), 135, 191, 420, 477
- A página [Remanejamento.tsx](frontend/src/pages/Remanejamento.tsx) não tem nenhuma checagem de papel.

**Chefe clica em Remanejamento → GET /solicitacoes → 403.** É exatamente a mesma classe do bug do Custos que já aconteceu. Corrigir escolhendo um lado: tirar `chefe` do menu, ou adicionar `chefe` no `requireRole` do backend.

### 2.2 Programas e Profissões: chefe vê a tela, backend nega; gestor não vê, backend permite — impacto: funcional (403) + segurança (menor) · custo: trivial
- Menu: `roles: ['admin', 'chefe']` — [Layout.tsx:67-68](frontend/src/components/Layout.tsx#L67-L68)
- Backend POST/PATCH: `requireRole('admin', 'gestor')` — [categorias.ts:65](backend/src/routes/categorias.ts#L65), 108; [profissoes.ts:65](backend/src/routes/profissoes.ts#L65), 108
- As páginas [Programas.tsx](frontend/src/pages/Programas.tsx) e [Profissoes.tsx](frontend/src/pages/Profissoes.tsx) não têm checagem de papel — o formulário de criar/editar aparece para quem abrir.

Dupla inconsistência: **chefe cria programa → 403**; **gestor pode criar pela API** mas o menu esconde a tela dele (a UI de Colaboradores até chama `POST /api/profissoes` inline — [Colaboradores.tsx:211](frontend/src/pages/Colaboradores.tsx#L211) — o que sugere que gestor criar profissão é intencional). Alinhar os dois lados numa decisão só.

### 2.3 Grid para coordenação: comentário diz "já trata", o código não trata — impacto: funcional (403) · custo: pequeno
- Comentário: "Coordenação vê em leitura (o Grid já trata isso)" — [Layout.tsx:46](frontend/src/components/Layout.tsx#L46)
- Realidade: [GridAlocacao.tsx](frontend/src/pages/GridAlocacao.tsx) só usa `readonly={mesFechado}` (linhas 1841, 1985, 2110) e o único papel checado é `isAdmin` (linha 1322). **Não existe checagem de coordenação.**
- Backend: `POST /api/alocacoes` exige `admin|gestor|chefe` — [alocacoes.ts:605](backend/src/routes/alocacoes.ts#L605)

Coordenação abre o Grid, vê células editáveis, edita, salva → 403. Correção: `readonly = mesFechado || user?.role === 'coordenacao'`.

### 2.4 Faixa de candidatos do Grid: 403 para chefe e coordenação — impacto: funcional (403) · custo: trivial
`GET /api/alocacoes/candidatos` exige `admin|gestor` — [alocacoes.ts:444](backend/src/routes/alocacoes.ts#L444) — mas o Grid é visível para chefe e coordenação, e a faixa dispara ao filtrar por profissão — [GridAlocacao.tsx:1424](frontend/src/pages/GridAlocacao.tsx#L1424). Chefe/coordenação filtram → a faixa recebe 403. Alinhar o `requireRole` (é só leitura) ou esconder a faixa por papel.

### 2.5 `GET /api/colaboradores` expõe `valorHora` a qualquer papel logado — impacto: segurança · custo: trivial
[colaboradores.ts:88-111](backend/src/routes/colaboradores.ts#L88-L111) e `/:id` (linha 121) têm só `authenticate`, sem `requireRole`, e o `select` inclui `valorHora` (dado financeiro/tarifa) e `email` de todos os colaboradores. O **diretor** — cuja regra absoluta é "não vê nomes de indivíduos" — pode chamar direto e receber tudo. A UI esconde a tela dele, mas a API não barra (adaptação por omissão na UI, sem barreira no backend). Correção: `requireRole('admin', 'chefe', 'gestor', 'coordenacao')` (coordenação precisa — a tela é dela também).

### 2.6 `GET /api/alocacoes/grid` e `GET /api/alocacoes` sem restrição de papel — impacto: segurança · custo: trivial
[alocacoes.ts:192](backend/src/routes/alocacoes.ts#L192) e [alocacoes.ts:574](backend/src/routes/alocacoes.ts#L574) — só `authenticate`. Diretor pode baixar o grid completo com nomes e horas por pessoa, contornando a regra da spec 2.7. Mesma correção do 2.5.

### 2.7 `GET /api/users` devolve e-mail de todos para qualquer logado — impacto: segurança (menor) · custo: pequeno
[users.ts:10-19](backend/src/routes/users.ts#L10-L19) — sem `requireRole`, retorna `id, name, email, role, position, avatarUrl` de **todos os usuários**. O único consumidor não-admin é o [SeletorGestor.tsx:22](frontend/src/components/SeletorGestor.tsx#L22), que precisa apenas de `id`+`name` dos gestores. Sugestão: endpoint `GET /users/gestores` enxuto (id+nome) para o seletor, e o GET completo vira admin-only (o Team já é admin-only).

### 2.8 Projetos: UI mais restritiva que o backend para chefe — impacto: cosmético · custo: trivial (decisão)
`canEditProject = admin || (gestor && dono)` — [Projetos.tsx:121-122](frontend/src/pages/Projetos.tsx#L121-L122) — mas o backend permite `chefe` em POST/PUT/PATCH status ([projetos.ts:475](backend/src/routes/projetos.ts#L475), 562, 643). Não gera 403 (direção inversa), mas é incoerente: em Prioridades o chefe age em tudo (`podeAgir`), na tela Projetos não pode editar nada. Confirmar qual é a intenção.

### 2.9 Leitura de projetos/macros/meta aberta a diretor — impacto: segurança (baixa) · custo: pequeno
`GET /api/projetos`, `/api/projetos/:id`, `/:id/meta-apropriacao` e `/api/projetos/:projetoId/macros` têm só `authenticate` ([projetos.ts:327](backend/src/routes/projetos.ts#L327), 401, 429; [macros.ts:33](backend/src/routes/macros.ts#L33)). Diretor pode ler nomes de projetos, estrutura e meta financeira pela API. Coerente para coordenação (precisa), incoerente com a regra do diretor. Baixa severidade (usuário interno autenticado), mas é a mesma família do 2.5/2.6 — se fechar uma, fechar todas.

**Confirmações positivas** (verificado, sem problema):
- Custos: `GET /relatorios/custos` permite os 5 papéis — o 403 do chefe está resolvido ✓
- Config priorização: GET aberto aos 5, PUT `admin|chefe` = `podeEditar` da UI ✓
- PATCHes fixar/pausar `admin|gestor|chefe` = `podeVerAcoes`/`podeAgir` ✓
- Colaboradores (tela): `canWrite = admin||gestor` bate com o backend ✓
- Dashboards (projetos/capacidade): os 5 papéis, consistente ✓
- Team/users mutações: admin-only nos dois lados ✓

---

## 3. TEXTOS OBSOLETOS

### 3.1 Comentário enganoso no Layout sobre o Grid — impacto: funcional (indireto) · custo: trivial
"Coordenação vê em leitura (o Grid já trata isso)" — [Layout.tsx:46](frontend/src/components/Layout.tsx#L46). **Falso** (ver item 2.3). Documentação que afirma uma proteção inexistente é pior que ausência de comentário: esconde o bug de quem audita. Corrigir junto com 2.3.

Fora isso: não encontrei "Em construção" remanescente, nem referências a "/alocacoes" em mensagens de usuário (a única menção está no comentário do App.tsx, que é preciso e correto). Os comentários "diretor não vê ainda" no Layout continuam verdadeiros.

---

## 4. REDUNDÂNCIAS

### 4.1 `Programas.tsx` e `Profissoes.tsx` são clones — impacto: cosmético · custo: pequeno
Os dois arquivos têm a mesma estrutura CRUD com fetches **nas mesmas linhas** (60, 78, 109, 153, 184, 212) — é cópia colada com o nome do recurso trocado. Toda correção precisa ser feita duas vezes (e o item 2.2 mostra que o bug de permissão já existe em dobro). Unificável num componente `CadastroSimples` parametrizado.

### 4.2 `fmtRealizado` duplicada — impacto: cosmético · custo: trivial
[Prioridades.tsx:59](frontend/src/pages/Prioridades.tsx#L59) e [DashboardCapacidade.tsx:44](frontend/src/pages/DashboardCapacidade.tsx#L44) — mesma função (decisão null-vs-zero de horas realizadas). O comentário em Prioridades diz "único lugar onde a decisão acontece", que já não é verdade. Extrair para `lib/format.ts`.

### 4.3 `fmtMoeda` em 3+ variantes — impacto: cosmético · custo: trivial
[GridAlocacao.tsx:136](frontend/src/pages/GridAlocacao.tsx#L136) (recebe string), [Prioridades.tsx:48](frontend/src/pages/Prioridades.tsx#L48) (string, com centavos), [DashboardGeral.tsx:48](frontend/src/pages/DashboardGeral.tsx#L48) (number, sem centavos). Variantes sutilmente diferentes = risco de o mesmo valor aparecer formatado diferente em telas vizinhas.

### 4.4 `KpiCard` duplicado — impacto: cosmético · custo: trivial
[DashboardGeral.tsx:58](frontend/src/pages/DashboardGeral.tsx#L58) e [DashboardCapacidade.tsx:82](frontend/src/pages/DashboardCapacidade.tsx#L82) — quase idênticos (o do Geral tem o ajuste `isStr`). Candidato a `components/KpiCard.tsx`.

### 4.5 Mapeamento categoria→cor/label duplicado — impacto: cosmético · custo: trivial
`CAT_DOT` ([Prioridades.tsx:79](frontend/src/pages/Prioridades.tsx#L79)) e `CAT_INFO` ([DashboardGeral.tsx:33](frontend/src/pages/DashboardGeral.tsx#L33)) — mesmas 4 categorias, mesmas cores. Se a cor de "Alta" mudar, muda em dois lugares. O array `CATS` também existe em 3 arquivos.

### 4.6 Lógica de `escopoLabel` triplicada — impacto: cosmético · custo: trivial
[Prioridades.tsx:316](frontend/src/pages/Prioridades.tsx#L316), [DashboardGeral.tsx:154](frontend/src/pages/DashboardGeral.tsx#L154), [DashboardCapacidade.tsx:162](frontend/src/pages/DashboardCapacidade.tsx#L162) — mesmo ternário de 3 casos. Vira um hook `useEscopoLabel` de 10 linhas.

---

## 5. CONTRATOS QUEBRADOS OU FRÁGEIS

### 5.1 Nome do gestor filtrado derivado de `itens[0]` — impacto: cosmético (UX) · custo: pequeno
[Prioridades.tsx:220](frontend/src/pages/Prioridades.tsx#L220) e [DashboardGeral.tsx:138](frontend/src/pages/DashboardGeral.tsx#L138) derivam `gestorNomeVis` de `itens[0]?.gestorNome`. Se o gestor filtrado tem **zero projetos** no mês, o rótulo fica travado em "visualizando como …" (reticências). O endpoint `/capacidade` já resolve isso devolvendo `gestorNome` no payload — os outros dois endpoints poderiam fazer o mesmo (o backend já busca o nome do gestor pra validar o filtro).

### 5.2 "Custo Previsto" mostra `R$ 0` quando não há custo calculável — impacto: cosmético · custo: trivial
[DashboardGeral.tsx:234](frontend/src/pages/DashboardGeral.tsx#L234) — `fmtMoeda(totalPlan)` renderiza "R$ 0" quando todos os `custoPlanejado` são null (sem tarifa cadastrada). A faixa de veredito do Prioridades trata o mesmo caso com `'R$ —'` ([Prioridades.tsx:679](frontend/src/pages/Prioridades.tsx#L679) região). Telas irmãs, comportamentos diferentes para o mesmo dado.

Fora isso, não encontrei campo lido pelo frontend que o backend não mande mais — os acessos a `[0]` que existem usam optional chaining.

---

## 6. ESTADOS VAZIOS E DE ERRO

### 6.1 `Projetos.tsx` engole erros de rede e de API — impacto: funcional · custo: trivial
- `fetchProjetos` ([Projetos.tsx:124-134](frontend/src/pages/Projetos.tsx#L124-L134)): `try/finally` **sem catch** — erro de rede vira unhandled rejection; `res.ok === false` é silenciosamente ignorado. O usuário vê lista vazia sem nenhuma mensagem, indistinguível de "não há projetos".
- `fetchCategorias` ([Projetos.tsx:138-143](frontend/src/pages/Projetos.tsx#L138-L143)): sem try/catch nenhum.

É o único caso claro que encontrei — as demais telas têm `catch` + estado de erro (Custos, Prioridades, DashboardGeral, DashboardCapacidade, Remanejamento, GridAlocacao, cadastros).

---

## 7. CÓDIGO MORTO

### 7.1 `noUnusedLocals: false` no tsconfig do frontend — impacto: cosmético · custo: trivial
[frontend/tsconfig.json:15-16](frontend/tsconfig.json#L15-L16) — com essa flag desligada, `tsc --noEmit` limpo **não garante** ausência de imports/variáveis mortas. Ligar a flag é a forma barata de fazer o compilador auditar isso para sempre (vai apontar uma lista na primeira rodada; corrigir é mecânico).

### 7.2 O arquivo `Alocacoes.tsx` (já coberto no 1.2) é o maior bloco de código morto do frontend.

Não encontrei TODOs obsoletos nem funções órfãs evidentes no backend (o `generateId` de priorizacao.ts é usado no log de ações; `CONFIG_PRIORIZACAO_ID` é exportado e consumido).

---

## Top 5 — o que eu corrigiria primeiro

1. **Remanejamento para chefe (2.1)** — é um 403 garantido num fluxo que o menu oferece hoje; qualquer chefe que clicar já quebra. Trivial de corrigir e idêntico ao bug do Custos que já custou uma investigação.

2. **Grid para coordenação (2.3 + 3.1 juntos)** — o comentário afirma uma proteção que não existe, então ninguém vai procurar o bug ali. Coordenação editando célula e tomando 403 é frustração certa; e corrigir o código sem corrigir o comentário (ou vice-versa) deixa a armadilha armada de novo.

3. **Programas/Profissões para chefe (2.2)** — mais um 403 no fluxo oferecido pelo menu, com a agravante de existir em dobro (arquivos clones) e de o gestor ter acesso de escrita pela API sem a tela — precisa de uma decisão única de quem-pode-o-quê.

4. **`GET /colaboradores` com `valorHora` aberto ao diretor (2.5, com 2.6 e 2.9 na mesma leva)** — é a única classe de achado com dado sensível (tarifa por pessoa) atravessando a regra de papel por baixo da UI. O esforço de fechar os GETs órfãos de `requireRole` é uma passada só nos 3 arquivos.

5. **Fluxo de exclusão de projetos órfão (1.1)** — não quebra nada hoje, mas é literalmente o "caso Início" que motivou esta auditoria: funcionalidade inteira invisível por falta de visão do todo. Vale uma decisão explícita de produto (construir a UI ou remover), antes que alguém redescubra por acaso daqui a seis meses.
