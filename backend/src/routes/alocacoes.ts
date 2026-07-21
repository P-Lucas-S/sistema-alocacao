import express from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prisma.js';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.js';
import { carregarTarifas, resolverTarifa } from '../lib/tarifa.js';

const router = express.Router();
const generateId = () => Math.random().toString(36).substring(2, 15);

// Teto global de horas planejadas por colaborador/mês — constante de negócio
// Exportada pra ser reusada por outras rotas que precisam da MESMA conta de
// saldo (ex.: priorizacao.ts, sinal de capacidade) — não redefinir 220 de novo.
export const TETO_HORAS_MES = new Prisma.Decimal(220);

// Limite de candidatos retornados por /candidatos
const MAX_CANDIDATOS = 20;

// ── Helper: verificar se um mês está fechado ──────────────────────────────────
// Exportado pra ser reusado por outras rotas que também precisam bloquear
// edição/remoção em mês fechado (ex.: macros.ts na exclusão em cascata).
export async function mesEstaFechado(ano: number, mes: number): Promise<boolean> {
  const f = await prisma.fechamentoMensal.findUnique({
    where: { ano_mes: { ano, mes } },
    select: { id: true },
  });
  return f !== null;
}

// ── Erro tipado para bloqueio de teto ─────────────────────────────────────
interface DistribuicaoItem {
  projeto_codigo: string;
  projeto_nome:   string;
  gestor_nome:    string;
  horas:          string;
}

class TetoBloqueioError extends Error {
  constructor(
    public readonly totalAlocado: Prisma.Decimal,
    public readonly horasSolicitadas: Prisma.Decimal,
    public readonly horasDisponiveis: Prisma.Decimal,
    public readonly distribuicao: DistribuicaoItem[],
  ) {
    super('Teto de horas excedido');
    this.name = 'TetoBloqueioError';
  }
}

// ── Núcleo transacional com lock ──────────────────────────────────────────
// Toda verificação de teto e gravação acontece aqui, dentro de uma
// única transação interativa. Nunca verifique fora da transação.
async function alocarComLock(params: {
  colaboradorId:  string;
  projetoId:      string;
  macroEntregaId: string;
  microEntregaId: string;
  ano:            number;
  mes:            number;
  horasPlanejadas: Prisma.Decimal;
  userId:         string;
}) {
  const { colaboradorId, projetoId, macroEntregaId, microEntregaId,
          ano, mes, horasPlanejadas, userId } = params;

  return prisma.$transaction(async (tx) => {
    // ── PASSO 1: Lock pessimista sobre o colaborador ─────────────────
    // SELECT ... FOR UPDATE adquire X-lock na linha do colaborador.
    // Qualquer outra transação que tente o mesmo FOR UPDATE vai ESPERAR
    // até este commit/rollback — serializando o acesso por colaborador.
    // O colaborador sempre existe (validamos antes), então há sempre
    // algo para travar — sem o problema do gap lock de linhas vazias.
    await tx.$queryRaw`
      SELECT id FROM colaboradores WHERE id = ${colaboradorId} FOR UPDATE
    `;

    // ── PASSO 2: Verificar se já existe alocação para este destino ────
    const chave = {
      colaboradorId_projetoId_macroEntregaId_microEntregaId_ano_mes: {
        colaboradorId, projetoId, macroEntregaId, microEntregaId, ano, mes,
      },
    };
    const existente = await tx.alocacao.findUnique({ where: chave });

    // ── PASSO 3: Somar horas já alocadas (excluindo a linha atual se edição)
    // LOCK IN SHARE MODE força leitura dos dados COMMITTED mais recentes,
    // não o snapshot MVCC do início da transação.
    // Sem isso, uma transação B que esperou A commitar ainda leria
    // os dados antigos (antes do commit de A), furando o teto.
    const somaQuery = existente
      ? Prisma.sql`
          SELECT COALESCE(SUM(horas_planejadas), 0) AS total
          FROM alocacoes
          WHERE colaborador_id = ${colaboradorId}
            AND ano = ${ano} AND mes = ${mes}
            AND id != ${existente.id}
          LOCK IN SHARE MODE`
      : Prisma.sql`
          SELECT COALESCE(SUM(horas_planejadas), 0) AS total
          FROM alocacoes
          WHERE colaborador_id = ${colaboradorId}
            AND ano = ${ano} AND mes = ${mes}
          LOCK IN SHARE MODE`;

    const [{ total }] = await tx.$queryRaw<{ total: string }[]>(somaQuery);
    const somaAtual = new Prisma.Decimal(total ?? '0');

    // ── PASSO 4: Verificar teto ───────────────────────────────────────
    if (somaAtual.plus(horasPlanejadas).greaterThan(TETO_HORAS_MES)) {
      const disponivel = Prisma.Decimal.max(
        TETO_HORAS_MES.minus(somaAtual),
        new Prisma.Decimal(0),
      );

      // Distribuição atual para informar o gestor de onde estão as horas
      const distribuicao = await tx.$queryRaw<DistribuicaoItem[]>`
        SELECT
          p.codigo  AS projeto_codigo,
          p.nome    AS projeto_nome,
          u.name    AS gestor_nome,
          SUM(a.horas_planejadas) AS horas
        FROM alocacoes a
        JOIN projetos p ON a.projeto_id = p.id
        JOIN users    u ON p.gestor_id  = u.id
        WHERE a.colaborador_id = ${colaboradorId}
          AND a.ano = ${ano} AND a.mes = ${mes}
        GROUP BY a.projeto_id, p.codigo, p.nome, u.name
        ORDER BY horas DESC
        LOCK IN SHARE MODE
      `;

      throw new TetoBloqueioError(somaAtual, horasPlanejadas, disponivel, distribuicao);
    }

    // ── PASSO 5: Gravar — dentro da mesma transação, com lock ainda ativo
    const alocacao = await tx.alocacao.upsert({
      where: chave,
      create: {
        id: generateId(),
        colaboradorId, projetoId, macroEntregaId, microEntregaId,
        ano, mes,
        horasPlanejadas,
        createdById: userId,
        updatedById: userId,
      },
      update: {
        horasPlanejadas,
        updatedById: userId,
      },
      include: {
        colaborador:  { select: { nome: true } },
        projeto:      { select: { codigo: true, nome: true } },
        macroEntrega: { select: { nome: true } },
        microEntrega: { select: { nome: true } },
      },
    });

    // ── PASSO 6: Gravar log de auditoria do planejado (mesma transação) ─
    const logAcao = !existente
      ? 'criou'
      : existente.horasPlanejadas.minus(horasPlanejadas).isZero() ? null : 'alterou';

    if (logAcao) {
      await tx.alocacaoLog.create({
        data: {
          id: generateId(),
          alocacaoId:     alocacao.id,
          colaboradorId,
          projetoId,
          macroEntregaId,
          microEntregaId,
          ano,
          mes,
          acao:            logAcao,
          horasAnteriores: existente?.horasPlanejadas ?? null,
          horasNovas:      horasPlanejadas,
          usuarioId:       userId,
        },
      });
    }

    return { alocacao, somaFinal: somaAtual.plus(horasPlanejadas) };
  }, { timeout: 15_000 }); // Prisma cancela a transação após 15s; o innodb_lock_wait_timeout padrão do MariaDB é 50s, então o Prisma vence primeiro em caso de espera longa
}

// ── GET /grid — dados do grid para o mês ─────────────────────────────────
// Retorna projetos (colunas) + linhas (colaboradores com alocação nos meus
// projetos naquele mês) + saldo real de cada colaborador no mês.
//
// Gestor vê apenas seus projetos como colunas.
// Saldo inclui horas de TODOS os gestores (totalGeral) para o cálculo correto
// do espaço disponível, mesmo que o gestor só possa editar as suas.
router.get('/grid', authenticate, requireRole('admin', 'gestor', 'chefe', 'coordenacao'), async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const role   = req.user!.role;
    const { ano, mes, gestorId: gestorIdParam } = req.query as { ano?: string; mes?: string; gestorId?: string };

    const anoN = parseInt(ano ?? String(new Date().getFullYear()));
    const mesN = parseInt(mes ?? String(new Date().getMonth() + 1));
    if (!anoN || anoN < 2020 || anoN > 2100) return res.status(400).json({ error: 'ano inválido' });
    if (!mesN || mesN < 1  || mesN > 12)     return res.status(400).json({ error: 'mes inválido' });

    let gestorIdFiltro: string | undefined;
    if (role !== 'gestor' && gestorIdParam) {
      const gestorAlvo = await prisma.user.findUnique({ where: { id: gestorIdParam }, select: { role: true } });
      if (!gestorAlvo || gestorAlvo.role !== 'gestor') {
        return res.status(400).json({ error: 'gestorId inválido ou não pertence a um usuário com papel gestor' });
      }
      gestorIdFiltro = gestorIdParam;
    }

    // ── Verifica se o mês está fechado ───────────────────────────────────
    const fechadoRecord = await prisma.fechamentoMensal.findUnique({
      where: { ano_mes: { ano: anoN, mes: mesN } },
      select: { id: true },
    });
    const fechado = fechadoRecord !== null;

    // ── Colunas: projetos do gestor (ou todos para admin) ─────────────────
    const projWhere = role === 'gestor'
      ? { gestorId: userId, status: 'ativo' }
      : gestorIdFiltro
        ? { gestorId: gestorIdFiltro, status: 'ativo' }
        : { status: 'ativo' };

    // Inclui a primeira macro (ordenada por createdAt) e sua micro "Geral"
    // para que as células vazias saibam onde gravar sem chamada extra.
    const projetosRaw = await prisma.projeto.findMany({
      where: projWhere,
      orderBy: { codigo: 'asc' },
      include: {
        macroEntregas: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          include: {
            microEntregas: {
              where: { nome: 'Geral' },
              orderBy: { createdAt: 'asc' },
              take: 1,
            },
          },
        },
      },
    });

    const projetos = projetosRaw.map(p => ({
      id: p.id,
      codigo: p.codigo,
      nome: p.nome,
      gestorId: p.gestorId,
      categoriaId: p.categoriaId,
      defaultMacroId: p.macroEntregas[0]?.id ?? null,
      defaultMicroId: p.macroEntregas[0]?.microEntregas[0]?.id ?? null,
      vigenciaInicio: p.vigenciaInicio?.toISOString() ?? null,
      vigenciaFim:    p.vigenciaFim?.toISOString()    ?? null,
    }));

    if (projetos.length === 0) return res.json({ projetos: [], linhas: [], fechado, custoPorProjeto: {} });

    const meusProjIds = new Set(projetos.map(p => p.id));

    // ── Alocações nos MEUS projetos este mês — define as linhas ──────────
    // Inclui macroEntrega e microEntrega para montar os detalhes do drawer.
    const minhasAlocs = await prisma.alocacao.findMany({
      where: { projetoId: { in: [...meusProjIds] }, ano: anoN, mes: mesN },
      include: {
        colaborador:  { select: { id: true, nome: true, profissao: { select: { id: true, nome: true } }, valorHora: true } },
        macroEntrega: { select: { nome: true } },
        microEntrega: { select: { nome: true } },
      },
    });

    if (minhasAlocs.length === 0) return res.json({ projetos, linhas: [], fechado, custoPorProjeto: {} });

    const colabIds = [...new Set(minhasAlocs.map(a => a.colaboradorId))];

    // ── TODAS as alocações desses colaboradores este mês (saldo real) ─────
    const todasAlocs = await prisma.alocacao.findMany({
      where: { colaboradorId: { in: colabIds }, ano: anoN, mes: mesN },
      select: {
        id: true, colaboradorId: true, projetoId: true,
        macroEntregaId: true, microEntregaId: true,
        horasPlanejadas: true,
      },
    });

    // ── Mapa colaboradorId → info de exibição ─────────────────────────────
    const colabInfo = new Map(minhasAlocs.map(a => [a.colaboradorId, a.colaborador]));

    // ── Agregação de celulas por (colabId, projId) ────────────────────────
    // Agrupa no código (não no BD) para ter acesso aos nomes de macro/micro
    // necessários para o drawer de detalhes.
    type DetalheCell = {
      alocacaoId:      string;
      macroNome:       string;
      microNome:       string;
      macroEntregaId:  string;
      microEntregaId:  string;
      horas:           string;
      horasRealizadas: string | null;
    };
    type CelulaAgregada = { totalHoras: Prisma.Decimal; totalRealizado: Prisma.Decimal | null; detalhes: DetalheCell[] };

    const celulasByColabProj = new Map<string, CelulaAgregada>();
    for (const aloc of minhasAlocs) {
      const k = `${aloc.colaboradorId}::${aloc.projetoId}`;
      if (!celulasByColabProj.has(k)) {
        celulasByColabProj.set(k, { totalHoras: new Prisma.Decimal(0), totalRealizado: null, detalhes: [] });
      }
      const entry = celulasByColabProj.get(k)!;
      entry.totalHoras = entry.totalHoras.plus(aloc.horasPlanejadas);
      entry.detalhes.push({
        alocacaoId:      aloc.id,
        macroNome:       aloc.macroEntrega.nome,
        microNome:       aloc.microEntrega.nome,
        macroEntregaId:  aloc.macroEntregaId,
        microEntregaId:  aloc.microEntregaId,
        horas:           aloc.horasPlanejadas.toString(),
        horasRealizadas: aloc.horasRealizadas != null ? aloc.horasRealizadas.toString() : null,
      });
      if (aloc.horasRealizadas != null) {
        entry.totalRealizado = (entry.totalRealizado ?? new Prisma.Decimal(0)).plus(aloc.horasRealizadas);
      }
    }

    // ── Categoria de cada projeto envolvido no saldo (inclui projetos de outros
    // gestores, que não vieram em `projetos`) — pro resolvedor de tarifa ──────
    const categoriaPorProjeto = new Map<string, string | null>();
    for (const proj of projetos) categoriaPorProjeto.set(proj.id, proj.categoriaId);

    const todosProjIdsEnvolvidos = [...new Set(todasAlocs.map(a => a.projetoId))];
    const projIdsSemCategoria = todosProjIdsEnvolvidos.filter(id => !categoriaPorProjeto.has(id));
    if (projIdsSemCategoria.length > 0) {
      const outrosProjetos = await prisma.projeto.findMany({
        where: { id: { in: projIdsSemCategoria } },
        select: { id: true, categoriaId: true },
      });
      for (const op of outrosProjetos) categoriaPorProjeto.set(op.id, op.categoriaId);
    }

    // ── Tarifas específicas (override por categoria) — 1 query, sem N+1 ──────
    const tarifasMap = await carregarTarifas(colabIds);

    // ── Construir linhas ──────────────────────────────────────────────────
    const D0   = new Prisma.Decimal(0);
    const TETO = new Prisma.Decimal(220);

    const linhas = colabIds.map(colabId => {
      const alocs = todasAlocs.filter(a => a.colaboradorId === colabId);

      const totalMeusProj = alocs
        .filter(a => meusProjIds.has(a.projetoId))
        .reduce((s, a) => s.plus(a.horasPlanejadas), D0);

      const totalOutros = alocs
        .filter(a => !meusProjIds.has(a.projetoId))
        .reduce((s, a) => s.plus(a.horasPlanejadas), D0);

      const totalGeral = totalMeusProj.plus(totalOutros);
      const disponivel = Prisma.Decimal.max(TETO.minus(totalGeral), D0);

      // celulas[projetoId] = { totalHoras, totalRealizado, detalhes[] } | null
      const celulas: Record<string, { totalHoras: string; totalRealizado: string | null; detalhes: DetalheCell[] } | null> = {};
      for (const proj of projetos) {
        const entry = celulasByColabProj.get(`${colabId}::${proj.id}`);
        celulas[proj.id] = entry
          ? {
              totalHoras:     entry.totalHoras.toString(),
              totalRealizado: entry.totalRealizado != null ? entry.totalRealizado.toString() : null,
              detalhes:       entry.detalhes,
            }
          : null;
      }

      const { valorHora, ...colaboradorOut } = colabInfo.get(colabId)!;

      // Custo no escopo desta grade: gestor vê só as próprias colunas; admin vê todas.
      // Soma POR PROJETO (não horas totais × 1 valor) — cada projeto usa a tarifa
      // resolvida pra (colaborador, categoria DAQUELE projeto): override específico,
      // senão o valorHora padrão, senão sem tarifa (não soma essa parcela).
      const horasPorProjeto = new Map<string, Prisma.Decimal>();
      for (const a of alocs) {
        if (role !== 'admin' && !meusProjIds.has(a.projetoId)) continue;
        horasPorProjeto.set(a.projetoId, (horasPorProjeto.get(a.projetoId) ?? D0).plus(a.horasPlanejadas));
      }

      let custoSoma: Prisma.Decimal | null = null;
      for (const [projId, horasNoProjeto] of horasPorProjeto) {
        const categoriaId = categoriaPorProjeto.get(projId) ?? null;
        const { valor } = resolverTarifa(tarifasMap, { id: colabId, valorHora }, categoriaId);
        if (valor == null) continue; // sem_tarifa — não soma essa parcela
        const parcela = horasNoProjeto.times(valor);
        custoSoma = custoSoma == null ? parcela : custoSoma.plus(parcela);
      }
      const custo = custoSoma != null ? custoSoma.toFixed(2) : null;

      return {
        colaborador: colaboradorOut,
        saldo: {
          totalMeusProj: totalMeusProj.toString(),
          totalOutros:   totalOutros.toString(),
          totalGeral:    totalGeral.toString(),
          disponivel:    disponivel.toString(),
          custo,
        },
        celulas,
      };
    });

    // Ordenar por nome do colaborador
    linhas.sort((a, b) => a.colaborador.nome.localeCompare(b.colaborador.nome, 'pt-BR'));

    // ── Custo total por projeto (coluna) ──────────────────────────────────
    // Soma, sobre os colaboradores da grade, de (horas na célula × tarifa resolvida
    // pra a categoria DESTE projeto — override específico, senão o padrão).
    // Colaborador sem tarifa (sem_tarifa) não contribui (não zera o projeto, só é pulado).
    // Sem distinção gestor/admin — é o custo da coluna inteira.
    const custoPorProjeto: Record<string, string | null> = {};
    for (const proj of projetos) {
      let soma: Prisma.Decimal | null = null;
      for (const colabId of colabIds) {
        const entry = celulasByColabProj.get(`${colabId}::${proj.id}`);
        if (!entry) continue;
        const colabValorHora = colabInfo.get(colabId)?.valorHora ?? null;
        const { valor } = resolverTarifa(tarifasMap, { id: colabId, valorHora: colabValorHora }, proj.categoriaId);
        if (valor == null) continue;
        const custoColab = entry.totalHoras.times(valor);
        soma = soma == null ? custoColab : soma.plus(custoColab);
      }
      custoPorProjeto[proj.id] = soma != null ? soma.toFixed(2) : null;
    }

    res.json({ projetos, linhas, fechado, custoPorProjeto });
  } catch (error) {
    console.error('Grid error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /candidatos — colaboradores ATIVOS de uma profissão, ainda NÃO ──────
// alocados por MIM (escopo igual ao do grid) naquele (ano,mes), com vaga
// (disponivel > 0). SÓ LEITURA — não grava nada, não usa lock (o lock entra
// no POST /alocacoes já existente, quando o gestor de fato alocar alguém).
router.get('/candidatos', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const role   = req.user!.role;
    const { profissaoId, ano, mes } = req.query as Record<string, string | undefined>;

    if (!profissaoId) return res.status(400).json({ error: 'profissaoId é obrigatório' });
    const anoN = parseInt(ano ?? '');
    const mesN = parseInt(mes ?? '');
    if (!anoN || anoN < 2020 || anoN > 2100) return res.status(400).json({ error: 'ano inválido' });
    if (!mesN || mesN < 1  || mesN > 12)     return res.status(400).json({ error: 'mes inválido' });

    // ── Escopo "meus projetos" — MESMO critério do GET /grid (projWhere) ────
    const projWhere = role === 'gestor'
      ? { gestorId: userId, status: 'ativo' }
      : { status: 'ativo' };
    const meusProjetos = await prisma.projeto.findMany({ where: projWhere, select: { id: true } });
    const meusProjIds = [...new Set(meusProjetos.map(p => p.id))];

    // ── Colaboradores ATIVOS da profissão ────────────────────────────────
    const colaboradoresDaProfissao = await prisma.colaborador.findMany({
      where: { profissaoId, ativo: true },
      select: {
        id: true, nome: true, email: true, valorHora: true,
        profissao: { select: { id: true, nome: true } },
      },
    });
    if (colaboradoresDaProfissao.length === 0) return res.json([]);

    const colabIds = colaboradoresDaProfissao.map(c => c.id);

    // ── Quem eu já aloquei nos MEUS projetos este mês — exclui da lista ─────
    const minhasAlocsDoMes = await prisma.alocacao.findMany({
      where: { colaboradorId: { in: colabIds }, projetoId: { in: meusProjIds }, ano: anoN, mes: mesN },
      select: { colaboradorId: true },
    });
    const jaAlocadosPorMim = new Set(minhasAlocsDoMes.map(a => a.colaboradorId));

    const candidatosBrutos = colaboradoresDaProfissao.filter(c => !jaAlocadosPorMim.has(c.id));
    if (candidatosBrutos.length === 0) return res.json([]);

    // ── totalAlocado = soma de TODAS as alocações (todos os gestores) no
    // (ano,mes) — MESMA conta do saldo do grid (TETO_HORAS_MES - total),
    // em lote (1 query), não N+1 ─────────────────────────────────────────
    const candidatoIds = candidatosBrutos.map(c => c.id);
    const todasAlocsDoMes = await prisma.alocacao.findMany({
      where: { colaboradorId: { in: candidatoIds }, ano: anoN, mes: mesN },
      select: { colaboradorId: true, horasPlanejadas: true },
    });

    const D0 = new Prisma.Decimal(0);
    const totalPorColab = new Map<string, Prisma.Decimal>();
    for (const a of todasAlocsDoMes) {
      totalPorColab.set(a.colaboradorId, (totalPorColab.get(a.colaboradorId) ?? D0).plus(a.horasPlanejadas));
    }

    const candidatos = candidatosBrutos
      .map(c => {
        const totalAlocado = totalPorColab.get(c.id) ?? D0;
        const disponivel   = Prisma.Decimal.max(TETO_HORAS_MES.minus(totalAlocado), D0);
        return {
          id:           c.id,
          nome:         c.nome,
          email:        c.email,
          profissao:    c.profissao,
          totalAlocado: totalAlocado.toString(),
          disponivelNum: disponivel, // só pra ordenar — removido antes de responder
          disponivel:   disponivel.toString(),
          valorHora:    c.valorHora != null ? c.valorHora.toString() : null,
        };
      })
      .filter(c => c.disponivelNum.greaterThan(D0))
      .sort((a, b) => b.disponivelNum.comparedTo(a.disponivelNum))
      .slice(0, MAX_CANDIDATOS)
      .map(({ disponivelNum, ...rest }) => rest);

    res.json(candidatos);
  } catch (error) {
    console.error('Candidatos error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /minhas-do-colaborador — alocações DO PRÓPRIO GESTOR para um colaborador/mês ──
// Usado no seletor de origem do modal de cessão.
// Admin: lista vazia (cessão pela UI é ação de gestor).
router.get('/minhas-do-colaborador', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const role   = req.user!.role;
    const { colaboradorId, ano, mes } = req.query as Record<string, string | undefined>;

    if (!colaboradorId) return res.status(400).json({ error: 'colaboradorId é obrigatório' });
    const anoN = parseInt(ano ?? '');
    const mesN = parseInt(mes ?? '');
    if (!anoN || anoN < 2020 || anoN > 2100) return res.status(400).json({ error: 'ano inválido' });
    if (!mesN || mesN < 1  || mesN > 12)     return res.status(400).json({ error: 'mes inválido' });

    if (role !== 'gestor') return res.json([]);

    const alocs = await prisma.alocacao.findMany({
      where: {
        colaboradorId,
        ano: anoN,
        mes: mesN,
        projeto: { gestorId: userId },
      },
      include: {
        projeto:      { select: { codigo: true, nome: true } },
        macroEntrega: { select: { nome: true } },
        microEntrega: { select: { nome: true } },
      },
      orderBy: [{ projeto: { codigo: 'asc' } }, { macroEntrega: { createdAt: 'asc' } }],
    });

    res.json(alocs.map(a => ({
      alocacaoId:      a.id,
      projetoCodigo:   a.projeto.codigo,
      projetoNome:     a.projeto.nome,
      macroNome:       a.macroEntrega.nome,
      microNome:       a.microEntrega.nome,
      horasPlanejadas: a.horasPlanejadas.toString(),
    })));
  } catch (error) {
    console.error('minhas-do-colaborador error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET / — lista alocações ───────────────────────────────────────────────
router.get('/', authenticate, requireRole('admin', 'gestor', 'chefe', 'coordenacao'), async (req: AuthRequest, res) => {
  try {
    const { colaboradorId, projetoId, ano, mes } = req.query as Record<string, string | undefined>;

    const where: Prisma.AlocacaoWhereInput = {};
    if (colaboradorId) where.colaboradorId = colaboradorId;
    if (projetoId)     where.projetoId     = projetoId;
    if (ano)           where.ano           = parseInt(ano);
    if (mes)           where.mes           = parseInt(mes);

    const alocacoes = await prisma.alocacao.findMany({
      where,
      orderBy: [{ ano: 'asc' }, { mes: 'asc' }],
      include: {
        colaborador:  { select: { nome: true, profissao: { select: { id: true, nome: true } } } },
        projeto:      { select: { codigo: true, nome: true, gestor: { select: { name: true } } } },
        macroEntrega: { select: { nome: true } },
        microEntrega: { select: { nome: true } },
        createdBy:    { select: { name: true } },
        updatedBy:    { select: { name: true } },
      },
    });

    res.json(alocacoes);
  } catch (error) {
    console.error('List alocacoes error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST / — cria ou atualiza alocação (upsert com lock) ─────────────────
router.post('/', authenticate, requireRole('admin', 'gestor', 'chefe'), async (req: AuthRequest, res) => {
  try {
    const { colaboradorId, projetoId, macroEntregaId, microEntregaId,
            ano, mes, horasPlanejadas } = req.body;
    const userId = req.user!.id;
    const role   = req.user!.role;

    // ── Validações de entrada ─────────────────────────────────────────
    if (!colaboradorId || !projetoId || !macroEntregaId || !microEntregaId) {
      return res.status(400).json({ error: 'colaboradorId, projetoId, macroEntregaId e microEntregaId são obrigatórios' });
    }
    const anoN = parseInt(ano);
    const mesN  = parseInt(mes);
    if (!anoN || anoN < 2020 || anoN > 2100) {
      return res.status(400).json({ error: 'ano inválido (2020–2100)' });
    }
    if (!mesN || mesN < 1 || mesN > 12) {
      return res.status(400).json({ error: 'mes inválido (1–12)' });
    }

    if (await mesEstaFechado(anoN, mesN)) {
      return res.status(409).json({ error: 'Mês fechado', mesFechado: true });
    }

    let horas: Prisma.Decimal;
    try {
      horas = new Prisma.Decimal(horasPlanejadas);
      if (horas.lessThanOrEqualTo(0)) throw new Error();
    } catch {
      return res.status(400).json({ error: 'horasPlanejadas deve ser um número positivo' });
    }

    // Colaborador ativo?
    const colaborador = await prisma.colaborador.findUnique({ where: { id: colaboradorId } });
    if (!colaborador)        return res.status(404).json({ error: 'Colaborador não encontrado' });
    if (!colaborador.ativo)  return res.status(400).json({ error: 'Colaborador está inativo' });

    // micro pertence a macro, que pertence ao projeto?
    const micro = await prisma.microEntrega.findFirst({
      where: { id: microEntregaId, macroEntregaId },
      include: { macroEntrega: true },
    });
    if (!micro)                              return res.status(400).json({ error: 'MicroEntrega não encontrada nesta macro' });
    if (micro.macroEntrega.projetoId !== projetoId) {
      return res.status(400).json({ error: 'MacroEntrega não pertence ao projeto informado' });
    }

    // ── Pre-check de posse — antes do lock, sem tocar na mecânica do lock/teto ──
    if (role === 'gestor') {
      const proj = await prisma.projeto.findUnique({ where: { id: projetoId }, select: { gestorId: true } });
      if (!proj || proj.gestorId !== userId) {
        return res.status(403).json({ error: 'Você não é o gestor deste projeto' });
      }
    }

    // ── Transação com lock ────────────────────────────────────────────
    const { alocacao, somaFinal } = await alocarComLock({
      colaboradorId, projetoId, macroEntregaId, microEntregaId,
      ano: anoN, mes: mesN, horasPlanejadas: horas, userId,
    });

    res.status(201).json({
      alocacao,
      somaFinalMes: somaFinal.toString(),
      horasRestantes: TETO_HORAS_MES.minus(somaFinal).toString(),
    });
  } catch (err) {
    if (err instanceof TetoBloqueioError) {
      return res.status(409).json({
        bloqueado:       true,
        totalAlocado:    err.totalAlocado.toString(),
        horasSolicitadas: err.horasSolicitadas.toString(),
        horasDisponiveis: err.horasDisponiveis.toString(),
        distribuicao: err.distribuicao.map(d => ({
          projetoCodigo: d.projeto_codigo,
          projetoNome:   d.projeto_nome,
          gestorNome:    d.gestor_nome,
          horas:         new Prisma.Decimal(d.horas ?? '0').toString(),
        })),
      });
    }
    console.error('Alocar error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /:id/realizado — atualiza horasRealizadas (sem teto, sem lock) ──
router.patch('/:id/realizado', authenticate, requireRole('admin', 'gestor', 'chefe'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const role   = req.user!.role;

    if (!('horasRealizadas' in req.body)) {
      return res.status(400).json({ error: 'horasRealizadas é obrigatório (número >= 0 ou null)' });
    }
    const { horasRealizadas } = req.body;

    let horas: Prisma.Decimal | null;
    if (horasRealizadas === null) {
      horas = null;
    } else {
      let decimal: Prisma.Decimal;
      try {
        decimal = new Prisma.Decimal(horasRealizadas);
      } catch {
        return res.status(400).json({ error: 'horasRealizadas deve ser um número >= 0 ou null' });
      }
      if (decimal.lessThan(0)) {
        return res.status(400).json({ error: 'horasRealizadas deve ser um número >= 0 ou null' });
      }
      if (decimal.greaterThan(new Prisma.Decimal('9999.99'))) {
        return res.status(400).json({ error: 'horasRealizadas não pode exceder 9999.99' });
      }
      horas = decimal;
    }

    const alocacao = await prisma.alocacao.findUnique({ where: { id } });
    if (!alocacao) return res.status(404).json({ error: 'Alocação não encontrada' });

    if (role === 'gestor') {
      const proj = await prisma.projeto.findUnique({ where: { id: alocacao.projetoId }, select: { gestorId: true } });
      if (!proj || proj.gestorId !== userId) {
        return res.status(403).json({ error: 'Você não é o gestor deste projeto' });
      }
    }

    if (await mesEstaFechado(alocacao.ano, alocacao.mes)) {
      return res.status(409).json({ error: 'Mês fechado', mesFechado: true });
    }

    const atualizada = await prisma.alocacao.update({
      where: { id },
      data: { horasRealizadas: horas, updatedById: userId },
    });

    res.json({ alocacao: atualizada });
  } catch (error) {
    console.error('Realizado patch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /copiar-realizado — copia horas_planejadas → horas_realizadas em massa ──
// Preenche SOMENTE onde horas_realizadas IS NULL.  Sem lock — realizado fora do teto.
router.post('/copiar-realizado', authenticate, requireRole('admin', 'gestor', 'chefe'), async (req: AuthRequest, res) => {
  try {
    const { ano, mes } = req.body;
    const userId = req.user!.id;
    const role   = req.user!.role;

    const anoN = parseInt(ano);
    const mesN = parseInt(mes);
    if (!anoN || anoN < 2020 || anoN > 2100) {
      return res.status(400).json({ error: 'ano inválido (2020–2100)' });
    }
    if (!mesN || mesN < 1 || mesN > 12) {
      return res.status(400).json({ error: 'mes inválido (1–12)' });
    }

    if (await mesEstaFechado(anoN, mesN)) {
      return res.status(409).json({ error: 'Mês fechado', mesFechado: true });
    }

    let atualizadas: number;
    // Chefe é tratado como admin aqui — sem restrição a "meus projetos"
    // (chefe não tem projetos próprios; o conceito que se aplica é gestorId).
    if (role === 'admin' || role === 'chefe') {
      atualizadas = await prisma.$executeRaw`
        UPDATE alocacoes
        SET horas_realizadas = horas_planejadas,
            updated_by_id    = ${userId},
            updated_at       = NOW()
        WHERE projeto_id IN (SELECT id FROM projetos WHERE status = 'ativo')
          AND ano              = ${anoN}
          AND mes              = ${mesN}
          AND horas_realizadas IS NULL
      `;
    } else {
      atualizadas = await prisma.$executeRaw`
        UPDATE alocacoes
        SET horas_realizadas = horas_planejadas,
            updated_by_id    = ${userId},
            updated_at       = NOW()
        WHERE projeto_id IN (SELECT id FROM projetos WHERE gestor_id = ${userId} AND status = 'ativo')
          AND ano              = ${anoN}
          AND mes              = ${mesN}
          AND horas_realizadas IS NULL
      `;
    }

    res.json({ atualizadas });
  } catch (error) {
    console.error('Copiar realizado error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /:id/log — histórico do planejado de uma alocação ────────────────
// Busca por alocacaoId na tabela de log; sobrevive à deleção da alocação.
router.get('/:id/log', authenticate, requireRole('admin', 'gestor'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const logs = await prisma.alocacaoLog.findMany({
      where:   { alocacaoId: id },
      orderBy: { criadoEm: 'desc' },
      include: { usuario: { select: { name: true } } },
    });
    res.json(logs);
  } catch (error) {
    console.error('Log alocacao error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /:id — remove alocação ─────────────────────────────────────────
router.delete('/:id', authenticate, requireRole('admin', 'gestor', 'chefe'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const role   = req.user!.role;
    const alocacao = await prisma.alocacao.findUnique({ where: { id } });
    if (!alocacao) return res.status(404).json({ error: 'Alocação não encontrada' });

    if (role === 'gestor') {
      const proj = await prisma.projeto.findUnique({ where: { id: alocacao.projetoId }, select: { gestorId: true } });
      if (!proj || proj.gestorId !== userId) {
        return res.status(403).json({ error: 'Você não é o gestor deste projeto' });
      }
    }

    if (await mesEstaFechado(alocacao.ano, alocacao.mes)) {
      return res.status(409).json({ error: 'Mês fechado', mesFechado: true });
    }

    await prisma.$transaction(async (tx) => {
      await tx.alocacao.delete({ where: { id } });
      await tx.alocacaoLog.create({
        data: {
          id:              generateId(),
          alocacaoId:      id,
          colaboradorId:   alocacao.colaboradorId,
          projetoId:       alocacao.projetoId,
          macroEntregaId:  alocacao.macroEntregaId,
          microEntregaId:  alocacao.microEntregaId,
          ano:             alocacao.ano,
          mes:             alocacao.mes,
          acao:            'removeu',
          horasAnteriores: alocacao.horasPlanejadas,
          horasNovas:      null,
          usuarioId:       userId,
        },
      });
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete alocacao error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
