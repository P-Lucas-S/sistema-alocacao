# Spec — Planejamento Inteligente de Equipe (v1.4)

> Fonte da verdade da feature prioritária. Síntese do brainstorm de 4 IAs + respostas da cliente (03/07 e 06/07/2026). Consolida v1.0→v1.3. Implementar em fases pequenas (cada uma testada, aprovada, commitada). **Estado de implementação marcado por fase na §12.**

## Histórico de versões
- **v1.0→v1.1** (03/07 manhã): sai a entidade `DespesaMensal` (cadastro mês a mês — a cliente rejeitou: "o cronograma de desembolso deve ser um resultado do planejamento, não a origem"). Entram campos financeiros no Projeto + Meta Mensal **derivada** + ajuste manual por mês.
- **v1.1→v1.2** (03/07): confirmação dos knobs — insumo = **R$** (orçamento), escopo = **período** multi-mês. As 3 estratégias de distribuição do oficial (inicial/proporcional/personalizada) entram na v1.
- **v1.2→v1.3** (06/07): a mecânica de ajuste manual ganhou algoritmo definido pela cliente — **cascata proporcional ao déficit**, com **dois tipos de mês intocável** (fechado + pinado) e **fallback de saldo não-planejado** (aviso simples). Nova candidata futura: Painel de Receita Disponível.
- **v1.3→v1.4** (06/07): a cliente definiu o **sentido inverso** da cascata (pinar acima, puxando saldo), revelando que a cascata é **simétrica** e regida por um princípio único — *nunca criar/piorar déficit automaticamente*. Liberar distribui a quem tem déficit; puxar retira de quem tem folga; se não dá sem criar problema → alerta + decisão manual (a UI da decisão manual é fase de tela futura).

## 0. A dor (reenquadrada pela cliente)
"Não existe uma validação que informe se essas horas serão suficientes para gerar a receita necessária para cobrir as despesas daquele mês." Refinamento: **só contam as despesas que dependem de apropriação de Horas Técnicas (HT)** — o "valor oficial" (terceiros, equipamentos, viagens, materiais, pago direto pelo financiador) não consome capacidade da equipe e fica fora. O alvo do motor: **cobrir a meta de apropriação de HT de cada mês.**

## 1. O que a feature é (numa frase)
Um assistente no detalhe do projeto que mostra a **meta mensal de apropriação de HT × receita planejada** (cobertura mês a mês), **sugere** uma distribuição de equipe para cobrir o déficit — priorizando quem já está no projeto — e deixa o gestor **revisar, editar e aplicar**, passando cada alocação pelo mesmo caminho guardado de hoje.

## 2. Decisões travadas
1. **Cronograma é resultado, não origem** (cliente 10h31; confirmado 03/07 14h34): nenhum cadastro mensal obrigatório. O gestor informa 3 números no projeto; o sistema deriva a meta.
2. **Só despesas dependentes de HT contam**: valorHT = valorTotal − valorOficial. Rubricas colapsam nesses dois números.
3. **Insumo em R$; período multi-mês** (confirmado 03/07): motor mensal em loop pelos meses abertos (máx. 12/rodada). Mês único = período de 1.
4. **Motor guloso determinístico e transparente** (consenso 4 IAs): sem IA, sem otimização pesada. O produto é a confiança do gestor.
5. **Unidade nativa em horas; R$ é o critério de parada por mês**, consumido incrementalmente (horas × tarifa resolvida). **Nunca por tarifa média.**
6. **Preenchimento em camadas** (estratégia da cliente): fixados → quem já está no projeto → externos; dentro da camada, maior disponibilidade primeiro (desempate por nome).
7. **Semântica completar-até**: o planejado conta como receita; a sugestão mira só o gap. Dupla aplicação = delta zero.
8. **Aditiva, nunca destrutiva.** Apagar continua manual no grid.
9. **Sem transbordo entre meses**: a meta de julho vence em julho — déficit não coberto é reportado no próprio mês.
10. **Sugestão nunca aplica sozinha**; linguagem de "sugestão" em toda a UI.
11. **Custo/receita sempre visível.** Determinismo total + snapshot carimbado.
12. Os "dois modos" da cliente = **um motor** (§9).

## 3. O modelo de dados
**Campos no Projeto** (nullable; projeto sem eles cai no fallback) — **IMPLEMENTADO (F1)**:
- `vigenciaInicio`, `vigenciaFim` (DATE) — não existiam, foram adicionados.
- `valorTotal`, `valorOficial` (Decimal 10,2).
- `estrategiaOficial` (String, default 'inicial') — 'inicial' | 'proporcional'.
- `valorHT` derivado (valorTotal − valorOficial), não é coluna.

**Entidade `MetaMensalAjuste`** (o pino) — **IMPLEMENTADO (F2b-i)**: `id`, `projetoId` (FK onDelete Cascade), `ano`, `mes`, `metaHT` (Decimal 10,2), timestamps, `UNIQUE(projetoId, ano, mes)`. Esparsa — só existe onde o gestor pinou. Posse espelha a edição do projeto.

Migrations **mostradas antes de aplicar**. **Fronteira:** sem rubricas, repasses, receita realizada, ICF/ISF, medições cadastradas — módulo financeiro completo é horizonte v2/v3 (a cliente: "não transformar num ERP financeiro").

## 4. A Meta Mensal de Apropriação (computada) — **IMPLEMENTADO (F2a)**
Para projeto com vigência + valores:
- **Medição mensal** = valorTotal ÷ nº de meses (uniforme). O **último mês absorve o resíduo** de arredondamento → soma fecha EXATO (soma(medição)=valorTotal ao centavo).
- **Distribuição do oficial** conforme `estrategiaOficial`: **'inicial'** (cobre as medições dos primeiros meses até esgotar; depois medição é 100% HT) ou **'proporcional'** (reparte igual por todos os meses). Ambas com último-mês-absorve-resíduo → soma(oficial)=valorOficial exato.
- **metaHT do mês** = medição − oficialAlocado. Invariante: **soma(metaHT) = valorHT exato**.
- Tudo **computado sob demanda**; só os pinos persistem.
- **Receita planejada do mês** = Σ (horas planejadas × tarifa resolvida) — reusa `carregarTarifas`/`resolverTarifa` de `lib/tarifa.ts` (a MESMA conta do dashboard D1), escopado ao projeto+mês.
- **Cobertura** = receita ÷ metaHT. **Déficit** = max(0, metaHT − receita).
- Endpoint: `GET /api/projetos/:id/meta-apropriacao` (read-only; posse do projeto). Projeto sem dados → `{ configurado: false }`.

### 4-bis. Ajuste manual da meta e cascata (a F2b)
**Pino** (**IMPLEMENTADO na F2b-i, sem cascata**): `PUT /:id/meta-apropriacao/pino {ano,mes,metaHT}` (upsert; valida metaHT≥0, mês na vigência, mês não fechado) e `DELETE /:id/meta-apropriacao/pino/:ano/:mes`. O GET lê o pino: `metaHTFinal = pino ?? calculado`; cada mês indica `pinado`. Estado intermediário honesto: `somaMetaHT` + `cascataPendente:true` quando há pino e a soma não fecha (a cascata da F2b-ii resolve).

**Cascata simétrica** (**PENDENTE — F2b-ii**, algoritmo da cliente 06/07). Princípio único: **nunca criar ou piorar déficit automaticamente**. Total HT fixo; soma fecha exato (último mês ajustado absorve resíduo). Método: **proporcional simples numa passada** (não iterativo — decisão pela transparência).

- **Dois tipos de mês intocável:** (1) meses **fechados** (prestação realizada / planejamento aprovado — mecanismo existente); (2) meses **pinados**. Os demais são **editáveis**.

- **Sentido LIBERAR** (pinar M ABAIXO do que tinha → sobra saldo): distribui o saldo entre os editáveis **com déficit** (metaHT > receita planejada), **proporcional ao déficit** (maior déficit recebe mais). Meses sem déficit não recebem.
  - Exemplo: R$ 12.666 liberados → abril (déficit 15k) e junho (déficit 22k) recebem proporcional; maio (déficit 0) não.
  - **Fallback liberar** (todos os editáveis com déficit zero): o saldo NÃO se distribui — vira **"receita não planejada"** com **aviso simples** ("R$ X não planejados — todos os meses já atingiram a meta"). Não é o painel (§11).

- **Sentido PUXAR** (pinar M ACIMA do que tinha → falta saldo): retira o valor dos editáveis **com folga/superávit** (receita planejada > metaHT), **proporcional à folga** (maior folga cede mais), **até o limite da folga de cada um** — nunca reduz um mês abaixo da sua receita planejada (isso criaria déficit novo). 
  - Exemplo da cliente: aumentar março em 18k → abril (folga 13k) cede 13k, maio (folga 8k) cede 5k, junho (sem folga) não cede. Zero déficit novo.
  - **Fallback puxar** (a folga total dos editáveis não cobre o aumento): o sistema **NÃO redistribui automaticamente**. Retorna estado **"precisa de decisão manual"**, informando quanto falta e quais meses têm quanta folga. As opções ao gestor (escolher de quais meses tirar / permitir déficit consciente / cancelar) são **UI — fase de tela (F3+), NÃO a F2b-ii**. A F2b-ii (backend) faz a redistribuição automática possível e **detecta/reporta** o impasse; não implementa a decisão manual.

- **A pergunta que o algoritmo responde** (formulação da cliente): "Se eu mexer neste mês, consigo compensar nos outros sem criar um novo problema financeiro? Sim → redistribui automático. Não → alerta e devolve o controle ao gestor."

**Resumo financeiro do projeto** (derivado): valorTotal · valorOficial · valorHT · % planejado · saldo de HT. No detalhe do projeto e no passo 1 do wizard.

## 5. O modelo financeiro mínimo (tudo reuso) — ver §4 (receita planejada, cobertura, déficit)
Premissa registrada: valor-hora único serve como custo E taxa de apropriação. Se um dia faturamento ≠ custo, o modelo separa (pergunta futura; não bloqueia).

## 6. O motor de sugestão — **PENDENTE (F4)**
**Entradas:** projeto; período (meses abertos, default = vigência, máx. 12); macro destino (micro "Geral"); profissão (opcional); fixar[]; excluir[]; máx. de colaboradores **novos** (opcional).
**Alvo por mês:** `alvoR$_m = max(0, metaHT_m − receitaPlanejada_m)`. Projeto sem valores/vigência → fallback: orçamento digitado ÷ nº de meses.
**Candidatos:** ativos, com a profissão (se filtrada), fora dos excluídos. Disponibilidade = 220 − total alocado global.
**Distribuição por mês:** (1) fixados; (2) quem já tem alocação no projeto no período; (3) externos — cada camada por disponibilidade desc, desempate por nome; "máx. de novos" corta na camada 3. Blocos de **4h** consumindo o alvo (bloco × tarifa); último bloco fecha o déficit com o mínimo de horas inteiras (pequeno superávit reportado), truncado na disponibilidade. Sobra = déficit reportado.
**Determinismo:** sem aleatoriedade, ordenação estável, mesma entrada → mesma saída; snapshot carimbado.
**"Porquê" por linha:** "já está no projeto · 65h livres em jul · tarifa R$ 150/h (FINEP)".

## 7. A tela (wizard em 2 passos, no detalhe do projeto) — **PENDENTE (F3 parcial, F5)**
Botão **"Planejar equipe"** no detalhe do projeto. Sem item de menu novo.
**Passo 1 — Parâmetros:** abre com o resumo financeiro (§4) + o quadro de cobertura do período (mês | meta HT | receita planejada | déficit). Meses sem meta sinalizados; fallback de orçamento digitado. Campos: período (meses fechados fora), macro destino, profissão, fixar/excluir, máx. de novos.
**Passo 2 — Revisão:** tabela **pessoas × meses** editável; por linha: nome, profissão, porquê, total de horas, receita gerada; cabeçalho por mês: meta | planejado+sugerido | déficit restante. **Editar não recalcula as outras linhas** (invariante da tabela de revisão — DIFERENTE da cascata da meta, que é da tabela financeira). Botão "Redistribuir restante" (F7). Capacidade insuficiente: sugestão parcial + déficit + quem está no teto + link pro remanejamento. Aviso de snapshot envelhecido. "+ Adicionar colaborador".
**Seção "Meta de Apropriação" no detalhe** (F3): tabela mês | medição | oficial | meta HT, com edição do metaHT (grava/remove o pino; cascata) + seletor de estratégia. O wizard **lê** a meta; a edição mora no projeto.

## 8. A aplicação — **PENDENTE (F6)**
"Aplicar N alocações" → confirmação → **loop sequencial no frontend chamando o `POST /api/alocacoes` existente, célula a célula** — zero caminho novo de escrita; lock, teto, mês fechado e posse valem por chamada. **Relatório bloqueante** linha a linha (aplicada / falhou por teto-corrida / mês fechado) com "ajustar e reaplicar falhas". Aditiva sempre.

## 9. Os "dois modos" da cliente = um motor
- **Modo 1 (projeto novo):** wizard com equipe atual vazia — distribui externos.
- **Modo 2 (otimizar equipe atual):** o mesmo wizard num projeto em andamento — o quadro de cobertura é a análise; a sugestão estica a equipe atual antes de trazer externos.

## 10. Fase 0 — posse na escrita de alocação — **IMPLEMENTADO (F0, commit 3310d02)**
`POST/PATCH/DELETE` de alocação validam dono (gestor não-dono → 403; chefe/admin passam). Remanejamento escreve por fora (não afetado). test-concorrencia 8/8 preservado.

## 11. Fora da v1 (fronteira explícita)
- **Painel de Receita Disponível** (proposta da cliente 06/07): painel cross-projeto que mostra a receita não-planejada, o equivalente em horas, e **sugere onde realocar** ("alocar no Projeto X, déficit Y"). Feature nova inteira — **candidata a futura (pós-v1)**. A F2b entrega só o aviso simples do saldo.
- **Cronograma financeiro real por mês** (despesa por competência digitada/importada): evolução futura confirmada pela cliente. Na v1 o déficit usa a meta automática. Quando existir, o déficit passa a ser sobre a despesa real.
- Módulo financeiro completo (rubricas, repasses, receita realizada, ICF/ISF, projeções).
- Redistribuição subtrativa na sugestão; otimização de carteira multi-projeto; composição por quantidades de profissão; mínimo de horas/pessoa; modo "menor custo"; férias/ausências (v2); persistência de rascunho; criação automática de remanejamento; water-filling na cascata (só se a cliente pedir distribuição mais "justa").

## 12. Fases de implementação (com estado)
- **F0 — Posse na escrita** ✅ FEITO (3310d02).
- **F1 — Campos financeiros do Projeto** ✅ FEITO (1b06ead): migration aditiva + form + resumo no detalhe + máscara de moeda (react-number-format).
- **F2a — Meta Mensal, cálculo (backend, read-only)** ✅ FEITO (2047c71): medição + estratégias + receita planejada (reuso D1); somas exatas ao centavo. 46/46.
- **F2b-i — Persistência do pino (sem cascata)** ✅ FEITO (9728b4e): entidade + rotas pinar/despinar + leitura no GET + estado `cascataPendente` honesto. 27/27.
- **F2b-ii — Cascata simétrica** ⏳ PRÓXIMA (destravada): backend. Liberar→distribui a quem tem déficit (∝ déficit); puxar→retira de quem tem folga (∝ folga, até o limite da folga); nunca cria déficit automático; impasse (puxar sem folga suficiente) e fallback (liberar sem déficit) reportados como estado, não resolvidos automaticamente. Método: proporcional simples. Testes: liberar → distribui ∝ déficit; liberar sem déficit → não-planejado + aviso; puxar → retira ∝ folga sem criar déficit; puxar sem folga → estado "decisão manual" (quanto falta, folga por mês); mês fechado e pinado intocáveis; **invariante soma(metaHT)=valorHT exato após a cascata**; remover pino → volta ao automático; interação com as 2 estratégias. A UI da decisão manual NÃO entra aqui (é F3+).
- **F3 — Seção "Meta de Apropriação" (frontend)** ⏳: tabela no detalhe com seletor de estratégia + edição do metaHT (pino/cascata) + resumo % planejado. Print 2 temas.
- **F4 — Motor de sugestão (backend)** ⏳: endpoint read-only; testes de camadas, consumo R$ com tarifa-override, teto, fixado/excluído, mês sem meta, fallback digitado, determinismo.
- **F5 — Wizard (passos 1–2)** ⏳: parâmetros + revisão editável, sem aplicar. Print 2 temas.
- **F6 — Aplicação + relatório** ⏳: loop pelas escritas existentes; reaplicar falhas; cenário de teto estourando no meio.
- **F7 — Polimentos** ⏳: Redistribuir restante; aviso de snapshot; link remanejamento no déficit.

Cada fase fecha com commit; backend provado por `.mjs`, frontend por print.

## 13. Armadilhas mapeadas (e as defesas da v1)
| Armadilha | Defesa |
|---|---|
| Carimbo automático (gestor para de pensar) | Revisão obrigatória; porquê por linha; relatório bloqueante |
| Cegueira ao contexto humano (férias, pessoa-chave) | Fixar/excluir de primeira classe; linguagem de "sugestão" |
| Viés de gente barata | Camadas por disponibilidade não otimizam custo; "menor custo" não existe na v1 |
| Instabilidade da sugestão | Determinismo; recálculo só por botão explícito |
| Falha parcial mascarada | Relatório linha a linha, bloqueante |
| Matriz ingovernável | Máx. 12 meses; totais por linha; só sugeridos aparecem |
| Corrida gestor×gestor entre gerar e aplicar | Lock por chamada (invariante); snapshot carimbado |
| Fragmentação (muita gente com pouca hora) | Camadas equipe-atual-primeiro; blocos de 4h; máx. de novos |
| Resíduo de arredondamento na meta/cascata | Último mês/editável absorve o resíduo → soma exata ao centavo |

## 14. Pendências registradas
1. ✅ Modelo confirmado pela cliente (03/07 14h34).
2. ✅ **Sentido inverso da cascata** resolvido (cliente 06/07): puxar retira de quem tem folga, proporcional à folga, sem criar déficit; sem folga suficiente → impasse reportado + decisão manual (UI futura). F2b-ii destravada.
3. Premissa custo = receita (valor-hora único) — separar só se a cliente distinguir faturamento de custo.
4. Rótulo da feature ("Planejamento Inteligente"; botão "Planejar equipe") — validar com a cliente.
5. Antigas (fora desta feature): prorrogação de prestações; papel Consulta; rótulos Coordenação/Consulta/Gerência.
