# Spec — Medição mensal editável (pino de medição)

> **Origem:** pedido da cliente no teste de 18/07 — *"o valor da medição deve ser editável, para eu dizer o valor exato que vou pagar"*. É bloqueio ativo: ela tentou contornar pinando a Meta HT de todos os meses, o que produziu déficits falsos (o pino sobrescreve o cálculo, então a meta não caía a zero mesmo com oficial cobrindo tudo).
>
> **Base:** `Spec_Planejamento_Inteligente.md` v1.4 §"Meta Mensal" e §"Cascata simétrica". Esta spec ESTENDE aquele modelo; nada do que já está no ar é reescrito.

---

## 1. O modelo hoje (o que muda e o que não muda)

**Hoje:**
- `medição do mês = valorTotal ÷ nº de meses` (uniforme; último mês absorve o resíduo → `soma(medição) = valorTotal` exato)
- `oficial do mês` = distribuído conforme `estrategiaOficial` ('inicial' | 'proporcional')
- `metaHT = medição − oficial` (**sem piso** — o oficial nunca excede a medição por construção)
- `metaHTFinal = pino ?? metaHT` (o pino da meta, já implementado, sobrescreve)
- **Invariante:** `soma(metaHT) = valorHT` exato

**Depois:**
- `medição do mês = pinoMedição ?? (valorTotal − soma dos pinos de medição) ÷ nº de meses NÃO pinados`
- `metaHT = **máx(0,** medição − oficial**)**` ← o piso passa a ser necessário
- Tudo o mais permanece: as estratégias do oficial, o pino da meta, a cascata, os meses fechados.

---

## 2. A mecânica (reuso do padrão do pino)

Idêntica ao pino da Meta HT, que a cliente já usa:

1. A medição de cada mês é **editável** na tabela de Meta de Apropriação.
2. Editar um mês **fixa** aquela medição (vira um "pino de medição") — badge visual + `×` para remover, como o pino da meta.
3. O **valorTotal restante** (`valorTotal − soma dos pinos de medição`) se distribui **uniformemente** entre os meses **não pinados**, com o **último não-pinado absorvendo o resíduo** → `soma(medição) = valorTotal` continua **exato**.
4. Remover o pino devolve o mês à distribuição automática.
5. **Meses fechados** são intocáveis (mesma regra da cascata da meta).

**Por que reusar o pino:** a cliente já entende o padrão; a mecânica é a mesma (valor fixado + redistribuição do resto, soma exata); e o código do pino da meta serve de referência direta.

---

## 3. O piso `máx(0)` e o caso que motivou o pedido

Com medição editável, ela pode definir uma medição **menor que o oficial** daquele mês. Sem piso, `metaHT` ficaria negativa.

**Regra:** `metaHT = máx(0, medição − oficial)`.

**O caso da cliente (Ago/25):** medição definida = 51.000; oficial = 61.538 → `metaHT = máx(0, 51.000 − 61.538) = 0`, **déficit = 0**. Exatamente o que ela pediu: *"como o Oficial já cobre toda a necessidade daquele mês, não faz sentido exigir apropriação em Horas Técnicas"*.

---

## 4. As duas bordas — AVISO, não decisão

Duas situações dependem de decisão de negócio que **ainda não temos** (perguntadas à cliente em 19/07). Até a resposta, o sistema **reporta o estado e não decide** — o mesmo padrão de "estado honesto" que a cascata da meta já usa (`cascataPendente`, "decisão manual").

### 4.1 Oficial excede a medição do mês
Quando `oficial > medição`, a meta zera pelo piso e **sobra oficial não aproveitado** naquele mês.

- **Comportamento agora:** meta = 0 + **aviso** no mês: *"R$ X de valor oficial excede a medição deste mês"*.
- **Pendente da cliente:** esse excedente **transborda** para o mês seguinte (cobrindo a medição de lá) ou **fica parado**? A fala dela sugere transbordo (*"o planejador apropria nos próximos meses HT"*), mas não foi confirmado.
- **Não implementar transbordo agora** — mudaria a distribuição do oficial, que é lógica já validada.

### 4.2 Medições fixadas estouram o valorTotal
Quando `soma(pinos de medição) > valorTotal`, não sobra valor para os meses não pinados (a distribuição daria negativo).

- **Comportamento agora:** os meses não pinados recebem **0**, e o sistema **avisa**: *"as medições fixadas somam R$ X acima do valor total do projeto"*.
- **Não bloquear a edição** (a cliente pode estar no meio de um rearranjo) e **não redistribuir automaticamente** reduzindo os pinos dela — isso desfaria o que ela acabou de digitar.
- **Pendente da cliente:** bloquear ou avisar? (Perguntado.)

---

## 5. Interação com o que já existe

| Mecanismo existente | Interação |
|---|---|
| **Pino da Meta HT** | Independente. A medição alimenta o cálculo da meta; o pino da meta continua sobrescrevendo o resultado final (`metaHTFinal = pinoMeta ?? máx(0, medição − oficial)`). **Ambos podem coexistir no mesmo mês.** |
| **Cascata da meta** | Inalterada. Ela redistribui `metaHT` entre meses editáveis; a medição é insumo, não parte da cascata. |
| **Estratégias do oficial** ('inicial'/'proporcional') | **Cuidado:** a estratégia 'inicial' distribui o oficial "cobrindo as medições dos primeiros meses até esgotar" — ou seja, **depende das medições**. Com medições editadas, a distribuição do oficial muda junto. Isso é correto e desejável, mas precisa de teste. |
| **Meses fechados** | Intocáveis: não recebem edição de medição nem entram na redistribuição. |
| **Invariante `soma(metaHT) = valorHT`** | ⚠️ **Passa a poder não fechar** quando o piso `máx(0)` corta valor (o excedente do oficial "some" do cálculo). Isso é consequência esperada da regra que a cliente pediu. O GET deve **reportar** a soma real em vez de assumir que fecha. |

---

## 6. Fatiamento

**Fase 1 — backend** (o cálculo + a persistência):
- Modelo do pino de medição (migration; provavelmente análogo à tabela do pino da meta).
- O cálculo da medição com pinos + redistribuição dos não-pinados (soma exata).
- O piso `máx(0)` na meta.
- Os dois avisos (§4.1, §4.2) no retorno do GET.
- Endpoints de pinar/despinar medição (análogos aos do pino da meta).
- **Portão anti-regressão:** os testes da meta (46/46), da cascata (27/27), do motor (108/108) e do wizard/aplicação não podem regredir. Com nenhum pino de medição, o comportamento deve ser **idêntico** ao de hoje.

**Fase 2 — frontend:**
- A coluna Medição vira editável na tabela de Meta de Apropriação (mesmo padrão de edição da Meta HT).
- Badge de medição fixada + `×` para remover.
- Os dois avisos exibidos.

---

## 7. Testes que separam (o que provar)

- **Sem nenhum pino de medição:** o resultado é idêntico ao atual (medição uniforme). — *portão de não-regressão*
- **Um mês pinado:** o restante distribui entre os não pinados; `soma(medição) = valorTotal` exato ao centavo.
- **Vários meses pinados:** idem, com o último não-pinado absorvendo o resíduo.
- **Todos os meses pinados:** a soma dos pinos tem que ser o valorTotal (ou dispara o aviso §4.2).
- **O caso da cliente:** medição 51.000, oficial 61.538 → `metaHT = 0` e **déficit = 0** (não negativo, não 10.538).
- **Piso ativo:** medição < oficial → meta 0 + aviso §4.1.
- **Estouro:** pinos somando acima do valorTotal → não-pinados em 0 + aviso §4.2.
- **Coexistência:** mês com pino de medição E pino de meta → o pino da meta vence no resultado final.
- **Estratégia 'inicial'** com medições editadas → o oficial redistribui conforme as novas medições.
- **Mês fechado** não aceita pino de medição e não entra na redistribuição.
