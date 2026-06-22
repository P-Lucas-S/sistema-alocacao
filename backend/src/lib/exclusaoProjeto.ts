import { Prisma } from '@prisma/client';
import prisma from '../prisma.js';
import { mesEstaFechado } from '../routes/alocacoes.js';

const generateId = () => Math.random().toString(36).substring(2, 15);

// ── Pré-check (somente leitura) ─────────────────────────────────────────────
export type PrecheckExclusao =
  | { ok: false; motivo: 'nao_encontrado' }
  | { ok: false; motivo: 'mes_fechado'; mesesFechados: { ano: number; mes: number }[] }
  | { ok: true; totalAlocacoes: number; totalHoras: string; meses: { ano: number; mes: number }[] };

async function mesesDistintosDoProjeto(projetoId: string, alocacoes: { ano: number; mes: number }[]) {
  return [...new Set(alocacoes.map(a => `${a.ano}-${a.mes}`))]
    .map(s => { const [ano, mes] = s.split('-').map(Number); return { ano, mes }; })
    .sort((a, b) => a.ano - b.ano || a.mes - b.mes);
}

// Classifica o projeto: não encontrado / bloqueado por mês fechado / excluível.
// NÃO apaga nada — só lê e classifica. Precedência: mês fechado vence a
// contagem de confirmação (se há bloqueio, não oferece a contagem).
export async function precheckExclusao(projetoId: string): Promise<PrecheckExclusao> {
  const projeto = await prisma.projeto.findUnique({ where: { id: projetoId } });
  if (!projeto) return { ok: false, motivo: 'nao_encontrado' };

  const alocacoes = await prisma.alocacao.findMany({
    where: { projetoId },
    select: { ano: true, mes: true, horasPlanejadas: true },
  });

  const meses = await mesesDistintosDoProjeto(projetoId, alocacoes);

  const mesesFechados: { ano: number; mes: number }[] = [];
  for (const { ano, mes } of meses) {
    if (await mesEstaFechado(ano, mes)) mesesFechados.push({ ano, mes });
  }

  if (mesesFechados.length > 0) {
    return { ok: false, motivo: 'mes_fechado', mesesFechados };
  }

  const totalHoras = alocacoes.reduce((s, a) => s.plus(a.horasPlanejadas), new Prisma.Decimal(0));

  return {
    ok: true,
    totalAlocacoes: alocacoes.length,
    totalHoras: totalHoras.toString(),
    meses,
  };
}

// ── Erro identificável — permite o caller (rotas do passo 5c) distinguir
// "bloqueado por mês fechado" de qualquer outra falha da transação.
export class ExclusaoBloqueadaError extends Error {
  constructor(public readonly mesesFechados: { ano: number; mes: number }[]) {
    super('Exclusão bloqueada: há alocação em mês fechado');
    this.name = 'ExclusaoBloqueadaError';
  }
}

export interface ExecutarExclusaoParams {
  solicitanteId: string | null; // null = exclusão direta do chefe, sem pedido prévio
  aprovadorId:   string;        // o chefe que executa/aprova
  motivo:        string | null; // opcional
}

export interface ResultadoExclusao {
  excluido: true;
  codigo: string;
  totalAlocacoesApagadas: number;
}

// Cascata completa numa única transação interativa. Regra de ouro: valida
// TUDO (inclusive mês fechado, re-conferido sob a própria transação) antes de
// apagar qualquer coisa. Ordem: alocações (log 'removeu' ANTES de cada delete,
// 1:1) → micros → macros → prestações → grava a LÁPIDE (retrato pré-delete) →
// só então apaga o projeto. Se qualquer passo falhar, nada é apagado.
export async function executarExclusaoCascata(
  projetoId: string,
  { solicitanteId, aprovadorId, motivo }: ExecutarExclusaoParams,
): Promise<ResultadoExclusao> {
  return prisma.$transaction(async (tx) => {
    // ── Revalida projeto existe — sob a transação ───────────────────────────
    const projeto = await tx.projeto.findUniqueOrThrow({ where: { id: projetoId } });

    const alocacoes = await tx.alocacao.findMany({ where: { projetoId } });

    // ── Revalida mês fechado — sob a transação (tx, não o helper global) ────
    const meses = [...new Set(alocacoes.map(a => `${a.ano}-${a.mes}`))]
      .map(s => { const [ano, mes] = s.split('-').map(Number); return { ano, mes }; });

    const mesesFechados: { ano: number; mes: number }[] = [];
    for (const { ano, mes } of meses) {
      const fechado = await tx.fechamentoMensal.findUnique({
        where: { ano_mes: { ano, mes } },
        select: { id: true },
      });
      if (fechado) mesesFechados.push({ ano, mes });
    }
    if (mesesFechados.length > 0) {
      throw new ExclusaoBloqueadaError(mesesFechados);
    }

    // ── Retrato pra lápide — ANTES de apagar qualquer coisa ─────────────────
    const { codigo, nome, gestorId, criadoPorId, createdAt } = projeto;

    // ── Alocações: log 'removeu' (mesmo formato de DELETE /alocacoes/:id)
    // ANTES de cada delete — 1:1, nenhuma alocação some sem o log correspondente.
    for (const aloc of alocacoes) {
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
          usuarioId:       aprovadorId,
        },
      });
      await tx.alocacao.delete({ where: { id: aloc.id } });
    }

    // ── Micros → Macros → Prestações (ordem exigida pelas FKs RESTRICT) ─────
    await tx.microEntrega.deleteMany({ where: { macroEntrega: { projetoId } } });
    await tx.macroEntrega.deleteMany({ where: { projetoId } });
    await tx.prestacaoContas.deleteMany({ where: { projetoId } });

    // ── Lápide — gravada ANTES do delete do projeto ─────────────────────────
    await tx.projetoExcluido.create({
      data: {
        id:                  generateId(),
        codigo,
        nome,
        projetoIdOriginal:   projetoId,
        gestorIdOriginal:    gestorId,
        criadoPorIdOriginal: criadoPorId,
        solicitanteId,
        aprovadorId,
        motivo,
        criadoEmOriginal:    createdAt,
      },
    });

    // ── Por último, apaga o projeto ──────────────────────────────────────────
    await tx.projeto.delete({ where: { id: projetoId } });

    return { excluido: true as const, codigo, totalAlocacoesApagadas: alocacoes.length };
  });
}
