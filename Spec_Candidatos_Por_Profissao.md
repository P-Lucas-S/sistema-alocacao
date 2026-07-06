# Spec — Montar equipe por profissão no grid (faixa de candidatos)

> Síntese do brainstorm de 4 IAs + decisões do gestor. É a **base dos prompts de implementação**. Implementar em pedaços pequenos, testados e aprovados um a um (cada um fecha com commit + push; migrations — se houver — mostradas antes; UI validada no navegador). Continua a feature "Profissão" (passos 1-3 já feitos; o filtro de esconder do 4b ainda não está commitado — ver §7).

## 0. Objetivo

O gestor quer **montar equipe por profissão direto no grid**: ao filtrar por uma profissão, ver não só quem ele já alocou, mas também os **candidatos** daquela profissão (colaboradores que ele ainda não alocou no mês), com a **disponibilidade** (horas livres no teto de 220h) de cada um, e **alocá-los ali mesmo** — sem sair do grid, sem atalho que fure o teto.

## 1. Decisões travadas (do brainstorm + gestor)

1. **A query do grid atual NÃO muda.** Os candidatos vêm de um **endpoint novo e separado**. Isso protege o saldo, o rodapé (custo real) e o teto/lock — zero risco de regressão na tela central. (Consenso unânime das 4 IAs.)
2. **Profissão é pré-requisito obrigatório.** A faixa de candidatos só existe quando uma profissão específica está selecionada no combobox. Sem profissão, nenhum candidato é carregado. É o limitador de escala nº 1.
3. **Faixa de candidatos NO próprio grid**, abaixo das linhas de alocados, visualmente separada (não é painel lateral, não é tela nova). Mantém candidato e colunas-projeto na mesma visão — o ponto do "sem sair do grid".
4. **Escala por limite fixo + esconder cheios:** o endpoint devolve no máximo ~15-20 candidatos, **ordenados por horas livres (desc)**, e **esconde quem já está em 220h** (`disponivel > 0`). Sem paginação. Se o gestor quer um nome específico fora do top, usa o **picker de busca por nome que já existe**.
5. **Alocar candidato passa pelo MESMO endpoint/lock/teto.** Clicar "alocar" num candidato abre o mesmo painel de macro/micro de sempre e dispara a mesma transação com lock pessimista. Nenhum atalho. (Consenso unânime.)
6. **Disponibilidade calculada em lote** (não N+1), só para os candidatos retornados — uma query agregada (`LEFT JOIN ... SUM ... GROUP BY`).
7. **Rodapé e saldo intocados:** como a query do grid não muda e candidatos não têm horas, o custo do projeto no rodapé nunca é afetado. Cai "de graça" da separação de queries.

## 2. Decisões de produto resolvidas

- **"Concorrência fantasma" é aceita, não é bug.** Se o gestor filtra candidatos, espera, e tenta alocar um cujo saldo já mudou (outro gestor pegou as horas), a alocação falha com 409 e a lista de candidatos é re-buscada silenciosamente. É o lock funcionando — exatamente o cenário pra que ele existe.
- **Re-fetch após alocar** (não atualização otimista): depois de alocar um candidato, o frontend re-busca o grid (a pessoa vira linha real de alocado) e a faixa de candidatos (some dali). Mais simples e sempre consistente com o lock.
- **Sem profissão = sem faixa.** Se o combobox está em "nenhuma profissão", o grid é exatamente o de hoje (só alocados). A faixa de candidatos não existe no DOM.
- **Fora de escopo (deliberado):** alocar candidato em lote, drag-and-drop de candidato pra célula, ver candidatos de várias profissões ao mesmo tempo, busca textual dentro dos candidatos. Todos aumentam superfície de erro sem serem essenciais; podem evoluir depois.

## 3. O endpoint novo

`GET /api/alocacoes/candidatos?profissaoId=X&ano=Y&mes=Z` (admin/gestor; o mesmo nível de acesso do grid).

**Lógica:**
1. Resolver os colaboradores que o gestor logado **já alocou** em qualquer projeto seu naquele (ano, mês) — a lista de exclusão (eles já são linhas de alocado, não candidatos).
2. Buscar colaboradores **ativos** cuja `profissaoId` = o filtro **e** que **não** estão na lista de exclusão.
3. Para cada um, calcular `totalAlocado` = soma de TODAS as alocações (todos os gestores) naquele (ano, mês), e `disponivel` = `220 - totalAlocado`. **Em lote** (uma query agregada), não um a um.
4. **Filtrar `disponivel > 0`** (esconde quem está cheio).
5. **Ordenar por `disponivel` desc.**
6. **Limitar a ~15-20** (constante no backend).
7. Retornar: `[{ id, nome, email, profissao: {id, nome}, totalAlocado, disponivel, valorHora }]`.

**Escopo do "já aloquei":** admin vê todos os projetos; gestor vê os seus. A exclusão usa o mesmo critério de escopo do grid (projetos do gestor logado, ou todos se admin).

**Importante:** este endpoint é **só leitura** — não toca alocação, não toca lock. O lock só entra quando o gestor efetivamente aloca um candidato (que usa o endpoint de alocação existente).

## 4. A faixa de candidatos no frontend (GridAlocacao.tsx)

- **Quando aparece:** só quando há `filtroProfissaoId` selecionado (o combobox que o 4b já adicionou). Sem profissão, a faixa não existe.
- **Onde:** abaixo das linhas de alocados, **abaixo do rodapé de custo** (pra deixar fisicamente claro que candidatos não compõem o custo do projeto), com um cabeçalho de seção: "Candidatos disponíveis · <Profissão> (N)".
- **Cada linha-candidato mostra:**
  - Nome, e-mail.
  - A barra de saldo (a mesma do grid: cor por lotação), mostrando `disponivel` / 220h. **Read-only** (clicar nela não faz nada).
  - Células alinhadas com as colunas de projeto, mas **inertes** (vazias, sem horas) — cada uma com um botão sutil "+ Alocar" (aparece no hover, no estilo do que o grid já faz pra célula vazia).
- **Estilo "desidratado"** pra distinguir de alocado: fundo levemente acinzentado, borda/linha tracejada, avatares/texto mais claros. Impossível confundir com uma linha real.
- **Alocar:** clicar "+ Alocar" na célula de um projeto → abre o **mesmo painel lateral de macro/micro** que já existe, pré-preenchido com colaborador + projeto → o gestor define horas e confirma → dispara o **endpoint de alocação existente** (mesmo lock, mesmo teto) → em caso de sucesso, re-busca o grid (a pessoa vira linha de alocado) e a faixa de candidatos (some dali) → em caso de 409 (teto/concorrência), mostra o erro e re-busca a faixa.
- **Caso vazio:** se há profissão selecionada mas nenhum candidato disponível (todos da profissão já estão com o gestor, ou todos estão em 220h), mostrar um aviso discreto: "Nenhum candidato disponível nesta profissão neste mês" (distinto do caso "nenhuma linha alocada bate o filtro" do 4b).

## 5. Invariantes protegidos (riscos)

- **Teto 220h + lock pessimista:** o único caminho de escrita é o endpoint de alocação existente — o candidato vira alocação normal. O endpoint de candidatos é **só leitura**. O teto não tem vetor novo.
- **Rodapé/saldo/query do grid:** intocados (decisão 1 + 7). Provar isso: depois de implementar, o `test-concorrencia` segue 8/8, e o rodapé não muda ao filtrar/mostrar candidatos.
- **Escala:** profissão obrigatória + `disponivel > 0` + limite fixo. O endpoint nunca devolve mais que ~15-20, e o cálculo de saldo só roda pros candidatos da profissão (dezenas, não 200+).

## 6. Ordem de implementação (pedaços pequenos)

> Pré-requisito: decidir o destino do **4b** (o filtro de esconder, não-commitado) — ver §7. A spec assume que o combobox de profissão no grid existe (veio no 4b).

1. **4c-backend — o endpoint de candidatos.** `GET /api/alocacoes/candidatos`: query de exclusão + agregação de saldo em lote + filtro `disponivel > 0` + ordenação + limite. Só leitura. Testado por API (.mjs): retorna candidatos da profissão, exclui quem o gestor já alocou, exclui quem está em 220h, ordena por disponível, respeita o limite, e o escopo admin vs gestor. **Sem tocar o grid nem o lock.**
2. **4c-frontend — a faixa de candidatos.** Em GridAlocacao.tsx: quando há profissão selecionada, buscar os candidatos e renderizar a faixa abaixo do rodapé, com estilo desidratado, células inertes com "+ Alocar". Validado no navegador (a faixa aparece com profissão, some sem; estilo distinto; caso vazio).
3. **4c-alocar — alocar candidato pela faixa.** O "+ Alocar" abre o painel existente pré-preenchido; confirmar dispara o endpoint de alocação existente; sucesso re-busca grid + faixa; 409 mostra erro + re-busca. Validado no navegador (alocar um candidato → ele migra pra alocado; tentar furar o teto → 409 tratado).

Cada passo: lógica testada via API (script) antes/junto da tela; UI validada no navegador; commit + push ao fechar.

## 7. Pendência a resolver antes (o 4b)

O filtro de profissão que **esconde** linhas de alocados (o 4b) está pronto mas **não commitado**. Ele e a faixa de candidatos convivem: o 4b filtra os **alocados** pela profissão (topo do grid), e a faixa mostra os **candidatos** da mesma profissão (abaixo). Os dois usam o mesmo `filtroProfissaoId`. Decisão: **commitar o 4b** (ele é a base — o combobox de profissão no grid vem dele, e filtrar os alocados por profissão é útil e complementa a faixa). A spec assume o 4b commitado como ponto de partida.
