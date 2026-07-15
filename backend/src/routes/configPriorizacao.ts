import express from 'express';
import prisma from '../prisma.js';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.js';
import { CONFIG_PRIORIZACAO_ID } from './priorizacao.js';

const router = express.Router();

// GET / — lê a config atual. Mesmos papéis que podem ver a priorização.
router.get('/', authenticate, requireRole('admin', 'gestor', 'chefe', 'coordenacao', 'diretor'), async (_req, res) => {
  try {
    const cfg = await prisma.configuracaoPriorizacao.upsert({
      where:  { id: CONFIG_PRIORIZACAO_ID },
      update: {},
      create: { id: CONFIG_PRIORIZACAO_ID, prazoAltaDias: 7, prazoMediaDias: 30, tetoCapacidadeSinalPct: 95 },
      include: { updatedBy: { select: { id: true, name: true } } },
    });
    res.json(cfg);
  } catch (error) {
    console.error('GET config/priorizacao error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT / — edita os limiares. Só admin e chefe.
router.put('/', authenticate, requireRole('admin', 'chefe'), async (req: AuthRequest, res) => {
  try {
    const { prazoAltaDias, prazoMediaDias, tetoCapacidadeSinalPct } = req.body;
    const userId = req.user!.id;

    // ── Validações ────────────────────────────────────────────────────────
    if (
      typeof prazoAltaDias          !== 'number' || !Number.isInteger(prazoAltaDias) ||
      typeof prazoMediaDias         !== 'number' || !Number.isInteger(prazoMediaDias) ||
      typeof tetoCapacidadeSinalPct !== 'number' || !Number.isInteger(tetoCapacidadeSinalPct)
    ) {
      return res.status(400).json({ error: 'prazoAltaDias, prazoMediaDias e tetoCapacidadeSinalPct devem ser inteiros' });
    }
    if (prazoAltaDias < 1) {
      return res.status(400).json({ error: 'prazoAltaDias deve ser >= 1' });
    }
    if (prazoMediaDias <= prazoAltaDias) {
      return res.status(400).json({ error: 'prazoMediaDias deve ser maior que prazoAltaDias' });
    }
    if (tetoCapacidadeSinalPct < 1 || tetoCapacidadeSinalPct > 100) {
      return res.status(400).json({ error: 'tetoCapacidadeSinalPct deve estar entre 1 e 100' });
    }

    const cfg = await prisma.configuracaoPriorizacao.upsert({
      where:  { id: CONFIG_PRIORIZACAO_ID },
      update: { prazoAltaDias, prazoMediaDias, tetoCapacidadeSinalPct, updatedById: userId },
      create: { id: CONFIG_PRIORIZACAO_ID, prazoAltaDias, prazoMediaDias, tetoCapacidadeSinalPct, updatedById: userId },
      include: { updatedBy: { select: { id: true, name: true } } },
    });
    res.json(cfg);
  } catch (error) {
    console.error('PUT config/priorizacao error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
