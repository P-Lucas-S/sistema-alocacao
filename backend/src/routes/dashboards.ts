import express from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prisma.js';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.js';
import { calcularPriorizacao } from './priorizacao.js';
import { carregarTarifas, resolverTarifa } from '../lib/tarifa.js';

const router = express.Router();

// ── GET /projetos — dashboard Projetos (fase D1) ──────────────────────────
// A priorização do P1, enriquecida com tamanho de equipe e custo planejado
// do mês. SÓ LEITURA — não toca alocação, teto, lock. Sem materialização:
// agrega sob demanda, reusando calcularPriorizacao (mesmo escopo de papel
// do P1) e lib/tarifa.ts (mesma resolução de tarifa da tela Custos),
// escopada ao mês do dashboard (não o acumulado que /relatorios/custos faz).
router.get('/projetos', authenticate, requireRole('admin', 'gestor', 'chefe', 'coordenacao', 'diretor'), async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const role   = req.user!.role;
    const { ano, mes } = req.query as { ano?: string; mes?: string };

    const anoN = parseInt(ano ?? String(new Date().getFullYear()));
    const mesN = parseInt(mes ?? String(new Date().getMonth() + 1));
    if (!anoN || anoN < 2020 || anoN > 2100) return res.status(400).json({ error: 'ano inválido' });
    if (!mesN || mesN < 1  || mesN > 12)     return res.status(400).json({ error: 'mes inválido' });

    const { itens, categoriaIdPorProjeto, colabsPorProjeto, alocsDoMes } =
      await calcularPriorizacao({ role, userId, ano: anoN, mes: mesN });

    if (itens.length === 0) return res.json([]);

    // ── Custo planejado do MÊS — horasPlanejadas x tarifa resolvida, MESMA
    // conta de /relatorios/custos (lib/tarifa.ts), escopada a este mês ───────
    const todosColabIds = [...new Set(alocsDoMes.map(a => a.colaboradorId))];

    const colaboradores = todosColabIds.length > 0
      ? await prisma.colaborador.findMany({
          where: { id: { in: todosColabIds } },
          select: { id: true, valorHora: true },
        })
      : [];
    const valorHoraPorColab = new Map(colaboradores.map(c => [c.id, c.valorHora]));

    const tarifasMap = await carregarTarifas(todosColabIds);

    // Agrega horasPlanejadas por (projetoId, colaboradorId) NO MÊS;
    // aproveita o mesmo loop pra acumular horasRealizadas por projeto.
    const horasPorProjetoColab = new Map<string, Map<string, Prisma.Decimal>>();
    const horasRealPorProjeto  = new Map<string, Prisma.Decimal>();
    for (const a of alocsDoMes) {
      if (!horasPorProjetoColab.has(a.projetoId)) horasPorProjetoColab.set(a.projetoId, new Map());
      const porColab = horasPorProjetoColab.get(a.projetoId)!;
      porColab.set(a.colaboradorId, (porColab.get(a.colaboradorId) ?? new Prisma.Decimal(0)).plus(a.horasPlanejadas));
      if (a.horasRealizadas != null) {
        horasRealPorProjeto.set(a.projetoId, (horasRealPorProjeto.get(a.projetoId) ?? new Prisma.Decimal(0)).plus(a.horasRealizadas));
      }
    }

    // horasPlanejadas totais por projeto no mês (soma dos colaboradores)
    const horasPlanejPorProjeto = new Map<string, Prisma.Decimal>();
    for (const [projetoId, porColab] of horasPorProjetoColab) {
      let soma = new Prisma.Decimal(0);
      for (const h of porColab.values()) soma = soma.plus(h);
      horasPlanejPorProjeto.set(projetoId, soma);
    }

    const custoPorProjeto = new Map<string, Prisma.Decimal | null>();
    for (const [projetoId, porColab] of horasPorProjetoColab) {
      const categoriaId = categoriaIdPorProjeto.get(projetoId) ?? null;
      let soma: Prisma.Decimal | null = null;
      for (const [colabId, horas] of porColab) {
        const valorHora = valorHoraPorColab.get(colabId) ?? null;
        const { valor } = resolverTarifa(tarifasMap, { id: colabId, valorHora }, categoriaId);
        if (valor == null) continue; // sem_tarifa — não soma essa parcela
        const parcela = horas.times(valor);
        soma = soma == null ? parcela : soma.plus(parcela);
      }
      custoPorProjeto.set(projetoId, soma);
    }

    // ── Enriquece, preservando a ordem já priorizada pelo P1 ────────────────
    const resultado = itens.map(item => {
      const custo      = custoPorProjeto.get(item.projetoId) ?? null;
      const horasReal  = horasRealPorProjeto.get(item.projetoId) ?? null;
      return {
        ...item,
        tamanhoEquipe:   colabsPorProjeto.get(item.projetoId)?.size ?? 0,
        custoPlanejado:  custo != null ? custo.toFixed(2) : null,
        horasPlanejadas: horasPlanejPorProjeto.get(item.projetoId)?.toString() ?? '0',
        // null = sem nenhum apontamento no mês (tratado como "sem apontamento" no frontend)
        horasRealizadas: (horasReal != null && horasReal.greaterThan(0)) ? horasReal.toString() : null,
      };
    });

    res.json(resultado);
  } catch (error) {
    console.error('Dashboard projetos error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
