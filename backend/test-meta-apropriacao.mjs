// Teste do endpoint GET /api/projetos/:id/meta-apropriacao (fase F2a).
// Rode com: node test-meta-apropriacao.mjs
// Pressupõe backend de pé em http://localhost:3001 com o seed padrão carregado.
//
// Invariantes verificados com IGUALDADE EXATA (sem epsilon):
//   soma(medicao)       === valorTotal
//   soma(oficialAlocado) === valorOficial
//   soma(metaHT)        === valorHT  (= valorTotal - valorOficial)

import { PrismaClient } from '@prisma/client';

const BASE  = 'http://localhost:3001/api';
const STAMP = Date.now();
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;

function check(label, condition, extra) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    pass++;
  } else {
    console.log(`  ❌ ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`);
    fail++;
  }
}

// Soma em centavos (inteiros) para aritmética exata, depois serializa de volta
function somaExata(arr, campo) {
  const centavos = arr.reduce((acc, m) => acc + Math.round(parseFloat(m[campo]) * 100), 0);
  return (centavos / 100).toFixed(2);
}

function addDays(n) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Login falhou para ${email}: ${JSON.stringify(data)}`);
  return data.token;
}

async function api(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, data };
}

const projetosCriados = [];
const colaboradoresCriados = [];

async function main() {
  console.log('── Login ─────────────────────────────────────────────────');
  const tokenGestor1 = await login('gestor1@sistema.dev', 'gestor123');
  const tokenGestor3 = await login('gestor3@sistema.dev', 'gestor123');
  const tokenAdmin   = await login('admin@sistema.dev', 'admin123');
  console.log('  Tokens obtidos.\n');

  const { data: categorias } = await api('GET', '/categorias?ativo=true', tokenAdmin);
  const categoriaId = categorias[0].id;
  const { data: profissoes } = await api('GET', '/profissoes?ativo=true', tokenAdmin);
  const profissaoId = profissoes[0].id;

  // ── Setup: projetos ────────────────────────────────────────────────────────
  console.log('── Setup: criando projetos de teste ─────────────────────');

  const { status: sIni, data: projIni } = await api('POST', '/projetos', tokenGestor1, {
    codigo: `META-INI-${STAMP}`, nome: 'Meta Teste Inicial',
    prestacoesContas: [addDays(30)], categoriaId,
    valorTotal: 800000, valorOficial: 168000,
    estrategiaOficial: 'inicial',
    vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31',
  });
  if (sIni !== 201) throw new Error(`Criar projIni falhou: ${JSON.stringify(projIni)}`);
  projetosCriados.push(projIni.id);

  const { data: macroIni } = await api('POST', `/projetos/${projIni.id}/macros`, tokenGestor1, { nome: 'Macro' });
  const macroIniId = macroIni.id;
  const microIniId = macroIni.microEntregas.find(m => m.nome === 'Geral').id;

  const { status: sProp, data: projProp } = await api('POST', '/projetos', tokenGestor1, {
    codigo: `META-PROP-${STAMP}`, nome: 'Meta Teste Proporcional',
    prestacoesContas: [addDays(30)], categoriaId,
    valorTotal: 800000, valorOficial: 168000,
    estrategiaOficial: 'proporcional',
    vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31',
  });
  if (sProp !== 201) throw new Error(`Criar projProp falhou: ${JSON.stringify(projProp)}`);
  projetosCriados.push(projProp.id);

  const { status: sSem, data: projSemVig } = await api('POST', '/projetos', tokenGestor1, {
    codigo: `META-SEM-${STAMP}`, nome: 'Meta Sem Vigencia',
    prestacoesContas: [addDays(30)], categoriaId,
  });
  if (sSem !== 201) throw new Error(`Criar projSemVig falhou: ${JSON.stringify(projSemVig)}`);
  projetosCriados.push(projSemVig.id);

  console.log(`  ${projetosCriados.length} projetos criados.\n`);

  // ── TESTE 1: estratégia 'inicial' — invariantes exatos ────────────────────
  // Cálculo esperado com medicaoBase = trunc(800000/12, 2dp) = 66666.67:
  //   Meses 1–11: medicao=66666.67
  //   Mês 12:     medicao=66666.63  (800000 − 11×66666.67, absorve resíduo)
  //   Saldo after mes1=168000-66666.67=101333.33, after mes2=34666.66
  //   Mês 3: oficial=34666.66 (saldo restante), metaHT=66666.67-34666.66=32000.01
  //   Meses 4–11: oficial=0, metaHT=66666.67
  //   Mês 12: oficial=0, metaHT=66666.63
  console.log('── 1. Estratégia inicial ────────────────────────────────');
  const { status: s1, data: d1 } = await api('GET', `/projetos/${projIni.id}/meta-apropriacao`, tokenGestor1);
  check('Status 200', s1 === 200, { s1 });
  check('configurado: true', d1?.configurado === true);
  check('resumo.numeroMeses = 12', d1?.resumo?.numeroMeses === 12, d1?.resumo);
  check('resumo.valorTotal  = 800000.00', d1?.resumo?.valorTotal   === '800000.00', d1?.resumo);
  check('resumo.valorOficial = 168000.00', d1?.resumo?.valorOficial === '168000.00', d1?.resumo);
  check('resumo.valorHT = 632000.00', d1?.resumo?.valorHT === '632000.00', d1?.resumo);
  check('resumo.estrategiaOficial = inicial', d1?.resumo?.estrategiaOficial === 'inicial');
  check('meses.length = 12', d1?.meses?.length === 12, d1?.meses?.length);

  const m1_1 = d1?.meses?.[0];   // Jan/2026
  const m2_1 = d1?.meses?.[1];   // Fev/2026
  const m3_1 = d1?.meses?.[2];   // Mar/2026 — mês parcial
  const m4_1 = d1?.meses?.[3];   // Abr/2026
  const m12_1 = d1?.meses?.[11]; // Dez/2026 — mês do ajuste

  check('Mês 1: ano=2026, mes=1',  m1_1?.ano === 2026 && m1_1?.mes === 1, m1_1);
  check('Mês 12: ano=2026, mes=12', m12_1?.ano === 2026 && m12_1?.mes === 12, m12_1);
  check('Meses 1–11: medicao = 66666.67', m1_1?.medicao === '66666.67', m1_1?.medicao);
  check('Mês 12: medicao = 66666.63 (ajuste)', m12_1?.medicao === '66666.63', m12_1?.medicao);
  check('Mês 1 metaHT = 0.00 (oficial cobre)', m1_1?.metaHT === '0.00', m1_1);
  check('Mês 2 metaHT = 0.00 (oficial cobre)', m2_1?.metaHT === '0.00', m2_1);
  check('Mês 3 metaHT = 32000.01 (parcial)', m3_1?.metaHT === '32000.01', m3_1);
  check('Mês 3 oficialAlocado = 34666.66', m3_1?.oficialAlocado === '34666.66', m3_1);
  check('Mês 4 oficialAlocado = 0.00 (esgotado)', m4_1?.oficialAlocado === '0.00', m4_1);
  check('Mês 4 metaHT = 66666.67 (= medicao)', m4_1?.metaHT === '66666.67', m4_1);
  check('Mês 12 metaHT = 66666.63 (ajuste)', m12_1?.metaHT === '66666.63', m12_1);

  // ── INVARIANTES EXATOS (sem epsilon) ──────────────────────────────────────
  const somaMetaIni  = somaExata(d1.meses, 'metaHT');
  const somaMedIni   = somaExata(d1.meses, 'medicao');
  const somaOficIni  = somaExata(d1.meses, 'oficialAlocado');
  check(`INVARIANTE soma(metaHT) = 632000.00 exato [${somaMetaIni}]`, somaMetaIni === '632000.00', somaMetaIni);
  check(`soma(medicao) = 800000.00 exato [${somaMedIni}]`,            somaMedIni  === '800000.00', somaMedIni);
  check(`soma(oficialAlocado) = 168000.00 exato [${somaOficIni}]`,    somaOficIni === '168000.00', somaOficIni);

  check('Sem alocação: receitaPlanejada = 0.00', m3_1?.receitaPlanejada === '0.00', m3_1);
  check('Sem alocação: deficit = metaHT', m3_1?.deficit === m3_1?.metaHT, m3_1);

  // ── TESTE 2: estratégia 'proporcional' — invariantes exatos ───────────────
  // 168000/12 = 14000.00 exato → oficialBase = 14000.00, sem resíduo no oficial.
  // Meses 1–11: medicao=66666.67, oficial=14000.00, metaHT=52666.67
  // Mês 12:     medicao=66666.63 (ajuste), oficial=14000.00, metaHT=52666.63
  console.log('\n── 2. Estratégia proporcional ───────────────────────────');
  const { status: s2, data: d2 } = await api('GET', `/projetos/${projProp.id}/meta-apropriacao`, tokenGestor1);
  check('Status 200', s2 === 200);
  check('configurado: true', d2?.configurado === true);
  check('meses.length = 12', d2?.meses?.length === 12);

  const m1_2  = d2?.meses?.[0];
  const m12_2 = d2?.meses?.[11];

  check('oficialAlocado = 14000.00 (168000/12 exato)', m1_2?.oficialAlocado === '14000.00', m1_2?.oficialAlocado);
  check('Meses 1–11: metaHT = 52666.67', m1_2?.metaHT === '52666.67', m1_2?.metaHT);
  check('Mês 12: metaHT = 52666.63 (ajuste da medicao)', m12_2?.metaHT === '52666.63', m12_2?.metaHT);
  check('Meses 1–11: metaHT uniformes entre si',
    d2?.meses?.slice(0, 11).every(m => m.metaHT === m1_2?.metaHT),
    d2?.meses?.slice(0, 11).map(m => m.metaHT));
  check('oficialAlocado igual em todos os 12 meses (sem resíduo)',
    d2?.meses?.every(m => m.oficialAlocado === '14000.00'),
    d2?.meses?.map(m => m.oficialAlocado));

  const somaMetaProp = somaExata(d2.meses, 'metaHT');
  const somaMedProp  = somaExata(d2.meses, 'medicao');
  const somaOficProp = somaExata(d2.meses, 'oficialAlocado');
  check(`INVARIANTE soma(metaHT) = 632000.00 exato [${somaMetaProp}]`, somaMetaProp === '632000.00', somaMetaProp);
  check(`soma(medicao) = 800000.00 exato [${somaMedProp}]`,            somaMedProp  === '800000.00', somaMedProp);
  check(`soma(oficialAlocado) = 168000.00 exato [${somaOficProp}]`,    somaOficProp === '168000.00', somaOficProp);

  // ── TESTE 3: com alocação planejada + tarifa de exceção ───────────────────
  console.log('\n── 3. Com alocação planejada e tarifa de exceção ────────');

  // colabA: padrão 150/h
  const { data: dA } = await api('POST', '/colaboradores', tokenAdmin, {
    nome: `Meta ColabA ${STAMP}`, email: `meta.a.${STAMP}@teste.dev`.toLowerCase(),
    valorHora: 150, profissaoId, confirmarSimilar: true,
  });
  colaboradoresCriados.push(dA.colaborador.id);

  // colabB: padrão 100/h, override 200/h para a categoria do projeto
  const { data: dB } = await api('POST', '/colaboradores', tokenAdmin, {
    nome: `Meta ColabB ${STAMP}`, email: `meta.b.${STAMP}@teste.dev`.toLowerCase(),
    valorHora: 100, profissaoId, tarifas: [{ categoriaId, valorHora: 200 }], confirmarSimilar: true,
  });
  colaboradoresCriados.push(dB.colaborador.id);

  // Mar/2026 (mês 3): colabA 10h×150=1500, colabB 5h×200=1000 → receita=2500
  // metaHT mês 3 = 32000.01 → deficit = 32000.01 - 2500.00 = 29500.01
  await api('POST', '/alocacoes', tokenGestor1, {
    colaboradorId: dA.colaborador.id, projetoId: projIni.id,
    macroEntregaId: macroIniId, microEntregaId: microIniId,
    ano: 2026, mes: 3, horasPlanejadas: 10,
  });
  await api('POST', '/alocacoes', tokenGestor1, {
    colaboradorId: dB.colaborador.id, projetoId: projIni.id,
    macroEntregaId: macroIniId, microEntregaId: microIniId,
    ano: 2026, mes: 3, horasPlanejadas: 5,
  });

  const { data: d3 } = await api('GET', `/projetos/${projIni.id}/meta-apropriacao`, tokenGestor1);
  const m3_3 = d3?.meses?.[2];
  const m1_3 = d3?.meses?.[0];
  check('Mar/2026 receitaPlanejada = 2500.00 (10×150 padrão + 5×200 override)', m3_3?.receitaPlanejada === '2500.00', m3_3);
  check('Mar/2026 deficit = 29500.01 (32000.01 − 2500.00)', m3_3?.deficit === '29500.01', m3_3);
  check('Jan/2026 receitaPlanejada = 0.00 (sem alocação)', m1_3?.receitaPlanejada === '0.00', m1_3);
  check('Jan/2026 deficit = metaHT (sem cobertura)', m1_3?.deficit === m1_3?.metaHT, m1_3);

  // ── TESTE 4: projeto sem vigência → configurado: false ───────────────────
  console.log('\n── 4. Projeto sem vigência/valores ─────────────────────');
  const { status: s4, data: d4 } = await api('GET', `/projetos/${projSemVig.id}/meta-apropriacao`, tokenGestor1);
  check('Status 200 (não é 404/500)', s4 === 200, { s4 });
  check('configurado: false', d4?.configurado === false, d4);
  check('Sem campo meses',  !d4?.meses,  d4);
  check('Sem campo resumo', !d4?.resumo, d4);

  // ── TESTE 5: escopo por papel ─────────────────────────────────────────────
  console.log('\n── 5. Escopo por papel ──────────────────────────────────');
  const { status: s5ok }  = await api('GET', `/projetos/${projIni.id}/meta-apropriacao`, tokenGestor1);
  check('gestor dono → 200', s5ok === 200);
  const { status: s5neg } = await api('GET', `/projetos/${projIni.id}/meta-apropriacao`, tokenGestor3);
  check('gestor não-dono → 403', s5neg === 403);
  const { status: s5adm } = await api('GET', `/projetos/${projIni.id}/meta-apropriacao`, tokenAdmin);
  check('admin → 200 (acesso irrestrito)', s5adm === 200);

  // ── Limpeza ───────────────────────────────────────────────────────────────
  console.log('\n── Limpeza ──────────────────────────────────────────────');
  try {
    await prisma.alocacao.deleteMany({ where: { projetoId: { in: projetosCriados } } });
    await prisma.microEntrega.deleteMany({ where: { macroEntrega: { projetoId: { in: projetosCriados } } } });
    await prisma.macroEntrega.deleteMany({ where: { projetoId: { in: projetosCriados } } });
    await prisma.prestacaoContas.deleteMany({ where: { projetoId: { in: projetosCriados } } });
    await prisma.projeto.deleteMany({ where: { id: { in: projetosCriados } } });
    await prisma.tarifaColaborador.deleteMany({ where: { colaboradorId: { in: colaboradoresCriados } } });
    await prisma.colaborador.deleteMany({ where: { id: { in: colaboradoresCriados } } });
    console.log('  Limpeza concluída.');
  } catch (err) {
    console.log(`  Falha na limpeza: ${err.message}`);
  } finally {
    await prisma.$disconnect();
  }

  console.log('\n──────────────────────────────────────────────────────────');
  console.log(`Resultado: ${pass} passou(aram), ${fail} falhou(aram).`);
  if (fail > 0) process.exit(1);
}

main().catch(err => {
  console.error('Erro fatal no teste:', err);
  process.exit(1);
});
