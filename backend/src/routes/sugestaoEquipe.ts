// ── POST /api/projetos/:id/sugestao-equipe — Motor F4a ────────────────────────
// Read-only: POST pelo corpo rico; nenhuma escrita no banco.
// Posse: mesmo critério do GET meta-apropriacao (gestor dono / chefe / admin).
// F4a: single month only — sem loop multi-mês, sem promoção intra-execução.
import express from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prisma.js';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.js';
import { TETO_HORAS_MES, mesEstaFechado } from './alocacoes.js';
import { carregarTarifas, resolverTarifa } from '../lib/tarifa.js';
import { computarMetaApropriacao } from '../lib/metaApropriacaoCalc.js';

// mergeParams: true permite acessar :id do app.use pai
const router = express.Router({ mergeParams: true });

const D0   = new Prisma.Decimal(0);
const BLOCO = new Prisma.Decimal(4);

function floorBloco(x: Prisma.Decimal): Prisma.Decimal {
  if (x.lessThanOrEqualTo(D0)) return D0;
  return x.dividedBy(BLOCO).floor().times(BLOCO);
}

function ceilBloco(x: Prisma.Decimal): Prisma.Decimal {
  if (x.lessThanOrEqualTo(D0)) return D0;
  return x.dividedBy(BLOCO).ceil().times(BLOCO);
}

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
      mes:            mesStr,
      profissoes:     profissoesRaw,
      fixados:        fixadosRaw,
      excluidos:      excluidosRaw,
      minHorasNovo:   minHorasNovoRaw,
      maxHorasPessoa: maxHorasPessoaRaw,
    } = req.body as {
      mes?:            string;
      profissoes?:     string[];
      fixados?:        { colaboradorId: string; minHoras?: number }[];
      excluidos?:      string[];
      minHorasNovo?:   number;
      maxHorasPessoa?: number;
    };

    if (!mesStr) return res.status(400).json({ error: 'mes é obrigatório (YYYY-MM)' });
    // TypeScript não estreita string|undefined em closures; const garante o tipo aqui
    const mesStrSafe: string = mesStr;
    const parts = mesStr.split('-');
    const anoN  = parseInt(parts[0] ?? '');
    const mesN  = parseInt(parts[1] ?? '');
    if (!anoN || !mesN || mesN < 1 || mesN > 12) {
      return res.status(400).json({ error: 'mes inválido (esperado: YYYY-MM)' });
    }

    // Valida que o mês está dentro da vigência
    const viAno = projeto.vigenciaInicio.getUTCFullYear();
    const viMes = projeto.vigenciaInicio.getUTCMonth() + 1;
    const vfAno = projeto.vigenciaFim.getUTCFullYear();
    const vfMes = projeto.vigenciaFim.getUTCMonth() + 1;
    const dentroVig = (anoN > viAno || (anoN === viAno && mesN >= viMes)) &&
                      (anoN < vfAno  || (anoN === vfAno  && mesN <= vfMes));
    if (!dentroVig) {
      return res.status(400).json({ error: 'mes fora da vigência do projeto' });
    }

    if (await mesEstaFechado(anoN, mesN)) {
      return res.status(400).json({ error: 'mês fechado', mes: mesStr });
    }

    const profissoes: string[] | null = (profissoesRaw && profissoesRaw.length > 0)
      ? profissoesRaw : null;
    const fixadosLista: { colaboradorId: string; minHoras?: number }[] = fixadosRaw ?? [];
    const excluidos     = new Set<string>(excluidosRaw ?? []);
    const fixadosIds    = new Set<string>(fixadosLista.map(f => f.colaboradorId));
    const fixadosMap    = new Map(fixadosLista.map(f => [f.colaboradorId, f]));
    const minHorasNovo  = new Prisma.Decimal(minHorasNovoRaw ?? 8);
    const maxHorasPessoa = new Prisma.Decimal(maxHorasPessoaRaw ?? 60);
    const categoriaId   = projeto.categoriaId ?? null;

    // ── Computa déficit via helper compartilhado (= mesma conta do GET meta) ─
    const calc = await computarMetaApropriacao(id, projeto);
    if (!calc) return res.json({ configurado: false });

    const mesCalc = calc.mesCalcs.find(m => m.ano === anoN && m.mes === mesN);
    if (!mesCalc) return res.status(400).json({ error: 'mes não encontrado na vigência' });

    const deficit       = mesCalc.deficit;
    const metaHT        = mesCalc.metaHT;
    const receitaAtual  = mesCalc.receitaPlanejada;

    // ── Equipe atual: quem tem alocação NESTE projeto neste mês ─────────────
    const alocsExistentes = await prisma.alocacao.findMany({
      where: { projetoId: id, ano: anoN, mes: mesN },
      select: { colaboradorId: true },
    });
    const equipeAtualIds = new Set<string>(alocsExistentes.map(a => a.colaboradorId));

    // ── Pool de candidatos ───────────────────────────────────────────────────
    // Fixados: sempre incluídos (independente de ativo / profissão)
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
      where: profissoes
        ? { ativo: true, profissaoId: { in: profissoes } }
        : { ativo: true },
      select: {
        id: true, nome: true, valorHora: true,
        profissao: { select: { id: true, nome: true } },
      },
    });

    // Membros da equipe atual que possam não estar no pool (por filtro de profissão)
    const poolIds       = new Set(poolCollabs.map(c => c.id));
    const fixadosColabIds = new Set(fixadosColabs.map(c => c.id));
    const equipeAtualFaltando = [...equipeAtualIds].filter(
      eid => !poolIds.has(eid) && !fixadosColabIds.has(eid)
    );
    const equipeAtualExtras = equipeAtualFaltando.length > 0
      ? await prisma.colaborador.findMany({
          where: { id: { in: equipeAtualFaltando } },
          select: {
            id: true, nome: true, valorHora: true,
            profissao: { select: { id: true, nome: true } },
          },
        })
      : [];

    // Mapa unificado de todos os colaboradores relevantes
    const allColabMap = new Map<string, { id: string; nome: string; valorHora: Prisma.Decimal | null; profissao: { id: string; nome: string } | null }>();
    for (const c of poolCollabs)       allColabMap.set(c.id, { ...c, profissao: c.profissao ?? null });
    for (const c of equipeAtualExtras) if (!allColabMap.has(c.id)) allColabMap.set(c.id, { ...c, profissao: c.profissao ?? null });
    for (const c of fixadosColabs)     if (!allColabMap.has(c.id)) allColabMap.set(c.id, { ...c, profissao: c.profissao ?? null });
    const allColabIds = [...allColabMap.keys()];

    // ── Disponibilidade em lote (1 query) — TETO − totalAlocado global ───────
    const todasAlocs = await prisma.alocacao.findMany({
      where: { colaboradorId: { in: allColabIds }, ano: anoN, mes: mesN },
      select: { colaboradorId: true, horasPlanejadas: true },
    });
    const totalPorColab = new Map<string, Prisma.Decimal>();
    for (const a of todasAlocs) {
      totalPorColab.set(a.colaboradorId,
        (totalPorColab.get(a.colaboradorId) ?? D0).plus(a.horasPlanejadas));
    }
    // dispMap é mutado conforme o motor atribui horas (snapshot por linha)
    const dispMap = new Map<string, Prisma.Decimal>();
    for (const cid of allColabIds) {
      dispMap.set(cid, Prisma.Decimal.max(TETO_HORAS_MES.minus(totalPorColab.get(cid) ?? D0), D0));
    }

    // ── Tarifas em lote (1 query) ─────────────────────────────────────────────
    const tarifasMap = await carregarTarifas(allColabIds);

    // Resolve tarifa e monta colabInfo
    type ColabInfo = {
      id: string; nome: string;
      profissao: { id: string; nome: string } | null;
      tarifa: Prisma.Decimal | null;
    };
    const colabInfo = new Map<string, ColabInfo>();
    for (const [cid, c] of allColabMap.entries()) {
      const { valor } = resolverTarifa(tarifasMap, { id: cid, valorHora: c.valorHora }, categoriaId);
      colabInfo.set(cid, { id: cid, nome: c.nome, profissao: c.profissao, tarifa: valor });
    }

    // ── Waterfall ─────────────────────────────────────────────────────────────
    const linhas: Array<{
      colaboradorId: string; nome: string; profissao: string; mes: string;
      horas: number; tarifa: string; receita: string;
      camada: 'fixado' | 'equipe' | 'novo';
      disponibilidadeVista: number; disponibilidadeApos: number; explicacao: string;
    }> = [];
    const avisos: string[] = [];
    const diagnosticoNovos: string[] = [];
    const semTarifaWarned = new Set<string>();

    let restante = deficit;
    const horasJaSugeridas = new Map<string, Prisma.Decimal>();

    function processarCamada(candidatoIds: string[], camada: 'fixado' | 'equipe' | 'novo'): void {
      // Filtra e ordena: excluídos fora; sem tarifa fora + aviso; disp > 0
      // profissões filtram camadas 2 e 3 (fixados ignoram o filtro de profissão)
      const candidatos = candidatoIds
        .filter(cid => {
          if (excluidos.has(cid)) return false;
          const info = colabInfo.get(cid);
          if (!info || info.tarifa == null) {
            if (info && !semTarifaWarned.has(cid)) {
              semTarifaWarned.add(cid);
              avisos.push(`${info.nome}: sem tarifa para esta categoria — excluído da sugestão`);
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
          const cmp = db.comparedTo(da); // disp DESC
          return cmp !== 0 ? cmp : (a < b ? -1 : a > b ? 1 : 0); // id ASC
        });

      for (const cid of candidatos) {
        // Break quando o déficit está coberto
        if (restante.lessThanOrEqualTo(D0)) {
          if (camada !== 'fixado') break;
          // Fixados: só continua se ESTE fixado tem minHoras pendentes
          const cfg = fixadosMap.get(cid);
          const minHDec = cfg?.minHoras ? new Prisma.Decimal(cfg.minHoras) : null;
          const horasAtrib = horasJaSugeridas.get(cid) ?? D0;
          const pendente = minHDec ? horasAtrib.lessThan(ceilBloco(minHDec)) : false;
          if (!pendente) break;
        }

        const info      = colabInfo.get(cid)!;
        const tarifa    = info.tarifa!;
        const disp      = dispMap.get(cid) ?? D0;
        const horasAtrib = horasJaSugeridas.get(cid) ?? D0;
        const margem    = maxHorasPessoa.minus(horasAtrib);
        const tetoPessoa = floorBloco(Prisma.Decimal.min(disp, margem));

        // Alvo: ceilBloco do que a tarifa exige para fechar o déficit
        let alvo = tarifa.greaterThan(D0) ? ceilBloco(restante.dividedBy(tarifa)) : D0;

        // Fixado com minHoras: garante o mínimo mesmo com déficit <= 0
        if (camada === 'fixado') {
          const cfg = fixadosMap.get(cid);
          if (cfg?.minHoras) {
            alvo = Prisma.Decimal.max(alvo, ceilBloco(new Prisma.Decimal(cfg.minHoras)));
          }
        }

        let horas = Prisma.Decimal.min(alvo, tetoPessoa);

        // Novo entrante: duas regras do mínimo (spec §1.2 e §3)
        if (camada === 'novo') {
          if (tetoPessoa.lessThan(minHorasNovo)) {
            // Regra A: teto < mínimo → pula + diagnóstico
            diagnosticoNovos.push(
              `${info.nome}: disponibilidade ${tetoPessoa.toNumber()}h < mínimo ${minHorasNovo.toNumber()}h`
            );
            continue;
          }
          // Regra B: entra com pelo menos minHorasNovo (a sobra é reportada)
          horas = Prisma.Decimal.max(horas, minHorasNovo);
        }

        if (horas.lessThanOrEqualTo(D0)) continue;

        // Snapshot de disponibilidade ANTES da atribuição
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

        linhas.push({
          colaboradorId: cid,
          nome:          info.nome,
          profissao:     info.profissao?.nome ?? '',
          mes:           mesStrSafe,
          horas:         horas.toNumber(),
          tarifa:        tarifa.toFixed(2),
          receita:       receita.toFixed(2),
          camada,
          disponibilidadeVista:  dispVista.toNumber(),
          disponibilidadeApos:   dispApos.toNumber(),
          explicacao,
        });

        // Aviso soft: < 20h livres após atribuição
        if (dispApos.greaterThanOrEqualTo(D0) && dispApos.lessThan(new Prisma.Decimal(20))) {
          avisos.push(`${info.nome} ficará com ${dispApos.toNumber()}h livres em ${mesStr}`);
        }

        // Atualiza estado
        restante = restante.minus(receita);
        dispMap.set(cid, dispApos);
        horasJaSugeridas.set(cid, horasAtrib.plus(horas));
      }
    }

    // Camada 1: fixados
    processarCamada([...fixadosIds], 'fixado');

    // Camada 2: equipe atual − fixados − excluídos
    const equipeIds = [...equipeAtualIds].filter(eid => !fixadosIds.has(eid));
    processarCamada(equipeIds, 'equipe');

    // Camada 3: pool ativo − equipe atual − fixados
    const externosIds = poolCollabs
      .map(c => c.id)
      .filter(cid => !equipeAtualIds.has(cid) && !fixadosIds.has(cid));
    processarCamada(externosIds, 'novo');

    // ── Totais ───────────────────────────────────────────────────────────────
    // restante = deficit − sum(receitas); pode ser negativo (sobra) ou positivo (remanescente)
    const sobra               = restante.lessThan(D0) ? restante.negated() : D0;
    const deficitRemanescente = restante.greaterThan(D0) ? restante : D0;
    const coberto             = deficit.minus(deficitRemanescente).plus(sobra); // = total atribuído

    const remanescentes = deficitRemanescente.greaterThan(D0)
      ? [{
          mes:        mesStr,
          valor:      deficitRemanescente.toFixed(2),
          diagnostico: diagnosticoNovos.length > 0
            ? diagnosticoNovos
            : ['Capacidade insuficiente dos candidatos disponíveis'],
        }]
      : [];

    return res.json({
      geradoEm:   new Date().toISOString(),
      parametros: {
        mes:            mesStr,
        profissoes:     profissoes ?? null,
        fixados:        fixadosLista.map(f => ({ colaboradorId: f.colaboradorId, minHoras: f.minHoras ?? null })),
        excluidos:      [...excluidos],
        minHorasNovo:   minHorasNovo.toNumber(),
        maxHorasPessoa: maxHorasPessoa.toNumber(),
      },
      linhas,
      totaisPorMes: [{
        mes:                 mesStr,
        metaHT:              metaHT.toFixed(2),
        receitaAtual:        receitaAtual.toFixed(2),
        deficit:             deficit.toFixed(2),
        coberto:             coberto.toFixed(2),
        sobra:               sobra.toFixed(2),
        deficitRemanescente: deficitRemanescente.toFixed(2),
      }],
      remanescentes,
      avisos,
    });

  } catch (error) {
    console.error('Sugestão equipe error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
