import express from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prisma.js';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.js';
import { TETO_HORAS_MES } from './alocacoes.js';
import { computeProxima } from './projetos.js';

const router = express.Router();

// ── Constantes — fase P1: limiares fixos. Virão de tabela de configuração
// numa fase futura (fixar/pausar também), mas por ora são const nomeadas. ──
const PRAZO_ALTA_DIAS  = 7;  // vencida OU vence em <= 7 dias  → 'alta'
const PRAZO_MEDIA_DIAS = 30; // vence em 8–30 dias              → 'media'
                              // vence em > 30 dias              → 'baixa'
                              // sem prestação cadastrada        → 'sem_prazo'
const CAPACIDADE_ALERTA_PCT = 0.95; // sinal de capacidade: >= 95% do teto

type CategoriaPrazo = 'alta' | 'media' | 'baixa' | 'sem_prazo';

// Ordem final da lista: alta, media, baixa, sem_prazo (dentro de cada uma,
// por horasPendentes desc — aplicado no .sort() abaixo).
const ORDEM_CATEGORIA: Record<CategoriaPrazo, number> = {
  alta: 0, media: 1, baixa: 2, sem_prazo: 3,
};

function diasEntre(dataIso: string, hojeUTC: number): number {
  const d = new Date(dataIso);
  d.setUTCHours(0, 0, 0, 0);
  return Math.round((d.getTime() - hojeUTC) / 86_400_000);
}

export interface PriorizacaoItem {
  projetoId:         string;
  codigo:            string;
  nome:              string;
  categoria:         CategoriaPrazo;
  proximaPrestacao:  string | null;
  diasAteVencimento: number | null;
  horasPendentes:    string;
  porque:            string;
  sinalCapacidade:   boolean;
  ordem:             number;
}

type AlocMes = {
  projetoId: string;
  colaboradorId: string;
  horasPlanejadas: Prisma.Decimal;
  horasRealizadas: Prisma.Decimal | null;
};

export interface CalcularPriorizacaoParams {
  role: string;
  userId: string;
  ano: number;
  mes: number;
}

export interface CalcularPriorizacaoResult {
  itens: PriorizacaoItem[];
  // ── Dados crus reaproveitáveis por quem enriquece depois (ex.: o dashboard
  // de Projetos) — NÃO fazem parte do contrato de resposta do GET /priorizacao.
  categoriaIdPorProjeto: Map<string, string | null>;
  colabsPorProjeto:      Map<string, Set<string>>;
  alocsDoMes:            AlocMes[];
}

// Núcleo do P1 — extraído pra ser reusado (ex.: dashboard de Projetos) sem
// duplicar a lógica de categoria/ordenação/sinal de capacidade. O handler do
// GET / abaixo chama isso e responde só `itens` — contrato do P1 inalterado.
export async function calcularPriorizacao(params: CalcularPriorizacaoParams): Promise<CalcularPriorizacaoResult> {
  const { role, userId, ano: anoN, mes: mesN } = params;

  // ── Escopo — MESMO critério do grid/candidatos (projWhere) ─────────────
  const projWhere = role === 'gestor'
    ? { gestorId: userId, status: 'ativo' }
    : { status: 'ativo' };

  const projetos = await prisma.projeto.findMany({
    where: projWhere,
    orderBy: { codigo: 'asc' },
    select: {
      id: true, codigo: true, nome: true, categoriaId: true,
      prestacoesContas: { select: { id: true, data: true } },
    },
  });

  const categoriaIdPorProjeto = new Map<string, string | null>();
  for (const p of projetos) categoriaIdPorProjeto.set(p.id, p.categoriaId);

  if (projetos.length === 0) {
    return { itens: [], categoriaIdPorProjeto, colabsPorProjeto: new Map(), alocsDoMes: [] };
  }

  const projetoIds = projetos.map(p => p.id);

  // ── Horas pendentes por projeto no mês — EM LOTE (1 query) ──────────────
  // pendente = planejado - COALESCE(realizado, 0), agregando todas as
  // macro/micro do projeto (a query não filtra por elas — soma tudo).
  const alocsDoMes = await prisma.alocacao.findMany({
    where: { projetoId: { in: projetoIds }, ano: anoN, mes: mesN },
    select: { projetoId: true, colaboradorId: true, horasPlanejadas: true, horasRealizadas: true },
  });

  const D0 = new Prisma.Decimal(0);
  const pendentePorProjeto = new Map<string, Prisma.Decimal>();
  const colabsPorProjeto   = new Map<string, Set<string>>();

  for (const a of alocsDoMes) {
    const realizado = a.horasRealizadas ?? D0;
    const pendente  = a.horasPlanejadas.minus(realizado);
    pendentePorProjeto.set(a.projetoId, (pendentePorProjeto.get(a.projetoId) ?? D0).plus(pendente));

    if (!colabsPorProjeto.has(a.projetoId)) colabsPorProjeto.set(a.projetoId, new Set());
    colabsPorProjeto.get(a.projetoId)!.add(a.colaboradorId);
  }

  // ── Sinal de capacidade — total de CADA colaborador em TODOS os projetos
  // no mês (mesma conta de saldo do grid/candidatos), em lote (1 query) ────
  const todosColabIds = [...new Set(alocsDoMes.map(a => a.colaboradorId))];
  const totalPorColab = new Map<string, Prisma.Decimal>();
  if (todosColabIds.length > 0) {
    const todasAlocsDosColabs = await prisma.alocacao.findMany({
      where: { colaboradorId: { in: todosColabIds }, ano: anoN, mes: mesN },
      select: { colaboradorId: true, horasPlanejadas: true },
    });
    for (const a of todasAlocsDosColabs) {
      totalPorColab.set(a.colaboradorId, (totalPorColab.get(a.colaboradorId) ?? D0).plus(a.horasPlanejadas));
    }
  }

  const limiarCapacidade = TETO_HORAS_MES.times(CAPACIDADE_ALERTA_PCT);
  const capacidadePorProjeto = new Map<string, boolean>();
  for (const [projetoId, colabs] of colabsPorProjeto) {
    let sinal = false;
    for (const colabId of colabs) {
      const total = totalPorColab.get(colabId) ?? D0;
      if (total.greaterThanOrEqualTo(limiarCapacidade)) { sinal = true; break; }
    }
    capacidadePorProjeto.set(projetoId, sinal);
  }

  // ── Categoria + "porquê" por projeto, a partir da próxima prestação ─────
  const hojeUTC = (() => { const h = new Date(); h.setUTCHours(0, 0, 0, 0); return h.getTime(); })();

  const resultado = projetos.map(proj => {
    const proxima = computeProxima(proj.prestacoesContas);

    let categoria: CategoriaPrazo;
    let diasAteVencimento: number | null = null;
    let porque: string;

    if (!proxima) {
      categoria = 'sem_prazo';
      porque = 'Sem prestação de contas cadastrada';
    } else {
      const dias = diasEntre(proxima.data, hojeUTC);
      diasAteVencimento = dias;

      if (proxima.vencida) {
        categoria = 'alta';
        const diasAtraso = Math.abs(dias);
        porque = `Prestação vencida há ${diasAtraso} dia${diasAtraso !== 1 ? 's' : ''}`;
      } else if (dias <= PRAZO_ALTA_DIAS) {
        categoria = 'alta';
        porque = dias === 0 ? 'Prestação vence hoje' : `Prestação vence em ${dias} dia${dias !== 1 ? 's' : ''}`;
      } else if (dias <= PRAZO_MEDIA_DIAS) {
        categoria = 'media';
        porque = `Prestação vence em ${dias} dias`;
      } else {
        categoria = 'baixa';
        porque = `Prestação vence em ${dias} dias`;
      }
    }

    const horasPendentes = pendentePorProjeto.get(proj.id) ?? D0;

    return {
      projetoId:         proj.id,
      codigo:            proj.codigo,
      nome:              proj.nome,
      categoria,
      proximaPrestacao:  proxima ? proxima.data : null,
      diasAteVencimento,
      horasPendentes:    horasPendentes.toString(),
      porque,
      sinalCapacidade:   capacidadePorProjeto.get(proj.id) ?? false,
    };
  });

  // ── Ordem final: categoria (alta < media < baixa < sem_prazo), depois
  // horas pendentes desc dentro da categoria ──────────────────────────────
  resultado.sort((a, b) => {
    const catDiff = ORDEM_CATEGORIA[a.categoria] - ORDEM_CATEGORIA[b.categoria];
    if (catDiff !== 0) return catDiff;
    return parseFloat(b.horasPendentes) - parseFloat(a.horasPendentes);
  });

  const itens: PriorizacaoItem[] = resultado.map((r, i) => ({ ...r, ordem: i + 1 }));

  return { itens, categoriaIdPorProjeto, colabsPorProjeto, alocsDoMes };
}

// ── GET / — projetos priorizados por categoria de prazo + horas pendentes ──
// SÓ LEITURA. Não toca alocação, teto, lock. Sem fixar/pausar nem config
// (fases futuras) — os limiares acima são as únicas regras desta fase.
router.get('/', authenticate, requireRole('admin', 'gestor', 'chefe', 'coordenacao', 'diretor'), async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const role   = req.user!.role;
    const { ano, mes } = req.query as { ano?: string; mes?: string };

    const anoN = parseInt(ano ?? String(new Date().getFullYear()));
    const mesN = parseInt(mes ?? String(new Date().getMonth() + 1));
    if (!anoN || anoN < 2020 || anoN > 2100) return res.status(400).json({ error: 'ano inválido' });
    if (!mesN || mesN < 1  || mesN > 12)     return res.status(400).json({ error: 'mes inválido' });

    const { itens } = await calcularPriorizacao({ role, userId, ano: anoN, mes: mesN });
    res.json(itens);
  } catch (error) {
    console.error('Priorizacao error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
