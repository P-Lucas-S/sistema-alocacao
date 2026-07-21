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

// ── Validação do array `tarifas` (overrides por categoria) ──────────────────
// O array enviado é o CONJUNTO COMPLETO de overrides do colaborador.
interface TarifaInput { categoriaId: string; valorHora: number }
type ValidarTarifasResult = { error: string } | { tarifas: TarifaInput[] };

async function validarTarifas(tarifasRaw: unknown): Promise<ValidarTarifasResult> {
  if (!Array.isArray(tarifasRaw)) {
    return { error: 'tarifas deve ser uma lista de { categoriaId, valorHora }.' };
  }

  const categoriaIdsVistos = new Set<string>();
  const parsed: TarifaInput[] = [];

  for (const item of tarifasRaw) {
    const categoriaId = item?.categoriaId;
    if (!categoriaId || typeof categoriaId !== 'string') {
      return { error: 'Cada item de tarifas precisa de categoriaId.' };
    }
    if (categoriaIdsVistos.has(categoriaId)) {
      return { error: 'categoriaId repetido em tarifas.' };
    }
    categoriaIdsVistos.add(categoriaId);

    const valorHoraNum = Number(item?.valorHora);
    if (item?.valorHora === undefined || item?.valorHora === null || item?.valorHora === '' || isNaN(valorHoraNum) || valorHoraNum <= 0) {
      return { error: 'valorHora de cada item de tarifas deve ser maior que zero.' };
    }

    parsed.push({ categoriaId, valorHora: valorHoraNum });
  }

  if (parsed.length > 0) {
    const categorias = await prisma.categoriaProjeto.findMany({
      where: { id: { in: [...categoriaIdsVistos] } },
      select: { id: true, ativo: true },
    });
    const categoriaPorId = new Map(categorias.map(c => [c.id, c.ativo]));

    for (const t of parsed) {
      const ativo = categoriaPorId.get(t.categoriaId);
      if (ativo === undefined) return { error: `Programa não encontrado: ${t.categoriaId}` };
      if (!ativo)             return { error: `Programa inativo: ${t.categoriaId}` };
    }
  }

  return { tarifas: parsed };
}

// ── GET / ─────────────────────────────────────────────────────────────────
router.get('/', authenticate, requireRole('admin', 'gestor', 'chefe', 'coordenacao'), async (req: AuthRequest, res) => {
  try {
    const { search, ativo, profissaoId } = req.query as Record<string, string | undefined>;

    const where: any = {};
    if (ativo !== undefined) where.ativo = ativo === 'true';
    if (profissaoId) where.profissaoId = profissaoId;
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
        id: true, nome: true, email: true,
        profissao: { select: { id: true, nome: true } },
        valorHora: true, ativo: true, createdAt: true,
        createdBy: { select: { name: true } },
      },
    });

    res.json(colaboradores);
  } catch (error) {
    console.error('List colaboradores error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /:id — detalhe (usado pela edição) — inclui os overrides de tarifa ──
router.get('/:id', authenticate, requireRole('admin', 'gestor', 'chefe', 'coordenacao'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const colaborador = await prisma.colaborador.findUnique({
      where: { id },
      select: {
        id: true, nome: true, email: true,
        profissao: { select: { id: true, nome: true } },
        valorHora: true, ativo: true, createdAt: true,
        createdBy: { select: { name: true } },
        tarifas: { select: { categoriaId: true, valorHora: true } },
      },
    });
    if (!colaborador) return res.status(404).json({ error: 'Colaborador não encontrado' });

    res.json(colaborador);
  } catch (error) {
    console.error('Get colaborador error:', error);
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
    const { nome, email, profissaoId, valorHora, tarifas, confirmarSimilar } = req.body;
    const createdById = req.user!.id;

    if (!nome?.trim()) return res.status(400).json({ error: 'nome é obrigatório' });
    if (!email?.trim()) return res.status(400).json({ error: 'email é obrigatório' });

    const valorHoraNum = Number(valorHora);
    if (valorHora === undefined || valorHora === null || valorHora === '' || isNaN(valorHoraNum) || valorHoraNum <= 0) {
      return res.status(400).json({ error: 'Informe o valor-hora padrão do colaborador (maior que zero).' });
    }

    // Profissão — obrigatória na criação (mesmo molde do categoriaId em POST /projetos)
    if (!profissaoId) return res.status(400).json({ error: 'Profissão é obrigatória' });
    const profissao = await prisma.profissao.findUnique({ where: { id: profissaoId } });
    if (!profissao)        return res.status(400).json({ error: 'Profissão não encontrada' });
    if (!profissao.ativo)  return res.status(400).json({ error: 'Profissão inativa' });

    let tarifasValidadas: TarifaInput[] = [];
    if (tarifas !== undefined) {
      const result = await validarTarifas(tarifas);
      if ('error' in result) return res.status(400).json({ error: result.error });
      tarifasValidadas = result.tarifas;
    }

    const emailNorm = email.trim().toLowerCase();

    // Trava dura: e-mail único — nunca contornável
    const emailConflict = await prisma.colaborador.findUnique({ where: { email: emailNorm } });
    if (emailConflict) {
      return res.status(409).json({ error: `Já existe um colaborador com o e-mail ${emailNorm}` });
    }

    // Verificação de similaridade de nome (pulada quando confirmarSimilar: true)
    if (!confirmarSimilar) {
      const todos = await prisma.colaborador.findMany({
        select: { id: true, nome: true, email: true, profissao: { select: { nome: true } } },
      });
      const similares = todos.filter(c => isSimilar(c.nome, nome.trim()));

      if (similares.length > 0) {
        // Retorna 200 sem criar — frontend deve pedir confirmação
        return res.status(200).json({
          needsConfirmation: true,
          similares: similares.map(s => ({ nome: s.nome, email: s.email, profissao: s.profissao?.nome ?? null })),
        });
      }
    }

    // Cria o colaborador + overrides de tarifa, na mesma transação
    const id = generateId();
    const colaborador = await prisma.$transaction(async (tx) => {
      await tx.colaborador.create({
        data: { id, nome: nome.trim(), email: emailNorm, profissaoId, valorHora: valorHoraNum, createdById },
      });

      for (const t of tarifasValidadas) {
        await tx.tarifaColaborador.create({
          data: { id: generateId(), colaboradorId: id, categoriaId: t.categoriaId, valorHora: t.valorHora },
        });
      }

      return tx.colaborador.findUniqueOrThrow({
        where: { id },
        select: {
          id: true, nome: true, email: true,
          profissao: { select: { id: true, nome: true } },
          valorHora: true, ativo: true, createdAt: true,
        },
      });
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
    const { nome, email, profissaoId, valorHora, tarifas } = req.body;

    const current = await prisma.colaborador.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: 'Colaborador não encontrado' });

    const valorHoraNum = Number(valorHora);
    if (valorHora === undefined || valorHora === null || valorHora === '' || isNaN(valorHoraNum) || valorHoraNum <= 0) {
      return res.status(400).json({ error: 'Informe o valor-hora padrão do colaborador (maior que zero).' });
    }

    // Profissão — se enviada, não pode ficar vazia; ausente → preserva a atual
    // (mesmo molde do categoriaId em PUT /projetos)
    if (profissaoId !== undefined) {
      if (!profissaoId) return res.status(400).json({ error: 'Profissão é obrigatória' });
      const profissao = await prisma.profissao.findUnique({ where: { id: profissaoId } });
      if (!profissao)        return res.status(400).json({ error: 'Profissão não encontrada' });
      if (!profissao.ativo)  return res.status(400).json({ error: 'Profissão inativa' });
    }

    // tarifas ausente → não mexe nos overrides existentes; [] → apaga todos.
    let tarifasValidadas: TarifaInput[] | undefined;
    if (tarifas !== undefined) {
      const result = await validarTarifas(tarifas);
      if ('error' in result) return res.status(400).json({ error: result.error });
      tarifasValidadas = result.tarifas;
    }

    const emailNorm = email?.trim().toLowerCase();
    if (emailNorm && emailNorm !== current.email) {
      const conflict = await prisma.colaborador.findUnique({ where: { email: emailNorm } });
      if (conflict) return res.status(409).json({ error: 'E-mail já está em uso por outro colaborador' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.colaborador.update({
        where: { id },
        data: {
          ...(nome?.trim() ? { nome: nome.trim() } : {}),
          ...(emailNorm ? { email: emailNorm } : {}),
          ...(profissaoId !== undefined ? { profissaoId } : {}),
          valorHora: valorHoraNum,
        },
      });

      if (tarifasValidadas !== undefined) {
        const categoriaIdsNovos = tarifasValidadas.map(t => t.categoriaId);

        for (const t of tarifasValidadas) {
          await tx.tarifaColaborador.upsert({
            where: { colaboradorId_categoriaId: { colaboradorId: id, categoriaId: t.categoriaId } },
            create: { id: generateId(), colaboradorId: id, categoriaId: t.categoriaId, valorHora: t.valorHora },
            update: { valorHora: t.valorHora },
          });
        }

        // O array enviado é o conjunto COMPLETO de overrides — apaga o que ficou de fora dele
        await tx.tarifaColaborador.deleteMany({
          where: { colaboradorId: id, categoriaId: { notIn: categoriaIdsNovos } },
        });
      }

      return tx.colaborador.findUniqueOrThrow({
        where: { id },
        select: {
          id: true, nome: true, email: true,
          profissao: { select: { id: true, nome: true } },
          valorHora: true, ativo: true, createdAt: true,
        },
      });
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
