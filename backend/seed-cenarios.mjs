/**
 * seed-cenarios.mjs — Cria projetos de teste para validação manual do wizard (F5/F6).
 * Uso:  node seed-cenarios.mjs       (a partir de backend/)
 * Idempotente: apaga todos os projetos com codigo LIKE 'CEN-%' antes de recriar.
 *
 * Gestor-dono: gestor1@sistema.dev  (seed-gestor-001)
 * Categoria:   BNDES  (cat-bndes) — sem tarifas específicas p/ os collabs usados
 *
 * Colaboradores seed usados (SEM criar novos, teto verificado por mês):
 *   sc-02  Beatriz Cardoso   R$ 80/h   (seed allocs: só Jun/26 → livre Jul-Dez)
 *   sc-08  Heloisa Borges    R$ 65/h   (seed allocs: só Jun/26 → livre Jul-Dez)
 *   sc-24  Zara Martins      R$ 70/h   (seed allocs: só Ago/26 → 80h; +30h=110h ✓)
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── Constantes ────────────────────────────────────────────────────────────────
const G1        = 'seed-gestor-001';   // gestor1@sistema.dev
const CAT_BNDES = 'cat-bndes';
const TETO_MAX  = 220;

// Tarifas efetivas (BNDES — usa valorHora padrão; sem override p/ esses collabs)
const TARIFA = { 'sc-02': 80, 'sc-08': 65, 'sc-24': 70 };

// ── Helpers de data ────────────────────────────────────────────────────────────
const HOJE     = new Date();
const ANO_BASE = HOJE.getUTCFullYear();   // 2026
const MES_BASE = HOJE.getUTCMonth() + 1; // 7 (julho)

function gerarMeses(anoInicio, mesInicio, n) {
  const result = [];
  let a = anoInicio, m = mesInicio;
  for (let i = 0; i < n; i++) {
    result.push({ ano: a, mes: m });
    if (++m > 12) { m = 1; a++; }
  }
  return result;
}

// Primeiro dia do mês (YYYY-MM-DD)
function primeiroDia(ano, mes) {
  return `${ano}-${String(mes).padStart(2, '0')}-01`;
}

// Último dia do mês — Date.UTC(ano, mes, 0): mes em 1-based → monthIndex=mes → day 0 = último do mês anterior
function ultimoDia(ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
}

// Data de prestação de contas: 60 dias após o fim da vigência
function dataPC(fimStr) {
  const d = new Date(fimStr);
  d.setUTCDate(d.getUTCDate() + 60);
  return d.toISOString().slice(0, 10);
}

// Labels de mês: "Jul/26"
const MESES_ABR = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
function fmtMes(ano, mes) { return `${MESES_ABR[mes - 1]}/${String(ano).slice(2)}`; }
function fmtBRL(v)         { return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`; }

// ── Verificação de teto ───────────────────────────────────────────────────────
async function horasJaAlocadas(colabId, ano, mes) {
  const agg = await prisma.alocacao.aggregate({
    where: { colaboradorId: colabId, ano, mes },
    _sum: { horasPlanejadas: true },
  });
  return Number(agg._sum.horasPlanejadas ?? 0);
}

async function assertTeto(colabId, ano, mes, horasNova) {
  const ja = await horasJaAlocadas(colabId, ano, mes);
  const total = ja + horasNova;
  if (total > TETO_MAX) {
    throw new Error(
      `Teto violado: ${colabId} em ${fmtMes(ano, mes)} ` +
      `(já=${ja}h + nova=${horasNova}h = ${total}h > ${TETO_MAX}h)`
    );
  }
}

// ── Limpeza idempotente ───────────────────────────────────────────────────────
async function limparCenarios() {
  const projs = await prisma.projeto.findMany({
    where: { codigo: { startsWith: 'CEN-' } },
    select: { id: true, codigo: true },
  });
  if (projs.length === 0) { console.log('  (nenhum cenário anterior encontrado)'); return; }

  const ids     = projs.map(p => p.id);
  const codigos = projs.map(p => p.codigo).join(', ');

  // Macros do CEN (precisamos apagar micros antes)
  const macros   = await prisma.macroEntrega.findMany({ where: { projetoId: { in: ids } }, select: { id: true } });
  const macroIds = macros.map(m => m.id);

  // SolicitacaoRemanejamento referencia macroEntregaDestino (RESTRICT) — apaga antes
  if (macroIds.length > 0) {
    await prisma.solicitacaoRemanejamento.deleteMany({ where: { macroEntregaDestinoId: { in: macroIds } } });
  }
  await prisma.solicitacaoRemanejamento.deleteMany({ where: { projetoDestinoId: { in: ids } } });

  // Alocações
  await prisma.alocacao.deleteMany({ where: { projetoId: { in: ids } } });

  // Micro → Macro → Projeto (PrestacaoContas e MetaMensalAjuste: CASCADE)
  if (macroIds.length > 0) {
    await prisma.microEntrega.deleteMany({ where: { macroEntregaId: { in: macroIds } } });
  }
  await prisma.macroEntrega.deleteMany({ where: { projetoId: { in: ids } } });
  await prisma.projeto.deleteMany({ where: { id: { in: ids } } });

  console.log(`  apagados: ${codigos}`);
}

// ── Criação de macro + micro "Geral" ─────────────────────────────────────────
async function criarMacroGeral(projId, macroId, microId, macroNome = 'Macro') {
  await prisma.macroEntrega.create({ data: { id: macroId, projetoId: projId, nome: macroNome, status: 'ativa' } });
  await prisma.microEntrega.create({ data: { id: microId, macroEntregaId: macroId, nome: 'Geral', status: 'pendente' } });
}

// ── Criação de alocação (com verificação de teto) ─────────────────────────────
async function alocar(colabId, projId, macroId, microId, ano, mes, horas) {
  await assertTeto(colabId, ano, mes, horas);
  const id = `cen-${projId}-${colabId}-${ano}-${mes}`;
  await prisma.alocacao.create({
    data: {
      id,
      colaboradorId: colabId,
      projetoId:     projId,
      macroEntregaId: macroId,
      microEntregaId: microId,
      ano, mes,
      horasPlanejadas: horas,
      createdById: G1,
      updatedById: G1,
    },
  });
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('══ seed-cenarios.mjs ═══════════════════════════════════════════════════');
  console.log(`   Gestor-dono : gestor1@sistema.dev  (${G1})`);
  console.log(`   Categoria   : BNDES  (${CAT_BNDES})`);
  console.log(`   Data atual  : ${HOJE.toISOString().slice(0, 10)}`);
  console.log(`   Mês base    : ${fmtMes(ANO_BASE, MES_BASE)}`);
  console.log('');

  // ── Limpeza ─────────────────────────────────────────────────────────────────
  console.log('── Limpando cenários anteriores (CEN-*)…');
  await limparCenarios();
  console.log('');

  // ── Períodos base ────────────────────────────────────────────────────────────
  const meses6  = gerarMeses(ANO_BASE, MES_BASE, 6);
  const meses3  = gerarMeses(ANO_BASE, MES_BASE, 3);
  const meses24 = gerarMeses(ANO_BASE, MES_BASE, 24);

  const vig6_ini = primeiroDia(meses6[0].ano, meses6[0].mes);
  const vig6_fim = ultimoDia(meses6.at(-1).ano, meses6.at(-1).mes);

  const vig3_ini = primeiroDia(meses3[0].ano, meses3[0].mes);
  const vig3_fim = ultimoDia(meses3.at(-1).ano, meses3.at(-1).mes);

  const summary = [];

  // ══════════════════════════════════════════════════════════════════════════════
  // [1/4] CEN-DEFICIT
  //   6 meses, valorTotal=60.000, 2 collabs pré-alocados (20h cada)
  //   Camada 'equipe' garantida desde o 1º mês; deficit claro em todos os meses
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('── [1/4] CEN-DEFICIT…');
  const VT_DEF = 60_000;
  const META_MES_DEF = VT_DEF / 6;                          // R$ 10.000/mês
  const REC_MES_DEF  = 20 * TARIFA['sc-02'] + 20 * TARIFA['sc-08'];  // R$ 2.900/mês

  await prisma.projeto.create({ data: {
    id: 'cen-deficit', codigo: 'CEN-DEFICIT', nome: 'Cenário: Com Déficit',
    gestorId: G1, criadoPorId: G1, categoriaId: CAT_BNDES, status: 'ativo',
    valorTotal: VT_DEF, valorOficial: 0, estrategiaOficial: 'proporcional',
    vigenciaInicio: new Date(vig6_ini), vigenciaFim: new Date(vig6_fim),
  }});
  await prisma.prestacaoContas.create({ data: { id: 'cen-deficit-pc', projetoId: 'cen-deficit', data: new Date(dataPC(vig6_fim)) } });
  await criarMacroGeral('cen-deficit', 'cen-deficit-m1', 'cen-deficit-mi1');

  for (const { ano, mes } of meses6) {
    await alocar('sc-02', 'cen-deficit', 'cen-deficit-m1', 'cen-deficit-mi1', ano, mes, 20);
    await alocar('sc-08', 'cen-deficit', 'cen-deficit-m1', 'cen-deficit-mi1', ano, mes, 20);
  }

  summary.push({
    codigo: 'CEN-DEFICIT',
    nome: 'Cenário: Com Déficit',
    vigencia: `${vig6_ini} → ${vig6_fim}`,
    collabs: [
      { nome: 'Beatriz Cardoso (sc-02)', tarifa: TARIFA['sc-02'], horas: 20 },
      { nome: 'Heloisa Borges  (sc-08)', tarifa: TARIFA['sc-08'], horas: 20 },
    ],
    meses: meses6.map(({ ano, mes }) => ({ label: fmtMes(ano, mes), meta: META_MES_DEF, receita: REC_MES_DEF })),
    testar: 'Wizard F5 (camadas equipe/novo, motor, parâmetros) e aplicação F6',
  });
  console.log('   ✓ criado');

  // ══════════════════════════════════════════════════════════════════════════════
  // [2/4] CEN-SEMMACRO
  //   6 meses, financials configurados, SEM nenhuma macro
  //   → CTA "crie uma macro primeiro" no wizard
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('── [2/4] CEN-SEMMACRO…');
  const VT_SM = 30_000;
  const META_MES_SM = VT_SM / 6;  // R$ 5.000/mês

  await prisma.projeto.create({ data: {
    id: 'cen-semmacro', codigo: 'CEN-SEMMACRO', nome: 'Cenário: Sem Macro',
    gestorId: G1, criadoPorId: G1, categoriaId: CAT_BNDES, status: 'ativo',
    valorTotal: VT_SM, valorOficial: 0, estrategiaOficial: 'proporcional',
    vigenciaInicio: new Date(vig6_ini), vigenciaFim: new Date(vig6_fim),
  }});
  await prisma.prestacaoContas.create({ data: { id: 'cen-semmacro-pc', projetoId: 'cen-semmacro', data: new Date(dataPC(vig6_fim)) } });
  // SEM macros — intencionalmente

  summary.push({
    codigo: 'CEN-SEMMACRO',
    nome: 'Cenário: Sem Macro',
    vigencia: `${vig6_ini} → ${vig6_fim}`,
    collabs: [],
    meses: meses6.map(({ ano, mes }) => ({ label: fmtMes(ano, mes), meta: META_MES_SM, receita: 0 })),
    testar: 'CTA de bloqueio no wizard ("crie uma macro primeiro")',
  });
  console.log('   ✓ criado');

  // ══════════════════════════════════════════════════════════════════════════════
  // [3/4] CEN-COBERTO
  //   3 meses, coberto com pequena folga (receita > meta em todos os meses)
  //   → "não há déficit no período" no wizard
  //   → banner AZUL (saldoNaoPlanejado) na tela da meta ao baixar um mês
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('── [3/4] CEN-COBERTO…');
  const VT_COB = 6_000;
  const META_MES_COB = VT_COB / 3;                  // R$ 2.000/mês
  const REC_MES_COB  = 30 * TARIFA['sc-24'];        // 30h × R$70 = R$ 2.100/mês → folga R$ 100

  await prisma.projeto.create({ data: {
    id: 'cen-coberto', codigo: 'CEN-COBERTO', nome: 'Cenário: Coberto',
    gestorId: G1, criadoPorId: G1, categoriaId: CAT_BNDES, status: 'ativo',
    valorTotal: VT_COB, valorOficial: 0, estrategiaOficial: 'proporcional',
    vigenciaInicio: new Date(vig3_ini), vigenciaFim: new Date(vig3_fim),
  }});
  await prisma.prestacaoContas.create({ data: { id: 'cen-coberto-pc', projetoId: 'cen-coberto', data: new Date(dataPC(vig3_fim)) } });
  await criarMacroGeral('cen-coberto', 'cen-coberto-m1', 'cen-coberto-mi1');

  for (const { ano, mes } of meses3) {
    await alocar('sc-24', 'cen-coberto', 'cen-coberto-m1', 'cen-coberto-mi1', ano, mes, 30);
  }

  summary.push({
    codigo: 'CEN-COBERTO',
    nome: 'Cenário: Coberto',
    vigencia: `${vig3_ini} → ${vig3_fim}`,
    collabs: [{ nome: 'Zara Martins (sc-24)', tarifa: TARIFA['sc-24'], horas: 30 }],
    meses: meses3.map(({ ano, mes }) => ({ label: fmtMes(ano, mes), meta: META_MES_COB, receita: REC_MES_COB })),
    testar: '"Sem déficit" no wizard; banner AZUL (saldoNaoPlanejado) na meta ao baixar um mês',
  });
  console.log('   ✓ criado');

  // ══════════════════════════════════════════════════════════════════════════════
  // [4/4] CEN-SEMFOLGA
  //   3 meses, deficit total (zero alocação) — nenhuma folga para redistribuir
  //   → banner ÂMBAR (precisaDecisaoManual) na tela da meta ao elevar um mês
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('── [4/4] CEN-SEMFOLGA…');
  const VT_SF = 12_000;
  const META_MES_SF = VT_SF / 3;  // R$ 4.000/mês, deficit total

  await prisma.projeto.create({ data: {
    id: 'cen-semfolga', codigo: 'CEN-SEMFOLGA', nome: 'Cenário: Sem Folga',
    gestorId: G1, criadoPorId: G1, categoriaId: CAT_BNDES, status: 'ativo',
    valorTotal: VT_SF, valorOficial: 0, estrategiaOficial: 'proporcional',
    vigenciaInicio: new Date(vig3_ini), vigenciaFim: new Date(vig3_fim),
  }});
  await prisma.prestacaoContas.create({ data: { id: 'cen-semfolga-pc', projetoId: 'cen-semfolga', data: new Date(dataPC(vig3_fim)) } });
  await criarMacroGeral('cen-semfolga', 'cen-semfolga-m1', 'cen-semfolga-mi1');
  // SEM alocações — intencionalmente (zero receita → deficit pleno)

  summary.push({
    codigo: 'CEN-SEMFOLGA',
    nome: 'Cenário: Sem Folga',
    vigencia: `${vig3_ini} → ${vig3_fim}`,
    collabs: [],
    meses: meses3.map(({ ano, mes }) => ({ label: fmtMes(ano, mes), meta: META_MES_SF, receita: 0 })),
    testar: 'Banner ÂMBAR (precisaDecisaoManual) na meta ao elevar um mês',
  });
  console.log('   ✓ criado');

  // ══════════════════════════════════════════════════════════════════════════════
  // [5/5] CEN-24MESES
  //   24 meses (Jul/26 – Jun/28), valorTotal=240.000, SEM alocações pré-existentes
  //   Usado exclusivamente para reprovar o bug de limite de meses no wizard
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('── [5/5] CEN-24MESES…');
  const VT_24  = 240_000;
  const META_MES_24 = VT_24 / 24;  // R$ 10.000/mês

  const vig24_ini = primeiroDia(meses24[0].ano, meses24[0].mes);
  const vig24_fim = ultimoDia(meses24.at(-1).ano, meses24.at(-1).mes);

  await prisma.projeto.create({ data: {
    id: 'cen-24meses', codigo: 'CEN-24MESES', nome: 'Cenário: 24 Meses (bug repro)',
    gestorId: G1, criadoPorId: G1, categoriaId: CAT_BNDES, status: 'ativo',
    valorTotal: VT_24, valorOficial: 0, estrategiaOficial: 'proporcional',
    vigenciaInicio: new Date(vig24_ini), vigenciaFim: new Date(vig24_fim),
  }});
  await prisma.prestacaoContas.create({ data: { id: 'cen-24meses-pc', projetoId: 'cen-24meses', data: new Date(dataPC(vig24_fim)) } });
  await criarMacroGeral('cen-24meses', 'cen-24meses-m1', 'cen-24meses-mi1');
  // SEM alocações — para garantir deficit em todos os 24 meses

  summary.push({
    codigo: 'CEN-24MESES',
    nome: 'Cenário: 24 Meses (bug repro)',
    vigencia: `${vig24_ini} → ${vig24_fim}`,
    collabs: [],
    meses: meses24.slice(0, 3).map(({ ano, mes }) => ({ label: fmtMes(ano, mes), meta: META_MES_24, receita: 0 })),
    testar: 'Bug do wizard com 24 meses: Gerar → Limpar → selecionar 1 mês',
  });
  console.log('   ✓ criado');

  // ── Resumo ───────────────────────────────────────────────────────────────────
  console.log('');
  console.log('══ RESUMO DOS CENÁRIOS ═════════════════════════════════════════════════');

  for (const s of summary) {
    const deficit = s.meses[0].meta - s.meses[0].receita;
    const coberto = deficit <= 0;

    console.log('');
    console.log(`  ▶ ${s.codigo}  "${s.nome}"`);
    console.log(`    Vigência  : ${s.vigencia}`);

    if (s.collabs.length > 0) {
      const rec = s.collabs.map(c => `${c.nome} ${c.horas}h×${fmtBRL(c.tarifa)}`).join('; ');
      console.log(`    Alocados  : ${rec}`);
    } else {
      console.log(`    Alocados  : nenhum`);
    }

    console.log(`    Por mês:`);
    for (const m of s.meses) {
      const def = m.meta - m.receita;
      const label = def <= 0
        ? `COBERTO  (folga ${fmtBRL(-def)}/mês)`
        : `DÉFICIT  ${fmtBRL(def)}/mês`;
      console.log(`      ${m.label} | meta ${fmtBRL(m.meta)} | receita ${fmtBRL(m.receita)} → ${label}`);
    }
    console.log(`    → Testar  : ${s.testar}`);
  }

  console.log('');
  console.log('══ CONCLUÍDO ═══════════════════════════════════════════════════════════');
  console.log('');
}

main()
  .catch(e => { console.error('\nERRO:', e.message, '\n'); process.exit(1); })
  .finally(() => prisma.$disconnect());
