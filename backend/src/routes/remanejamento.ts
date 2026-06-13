import express from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prisma.js';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.js';

const router = express.Router();
const generateId = () => Math.random().toString(36).substring(2, 15);

async function mesEstaFechado(ano: number, mes: number): Promise<boolean> {
  const f = await prisma.fechamentoMensal.findUnique({
    where: { ano_mes: { ano, mes } },
    select: { id: true },
  });
  return f !== null;
}

const solicitacaoInclude = {
  colaborador:    { select: { nome: true } },
  projetoDestino: { select: { codigo: true, nome: true } },
  solicitante:    { select: { name: true } },
} as const;

// Agrega cessões e adiciona horasJaCedidas/horasRestantes a cada solicitação
async function comCessoes<T extends { id: string; horasSolicitadas: Prisma.Decimal }>(
  items: T[],
): Promise<(T & { horasJaCedidas: string; horasRestantes: string })[]> {
  if (items.length === 0) return [];

  const cessoes = await prisma.cessaoRemanejamento.findMany({
    where:  { solicitacaoId: { in: items.map(i => i.id) } },
    select: { solicitacaoId: true, horasCedidas: true },
  });

  const mapa = new Map<string, Prisma.Decimal>();
  for (const c of cessoes) {
    mapa.set(c.solicitacaoId, (mapa.get(c.solicitacaoId) ?? new Prisma.Decimal(0)).plus(c.horasCedidas));
  }

  return items.map(s => {
    const cedido = mapa.get(s.id) ?? new Prisma.Decimal(0);
    return {
      ...s,
      horasJaCedidas:  cedido.toString(),
      horasRestantes:  new Prisma.Decimal(s.horasSolicitadas).minus(cedido).toString(),
    };
  });
}

// ── POST /solicitacoes — criar solicitação de remanejamento ───────────────
router.post('/solicitacoes', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const role   = req.user!.role;

    const { colaboradorId, projetoDestinoId, macroEntregaDestinoId,
            microEntregaDestinoId, ano, mes, horasSolicitadas } = req.body;

    if (!colaboradorId || !projetoDestinoId || !macroEntregaDestinoId || !microEntregaDestinoId) {
      return res.status(400).json({ error: 'colaboradorId, projetoDestinoId, macroEntregaDestinoId e microEntregaDestinoId são obrigatórios' });
    }

    const anoN = parseInt(ano);
    const mesN = parseInt(mes);
    if (!anoN || anoN < 2020 || anoN > 2100) return res.status(400).json({ error: 'ano inválido (2020–2100)' });
    if (!mesN || mesN < 1  || mesN > 12)     return res.status(400).json({ error: 'mes inválido (1–12)' });

    let horas: Prisma.Decimal;
    try {
      horas = new Prisma.Decimal(horasSolicitadas);
      if (horas.lessThanOrEqualTo(0)) throw new Error();
    } catch {
      return res.status(400).json({ error: 'horasSolicitadas deve ser um número positivo' });
    }

    if (await mesEstaFechado(anoN, mesN)) {
      return res.status(409).json({ error: 'Mês fechado', mesFechado: true });
    }

    const colaborador = await prisma.colaborador.findUnique({ where: { id: colaboradorId } });
    if (!colaborador)       return res.status(404).json({ error: 'Colaborador não encontrado' });
    if (!colaborador.ativo) return res.status(400).json({ error: 'Colaborador está inativo' });

    const projeto = await prisma.projeto.findUnique({ where: { id: projetoDestinoId } });
    if (!projeto) return res.status(404).json({ error: 'Projeto destino não encontrado' });
    if (role !== 'admin' && projeto.gestorId !== userId) {
      return res.status(403).json({ error: 'Projeto destino não pertence ao solicitante' });
    }
    if (projeto.status !== 'ativo') {
      return res.status(400).json({ error: 'Projeto destino está arquivado' });
    }

    const macro = await prisma.macroEntrega.findFirst({
      where: { id: macroEntregaDestinoId, projetoId: projetoDestinoId },
    });
    if (!macro) return res.status(400).json({ error: 'MacroEntrega não pertence ao projeto informado' });

    const micro = await prisma.microEntrega.findFirst({
      where: { id: microEntregaDestinoId, macroEntregaId: macroEntregaDestinoId },
    });
    if (!micro) return res.status(400).json({ error: 'MicroEntrega não pertence à macro informada' });

    const solicitacao = await prisma.solicitacaoRemanejamento.create({
      data: {
        id:                   generateId(),
        solicitanteId:        userId,
        colaboradorId,
        projetoDestinoId,
        macroEntregaDestinoId,
        microEntregaDestinoId,
        ano:                  anoN,
        mes:                  mesN,
        horasSolicitadas:     horas,
        status:               'aberta',
      },
      include: solicitacaoInclude,
    });

    return res.status(201).json({ solicitacao });
  } catch (error) {
    console.error('Criar solicitação error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /solicitacoes — listar (minhas + broadcast de recebidas) ───────────
router.get('/solicitacoes', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const role   = req.user!.role;

    // minhas: qualquer status onde sou o solicitante
    const minhasRaw = await prisma.solicitacaoRemanejamento.findMany({
      where:   { solicitanteId: userId },
      orderBy: { createdAt: 'desc' },
      include: solicitacaoInclude,
    });

    // recebidas: 'aberta', não sou o solicitante
    // gestor: só as que tenho o colaborador alocado no mesmo mês (em algum projeto meu)
    // admin: todas as 'aberta' que não criei
    let recebidasRaw: typeof minhasRaw;

    if (role === 'admin') {
      recebidasRaw = await prisma.solicitacaoRemanejamento.findMany({
        where:   { status: 'aberta', NOT: { solicitanteId: userId } },
        orderBy: { createdAt: 'desc' },
        include: solicitacaoInclude,
      });
    } else {
      const meusColabMeses = await prisma.alocacao.findMany({
        where:  { projeto: { gestorId: userId } },
        select: { colaboradorId: true, ano: true, mes: true },
      });
      const chaveSet = new Set(
        meusColabMeses.map(a => `${a.colaboradorId}::${a.ano}::${a.mes}`),
      );

      const todasAbertas = await prisma.solicitacaoRemanejamento.findMany({
        where:   { status: 'aberta', NOT: { solicitanteId: userId } },
        orderBy: { createdAt: 'desc' },
        include: solicitacaoInclude,
      });

      recebidasRaw = todasAbertas.filter(s =>
        chaveSet.has(`${s.colaboradorId}::${s.ano}::${s.mes}`),
      );
    }

    const [minhas, recebidas] = await Promise.all([
      comCessoes(minhasRaw),
      comCessoes(recebidasRaw),
    ]);

    return res.json({ minhas, recebidas });
  } catch (error) {
    console.error('Listar solicitações error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
