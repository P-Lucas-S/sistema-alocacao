import express from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prisma.js';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.js';
import { mesEstaFechado } from './alocacoes.js';

// mergeParams: true permite acessar :projetoId do app.use pai
const router = express.Router({ mergeParams: true });
const generateId = () => Math.random().toString(36).substring(2, 15);

// ── Helper: verifica que o projeto existe e o caller é dono (ou admin) ─────
async function requireOwner(
  projetoId: string,
  userId: string,
  role: string,
  res: express.Response
): Promise<boolean> {
  const projeto = await prisma.projeto.findUnique({ where: { id: projetoId } });
  if (!projeto) {
    res.status(404).json({ error: 'Projeto não encontrado' });
    return false;
  }
  if (role === 'gestor' && projeto.gestorId !== userId) {
    res.status(403).json({ error: 'Só o gestor dono do projeto pode gerenciar suas entregas' });
    return false;
  }
  return true;
}

// ── MACROS ────────────────────────────────────────────────────────────────

// GET / — lista macros com suas micros
router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const { projetoId } = req.params as { projetoId: string };
    const projeto = await prisma.projeto.findUnique({ where: { id: projetoId } });
    if (!projeto) return res.status(404).json({ error: 'Projeto não encontrado' });

    const macros = await prisma.macroEntrega.findMany({
      where: { projetoId },
      orderBy: { createdAt: 'asc' },
      include: { microEntregas: { orderBy: { createdAt: 'asc' } } },
    });
    res.json(macros);
  } catch (error) {
    console.error('List macros error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST / — cria macro + micro "Geral" automática (transação)
router.post('/', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
  try {
    const { projetoId } = req.params as { projetoId: string };
    const { nome, descricao } = req.body;
    const userId = req.user!.id;
    const role   = req.user!.role;

    if (!(await requireOwner(projetoId, userId, role, res))) return;
    if (!nome?.trim()) return res.status(400).json({ error: 'nome é obrigatório' });

    const macroId = generateId();

    const macro = await prisma.$transaction(async (tx) => {
      await tx.macroEntrega.create({
        data: { id: macroId, projetoId, nome: nome.trim(), descricao: descricao?.trim() || null, status: 'ativa' },
      });
      // Micro "Geral" automática — destino padrão de alocação
      await tx.microEntrega.create({
        data: { id: generateId(), macroEntregaId: macroId, nome: 'Geral', status: 'pendente' },
      });
      return tx.macroEntrega.findUniqueOrThrow({
        where: { id: macroId },
        include: { microEntregas: { orderBy: { createdAt: 'asc' } } },
      });
    });

    res.status(201).json(macro);
  } catch (error) {
    console.error('Create macro error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /:macroId — edita macro
router.put('/:macroId', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
  try {
    const { projetoId, macroId } = req.params as { projetoId: string; macroId: string };
    const { nome, descricao } = req.body;
    const userId = req.user!.id;
    const role   = req.user!.role;

    if (!(await requireOwner(projetoId, userId, role, res))) return;

    const macro = await prisma.macroEntrega.findFirst({ where: { id: macroId, projetoId } });
    if (!macro) return res.status(404).json({ error: 'MacroEntrega não encontrada' });

    const updated = await prisma.macroEntrega.update({
      where: { id: macroId },
      data: {
        ...(nome?.trim() ? { nome: nome.trim() } : {}),
        ...(descricao !== undefined ? { descricao: descricao?.trim() || null } : {}),
      },
      include: { microEntregas: { orderBy: { createdAt: 'asc' } } },
    });
    res.json(updated);
  } catch (error) {
    console.error('Update macro error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /:macroId — apaga macro e todas as suas micros
//
// SEMPRE em 2 chamadas (mesmo padrão needsConfirmation de categorias) — mesmo
// quando a macro está vazia, pra evitar dois confirm() nativos em sequência
// no frontend (um genérico + um informativo). A 1ª chamada NUNCA apaga nada.
//   1ª chamada (sem ?confirmar): se algum mês das alocações está fechado, 400
//     e não apaga nada; senão, 200 { needsConfirmation, totalAlocacoes, totalHoras }
//     (totalAlocacoes pode ser 0, pra macro vazia) — só informa, não apaga.
//   2ª chamada (?confirmar=true): revalida mês fechado (defensivo — pode ter
//     fechado entre as duas chamadas) e, se livre, apaga TUDO numa transação:
//     cada alocação (com log 'removeu', mesmo formato de DELETE /api/alocacoes/:id,
//     se houver) → as micros → a macro. 200 { ok: true, alocacoesRemovidas }.
router.delete('/:macroId', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
  try {
    const { projetoId, macroId } = req.params as { projetoId: string; macroId: string };
    const userId = req.user!.id;
    const role   = req.user!.role;
    const confirmar = req.query.confirmar === 'true';

    if (!(await requireOwner(projetoId, userId, role, res))) return;

    const macro = await prisma.macroEntrega.findFirst({ where: { id: macroId, projetoId } });
    if (!macro) return res.status(404).json({ error: 'MacroEntrega não encontrada' });

    const alocacoes = await prisma.alocacao.findMany({ where: { macroEntregaId: macroId } });

    // ── Verifica mês fechado em TODAS as alocações (lista vazia = nenhum mês,
    // passa direto). Recalculado em toda chamada (1ª e 2ª) → a "revalidação
    // defensiva" da 2ª chamada é o mesmo código, não um caminho separado.
    const mesesEnvolvidos = [...new Set(alocacoes.map(a => `${a.ano}-${a.mes}`))]
      .map(s => { const [ano, mes] = s.split('-').map(Number); return { ano, mes }; })
      .sort((a, b) => a.ano - b.ano || a.mes - b.mes);

    const mesesFechados: { ano: number; mes: number }[] = [];
    for (const { ano, mes } of mesesEnvolvidos) {
      if (await mesEstaFechado(ano, mes)) mesesFechados.push({ ano, mes });
    }

    if (mesesFechados.length > 0) {
      const lista = mesesFechados.map(m => `${String(m.mes).padStart(2, '0')}/${m.ano}`).join(', ');
      return res.status(400).json({
        error: `Esta macro tem alocação em mês(es) fechado(s): ${lista}. Reabra o(s) mês(es) ou remova essas alocações antes de apagar a macro.`,
      });
    }

    // ── 1ª chamada: avisa e pede confirmação, sem apagar nada — mesmo se vazia ──
    if (!confirmar) {
      const totalHoras = alocacoes.reduce((s, a) => s.plus(a.horasPlanejadas), new Prisma.Decimal(0));
      return res.status(200).json({
        needsConfirmation: true,
        totalAlocacoes: alocacoes.length,
        totalHoras: totalHoras.toString(),
      });
    }

    // ── 2ª chamada confirmada: apaga alocações (com log, se houver) + micros + macro ──
    await prisma.$transaction(async (tx) => {
      for (const aloc of alocacoes) {
        await tx.alocacao.delete({ where: { id: aloc.id } });
        await tx.alocacaoLog.create({
          data: {
            id:              generateId(),
            alocacaoId:      aloc.id,
            colaboradorId:   aloc.colaboradorId,
            projetoId:       aloc.projetoId,
            macroEntregaId:  aloc.macroEntregaId,
            microEntregaId:  aloc.microEntregaId,
            ano:             aloc.ano,
            mes:             aloc.mes,
            acao:            'removeu',
            horasAnteriores: aloc.horasPlanejadas,
            horasNovas:      null,
            usuarioId:       userId,
          },
        });
      }
      await tx.microEntrega.deleteMany({ where: { macroEntregaId: macroId } });
      await tx.macroEntrega.delete({ where: { id: macroId } });
    });

    res.json({ ok: true, alocacoesRemovidas: alocacoes.length });
  } catch (error) {
    console.error('Delete macro error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── MICROS ────────────────────────────────────────────────────────────────

// POST /:macroId/micros — cria micro extra
router.post('/:macroId/micros', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
  try {
    const { projetoId, macroId } = req.params as { projetoId: string; macroId: string };
    const { nome, descricao } = req.body;
    const userId = req.user!.id;
    const role   = req.user!.role;

    if (!(await requireOwner(projetoId, userId, role, res))) return;
    if (!nome?.trim()) return res.status(400).json({ error: 'nome é obrigatório' });

    const macro = await prisma.macroEntrega.findFirst({ where: { id: macroId, projetoId } });
    if (!macro) return res.status(404).json({ error: 'MacroEntrega não encontrada' });

    const micro = await prisma.microEntrega.create({
      data: {
        id: generateId(),
        macroEntregaId: macroId,
        nome: nome.trim(),
        descricao: descricao?.trim() || null,
        status: 'pendente',
      },
    });
    res.status(201).json(micro);
  } catch (error) {
    console.error('Create micro error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /:macroId/micros/:microId — edita micro
router.put('/:macroId/micros/:microId', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
  try {
    const { projetoId, macroId, microId } = req.params as { projetoId: string; macroId: string; microId: string };
    const { nome, descricao } = req.body;
    const userId = req.user!.id;
    const role   = req.user!.role;

    if (!(await requireOwner(projetoId, userId, role, res))) return;

    const micro = await prisma.microEntrega.findFirst({ where: { id: microId, macroEntregaId: macroId } });
    if (!micro) return res.status(404).json({ error: 'MicroEntrega não encontrada' });

    const updated = await prisma.microEntrega.update({
      where: { id: microId },
      data: {
        ...(nome?.trim() ? { nome: nome.trim() } : {}),
        ...(descricao !== undefined ? { descricao: descricao?.trim() || null } : {}),
      },
    });
    res.json(updated);
  } catch (error) {
    console.error('Update micro error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /:macroId/micros/:microId — apaga micro (não se for a única)
router.delete('/:macroId/micros/:microId', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
  try {
    const { projetoId, macroId, microId } = req.params as { projetoId: string; macroId: string; microId: string };
    const userId = req.user!.id;
    const role   = req.user!.role;

    if (!(await requireOwner(projetoId, userId, role, res))) return;

    const micro = await prisma.microEntrega.findFirst({ where: { id: microId, macroEntregaId: macroId } });
    if (!micro) return res.status(404).json({ error: 'MicroEntrega não encontrada' });

    const count = await prisma.microEntrega.count({ where: { macroEntregaId: macroId } });
    if (count <= 1) {
      return res.status(400).json({
        error: 'Não é possível remover a única micro-entrega de uma macro. Adicione outra antes de remover esta.',
      });
    }

    const alocCount = await prisma.alocacao.count({ where: { microEntregaId: microId } });
    if (alocCount > 0) {
      return res.status(400).json({
        error: `Não é possível remover: há ${alocCount} alocação(ões) vinculada(s) a esta micro-entrega.`,
      });
    }

    await prisma.microEntrega.delete({ where: { id: microId } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete micro error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
