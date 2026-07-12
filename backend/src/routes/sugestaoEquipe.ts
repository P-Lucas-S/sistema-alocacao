// ── POST /api/projetos/:id/sugestao-equipe — Motor F4b ────────────────────────
// F4a (nucleo): waterfall, blocos, camadas, minimos, read-only — provado 64/64.
// F4b (orquestracao): loop multi-mes, promocao intra-execucao, maxExternos global.
//
// Body: { mes?: string } | { meses?: string[] } | {} (default = meses abertos c/ deficit>0)
// Backward compat: { mes } e tratado como { meses: [mes] }.
// Parametros echados sempre com meses[] (array).
import express from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prisma.js';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.js';
import { TETO_HORAS_MES, mesEstaFechado } from './alocacoes.js';
import { carregarTarifas, resolverTarifa } from '../lib/tarifa.js';
import { computarMetaApropriacao } from '../lib/metaApropriacaoCalc.js';

const router = express.Router({ mergeParams: true });

const D0    = new Prisma.Decimal(0);
const BLOCO = new Prisma.Decimal(4);

function floorBloco(x: Prisma.Decimal): Prisma.Decimal {
  if (x.lessThanOrEqualTo(D0)) return D0;
  return x.dividedBy(BLOCO).floor().times(BLOCO);
}
function ceilBloco(x: Prisma.Decimal): Prisma.Decimal {
  if (x.lessThanOrEqualTo(D0)) return D0;
  return x.dividedBy(BLOCO).ceil().times(BLOCO);
}

type LinhaSugestao = {
  colaboradorId: string; nome: string; profissao: string; mes: string;
  horas: number; tarifa: string; receita: string;
  camada: 'fixado' | 'equipe' | 'novo';
  disponibilidadeVista: number; disponibilidadeApos: number; explicacao: string;
};

router.post('/', authenticate, requireRole('admin', 'gestor', 'chefe'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const role   = req.user!.role;

    // ── Carrega projeto ──────────────────────────────────────────────────────
    const projeto = await prisma.projeto.findUnique({
      where: { id },
      select: {
        id: true, gestorId: true, categoriaId: true,
        valorTotal: true, valorOficial: true,
        estrategiaOficial: true,
        vigenciaInicio: true, vigenciaFim: true,
      },
    });
    if (!projeto) return res.status(404).json({ error: 'Projeto não encontrado' });
    if (role === 'gestor' && projeto.gestorId !== userId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    if (!projeto.vigenciaInicio || !projeto.vigenciaFim || projeto.valorTotal == null) {
      return res.json({ configurado: false });
    }

    // ── Parse body ───────────────────────────────────────────────────────────
    const {
      mes:            mesRaw,
      meses:          mesesRaw,
      profissoes:     profissoesRaw,
      fixados:        fixadosRaw,
      excluidos:      excluidosRaw,
      minHorasNovo:   minHorasNovoRaw,
      maxHorasPessoa: maxHorasPessoaRaw,
      maxExternos:    maxExternosRaw,
    } = req.body as {
      mes?:            string;
      meses?:          string[];
      profissoes?:     string[];
      fixados?:        { colaboradorId: string; minHoras?: number }[];
      excluidos?:      string[];
      minHorasNovo?:   number;
      maxHorasPessoa?: number;
      maxExternos?:    number;
    };

    // Constrói lista bruta de meses (null → default calculado depois)
    let mesesInput: string[] | null = null;
    if (Array.isArray(mesesRaw) && mesesRaw.length > 0) {
      mesesInput = mesesRaw;
    } else if (mesRaw) {
      mesesInput = [mesRaw];
    }

    // Valida formato YYYY-MM dos meses explícitos
    if (mesesInput) {
      for (const m of mesesInput) {
        const parts = m.split('-');
        const a  = parseInt(parts[0] ?? '');
        const me = parseInt(parts[1] ?? '');
        if (!a || !me || me < 1 || me > 12) {
          return res.status(400).json({ error: `mes inválido (esperado: YYYY-MM): ${m}` });
        }
      }
    }

    const profissoes: string[] | null = (profissoesRaw && profissoesRaw.length > 0)
      ? profissoesRaw : null;
    const fixadosLista: { colaboradorId: string; minHoras?: number }[] = fixadosRaw ?? [];
    const excluidos      = new Set<string>(excluidosRaw ?? []);
    const fixadosIds     = new Set<string>(fixadosLista.map(f => f.colaboradorId));
    const fixadosMap     = new Map(fixadosLista.map(f => [f.colaboradorId, f]));
    const minHorasNovo   = new Prisma.Decimal(minHorasNovoRaw ?? 8);
    const maxHorasPessoa = new Prisma.Decimal(maxHorasPessoaRaw ?? 60);
    const maxExternos: number | null = maxExternosRaw ?? null; // null = ilimitado
    const categoriaId    = projeto.categoriaId ?? null;

    // ── Computa déficit via helper compartilhado (= GET meta) ────────────────
    const calc = await computarMetaApropriacao(id, projeto);
    if (!calc) return res.json({ configurado: false });

    // Vigência para validação
    const viAno = projeto.vigenciaInicio.getUTCFullYear();
    const viMes = projeto.vigenciaInicio.getUTCMonth() + 1;
    const vfAno = projeto.vigenciaFim.getUTCFullYear();
    const vfMes = projeto.vigenciaFim.getUTCMonth() + 1;

    function dentroVigencia(aN: number, mN: number): boolean {
      return (aN > viAno || (aN === viAno && mN >= viMes)) &&
             (aN < vfAno  || (aN === vfAno  && mN <= vfMes));
    }

    // ── Build lista ordenada de meses a processar ────────────────────────────
    let mesesOrdenados: string[];
    if (mesesInput) {
      // Valida vigência para meses explícitos
      for (const m of mesesInput) {
        const [as, ms] = m.split('-');
        if (!dentroVigencia(parseInt(as!), parseInt(ms!))) {
          return res.status(400).json({ error: `mes ${m} fora da vigência do projeto` });
        }
      }
      // Sort lexicográfico = cronológico para YYYY-MM; remove duplicatas
      mesesOrdenados = [...new Set(mesesInput)].sort();
    } else {
      // Default: meses ABERTOS (deficit > 0) dentro da vigência, max 12
      mesesOrdenados = calc.mesCalcs
        .filter(m => m.deficit.greaterThan(D0))
        .map(m => `${m.ano}-${String(m.mes).padStart(2, '0')}`)
        .filter(m => {
          const [as, ms] = m.split('-');
          return dentroVigencia(parseInt(as!), parseInt(ms!));
        })
        .slice(0, 12);
    }

    // Backward compat F4a: chamada de 1 mês explícito + fechado → 400
    // Multi-mês: meses fechados são pulados dentro do loop (spec §F4b)
    if (mesesInput !== null && mesesOrdenados.length === 1) {
      const [as, ms] = mesesOrdenados[0]!.split('-');
      if (await mesEstaFechado(parseInt(as!), parseInt(ms!))) {
        return res.status(400).json({ error: 'mês fechado', mes: mesesOrdenados[0] });
      }
    }

    if (mesesOrdenados.length === 0) {
      return res.json({
        configurado: true,
        geradoEm: new Date().toISOString(),
        parametros: buildParametros(mesesOrdenados, profissoes, fixadosLista, excluidos,
          minHorasNovo, maxHorasPessoa, maxExternos),
        linhas: [], totaisPorMes: [], remanescentes: [], avisos: [],
      });
    }

    // ── Carrega colaboradores (uma vez, antes do loop) ───────────────────────
    // Fixados: sempre incluídos
    const fixadosColabs = fixadosLista.length > 0
      ? await prisma.colaborador.findMany({
          where: { id: { in: fixadosLista.map(f => f.colaboradorId) } },
          select: {
            id: true, nome: true, valorHora: true,
            profissao: { select: { id: true, nome: true } },
          },
        })
      : [];

    // Pool ativo (camadas 2+3), filtrado por profissoes se fornecidas
    const poolCollabs = await prisma.colaborador.findMany({
      where: profissoes ? { ativo: true, profissaoId: { in: profissoes } } : { ativo: true },
      select: {
        id: true, nome: true, valorHora: true,
        profissao: { select: { id: true, nome: true } },
      },
    });

    const poolIds         = new Set(poolCollabs.map(c => c.id));
    const fixadosColabIds = new Set(fixadosColabs.map(c => c.id));

    // Equipe histórica: colaboradores com alocações neste projeto em qualquer mês do período
    // (podem não estar no pool por filtro de profissão, mas precisam ter colabInfo)
    const mesesParsed = mesesOrdenados.map(m => {
      const [as, ms] = m.split('-');
      return { ano: parseInt(as!), mes: parseInt(ms!) };
    });
    const alocsHistoricasProj = await prisma.alocacao.findMany({
      where: { projetoId: id, OR: mesesParsed.map(({ ano, mes }) => ({ ano, mes })) },
      select: { colaboradorId: true },
    });
    const equipeHistoricaIds = [...new Set(alocsHistoricasProj.map(a => a.colaboradorId))];
    const equipeHistFaltando  = equipeHistoricaIds.filter(
      eid => !poolIds.has(eid) && !fixadosColabIds.has(eid),
    );
    const equipeHistExtras = equipeHistFaltando.length > 0
      ? await prisma.colaborador.findMany({
          where: { id: { in: equipeHistFaltando } },
          select: {
            id: true, nome: true, valorHora: true,
            profissao: { select: { id: true, nome: true } },
          },
        })
      : [];

    // Mapa unificado de todos os colaboradores relevantes
    type ColabRaw = { id: string; nome: string; valorHora: Prisma.Decimal | null; profissao: { id: string; nome: string } | null };
    const allColabMap = new Map<string, ColabRaw>();
    for (const c of poolCollabs)    allColabMap.set(c.id, { ...c, profissao: c.profissao ?? null });
    for (const c of equipeHistExtras) if (!allColabMap.has(c.id)) allColabMap.set(c.id, { ...c, profissao: c.profissao ?? null });
    for (const c of fixadosColabs)   if (!allColabMap.has(c.id)) allColabMap.set(c.id, { ...c, profissao: c.profissao ?? null });
    const allColabIds = [...allColabMap.keys()];

    // Tarifas em lote (1 query, reutilizado em todos os meses)
    const tarifasMap = await carregarTarifas(allColabIds);

    type ColabInfo = { id: string; nome: string; profissao: { id: string; nome: string } | null; tarifa: Prisma.Decimal | null };
    const colabInfo = new Map<string, ColabInfo>();
    for (const [cid, c] of allColabMap.entries()) {
      const { valor } = resolverTarifa(tarifasMap, { id: cid, valorHora: c.valorHora }, categoriaId);
      colabInfo.set(cid, { id: cid, nome: c.nome, profissao: c.profissao, tarifa: valor });
    }

    // ── Estado multi-mês ─────────────────────────────────────────────────────
    // promovidos: IDs sugeridos em meses anteriores da mesma execução
    //   → entram na camada 2 ('equipe') nos meses seguintes
    // externosDistintos: IDs distintos introduzidos como 'novo' em qualquer mês
    //   → conta contra maxExternos; atualizado imediatamente ao atribuir horas
    const promovidos        = new Set<string>();
    const externosDistintos = new Set<string>();
    const semTarifaWarned   = new Set<string>(); // avisa só 1x por pessoa

    const allLinhas:        LinhaSugestao[] = [];
    const allTotaisPorMes:  Array<{ mes: string; metaHT: string; receitaAtual: string; deficit: string; coberto: string; sobra: string; deficitRemanescente: string }> = [];
    const allRemanescentes: Array<{ mes: string; valor: string; diagnostico: string[] }> = [];
    const allAvisos:        string[] = [];

    // ── Loop cronológico ─────────────────────────────────────────────────────
    for (const mesStr of mesesOrdenados) {
      const [as, ms] = mesStr.split('-');
      const anoN = parseInt(as!);
      const mesN = parseInt(ms!);

      // Mês fechado → pula
      if (await mesEstaFechado(anoN, mesN)) {
        allAvisos.push(`${mesStr}: mês fechado, pulado`);
        continue;
      }

      const mesCalc = calc.mesCalcs.find(m => m.ano === anoN && m.mes === mesN);
      if (!mesCalc) { allAvisos.push(`${mesStr}: fora da vigência, pulado`); continue; }

      const deficit      = mesCalc.deficit;
      const metaHT       = mesCalc.metaHT;
      const receitaAtual = mesCalc.receitaPlanejada;

      // Pula mes sem deficit, salvo se há fixados com minHoras forçadas
      const hasFixadosComMinHoras = fixadosLista.some(f => (f.minHoras ?? 0) > 0);
      if (deficit.lessThanOrEqualTo(D0) && !hasFixadosComMinHoras) {
        allTotaisPorMes.push({
          mes: mesStr, metaHT: metaHT.toFixed(2), receitaAtual: receitaAtual.toFixed(2),
          deficit: deficit.toFixed(2), coberto: '0.00', sobra: '0.00', deficitRemanescente: '0.00',
        });
        continue;
      }

      // Equipe deste mes: alocações reais + promovidos (intra-execução)
      const alocsExistentes = await prisma.alocacao.findMany({
        where: { projetoId: id, ano: anoN, mes: mesN },
        select: { colaboradorId: true },
      });
      const equipeAtualIds = new Set<string>([
        ...alocsExistentes.map(a => a.colaboradorId),
        ...promovidos,
      ]);

      // Disponibilidade DESTE mês — recalculada do banco (sem transbordo entre meses)
      const todasAlocs = await prisma.alocacao.findMany({
        where: { colaboradorId: { in: allColabIds }, ano: anoN, mes: mesN },
        select: { colaboradorId: true, horasPlanejadas: true },
      });
      const totalPorColab = new Map<string, Prisma.Decimal>();
      for (const a of todasAlocs) {
        totalPorColab.set(a.colaboradorId,
          (totalPorColab.get(a.colaboradorId) ?? D0).plus(a.horasPlanejadas));
      }
      const dispMap = new Map<string, Prisma.Decimal>();
      for (const cid of allColabIds) {
        dispMap.set(cid, Prisma.Decimal.max(TETO_HORAS_MES.minus(totalPorColab.get(cid) ?? D0), D0));
      }

      // Estado waterfall deste mês
      const linhasDoMes:          LinhaSugestao[] = [];
      const diagnosticoNovosDoMes: string[]         = [];
      let   restante = deficit;
      const horasJaSugeridas = new Map<string, Prisma.Decimal>();

      // ── processarCamada (captura estado deste mês via closure) ─────────────
      const processarCamada = (candidatoIds: string[], camada: 'fixado' | 'equipe' | 'novo'): void => {
        const candidatos = candidatoIds
          .filter(cid => {
            if (excluidos.has(cid)) return false;
            const info = colabInfo.get(cid);
            if (!info || info.tarifa == null) {
              if (info && !semTarifaWarned.has(cid)) {
                semTarifaWarned.add(cid);
                allAvisos.push(`${info.nome}: sem tarifa para esta categoria — excluído da sugestão`);
              }
              return false;
            }
            if (camada !== 'fixado' && profissoes) {
              const profId = info.profissao?.id ?? null;
              if (!profId || !profissoes.includes(profId)) return false;
            }
            return (dispMap.get(cid) ?? D0).greaterThan(D0);
          })
          .sort((a, b) => {
            const da = dispMap.get(a) ?? D0;
            const db = dispMap.get(b) ?? D0;
            const cmp = db.comparedTo(da);
            return cmp !== 0 ? cmp : (a < b ? -1 : a > b ? 1 : 0);
          });

        for (const cid of candidatos) {
          // maxExternos: verifica POR ITERAÇÃO (externosDistintos cresce dentro do loop)
          if (camada === 'novo' && maxExternos !== null &&
              !externosDistintos.has(cid) && externosDistintos.size >= maxExternos) {
            continue;
          }

          // Break quando deficit coberto (salvo fixado com minHoras pendente)
          if (restante.lessThanOrEqualTo(D0)) {
            if (camada !== 'fixado') break;
            const cfg      = fixadosMap.get(cid);
            const minHDec  = cfg?.minHoras ? new Prisma.Decimal(cfg.minHoras) : null;
            const horasAtrib = horasJaSugeridas.get(cid) ?? D0;
            const pendente = minHDec ? horasAtrib.lessThan(ceilBloco(minHDec)) : false;
            if (!pendente) break;
          }

          const info       = colabInfo.get(cid)!;
          const tarifa     = info.tarifa!;
          const disp       = dispMap.get(cid) ?? D0;
          const horasAtrib = horasJaSugeridas.get(cid) ?? D0;
          const margem     = maxHorasPessoa.minus(horasAtrib);
          const tetoPessoa = floorBloco(Prisma.Decimal.min(disp, margem));

          let alvo = tarifa.greaterThan(D0) ? ceilBloco(restante.dividedBy(tarifa)) : D0;

          if (camada === 'fixado') {
            const cfg = fixadosMap.get(cid);
            if (cfg?.minHoras) {
              alvo = Prisma.Decimal.max(alvo, ceilBloco(new Prisma.Decimal(cfg.minHoras)));
            }
          }

          let horas = Prisma.Decimal.min(alvo, tetoPessoa);

          if (camada === 'novo') {
            if (tetoPessoa.lessThan(minHorasNovo)) {
              diagnosticoNovosDoMes.push(
                `${info.nome}: disponibilidade ${tetoPessoa.toNumber()}h < mínimo ${minHorasNovo.toNumber()}h`,
              );
              continue;
            }
            horas = Prisma.Decimal.max(horas, minHorasNovo);
          }

          if (horas.lessThanOrEqualTo(D0)) continue;

          const dispVista = disp;
          const dispApos  = dispVista.minus(horas);
          const receita   = horas.times(tarifa);

          let explicacao: string;
          if (camada === 'fixado') {
            const cfg = fixadosMap.get(cid);
            explicacao = cfg?.minHoras
              ? `fixado com mínimo ${cfg.minHoras}h; ${dispVista.toNumber()}h livres; R$ ${tarifa.toFixed(2)}/h`
              : `fixado; ${dispVista.toNumber()}h livres; R$ ${tarifa.toFixed(2)}/h`;
          } else if (camada === 'equipe') {
            explicacao = `já no projeto; ${dispVista.toNumber()}h livres; R$ ${tarifa.toFixed(2)}/h`;
          } else {
            explicacao = `novo entrante; ${dispVista.toNumber()}h livres; R$ ${tarifa.toFixed(2)}/h`;
          }

          linhasDoMes.push({
            colaboradorId: cid, nome: info.nome, profissao: info.profissao?.nome ?? '',
            mes: mesStr, horas: horas.toNumber(), tarifa: tarifa.toFixed(2),
            receita: receita.toFixed(2), camada,
            disponibilidadeVista: dispVista.toNumber(),
            disponibilidadeApos:  dispApos.toNumber(),
            explicacao,
          });

          if (dispApos.greaterThanOrEqualTo(D0) && dispApos.lessThan(new Prisma.Decimal(20))) {
            allAvisos.push(`${info.nome} ficará com ${dispApos.toNumber()}h livres em ${mesStr}`);
          }

          restante = restante.minus(receita);
          dispMap.set(cid, dispApos);
          horasJaSugeridas.set(cid, horasAtrib.plus(horas));

          // Atualiza externosDistintos imediatamente (controle de maxExternos dentro do mês)
          if (camada === 'novo') externosDistintos.add(cid);
        }
      };

      // Camada 1: fixados
      processarCamada([...fixadosIds], 'fixado');

      // Camada 2: equipeAtual (real + promovidos) − fixados
      const equipeIds = [...equipeAtualIds].filter(eid => !fixadosIds.has(eid));
      processarCamada(equipeIds, 'equipe');

      // Camada 3: pool − equipeAtual − fixados
      const externosIds = poolCollabs
        .map(c => c.id)
        .filter(cid => !equipeAtualIds.has(cid) && !fixadosIds.has(cid));
      processarCamada(externosIds, 'novo');

      // ── Atualiza estado multi-mês ────────────────────────────────────────
      // Todos os sugeridos neste mês entram em promovidos (camada 2 nos próximos meses)
      for (const linha of linhasDoMes) promovidos.add(linha.colaboradorId);

      // ── Totais deste mês ─────────────────────────────────────────────────
      const sobra               = restante.lessThan(D0) ? restante.negated() : D0;
      const deficitRemanescente = restante.greaterThan(D0) ? restante : D0;
      const coberto             = deficit.minus(deficitRemanescente).plus(sobra);

      allTotaisPorMes.push({
        mes: mesStr, metaHT: metaHT.toFixed(2), receitaAtual: receitaAtual.toFixed(2),
        deficit: deficit.toFixed(2), coberto: coberto.toFixed(2),
        sobra: sobra.toFixed(2), deficitRemanescente: deficitRemanescente.toFixed(2),
      });

      if (deficitRemanescente.greaterThan(D0)) {
        allRemanescentes.push({
          mes:        mesStr,
          valor:      deficitRemanescente.toFixed(2),
          diagnostico: diagnosticoNovosDoMes.length > 0
            ? diagnosticoNovosDoMes
            : ['Capacidade insuficiente dos candidatos disponíveis'],
        });
      }

      allLinhas.push(...linhasDoMes);
    }

    return res.json({
      geradoEm:   new Date().toISOString(),
      parametros: buildParametros(mesesOrdenados, profissoes, fixadosLista, excluidos,
        minHorasNovo, maxHorasPessoa, maxExternos),
      linhas:        allLinhas,
      totaisPorMes:  allTotaisPorMes,
      remanescentes: allRemanescentes,
      avisos:        allAvisos,
    });

  } catch (error) {
    console.error('Sugestão equipe error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function buildParametros(
  meses: string[],
  profissoes: string[] | null,
  fixadosLista: { colaboradorId: string; minHoras?: number }[],
  excluidos: Set<string>,
  minHorasNovo: Prisma.Decimal,
  maxHorasPessoa: Prisma.Decimal,
  maxExternos: number | null,
) {
  return {
    meses,
    profissoes:     profissoes ?? null,
    fixados:        fixadosLista.map(f => ({ colaboradorId: f.colaboradorId, minHoras: f.minHoras ?? null })),
    excluidos:      [...excluidos],
    minHorasNovo:   minHorasNovo.toNumber(),
    maxHorasPessoa: maxHorasPessoa.toNumber(),
    maxExternos:    maxExternos ?? null,
  };
}

export default router;
