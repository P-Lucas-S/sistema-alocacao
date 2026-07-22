import { Prisma } from '@prisma/client';
import prisma from '../prisma.js';
import { carregarTarifas, resolverTarifa } from './tarifa.js';

// ── gerarMeses ────────────────────────────────────────────────────────────────
// Exportada aqui para ser reusada por projetos.ts (GET meta-apropriacao) e pelo
// motor de sugestão (sugestaoEquipe.ts) sem redefinir a mesma semântica.
export function gerarMeses(inicio: Date, fim: Date): { ano: number; mes: number }[] {
  const result: { ano: number; mes: number }[] = [];
  let ano = inicio.getUTCFullYear();
  let mes = inicio.getUTCMonth() + 1;
  const fimAno = fim.getUTCFullYear();
  const fimMes = fim.getUTCMonth() + 1;
  while (ano < fimAno || (ano === fimAno && mes <= fimMes)) {
    result.push({ ano, mes });
    mes++;
    if (mes > 12) { mes = 1; ano++; }
  }
  return result;
}

// ── Tipos retornados pelo helper ──────────────────────────────────────────────

export interface MetaMesCalc {
  ano: number;
  mes: number;
  key: string;
  medicao: Prisma.Decimal;
  pinadaMedicao: boolean;       // true se este mês tem pino de medição
  oficialAlocado: Prisma.Decimal;
  pinadoOficial: boolean;       // true se este mês tem pino de oficial
  ajustadoOficial: boolean;     // true se a cascata do oficial moveu este mês
  metaHT: Prisma.Decimal;
  pinado: boolean;
  fechado: boolean;
  receitaPlanejada: Prisma.Decimal;
  deficit: Prisma.Decimal;
  avisoPiso: string | null;     // §4.1: não-null quando oficial > medição (e sem pino de meta)
}

export interface ComputarMetaApropriacaoResult {
  valorTotal: Prisma.Decimal;
  valorOficial: Prisma.Decimal;
  valorHT: Prisma.Decimal;
  numMeses: number;
  estrategiaOficial: string | null;
  meses: { ano: number; mes: number }[];
  mesCalcs: MetaMesCalc[];
  somaMetaHT: Prisma.Decimal;
  totalCortadoPeloPiso: Prisma.Decimal; // R$ cortado pelo piso max(0) em meses sem pino de meta
  temPinos: boolean;
  avisoEstouroMedicao: string | null;   // §4.2: não-null quando pinos somam > valorTotal
  avisoEstouroOficial: string | null;   // não-null quando os oficiais fixados (pinos + fechados) somam > valorOficial
  saldoNaoPlanejado: Prisma.Decimal | null;
  precisaDecisaoManual: {
    faltam: string;
    folgaPorMes: { ano: number; mes: number; folga: string }[];
  } | null;
}

// ── computarMetaApropriacao ───────────────────────────────────────────────────
// Extração mecânica do bloco de cálculo do GET /:id/meta-apropriacao.
// Retorna null quando o projeto não está configurado (sem vigência ou valorTotal).
// O GET chama este helper e serializa o resultado; o motor usa os Decimals diretamente.
//
// Ressalva 3: valorTotal e valorOficial são NULLABLE no schema. O helper trata
// o caso não-configurado retornando null; o chamador mapeia para {configurado:false}.
export async function computarMetaApropriacao(
  projetoId: string,
  projeto: {
    valorTotal: Prisma.Decimal | null;
    valorOficial: Prisma.Decimal | null;
    estrategiaOficial: string | null;
    categoriaId: string | null;
    vigenciaInicio: Date | null;
    vigenciaFim: Date | null;
  },
): Promise<ComputarMetaApropriacaoResult | null> {
  // Sem vigência ou valorTotal → projeto não configurado para meta
  if (!projeto.vigenciaInicio || !projeto.vigenciaFim || projeto.valorTotal == null) {
    return null;
  }

  const D0           = new Prisma.Decimal(0);
  const valorTotal   = projeto.valorTotal;
  const valorOficial = projeto.valorOficial ?? D0;
  const valorHT      = valorTotal.minus(valorOficial);
  const estrategia   = projeto.estrategiaOficial;

  const meses    = gerarMeses(projeto.vigenciaInicio, projeto.vigenciaFim);
  const numMeses = meses.length;
  if (numMeses === 0) return null;

  // ── Pinos de medição (1 query) — determinam medicao de cada mês ─────────────
  const pinosMedicaoRaw = await prisma.medicaoMensalAjuste.findMany({
    where: { projetoId },
    select: { ano: true, mes: true, medicao: true },
  });
  const pinosMedicaoPorMes = new Map<string, Prisma.Decimal>(
    pinosMedicaoRaw.map(p => [`${p.ano}-${p.mes}`, p.medicao])
  );

  // ── Pinos de oficial (1 query) — oficial editável por mês ───────────────────
  const pinosOficialRaw = await prisma.oficialMensalAjuste.findMany({
    where: { projetoId },
    select: { ano: true, mes: true, valorOficial: true },
  });
  const pinosOficialPorMes = new Map<string, Prisma.Decimal>(
    pinosOficialRaw.map(p => [`${p.ano}-${p.mes}`, p.valorOficial])
  );

  // Medição por mês: pinoMedicao ?? redistribuição uniforme entre não-pinados.
  // Sem nenhum pino → comportamento original (uniforme, último absorve resíduo).
  let medicoes: Prisma.Decimal[];
  let avisoEstouroMedicao: string | null = null;

  if (pinosMedicaoPorMes.size === 0) {
    // Comportamento original inalterado
    const medicaoBase = valorTotal.dividedBy(numMeses).toDecimalPlaces(2);
    medicoes = meses.map((_, i) =>
      i < numMeses - 1
        ? medicaoBase
        : valorTotal.minus(medicaoBase.times(numMeses - 1))
    );
  } else {
    const somaPinosMed = pinosMedicaoRaw.reduce((acc, p) => acc.plus(p.medicao), D0);

    if (somaPinosMed.greaterThan(valorTotal)) {
      // §4.2: estouro — não-pinados ficam com 0 e emite aviso
      avisoEstouroMedicao =
        `As medições fixadas somam R$ ${somaPinosMed.minus(valorTotal).toFixed(2)} acima do valor total do projeto`;
      medicoes = meses.map(({ ano, mes }) =>
        pinosMedicaoPorMes.get(`${ano}-${mes}`) ?? D0
      );
    } else {
      // Redistribui (valorTotal - somaPinos) entre os não-pinados; último absorve resíduo
      const valorRestante = valorTotal.minus(somaPinosMed);
      const naoPinadosIdx: number[] = [];
      meses.forEach(({ ano, mes }, i) => {
        if (!pinosMedicaoPorMes.has(`${ano}-${mes}`)) naoPinadosIdx.push(i);
      });
      const nNaoPinados = naoPinadosIdx.length;

      if (nNaoPinados === 0) {
        // Todos pinados (soma exata = valorTotal — já passamos pelo greaterThan acima)
        medicoes = meses.map(({ ano, mes }) => pinosMedicaoPorMes.get(`${ano}-${mes}`) ?? D0);
      } else {
        const medicaoBaseNP = valorRestante.dividedBy(nNaoPinados).toDecimalPlaces(2);
        const ultimoNPIdx   = naoPinadosIdx[naoPinadosIdx.length - 1]!;
        const somaBaseAntes = medicaoBaseNP.times(nNaoPinados - 1);
        const naoPinadosSet = new Set(naoPinadosIdx);

        medicoes = meses.map(({ ano, mes }, i) => {
          const pino = pinosMedicaoPorMes.get(`${ano}-${mes}`);
          if (pino !== undefined) return pino;
          if (i === ultimoNPIdx) return valorRestante.minus(somaBaseAntes); // absorve resíduo
          return medicaoBaseNP;
        });
        void naoPinadosSet; // usado implicitamente pelo filtro acima
      }
    }
  }

  // ── Distribuição do oficial por mês ─────────────────────────────────────────
  let oficialAlocados: Prisma.Decimal[];
  if (estrategia === 'proporcional') {
    // Divisão uniforme: último mês absorve resíduo de arredondamento.
    const oficialBase = valorOficial.dividedBy(numMeses).toDecimalPlaces(2);
    oficialAlocados = meses.map((_, i) =>
      i < numMeses - 1
        ? oficialBase
        : valorOficial.minus(oficialBase.times(numMeses - 1))
    );
    // Transbordo: mês com pino de medição baixo (medicao < oficialAlocado) passa o
    // excedente para o mês seguinte — "o que sobra do oficial cobre o próximo mês".
    // Invariante preservado: soma(oficialAlocado) = valorOficial (só redistribui).
    let carry = D0;
    for (let i = 0; i < oficialAlocados.length; i++) {
      const raw = oficialAlocados[i]!.plus(carry);
      const med = medicoes[i]!;
      if (raw.greaterThan(med)) {
        carry = raw.minus(med);
        oficialAlocados[i] = med;
      } else {
        oficialAlocados[i] = raw;
        carry = D0;
      }
    }
    // Carry residual só ocorre se valorOficial > valorTotal (dado inválido). Acumula
    // no último mês: o piso max(0) e avisoPiso sinalizam a anomalia, e
    // soma(oficialAlocado) = valorOficial continua exato ao centavo.
    if (carry.greaterThan(D0)) {
      oficialAlocados[oficialAlocados.length - 1] =
        oficialAlocados[oficialAlocados.length - 1]!.plus(carry);
    }
  } else {
    // 'inicial': guloso por medicao do mês; saldo Decimal consumido exatamente
    let saldo = valorOficial;
    oficialAlocados = medicoes.map((med) => {
      if (saldo.greaterThanOrEqualTo(med)) {
        const oa = med; saldo = saldo.minus(med); return oa;
      } else if (saldo.greaterThan(D0)) {
        const oa = saldo; saldo = D0; return oa;
      }
      return D0;
    });
  }

  // ── Fechamentos dos meses da vigência (1 query batch) — usados pela cascata
  // do oficial e pela classificação de meses mais abaixo ──────────────────────
  const fechamentosRaw = await prisma.fechamentoMensal.findMany({
    where: { OR: meses.map(({ ano, mes }) => ({ ano, mes })) },
    select: { ano: true, mes: true },
  });
  const mesesFechadosSet = new Set<string>(fechamentosRaw.map(f => `${f.ano}-${f.mes}`));

  // ── Cascata do oficial (espelha a cascata da meta) ──────────────────────────
  // Ativa SÓ quando há pino de oficial. Sem pinos → oficialFinal = oficialAlocados
  // (a distribuição por estratégia), byte-idêntico ao comportamento anterior.
  //
  // Intocável = pinado-de-oficial OU fechado. O oficial CARIMBADO de um intocável
  // é o valor que ele EFETIVAMENTE tem — o pino se houver, senão o oficial-base
  // (pin-agnóstico, computado uma vez acima). Esse MESMO valor entra no
  // somaIntocaveis e no output: é o que fecha o invariante ao centavo. Mês
  // fechado nunca é recomputado (o oficial dele é fato histórico).
  let oficialFinal: Prisma.Decimal[] = oficialAlocados;
  const ajustadosOficial = new Set<number>();
  let avisoEstouroOficial: string | null = null;

  if (pinosOficialPorMes.size > 0) {
    const idxOf = meses.map(({ ano, mes }, i) => {
      const key           = `${ano}-${mes}`;
      const pinadoOficial = pinosOficialPorMes.has(key);
      const fechado       = mesesFechadosSet.has(key);
      return { i, key, pinadoOficial, fechado, editavel: !pinadoOficial && !fechado };
    });

    // Carimbo de cada mês: pino se houver, senão o oficial-base. Nunca recomputa.
    const carimbo = (m: { i: number; key: string }): Prisma.Decimal =>
      pinosOficialPorMes.get(m.key) ?? oficialAlocados[m.i]!;

    const somaIntocaveis = idxOf
      .filter(m => !m.editavel)
      .reduce((acc, m) => acc.plus(carimbo(m)), D0);
    const editaveis     = idxOf.filter(m => m.editavel);
    const saldoEditavel = valorOficial.minus(somaIntocaveis);

    if (saldoEditavel.lessThan(D0)) {
      // Estouro: os oficiais fixados (pinos + oficial dos meses fechados) já
      // excedem o valorOficial — não há saldo para os editáveis. Estes ficam
      // com 0 (oficial nunca negativo); pinos e fechados mantêm o carimbo. O
      // aviso sinaliza — o invariante não é forçável neste estado (espelha a
      // medição). No caso comum (sem fechado) isto é exatamente soma(pinos) > valorOficial.
      avisoEstouroOficial =
        `Os valores oficiais fixados somam R$ ${somaIntocaveis.minus(valorOficial).toFixed(2)} acima do valor oficial do projeto`;
      oficialFinal = idxOf.map(m => (m.editavel ? D0 : carimbo(m)));
    } else {
      const provisorio = new Map<number, Prisma.Decimal>();
      if (editaveis.length > 0) {
        const baseEditavelTotal = editaveis.reduce((acc, m) => acc.plus(oficialAlocados[m.i]!), D0);
        const ultimoIdx = editaveis[editaveis.length - 1]!.i;

        if (baseEditavelTotal.greaterThan(D0)) {
          // Proporcional ao oficial-base de cada editável; último absorve resíduo
          let alocado = D0;
          editaveis.forEach((m, k) => {
            const parcela = k < editaveis.length - 1
              ? saldoEditavel.times(oficialAlocados[m.i]!).dividedBy(baseEditavelTotal).toDecimalPlaces(2)
              : saldoEditavel.minus(alocado);
            provisorio.set(m.i, parcela);
            alocado = alocado.plus(parcela);
          });
        } else {
          // Fallback: todos os editáveis com oficial-base zero (proporção
          // impossível) → divisão igual; último absorve resíduo.
          const n = editaveis.length;
          const base = saldoEditavel.dividedBy(n).toDecimalPlaces(2);
          let alocado = D0;
          editaveis.forEach((m, k) => {
            const parcela = k < n - 1 ? base : saldoEditavel.minus(alocado);
            provisorio.set(m.i, parcela);
            alocado = alocado.plus(parcela);
          });
        }

        // Teto por mês + transbordo — o MESMO laço carry da estratégia
        // proporcional (7d724ad), cronológico entre editáveis: se o oficial
        // passar da medição do mês, capa na medição e transborda o excedente
        // pro próximo editável. Carry final acumula no último editável (o
        // avisoPiso adiante sinaliza oficial > medição). Só redistribui:
        // soma(editáveis) = saldoEditavel preservada.
        let carry = D0;
        for (const m of editaveis) {
          const raw = provisorio.get(m.i)!.plus(carry);
          const med = medicoes[m.i]!;
          if (raw.greaterThan(med)) {
            carry = raw.minus(med);
            provisorio.set(m.i, med);
          } else {
            provisorio.set(m.i, raw);
            carry = D0;
          }
        }
        if (carry.greaterThan(D0)) {
          provisorio.set(ultimoIdx, provisorio.get(ultimoIdx)!.plus(carry));
        }
      }

      oficialFinal = idxOf.map(m =>
        m.editavel ? (provisorio.get(m.i) ?? oficialAlocados[m.i]!) : carimbo(m)
      );

      // "ajust." nos editáveis que a cascata efetivamente moveu (final ≠ base)
      for (const m of editaveis) {
        if (!oficialFinal[m.i]!.equals(oficialAlocados[m.i]!)) ajustadosOficial.add(m.i);
      }
    }
  }

  // metasHT SEM piso (pode ser negativo quando oficial > medição) — usa o
  // oficial FINAL (pós-cascata quando há pino; = base quando não há).
  const metasHT = medicoes.map((med, i) => med.minus(oficialFinal[i]!));

  // ── Receita planejada por mês — reusa carregarTarifas/resolverTarifa ────────
  // 1 query alocações + 1 colaboradores + 1 tarifas (sem N+1 por mês)
  const alocs = await prisma.alocacao.findMany({
    where: {
      projetoId,
      OR: meses.map(({ ano, mes }) => ({ ano, mes })),
    },
    select: { colaboradorId: true, ano: true, mes: true, horasPlanejadas: true },
  });

  const colabIds = [...new Set(alocs.map(a => a.colaboradorId))];
  const [colaboradores, tarifasMap] = await Promise.all([
    colabIds.length > 0
      ? prisma.colaborador.findMany({ where: { id: { in: colabIds } }, select: { id: true, valorHora: true } })
      : Promise.resolve([]),
    carregarTarifas(colabIds),
  ]);
  const valorHoraPorColab = new Map(colaboradores.map(c => [c.id, c.valorHora]));
  const categoriaId = projeto.categoriaId ?? null;

  const receitaPorMes = new Map<string, Prisma.Decimal>();
  for (const a of alocs) {
    const key       = `${a.ano}-${a.mes}`;
    const valorHora = valorHoraPorColab.get(a.colaboradorId) ?? null;
    const { valor } = resolverTarifa(tarifasMap, { id: a.colaboradorId, valorHora }, categoriaId);
    if (valor == null) continue;
    const parcela = a.horasPlanejadas.times(valor);
    receitaPorMes.set(key, (receitaPorMes.get(key) ?? D0).plus(parcela));
  }

  // ── Lê pinos (F2b-i): 1 query, indexado por "ano-mes" ──────────────────────
  const pinosRaw = await prisma.metaMensalAjuste.findMany({
    where: { projetoId },
    select: { ano: true, mes: true, metaHT: true },
  });
  const pinosPorMes = new Map<string, Prisma.Decimal>(
    pinosRaw.map(p => [`${p.ano}-${p.mes}`, p.metaHT])
  );
  const temPinos = pinosPorMes.size > 0;

  // (fechamentos já lidos acima — mesesFechadosSet reusado aqui)

  // ── Classifica meses (F2b-ii) ────────────────────────────────────────────────
  // Intocáveis: pinados (de meta) OU fechados. Editáveis: os demais.
  // baseMetaHT aplica o piso max(0): quando oficial > medicao a meta não vai negativa.
  const classificados = meses.map(({ ano, mes }, i) => {
    const key           = `${ano}-${mes}`;
    const pinoValor     = pinosPorMes.get(key);
    const pinado        = pinoValor !== undefined;    // pino de META
    const fechado       = mesesFechadosSet.has(key);
    const pinadaMedicao = pinosMedicaoPorMes.has(key);
    const pinadoOficial = pinosOficialPorMes.has(key);
    const metaHTSemPiso = metasHT[i]!;
    const baseMetaHT    = metaHTSemPiso.lessThan(D0) ? D0 : metaHTSemPiso; // piso max(0)
    return {
      i, key, ano, mes, pinado, fechado, pinadaMedicao, pinadoOficial,
      editavel:   !pinado && !fechado,
      baseMetaHT,
      metaHTSemPiso,
      pinoValor:  pinoValor as Prisma.Decimal | undefined,
    };
  });

  // ── Cascata simétrica (F2b-ii) ────────────────────────────────────────────────
  // Princípio único: nunca criar/piorar déficit automaticamente.
  //   LIBERAR (pins reduziram HT net): distribui proporcional ao déficit dos editáveis com déficit.
  //   PUXAR   (pins aumentaram HT net): retira greedy por folga desc, cap = folga de cada um.
  //   Fallback LIBERAR: nenhum editável tem déficit → saldoNaoPlanejado (não distribui).
  //   Fallback PUXAR  : folga total < falta → precisaDecisaoManual (não distribui).
  const somaIntocaveis = classificados
    .filter(m => !m.editavel)
    .reduce((acc, m) => acc.plus(m.pinado ? m.pinoValor! : m.baseMetaHT), D0);

  const editaveis     = classificados.filter(m => m.editavel);
  const saldoEditavel = valorHT.minus(somaIntocaveis);

  const ajustes = new Map<number, Prisma.Decimal>(); // i → delta (+acréscimo / -retirada)
  let saldoNaoPlanejado:   Prisma.Decimal | null = null;
  let precisaDecisaoManual: {
    faltam: string;
    folgaPorMes: { ano: number; mes: number; folga: string }[];
  } | null = null;

  if (temPinos && editaveis.length > 0) {
    const baseEditavelTotal = editaveis.reduce((acc, m) => acc.plus(m.baseMetaHT), D0);
    const diferenca         = saldoEditavel.minus(baseEditavelTotal);
    // diferenca > 0 → LIBERAR; diferenca < 0 → PUXAR; = 0 → sem cascata necessária

    if (diferenca.greaterThan(D0)) {
      // ── LIBERAR: proporcional ao déficit ──────────────────────────────────
      const saldo      = diferenca;
      const candidatos = editaveis
        .map(m => ({ m, deficit: m.baseMetaHT.minus(receitaPorMes.get(m.key) ?? D0) }))
        .filter(({ deficit }) => deficit.greaterThan(D0));

      if (candidatos.length === 0) {
        saldoNaoPlanejado = saldo;
      } else {
        const totalDeficit = candidatos.reduce((acc, { deficit }) => acc.plus(deficit), D0);
        let alocado = D0;
        candidatos.forEach(({ m, deficit }, ci) => {
          const parcela = ci < candidatos.length - 1
            ? saldo.times(deficit).dividedBy(totalDeficit).toDecimalPlaces(2)
            : saldo.minus(alocado); // último absorve resíduo de arredondamento
          ajustes.set(m.i, parcela);
          alocado = alocado.plus(parcela);
        });
      }

    } else if (diferenca.lessThan(D0)) {
      // ── PUXAR: proporcional à folga, com teto iterativo ──────────────────
      // Cada mês editável cede proporcional à sua folga. Se a cota exceder
      // a folga disponível (salvaguarda para arredondamento), o mês é
      // capado na folga e o restante é redistribuído na próxima rodada.
      const falta      = diferenca.negated();
      const candidatos = editaveis
        .map(m => ({ m, folga: (receitaPorMes.get(m.key) ?? D0).minus(m.baseMetaHT) }))
        .filter(({ folga }) => folga.greaterThan(D0));

      const folgaTotal = candidatos.reduce((acc, { folga }) => acc.plus(folga), D0);

      if (folgaTotal.lessThan(falta)) {
        precisaDecisaoManual = {
          faltam:      falta.minus(folgaTotal).toFixed(2),
          folgaPorMes: candidatos.map(({ m, folga }) => ({
            ano: m.ano, mes: m.mes, folga: folga.toFixed(2),
          })),
        };
      } else {
        const retiradasMap = new Map<number, Prisma.Decimal>();
        let ativosArr = candidatos.map((c, ci) => ({ ...c, ci, folgaDisp: c.folga }));
        let restante  = falta;

        while (restante.greaterThan(D0) && ativosArr.length > 0) {
          const folgaAtivos = ativosArr.reduce((acc, a) => acc.plus(a.folgaDisp), D0);
          const proxAtivos: typeof ativosArr = [];
          let houveCapado = false;

          for (const a of ativosArr) {
            const cota = restante.times(a.folgaDisp).dividedBy(folgaAtivos).toDecimalPlaces(2);
            if (cota.greaterThan(a.folgaDisp)) {
              // Capado: cede toda a folga disponível e sai desta rodada
              retiradasMap.set(a.ci, (retiradasMap.get(a.ci) ?? D0).plus(a.folgaDisp));
              restante = restante.minus(a.folgaDisp);
              houveCapado = true;
            } else {
              proxAtivos.push(a);
            }
          }

          if (!houveCapado) {
            // Sem caps: distribuição final, último absorve resíduo de arredondamento
            let alocado = D0;
            proxAtivos.forEach(({ ci, folgaDisp }, ni) => {
              const cota = ni < proxAtivos.length - 1
                ? restante.times(folgaDisp).dividedBy(folgaAtivos).toDecimalPlaces(2)
                : restante.minus(alocado);
              retiradasMap.set(ci, (retiradasMap.get(ci) ?? D0).plus(cota));
              alocado = alocado.plus(cota);
            });
            restante = D0;
            break;
          }

          ativosArr = proxAtivos;
        }

        for (const [ci, retirada] of retiradasMap) {
          ajustes.set(candidatos[ci].m.i, retirada.negated());
        }
      }
    }
  }

  // ── Monta mesCalcs (com Decimals, sem serialização) ──────────────────────────
  // O GET serializa para string (.toFixed(2)); o motor usa os Decimals diretamente.
  let somaMetaHT         = D0;
  let totalCortadoPeloPiso = D0;
  const mesCalcs: MetaMesCalc[] = classificados.map(({ i, ano, mes, pinado, fechado, pinadaMedicao, pinadoOficial, baseMetaHT, metaHTSemPiso, pinoValor, key }) => {
    let metaHT: Prisma.Decimal;
    if (pinado) {
      metaHT = pinoValor!;
    } else {
      // fechado → ajuste=0 (intocável); editável → ajuste da cascata (0 se sem cascata)
      metaHT = baseMetaHT.plus(ajustes.get(i) ?? D0);
    }
    somaMetaHT = somaMetaHT.plus(metaHT);

    // Piso: rastreia valor cortado em meses sem pino de meta (pino de meta sobrescreve a regra)
    if (!pinado && metaHTSemPiso.lessThan(D0)) {
      totalCortadoPeloPiso = totalCortadoPeloPiso.plus(metaHTSemPiso.negated());
    }

    const receitaPlanejada = receitaPorMes.get(key) ?? D0;
    const deficit = metaHT.greaterThan(receitaPlanejada)
      ? metaHT.minus(receitaPlanejada) : D0;

    // §4.1: aviso de piso (meses sem pino de meta onde oficial > medição)
    const avisoPiso = (!pinado && metaHTSemPiso.lessThan(D0))
      ? `R$ ${metaHTSemPiso.negated().toFixed(2)} de valor oficial excede a medição deste mês`
      : null;

    return {
      ano, mes, key,
      medicao:          medicoes[i]!,
      pinadaMedicao,
      oficialAlocado:   oficialFinal[i]!,
      pinadoOficial,
      ajustadoOficial:  ajustadosOficial.has(i),
      metaHT,
      pinado, fechado,
      receitaPlanejada,
      deficit,
      avisoPiso,
    };
  });

  return {
    valorTotal, valorOficial, valorHT, numMeses,
    estrategiaOficial: estrategia,
    meses, mesCalcs, somaMetaHT, totalCortadoPeloPiso,
    temPinos, avisoEstouroMedicao, avisoEstouroOficial,
    saldoNaoPlanejado, precisaDecisaoManual,
  };
}
