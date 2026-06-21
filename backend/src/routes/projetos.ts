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
    criadoPorId: p.criadoPorId,
    status: p.status,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    gestor: p.gestor,
    criadoPor: p.criadoPor,
    categoria: p.categoria ? { id: p.categoria.id, nome: p.categoria.nome, ativo: p.categoria.ativo } : null,
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

    const projeto = await prisma.$transaction(async (tx) => {
      await tx.projeto.create({
        data: { id: projetoId, codigo: codigoNorm, nome: nome.trim(), gestorId, criadoPorId, categoriaId, status: 'ativo' },
      });
      await tx.prestacaoContas.createMany({
        data: datas.map(d => ({ id: generateId(), projetoId, data: d })),
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
router.put('/:id', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
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

    const updated = await prisma.$transaction(async (tx) => {
      await tx.projeto.update({
        where: { id },
        data: {
          ...(nome?.trim() ? { nome: nome.trim() } : {}),
          ...(categoriaId !== undefined ? { categoriaId } : {}),
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
