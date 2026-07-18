#!/usr/bin/env node
/**
 * bench-dashboards.mjs  —  Teste de carga para queries dos dashboards.
 *
 * Uso:
 *   node bench-dashboards.mjs           popula + mede + limpa
 *   node bench-dashboards.mjs --limpar  só apaga os dados bench
 *   node bench-dashboards.mjs --medir   só mede (dados já no banco)
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { performance } from 'perf_hooks';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dir, '.env') });

const prisma = new PrismaClient({ log: [] });

// ── Parâmetros do bench ───────────────────────────────────────────────────────
const ANO            = 2026;
const MES            = 6;           // mês medido
const N_PROJ         = 200;
const N_COLABS       = 200;
const N_RUNS         = 7;           // execuções por query
const PROJ_POR_COLAB = 6;           // 6 × 35h = 210h < teto 220h
const H_POR_PROJ     = 35;

const GESTORES      = ['seed-gestor-001', 'seed-gestor-002', 'seed-gestor-003'];
const ADMIN_ID      = 'seed-admin-001';
const GESTOR_SAMPLE = GESTORES[0];  // ≈ 67 projetos dos 200

// ── ID helpers ────────────────────────────────────────────────────────────────
const pad = (n, w = 3) => String(n).padStart(w, '0');
const pid = n => `bench-p-${pad(n)}`;
const cid = n => `bench-c-${pad(n)}`;
const mid = n => `bench-m-${pad(n)}`;
const uid = n => `bench-u-${pad(n)}`;

// ── LCG seeded PRNG ───────────────────────────────────────────────────────────
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = ((s * 1664525) + 1013904223) >>> 0; return s / 0xFFFFFFFF; };
}

// ── Timing ────────────────────────────────────────────────────────────────────
async function cronometrar(fn, n = N_RUNS) {
  const ts = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn();
    ts.push(performance.now() - t0);
  }
  const sorted = [...ts].sort((a, b) => a - b);
  return {
    media:   ts.reduce((s, v) => s + v, 0) / ts.length,
    mediana: sorted[Math.floor(sorted.length / 2)],
    melhor:  sorted[0],
    pior:    sorted[sorted.length - 1],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POPULAR
// ─────────────────────────────────────────────────────────────────────────────
async function popularBench() {
  const existing = await prisma.projeto.count({ where: { codigo: { startsWith: 'BENCH-' } } });
  if (existing > 0) {
    console.log(`\n✓ Dados bench já existem (${existing} projetos) — indo direto para medição.\n`);
    return;
  }

  const catId = (await prisma.categoriaProjeto.findFirst({ where: { ativo: true } }))?.id ?? null;
  const now   = new Date();
  const t0    = Date.now();
  console.log('\n📦 Populando banco bench...');

  // 1. Colaboradores
  await prisma.colaborador.createMany({
    skipDuplicates: true,
    data: Array.from({ length: N_COLABS }, (_, i) => ({
      id:          cid(i + 1),
      nome:        `Bench Colab ${pad(i + 1)}`,
      email:       `bench-c${pad(i + 1)}@bench.local`,
      valorHora:   new Prisma.Decimal(50 + (i % 10) * 10),  // 50–140 /h
      ativo:       true,
      createdById: ADMIN_ID,
      updatedAt:   now,
    })),
  });
  console.log(`  ✓ ${N_COLABS} colaboradores`);

  // 2. Projetos
  await prisma.projeto.createMany({
    skipDuplicates: true,
    data: Array.from({ length: N_PROJ }, (_, i) => ({
      id:          pid(i + 1),
      codigo:      `BENCH-${pad(i + 1)}`,
      nome:        `Projeto Bench ${pad(i + 1)}`,
      gestorId:    GESTORES[i % GESTORES.length],
      criadoPorId: ADMIN_ID,
      categoriaId: catId,
      status:      'ativo',
      updatedAt:   now,
    })),
  });
  console.log(`  ✓ ${N_PROJ} projetos (≈${Math.round(N_PROJ / GESTORES.length)} por gestor)`);

  // 3. MacroEntregas (1 "Geral" por projeto)
  await prisma.macroEntrega.createMany({
    skipDuplicates: true,
    data: Array.from({ length: N_PROJ }, (_, i) => ({
      id:        mid(i + 1),
      projetoId: pid(i + 1),
      nome:      'Geral',
      updatedAt: now,
    })),
  });

  // 4. MicroEntregas (1 "Geral" por macro)
  await prisma.microEntrega.createMany({
    skipDuplicates: true,
    data: Array.from({ length: N_PROJ }, (_, i) => ({
      id:             uid(i + 1),
      macroEntregaId: mid(i + 1),
      nome:           'Geral',
      updatedAt:      now,
    })),
  });
  console.log(`  ✓ ${N_PROJ} macros + ${N_PROJ} micros`);

  // 5. Alocações (12 meses × N_COLABS × PROJ_POR_COLAB)
  let totalAloc = 0;
  for (const mes of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    const batch = [];
    for (let c = 1; c <= N_COLABS; c++) {
      const r   = rng(c * 1031 + mes * 17 + ANO * 3);
      const set = new Set();
      while (set.size < PROJ_POR_COLAB) set.add(Math.floor(r() * N_PROJ) + 1);
      for (const pn of set) {
        batch.push({
          id:              `bench-a-${ANO}-${mes}-${c}-${pn}`,
          colaboradorId:   cid(c),
          projetoId:       pid(pn),
          macroEntregaId:  mid(pn),
          microEntregaId:  uid(pn),
          ano:             ANO,
          mes,
          horasPlanejadas: new Prisma.Decimal(H_POR_PROJ),
          createdById:     ADMIN_ID,
          updatedById:     ADMIN_ID,
          updatedAt:       now,
        });
      }
    }
    for (let i = 0; i < batch.length; i += 5000) {
      await prisma.alocacao.createMany({ data: batch.slice(i, i + 5000), skipDuplicates: true });
    }
    totalAloc += batch.length;
    process.stdout.write(`  ✓ mês ${String(mes).padStart(2)}: ${batch.length} alocações\n`);
  }

  console.log(`\n✓ Pronto em ${((Date.now() - t0) / 1000).toFixed(1)}s | ${totalAloc} alocações (${N_COLABS}×${PROJ_POR_COLAB}×12)\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// QUERIES  (raw SQL — o que o dashboard executaria no banco)
// ─────────────────────────────────────────────────────────────────────────────

// (a) Dashboard Projetos: 1 linha por projeto/mês, com custo e sobrecarga
async function qDashProjetos(gestorId) {
  const gFiltro = gestorId ? `AND p.gestor_id = '${gestorId}'` : '';
  return prisma.$queryRawUnsafe(`
    SELECT
      p.id,
      p.codigo,
      CAST(COALESCE(SUM(a.horas_planejadas), 0) AS DECIMAL(10,2))                                             AS total_horas,
      COUNT(DISTINCT a.colaborador_id)                                                                         AS headcount,
      CAST(COALESCE(SUM(a.horas_planejadas * COALESCE(tc.valorHora, col.valor_hora, 0)), 0) AS DECIMAL(14,2)) AS custo_total,
      COUNT(DISTINCT CASE WHEN sub.total_mes >= 209 THEN a.colaborador_id END)                                 AS colabs_sobrecarga
    FROM projetos p
    LEFT JOIN alocacoes a
      ON  a.projeto_id = p.id AND a.ano = ${ANO} AND a.mes = ${MES}
    LEFT JOIN colaboradores col
      ON  col.id = a.colaborador_id
    LEFT JOIN tarifas_colaborador tc
      ON  tc.colaboradorId = a.colaborador_id AND tc.categoriaId = p.categoriaId
    LEFT JOIN (
      SELECT colaborador_id, SUM(horas_planejadas) AS total_mes
      FROM   alocacoes
      WHERE  ano = ${ANO} AND mes = ${MES} AND colaborador_id LIKE 'bench-c-%'
      GROUP  BY colaborador_id
    ) sub ON sub.colaborador_id = a.colaborador_id
    WHERE p.status = 'ativo' AND p.codigo LIKE 'BENCH-%' ${gFiltro}
    GROUP BY p.id, p.codigo, p.nome, p.gestor_id, p.categoriaId
  `);
}

// (b) Dashboard Capacidade: 1 linha por colaborador/mês
async function qDashCapacidade(gestorId) {
  if (gestorId) {
    return prisma.$queryRawUnsafe(`
      SELECT
        col.id,
        col.nome,
        CAST(COALESCE(SUM(a.horas_planejadas), 0) AS DECIMAL(10,2)) AS total_horas,
        COUNT(DISTINCT a.projeto_id)                                  AS num_projetos
      FROM colaboradores col
      INNER JOIN alocacoes a
        ON  a.colaborador_id = col.id AND a.ano = ${ANO} AND a.mes = ${MES}
      INNER JOIN projetos p
        ON  p.id = a.projeto_id AND p.gestor_id = '${gestorId}' AND p.codigo LIKE 'BENCH-%'
      WHERE col.id LIKE 'bench-c-%'
      GROUP BY col.id, col.nome
      ORDER BY total_horas DESC
    `);
  }
  return prisma.$queryRawUnsafe(`
    SELECT
      col.id,
      col.nome,
      CAST(COALESCE(SUM(a.horas_planejadas), 0) AS DECIMAL(10,2)) AS total_horas,
      COUNT(DISTINCT a.projeto_id)                                  AS num_projetos
    FROM colaboradores col
    LEFT JOIN alocacoes a
      ON  a.colaborador_id = col.id AND a.ano = ${ANO} AND a.mes = ${MES}
    WHERE col.id LIKE 'bench-c-%'
    GROUP BY col.id, col.nome
    ORDER BY total_horas DESC
  `);
}

// (c) Dashboard Geral: totais do mês
async function qDashGeral(gestorId) {
  const gFiltro = gestorId ? `AND p.gestor_id = '${gestorId}'` : '';
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(DISTINCT p.id)                                                                                       AS projetos_ativos,
      CAST(COALESCE(SUM(a.horas_planejadas), 0) AS DECIMAL(12,2))                                              AS total_horas,
      COUNT(DISTINCT a.colaborador_id)                                                                          AS headcount,
      CAST(COALESCE(SUM(a.horas_planejadas * COALESCE(tc.valorHora, col.valor_hora, 0)), 0) AS DECIMAL(16,2)) AS custo_total,
      COUNT(DISTINCT CASE WHEN sub.total_mes >= 209 THEN a.colaborador_id END)                                  AS sobrecarga
    FROM projetos p
    LEFT JOIN alocacoes a
      ON  a.projeto_id = p.id AND a.ano = ${ANO} AND a.mes = ${MES}
    LEFT JOIN colaboradores col
      ON  col.id = a.colaborador_id
    LEFT JOIN tarifas_colaborador tc
      ON  tc.colaboradorId = a.colaborador_id AND tc.categoriaId = p.categoriaId
    LEFT JOIN (
      SELECT colaborador_id, SUM(horas_planejadas) AS total_mes
      FROM   alocacoes
      WHERE  ano = ${ANO} AND mes = ${MES} AND colaborador_id LIKE 'bench-c-%'
      GROUP  BY colaborador_id
    ) sub ON sub.colaborador_id = a.colaborador_id
    WHERE p.status = 'ativo' AND p.codigo LIKE 'BENCH-%' ${gFiltro}
  `);
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// LIMPAR
// ─────────────────────────────────────────────────────────────────────────────
async function limparBench() {
  console.log('\n🧹 Limpando dados bench...\n');
  const antes = {
    alocacoes: await prisma.alocacao.count({ where: { colaboradorId: { startsWith: 'bench-c-' } } }),
    projetos:  await prisma.projeto.count({ where: { codigo: { startsWith: 'BENCH-' } } }),
    colabs:    await prisma.colaborador.count({ where: { id: { startsWith: 'bench-c-' } } }),
  };
  console.log(`  Antes  → projetos: ${antes.projetos} | colabs: ${antes.colabs} | alocações: ${antes.alocacoes}`);

  const r1 = await prisma.alocacao.deleteMany(   { where: { colaboradorId: { startsWith: 'bench-c-' } } });
  const r2 = await prisma.microEntrega.deleteMany({ where: { id: { startsWith: 'bench-u-' } } });
  const r3 = await prisma.macroEntrega.deleteMany({ where: { id: { startsWith: 'bench-m-' } } });
  const r4 = await prisma.projeto.deleteMany(     { where: { codigo: { startsWith: 'BENCH-' } } });
  const r5 = await prisma.colaborador.deleteMany( { where: { id: { startsWith: 'bench-c-' } } });

  const depois = {
    alocacoes: await prisma.alocacao.count({ where: { colaboradorId: { startsWith: 'bench-c-' } } }),
    projetos:  await prisma.projeto.count({ where: { codigo: { startsWith: 'BENCH-' } } }),
    colabs:    await prisma.colaborador.count({ where: { id: { startsWith: 'bench-c-' } } }),
  };

  console.log(`  Removidos → ${r1.count} alocações, ${r2.count} micros, ${r3.count} macros, ${r4.count} projetos, ${r5.count} colabs`);
  console.log(`  Depois   → projetos: ${depois.projetos} | colabs: ${depois.colabs} | alocações: ${depois.alocacoes}  ✓`);
}

// ─────────────────────────────────────────────────────────────────────────────
// RELATÓRIO
// ─────────────────────────────────────────────────────────────────────────────
function relatorio(volume, res) {
  const W = 72;
  const ms   = v  => `${v.toFixed(1).padStart(7)}ms`;
  const row  = (label, s) => `  ${label.padEnd(40)} ${ms(s.media)} ${ms(s.mediana)} ${ms(s.pior)}`;

  console.log('\n' + '═'.repeat(W));
  console.log('  BENCH — Dashboards sob demanda (sem tabelas de sumarização)');
  console.log('═'.repeat(W));
  console.log(`
  Volume criado:
    Projetos       : ${volume.projetos}  (${Math.round(volume.projetos / GESTORES.length)}/gestor)
    Colaboradores  : ${volume.colabs}
    Alocações/mês  : ${volume.alocMes}   (${N_COLABS}×${PROJ_POR_COLAB} proj/colab × ${H_POR_PROJ}h = ${PROJ_POR_COLAB * H_POR_PROJ}h/mês)
    Alocações total: ${volume.alocTotal}  (12 meses)
    Índice ativo   : (colaborador_id, ano, mes) em alocações
  `);

  console.log(`  ${'Query'.padEnd(40)} ${'Média'.padStart(8)} ${'Mediana'.padStart(8)} ${'Pior'.padStart(8)}`);
  console.log('  ' + '─'.repeat(68));

  console.log(row('Dash Projetos  — todos os gestores', res.dp_all));
  console.log(row(`Dash Projetos  — 1 gestor (~${Math.round(N_PROJ/GESTORES.length)} proj)`, res.dp_g));
  console.log('  ' + '─'.repeat(68));
  console.log(row('Dash Capacidade — todos colaboradores', res.dc_all));
  console.log(row('Dash Capacidade — 1 gestor (colabs dele)', res.dc_g));
  console.log('  ' + '─'.repeat(68));
  console.log(row('Dash Geral     — todos', res.dg_all));
  console.log(row('Dash Geral     — 1 gestor', res.dg_g));
  console.log('  ' + '─'.repeat(68));

  const piorAbs  = Math.max(...Object.values(res).map(s => s.pior));
  const mediaMax = Math.max(...Object.values(res).map(s => s.media));

  console.log('\n  VEREDICTO (baseado no pior caso entre todas as queries):');
  if (piorAbs < 50) {
    console.log(`  ✅  Excelente — pior caso: ${piorAbs.toFixed(1)}ms. Sem sumarização necessária.`);
  } else if (piorAbs < 200) {
    console.log(`  ✅  Bom — pior caso: ${piorAbs.toFixed(1)}ms. Sumarização dispensável nesta escala.`);
  } else if (piorAbs < 1000) {
    console.log(`  ⚠️   Aceitável — pior caso: ${piorAbs.toFixed(1)}ms. Monitorar ao escalar; sumarização opcional.`);
  } else {
    console.log(`  ❌  Lento — pior caso: ${piorAbs.toFixed(1)}ms. Sumarização recomendada.`);
  }
  console.log('\n' + '═'.repeat(W) + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const args     = process.argv.slice(2);
  const sóLimpar = args.includes('--limpar');
  const sóMedir  = args.includes('--medir');

  if (sóLimpar) { await limparBench(); return; }

  if (!sóMedir) await popularBench();

  // Volume real no banco
  const [alocMes, alocTotal, projetos, colabs] = await Promise.all([
    prisma.alocacao.count({ where: { colaboradorId: { startsWith: 'bench-c-' }, ano: ANO, mes: MES } }),
    prisma.alocacao.count({ where: { colaboradorId: { startsWith: 'bench-c-' } } }),
    prisma.projeto.count({ where: { codigo: { startsWith: 'BENCH-' } } }),
    prisma.colaborador.count({ where: { id: { startsWith: 'bench-c-' } } }),
  ]);

  console.log(`\n⏱  Medindo (${N_RUNS} execuções/query, ano=${ANO} mês=${MES})...`);
  const res = {
    dp_all: await cronometrar(() => qDashProjetos()),
    dp_g:   await cronometrar(() => qDashProjetos(GESTOR_SAMPLE)),
    dc_all: await cronometrar(() => qDashCapacidade()),
    dc_g:   await cronometrar(() => qDashCapacidade(GESTOR_SAMPLE)),
    dg_all: await cronometrar(() => qDashGeral()),
    dg_g:   await cronometrar(() => qDashGeral(GESTOR_SAMPLE)),
  };

  relatorio({ projetos, colabs, alocMes, alocTotal }, res);

  if (!sóMedir) await limparBench();
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
