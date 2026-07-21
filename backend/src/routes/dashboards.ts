import express from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prisma.js';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.js';
import { calcularPriorizacao, PriorizacaoItem } from './priorizacao.js';
import { carregarTarifas, resolverTarifa } from '../lib/tarifa.js';

const router = express.Router();

// ── GET /projetos — dashboard Projetos (fase D1) ──────────────────────────
// A priorização do P1, enriquecida com tamanho de equipe e custo planejado
// do mês. SÓ LEITURA — não toca alocação, teto, lock. Sem materialização:
// agrega sob demanda, reusando calcularPriorizacao (mesmo escopo de papel
// do P1) e lib/tarifa.ts (mesma resolução de tarifa da tela Custos),
// escopada ao mês do dashboard (não o acumulado que /relatorios/custos faz).
// Shape de resposta: { itens, pausados, totalPausados }
router.get('/projetos', authenticate, requireRole('admin', 'gestor', 'chefe', 'coordenacao', 'diretor'), async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const role   = req.user!.role;
    const { ano, mes, gestorId: gestorIdParam } = req.query as { ano?: string; mes?: string; gestorId?: string };

    const anoN = parseInt(ano ?? String(new Date().getFullYear()));
    const mesN = parseInt(mes ?? String(new Date().getMonth() + 1));
    if (!anoN || anoN < 2020 || anoN > 2100) return res.status(400).json({ error: 'ano inválido' });
    if (!mesN || mesN < 1  || mesN > 12)     return res.status(400).json({ error: 'mes inválido' });

    let gestorIdFiltro: string | undefined;
    let gestorNome: string | null = null;
    if (role !== 'gestor' && gestorIdParam) {
      const gestorAlvo = await prisma.user.findUnique({ where: { id: gestorIdParam }, select: { role: true, name: true } });
      if (!gestorAlvo || gestorAlvo.role !== 'gestor') {
        return res.status(400).json({ error: 'gestorId inválido ou não pertence a um usuário com papel gestor' });
      }
      gestorIdFiltro = gestorIdParam;
      gestorNome     = gestorAlvo.name;
    }

    const { itens, itensPausados, categoriaIdPorProjeto, colabsPorProjeto, alocsDoMes,
      colabsSobrecarregadosPorProjeto, gestorInfoPorProjeto, headcountAlocado, emSobrecarga, prazoAltaDias } =
      await calcularPriorizacao({ role, userId, ano: anoN, mes: mesN, gestorIdFiltro });

    // ── Diretor: SÓ agregados, nunca nomes de projeto/gestor/colaborador ────
    // (fase A-meio da auditoria — item 7: a tela dele já esconde a tabela,
    // mas o payload vinha completo; agora o recorte é no backend também).
    const CATS_ORDEM = ['alta', 'media', 'baixa', 'sem_prazo'] as const;

    if (itens.length === 0 && itensPausados.length === 0) {
      if (role === 'diretor') {
        return res.json({
          nTotal: 0,
          custoPorCategoria: CATS_ORDEM.map(categoria => ({ categoria, count: 0, custo: '0.00' })),
          nPrestac: 0,
          nSemApon: 0,
          totalPlan: '0.00',
          totalHorasPlan: '0',
          totalHorasReal: '0',
          headcountAlocado, emSobrecarga, totalPausados: 0, gestorNome,
        });
      }
      return res.json({ itens: [], pausados: [], totalPausados: 0, headcountAlocado, emSobrecarga });
    }

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

    // ── Nomes das categorias (programas de fomento) ──────────────────────────
    const categoriaIds = [...new Set(
      [...categoriaIdPorProjeto.values()].filter((id): id is string => id != null)
    )];
    const categorias = categoriaIds.length > 0
      ? await prisma.categoriaProjeto.findMany({
          where: { id: { in: categoriaIds } },
          select: { id: true, nome: true },
        })
      : [];
    const categoriaNomePorId = new Map(categorias.map(c => [c.id, c.nome]));

    // Agrega horasPlanejadas e horasRealizadas por (projetoId, colaboradorId) NO MÊS.
    const D0 = new Prisma.Decimal(0);
    const horasPorProjetoColab     = new Map<string, Map<string, Prisma.Decimal>>();
    const horasRealPorProjetoColab = new Map<string, Map<string, Prisma.Decimal>>();
    const horasRealPorProjeto      = new Map<string, Prisma.Decimal>();
    for (const a of alocsDoMes) {
      if (!horasPorProjetoColab.has(a.projetoId)) horasPorProjetoColab.set(a.projetoId, new Map());
      const porColab = horasPorProjetoColab.get(a.projetoId)!;
      porColab.set(a.colaboradorId, (porColab.get(a.colaboradorId) ?? D0).plus(a.horasPlanejadas));
      if (a.horasRealizadas != null) {
        horasRealPorProjeto.set(a.projetoId, (horasRealPorProjeto.get(a.projetoId) ?? D0).plus(a.horasRealizadas));
        if (!horasRealPorProjetoColab.has(a.projetoId)) horasRealPorProjetoColab.set(a.projetoId, new Map());
        const porColabReal = horasRealPorProjetoColab.get(a.projetoId)!;
        porColabReal.set(a.colaboradorId, (porColabReal.get(a.colaboradorId) ?? D0).plus(a.horasRealizadas));
      }
    }

    // horasPlanejadas totais por projeto no mês (soma dos colaboradores)
    const horasPlanejPorProjeto = new Map<string, Prisma.Decimal>();
    for (const [projetoId, porColab] of horasPorProjetoColab) {
      let soma = D0;
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
        if (valor == null) continue;
        soma = soma == null ? horas.times(valor) : soma.plus(horas.times(valor));
      }
      custoPorProjeto.set(projetoId, soma);
    }

    const custoRealPorProjeto = new Map<string, Prisma.Decimal | null>();
    for (const [projetoId, porColab] of horasRealPorProjetoColab) {
      const categoriaId = categoriaIdPorProjeto.get(projetoId) ?? null;
      let soma: Prisma.Decimal | null = null;
      for (const [colabId, horas] of porColab) {
        const valorHora = valorHoraPorColab.get(colabId) ?? null;
        const { valor } = resolverTarifa(tarifasMap, { id: colabId, valorHora }, categoriaId);
        if (valor == null) continue;
        soma = soma == null ? horas.times(valor) : soma.plus(horas.times(valor));
      }
      custoRealPorProjeto.set(projetoId, soma);
    }

    // ── Enriquece preservando a ordem do P1 ────────────────────────────────
    // Inclui gestorId para que o frontend possa checar ownership sem query extra.
    const enriquecer = (lista: PriorizacaoItem[]) => lista.map(item => {
      const custo      = custoPorProjeto.get(item.projetoId) ?? null;
      const custoReal  = custoRealPorProjeto.get(item.projetoId) ?? null;
      const horasReal  = horasRealPorProjeto.get(item.projetoId) ?? null;
      const gestorInfo = gestorInfoPorProjeto.get(item.projetoId);
      const categoriaId = categoriaIdPorProjeto.get(item.projetoId) ?? null;
      return {
        ...item,
        gestorId:         gestorInfo?.gestorId ?? null,
        tamanhoEquipe:    colabsPorProjeto.get(item.projetoId)?.size ?? 0,
        custoPlanejado:   custo != null ? custo.toFixed(2) : null,
        custoRealizado:   custoReal != null ? custoReal.toFixed(2) : null,
        horasPlanejadas:  horasPlanejPorProjeto.get(item.projetoId)?.toString() ?? '0',
        horasRealizadas:  (horasReal != null && horasReal.greaterThan(0)) ? horasReal.toString() : null,
        categoriaNome:    categoriaId ? (categoriaNomePorId.get(categoriaId) ?? null) : null,
        gestorNome:       gestorInfo?.gestorNome ?? null,
        qtdColabsGargalo: colabsSobrecarregadosPorProjeto.get(item.projetoId) ?? 0,
      };
    });

    const itensEnriquecidos    = enriquecer(itens);
    const pausadosEnriquecidos = enriquecer(itensPausados);

    if (role === 'diretor') {
      const todos  = [...itensEnriquecidos, ...pausadosEnriquecidos];
      const D0dec  = new Prisma.Decimal(0);

      const custoPorCategoria = CATS_ORDEM.map(categoria => {
        const doCat  = todos.filter(x => x.categoria === categoria);
        const custo  = doCat.reduce((s, x) => x.custoPlanejado != null ? s.plus(new Prisma.Decimal(x.custoPlanejado)) : s, D0dec);
        return { categoria, count: doCat.length, custo: custo.toFixed(2) };
      });

      const nPrestac = todos.filter(x =>
        x.diasAteVencimento !== null && x.diasAteVencimento >= 0 && x.diasAteVencimento <= prazoAltaDias
      ).length;
      const nSemApon = todos.filter(x => x.horasRealizadas === null).length;

      const totalPlanDec      = todos.reduce((s, x) => x.custoPlanejado != null ? s.plus(new Prisma.Decimal(x.custoPlanejado)) : s, D0dec);
      const totalHorasPlanDec = todos.reduce((s, x) => s.plus(new Prisma.Decimal(x.horasPlanejadas)), D0dec);
      const totalHorasRealDec = todos.reduce((s, x) => x.horasRealizadas != null ? s.plus(new Prisma.Decimal(x.horasRealizadas)) : s, D0dec);

      return res.json({
        nTotal: todos.length,
        custoPorCategoria,
        nPrestac,
        nSemApon,
        totalPlan:      totalPlanDec.toFixed(2),
        totalHorasPlan: totalHorasPlanDec.toString(),
        totalHorasReal: totalHorasRealDec.toString(),
        headcountAlocado, emSobrecarga,
        totalPausados: itensPausados.length,
        gestorNome,
      });
    }

    res.json({
      itens:            itensEnriquecidos,
      pausados:         pausadosEnriquecidos,
      totalPausados:    itensPausados.length,
      headcountAlocado,
      emSobrecarga,
    });
  } catch (error) {
    console.error('Dashboard projetos error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /capacidade — ocupação por colaborador (fase D3) ─────────────────────
// Planejado = totalPorColab (global, todos os gestores) — mesma base do saldo do grid.
// Realizado = realizadoPorColab (global, todos os gestores) — coerente com o planejado.
// Escopo de quem aparece: collabs com alocação nos projetos do papel/filtro vigente.
router.get('/capacidade', authenticate, requireRole('admin', 'gestor', 'chefe', 'coordenacao', 'diretor'), async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const role   = req.user!.role;
    const { ano, mes, gestorId: gestorIdParam } = req.query as { ano?: string; mes?: string; gestorId?: string };

    const anoN = parseInt(ano ?? String(new Date().getFullYear()));
    const mesN = parseInt(mes ?? String(new Date().getMonth() + 1));
    if (!anoN || anoN < 2020 || anoN > 2100) return res.status(400).json({ error: 'ano inválido' });
    if (!mesN || mesN < 1  || mesN > 12)     return res.status(400).json({ error: 'mes inválido' });

    let gestorIdFiltro: string | undefined;
    let gestorNome: string | null = null;

    if (role !== 'gestor' && gestorIdParam) {
      const gestorAlvo = await prisma.user.findUnique({
        where:  { id: gestorIdParam },
        select: { role: true, name: true },
      });
      if (!gestorAlvo || gestorAlvo.role !== 'gestor') {
        return res.status(400).json({ error: 'gestorId inválido ou não pertence a um usuário com papel gestor' });
      }
      gestorIdFiltro = gestorIdParam;
      gestorNome     = gestorAlvo.name;
    }

    const { todosColabIds, totalPorColab, realizadoPorColab, headcountAlocado, emSobrecarga } =
      await calcularPriorizacao({ role, userId, ano: anoN, mes: mesN, gestorIdFiltro });

    if (todosColabIds.length === 0) {
      if (role === 'diretor') {
        return res.json({
          contagensPorTier: { sobrecarregado: 0, saudavel: 0, ocioso: 0 },
          headcountAlocado: 0, emSobrecarga: 0, gestorNome,
        });
      }
      return res.json({ colaboradores: [], headcountAlocado: 0, emSobrecarga: 0, gestorNome });
    }

    const LIMIAR_SOBRE = 209;   // 95% × 220
    const LIMIAR_SAUD  = 110;   // 50% × 220

    const colaboradoresBd = await prisma.colaborador.findMany({
      where:  { id: { in: todosColabIds } },
      select: { id: true, nome: true, profissao: { select: { nome: true } } },
    });

    const colaboradores = colaboradoresBd.map(c => {
      const planN = totalPorColab.get(c.id)?.toNumber() ?? 0;
      const realN = realizadoPorColab.get(c.id)?.toNumber() ?? 0;
      const tier: 'sobrecarregado' | 'saudavel' | 'ocioso' =
        planN >= LIMIAR_SOBRE ? 'sobrecarregado' :
        planN >= LIMIAR_SAUD  ? 'saudavel'       : 'ocioso';
      return {
        id:              c.id,
        nome:            c.nome,
        profissao:       c.profissao?.nome ?? null,
        horasPlanejadas: String(planN),
        horasRealizadas: realN > 0 ? String(realN) : null,
        tier,
      };
    }).sort((a, b) => parseFloat(b.horasPlanejadas) - parseFloat(a.horasPlanejadas));

    // ── Diretor: só as contagens por tier, nunca o array com nomes ──────────
    if (role === 'diretor') {
      const contagensPorTier = { sobrecarregado: 0, saudavel: 0, ocioso: 0 };
      for (const c of colaboradores) contagensPorTier[c.tier]++;
      return res.json({ contagensPorTier, headcountAlocado, emSobrecarga, gestorNome });
    }

    res.json({ colaboradores, headcountAlocado, emSobrecarga, gestorNome });
  } catch (error) {
    console.error('Dashboard capacidade error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
