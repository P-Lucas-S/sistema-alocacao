import express from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prisma.js';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.js';
import { carregarTarifas, resolverTarifa } from '../lib/tarifa.js';

const router = express.Router();

// ── GET /custos — custo total por projeto (todos os meses) ───────────────
// Gestor vê só os próprios projetos ativos; admin vê todos.
// Coordenação: 403 (requireRole não inclui o papel).
router.get('/custos', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const role   = req.user!.role;

    const projWhere = role === 'gestor'
      ? { gestorId: userId, status: 'ativo' }
      : { status: 'ativo' };

    const projetos = await prisma.projeto.findMany({
      where: projWhere,
      orderBy: { codigo: 'asc' },
      select: { id: true, codigo: true, nome: true, categoriaId: true },
    });

    if (projetos.length === 0) return res.json([]);

    const projetoIds = projetos.map(p => p.id);

    // Todas as alocações (todos os meses) destes projetos, com o valorHora do colaborador.
    const alocs = await prisma.alocacao.findMany({
      where: { projetoId: { in: projetoIds } },
      select: {
        projetoId: true,
        horasPlanejadas: true,
        colaborador: { select: { id: true, nome: true, valorHora: true } },
      },
    });

    // ── Agrega horas por (projetoId, colaboradorId) — em Decimal, sem drift ──
    type Agg = { nome: string; valorHora: Prisma.Decimal | null; horas: Prisma.Decimal };
    const byProjeto = new Map<string, Map<string, Agg>>();

    for (const a of alocs) {
      let colabMap = byProjeto.get(a.projetoId);
      if (!colabMap) { colabMap = new Map(); byProjeto.set(a.projetoId, colabMap); }

      const existing = colabMap.get(a.colaborador.id);
      if (existing) {
        existing.horas = existing.horas.plus(a.horasPlanejadas);
      } else {
        colabMap.set(a.colaborador.id, {
          nome:      a.colaborador.nome,
          valorHora: a.colaborador.valorHora,
          horas:     a.horasPlanejadas,
        });
      }
    }

    // ── Tarifas específicas (override por categoria) — 1 query, sem N+1 ──────
    const colaboradorIds = [...new Set(alocs.map(a => a.colaborador.id))];
    const tarifasMap = await carregarTarifas(colaboradorIds);

    const D0 = new Prisma.Decimal(0);

    const resultado = projetos.map(proj => {
      const colabMap = byProjeto.get(proj.id) ?? new Map<string, Agg>();

      const colaboradores = [...colabMap.entries()].map(([colabId, c]) => {
        const { valor, origem } = resolverTarifa(tarifasMap, { id: colabId, valorHora: c.valorHora }, proj.categoriaId);
        const custo = valor != null ? c.horas.times(valor) : null;
        return {
          nome:        c.nome,
          horasTotais: c.horas.toString(),
          valorHora:   valor != null ? valor.toString() : null,
          origem,
          custo:       custo != null ? custo.toFixed(2) : null,
        };
      });

      // Custo desc; sem tarifa vai pro fim
      colaboradores.sort((a, b) => {
        if (a.custo == null && b.custo == null) return 0;
        if (a.custo == null) return 1;
        if (b.custo == null) return -1;
        return new Prisma.Decimal(b.custo).comparedTo(new Prisma.Decimal(a.custo));
      });

      const custoTotal = colaboradores.reduce(
        (sum, c) => c.custo != null ? sum.plus(new Prisma.Decimal(c.custo)) : sum,
        D0,
      );

      return {
        id:         proj.id,
        codigo:     proj.codigo,
        nome:       proj.nome,
        custoTotal: custoTotal.toFixed(2),
        colaboradores,
      };
    });

    res.json(resultado);
  } catch (error) {
    console.error('Relatorio custos error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
