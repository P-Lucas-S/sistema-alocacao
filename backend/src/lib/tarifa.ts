import { Prisma } from '@prisma/client';
import prisma from '../prisma.js';

export type OrigemTarifa = 'especifica' | 'padrao' | 'sem_tarifa';

export interface TarifaResolvida {
  valor: Prisma.Decimal | null;
  origem: OrigemTarifa;
}

// colaboradorId -> categoriaId -> valorHora (override específico)
export type TarifaMap = Map<string, Map<string, Prisma.Decimal>>;

// Carrega TODAS as tarifas específicas dos colaboradores informados de uma vez
// (1 query) — evita N+1 quando resolvido linha a linha depois.
export async function carregarTarifas(colaboradorIds: string[]): Promise<TarifaMap> {
  const map: TarifaMap = new Map();
  if (colaboradorIds.length === 0) return map;

  const rows = await prisma.tarifaColaborador.findMany({
    where: { colaboradorId: { in: colaboradorIds } },
    select: { colaboradorId: true, categoriaId: true, valorHora: true },
  });

  for (const r of rows) {
    let porCategoria = map.get(r.colaboradorId);
    if (!porCategoria) { porCategoria = new Map(); map.set(r.colaboradorId, porCategoria); }
    porCategoria.set(r.categoriaId, r.valorHora);
  }

  return map;
}

// Resolve a tarifa de um colaborador para a categoria de um projeto:
//   1) override específico (colaborador + categoria), se existir
//   2) senão, o valorHora padrão do colaborador, se existir
//   3) senão, sem tarifa (defensivo — não soma, fica marcado)
export function resolverTarifa(
  tarifas: TarifaMap,
  colaborador: { id: string; valorHora: Prisma.Decimal | null },
  categoriaId: string | null,
): TarifaResolvida {
  if (categoriaId) {
    const override = tarifas.get(colaborador.id)?.get(categoriaId);
    if (override != null) {
      return { valor: override, origem: 'especifica' };
    }
  }

  if (colaborador.valorHora != null) {
    return { valor: colaborador.valorHora, origem: 'padrao' };
  }

  return { valor: null, origem: 'sem_tarifa' };
}
