import express from 'express';
import prisma from '../prisma.js';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.js';

const router = express.Router();
const generateId = () => Math.random().toString(36).substring(2, 15);

// Idêntica à lógica de similaridade de backend/src/routes/colaboradores.ts
// (mesma função de distância, mesmo limiar) — reaproveitada de propósito.
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

// ── GET / — lista programas ────────────────────────────────────────────────
router.get('/', authenticate, requireRole('admin', 'gestor', 'coordenacao', 'chefe', 'diretor'), async (req: AuthRequest, res) => {
  try {
    const { ativo } = req.query as Record<string, string | undefined>;

    const where: any = {};
    if (ativo !== undefined) where.ativo = ativo === 'true';

    const categorias = await prisma.categoriaProjeto.findMany({
      where,
      orderBy: { nome: 'asc' },
    });

    res.json(categorias);
  } catch (error) {
    console.error('List categorias error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST / ────────────────────────────────────────────────────────────────
// Estágio 1 (sem confirmarSimilar): EXATO (case-insensitive) → 409 sempre;
//   SIMILAR (não idêntico) → { needsConfirmation: true, similares } sem criar.
// Estágio 2 (confirmarSimilar: true): pula o check de similar e cria direto.
router.post('/', authenticate, requireRole('admin', 'chefe', 'gestor'), async (req: AuthRequest, res) => {
  try {
    const { nome, confirmarSimilar } = req.body;

    if (!nome?.trim()) return res.status(400).json({ error: 'nome é obrigatório' });
    const nomeTrim = nome.trim();

    const todas = await prisma.categoriaProjeto.findMany();

    // EXATO — ignorando maiúsculas/minúsculas — nunca contornável
    const exata = todas.find(c => c.nome.toLowerCase() === nomeTrim.toLowerCase());
    if (exata) {
      return res.status(409).json({ error: 'Já existe um programa com esse nome', existente: exata });
    }

    // SIMILAR — pulado quando confirmarSimilar: true
    if (!confirmarSimilar) {
      const similares = todas.filter(c => isSimilar(c.nome, nomeTrim));
      if (similares.length > 0) {
        return res.status(200).json({
          needsConfirmation: true,
          similares: similares.map(s => ({ id: s.id, nome: s.nome, ativo: s.ativo })),
        });
      }
    }

    const id = generateId();
    const categoria = await prisma.categoriaProjeto.create({
      data: { id, nome: nomeTrim, ativo: true },
    });

    res.status(201).json({ categoria });
  } catch (error: any) {
    // Rede de segurança contra corrida de duplicidade (unique do banco)
    if (error?.code === 'P2002') {
      return res.status(409).json({ error: 'Já existe um programa com esse nome' });
    }
    console.error('Create categoria error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /:id ────────────────────────────────────────────────────────────
router.patch('/:id', authenticate, requireRole('admin', 'chefe', 'gestor'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { nome, ativo, confirmarSimilar } = req.body;

    const current = await prisma.categoriaProjeto.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: 'Programa não encontrado' });

    let nomeTrim: string | undefined;
    if (nome !== undefined) {
      if (!nome?.trim()) return res.status(400).json({ error: 'nome é obrigatório' });
      nomeTrim = nome.trim();

      // Mesmas checagens EXATO + SIMILAR do POST, excluindo o próprio id
      const outras = await prisma.categoriaProjeto.findMany({ where: { id: { not: id } } });

      const exata = outras.find(c => c.nome.toLowerCase() === nomeTrim!.toLowerCase());
      if (exata) {
        return res.status(409).json({ error: 'Já existe um programa com esse nome', existente: exata });
      }

      if (!confirmarSimilar) {
        const similares = outras.filter(c => isSimilar(c.nome, nomeTrim!));
        if (similares.length > 0) {
          return res.status(200).json({
            needsConfirmation: true,
            similares: similares.map(s => ({ id: s.id, nome: s.nome, ativo: s.ativo })),
          });
        }
      }
    }

    if (ativo !== undefined && typeof ativo !== 'boolean') {
      return res.status(400).json({ error: 'ativo deve ser boolean' });
    }

    const updated = await prisma.categoriaProjeto.update({
      where: { id },
      data: {
        ...(nomeTrim !== undefined ? { nome: nomeTrim } : {}),
        ...(ativo !== undefined ? { ativo } : {}),
      },
    });

    res.json(updated);
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ error: 'Já existe um programa com esse nome' });
    }
    console.error('Update categoria error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
