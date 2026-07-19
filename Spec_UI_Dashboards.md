# Spec de UI dos Dashboards — v1.0

> **Escopo:** a FORMA visual dos três dashboards (Geral, Projetos, Capacidade). Os **dados** já estão definidos em `Spec_Dashboards.md` §3 e não mudam aqui. Síntese de um brainstorm de 4 IAs sobre desenho de interface, com as decisões arbitradas.
>
> **Motivo:** o Dashboard Projetos foi implementado seguindo a spec de dados e virou uma tabela de 13 colunas — correta, mas sem cara de painel. Esta spec resolve a forma antes de construir os outros dois.

---

## 1. O princípio arquitetural

Cada tela tem **duas camadas**:

- **Camada de veredito** (topo): agregados que respondem *"está bem ou mal?"* em dois segundos. **Universal a todos os papéis.**
- **Camada de evidência** (corpo): as linhas que respondem *"onde exatamente?"*. **Recortada por papel.**

A diferença entre tabela e painel não é estética — é **ordem de leitura**. O painel entrega o veredito antes de ser lido; a tabela exige leitura para extrair o veredito. Toda decisão abaixo deriva disso.

Na implementação, isso vira literalmente dois componentes por aba: `<FaixaVeredito>` (universal) + `<CorpoEvidencia>` (variante por papel). É o que faz "um dashboard que se adapta" ser verdade na arquitetura, não só no discurso.

---

## 2. Decisões transversais (valem nas três abas)

### 2.1 Navegação: abas, não telas separadas
Um item de menu (**"Painéis"**), três abas: **Geral | Projetos | Capacidade** (ordem = funil: "está tudo bem?" → "quais projetos?" → "quem?").

**Cabeçalho compartilhado** entre as abas: seletor de mês · label de escopo · "ver como gestor" (liderança) · engrenagem de configuração.

**Razão prática:** trocar de aba **não pode resetar o mês**. O fluxo real é "Geral diz que julho tem problema → Projetos de julho → Capacidade de julho". Três itens de menu com estado próprio quebram esse fio.

### 2.2 Zero biblioteca de gráficos
Tudo é `div` com `width` em % — herda as CSS vars do tema de graça, combina com as barras de ocupação que já existem no grid, zero bundle, zero problema de acessibilidade de canvas.

**Reconsiderar apenas** quando surgir série temporal ("evolução mês a mês"). Até lá, biblioteca é peso morto.

### 2.3 Cor sinaliza ESTADO, não CLASSIFICAÇÃO
A regra que resolve o mar de badges vermelhos:

- **Classificação** (categoria Alta/Média/Baixa) pode ser comum e legítima — 40 projetos em Alta é um mês normal. Se classificação grita vermelho, o vermelho vira papel de parede.
- **Estado** (prestação vencida, ocupação ≥95%, gargalo) é exceção — merece o vermelho/⚠ que o sistema já usa.

Concretamente: **badge de categoria em tratamento mudo** (outline, ou dot colorido + texto neutro). **Vermelho preenchido reservado a violação.**

Dois complementos:
- **Máximo um alarme por linha.** Se o projeto está em Alta, vencido e com gargalo, a linha não pisca três vezes: o vencido carrega o alarme, o resto fica nas células.
- **KPI de exceção zerado renderiza mudo.** "0 em sobrecarga" em cinza, não verde comemorando. Cor só quando há o que ver.

### 2.4 Layout estável
Mesmas posições todo dia — o usuário desenvolve memória espacial e lê **deltas** ("ontem eram 3 em sobrecarga, hoje 5") em vez de re-ler a tela.

Isso **proíbe**: blocos que aparecem/somem conforme o estado, animações de entrada, hero numbers ocupando um terço da tela. Denso e imediato envelhece bem; "impressionante" envelhece mal.

### 2.5 Ausência de dado vs. estado vazio (são coisas diferentes)

**Ausência de dado** (não há apontamento) deve parecer intencional e quieta:
- `—` em muted, com tooltip "nenhuma hora apontada neste mês". **Nunca vermelho** — ausência não é alarme.
- Barra de execução sem realizado: **contorno vazio**, não preenchimento a 0%. Um 0% visual afirma "não foi feito" — exatamente a mentira que a regra travada proíbe.
- O alarme da ausência já existe agregado e acionável na **taxa de apontamento** — que carrega a mensagem *uma vez*, em vez de 40 "N/D" gritando numa coluna.
- **Implementação:** um formatter único (`fmtRealizado()`) por onde passa todo realizado/percentual do sistema. É o único lugar onde `null` vs `0` se decide, e isso torna a regra impossível de vazar.

**Estado vazio real** (não há projetos/pessoas no mês) ganha voz: causa + ação.
- "Nenhum projeto ativo em julho/2026" + [trocar mês] [ir para alocação].
- Texto diferente para mês futuro ("alocação ainda não planejada").
- **Nunca** a moldura da tabela com cabeçalhos e zero linhas — isso lê como bug.
- Interno e diário: uma frase e um botão, sem ilustração.

### 2.6 Escopo comunicado uma vez
Uma linha discreta e permanente no cabeçalho compartilhado, ao lado do seletor de mês:
- "Escopo: seus 14 projetos" / "Escopo: todos os gestores" / "Escopo: visualizando como João" (o "ver como" já a altera).

Uma vez, sempre no mesmo lugar. **Nunca** banner, toast, ou repetição por seção.

### 2.7 Adaptar por omissão, nunca por bloqueio
O diretor abrindo uma lista em que não pode clicar frustra — e pior, **vaza informação pela forma** (a existência das linhas já comunica).

Para o diretor, o corpo de Projetos e Capacidade **troca a tabela por blocos agregados**, montados com os *mesmos componentes* da faixa de veredito. A tela dele parece completa porque **é** — só que em outra altitude.

Efeito colateral necessário: contadores que para os demais são clicáveis, para ele renderizam como **texto plano** — sem estilo de link, sem cursor, nunca link morto.

### 2.8 Drill-down: só o barato
Todo contador da camada de veredito que conta coisas existentes como linha em outra aba é um **link que abre a aba com o filtro aplicado**:
- "5 em Alta" → Projetos filtrado por Alta.
- "3 em sobrecarga" → Capacidade filtrado por Risco.

Custa uma troca de aba + query param, e ensina o modelo mental: **Geral é o índice**. Mais que isso (drill aninhado, breadcrumbs, clique em toda parte) complica sem retorno.

---

## 3. Aba GERAL — "a operação está saudável?"

**Sem tabela, nunca.** É a identidade da tela: só agregados.

**3.1 Faixa de veredito — 5 números:**
Projetos ativos · Custo planejado (R$) · Horas planejadas · Headcount alocado · **Em sobrecarga** (vermelho se >0; clicável → Capacidade filtrado por Risco).

Números grandes, labels pequenos. Só planejados — os dados travados de Geral não incluem realizado, e está correto assim.

**3.2 Bloco Prazo:**
4 **chips** clicáveis (Alta · Média · Baixa · Sem prazo) com dot colorido + contagem + label → cada um abre Projetos filtrado.
Opcional: barra 100% empilhada de 8px logo abaixo, para proporção de relance.

**Não** rosca, **não** pizza: são 4 valores nomeados, e o cérebro compara números mais rápido que ângulos.

**3.3 Bloco Taxa de Apontamento:**
- **Gestor:** % grande com cor contextual (verde >80%, âmbar 50–80%, vermelho <50%) + "X de Y horas com realizado".
- **Liderança:** **ranking** — nome · barra horizontal · % — **ordenado do pior para o melhor** (a ação é cobrar quem não preenche). É o único caso que ganha barras de verdade, porque existe comparação.

**Nota:** a taxa de apontamento é a métrica mais importante do conjunto — ela é o **medidor de confiança do próprio painel**. Se metade do realizado falta, todos os outros números ficam sob suspeita.

**3.4 Diretor:** exatamente esta tela, com os contadores como texto plano.

---

## 4. Aba PROJETOS — "quais projetos exigem atenção?"

**4.1 Faixa de veredito** — uma linha (não cards altos):
"N projetos · nA em Alta · nP prestações ≤X dias · nS sem apontamento · R$ total planejado"

Reflete o **escopo** e **ignora filtros ativos** — é o sumário do todo, não da seleção.

**4.2 Chips de categoria = filtros toggle** (mesmo componente do Geral). Chegar via clique no Geral pré-ativa o chip correspondente.

**4.3 A tabela — 8 colunas por fusão de conceitos** (era 13; nenhum dado se perde):

| # | Coluna | Conteúdo |
|---|---|---|
| 1 | **Projeto** | nome + **código** em muted menor (segunda linha) |
| 2 | **Categoria** | badge **mudo** (outline/dot — ver §2.3) |
| 3 | **Gestor** | só liderança — a coluna **não renderiza** para o papel gestor |
| 4 | **Prestação** | data; **vencida** = vermelho + ⚠; dentro do limiar = negrito; sem data = `—` |
| 5 | **Execução** | mini-barra + "312/480h · 65%" · sem realizado: **contorno vazio** + "480h · —" |
| 6 | **Custo** | planejado primário; realizado em muted abaixo, ou `—` |
| 7 | **Equipe** | "6 · 2⚠" (o ⚠ some quando zero) |
| 8 | **⌄** | expansão → **programa de fomento** e demais campos demovidos |

**Princípio da fusão:** planilha tem uma célula por *dado*; painel tem uma célula por *conceito*. Horas planejadas + realizadas + % são um conceito ("Execução").

**4.4 Ordenação:** default restaurado a cada carga = categoria, depois horas pendentes desc (a regra de priorização travada). Colunas ordenáveis por clique.

**4.5 Linha:** sem fundo colorido. **Borda esquerda 3px vermelha apenas para prestação vencida** — o único alarme de linha.

**4.6 Diretor:** sem tabela — faixa expandida + chips não clicáveis + custo por categoria (4 linhas: nome · barra · R$).

---

## 5. Aba CAPACIDADE — "quem está sobrecarregado e quem está ocioso?"

**5.1 Faixa de veredito — 3 chips-filtro + headcount:**
**Risco ≥95%** (vermelho se >0) · **Saudável 50–94%** · **Ocioso <50%** (âmbar) · headcount total.

Liderança ganha a **barra 100% empilhada** da distribuição logo abaixo — o "histograma honesto" para 3 faixas.

**Decisão:** com apenas 3 faixas, um histograma de barras verticais degenera em 3 números com molduras. Chips são mais compactos **e clicáveis** (filtram a tabela). Se um dia quiserem a *forma* da distribuição (bimodal? cauda?), aí sim colunas por faixa de 10% — pós-MVP.

**5.2 A tabela — 4 colunas + expansão:**

| # | Coluna | Conteúdo |
|---|---|---|
| 1 | **Colaborador** | nome |
| 2 | **Ocupação** | barra vs 220h (**reusar o componente do grid**) + "209/220h · 95%" · 🔴 se ≥95 · % em âmbar se <50 |
| 3 | **Realizado** | horas ou `—` |
| 4 | **Projetos** | nº de projetos distintos |
| | **⌄** | expansão lista os projetos **do escopo** |

**5.3 Ordenação:** utilização desc (sobrecarregados no topo — travado). Ociosos destacados via âmbar no % + chip-filtro; **sem tint de linha**.

**5.4 Diretor:** chips + barra empilhada + headcount. **Sem tabela, sem nomes** — aqui a regra é absoluta.

---

## 6. Fora do MVP (cortado deliberadamente)

- Custo por programa de fomento (não está nos dados travados; que decisão muda ao vê-lo?)
- Qualquer rosca, pizza, gauge ou radar
- Séries temporais e sparklines (não há série dentro do recorte mensal; 200 micrográficos são textura, não informação)
- Cabeçalhos de agrupamento por categoria (a ordenação já codifica; os chips já contam)
- Biblioteca de gráficos
- **Média de utilização** em Capacidade (média esconde bimodalidade — os 3 buckets existem justamente para dispensá-la)
- Exportação, personalização de colunas, comparação entre meses
- Drill-down além de contador→aba filtrada

---

## 7. Armadilhas a evitar (checklist de revisão)

- **Métrica de vaidade:** para cada número, perguntar "o que alguém faz *diferente* ao ver isso?". Se a resposta é "nada", o número não deveria existir.
- **KPI que repete a tabela:** um card "124 projetos" sobre uma tabela de 124 linhas não sintetiza nada.
- **Gráfico decorativo:** ocupa espaço, entrega pouco.
- **Floresta de filtros:** mês + escopo + chips de categoria bastam. Resistir à barra de dropdowns.
- **Alerta inflacionado:** se tudo pode ser vermelho, nada é.
- **Desenhar para a demo** em vez da terça-feira de manhã.
- **Desconfiança nos dados** matando a adoção — o risco nº 1 aqui, porque metade do realizado pode faltar. Por isso a taxa de apontamento é cidadã de primeira classe.

---

## 8. Ordem de implementação sugerida

1. **Refazer a forma do Projetos** (a tabela já existe; aplicar a fusão 13→8, a faixa de veredito, os chips, a calibragem de cor). Retrabalho barato e valida os componentes.
2. **Extrair os componentes compartilhados** no caminho: `<FaixaVeredito>`, `<Chip>`, `<BarraCSS>`, `fmtRealizado()`.
3. **Capacidade** (reusa quase tudo; a barra de ocupação já existe no grid).
4. **Geral** (só agregados; reusa os chips e as barras).
5. **As abas** — pode vir junto do passo 1 ou logo após, mas antes do Geral (que depende do drill-down).
