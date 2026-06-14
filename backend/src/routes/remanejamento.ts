import express from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prisma.js';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.js';

const router = express.Router();
const generateId = () => Math.random().toString(36).substring(2, 15);

async function mesEstaFechado(ano: number, mes: number): Promise<boolean> {
  const f = await prisma.fechamentoMensal.findUnique({
    where: { ano_mes: { ano, mes } },
    select: { id: true },
  });
  return f !== null;
}

const solicitacaoInclude = {
  colaborador:          { select: { nome: true } },
  projetoDestino:       { select: { codigo: true, nome: true } },
  macroEntregaDestino:  { select: { nome: true } },
  microEntregaDestino:  { select: { nome: true } },
  solicitante:          { select: { name: true } },
} as const;

// Agrega cessões e adiciona horasJaCedidas/horasRestantes a cada solicitação
async function comCessoes<T extends { id: string; horasSolicitadas: Prisma.Decimal }>(
  items: T[],
): Promise<(T & { horasJaCedidas: string; horasRestantes: string })[]> {
  if (items.length === 0) return [];

  const cessoes = await prisma.cessaoRemanejamento.findMany({
    where:  { solicitacaoId: { in: items.map(i => i.id) } },
    select: { solicitacaoId: true, horasCedidas: true },
  });

  const mapa = new Map<string, Prisma.Decimal>();
  for (const c of cessoes) {
    mapa.set(c.solicitacaoId, (mapa.get(c.solicitacaoId) ?? new Prisma.Decimal(0)).plus(c.horasCedidas));
  }

  return items.map(s => {
    const cedido = mapa.get(s.id) ?? new Prisma.Decimal(0);
    return {
      ...s,
      horasJaCedidas:  cedido.toString(),
      horasRestantes:  new Prisma.Decimal(s.horasSolicitadas).minus(cedido).toString(),
    };
  });
}

class CessaoError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly body: Record<string, unknown>,
  ) { super(body.error as string); this.name = 'CessaoError'; }
}

// ── POST /solicitacoes — criar solicitação de remanejamento ───────────────
router.post('/solicitacoes', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const role   = req.user!.role;

    const { colaboradorId, projetoDestinoId, macroEntregaDestinoId,
            microEntregaDestinoId, ano, mes, horasSolicitadas } = req.body;

    if (!colaboradorId || !projetoDestinoId || !macroEntregaDestinoId || !microEntregaDestinoId) {
      return res.status(400).json({ error: 'colaboradorId, projetoDestinoId, macroEntregaDestinoId e microEntregaDestinoId são obrigatórios' });
    }

    const anoN = parseInt(ano);
    const mesN = parseInt(mes);
    if (!anoN || anoN < 2020 || anoN > 2100) return res.status(400).json({ error: 'ano inválido (2020–2100)' });
    if (!mesN || mesN < 1  || mesN > 12)     return res.status(400).json({ error: 'mes inválido (1–12)' });

    let horas: Prisma.Decimal;
    try {
      horas = new Prisma.Decimal(horasSolicitadas);
      if (horas.lessThanOrEqualTo(0)) throw new Error();
    } catch {
      return res.status(400).json({ error: 'horasSolicitadas deve ser um número positivo' });
    }

    if (await mesEstaFechado(anoN, mesN)) {
      return res.status(409).json({ error: 'Mês fechado', mesFechado: true });
    }

    const colaborador = await prisma.colaborador.findUnique({ where: { id: colaboradorId } });
    if (!colaborador)       return res.status(404).json({ error: 'Colaborador não encontrado' });
    if (!colaborador.ativo) return res.status(400).json({ error: 'Colaborador está inativo' });

    const projeto = await prisma.projeto.findUnique({ where: { id: projetoDestinoId } });
    if (!projeto) return res.status(404).json({ error: 'Projeto destino não encontrado' });
    if (role !== 'admin' && projeto.gestorId !== userId) {
      return res.status(403).json({ error: 'Projeto destino não pertence ao solicitante' });
    }
    if (projeto.status !== 'ativo') {
      return res.status(400).json({ error: 'Projeto destino está arquivado' });
    }

    const macro = await prisma.macroEntrega.findFirst({
      where: { id: macroEntregaDestinoId, projetoId: projetoDestinoId },
    });
    if (!macro) return res.status(400).json({ error: 'MacroEntrega não pertence ao projeto informado' });

    const micro = await prisma.microEntrega.findFirst({
      where: { id: microEntregaDestinoId, macroEntregaId: macroEntregaDestinoId },
    });
    if (!micro) return res.status(400).json({ error: 'MicroEntrega não pertence à macro informada' });

    const solicitacao = await prisma.solicitacaoRemanejamento.create({
      data: {
        id:                   generateId(),
        solicitanteId:        userId,
        colaboradorId,
        projetoDestinoId,
        macroEntregaDestinoId,
        microEntregaDestinoId,
        ano:                  anoN,
        mes:                  mesN,
        horasSolicitadas:     horas,
        status:               'aberta',
      },
      include: solicitacaoInclude,
    });

    return res.status(201).json({ solicitacao });
  } catch (error) {
    console.error('Criar solicitação error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /solicitacoes — listar (minhas + broadcast de recebidas) ───────────
router.get('/solicitacoes', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const role   = req.user!.role;

    // minhas: qualquer status onde sou o solicitante
    const minhasRaw = await prisma.solicitacaoRemanejamento.findMany({
      where:   { solicitanteId: userId },
      orderBy: { createdAt: 'desc' },
      include: solicitacaoInclude,
    });

    // recebidas: 'aberta', não sou o solicitante
    // gestor: só as que tenho o colaborador alocado no mesmo mês (em algum projeto meu)
    // admin: todas as 'aberta' que não criei
    let recebidasRaw: typeof minhasRaw;

    if (role === 'admin') {
      recebidasRaw = await prisma.solicitacaoRemanejamento.findMany({
        where:   { status: 'aberta', NOT: { solicitanteId: userId } },
        orderBy: { createdAt: 'desc' },
        include: solicitacaoInclude,
      });
    } else {
      const meusColabMeses = await prisma.alocacao.findMany({
        where:  { projeto: { gestorId: userId } },
        select: { colaboradorId: true, ano: true, mes: true },
      });
      const chaveSet = new Set(
        meusColabMeses.map(a => `${a.colaboradorId}::${a.ano}::${a.mes}`),
      );

      const todasAbertas = await prisma.solicitacaoRemanejamento.findMany({
        where:   { status: 'aberta', NOT: { solicitanteId: userId } },
        orderBy: { createdAt: 'desc' },
        include: solicitacaoInclude,
      });

      recebidasRaw = todasAbertas.filter(s =>
        chaveSet.has(`${s.colaboradorId}::${s.ano}::${s.mes}`),
      );
    }

    const [minhas, recebidas] = await Promise.all([
      comCessoes(minhasRaw),
      comCessoes(recebidasRaw),
    ]);

    return res.json({ minhas, recebidas });
  } catch (error) {
    console.error('Listar solicitações error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /solicitacoes/:id/cessoes — transferir horas (net-zero) ──────────
router.post('/solicitacoes/:id/cessoes', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
  const solicitacaoId = req.params.id;
  const userId        = req.user!.id;
  const role          = req.user!.role;
  const { alocacaoOrigemId, horasCedidas, idempotencia } = req.body;

  if (!alocacaoOrigemId || !idempotencia) {
    return res.status(400).json({ error: 'alocacaoOrigemId e idempotencia são obrigatórios' });
  }
  let horasReq: Prisma.Decimal;
  try {
    horasReq = new Prisma.Decimal(horasCedidas);
    if (horasReq.lessThanOrEqualTo(0)) throw new Error();
  } catch {
    return res.status(400).json({ error: 'horasCedidas deve ser um número positivo' });
  }

  // Passo 1 — idempotência ANTES da transação
  const existingCessao = await prisma.cessaoRemanejamento.findUnique({ where: { idempotencia } });
  if (existingCessao) return res.status(200).json({ cessao: existingCessao, idempotente: true });

  try {
    // READ COMMITTED: cada leitura vê a última versão committed, sem snapshot MVCC.
    // Necessário para que B2 (que começou antes de B1 commitar) veja cessões e
    // alocação de destino criados por B1 — sem ER_CHECKREAD (MariaDB 1020).
    // O FOR UPDATE no colaborador ainda é o ponto de serialização entre cessões concorrentes.
    const result = await prisma.$transaction(async (tx) => {
      // a. Lê a solicitação
      const sol = await tx.solicitacaoRemanejamento.findUnique({ where: { id: solicitacaoId } });
      if (!sol) throw new CessaoError(404, { error: 'Solicitação não encontrada' });

      // b. Lock pessimista no colaborador — serializa com alocações normais e outras cessões
      await tx.$queryRaw`SELECT id FROM colaboradores WHERE id = ${sol.colaboradorId} FOR UPDATE`;

      // c. Sob o lock: relê status (READ COMMITTED → vê status committed por tx paralela)
      const solAtual = await tx.solicitacaoRemanejamento.findUnique({
        where:  { id: solicitacaoId },
        select: { status: true },
      });
      if (!solAtual || solAtual.status !== 'aberta') {
        throw new CessaoError(409, { error: 'Solicitação não está aberta' });
      }

      // d. Mês fechado?
      const fechadoRec = await tx.fechamentoMensal.findUnique({
        where: { ano_mes: { ano: sol.ano, mes: sol.mes } },
        select: { id: true },
      });
      if (fechadoRec) throw new CessaoError(409, { error: 'Mês fechado', mesFechado: true });

      // e. Lê e valida a alocação de origem
      const origem = await tx.alocacao.findUnique({ where: { id: alocacaoOrigemId } });
      if (!origem) throw new CessaoError(404, { error: 'Alocação de origem não encontrada' });

      const origemProjeto = await tx.projeto.findUnique({ where: { id: origem.projetoId }, select: { gestorId: true } });
      if (role !== 'admin' && origemProjeto!.gestorId !== userId) {
        throw new CessaoError(403, { error: 'Origem não é sua' });
      }
      if (origem.colaboradorId !== sol.colaboradorId) {
        throw new CessaoError(400, { error: 'Origem é de outro colaborador' });
      }
      if (origem.ano !== sol.ano || origem.mes !== sol.mes) {
        throw new CessaoError(400, { error: 'Origem é de outro mês/ano' });
      }

      // f. Origem == destino?
      if (
        origem.projetoId      === sol.projetoDestinoId &&
        origem.macroEntregaId === sol.macroEntregaDestinoId &&
        origem.microEntregaId === sol.microEntregaDestinoId
      ) {
        throw new CessaoError(400, { error: 'Origem e destino não podem ser a mesma alocação' });
      }

      // g. Soma cessões existentes (READ COMMITTED → vê cessões committed por tx paralela)
      const [{ total: totalCedidoRaw }] = await tx.$queryRaw<{ total: string }[]>`
        SELECT COALESCE(SUM(horas_cedidas), 0) AS total
        FROM cessoes_remanejamento
        WHERE solicitacao_id = ${solicitacaoId}
      `;
      const jasCedidas = new Prisma.Decimal(totalCedidoRaw ?? '0');
      const restante   = new Prisma.Decimal(sol.horasSolicitadas).minus(jasCedidas);
      if (restante.lessThanOrEqualTo(0)) {
        throw new CessaoError(409, { error: 'Solicitação já atendida' });
      }

      // h. Yreq = min(horasReq, restante); falta na origem é erro do cedente
      const Yreq    = Prisma.Decimal.min(horasReq, restante);
      const ajustado = !Yreq.equals(horasReq);
      if (origem.horasPlanejadas.lessThan(Yreq)) {
        throw new CessaoError(400, { error: `Origem não tem horas suficientes: tem ${origem.horasPlanejadas}` });
      }

      // i. Move horas NO BANCO via decrement/increment (nunca JS)
      const horasOrigemAntes = origem.horasPlanejadas;
      const origemAtualizada = await tx.alocacao.update({
        where: { id: alocacaoOrigemId },
        data:  { horasPlanejadas: { decrement: Yreq }, updatedById: userId },
      });

      // Lê destino (READ COMMITTED → vê alocação criada por cessão paralela que já commitou)
      const destinoExistente = await tx.alocacao.findUnique({
        where: {
          colaboradorId_projetoId_macroEntregaId_microEntregaId_ano_mes: {
            colaboradorId:  sol.colaboradorId,
            projetoId:      sol.projetoDestinoId,
            macroEntregaId: sol.macroEntregaDestinoId,
            microEntregaId: sol.microEntregaDestinoId,
            ano:            sol.ano,
            mes:            sol.mes,
          },
        },
        select: { id: true, horasPlanejadas: true },
      });
      const horasDestinoAntes = destinoExistente?.horasPlanejadas ?? null;

      let destinoId:        string;
      let horasDestinoDepois: Prisma.Decimal;

      if (destinoExistente) {
        const d = await tx.alocacao.update({
          where: { id: destinoExistente.id },
          data:  { horasPlanejadas: { increment: Yreq }, updatedById: userId },
        });
        destinoId          = destinoExistente.id;
        horasDestinoDepois = d.horasPlanejadas;
      } else {
        const d = await tx.alocacao.create({
          data: {
            id:              generateId(),
            colaboradorId:   sol.colaboradorId,
            projetoId:       sol.projetoDestinoId,
            macroEntregaId:  sol.macroEntregaDestinoId,
            microEntregaId:  sol.microEntregaDestinoId,
            ano:             sol.ano,
            mes:             sol.mes,
            horasPlanejadas: Yreq,
            createdById:     sol.solicitanteId,
            updatedById:     userId,
          },
        });
        destinoId          = d.id;
        horasDestinoDepois = d.horasPlanejadas;
      }

      // j. Insere CessaoRemanejamento
      const cessaoId = generateId();
      const cessao = await tx.cessaoRemanejamento.create({
        data: {
          id:                   cessaoId,
          solicitacaoId,
          gestorCedenteId:      userId,
          horasCedidas:         Yreq,
          idempotencia,
          alocacaoOrigemId,
          origemProjetoId:      origem.projetoId,
          origemMacroEntregaId: origem.macroEntregaId,
          origemMicroEntregaId: origem.microEntregaId,
        },
      });

      // k. Auditoria dos dois lados com cessaoId
      await tx.alocacaoLog.create({
        data: {
          id:              generateId(),
          alocacaoId:      alocacaoOrigemId,
          colaboradorId:   origem.colaboradorId,
          projetoId:       origem.projetoId,
          macroEntregaId:  origem.macroEntregaId,
          microEntregaId:  origem.microEntregaId,
          ano:             origem.ano,
          mes:             origem.mes,
          acao:            'alterou',
          horasAnteriores: horasOrigemAntes,
          horasNovas:      origemAtualizada.horasPlanejadas,
          usuarioId:       userId,
          cessaoId,
        },
      });
      await tx.alocacaoLog.create({
        data: {
          id:              generateId(),
          alocacaoId:      destinoId,
          colaboradorId:   sol.colaboradorId,
          projetoId:       sol.projetoDestinoId,
          macroEntregaId:  sol.macroEntregaDestinoId,
          microEntregaId:  sol.microEntregaDestinoId,
          ano:             sol.ano,
          mes:             sol.mes,
          acao:            destinoExistente ? 'alterou' : 'criou',
          horasAnteriores: horasDestinoAntes,
          horasNovas:      horasDestinoDepois,
          usuarioId:       userId,
          cessaoId,
        },
      });

      // l. Auto-fechar se solicitação atendida
      const totalCedido = jasCedidas.plus(Yreq);
      const atendida    = totalCedido.equals(new Prisma.Decimal(sol.horasSolicitadas));
      if (atendida) {
        await tx.solicitacaoRemanejamento.update({
          where: { id: solicitacaoId },
          data:  { status: 'atendida', fechadoEm: new Date(), fechadoPorId: null },
        });
      }

      return { cessao, atendida, ajustado, horasCedidasEfetivas: Yreq.toString() };
    }, { timeout: 15_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    return res.status(201).json(result);
  } catch (err: unknown) {
    if (err instanceof CessaoError) {
      return res.status(err.httpStatus).json(err.body);
    }
    // Guarda final de idempotência: unique constraint bateu dentro da tx (corrida rara)
    const pe = err as { code?: string };
    if (pe?.code === 'P2002') {
      const existente = await prisma.cessaoRemanejamento.findUnique({ where: { idempotencia } });
      if (existente) return res.status(200).json({ cessao: existente, idempotente: true });
    }
    console.error('Cessão error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /solicitacoes/:id/cancelar ──────────────────────────────────────
// Só o solicitante ou admin. Requer SEM cessões (se houver, use encerrar).
// Não checa mês fechado — não move horas.
router.post('/solicitacoes/:id/cancelar', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
  const solicitacaoId = req.params.id;
  const userId        = req.user!.id;
  const role          = req.user!.role;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // a. Lê a solicitação
      const sol = await tx.solicitacaoRemanejamento.findUnique({ where: { id: solicitacaoId } });
      if (!sol) throw new CessaoError(404, { error: 'Solicitação não encontrada' });

      // b. Ownership
      if (role !== 'admin' && sol.solicitanteId !== userId) {
        throw new CessaoError(403, { error: 'Apenas o solicitante ou admin pode cancelar' });
      }

      // c. Lock do colaborador — serializa com cessões concorrentes
      await tx.$queryRaw`SELECT id FROM colaboradores WHERE id = ${sol.colaboradorId} FOR UPDATE`;

      // d. Sob o lock: status deve ser 'aberta' (RC vê último committed)
      const solAtual = await tx.solicitacaoRemanejamento.findUnique({
        where:  { id: solicitacaoId },
        select: { status: true },
      });
      if (!solAtual || solAtual.status !== 'aberta') {
        throw new CessaoError(409, { error: 'Solicitação não está aberta' });
      }

      // e. Nenhuma cessão pode ter passado
      const [{ total: totalCedidoRaw }] = await tx.$queryRaw<{ total: string }[]>`
        SELECT COALESCE(SUM(horas_cedidas), 0) AS total
        FROM cessoes_remanejamento
        WHERE solicitacao_id = ${solicitacaoId}
      `;
      if (new Prisma.Decimal(totalCedidoRaw ?? '0').greaterThan(0)) {
        throw new CessaoError(409, { error: 'Solicitação já tem cessões; use encerrar' });
      }

      // f. Fecha como 'cancelada'
      return tx.solicitacaoRemanejamento.update({
        where:   { id: solicitacaoId },
        data:    { status: 'cancelada', fechadoEm: new Date(), fechadoPorId: userId },
        include: solicitacaoInclude,
      });
    }, { timeout: 15_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    return res.json({ solicitacao: result });
  } catch (err: unknown) {
    if (err instanceof CessaoError) return res.status(err.httpStatus).json(err.body);
    console.error('Cancelar error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /solicitacoes/:id/encerrar ──────────────────────────────────────
// Só o solicitante ou admin. Requer COM cessões (se não houver, use cancelar).
// As horas já cedidas ficam. Não checa mês fechado — não move horas.
router.post('/solicitacoes/:id/encerrar', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
  const solicitacaoId = req.params.id;
  const userId        = req.user!.id;
  const role          = req.user!.role;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // a. Lê a solicitação
      const sol = await tx.solicitacaoRemanejamento.findUnique({ where: { id: solicitacaoId } });
      if (!sol) throw new CessaoError(404, { error: 'Solicitação não encontrada' });

      // b. Ownership
      if (role !== 'admin' && sol.solicitanteId !== userId) {
        throw new CessaoError(403, { error: 'Apenas o solicitante ou admin pode encerrar' });
      }

      // c. Lock do colaborador — serializa com cessões concorrentes
      await tx.$queryRaw`SELECT id FROM colaboradores WHERE id = ${sol.colaboradorId} FOR UPDATE`;

      // d. Sob o lock: status deve ser 'aberta'
      const solAtual = await tx.solicitacaoRemanejamento.findUnique({
        where:  { id: solicitacaoId },
        select: { status: true },
      });
      if (!solAtual || solAtual.status !== 'aberta') {
        throw new CessaoError(409, { error: 'Solicitação não está aberta' });
      }

      // e. Exige ao menos uma cessão (se não houver, use cancelar)
      const [{ total: totalCedidoRaw }] = await tx.$queryRaw<{ total: string }[]>`
        SELECT COALESCE(SUM(horas_cedidas), 0) AS total
        FROM cessoes_remanejamento
        WHERE solicitacao_id = ${solicitacaoId}
      `;
      if (new Prisma.Decimal(totalCedidoRaw ?? '0').lessThanOrEqualTo(0)) {
        throw new CessaoError(409, { error: 'Nenhuma cessão ainda; use cancelar' });
      }

      // f. Fecha como 'encerrada_parcial' — horas cedidas ficam definitivas
      return tx.solicitacaoRemanejamento.update({
        where:   { id: solicitacaoId },
        data:    { status: 'encerrada_parcial', fechadoEm: new Date(), fechadoPorId: userId },
        include: solicitacaoInclude,
      });
    }, { timeout: 15_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    return res.json({ solicitacao: result });
  } catch (err: unknown) {
    if (err instanceof CessaoError) return res.status(err.httpStatus).json(err.body);
    console.error('Encerrar error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
