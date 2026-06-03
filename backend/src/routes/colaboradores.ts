import express from 'express';
import prisma from '../prisma.js';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.js';

const router = express.Router();
const generateId = () => Math.random().toString(36).substring(2, 15);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function isSimilar(a: string, b: string): boolean {
  const na = normalize(a), nb = normalize(b);
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return false;
  return levenshtein(na, nb) <= Math.floor(maxLen * 0.3);
}

// ── GET / ─────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const { search, funcao, ativo } = req.query as Record<string, string | undefined>;

    const where: any = {};
    if (ativo !== undefined) where.ativo = ativo === 'true';
    if (funcao) where.funcao = { contains: funcao };
    if (search) {
      where.OR = [
        { nome: { contains: search } },
        { email: { contains: search } },
      ];
    }

    const colaboradores = await prisma.colaborador.findMany({
      where,
      orderBy: { nome: 'asc' },
      select: {
        id: true, nome: true, email: true, funcao: true,
        ativo: true, createdAt: true,
        createdBy: { select: { name: true } },
      },
    });

    res.json(colaboradores);
  } catch (error) {
    console.error('List colaboradores error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST / ────────────────────────────────────────────────────────────────
// Estágio 1 (sem confirmarSimilar): valida e-mail + checa nome → pode retornar
//   { needsConfirmation: true, similares } sem criar nada.
// Estágio 2 (confirmarSimilar: true): pula check de nome e cria diretamente.
// E-mail duplicado é SEMPRE 409, o flag confirmarSimilar não o contorna.
router.post('/', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
  try {
    const { nome, email, funcao, confirmarSimilar } = req.body;
    const createdById = req.user!.id;

    if (!nome?.trim()) return res.status(400).json({ error: 'nome é obrigatório' });
    if (!email?.trim()) return res.status(400).json({ error: 'email é obrigatório' });

    const emailNorm = email.trim().toLowerCase();

    // Trava dura: e-mail único — nunca contornável
    const emailConflict = await prisma.colaborador.findUnique({ where: { email: emailNorm } });
    if (emailConflict) {
      return res.status(409).json({ error: `Já existe um colaborador com o e-mail ${emailNorm}` });
    }

    // Verificação de similaridade de nome (pulada quando confirmarSimilar: true)
    if (!confirmarSimilar) {
      const todos = await prisma.colaborador.findMany({
        select: { id: true, nome: true, email: true, funcao: true },
      });
      const similares = todos.filter(c => isSimilar(c.nome, nome.trim()));

      if (similares.length > 0) {
        // Retorna 200 sem criar — frontend deve pedir confirmação
        return res.status(200).json({
          needsConfirmation: true,
          similares: similares.map(s => ({ nome: s.nome, email: s.email, funcao: s.funcao })),
        });
      }
    }

    // Cria o colaborador
    const id = generateId();
    const colaborador = await prisma.colaborador.create({
      data: { id, nome: nome.trim(), email: emailNorm, funcao: funcao?.trim() || null, createdById },
      select: { id: true, nome: true, email: true, funcao: true, ativo: true, createdAt: true },
    });

    res.status(201).json({ colaborador });
  } catch (error) {
    console.error('Create colaborador error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /:id ───────────────────────────────────────────────────────────────
router.put('/:id', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { nome, email, funcao } = req.body;

    const current = await prisma.colaborador.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: 'Colaborador não encontrado' });

    const emailNorm = email?.trim().toLowerCase();
    if (emailNorm && emailNorm !== current.email) {
      const conflict = await prisma.colaborador.findUnique({ where: { email: emailNorm } });
      if (conflict) return res.status(409).json({ error: 'E-mail já está em uso por outro colaborador' });
    }

    const updated = await prisma.colaborador.update({
      where: { id },
      data: {
        ...(nome?.trim() ? { nome: nome.trim() } : {}),
        ...(emailNorm ? { email: emailNorm } : {}),
        ...(funcao !== undefined ? { funcao: funcao?.trim() || null } : {}),
      },
      select: { id: true, nome: true, email: true, funcao: true, ativo: true, createdAt: true },
    });

    res.json(updated);
  } catch (error) {
    console.error('Update colaborador error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /:id/ativo ───────────────────────────────────────────────────────
router.patch('/:id/ativo', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { ativo } = req.body;

    if (typeof ativo !== 'boolean') return res.status(400).json({ error: 'ativo deve ser boolean' });

    const current = await prisma.colaborador.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: 'Colaborador não encontrado' });

    const updated = await prisma.colaborador.update({
      where: { id },
      data: { ativo },
      select: { id: true, nome: true, ativo: true },
    });

    res.json(updated);
  } catch (error) {
    console.error('Toggle ativo error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
