import express from 'express';
import prisma from '../prisma.js';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.js';

const router = express.Router();
const generateId = () => Math.random().toString(36).substring(2, 15);

function parseAnoMes(ano: unknown, mes: unknown): { anoN: number; mesN: number } | null {
  const anoN = parseInt(String(ano));
  const mesN = parseInt(String(mes));
  return (!anoN || anoN < 2020 || anoN > 2100 || !mesN || mesN < 1 || mesN > 12) ? null : { anoN, mesN };
}

// ── POST / — fechar um mês ────────────────────────────────────────────────────
router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
  try {
    const parsed = parseAnoMes(req.body.ano, req.body.mes);
    if (!parsed) return res.status(400).json({ error: 'ano (2020–2100) e mes (1–12) são obrigatórios e válidos' });
    const { anoN, mesN } = parsed;

    const existente = await prisma.fechamentoMensal.findUnique({
      where: { ano_mes: { ano: anoN, mes: mesN } },
    });
    if (existente) return res.status(409).json({ error: 'Mês já fechado' });

    const fechamento = await prisma.fechamentoMensal.create({
      data: { id: generateId(), ano: anoN, mes: mesN, fechadoPorId: req.user!.id },
    });

    res.status(201).json({ fechamento });
  } catch (error) {
    console.error('Fechar mês error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /:ano/:mes — reabrir um mês ────────────────────────────────────────
router.delete('/:ano/:mes', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
  try {
    const parsed = parseAnoMes(req.params.ano, req.params.mes);
    if (!parsed) return res.status(400).json({ error: 'ano (2020–2100) e mes (1–12) inválidos' });
    const { anoN, mesN } = parsed;

    const existente = await prisma.fechamentoMensal.findUnique({
      where: { ano_mes: { ano: anoN, mes: mesN } },
    });
    if (!existente) return res.status(404).json({ error: 'Mês não está fechado' });

    await prisma.fechamentoMensal.delete({ where: { ano_mes: { ano: anoN, mes: mesN } } });

    res.json({ success: true });
  } catch (error) {
    console.error('Reabrir mês error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
