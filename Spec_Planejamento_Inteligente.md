# Spec — Planejamento Inteligente de Equipe (v1.1)

> Síntese do brainstorm de 4 IAs + respostas da cliente (03/07/2026 manhã: insumo = **R$**; escopo = **período**) + a estratégia dela (equipe atual primeiro) + **a revisão dela da mesma manhã (10h29–10h32)**, que substitui o cadastro de despesas mensais pela **Meta Mensal de Apropriação computada**. Esta v1.1 substitui a v1.0. Implementar em fases pequenas (cada uma testada, aprovada e commitada).

**O que mudou da v1.0 → v1.1:** sai a entidade `DespesaMensal` (cadastro mês a mês — a própria cliente o rejeitou: "o cronograma de desembolso deve ser um resultado do planejamento, não a origem"). Entram: campos financeiros no Projeto (valor total, valor oficial, vigência) + Meta Mensal de Apropriação **derivada** + ajuste manual opcional por mês. Nada do motor/tela/aplicação muda; só a fonte do alvo.

## 0. A dor (reenquadrada pela cliente)

"Não existe uma validação que informe se essas horas serão suficientes para gerar a receita necessária para cobrir as despesas daquele mês." Refinamento dela: **só contam as despesas que dependem de apropriação de Horas Técnicas (HT)** — despesas pagas diretamente pelo financiador (o "valor oficial": terceiros externos, equipamentos, viagens, materiais etc.) não consomem capacidade da equipe e ficam fora do cálculo.

O alvo do motor: **cobrir a meta de apropriação de HT de cada mês do projeto.**

## 1. O que a feature é (numa frase)

Um assistente no detalhe do projeto que mostra a **meta mensal de apropriação de HT × receita planejada** (cobertura mês a mês), **sugere** uma distribuição de equipe para cobrir o déficit — priorizando quem já está no projeto — e deixa o gestor **revisar, editar e aplicar**, passando cada alocação pelo mesmo caminho guardado de hoje.

## 2. Decisões travadas

1. **Cronograma é resultado, não origem** (cliente, 10h31): nenhum cadastro mensal obrigatório. O gestor informa 3 números no projeto; o sistema deriva a meta mensal.
2. **Só despesas dependentes de HT contam** (cliente): valorHT = valorTotal − valorOficial. Rubricas detalhadas NÃO entram no sistema — colapsam nesses dois números.
3. **Período multi-mês** (cliente): motor mensal em loop pelos meses abertos (máx. 12 por rodada). Mês único = período de 1.
4. **Motor guloso determinístico e transparente** (consenso 4 IAs): sem IA, sem otimização pesada. O produto é a confiança do gestor.
5. **Unidade nativa em horas; R$ é o critério de parada por mês**, consumido incrementalmente (horas × tarifa resolvida da pessoa na categoria do projeto). **Nunca por tarifa média.**
6. **Preenchimento em camadas** (estratégia da cliente): fixados → quem já está no projeto → externos; dentro da camada, maior disponibilidade primeiro (desempate por nome). Minimiza alterações na equipe.
7. **Semântica completar-até**: o que já está planejado conta como receita; a sugestão mira só o gap. Dupla aplicação = delta zero.
8. **Aditiva, nunca destrutiva.** Apagar continua manual no grid. Redistribuição subtrativa fora da v1.
9. **Sem transbordo entre meses**: a meta de julho vence em julho — déficit não coberto é reportado no próprio mês.
10. **Sugestão nunca aplica sozinha**; linguagem de "sugestão" em toda a UI.
11. **Custo/receita sempre visível.** Determinismo total + snapshot carimbado.
12. Os "dois modos" da cliente = **um motor** (§9).

## 3. O modelo de dados (o que entra no banco)

**Campos novos no Projeto** (todos opcionais/nullable — projeto sem eles usa o fallback):
- `vigenciaInicio`, `vigenciaFim` (datas) — **investigar na F1 se já existem**; adicionar se faltarem.
- `valorTotal` (Decimal) — valor total do projeto.
- `valorOficial` (Decimal) — pago diretamente pelo financiador, sem apropriação de HT.
- `valorHT` **não é coluna**: derivado (valorTotal − valorOficial), exibido.

**Entidade mínima de ajuste** (esparsa — só existe onde o gestor mexeu):
- `MetaMensalAjuste`: `id`, `projetoId` (FK), `ano`, `mes`, `metaHT` (Decimal), timestamps. `UNIQUE(projetoId, ano, mes)`.
- Permissões espelham a edição do projeto (dono/chefe/admin escrevem; papéis de leitura leem).

Migrations **mostradas antes de aplicar**. **Fronteira:** nada além disso — sem rubricas, repasses, receita realizada, ICF/ISF, medições cadastradas. O módulo financeiro completo segue horizonte v2/v3 (a cliente concordou: "não transformar o sistema em um ERP financeiro").

## 4. A Meta Mensal de Apropriação (computada, não cadastrada)

Para um projeto com vigência + valores preenchidos:
- **Medição mensal** = valorTotal ÷ nº de meses da vigência (uniforme — aproximação assumida; o ajuste manual cobre cronogramas específicos).
- **Estratégia padrão ("priorizar meses iniciais")**: o valorOficial cobre as medições desde o 1º mês até esgotar; a partir daí a medição vira 100% HT. `metaHT_m = medição_m − oficialAlocado_m`.
- **Ajuste manual**: um `MetaMensalAjuste` no mês sobrescreve o `metaHT_m` computado daquele mês. Se Σ metas (computadas + ajustadas) divergir do valorHT, o sistema **avisa** (não bloqueia).
- Tudo **computado sob demanda** (filosofia da casa — mesma da priorização/dashboards); só os ajustes persistem.

**Resumo financeiro do projeto** (derivado): valorTotal · valorOficial · valorHT · % já planejado (Σ receita planejada do período ÷ valorHT) · saldo de HT. Exibido no detalhe do projeto e no passo 1 do wizard.

**Fora da v1**: estratégia "distribuição proporcional" do oficial (seletor v1.1 trivial); medições não-uniformes automáticas.

## 5. O modelo financeiro mínimo (tudo reuso)

- **Receita planejada do mês** = Σ (horas planejadas × tarifa resolvida) — **o mesmo cálculo do `custoPlanejado` do dashboard (D1)**, mesma `lib/tarifa.ts`, escopado ao projeto+mês. Custo para o gestor = receita apropriada para o projeto.
- **Cobertura do mês** = receita planejada ÷ metaHT. **Déficit** = metaHT − receita planejada (quando > 0).
- Premissa registrada: valor-hora único serve como custo E taxa de apropriação. Se um dia faturamento ≠ custo, o modelo separa (pergunta futura; não bloqueia).

## 6. O motor de sugestão

**Entradas:** projeto; período (meses abertos, default = vigência, máx. 12); macro destino (micro "Geral"); profissão (opcional); fixar[]; excluir[]; máx. de colaboradores **novos** (opcional).

**Alvo por mês:** `alvoR$_m = max(0, metaHT_m − receitaPlanejada_m)`. Projeto **sem** valores/vigência → **fallback**: orçamento digitado no wizard ÷ nº de meses do período, cada fatia tratada como meta do mês (mesma semântica completar-até).

**Candidatos:** ativos, com a profissão (se filtrada), fora dos excluídos. Disponibilidade do mês = 220 − total alocado global (a conta de saldo existente).

**Distribuição por mês, nesta ordem:** (1) fixados; (2) quem já tem alocação no projeto no período; (3) externos — cada camada por disponibilidade desc, desempate por nome; "máx. de novos" corta na camada 3. Blocos de **4h** (constante ajustável) consumindo o alvo (bloco × tarifa resolvida); o **último bloco do mês** fecha o déficit com o mínimo de horas inteiras (pequeno superávit permitido e reportado), truncado na disponibilidade. Sobra = **déficit reportado do mês**.

**Determinismo:** sem aleatoriedade, ordenação estável, mesma entrada → mesma saída; snapshot carimbado com horário.

**"Porquê" por linha:** "já está no projeto · 65h livres em jul · tarifa R$ 150/h (FINEP)".

## 7. A tela (wizard em 2 passos, no detalhe do projeto)

Botão **"Planejar equipe"** no detalhe do projeto. Sem item de menu novo.

**Passo 1 — Parâmetros:** abre já com o **resumo financeiro** (§4) + o **quadro de cobertura do período** (mês | meta HT | receita planejada | déficit) — este quadro sozinho já é a "análise" do Modo 2 da cliente. Meses sem meta (fora da vigência/sem valores) sinalizados; fallback de orçamento digitado quando o projeto não tem valores. Campos: período (meses fechados fora), macro destino, profissão, fixar/excluir, máx. de novos.

**Passo 2 — Revisão:** tabela **pessoas × meses** editável; por linha: nome, profissão, porquê, total de horas, receita gerada; cabeçalho vivo por mês: meta | planejado+sugerido | déficit restante. **Editar não recalcula as outras linhas**; botão **"Redistribuir restante"** (re-resolve só linhas não tocadas; pode ficar pra fase de polimento). Capacidade insuficiente: sugestão parcial + déficit por mês + quem está no teto + link pro remanejamento (sem criar pedidos). Aviso de snapshot envelhecido. "+ Adicionar colaborador" (busca com disponibilidade).

**A seção "Meta de Apropriação" no detalhe do projeto** (fora do wizard): a tabela mês | medição | oficial | meta HT, com edição do metaHT por mês (grava/remove `MetaMensalAjuste`) e o aviso de divergência. O wizard **lê** a meta; a edição mora no projeto.

## 8. A aplicação

"Aplicar N alocações" → confirmação (N alocações, X horas, R$ Y de receita) → **loop sequencial no frontend chamando o `POST /api/alocacoes` existente, célula a célula** — zero caminho novo de escrita; lock, teto, mês fechado e posse valem por chamada. Progresso visível. **Relatório bloqueante** linha a linha: aplicada ✓ | falhou por teto/corrida (quanto caberia agora) | mês fechado — com **"ajustar e reaplicar falhas"**. Aditiva sempre.

## 9. Como isso entrega os "dois modos" da cliente

- **Modo 1 (projeto novo):** wizard com equipe atual vazia — distribui entre externos.
- **Modo 2 (otimizar equipe atual):** o mesmo wizard num projeto em andamento — o quadro de cobertura é a análise ("a equipe atual ainda gera R$ X; permanece déficit R$ Y"), e a sugestão estica a equipe atual antes de trazer externos.

E o **resumo financeiro + saldo de HT abatido conforme se aloca** (a narrativa dela das 10h29) é exatamente o quadro do passo 1 + a seção do detalhe do projeto.

## 10. Fase 0 — posse na escrita de alocação (pré-requisito, inalterada)

O furo: `POST /alocacoes` não valida dono. Conserto: padrão existente (`role === 'gestor' && não-dono → 403`, chefe/admin passam) nos caminhos de escrita, **começando pela investigação** dos casos legítimos cross-gestor (remanejamento não pode quebrar). Prova: `test-concorrencia` 8/8 + suíte + teste novo do 403. **Não depende de nada desta revisão — pode rodar já.**

## 11. Fora da v1 (fronteira explícita)

- Módulo financeiro completo (rubricas detalhadas, repasses, receita realizada, ICF/ISF, projeções, medições cadastradas).
- Estratégia "distribuição proporcional" do valor oficial (v1.1 trivial); estratégias configuráveis.
- Redistribuição subtrativa; otimização de carteira multi-projeto; composição por quantidades de profissão; mínimo de horas por pessoa; modo "menor custo"; férias/ausências (candidato a v2); persistência de rascunho da sugestão; criação automática de remanejamento.

## 12. Fases de implementação

- **F0 — Posse na escrita** (§10): investigação + 403 + testes (8/8 re-rodado). *Prompt já entregue.*
- **F1 — Campos financeiros do Projeto**: investigar vigência no schema; migration (nullable: valorTotal, valorOficial, vigência se faltar) mostrada antes; campos no form do projeto; resumo financeiro simples no detalhe. Testes API.
- **F2 — Meta Mensal (backend)**: endpoint read-only da meta/cobertura do período (medição uniforme + oficial-first + ajustes + receita planejada por mês, reusando o padrão do D1) + entidade `MetaMensalAjuste` + rota de ajuste. Testes (inclui: oficial esgotando no meio do mês, ajuste sobrescrevendo, divergência Σ, projeto sem valores).
- **F3 — Seção "Meta de Apropriação" (frontend)**: a tabela no detalhe do projeto com edição do metaHT + resumo com % planejado. Print nos 2 temas.
- **F4 — Motor de sugestão (backend)**: endpoint read-only; testes de camadas na ordem, consumo R$ com tarifa-override, teto, fixado primeiro, excluído ausente, mês sem meta pulado, fallback digitado, **determinismo** (duas chamadas → mesmo resultado).
- **F5 — Wizard (passos 1–2)**: parâmetros + revisão editável, sem aplicar. Print nos 2 temas.
- **F6 — Aplicação + relatório**: loop pelas escritas existentes; reaplicar falhas; validação com cenário de teto estourando no meio.
- **F7 — Polimentos**: Redistribuir restante; aviso de snapshot; link remanejamento no déficit (o que não entrou antes).

Cada fase fecha com commit; backend provado por `.mjs`, frontend por print.

## 13. Armadilhas mapeadas (e as defesas da v1)

| Armadilha | Defesa |
|---|---|
| Carimbo automático (gestor para de pensar) | Revisão obrigatória; porquê por linha; relatório bloqueante |
| Cegueira ao contexto humano (férias, pessoa-chave) | Fixar/excluir de primeira classe; linguagem de "sugestão" |
| Viés de gente barata | Camadas por disponibilidade não otimizam custo; "menor custo" não existe na v1 |
| Instabilidade da sugestão | Determinismo; recálculo só por botão explícito |
| Falha parcial mascarada | Relatório linha a linha, bloqueante |
| Matriz ingovernável | Máx. 12 meses; totais por linha; só sugeridos aparecem (+ adicionar manual) |
| Corrida gestor×gestor entre gerar e aplicar | Lock por chamada (invariante); snapshot carimbado com aviso |
| Fragmentação (muita gente com pouca hora) | Camadas equipe-atual-primeiro; blocos de 4h; máx. de novos |
| Medição uniforme longe da real | Ajuste manual por mês; aviso de divergência Σ metas × valorHT |

## 14. Pendências registradas (não bloqueiam)

1. **Confirmar o modelo consolidado com a cliente antes da migration da F1** (2 linhas: "o projeto informa vigência + valor total + valor oficial; o sistema calcula a meta mensal automaticamente, oficial primeiro; ajuste por mês quando precisar — certo?"). Trava o churn.
2. Vigência no schema do Projeto — investigação da F1.
3. Premissa custo = receita (valor-hora único) — separar só se a cliente distinguir taxa de faturamento.
4. Rótulo da feature ("Planejamento Inteligente"; botão "Planejar equipe") — validar com a cliente.
5. Antigas: prorrogação de prestações; papel Consulta; rótulos Coordenação/Consulta/Gerência.
