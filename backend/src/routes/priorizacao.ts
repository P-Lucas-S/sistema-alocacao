import express from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prisma.js';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.js';
import { TETO_HORAS_MES } from './alocacoes.js';
import { computeProxima } from './projetos.js';

const router = express.Router();
const generateId = () => Math.random().toString(36).substring(2, 15);

// ID fixo do registro único de configuração (upsert sempre mira este id)
export const CONFIG_PRIORIZACAO_ID = 'config-priorizacao';

type CategoriaPrazo = 'alta' | 'media' | 'baixa' | 'sem_prazo';

// Ordem final da lista: categoria -> fixado antes de não-fixado -> horas pendentes desc.
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
  fixado:            boolean;
  pausado:           boolean;
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
  gestorIdFiltro?: string;
}

export interface CalcularPriorizacaoResult {
  itens:         PriorizacaoItem[];
  itensPausados: PriorizacaoItem[];  // projetos pausados, em seção separada
  // ── Dados crus reaproveitáveis por quem enriquece depois (ex.: o dashboard
  // de Projetos) — NÃO fazem parte do contrato de resposta do GET /priorizacao.
  categoriaIdPorProjeto:           Map<string, string | null>;
  colabsPorProjeto:                Map<string, Set<string>>;
  alocsDoMes:                      AlocMes[];
  colabsSobrecarregadosPorProjeto: Map<string, number>;
  gestorInfoPorProjeto:            Map<string, { gestorId: string; gestorNome: string }>;
  // ── Agregados de pessoas — union, não soma por projeto (evita double-count).
  // Zero query extra: derivados de todosColabIds + totalPorColab já computados.
  todosColabIds:     string[];
  totalPorColab:     Map<string, Prisma.Decimal>;
  realizadoPorColab: Map<string, Prisma.Decimal>;
  headcountAlocado:  number;   // count único de colabs com alocação no mês/escopo
  emSobrecarga:     number;   // count único de colabs com total >= limiarCapacidade
}

// Núcleo do P1 — extraído pra ser reusado (ex.: dashboard de Projetos) sem
// duplicar a lógica de categoria/ordenação/sinal de capacidade. O handler do
// GET / abaixo chama isso e responde só `itens` — contrato do P1 inalterado.
export async function calcularPriorizacao(params: CalcularPriorizacaoParams): Promise<CalcularPriorizacaoResult> {
  const { role, userId, ano: anoN, mes: mesN, gestorIdFiltro } = params;

  // ── Limiares — lidos da config (upsert garante que a linha sempre existe) ──
  const cfg = await prisma.configuracaoPriorizacao.upsert({
    where:  { id: CONFIG_PRIORIZACAO_ID },
    update: {},
    create: { id: CONFIG_PRIORIZACAO_ID, prazoAltaDias: 7, prazoMediaDias: 30, tetoCapacidadeSinalPct: 95 },
  });
  const PRAZO_ALTA_DIAS       = cfg.prazoAltaDias;
  const PRAZO_MEDIA_DIAS      = cfg.prazoMediaDias;
  const CAPACIDADE_ALERTA_PCT = cfg.tetoCapacidadeSinalPct / 100;

  // ── Escopo — MESMO critério do grid/candidatos (projWhere) ─────────────
  const projWhere = role === 'gestor'
    ? { gestorId: userId, status: 'ativo' }
    : gestorIdFiltro
      ? { gestorId: gestorIdFiltro, status: 'ativo' }
      : { status: 'ativo' };

  const projetos = await prisma.projeto.findMany({
    where: projWhere,
    orderBy: { codigo: 'asc' },
    select: {
      id: true, codigo: true, nome: true, categoriaId: true,
      gestorId: true,
      prioridadeFixada: true,
      prioridadePausada: true,
      gestor: { select: { name: true } },
      prestacoesContas: { select: { id: true, data: true } },
    },
  });

  const categoriaIdPorProjeto = new Map<string, string | null>();
  const gestorInfoPorProjeto  = new Map<string, { gestorId: string; gestorNome: string }>();
  for (const p of projetos) {
    categoriaIdPorProjeto.set(p.id, p.categoriaId);
    gestorInfoPorProjeto.set(p.id, { gestorId: p.gestorId, gestorNome: p.gestor.name });
  }

  if (projetos.length === 0) {
    return {
      itens: [], itensPausados: [], categoriaIdPorProjeto, colabsPorProjeto: new Map(),
      alocsDoMes: [], colabsSobrecarregadosPorProjeto: new Map(), gestorInfoPorProjeto,
      todosColabIds: [], totalPorColab: new Map(), realizadoPorColab: new Map(), headcountAlocado: 0, emSobrecarga: 0,
    };
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
  const totalPorColab     = new Map<string, Prisma.Decimal>();
  const realizadoPorColab = new Map<string, Prisma.Decimal>();
  if (todosColabIds.length > 0) {
    const todasAlocsDosColabs = await prisma.alocacao.findMany({
      where: { colaboradorId: { in: todosColabIds }, ano: anoN, mes: mesN },
      select: { colaboradorId: true, horasPlanejadas: true, horasRealizadas: true },
    });
    for (const a of todasAlocsDosColabs) {
      totalPorColab.set(a.colaboradorId, (totalPorColab.get(a.colaboradorId) ?? D0).plus(a.horasPlanejadas));
      if (a.horasRealizadas != null) {
        realizadoPorColab.set(a.colaboradorId, (realizadoPorColab.get(a.colaboradorId) ?? D0).plus(a.horasRealizadas));
      }
    }
  }

  const limiarCapacidade = TETO_HORAS_MES.times(CAPACIDADE_ALERTA_PCT);
  const colabsSobrecarregadosPorProjeto = new Map<string, number>();
  for (const [projetoId, colabs] of colabsPorProjeto) {
    let count = 0;
    for (const colabId of colabs) {
      const total = totalPorColab.get(colabId) ?? D0;
      if (total.greaterThanOrEqualTo(limiarCapacidade)) count++;
    }
    colabsSobrecarregadosPorProjeto.set(projetoId, count);
  }

  const headcountAlocado = todosColabIds.length;
  const emSobrecarga = todosColabIds.filter(id =>
    (totalPorColab.get(id) ?? D0).greaterThanOrEqualTo(limiarCapacidade)
  ).length;

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
      sinalCapacidade:   (colabsSobrecarregadosPorProjeto.get(proj.id) ?? 0) > 0,
      fixado:            proj.prioridadeFixada,
      pausado:           proj.prioridadePausada,
    };
  });

  // ── Separar pausados — saem da fila principal, não recebem categoria nas
  // contagens e são devolvidos em seção separada ao fim. ──────────────────
  const ativos   = resultado.filter(r => !r.pausado);
  const pausados = resultado.filter(r => r.pausado);

  // ── Ordenação da fila ativa:
  //    1. categoria (alta < media < baixa < sem_prazo) — soberana
  //    2. fixado antes de não-fixado DENTRO da mesma categoria
  //    3. horas pendentes desc (desempate final)
  // CORREÇÃO DA CLIENTE: fixar leva ao topo DA CATEGORIA, não da lista inteira.
  // Um projeto Média fixado aparece abaixo de todos os Altas.
  ativos.sort((a, b) => {
    const catDiff = ORDEM_CATEGORIA[a.categoria] - ORDEM_CATEGORIA[b.categoria];
    if (catDiff !== 0) return catDiff;
    if (a.fixado !== b.fixado) return a.fixado ? -1 : 1;
    return parseFloat(b.horasPendentes) - parseFloat(a.horasPendentes);
  });

  const itens: PriorizacaoItem[] = ativos.map((r, i) => ({ ...r, ordem: i + 1 }));

  const itensPausados: PriorizacaoItem[] = pausados.map((r, i) => ({
    ...r,
    ordem: itens.length + i + 1,
  }));

  return { itens, itensPausados, categoriaIdPorProjeto, colabsPorProjeto, alocsDoMes,
    colabsSobrecarregadosPorProjeto, gestorInfoPorProjeto,
    todosColabIds, totalPorColab, realizadoPorColab, headcountAlocado, emSobrecarga };
}

// ── GET / — projetos priorizados por categoria de prazo + horas pendentes ──
// SÓ LEITURA. Não toca alocação, teto, lock. Sem fixar/pausar nem config
// (fases futuras) — os limiares acima são as únicas regras desta fase.
router.get('/', authenticate, requireRole('admin', 'gestor', 'chefe', 'coordenacao', 'diretor'), async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const role   = req.user!.role;
    const { ano, mes, gestorId: gestorIdParam } = req.query as { ano?: string; mes?: string; gestorId?: string };

    const anoN = parseInt(ano ?? String(new Date().getFullYear()));
    const mesN = parseInt(mes ?? String(new Date().getMonth() + 1));
    if (!anoN || anoN < 2020 || anoN > 2100) return res.status(400).json({ error: 'ano inválido' });
    if (!mesN || mesN < 1  || mesN > 12)     return res.status(400).json({ error: 'mes inválido' });

    let gestorIdFiltro: string | undefined;
    if (role !== 'gestor' && gestorIdParam) {
      const gestorAlvo = await prisma.user.findUnique({ where: { id: gestorIdParam }, select: { role: true } });
      if (!gestorAlvo || gestorAlvo.role !== 'gestor') {
        return res.status(400).json({ error: 'gestorId inválido ou não pertence a um usuário com papel gestor' });
      }
      gestorIdFiltro = gestorIdParam;
    }

    const { itens, itensPausados } = await calcularPriorizacao({ role, userId, ano: anoN, mes: mesN, gestorIdFiltro });
    res.json({ itens, itensPausados, totalPausados: itensPausados.length });
  } catch (error) {
    console.error('Priorizacao error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /:projetoId/fixar — fixa prioridade (topo da categoria). Limpa pausar.
// ── PATCH /:projetoId/desfixar
// ── PATCH /:projetoId/pausar — pausa (sai da fila). Limpa fixar.
// ── PATCH /:projetoId/despausar
// Permissões: gestor só em projeto próprio; chefe/admin qualquer; coordenacao/diretor → 403 (via requireRole)
async function patchPrioridade(
  req: AuthRequest,
  res: express.Response,
  acao: 'fixar' | 'desfixar' | 'pausar' | 'despausar',
) {
  const { projetoId } = req.params;
  const userId = req.user!.id;
  const role   = req.user!.role;

  const projeto = await prisma.projeto.findUnique({
    where: { id: projetoId },
    select: { id: true, gestorId: true, status: true },
  });
  if (!projeto) return res.status(404).json({ error: 'Projeto não encontrado' });
  if (projeto.status !== 'ativo') return res.status(400).json({ error: 'Projeto não está ativo' });
  if (role === 'gestor' && projeto.gestorId !== userId) {
    return res.status(403).json({ error: 'Gestor só pode alterar prioridade de projetos próprios' });
  }

  const data =
    acao === 'fixar'     ? { prioridadeFixada: true,  prioridadePausada: false } :
    acao === 'desfixar'  ? { prioridadeFixada: false,  prioridadePausada: false } :
    acao === 'pausar'    ? { prioridadeFixada: false,  prioridadePausada: true  } :
  /* despausar */          { prioridadeFixada: false,  prioridadePausada: false };

  await prisma.$transaction([
    prisma.projeto.update({ where: { id: projetoId }, data }),
    prisma.prioridadeLog.create({
      data: { id: generateId(), projetoId, acao, usuarioId: userId },
    }),
  ]);

  return res.json({ ok: true, acao });
}

router.patch('/:projetoId/fixar',     authenticate, requireRole('admin', 'gestor', 'chefe'), (req: AuthRequest, res) => patchPrioridade(req, res, 'fixar'));
router.patch('/:projetoId/desfixar',  authenticate, requireRole('admin', 'gestor', 'chefe'), (req: AuthRequest, res) => patchPrioridade(req, res, 'desfixar'));
router.patch('/:projetoId/pausar',    authenticate, requireRole('admin', 'gestor', 'chefe'), (req: AuthRequest, res) => patchPrioridade(req, res, 'pausar'));
router.patch('/:projetoId/despausar', authenticate, requireRole('admin', 'gestor', 'chefe'), (req: AuthRequest, res) => patchPrioridade(req, res, 'despausar'));

export default router;
