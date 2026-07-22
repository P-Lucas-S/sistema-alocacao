import express from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prisma.js';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.js';
import { precheckExclusao, executarExclusaoCascata, ExclusaoBloqueadaError } from '../lib/exclusaoProjeto.js';
import { mesEstaFechado } from './alocacoes.js';
import { gerarMeses, computarMetaApropriacao } from '../lib/metaApropriacaoCalc.js';

const router = express.Router();
const generateId = () => Math.random().toString(36).substring(2, 15);

// ── Helpers ────────────────────────────────────────────────────────────────

// Compara datas à meia-noite UTC para não sofrer efeito de fuso
// Exportada pra ser reusada por outras rotas que também precisam da "próxima
// prestação" (ex.: priorizacao.ts) — não reimplementar a mesma semântica.
export function computeProxima(prestacoes: { id: string; data: Date }[]) {
  if (prestacoes.length === 0) return null;

  const hoje = new Date();
  hoje.setUTCHours(0, 0, 0, 0); // meia-noite UTC de hoje

  const upcoming = prestacoes
    .filter(p => p.data.getTime() >= hoje.getTime())
    .sort((a, b) => a.data.getTime() - b.data.getTime());

  if (upcoming.length > 0) {
    return { data: upcoming[0].data.toISOString(), vencida: false };
  }

  // Todas vencidas — retorna a mais recente como referência
  const sorted = [...prestacoes].sort((a, b) => b.data.getTime() - a.data.getTime());
  return { data: sorted[0].data.toISOString(), vencida: true };
}

function serializeProjeto(p: any) {
  const prestacoes = (p.prestacoesContas ?? []).map((pc: any) => ({
    id: pc.id,
    data: pc.data instanceof Date ? pc.data.toISOString() : pc.data,
  }));

  return {
    id: p.id,
    codigo: p.codigo,
    nome: p.nome,
    gestorId: p.gestorId,
    criadoPorId: p.criadoPorId,
    status: p.status,
    exclusaoSolicitadaPorId: p.exclusaoSolicitadaPorId,
    motivoExclusao: p.motivoExclusao,
    statusAnteriorExclusao: p.statusAnteriorExclusao,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    gestor: p.gestor,
    criadoPor: p.criadoPor,
    categoria: p.categoria ? { id: p.categoria.id, nome: p.categoria.nome, ativo: p.categoria.ativo } : null,
    prestacoesContas: prestacoes,
    proximaPrestacao: computeProxima(
      (p.prestacoesContas ?? []).map((pc: any) => ({ id: pc.id, data: pc.data }))
    ),
    valorTotal: p.valorTotal != null ? p.valorTotal.toString() : null,
    valorOficial: p.valorOficial != null ? p.valorOficial.toString() : null,
    estrategiaOficial: p.estrategiaOficial,
    vigenciaInicio: p.vigenciaInicio instanceof Date ? p.vigenciaInicio.toISOString() : (p.vigenciaInicio ?? null),
    vigenciaFim: p.vigenciaFim instanceof Date ? p.vigenciaFim.toISOString() : (p.vigenciaFim ?? null),
  };
}

function sortProjetos(projetos: ReturnType<typeof serializeProjeto>[]) {
  return projetos.sort((a, b) => {
    const aV = a.proximaPrestacao?.vencida ?? true;
    const bV = b.proximaPrestacao?.vencida ?? true;
    // Upcoming primeiro; dentro de cada grupo, por data crescente
    if (!aV && bV) return -1;
    if (aV && !bV) return 1;
    const da = a.proximaPrestacao?.data;
    const db = b.proximaPrestacao?.data;
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return new Date(da).getTime() - new Date(db).getTime();
  });
}

function parseDatas(raw: unknown): Date[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.map((d: string) => new Date(d));
}

function parseDecimal(v: unknown): number | null | 'invalid' {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return isNaN(n) || n < 0 ? 'invalid' : n;
}

function parseISODate(v: unknown): Date | null | 'invalid' {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? 'invalid' : d;
}

type FinanceiroData = {
  valorTotal: number | null;
  valorOficial: number | null;
  estrategiaOficial: string;
  vigenciaInicio: Date | null;
  vigenciaFim: Date | null;
};

function parseFinanceiros(body: any): { error: string } | { data: FinanceiroData } {
  const vt = parseDecimal(body.valorTotal);
  if (vt === 'invalid') return { error: 'valorTotal deve ser um número >= 0' };

  const vo = parseDecimal(body.valorOficial);
  if (vo === 'invalid') return { error: 'valorOficial deve ser um número >= 0' };

  if (vt !== null && vo !== null && vo > vt) {
    return { error: 'valorOficial não pode ser maior que valorTotal' };
  }

  let est = 'inicial';
  if (body.estrategiaOficial != null && body.estrategiaOficial !== '') {
    if (!['inicial', 'proporcional'].includes(body.estrategiaOficial as string)) {
      return { error: 'estrategiaOficial deve ser "inicial" ou "proporcional"' };
    }
    est = body.estrategiaOficial as string;
  }

  const vi = parseISODate(body.vigenciaInicio);
  if (vi === 'invalid') return { error: 'vigenciaInicio inválida' };

  const vf = parseISODate(body.vigenciaFim);
  if (vf === 'invalid') return { error: 'vigenciaFim inválida' };

  if (vi !== null && vf !== null && vf < vi) {
    return { error: 'vigenciaFim deve ser >= vigenciaInicio' };
  }

  return { data: { valorTotal: vt, valorOficial: vo, estrategiaOficial: est, vigenciaInicio: vi, vigenciaFim: vf } };
}

// ── PUT /:id/meta-apropriacao/pino — cria/atualiza pino de meta (F2b-i) ───
// Escopo: gestor dono/chefe/admin. Mês deve estar dentro da vigência e aberto.
router.put('/:id/meta-apropriacao/pino', authenticate, requireRole('admin', 'gestor', 'chefe'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const role   = req.user!.role;

    const projeto = await prisma.projeto.findUnique({
      where: { id },
      select: { gestorId: true, vigenciaInicio: true, vigenciaFim: true },
    });
    if (!projeto) return res.status(404).json({ error: 'Projeto não encontrado' });
    if (role === 'gestor' && projeto.gestorId !== userId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const { ano, mes, metaHT: metaHTBody } = req.body;
    const anoN = Number.isInteger(ano) ? ano : parseInt(ano);
    const mesN = Number.isInteger(mes) ? mes : parseInt(mes);
    if (!Number.isInteger(anoN) || anoN < 2020 || anoN > 2100) {
      return res.status(400).json({ error: 'ano inválido' });
    }
    if (!Number.isInteger(mesN) || mesN < 1 || mesN > 12) {
      return res.status(400).json({ error: 'mes deve ser 1–12' });
    }

    const metaHTN = Number(metaHTBody);
    if (isNaN(metaHTN) || metaHTN < 0) {
      return res.status(400).json({ error: 'metaHT deve ser um número >= 0' });
    }

    if (!projeto.vigenciaInicio || !projeto.vigenciaFim) {
      return res.status(400).json({ error: 'Projeto sem vigência definida — configure a vigência antes de pinar' });
    }
    const mesesVigencia = gerarMeses(projeto.vigenciaInicio, projeto.vigenciaFim);
    if (!mesesVigencia.some(m => m.ano === anoN && m.mes === mesN)) {
      return res.status(400).json({ error: `Mês ${mesN}/${anoN} fora da vigência do projeto` });
    }

    if (await mesEstaFechado(anoN, mesN)) {
      return res.status(409).json({ error: 'Mês fechado — não é possível pinar meta em mês com fechamento registrado' });
    }

    const pino = await prisma.metaMensalAjuste.upsert({
      where:  { projetoId_ano_mes: { projetoId: id, ano: anoN, mes: mesN } },
      update: { metaHT: metaHTN },
      create: { projetoId: id, ano: anoN, mes: mesN, metaHT: metaHTN },
    });

    res.json({ projetoId: pino.projetoId, ano: pino.ano, mes: pino.mes, metaHT: pino.metaHT.toFixed(2) });
  } catch (error) {
    console.error('Pino meta upsert error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /:id/meta-apropriacao/pino/:ano/:mes — remove pino (F2b-i) ──────
// Sem pino → 404. Com pino → 200 + {removed:true}.
router.delete('/:id/meta-apropriacao/pino/:ano/:mes', authenticate, requireRole('admin', 'gestor', 'chefe'), async (req: AuthRequest, res) => {
  try {
    const { id, ano: anoStr, mes: mesStr } = req.params;
    const userId = req.user!.id;
    const role   = req.user!.role;

    const projeto = await prisma.projeto.findUnique({ where: { id }, select: { gestorId: true } });
    if (!projeto) return res.status(404).json({ error: 'Projeto não encontrado' });
    if (role === 'gestor' && projeto.gestorId !== userId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const anoN = parseInt(anoStr);
    const mesN = parseInt(mesStr);
    if (isNaN(anoN) || isNaN(mesN)) {
      return res.status(400).json({ error: 'ano/mes inválidos na URL' });
    }

    const deleted = await prisma.metaMensalAjuste.deleteMany({
      where: { projetoId: id, ano: anoN, mes: mesN },
    });
    if (deleted.count === 0) {
      return res.status(404).json({ error: 'Pino não encontrado para esse mês' });
    }

    res.json({ removed: true, ano: anoN, mes: mesN });
  } catch (error) {
    console.error('Delete pino error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /:id/meta-apropriacao/pino-medicao — cria/atualiza pino de medição ──
// Análogo ao pino de meta. Mês deve estar dentro da vigência e aberto.
router.put('/:id/meta-apropriacao/pino-medicao', authenticate, requireRole('admin', 'gestor', 'chefe'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const role   = req.user!.role;

    const projeto = await prisma.projeto.findUnique({
      where: { id },
      select: { gestorId: true, vigenciaInicio: true, vigenciaFim: true },
    });
    if (!projeto) return res.status(404).json({ error: 'Projeto não encontrado' });
    if (role === 'gestor' && projeto.gestorId !== userId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const { ano, mes, medicao: medicaoBody } = req.body;
    const anoN = Number.isInteger(ano) ? ano : parseInt(ano);
    const mesN = Number.isInteger(mes) ? mes : parseInt(mes);
    if (!Number.isInteger(anoN) || anoN < 2020 || anoN > 2100) {
      return res.status(400).json({ error: 'ano inválido' });
    }
    if (!Number.isInteger(mesN) || mesN < 1 || mesN > 12) {
      return res.status(400).json({ error: 'mes inválido' });
    }
    const medicaoN = typeof medicaoBody === 'number' ? medicaoBody : parseFloat(medicaoBody);
    if (isNaN(medicaoN) || medicaoN < 0) {
      return res.status(400).json({ error: 'medicao deve ser um número >= 0' });
    }

    if (!projeto.vigenciaInicio || !projeto.vigenciaFim) {
      return res.status(400).json({ error: 'Projeto sem vigência definida — configure a vigência antes de pinar' });
    }
    const mesesVigencia = gerarMeses(projeto.vigenciaInicio, projeto.vigenciaFim);
    if (!mesesVigencia.some(m => m.ano === anoN && m.mes === mesN)) {
      return res.status(400).json({ error: `Mês ${mesN}/${anoN} fora da vigência do projeto` });
    }

    if (await mesEstaFechado(anoN, mesN)) {
      return res.status(409).json({ error: 'Mês fechado — não é possível pinar medição em mês com fechamento registrado' });
    }

    const pino = await prisma.medicaoMensalAjuste.upsert({
      where:  { projetoId_ano_mes: { projetoId: id, ano: anoN, mes: mesN } },
      update: { medicao: medicaoN },
      create: { projetoId: id, ano: anoN, mes: mesN, medicao: medicaoN },
    });

    return res.json(pino);
  } catch (error) {
    console.error('Pino medição upsert error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /:id/meta-apropriacao/pino-medicao/:ano/:mes — remove pino de medição
router.delete('/:id/meta-apropriacao/pino-medicao/:ano/:mes', authenticate, requireRole('admin', 'gestor', 'chefe'), async (req: AuthRequest, res) => {
  try {
    const { id, ano: anoStr, mes: mesStr } = req.params;
    const userId = req.user!.id;
    const role   = req.user!.role;

    const projeto = await prisma.projeto.findUnique({ where: { id }, select: { gestorId: true } });
    if (!projeto) return res.status(404).json({ error: 'Projeto não encontrado' });
    if (role === 'gestor' && projeto.gestorId !== userId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const anoN = parseInt(anoStr);
    const mesN = parseInt(mesStr);
    if (isNaN(anoN) || isNaN(mesN)) {
      return res.status(400).json({ error: 'ano/mes inválidos na URL' });
    }

    const deleted = await prisma.medicaoMensalAjuste.deleteMany({
      where: { projetoId: id, ano: anoN, mes: mesN },
    });
    if (deleted.count === 0) {
      return res.status(404).json({ error: 'Pino de medição não encontrado para esse mês' });
    }

    return res.json({ removed: true, ano: anoN, mes: mesN });
  } catch (error) {
    console.error('Delete pino medição error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /:id/meta-apropriacao/pino-oficial — cria/atualiza pino de oficial ──
// Análogo aos pinos de meta e medição. Mês deve estar dentro da vigência e
// aberto. Nome distinto (pino-oficial) para não colidir com /pino nem /pino-medicao.
// Os três pinos (meta, medição, oficial) coexistem no mesmo mês.
router.put('/:id/meta-apropriacao/pino-oficial', authenticate, requireRole('admin', 'gestor', 'chefe'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const role   = req.user!.role;

    const projeto = await prisma.projeto.findUnique({
      where: { id },
      select: { gestorId: true, vigenciaInicio: true, vigenciaFim: true },
    });
    if (!projeto) return res.status(404).json({ error: 'Projeto não encontrado' });
    if (role === 'gestor' && projeto.gestorId !== userId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const { ano, mes, valorOficial: valorOficialBody } = req.body;
    const anoN = Number.isInteger(ano) ? ano : parseInt(ano);
    const mesN = Number.isInteger(mes) ? mes : parseInt(mes);
    if (!Number.isInteger(anoN) || anoN < 2020 || anoN > 2100) {
      return res.status(400).json({ error: 'ano inválido' });
    }
    if (!Number.isInteger(mesN) || mesN < 1 || mesN > 12) {
      return res.status(400).json({ error: 'mes inválido' });
    }
    const valorOficialN = typeof valorOficialBody === 'number' ? valorOficialBody : parseFloat(valorOficialBody);
    if (isNaN(valorOficialN) || valorOficialN < 0) {
      return res.status(400).json({ error: 'valorOficial deve ser um número >= 0' });
    }

    if (!projeto.vigenciaInicio || !projeto.vigenciaFim) {
      return res.status(400).json({ error: 'Projeto sem vigência definida — configure a vigência antes de pinar' });
    }
    const mesesVigencia = gerarMeses(projeto.vigenciaInicio, projeto.vigenciaFim);
    if (!mesesVigencia.some(m => m.ano === anoN && m.mes === mesN)) {
      return res.status(400).json({ error: `Mês ${mesN}/${anoN} fora da vigência do projeto` });
    }

    if (await mesEstaFechado(anoN, mesN)) {
      return res.status(409).json({ error: 'Mês fechado — não é possível pinar oficial em mês com fechamento registrado' });
    }

    const pino = await prisma.oficialMensalAjuste.upsert({
      where:  { projetoId_ano_mes: { projetoId: id, ano: anoN, mes: mesN } },
      update: { valorOficial: valorOficialN },
      create: { projetoId: id, ano: anoN, mes: mesN, valorOficial: valorOficialN },
    });

    return res.json({ projetoId: pino.projetoId, ano: pino.ano, mes: pino.mes, valorOficial: pino.valorOficial.toFixed(2) });
  } catch (error) {
    console.error('Pino oficial upsert error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /:id/meta-apropriacao/pino-oficial/:ano/:mes — remove pino de oficial
router.delete('/:id/meta-apropriacao/pino-oficial/:ano/:mes', authenticate, requireRole('admin', 'gestor', 'chefe'), async (req: AuthRequest, res) => {
  try {
    const { id, ano: anoStr, mes: mesStr } = req.params;
    const userId = req.user!.id;
    const role   = req.user!.role;

    const projeto = await prisma.projeto.findUnique({ where: { id }, select: { gestorId: true } });
    if (!projeto) return res.status(404).json({ error: 'Projeto não encontrado' });
    if (role === 'gestor' && projeto.gestorId !== userId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const anoN = parseInt(anoStr);
    const mesN = parseInt(mesStr);
    if (isNaN(anoN) || isNaN(mesN)) {
      return res.status(400).json({ error: 'ano/mes inválidos na URL' });
    }

    const deleted = await prisma.oficialMensalAjuste.deleteMany({
      where: { projetoId: id, ano: anoN, mes: mesN },
    });
    if (deleted.count === 0) {
      return res.status(404).json({ error: 'Pino de oficial não encontrado para esse mês' });
    }

    return res.json({ removed: true, ano: anoN, mes: mesN });
  } catch (error) {
    console.error('Delete pino oficial error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /:id/meta-apropriacao — Meta Mensal de Apropriação (F2a) ──────────
// READ-ONLY. Computa sob demanda a meta de HT por mês da vigência + receita
// já planejada, reusando carregarTarifas/resolverTarifa de lib/tarifa.ts
// (mesma conta do dashboard D1). Escopo: igual ao GET /:id — gestor só vê o
// próprio projeto; admin/chefe/coordenacao veem qualquer um. Diretor NÃO
// acessa (nomes de projeto + meta financeira — vê tudo agregado nos dashboards).
router.get('/:id/meta-apropriacao', authenticate, requireRole('admin', 'gestor', 'chefe', 'coordenacao'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const role   = req.user!.role;

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

    const calc = await computarMetaApropriacao(id, projeto);
    if (!calc) return res.json({ configurado: false });

    const {
      valorTotal, valorOficial, valorHT, numMeses,
      estrategiaOficial: estrategia,
      mesCalcs, somaMetaHT, totalCortadoPeloPiso,
      temPinos, avisoEstouroMedicao, avisoEstouroOficial,
      saldoNaoPlanejado, precisaDecisaoManual,
    } = calc;

    // Cascata pendente cobre APENAS problemas de distribuição da meta —
    // não inclui !somaMetaHT.equals(valorHT) que seria falso positivo quando
    // o piso max(0) corta legitimamente (reportado via totalCortadoPeloPiso).
    const cascataPendente = temPinos && (
      saldoNaoPlanejado !== null ||
      precisaDecisaoManual !== null
    );

    return res.json({
      configurado: true,
      resumo: {
        valorTotal:           valorTotal.toFixed(2),
        valorOficial:         valorOficial.toFixed(2),
        valorHT:              valorHT.toFixed(2),
        somaMetaHT:           somaMetaHT.toFixed(2),
        totalCortadoPeloPiso: totalCortadoPeloPiso.toFixed(2),
        cascataPendente,
        numeroMeses:          numMeses,
        estrategiaOficial:    estrategia,
        ...(avisoEstouroMedicao !== null ? { avisoEstouroMedicao }                               : {}),
        ...(avisoEstouroOficial !== null ? { avisoEstouroOficial }                               : {}),
        ...(saldoNaoPlanejado   !== null ? { saldoNaoPlanejado: saldoNaoPlanejado.toFixed(2) }  : {}),
        ...(precisaDecisaoManual !== null ? { precisaDecisaoManual }                             : {}),
      },
      meses: mesCalcs.map(({ ano, mes, medicao, pinadaMedicao, oficialAlocado, pinadoOficial, ajustadoOficial, metaHT, pinado, fechado, receitaPlanejada, deficit, avisoPiso }) => ({
        ano, mes,
        medicao:          medicao.toFixed(2),
        pinadaMedicao,
        oficialAlocado:   oficialAlocado.toFixed(2),
        pinadoOficial,
        ajustadoOficial,
        metaHT:           metaHT.toFixed(2),
        pinado,
        fechado,
        receitaPlanejada: receitaPlanejada.toFixed(2),
        deficit:          deficit.toFixed(2),
        ...(avisoPiso !== null ? { avisoPiso } : {}),
      })),
    });
  } catch (error) {
    console.error('Meta apropriacao error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /:id — detalhe de um projeto ──────────────────────────────────────
router.get('/:id', authenticate, requireRole('admin', 'gestor', 'chefe', 'coordenacao'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const role   = req.user!.role;

    const projeto = await prisma.projeto.findUnique({
      where: { id },
      include: {
        gestor: { select: { id: true, name: true } },
        criadoPor: { select: { id: true, name: true } },
        categoria: { select: { id: true, nome: true, ativo: true } },
        prestacoesContas: { orderBy: { data: 'asc' } },
      },
    });
    if (!projeto) return res.status(404).json({ error: 'Projeto não encontrado' });
    if (role === 'gestor' && projeto.gestorId !== userId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    res.json(serializeProjeto(projeto));
  } catch (error) {
    console.error('Get projeto error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET / ─────────────────────────────────────────────────────────────────
router.get('/', authenticate, requireRole('admin', 'gestor', 'chefe', 'coordenacao'), async (req: AuthRequest, res) => {
  try {
    const { status, gestorId: gestorIdParam } = req.query as { status?: string; gestorId?: string };
    const userId = req.user!.id;
    const role   = req.user!.role;

    let gestorIdFiltro: string | undefined;
    if (role !== 'gestor' && gestorIdParam) {
      const gestorAlvo = await prisma.user.findUnique({ where: { id: gestorIdParam }, select: { role: true } });
      if (!gestorAlvo || gestorAlvo.role !== 'gestor') {
        return res.status(400).json({ error: 'gestorId inválido ou não pertence a um usuário com papel gestor' });
      }
      gestorIdFiltro = gestorIdParam;
    }

    const where: any = {};
    if (role === 'gestor') where.gestorId = userId;
    else if (gestorIdFiltro) where.gestorId = gestorIdFiltro;
    if (status === 'arquivado')    where.status = 'arquivado';
    else if (status === 'todos') { /* sem filtro */ }
    else                           where.status = 'ativo';

    const rows = await prisma.projeto.findMany({
      where,
      include: {
        gestor: { select: { id: true, name: true } },
        criadoPor: { select: { id: true, name: true } },
        categoria: { select: { id: true, nome: true, ativo: true } },
        prestacoesContas: { orderBy: { data: 'asc' } },
      },
    });

    res.json(sortProjetos(rows.map(serializeProjeto)));
  } catch (error) {
    console.error('List projetos error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST / ────────────────────────────────────────────────────────────────
// Posse vs. autoria (Spec_Papeis_Posse_Exclusao):
//   criadoPorId = sempre quem está criando (req.user.id).
//   gestorId    = quem opera/vê no grid:
//     - gestor: sempre o próprio (ignora qualquer gestorId do corpo — não delega).
//     - admin/chefe: pode delegar via body.gestorId (precisa ser um usuário com
//       role 'gestor'); se omitido, mantém pra si (gestorId = req.user.id).
router.post('/', authenticate, requireRole('admin', 'gestor', 'chefe'), async (req: AuthRequest, res) => {
  try {
    const { codigo, nome, prestacoesContas, categoriaId, gestorId: gestorIdBody } = req.body;
    const userId = req.user!.id;
    const role   = req.user!.role;
    const criadoPorId = userId;

    if (!codigo?.trim()) return res.status(400).json({ error: 'codigo é obrigatório' });
    if (!nome?.trim())   return res.status(400).json({ error: 'nome é obrigatório' });

    const finResult = parseFinanceiros(req.body);
    if ('error' in finResult) return res.status(400).json({ error: finResult.error });
    const fin = finResult.data;

    const datas = parseDatas(prestacoesContas);
    if (!datas) {
      return res.status(400).json({ error: 'Pelo menos uma data de prestação de contas é obrigatória' });
    }

    if (!categoriaId) return res.status(400).json({ error: 'Programa é obrigatório' });
    const categoria = await prisma.categoriaProjeto.findUnique({ where: { id: categoriaId } });
    if (!categoria)        return res.status(400).json({ error: 'Programa não encontrado' });
    if (!categoria.ativo)  return res.status(400).json({ error: 'Programa inativo' });

    // Resolve o gestorId conforme o papel de quem cria.
    let gestorId: string;
    if (role === 'gestor') {
      gestorId = userId;
    } else if (gestorIdBody) {
      const gestorAlvo = await prisma.user.findUnique({ where: { id: gestorIdBody } });
      if (!gestorAlvo || gestorAlvo.role !== 'gestor') {
        return res.status(400).json({ error: 'gestorId informado deve ser de um usuário com papel "gestor".' });
      }
      gestorId = gestorIdBody;
    } else {
      gestorId = userId;
    }

    const codigoNorm = codigo.trim().toUpperCase();
    const conflict = await prisma.projeto.findUnique({ where: { codigo: codigoNorm } });
    if (conflict) {
      return res.status(409).json({ error: `Código "${codigoNorm}" já está em uso. Escolha um código diferente.` });
    }

    const projetoId = generateId();

    const macroGeralId = generateId();

    const projeto = await prisma.$transaction(async (tx) => {
      await tx.projeto.create({
        data: {
          id: projetoId, codigo: codigoNorm, nome: nome.trim(), gestorId, criadoPorId, categoriaId, status: 'ativo',
          valorTotal: fin.valorTotal, valorOficial: fin.valorOficial, estrategiaOficial: fin.estrategiaOficial,
          vigenciaInicio: fin.vigenciaInicio, vigenciaFim: fin.vigenciaFim,
        },
      });
      await tx.prestacaoContas.createMany({
        data: datas.map(d => ({ id: generateId(), projetoId, data: d })),
      });
      // Macro "Geral" automática — mesmo padrão do POST /macros (macro + micro na mesma tx)
      await tx.macroEntrega.create({
        data: { id: macroGeralId, projetoId, nome: 'Geral', descricao: null, status: 'ativa' },
      });
      await tx.microEntrega.create({
        data: { id: generateId(), macroEntregaId: macroGeralId, nome: 'Geral', status: 'pendente' },
      });
      return tx.projeto.findUniqueOrThrow({
        where: { id: projetoId },
        include: {
          gestor: { select: { id: true, name: true } },
          criadoPor: { select: { id: true, name: true } },
          categoria: { select: { id: true, nome: true, ativo: true } },
          prestacoesContas: { orderBy: { data: 'asc' } },
        },
      });
    });

    res.status(201).json(serializeProjeto(projeto));
  } catch (error) {
    console.error('Create projeto error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /:id ───────────────────────────────────────────────────────────────
// Sincronização de datas: substitui o conjunto completo se prestacoesContas for fornecido.
// Sem prestacoesContas no body → datas não mudam.
router.put('/:id', authenticate, requireRole('admin', 'gestor', 'chefe'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { nome, prestacoesContas, categoriaId } = req.body;
    const userId = req.user!.id;
    const role   = req.user!.role;

    const projeto = await prisma.projeto.findUnique({ where: { id } });
    if (!projeto) return res.status(404).json({ error: 'Projeto não encontrado' });

    if (role === 'gestor' && projeto.gestorId !== userId) {
      return res.status(403).json({ error: 'Você só pode editar os seus próprios projetos' });
    }

    // Se datas foram enviadas, valida pelo menos 1
    let datas: Date[] | null = null;
    if (prestacoesContas !== undefined) {
      datas = parseDatas(prestacoesContas);
      if (!datas) {
        return res.status(400).json({ error: 'Pelo menos uma data de prestação de contas é obrigatória' });
      }
    }

    // Se categoriaId foi enviado, não pode ficar sem programa
    if (categoriaId !== undefined) {
      if (!categoriaId) return res.status(400).json({ error: 'Programa é obrigatório' });
      const categoria = await prisma.categoriaProjeto.findUnique({ where: { id: categoriaId } });
      if (!categoria)        return res.status(400).json({ error: 'Programa não encontrado' });
      if (!categoria.ativo)  return res.status(400).json({ error: 'Programa inativo' });
    }

    // Campos financeiros: só processa se ao menos um veio no body
    const hasFinanceiros = ['valorTotal', 'valorOficial', 'estrategiaOficial', 'vigenciaInicio', 'vigenciaFim']
      .some(k => k in req.body);
    let finData: FinanceiroData | null = null;
    if (hasFinanceiros) {
      const finResult = parseFinanceiros(req.body);
      if ('error' in finResult) return res.status(400).json({ error: finResult.error });
      finData = finResult.data;
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.projeto.update({
        where: { id },
        data: {
          ...(nome?.trim() ? { nome: nome.trim() } : {}),
          ...(categoriaId !== undefined ? { categoriaId } : {}),
          ...(finData ? {
            valorTotal: finData.valorTotal, valorOficial: finData.valorOficial,
            estrategiaOficial: finData.estrategiaOficial,
            vigenciaInicio: finData.vigenciaInicio, vigenciaFim: finData.vigenciaFim,
          } : {}),
        },
      });

      if (datas) {
        await tx.prestacaoContas.deleteMany({ where: { projetoId: id } });
        await tx.prestacaoContas.createMany({
          data: datas.map(d => ({ id: generateId(), projetoId: id, data: d })),
        });
      }

      return tx.projeto.findUniqueOrThrow({
        where: { id },
        include: {
          gestor: { select: { id: true, name: true } },
          criadoPor: { select: { id: true, name: true } },
          categoria: { select: { id: true, nome: true, ativo: true } },
          prestacoesContas: { orderBy: { data: 'asc' } },
        },
      });
    });

    res.json(serializeProjeto(updated));
  } catch (error) {
    console.error('Update projeto error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /:id/status ─────────────────────────────────────────────────────
router.patch('/:id/status', authenticate, requireRole('admin', 'gestor', 'chefe'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user!.id;
    const role   = req.user!.role;

    if (!['ativo', 'arquivado'].includes(status)) {
      return res.status(400).json({ error: 'status deve ser: ativo | arquivado' });
    }

    const projeto = await prisma.projeto.findUnique({ where: { id } });
    if (!projeto) return res.status(404).json({ error: 'Projeto não encontrado' });

    if (role === 'gestor' && projeto.gestorId !== userId) {
      return res.status(403).json({ error: 'Você só pode alterar os seus próprios projetos' });
    }

    const updated = await prisma.projeto.update({
      where: { id },
      data: { status },
      select: { id: true, codigo: true, nome: true, status: true },
    });

    res.json(updated);
  } catch (error) {
    console.error('Update projeto status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /:id/redelegar — chefe troca o gestor operacional do projeto ─────
// Spec_Papeis_Posse_Exclusao: SÓ chefe (nunca admin) pode re-delegar. Só troca
// o gestorId + grava auditoria em `redelegacoes` — alocações, macros/micros e
// o histórico (alocacao_logs) não são tocados; nada se move, só o dono muda.
router.patch('/:id/redelegar', authenticate, requireRole('chefe'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { gestorId: gestorIdBody } = req.body;
    const userId = req.user!.id;

    const projeto = await prisma.projeto.findUnique({ where: { id } });
    if (!projeto) return res.status(404).json({ error: 'Projeto não encontrado' });

    if (projeto.status !== 'ativo') {
      return res.status(400).json({ error: 'Só é possível re-delegar projetos ativos.' });
    }

    if (!gestorIdBody) return res.status(400).json({ error: 'gestorId é obrigatório' });

    const gestorAlvo = await prisma.user.findUnique({ where: { id: gestorIdBody } });
    if (!gestorAlvo || gestorAlvo.role !== 'gestor') {
      return res.status(400).json({ error: 'gestorId informado deve ser de um usuário com papel "gestor".' });
    }

    if (gestorIdBody === projeto.gestorId) {
      return res.status(400).json({ error: 'O projeto já é desse gestor.' });
    }

    const gestorAnteriorId = projeto.gestorId;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.projeto.update({
        where: { id },
        data: { gestorId: gestorIdBody },
      });

      await tx.redelegacao.create({
        data: {
          id: generateId(),
          projetoId: id,
          gestorAnteriorId,
          gestorNovoId: gestorIdBody,
          redelegadoPorId: userId,
        },
      });

      return tx.projeto.findUniqueOrThrow({
        where: { id },
        include: {
          gestor: { select: { id: true, name: true } },
          criadoPor: { select: { id: true, name: true } },
          categoria: { select: { id: true, nome: true, ativo: true } },
          prestacoesContas: { orderBy: { data: 'asc' } },
        },
      });
    });

    res.json(serializeProjeto(updated));
  } catch (error) {
    console.error('Redelegar projeto error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /:id/solicitar-exclusao — SÓ o gestor dono pede ───────────────────
// Spec_Papeis_Posse_Exclusao: projeto arquivado pode ser solicitado (sem gate
// de "ativo"); só rejeita se já está pendente_exclusao. Não toca alocação.
router.post('/:id/solicitar-exclusao', authenticate, requireRole('gestor'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { motivo } = req.body;
    const userId = req.user!.id;

    const projeto = await prisma.projeto.findUnique({ where: { id } });
    if (!projeto) return res.status(404).json({ error: 'Projeto não encontrado' });

    if (projeto.gestorId !== userId) {
      return res.status(403).json({ error: 'Só o gestor dono do projeto pode solicitar a exclusão' });
    }

    if (projeto.status === 'pendente_exclusao') {
      return res.status(409).json({ error: 'Já há um pedido de exclusão em aberto para este projeto' });
    }

    const updated = await prisma.projeto.update({
      where: { id },
      data: {
        status: 'pendente_exclusao',
        exclusaoSolicitadaPorId: userId,
        motivoExclusao: motivo ?? null,
        statusAnteriorExclusao: projeto.status, // pra recusar poder restaurar (ex.: 'arquivado')
      },
      include: {
        gestor: { select: { id: true, name: true } },
        criadoPor: { select: { id: true, name: true } },
        categoria: { select: { id: true, nome: true, ativo: true } },
        prestacoesContas: { orderBy: { data: 'asc' } },
      },
    });

    res.json(serializeProjeto(updated));
  } catch (error) {
    console.error('Solicitar exclusão error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /:id/aprovar-exclusao — SÓ chefe ───────────────────────────────────
router.post('/:id/aprovar-exclusao', authenticate, requireRole('chefe'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const projeto = await prisma.projeto.findUnique({ where: { id } });
    if (!projeto) return res.status(404).json({ error: 'Projeto não encontrado' });

    if (projeto.status !== 'pendente_exclusao') {
      return res.status(409).json({ error: 'Não há pedido de exclusão para aprovar' });
    }

    const precheck = await precheckExclusao(id);
    if (!precheck.ok) {
      if (precheck.motivo === 'mes_fechado') {
        return res.status(409).json({
          error: 'Há alocação em mês fechado; reabra o mês antes de excluir',
          mesesFechados: precheck.mesesFechados,
        });
      }
      return res.status(404).json({ error: 'Projeto não encontrado' }); // corrida rara
    }

    try {
      const resultado = await executarExclusaoCascata(id, {
        solicitanteId: projeto.exclusaoSolicitadaPorId,
        aprovadorId:   userId,
        motivo:        projeto.motivoExclusao,
      });
      res.json(resultado);
    } catch (err) {
      if (err instanceof ExclusaoBloqueadaError) {
        return res.status(409).json({
          error: 'Há alocação em mês fechado; reabra o mês antes de excluir',
          mesesFechados: err.mesesFechados,
        });
      }
      throw err;
    }
  } catch (error) {
    console.error('Aprovar exclusão error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /:id/recusar-exclusao — SÓ chefe ───────────────────────────────────
// Restaura o status anterior ao pedido (statusAnteriorExclusao) — ex.: um
// projeto que era 'arquivado' antes de solicitar volta pra 'arquivado', não
// pra 'ativo'. O `?? 'ativo'` é rede de segurança defensiva.
router.post('/:id/recusar-exclusao', authenticate, requireRole('chefe'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const projeto = await prisma.projeto.findUnique({ where: { id } });
    if (!projeto) return res.status(404).json({ error: 'Projeto não encontrado' });

    if (projeto.status !== 'pendente_exclusao') {
      return res.status(409).json({ error: 'Não há pedido de exclusão para recusar' });
    }

    const updated = await prisma.projeto.update({
      where: { id },
      data: {
        status: projeto.statusAnteriorExclusao ?? 'ativo',
        exclusaoSolicitadaPorId: null,
        motivoExclusao: null,
        statusAnteriorExclusao: null,
      },
      include: {
        gestor: { select: { id: true, name: true } },
        criadoPor: { select: { id: true, name: true } },
        categoria: { select: { id: true, nome: true, ativo: true } },
        prestacoesContas: { orderBy: { data: 'asc' } },
      },
    });

    res.json(serializeProjeto(updated));
  } catch (error) {
    console.error('Recusar exclusão error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /:id/excluir-direto — SÓ chefe, sem exigir pedido prévio ────────
router.delete('/:id/excluir-direto', authenticate, requireRole('chefe'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { motivo: motivoBody } = req.body;
    const userId = req.user!.id;

    const projeto = await prisma.projeto.findUnique({ where: { id } });
    if (!projeto) return res.status(404).json({ error: 'Projeto não encontrado' });

    // Preserva quem pediu (se havia pedido em aberto); senão, exclusão direta sem solicitante.
    const solicitanteId = (projeto.status === 'pendente_exclusao' && projeto.exclusaoSolicitadaPorId)
      ? projeto.exclusaoSolicitadaPorId
      : null;
    // Motivo do corpo tem prioridade; senão preserva o do pedido em aberto; senão null.
    const motivo = motivoBody ?? projeto.motivoExclusao ?? null;

    const precheck = await precheckExclusao(id);
    if (!precheck.ok) {
      if (precheck.motivo === 'mes_fechado') {
        return res.status(409).json({
          error: 'Há alocação em mês fechado; reabra o mês antes de excluir',
          mesesFechados: precheck.mesesFechados,
        });
      }
      return res.status(404).json({ error: 'Projeto não encontrado' }); // corrida rara
    }

    try {
      const resultado = await executarExclusaoCascata(id, { solicitanteId, aprovadorId: userId, motivo });
      res.json(resultado);
    } catch (err) {
      if (err instanceof ExclusaoBloqueadaError) {
        return res.status(409).json({
          error: 'Há alocação em mês fechado; reabra o mês antes de excluir',
          mesesFechados: err.mesesFechados,
        });
      }
      throw err;
    }
  } catch (error) {
    console.error('Excluir direto error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
