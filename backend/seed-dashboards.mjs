/**
 * seed-dashboards.mjs — Cenário rico para validação visual dos dashboards.
 *
 * SCRIPT NOVO (separado de seed-cenarios.mjs) porque:
 *   - seed-cenarios.mjs cobre F5/F6 (wizard + transbordo) — concern diferente
 *   - Prefixo DASH- não conflita com CEN-
 *   - Pode ser rodado/apagado independentemente sem afetar CEN- ou seed base
 *
 * Uso:  cd backend && node seed-dashboards.mjs
 * Idempotente: apaga DASH- projetos e dash-c* colaboradores antes de recriar.
 *
 * O que cria:
 *   8 colaboradores (dash-c1..c8) com perfis variados de capacidade
 *   17 projetos (16 ativos + 1 pausado) entre 3 gestores
 *   Alocações em mês atual com horasRealizadas variadas (apontamento real)
 *   Alocações adicionais no mês anterior e próximo (navegação de mês)
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// IDs fixos do seed padrão
const G1 = 'seed-gestor-001'; // gestor1 — perfil ALTO  (~83% apontamento)
const G2 = 'seed-gestor-002'; // gestor2 — perfil MÉDIO (~50% apontamento)
const G3 = 'seed-gestor-003'; // gestor3 — perfil BAIXO (~20% apontamento)

const CAT = {
  bndes:    'cat-bndes',
  embrapii: 'cat-embrapii',
  finep:    'cat-finep',
  senai:    'cat-senai',
  sebrae:   'cat-sebrae',
};

// ── Datas relativas a hoje (UTC midnight) ─────────────────────────────────────
const HOJE = new Date();
HOJE.setUTCHours(0, 0, 0, 0);
const ANO = HOJE.getUTCFullYear();
const MES = HOJE.getUTCMonth() + 1;

function addDias(n) {
  const d = new Date(HOJE);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Mês anterior e próximo
const MES_ANT = MES === 1  ? 12 : MES - 1;
const ANO_ANT = MES === 1  ? ANO - 1 : ANO;
const MES_PRO = MES === 12 ? 1  : MES + 1;
const ANO_PRO = MES === 12 ? ANO + 1 : ANO;

const MESES_ABR = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
function fmtMes(a, m) { return `${MESES_ABR[m - 1]}/${String(a).slice(2)}`; }

// ── Limpeza idempotente ───────────────────────────────────────────────────────
async function limpar() {
  // Projetos DASH-*
  const projs = await prisma.projeto.findMany({
    where: { codigo: { startsWith: 'DASH-' } },
    select: { id: true, codigo: true },
  });

  if (projs.length > 0) {
    const ids     = projs.map(p => p.id);
    const codigos = projs.map(p => p.codigo).join(', ');
    const macros  = await prisma.macroEntrega.findMany({ where: { projetoId: { in: ids } }, select: { id: true } });
    const mids    = macros.map(m => m.id);

    if (mids.length > 0) {
      await prisma.solicitacaoRemanejamento.deleteMany({ where: { macroEntregaDestinoId: { in: mids } } });
    }
    await prisma.solicitacaoRemanejamento.deleteMany({ where: { projetoDestinoId: { in: ids } } });
    await prisma.alocacao.deleteMany({ where: { projetoId: { in: ids } } });
    if (mids.length > 0) {
      await prisma.microEntrega.deleteMany({ where: { macroEntregaId: { in: mids } } });
    }
    await prisma.macroEntrega.deleteMany({ where: { projetoId: { in: ids } } });
    await prisma.projeto.deleteMany({ where: { id: { in: ids } } });
    console.log(`  projetos removidos: ${codigos}`);
  } else {
    console.log('  (nenhum projeto DASH- anterior)');
  }

  // Colaboradores dash-c*
  const colabs = await prisma.colaborador.findMany({
    where: { id: { startsWith: 'dash-c' } },
    select: { id: true },
  });
  if (colabs.length > 0) {
    const cids = colabs.map(c => c.id);
    await prisma.tarifaColaborador.deleteMany({ where: { colaboradorId: { in: cids } } });
    await prisma.colaborador.deleteMany({ where: { id: { in: cids } } });
    console.log(`  ${cids.length} colaboradores dash-c* removidos`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function criarMacro(projId) {
  const macroId = `${projId}-m1`;
  const microId = `${projId}-mi1`;
  await prisma.macroEntrega.create({ data: { id: macroId, projetoId: projId, nome: 'Macro', status: 'ativa' } });
  await prisma.microEntrega.create({ data: { id: microId, macroEntregaId: macroId, nome: 'Geral', status: 'pendente' } });
  return { macroId, microId };
}

async function criarProjeto({ id, codigo, nome, gestorId, categoriaId, valorTotal, fixado = false, pausado = false }) {
  await prisma.projeto.create({
    data: {
      id, codigo, nome,
      gestorId, criadoPorId: gestorId,
      categoriaId, status: 'ativo',
      valorTotal, valorOficial: 0, estrategiaOficial: 'proporcional',
      vigenciaInicio: new Date(`${ANO}-01-01`),
      vigenciaFim:    new Date(`${ANO}-12-31`),
      prioridadeFixada:  fixado,
      prioridadePausada: pausado,
    },
  });
  return criarMacro(id);
}

async function pc(projId, data) {
  await prisma.prestacaoContas.create({ data: { id: `${projId}-pc`, projetoId: projId, data: new Date(data) } });
}

// plan = horasPlanejadas, real = horasRealizadas (null = sem apontamento)
async function aloc(colabId, projId, macroId, microId, ano, mes, plan, real, gestorId) {
  // ID único: concatena chaves naturais
  const key = `${projId}-${colabId}-${ano}-${mes}`.replace(/dash-/g, '');
  await prisma.alocacao.create({
    data: {
      id: `da-${key}`,
      colaboradorId: colabId,
      projetoId: projId,
      macroEntregaId: macroId,
      microEntregaId: microId,
      ano, mes,
      horasPlanejadas: plan,
      horasRealizadas: real ?? null,
      createdById: gestorId,
      updatedById: gestorId,
    },
  });
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  const hoje = HOJE.toISOString().slice(0, 10);
  console.log('');
  console.log('══ seed-dashboards.mjs ═════════════════════════════════════════════════');
  console.log(`   Data atual  : ${hoje}`);
  console.log(`   Mês base    : ${fmtMes(ANO, MES)}`);
  console.log(`   Mês anterior: ${fmtMes(ANO_ANT, MES_ANT)}`);
  console.log(`   Mês próximo : ${fmtMes(ANO_PRO, MES_PRO)}`);
  console.log('');

  console.log('── Limpando dados anteriores (DASH-*, dash-c*)…');
  await limpar();
  console.log('');

  // Profissão: qualquer ativa do seed
  const prof = await prisma.profissao.findFirst({ where: { ativo: true } });
  if (!prof) throw new Error('Nenhuma profissão ativa. Rode o seed padrão primeiro.');

  // ── 8 novos colaboradores ─────────────────────────────────────────────────
  console.log('── Criando 8 colaboradores (dash-c1..c8)…');
  const colabsDef = [
    // Sobrecarregados: total ≥209h em Jul (c1: 80+130=210h; c2: 120+90=210h)
    { id: 'dash-c1', nome: 'Dash Colab Sobrecarregado A', email: 'dash.c1@dashtest.dev', valorHora: 85 },
    { id: 'dash-c2', nome: 'Dash Colab Sobrecarregado B', email: 'dash.c2@dashtest.dev', valorHora: 70 },
    // Saudáveis: 110–208h em Jul
    { id: 'dash-c3', nome: 'Dash Colab Saudável A',       email: 'dash.c3@dashtest.dev', valorHora: 90 },
    { id: 'dash-c4', nome: 'Dash Colab Saudável B',       email: 'dash.c4@dashtest.dev', valorHora: 75 },
    { id: 'dash-c5', nome: 'Dash Colab Saudável C',       email: 'dash.c5@dashtest.dev', valorHora: 60 },
    { id: 'dash-c8', nome: 'Dash Colab Saudável D',       email: 'dash.c8@dashtest.dev', valorHora: 80 },
    // Ociosos: <110h em Jul
    { id: 'dash-c6', nome: 'Dash Colab Ocioso A',         email: 'dash.c6@dashtest.dev', valorHora: 55 },
    { id: 'dash-c7', nome: 'Dash Colab Ocioso B',         email: 'dash.c7@dashtest.dev', valorHora: 65 },
  ];
  for (const c of colabsDef) {
    await prisma.colaborador.create({
      data: { ...c, profissaoId: prof.id, ativo: true, createdById: G1 },
    });
  }
  console.log('   ✓ 8 colaboradores criados');
  console.log('');

  // ─────────────────────────────────────────────────────────────────────────
  // DATAS DE PRESTAÇÃO (relativas a hoje)
  // Prazo padrão: alta ≤7d, media 8-30d, baixa >30d
  // ─────────────────────────────────────────────────────────────────────────
  const DT = {
    venc1:  addDias(-16), // Alta: vencida 16d atrás
    venc2:  addDias(-11), // Alta: vencida 11d atrás
    venc3:  addDias(-6),  // Alta: vencida 6d atrás
    alta0:  addDias(0),   // Alta: hoje (0d — dentro do limiar de 7d)
    alta2:  addDias(+2),  // Alta: +2d
    alta3:  addDias(+3),  // Alta: +3d
    alta6:  addDias(+6),  // Alta: +6d (beira do limiar)
    media15: addDias(+15), // Média: +15d
    media20: addDias(+20), // Média: +20d
    media25: addDias(+25), // Média: +25d
    baixa35: addDias(+35), // Baixa: +35d
    baixa40: addDias(+40), // Baixa: +40d (pausado)
    baixa51: addDias(+51), // Baixa: +51d
    baixa60: addDias(+60), // Baixa: +60d
    baixa86: addDias(+86), // Baixa: +86d
  };

  // ═════════════════════════════════════════════════════════════════════════
  // GESTOR 1 — perfil ALTO de apontamento  (5/6 projetos com realizado)
  // ═════════════════════════════════════════════════════════════════════════
  console.log('── Gestor 1 (perfil ALTO ~83%): 6 projetos');

  // G1-V1: Alta vencida -16d · BNDES · c1+c3 · ~90% realizado
  //   Jul: c1=80h(plan)/72h(real), c3=70h/63h
  //   Jun: c1=60h/54h, c3=60h/54h   (mês anterior com realizado)
  {
    const { macroId, microId } = await criarProjeto({ id: 'dash-g1-v1', codigo: 'DASH-G1-V1', nome: 'Dashboard G1 Vencido 1', gestorId: G1, categoriaId: CAT.bndes, valorTotal: 180_000 });
    await pc('dash-g1-v1', DT.venc1);
    await aloc('dash-c1', 'dash-g1-v1', macroId, microId, ANO, MES, 80, 72, G1);
    await aloc('dash-c3', 'dash-g1-v1', macroId, microId, ANO, MES, 70, 63, G1);
    await aloc('dash-c1', 'dash-g1-v1', macroId, microId, ANO_ANT, MES_ANT, 60, 54, G1);
    await aloc('dash-c3', 'dash-g1-v1', macroId, microId, ANO_ANT, MES_ANT, 60, 54, G1);
  }
  console.log('   ✓ DASH-G1-V1 | Alta vencida (-16d) | BNDES | c1+c3 | 90%');

  // G1-V2: Alta vencida -11d · EMBRAPII · c6 · ~85% realizado
  {
    const { macroId, microId } = await criarProjeto({ id: 'dash-g1-v2', codigo: 'DASH-G1-V2', nome: 'Dashboard G1 Vencido 2', gestorId: G1, categoriaId: CAT.embrapii, valorTotal: 95_000 });
    await pc('dash-g1-v2', DT.venc2);
    await aloc('dash-c6', 'dash-g1-v2', macroId, microId, ANO, MES, 80, 68, G1);
  }
  console.log('   ✓ DASH-G1-V2 | Alta vencida (-11d) | EMBRAPII | c6 | 85%');

  // G1-A1: Alta +2d · FINEP · c3 · ~95% realizado
  //   Ago: c3=80h/null (mês futuro)
  {
    const { macroId, microId } = await criarProjeto({ id: 'dash-g1-a1', codigo: 'DASH-G1-A1', nome: 'Dashboard G1 Alta 1', gestorId: G1, categoriaId: CAT.finep, valorTotal: 120_000 });
    await pc('dash-g1-a1', DT.alta2);
    await aloc('dash-c3', 'dash-g1-a1', macroId, microId, ANO, MES, 80, 76, G1);
    await aloc('dash-c3', 'dash-g1-a1', macroId, microId, ANO_PRO, MES_PRO, 80, null, G1);
  }
  console.log('   ✓ DASH-G1-A1 | Alta (+2d) | FINEP | c3 | 95%');

  // G1-M1: Média +15d · BNDES · c4 · ~82% realizado
  //   Ago: c4=90h/null
  {
    const { macroId, microId } = await criarProjeto({ id: 'dash-g1-m1', codigo: 'DASH-G1-M1', nome: 'Dashboard G1 Média 1', gestorId: G1, categoriaId: CAT.bndes, valorTotal: 75_000 });
    await pc('dash-g1-m1', DT.media15);
    await aloc('dash-c4', 'dash-g1-m1', macroId, microId, ANO, MES, 100, 82, G1);
    await aloc('dash-c4', 'dash-g1-m1', macroId, microId, ANO_PRO, MES_PRO, 90, null, G1);
  }
  console.log('   ✓ DASH-G1-M1 | Média (+15d) | BNDES | c4 | 82%');

  // G1-B1: Baixa +35d · SENAI · c4 · ~78% realizado
  {
    const { macroId, microId } = await criarProjeto({ id: 'dash-g1-b1', codigo: 'DASH-G1-B1', nome: 'Dashboard G1 Baixa 1', gestorId: G1, categoriaId: CAT.senai, valorTotal: 90_000 });
    await pc('dash-g1-b1', DT.baixa35);
    await aloc('dash-c4', 'dash-g1-b1', macroId, microId, ANO, MES, 60, 47, G1);
  }
  console.log('   ✓ DASH-G1-B1 | Baixa (+35d) | SENAI | c4 | 78%');

  // G1-SP: Sem Prazo · SEBRAE · sem alocações → null realizado (exceção do G1)
  {
    await criarProjeto({ id: 'dash-g1-sp', codigo: 'DASH-G1-SP', nome: 'Dashboard G1 Sem Prazo', gestorId: G1, categoriaId: CAT.sebrae, valorTotal: 60_000 });
    // sem prestacaoContas, sem alocações
  }
  console.log('   ✓ DASH-G1-SP | Sem prazo | SEBRAE | sem allocs | null');

  // ═════════════════════════════════════════════════════════════════════════
  // GESTOR 2 — perfil MÉDIO de apontamento  (3/6 projetos com realizado)
  // ═════════════════════════════════════════════════════════════════════════
  console.log('');
  console.log('── Gestor 2 (perfil MÉDIO ~50%): 6 projetos (1 pausado)');

  // G2-V1: Alta vencida -6d · SEBRAE · c7 · null realizado
  {
    const { macroId, microId } = await criarProjeto({ id: 'dash-g2-v1', codigo: 'DASH-G2-V1', nome: 'Dashboard G2 Vencido 1', gestorId: G2, categoriaId: CAT.sebrae, valorTotal: 45_000 });
    await pc('dash-g2-v1', DT.venc3);
    await aloc('dash-c7', 'dash-g2-v1', macroId, microId, ANO, MES, 50, null, G2);
  }
  console.log('   ✓ DASH-G2-V1 | Alta vencida (-6d) | SEBRAE | c7 | null');

  // G2-A1: Alta +3d · BNDES · c1 (cross-gestor, sobrecarregado!) · ~55% realizado
  //   c1 acumula em Jul: G1-V1(80h) + G2-A1(130h) = 210h ≥ 209h → sobrecarregado
  //   Jun: c1=100h/55h
  {
    const { macroId, microId } = await criarProjeto({ id: 'dash-g2-a1', codigo: 'DASH-G2-A1', nome: 'Dashboard G2 Alta 1', gestorId: G2, categoriaId: CAT.bndes, valorTotal: 160_000 });
    await pc('dash-g2-a1', DT.alta3);
    await aloc('dash-c1', 'dash-g2-a1', macroId, microId, ANO, MES, 130, 72, G2);
    await aloc('dash-c1', 'dash-g2-a1', macroId, microId, ANO_ANT, MES_ANT, 100, 55, G2);
  }
  console.log('   ✓ DASH-G2-A1 | Alta (+3d) | BNDES | c1 (sobrecarr cross-gestor) | 55%');

  // G2-A2: Alta +6d · EMBRAPII · sem alocações · null realizado
  {
    await criarProjeto({ id: 'dash-g2-a2', codigo: 'DASH-G2-A2', nome: 'Dashboard G2 Alta 2', gestorId: G2, categoriaId: CAT.embrapii, valorTotal: 85_000 });
    await pc('dash-g2-a2', DT.alta6);
  }
  console.log('   ✓ DASH-G2-A2 | Alta (+6d) | EMBRAPII | sem allocs | null');

  // G2-M1: Média +20d · FINEP · c5 · ~50% realizado
  //   Ago: c5=100h/null
  {
    const { macroId, microId } = await criarProjeto({ id: 'dash-g2-m1', codigo: 'DASH-G2-M1', nome: 'Dashboard G2 Média 1', gestorId: G2, categoriaId: CAT.finep, valorTotal: 110_000 });
    await pc('dash-g2-m1', DT.media20);
    await aloc('dash-c5', 'dash-g2-m1', macroId, microId, ANO, MES, 120, 60, G2);
    await aloc('dash-c5', 'dash-g2-m1', macroId, microId, ANO_PRO, MES_PRO, 100, null, G2);
  }
  console.log('   ✓ DASH-G2-M1 | Média (+20d) | FINEP | c5 | 50%');

  // G2-B1: Baixa +51d · SENAI · sem alocações · null realizado
  {
    await criarProjeto({ id: 'dash-g2-b1', codigo: 'DASH-G2-B1', nome: 'Dashboard G2 Baixa 1', gestorId: G2, categoriaId: CAT.senai, valorTotal: 55_000 });
    await pc('dash-g2-b1', DT.baixa51);
  }
  console.log('   ✓ DASH-G2-B1 | Baixa (+51d) | SENAI | sem allocs | null');

  // G2-PAU: Baixa +40d · BNDES · c7 · ~40% realizado · PAUSADO
  {
    const { macroId, microId } = await criarProjeto({ id: 'dash-g2-pau', codigo: 'DASH-G2-PAU', nome: 'Dashboard G2 Pausado', gestorId: G2, categoriaId: CAT.bndes, valorTotal: 70_000, pausado: true });
    await pc('dash-g2-pau', DT.baixa40);
    // c7 total Jul: G2-V1(50h) + G2-PAU(40h) = 90h → ocioso
    await aloc('dash-c7', 'dash-g2-pau', macroId, microId, ANO, MES, 40, 16, G2);
  }
  console.log('   ✓ DASH-G2-PAU | Baixa (+40d) | BNDES | c7 | 40% | PAUSADO');

  // ═════════════════════════════════════════════════════════════════════════
  // GESTOR 3 — perfil BAIXO de apontamento  (1/5 projetos com realizado)
  // ═════════════════════════════════════════════════════════════════════════
  console.log('');
  console.log('── Gestor 3 (perfil BAIXO ~20%): 5 projetos');

  // G3-A1: Alta HOJE (+0d) · FINEP · c2 (sobrecarregado) · null · FIXADO
  //   c2 acumula em Jul: G3-A1(120h) + G3-M1(90h) = 210h ≥ 209h → sobrecarregado
  //   Jun: c2=100h/null
  {
    const { macroId, microId } = await criarProjeto({ id: 'dash-g3-a1', codigo: 'DASH-G3-A1', nome: 'Dashboard G3 Alta 1', gestorId: G3, categoriaId: CAT.finep, valorTotal: 200_000, fixado: true });
    await pc('dash-g3-a1', DT.alta0);
    await aloc('dash-c2', 'dash-g3-a1', macroId, microId, ANO, MES, 120, null, G3);
    await aloc('dash-c2', 'dash-g3-a1', macroId, microId, ANO_ANT, MES_ANT, 100, null, G3);
  }
  console.log('   ✓ DASH-G3-A1 | Alta (hoje +0d) | FINEP | c2 (sobrecarr) | null | FIXADO');

  // G3-M1: Média +25d · BNDES · c2 (sobrecarregado) · null
  {
    const { macroId, microId } = await criarProjeto({ id: 'dash-g3-m1', codigo: 'DASH-G3-M1', nome: 'Dashboard G3 Média 1', gestorId: G3, categoriaId: CAT.bndes, valorTotal: 80_000 });
    await pc('dash-g3-m1', DT.media25);
    await aloc('dash-c2', 'dash-g3-m1', macroId, microId, ANO, MES, 90, null, G3);
  }
  console.log('   ✓ DASH-G3-M1 | Média (+25d) | BNDES | c2 (sobrecarr) | null');

  // G3-B1: Baixa +60d · SENAI · c8 · null
  //   Ago: c8=60h/null
  {
    const { macroId, microId } = await criarProjeto({ id: 'dash-g3-b1', codigo: 'DASH-G3-B1', nome: 'Dashboard G3 Baixa 1', gestorId: G3, categoriaId: CAT.senai, valorTotal: 65_000 });
    await pc('dash-g3-b1', DT.baixa60);
    await aloc('dash-c8', 'dash-g3-b1', macroId, microId, ANO, MES, 70, null, G3);
    await aloc('dash-c8', 'dash-g3-b1', macroId, microId, ANO_PRO, MES_PRO, 60, null, G3);
  }
  console.log('   ✓ DASH-G3-B1 | Baixa (+60d) | SENAI | c8 | null');

  // G3-B2: Baixa +86d · EMBRAPII · sem alocações · null
  {
    await criarProjeto({ id: 'dash-g3-b2', codigo: 'DASH-G3-B2', nome: 'Dashboard G3 Baixa 2', gestorId: G3, categoriaId: CAT.embrapii, valorTotal: 40_000 });
    await pc('dash-g3-b2', DT.baixa86);
  }
  console.log('   ✓ DASH-G3-B2 | Baixa (+86d) | EMBRAPII | sem allocs | null');

  // G3-SP: Sem prazo · FINEP · c8 · ~10% realizado (pouquíssimo — 3h/30h)
  {
    const { macroId, microId } = await criarProjeto({ id: 'dash-g3-sp', codigo: 'DASH-G3-SP', nome: 'Dashboard G3 Sem Prazo', gestorId: G3, categoriaId: CAT.finep, valorTotal: 50_000 });
    // sem prestacaoContas
    await aloc('dash-c8', 'dash-g3-sp', macroId, microId, ANO, MES, 30, 3, G3);
  }
  console.log('   ✓ DASH-G3-SP | Sem prazo | FINEP | c8 | 10% (pouquíssimo)');

  // ── Resumo ────────────────────────────────────────────────────────────────
  console.log('');
  console.log('══ RESUMO ══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Mês principal : ${fmtMes(ANO, MES)}`);
  console.log(`  Dados também  : ${fmtMes(ANO_ANT, MES_ANT)} (anterior) e ${fmtMes(ANO_PRO, MES_PRO)} (próximo)`);
  console.log('');
  console.log('  ── PROJETOS (total: 17)');
  console.log('     Alta (vencidas)    : 3  →  DASH-G1-V1 (-16d)  DASH-G1-V2 (-11d)  DASH-G2-V1 (-6d)');
  console.log('     Alta (próximas ≤7d): 4  →  DASH-G1-A1 (+2d)  DASH-G2-A1 (+3d)  DASH-G2-A2 (+6d)');
  console.log('                              +  DASH-G3-A1 (hoje +0d) [FIXADO]');
  console.log('     Média (8–30d)      : 3  →  DASH-G1-M1 (+15d)  DASH-G2-M1 (+20d)  DASH-G3-M1 (+25d)');
  console.log('     Baixa (>30d)       : 4  →  DASH-G1-B1 (+35d)  DASH-G2-B1 (+51d)  DASH-G3-B1 (+60d)  DASH-G3-B2 (+86d)');
  console.log('     Sem prazo          : 2  →  DASH-G1-SP  DASH-G3-SP');
  console.log('     Pausados           : 1  →  DASH-G2-PAU (Baixa +40d)');
  console.log('');
  console.log(`  ── APONTAMENTO em ${fmtMes(ANO, MES)}`);
  console.log('     Gestor1 : 5/6 ≈ 83%  (G1-V1 ~90%  G1-V2 ~85%  G1-A1 ~95%  G1-M1 ~82%  G1-B1 ~78%  | G1-SP null)');
  console.log('     Gestor2 : 3/6 = 50%  (G2-A1 ~55%  G2-M1 ~50%  G2-PAU ~40% | G2-V1 null  G2-A2 null  G2-B1 null)');
  console.log('     Gestor3 : 1/5 = 20%  (G3-SP ~10%  | G3-A1 null  G3-M1 null  G3-B1 null  G3-B2 null)');
  console.log('     Taxa global : 9/17 ≈ 53%');
  console.log('     Ranking (pior→melhor): Gestor3 20% → Gestor2 50% → Gestor1 83%');
  console.log('');
  console.log(`  ── CAPACIDADE em ${fmtMes(ANO, MES)}`);
  console.log('     Sobrecarregados (≥209h): 2');
  console.log('       dash-c1: G1-V1(80h) + G2-A1(130h) = 210h  — cross-gestor!');
  console.log('       dash-c2: G3-A1(120h) + G3-M1(90h) = 210h');
  console.log('     Saudáveis (110–208h): 4');
  console.log('       dash-c3: G1-V1(70h) + G1-A1(80h) = 150h');
  console.log('       dash-c4: G1-M1(100h) + G1-B1(60h) = 160h');
  console.log('       dash-c5: G2-M1(120h) = 120h');
  console.log('       dash-c8: G3-B1(70h) + G3-SP(30h) = 100h');
  console.log('     Ociosos (<110h): 2');
  console.log('       dash-c6: G1-V2(80h) = 80h');
  console.log('       dash-c7: G2-V1(50h) + G2-PAU(40h) = 90h');
  console.log('     headcountAlocado : 8  (únicos)');
  console.log('     emSobrecarga     : 2');
  console.log('     sinalCapacidade=true : DASH-G1-V1, DASH-G2-A1 (c1), DASH-G3-A1, DASH-G3-M1 (c2)');
  console.log('');
  console.log('  ── PROGRAMAS de fomento');
  console.log('     BNDES:    G1-V1, G1-M1, G2-A1, G2-PAU, G3-M1');
  console.log('     EMBRAPII: G1-V2, G2-A2, G3-B2');
  console.log('     FINEP:    G1-A1, G2-M1, G3-A1, G3-SP');
  console.log('     SENAI:    G1-B1, G2-B1, G3-B1');
  console.log('     SEBRAE:   G1-SP, G2-V1');
  console.log('');
  console.log('  Como rodar: cd backend && node seed-dashboards.mjs');
  console.log('');
  console.log('══ CONCLUÍDO ═══════════════════════════════════════════════════════════');
  console.log('');
}

main()
  .catch(e => { console.error('\nERRO:', e.message, '\n'); process.exit(1); })
  .finally(() => prisma.$disconnect());
