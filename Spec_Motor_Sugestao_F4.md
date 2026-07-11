# Spec — Motor de Sugestão de Equipe (F4) — v1.0

> Síntese do brainstorm de 4 IAs (respostas de 09/07/2026 ao `Brainstorm_Motor_Sugestao_F4.md`). Detalha o §6 da `Spec_Planejamento_Inteligente.md` v1.4 — **os invariantes de lá valem intactos** (guloso determinístico e transparente; camadas fixados→equipe-atual→externos; alvo em R$/unidade em horas; sugestão nunca aplica sozinha; aditiva; sem transbordo entre meses; snapshot carimbado). Este documento resolve as decisões finas do algoritmo e é a fonte da verdade para implementar **F4 (motor)**, com notas de contrato para **F5 (wizard)** e **F6 (aplicação)**.
>
> Como ler: consenso 4/4 ou 3/4 → decisão travada. Divergências → arbitradas pelo arquiteto, racional registrado, defaults ajustáveis. Nada aqui altera a metade financeira (F1–F3) nem cria caminho novo de escrita.

## 1. As decisões (as 8 questões do brainstorm)

### 1.1 Ordenação e distribuição nos externos
- **Ordenação: disponibilidade DESC → colaborador_id ASC.** (4/4 na disponibilidade-primeiro; 3/4 rejeitam tarifa em QUALQUER papel de ordenação — uma IA a propôs como desempate e foi vencida pelo argumento matemático de outra: a tarifa tem dois "ótimos" contraditórios — o caro fecha o R$ com menos horas, o barato entrega mais horas pelo mesmo valorHT — então qualquer escolha é política de negócio disfarçada de algoritmo, e cria o viés de convocar sempre os mesmos. Nome NÃO desempata: colide e muda; ID é imutável.)
- **Distribuição: waterfall (cascata)** — preenche cada pessoa até `min(necessário, disponibilidade, máxHoras)` antes de passar à próxima; para quando o déficit zera. Equipe enxuta > pulverização (15 pessoas com 4h cada é ruído administrativo e cada linha é uma decisão de revisão). O freio anti-concentração é o **máxHoras por pessoa** (§1.6), não round-robin.

### 1.2 Blocos e fechamento do valor
- **Blocos de 4h, constante de sistema** (não é parâmetro do wizard). 220 é múltiplo de 4; o grid fica legível; ninguém aloca 37,4h. (Divergência 4h-constante × incrementos-de-1h arbitrada: blocos casam com o mínimo-de-novo abaixo e com a legibilidade.)
- **O fechamento arredonda PARA CIMA** (ceil em blocos) — 4/4. O propósito do motor é matar o déficit; resto manual reintroduz a dor em miniatura. A sobra é limitada por construção (≤ 1 bloco × tarifa de quem fecha) e **reportada**: "déficit coberto com sobra de R$ X". Quem não tem folga pro bloco extra contribui com `floorBloco(disponível)` e o waterfall segue.
- **Mínimo para NOVO entrante: 8h (2 blocos), default ajustável.** 4h/mês é ruído (reunião e troca de contexto comem). Regra: novo nunca entra com menos que o mínimo; se o teto da pessoa < 8h, é **pulada** (vai ao diagnóstico); se o déficit restante exigiria só 4h de alguém novo, entra com 8h e a sobra é reportada. O mínimo NÃO se aplica a reforçar quem já está no projeto/na sugestão. (Divergência 1h/4h/8h arbitrada pelo custo real de onboarding.)

### 1.3 Continuidade: promoção intra-execução
- Núcleo **mensal independente**, meses processados em ordem cronológica, com **promoção intra-execução**: quem o motor escolheu no mês M entra na camada 2 ("já está no projeto") para M+1 em diante DA MESMA execução (3/4). Antecipa o efeito que a aplicação teria — a proposta multi-mês que o gestor revisa já sai coerente (a equipe de março se mantém em abril). Custa um Set em memória; explicação da linha: "mantido de março".
- **Definição precisa de camada 2:** pessoa com alocação existente neste projeto em qualquer mês da janela da sugestão ∪ promovidos pela execução.
- Nada além disso (olhar meses futuros, penalizar entra-e-sai) — é otimização multi-mês, mata a explicabilidade.

### 1.4 Determinismo e snapshot
- **Chave de ordenação total: (camada, disponibilidade DESC, id ASC).** Nunca ordem de retorno do banco, nunca nome. Mesma entrada → mesma saída; se a saída mudou entre gerações, a entrada mudou, e a linha mostra qual dado.
- **Snapshot carimbado** (`geradoEm`) + por linha: disponibilidade vista, tarifa vista, camada, explicação. A UI mostra a idade ("gerada há X min").
- **O lock real é o juiz.** A aplicação (F6) passa célula a célula pelo `POST /alocacoes` (lock+teto); o que não cabe mais é rejeitado e reportado com o delta ("vista: 120h livres; agora: 12h; cabem 12h das 40h"). O motor não pré-trava, não re-valida em loop — TOCTOU só se resolve no lock.

### 1.5 Meta pinada e cascata: fluxo unidirecional
- O motor **consome o vetor de déficits do estado atual da meta** (pinos e cascata aplicados — a MESMA conta do `GET /:id/meta-apropriacao`) num snapshot único. **Nunca escreve meta, nunca pina, nunca dispara cascata.** Mês pinado: o déficit dele é respeitado exatamente (o pino é a palavra do gestor).
- **O acoplamento sutil (documentado; não é bug):** a meta BASE é independente da receita (medição − oficial). Mas COM pinos, a distribuição da cascata é proporcional aos DÉFICITS — que dependem da receita. Logo, aplicar a sugestão (receita sobe) faz a cascata, no próximo GET, redistribuir diferente entre os editáveis: as metas deslocam para onde ainda falta dinheiro. É o comportamento desejado da cascata ("onde falta AGORA"), limitado (total fixo; só editáveis) e autocorrigido na próxima geração. **Proibido:** iterar motor↔cascata até ponto fixo — otimização escondida, produz sugestão inexplicável.

### 1.6 Controles do gestor (entradas) — v1
**Zero-config funciona:** projeto + macro (no wizard) + "Gerar" já produz sugestão com os defaults.
- **período** — default: meses abertos da vigência com déficit > 0 (máx. 12).
- **profissões** — opcional (default: todas); o wizard destaca o campo. (Uma IA queria obrigatório; zero-config vence — o gestor revisa de qualquer forma.)
- **fixados** `[{colaboradorId, minHoras?}]` — camada 1. **Fixado com mínimo entra mesmo com déficit zero** (fixar significa isso).
- **excluídos** `[]` — férias, pessoa-chave intocável. Trivial e de altíssimo valor.
- **máxExternos** — default: sem limite; existe como freio de fragmentação. (Uma IA queria fora da v1; fica como campo opcional barato.)
- **avançados com default:** `minHorasNovo = 8h`; **`máxHorasPessoa = 60h/mês`** (~27% do teto; acima disso, encher alguém é decisão humana, não de motor. Divergência 40h × 60h arbitrada pra 60h — ajustável, mencionar à cliente).
- **Fora:** pesos, ordenação alternativa por tarifa, mínimo de receita por pessoa, senioridade — superfície de configuração que dilui confiança antes de existir uso.

### 1.7 Destino macro/micro
- **O motor é puro e NÃO exige macro** — as linhas são pessoa×mês×horas; macro/micro só importam na aplicação. A exigência mora no **wizard (F5)**: select de **macro destino** (pré-selecionada quando o projeto tem exatamente 1); a sugestão cai inteira na **micro "Geral"** dessa macro. Projeto sem macro → wizard bloqueado com CTA inline "criar macro" (um campo de nome, cria com Geral, segue). Sem escolha por linha (o grid resolve refinamento depois).
- **Recomendação à cliente (resolve na raiz):** projeto nascer com macro padrão + Geral na criação — elimina o estado vazio do sistema inteiro (pendência já registrada no PROGRESSO; a F5/F6 reforçam a necessidade).

### 1.8 Capacidade insuficiente e relatórios
- **Na geração:** sugestão parcial + por mês: déficit não coberto **em R$** (NUNCA convertido em horas por tarifa média) + **diagnóstico** ("N candidatos; folga somada Xh; motivos: abaixo do mínimo de 8h / máxExternos atingido / K excluídos / todos no teto") + **link pro remanejamento** existente (apontar o caminho; **jamais criar pedidos automaticamente** — o motor não fala em nome do gestor com outros gestores).
- **Na aplicação (F6):** cabeçalho "18 de 22 aplicadas"; por falha: motivo (teto — "cabem 12h das 40h"; mês fechado; posse) com ajuste-em-um-clique pro valor que cabe. **Falhas permanecem na tabela de revisão, destacadas e editáveis, para reaplicar só elas.** Nunca toast verde sobre falha parcial. Sem rollback (aditivo, célula a célula: o que entrou, entrou). Relatório persiste junto do snapshot (auditoria: o que foi sugerido, com que dados, o que entrou).

### 1.9 Armadilhas priorizadas (no NOSSO contexto)
1. **Consumo silencioso da folga coletiva** — pessoas compartilhadas entre ~20 gestores: cada clique de um come a folga de todos. Proteções: disponibilidade-primeiro; máxHoras 60h; **cada linha mostra "ficará com Xh livres"**; **aviso soft** quando uma linha deixaria alguém com < 20h livres no mês.
2. **Falha parcial mascarada** — com corrida entre gestores, falha parcial é o caso NORMAL. Defesa: o relatório do §1.8; falha nunca some da tela.
3. **Sugestão instável** — mata a confiança (o produto). Defesa: chave total + snapshot + explicação por linha.
- Neutralizadas por construção: viés de tarifa (fora da ordenação), pessoa-chave (excluídos + aditividade), briga com a cascata (fluxo unidirecional), matriz ingovernável (na revisão só aparecem as linhas que o motor adicionou; equipe enxuta por waterfall + mínimo de 8h).

## 2. O contrato do motor (F4)

**`POST /api/projetos/:id/sugestao-equipe`** — computação **read-only** (POST pelo corpo rico; NENHUMA escrita no banco). Posse: a mesma do GET da meta (gestor dono / chefe / admin; gestor não-dono → 403). Pré-condições: projeto configurado (vigência + valores; senão `{configurado:false}` como a meta).

Entrada (tudo opcional — defaults aplicam):
```json
{
  "meses": ["2026-07", "2026-08"],
  "profissoes": ["Designer"],
  "fixados": [{ "colaboradorId": "sc-01", "minHoras": 20 }],
  "excluidos": ["sc-05"],
  "maxExternos": null,
  "minHorasNovo": 8,
  "maxHorasPessoa": 60
}
```
Saída:
```json
{
  "geradoEm": "2026-07-11T14:00:00Z",
  "parametros": { "...ecoados com defaults aplicados..." : "" },
  "linhas": [{ "colaboradorId":"", "nome":"", "profissao":"", "mes":"", "horas":0, "tarifa":"", "receita":"", "camada":"fixado|equipe|novo", "disponibilidadeVista":0, "disponibilidadeApos":0, "explicacao":"" }],
  "totaisPorMes": [{ "mes":"", "metaHT":"", "receitaAtual":"", "deficit":"", "coberto":"", "sobra":"", "deficitRemanescente":"" }],
  "remanescentes": [{ "mes":"", "valor":"", "diagnostico": ["..."] }],
  "avisos": ["Fulano ficara com 12h livres no mes"]
}
```

## 3. O algoritmo (normativo)

```
SNAPSHOT (carimbado geradoEm):
  deficits[mes]        # a MESMA conta do GET meta-apropriacao (pinos + cascata)
  disp[pessoa][mes] = 220 − totalAlocadoReal(todos os projetos/gestores)
  tarifa[pessoa] = resolverTarifa(...)     # reusa lib/tarifa.ts, com exceções por categoria
  equipeAtual = pessoas com alocação NESTE projeto em qualquer mês da janela

promovidos = ∅ ; nomesNovos = ∅
para mes em meses (ordem cronológica):
  se mes fechado: pula
  restante = deficits[mes]
  se restante ≤ 0 e não há fixado-com-mínimo pendente no mês: pula
  para camada em [1: fixados, 2: (equipeAtual ∪ promovidos) − fixados − excluidos, 3: externos]:
    candidatos = filtra(excluidos fora; profissões se dadas; disp[mes] > 0)
    ordena(disp[mes] DESC, id ASC)
    para pessoa em candidatos:
      se restante ≤ 0 e não (pessoa é fixado com minHoras não atendido): break
      se camada = 3 e |nomesNovos| ≥ maxExternos: break
      tetoPessoa = floorBloco( min(disp[pessoa][mes], maxHorasPessoa − horasJaSugeridas(pessoa, mes)) )
      alvo = ceilBloco( restante / tarifa[pessoa] )        # fecha por cima
      se fixado com minHoras: alvo = max(alvo, ceilBloco(minHoras))
      horas = min(alvo, tetoPessoa)
      se pessoa ∉ (equipeAtual ∪ promovidos ∪ fixados):     # é NOVA
        se tetoPessoa < minHorasNovo: registra no diagnóstico; continue
        horas = max(horas, minHorasNovo)
      se horas ≤ 0: continue
      REGISTRA linha { pessoa, mes, +horas, tarifa, receita, camada, dispVista, dispApós, explicação }
      restante −= horas × tarifa[pessoa]
      disp[pessoa][mes] −= horas
      promovidos += pessoa ; se camada = 3: nomesNovos += pessoa
  se restante > 0: remanescentes += { mes, valor: restante, diagnostico }
```
Propriedades garantidas: sobra ≤ 1 bloco × tarifa de quem fecha; nenhum novo com < 8h; ninguém acima de 60h sem edição humana; mesma entrada → mesma saída; toda linha explicável numa frase ("Fulana: +40h — já no projeto, 120h livres, R$ 80/h → R$ 3.200").

## 4. Invariantes de teste (o portão da F4 — lição do greedy da cascata: testar os casos que SEPARAM)
1. **Determinismo:** mesma entrada 2× → JSON idêntico (deep-equal).
2. **Waterfall provado** com caso que o separa de round-robin: 2 externos com folga IGUAL, déficit que cabe em 1 → o de menor id leva tudo, o outro 0h (o inverso do teste da cascata proporcional!).
3. **Camadas:** quem já está no projeto consome antes de externo mesmo tendo folga menor.
4. **Promoção intra-execução:** externo escolhido em M aparece como camada 2 em M+1 na mesma execução.
5. **Ceil:** déficit que não fecha em blocos → sobra pequena reportada; jamais déficit residual havendo capacidade.
6. **Bloco×disponibilidade:** pessoa com 6h livres contribui 4h (floorBloco).
7. **Mínimo de novo:** teto < 8h → pulada + diagnóstico; novo que só precisaria 4h → entra com 8h, sobra reportada.
8. **Fixado com minHoras em mês sem déficit → entra com o mínimo.**
9. **máxExternos** corta a camada 3 (contagem GLOBAL de nomes novos, não por mês).
10. **Excluído** jamais aparece; **profissão** filtra.
11. **Mês fechado / déficit 0** → pulado (salvo o caso 8).
12. **O déficit consumido = o do GET da meta** — testado com um mês PINADO (a mesma conta, pinos aplicados).
13. **Tarifa com exceção de categoria** (resolverTarifa) usada — um caso com override.
14. **máxHorasPessoa** respeitado somando fixado + reforço no mesmo mês.
15. **Posse:** gestor não-dono → 403. **Read-only:** contagem de alocações no banco idêntica antes/depois.
16. **Capacidade insuficiente** → parcial + remanescente em R$ + diagnóstico com os motivos.

## 5. Fatiamento
- **F4a — o núcleo de UM mês** (esforço MÁXIMO no CC): pool, camadas (janela de 1 mês, sem promoção), waterfall, blocos, ceil, mínimos/máximos, diagnóstico do mês. Testes 1–3, 5–8, 10–16 no escopo de 1 mês.
- **F4b — orquestração multi-mês:** loop cronológico, promoção intra-execução, máxExternos global, remanescentes agregados, snapshot/contrato final. Testes 4, 9, 12 multi-mês + determinismo do conjunto.
- **F5 — wizard** (2 passos): a macro é exigida AQUI; badges por camada na revisão (**fixado / equipe / novo** — responde à pergunta da IA sobre distinção visual; coerente com pin/ajust./fechado da meta); na tela, só as linhas que o motor adicionou; aviso de idade do snapshot; "ficará com Xh livres" por linha + aviso soft < 20h.
- **F6 — aplicação:** loop `POST /alocacoes` em ordem determinística (mês asc, camada, id); relatório célula a célula; falhas ficam destacadas e editáveis; reaplicar só as falhas; relatório persistido com o snapshot.

## 6. Fora da v1 (e por quê)
Ordenação alternativa por tarifa (política de negócio disfarçada; espere demanda real). Continuidade além da promoção intra-execução (otimização multi-mês, inexplicável). Revalidação contínua / diff entre gerações (o lock já é o juiz). Macro/micro por linha (o grid resolve). Criação automática de pedidos de remanejamento (o motor não negocia entre gestores). Balanceamento entre projetos/gestores (otimização global — o oposto declarado do produto). Rateio de alocação parcial entre meses. Motor reativo a mudança de meta (o gestor re-dispara). **A v1 é deliberadamente simples e verificável: é isso que compra a confiança que permite sofisticar depois.**

## 7. Para mencionar à cliente (não bloqueia a implementação)
1. **Fechamento arredonda pra cima** — sobra pequena reportada em vez de resto manual (ela deve preferir; confirmar na próxima conversa).
2. **Default 60h/mês** de máximo por pessoa na sugestão (ajustável por execução).
3. **Macro padrão na criação do projeto** — já é pendência registrada; F5/F6 reforçam (resolve o estado-vazio na raiz).
