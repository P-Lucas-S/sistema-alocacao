import express from 'express';
import prisma from '../prisma.js';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.js';

const router = express.Router();
const generateId = () => Math.random().toString(36).substring(2, 15);

// ── Helpers ────────────────────────────────────────────────────────────────

// Compara datas à meia-noite UTC para não sofrer efeito de fuso
function computeProxima(prestacoes: { id: string; data: Date }[]) {
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
    status: p.status,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    gestor: p.gestor,
    prestacoesContas: prestacoes,
    proximaPrestacao: computeProxima(
      (p.prestacoesContas ?? []).map((pc: any) => ({ id: pc.id, data: pc.data }))
    ),
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

// ── GET /:id — detalhe de um projeto ──────────────────────────────────────
router.get('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const role   = req.user!.role;

    const projeto = await prisma.projeto.findUnique({
      where: { id },
      include: {
        gestor: { select: { id: true, name: true } },
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
router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const { status } = req.query as { status?: string };
    const userId = req.user!.id;
    const role   = req.user!.role;

    const where: any = {};
    if (role === 'gestor') where.gestorId = userId;
    if (status === 'arquivado')    where.status = 'arquivado';
    else if (status === 'todos') { /* sem filtro */ }
    else                           where.status = 'ativo';

    const rows = await prisma.projeto.findMany({
      where,
      include: {
        gestor: { select: { id: true, name: true } },
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
router.post('/', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
  try {
    const { codigo, nome, prestacoesContas } = req.body;
    const gestorId = req.user!.id;

    if (!codigo?.trim()) return res.status(400).json({ error: 'codigo é obrigatório' });
    if (!nome?.trim())   return res.status(400).json({ error: 'nome é obrigatório' });

    const datas = parseDatas(prestacoesContas);
    if (!datas) {
      return res.status(400).json({ error: 'Pelo menos uma data de prestação de contas é obrigatória' });
    }

    const codigoNorm = codigo.trim().toUpperCase();
    const conflict = await prisma.projeto.findUnique({ where: { codigo: codigoNorm } });
    if (conflict) {
      return res.status(409).json({ error: `Código "${codigoNorm}" já está em uso. Escolha um código diferente.` });
    }

    const projetoId = generateId();

    const projeto = await prisma.$transaction(async (tx) => {
      await tx.projeto.create({
        data: { id: projetoId, codigo: codigoNorm, nome: nome.trim(), gestorId, status: 'ativo' },
      });
      await tx.prestacaoContas.createMany({
        data: datas.map(d => ({ id: generateId(), projetoId, data: d })),
      });
      return tx.projeto.findUniqueOrThrow({
        where: { id: projetoId },
        include: {
          gestor: { select: { id: true, name: true } },
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
router.put('/:id', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { nome, prestacoesContas } = req.body;
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

    const updated = await prisma.$transaction(async (tx) => {
      await tx.projeto.update({
        where: { id },
        data: { ...(nome?.trim() ? { nome: nome.trim() } : {}) },
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
router.patch('/:id/status', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
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

export default router;
