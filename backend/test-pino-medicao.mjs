// test-pino-medicao.mjs — Spec §7: medição mensal editável
// Cobre: sem pino (identico ao atual), 1 mes pinado, varios pinados,
//        caso da cliente (medicao 51k + oficial 61.5k → metaHT 0 + deficit 0),
//        piso ativo com aviso §4.1, estouro §4.2, coexistencia pino meta + pino medicao,
//        estrategia inicial com medicoes editadas, mes fechado.

const BASE  = 'http://localhost:3001';
const AUTH  = { Authorization: 'Bearer PLACEHOLDER' };      // preenchido no boot

let passed = 0, failed = 0;
const erros = [];

function ok(label, condition, info) {
  if (condition) { passed++; console.log(`  ✅ ${label}`); }
  else           { failed++; erros.push(label); console.log(`  ❌ ${label}`, info ?? ''); }
}

async function api(method, path, body, tok) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

// ── Boot: obter tokens ────────────────────────────────────────────────────
const adminRes = await api('POST', '/api/auth/login', { email: 'admin@sistema.dev', password: 'admin123' }, '');
if (adminRes.status !== 200) { console.error('Login admin falhou'); process.exit(1); }
const ADMIN_TOKEN = adminRes.data.token;

const gestorRes = await api('POST', '/api/auth/login', { email: 'gestor1@sistema.dev', password: 'gestor123' }, '');
if (gestorRes.status !== 200) { console.error('Login gestor1 falhou'); process.exit(1); }
const TOKEN = gestorRes.data.token;
const GESTOR_ID = gestorRes.data.user.id;
AUTH.Authorization = `Bearer ${TOKEN}`;

// Buscar categoriaId para criação de projetos
const catRes = await api('GET', '/api/categorias?ativo=true', null, ADMIN_TOKEN);
const CATEGORIA_ID = catRes.data[0]?.id;
if (!CATEGORIA_ID) throw new Error('Nenhuma categoria ativa encontrada');
const STAMP = Date.now();

function addDays(n) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── Helper: criar projeto configurado ─────────────────────────────────────
async function criarProjeto({ codigo, valorTotal, valorOficial = 0, estrategia = 'proporcional', mesesN = 4, inicioAno = 2030, inicioMes = 1 }) {
  const fimMes = ((inicioMes - 1 + mesesN - 1) % 12) + 1;
  const fimAno = inicioAno + Math.floor((inicioMes - 1 + mesesN - 1) / 12);
  const r = await api('POST', '/api/projetos', {
    codigo: `${codigo}-${STAMP}`, nome: `MEDTESTE-${codigo}`, gestorId: GESTOR_ID,
    valorTotal, valorOficial, estrategiaOficial: estrategia,
    categoriaId: CATEGORIA_ID,
    prestacoesContas: [addDays(90)],
    vigenciaInicio: `${inicioAno}-${String(inicioMes).padStart(2,'0')}-01`,
    vigenciaFim:    `${fimAno}-${String(fimMes).padStart(2,'0')}-28`,
  }, TOKEN);
  if (r.status !== 201) throw new Error(`Criar projeto falhou: ${JSON.stringify(r.data)}`);
  return r.data.id;
}

async function getMeta(id) {
  const r = await api('GET', `/api/projetos/${id}/meta-apropriacao`, null, TOKEN);
  if (r.status !== 200) throw new Error(`getMeta falhou: ${JSON.stringify(r.data)}`);
  return r.data;
}

async function pinMedicao(id, ano, mes, medicao) {
  return api('PUT', `/api/projetos/${id}/meta-apropriacao/pino-medicao`, { ano, mes, medicao }, TOKEN);
}
async function delMedicao(id, ano, mes) {
  return api('DELETE', `/api/projetos/${id}/meta-apropriacao/pino-medicao/${ano}/${mes}`, null, TOKEN);
}
async function pinMeta(id, ano, mes, metaHT) {
  return api('PUT', `/api/projetos/${id}/meta-apropriacao/pino`, { ano, mes, metaHT }, TOKEN);
}

const projIds = [];

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 1. Sem pino: comportamento idêntico ao atual ─────────────────');
{
  const id = await criarProjeto({ codigo: 'MT-001', valorTotal: 100, mesesN: 4 });
  projIds.push(id);
  const m = await getMeta(id);
  const medicioes = m.meses.map(x => x.medicao);
  ok('4 meses com medicao 25.00', medicioes.every(v => v === '25.00'));
  const somaMed = medicioes.reduce((a, b) => a + parseFloat(b), 0);
  ok('soma(medicao) = 100.00', Math.abs(somaMed - 100) < 0.01);
  ok('pinadaMedicao false em todos', m.meses.every(x => x.pinadaMedicao === false));
  ok('totalCortadoPeloPiso = 0.00', m.resumo.totalCortadoPeloPiso === '0.00');
  ok('avisoEstouroMedicao ausente', m.resumo.avisoEstouroMedicao == null);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 2. Um mês pinado: resto distribui + soma exata ──────────────');
{
  const id = await criarProjeto({ codigo: 'MT-002', valorTotal: 120, mesesN: 3 }); // 3 meses de 40
  projIds.push(id);
  const r = await pinMedicao(id, 2030, 1, 60);
  ok('PUT pino-medicao → 200', r.status === 200 || r.status === 201);
  const m = await getMeta(id);
  const [m1, m2, m3] = m.meses;
  ok('mes 1 pinado: medicao=60', m1.medicao === '60.00' && m1.pinadaMedicao === true);
  ok('mes 2 nao pinado: medicao=30', m2.medicao === '30.00' && m2.pinadaMedicao === false);
  ok('mes 3 nao pinado (ultimo absorve residuo): medicao=30', m3.medicao === '30.00');
  const soma = m.meses.reduce((a, x) => a + parseFloat(x.medicao), 0);
  ok('soma(medicao) = 120.00 exato', Math.abs(soma - 120) < 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 3. Vários meses pinados + ultimo nao-pinado absorve residuo ─');
{
  // 5 meses, valorTotal=100. Pinar mes 1=30, mes 3=25. Resta 45 para meses 2,4,5.
  // 45/3 = 15.00. Soma antes do último: 15*2=30. Último (mes 5): 45-30=15.
  const id = await criarProjeto({ codigo: 'MT-003', valorTotal: 100, mesesN: 5 });
  projIds.push(id);
  await pinMedicao(id, 2030, 1, 30);
  await pinMedicao(id, 2030, 3, 25);
  const m = await getMeta(id);
  const mMap = Object.fromEntries(m.meses.map(x => [x.mes, x]));
  ok('mes 1 pinado=30', mMap[1].medicao === '30.00' && mMap[1].pinadaMedicao === true);
  ok('mes 3 pinado=25', mMap[3].medicao === '25.00' && mMap[3].pinadaMedicao === true);
  ok('mes 2 nao-pinado=15', mMap[2].medicao === '15.00' && mMap[2].pinadaMedicao === false);
  ok('mes 4 nao-pinado=15', mMap[4].medicao === '15.00');
  ok('mes 5 (ultimo nao-pinado) absorve residuo=15', mMap[5].medicao === '15.00');
  const soma = m.meses.reduce((a, x) => a + parseFloat(x.medicao), 0);
  ok('soma(medicao) = 100.00 exato', Math.abs(soma - 100) < 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 4. CASO DA CLIENTE: medicao=51000 + oficial=61538 → meta=0, deficit=0 ──');
{
  // Estrategia 'proporcional' distribui oficial UNIFORMEMENTE (nao proporcional a medicao).
  // Com valorOficial=123076 em 2 meses: oficialBase = 61538/mes.
  // Pin mes1 em 51000: medicao<oficial → metaHTSemPiso=-10538 → piso → metaHT=0, deficit=0.
  const id = await criarProjeto({ codigo: 'MT-004', valorTotal: 200000, valorOficial: 123076, mesesN: 2, estrategia: 'proporcional' });
  projIds.push(id);
  await pinMedicao(id, 2030, 1, 51000);
  const m = await getMeta(id);
  const mes1 = m.meses[0];
  ok('medicao=51000.00', mes1.medicao === '51000.00');
  ok('oficialAlocado=61538.00 (metade uniforme de 123076)', mes1.oficialAlocado === '61538.00');
  ok('metaHT=0.00 (piso max(0))', mes1.metaHT === '0.00');
  ok('deficit=0.00 (nao negativo)', mes1.deficit === '0.00');
  ok('avisoPiso presente com valor 10538.00', mes1.avisoPiso?.includes('10538.00') ?? false);
  ok('totalCortadoPeloPiso=10538.00', m.resumo.totalCortadoPeloPiso === '10538.00');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 5. Piso com multiplos meses: totalCortadoPeloPiso acumula ───');
{
  // 3 meses, valorTotal=150000, valorOficial=120000, proporcional
  // oficialBase = 40000/mes. Pin mes1=30000, mes3=20000 (ambos abaixo de 40000).
  // totalCortadoPeloPiso = (40000-30000) + (40000-20000) = 10000+20000 = 30000
  const id = await criarProjeto({ codigo: 'MT-005', valorTotal: 150000, valorOficial: 120000, mesesN: 3, estrategia: 'proporcional' });
  projIds.push(id);
  await pinMedicao(id, 2030, 1, 30000);
  await pinMedicao(id, 2030, 3, 20000);
  const m = await getMeta(id);
  const mMap = Object.fromEntries(m.meses.map(x => [x.mes, x]));
  ok('mes 1 metaHT=0.00 (piso)', mMap[1].metaHT === '0.00');
  ok('mes 1 avisoPiso=10000.00', mMap[1].avisoPiso?.includes('10000.00') ?? false);
  ok('mes 2 sem piso (medicao=100000 > oficial=40000)', mMap[2].avisoPiso == null);
  ok('mes 3 metaHT=0.00 (piso)', mMap[3].metaHT === '0.00');
  ok('mes 3 avisoPiso=20000.00', mMap[3].avisoPiso?.includes('20000.00') ?? false);
  ok('totalCortadoPeloPiso=30000.00', m.resumo.totalCortadoPeloPiso === '30000.00');
  ok('cascataPendente=false (piso nao e cascata)', m.resumo.cascataPendente === false);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 6. §4.1 piso ativo: aviso por mes ───────────────────────────');
{
  // 3 meses, valorTotal=90, valorOficial=90, estrategia proporcional (30/mes)
  // Pinar mes 1 em 20 (< 30 de oficial) → piso corta, avisoPiso no mes 1
  const id = await criarProjeto({ codigo: 'MT-006', valorTotal: 90, valorOficial: 90, mesesN: 3, estrategia: 'proporcional' });
  projIds.push(id);
  await pinMedicao(id, 2030, 1, 20);
  const m = await getMeta(id);
  const [m1, m2, m3] = m.meses;
  ok('mes 1 metaHT=0 (piso)', m1.metaHT === '0.00');
  ok('mes 1 avisoPiso presente', m1.avisoPiso != null);
  ok('mes 1 avisoPiso contem o valor correto (10.00)', m1.avisoPiso?.includes('10.00') ?? false);
  ok('mes 2 sem avisoPiso (oficial = medicao)', m2.avisoPiso == null);
  ok('mes 3 sem avisoPiso', m3.avisoPiso == null);
  ok('totalCortadoPeloPiso = 10.00', m.resumo.totalCortadoPeloPiso === '10.00');
  ok('cascataPendente = false (piso nao e cascata)', m.resumo.cascataPendente === false);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 7. §4.2 estouro: pinos acima do valorTotal ──────────────────');
{
  // 3 meses, valorTotal=100. Pinar mes 1=60, mes 2=60 (soma=120 > 100)
  const id = await criarProjeto({ codigo: 'MT-007', valorTotal: 100, mesesN: 3 });
  projIds.push(id);
  await pinMedicao(id, 2030, 1, 60);
  await pinMedicao(id, 2030, 2, 60);
  const m = await getMeta(id);
  ok('avisoEstouroMedicao presente', m.resumo.avisoEstouroMedicao != null);
  ok('avisoEstouroMedicao menciona 20.00', m.resumo.avisoEstouroMedicao?.includes('20.00') ?? false);
  ok('mes 3 (nao-pinado) medicao=0.00', m.meses[2].medicao === '0.00');
  ok('mes 1 e mes 2 mantem seus valores pinados', m.meses[0].medicao === '60.00' && m.meses[1].medicao === '60.00');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 8. Coexistencia pino de medicao + pino de meta ──────────────');
{
  // 2 meses, valorTotal=100. Pinar medicao mes 1=30, pinar meta mes 1=99
  // metaHT final do mes 1 deve ser 99 (pino de META vence)
  const id = await criarProjeto({ codigo: 'MT-008', valorTotal: 100, mesesN: 2 });
  projIds.push(id);
  await pinMedicao(id, 2030, 1, 30);
  await pinMeta(id, 2030, 1, 99);
  const m = await getMeta(id);
  const [m1] = m.meses;
  ok('mes 1 pinadaMedicao=true', m1.pinadaMedicao === true);
  ok('mes 1 pinado(meta)=true', m1.pinado === true);
  ok('mes 1 medicao=30.00 (medição pinada)', m1.medicao === '30.00');
  ok('mes 1 metaHT=99.00 (pino de META vence)', m1.metaHT === '99.00');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 9. Estrategia inicial com medicoes editadas ──────────────────');
{
  // 3 meses, valorTotal=90, valorOficial=70, estrategia=inicial
  // Sem pino: medicao=30/mes. Oficial 70: mes1=30 (esgota 30), mes2=30 (esgota 30), mes3=10 (sobra)
  // Com pino: pinar mes1 em 10. Oficial: mes1=10 (esgota ali), mes2 e mes3 dividem os 60 restantes
  const id = await criarProjeto({ codigo: 'MT-009', valorTotal: 90, valorOficial: 70, mesesN: 3, estrategia: 'inicial' });
  projIds.push(id);
  // Estado inicial (sem pino)
  const mSemPino = await getMeta(id);
  ok('sem pino: mes 1 oficialAlocado=30.00', mSemPino.meses[0].oficialAlocado === '30.00');
  ok('sem pino: mes 2 oficialAlocado=30.00', mSemPino.meses[1].oficialAlocado === '30.00');
  ok('sem pino: mes 3 oficialAlocado=10.00 (sobra)', mSemPino.meses[2].oficialAlocado === '10.00');

  // Pinar mes 1 em 10
  await pinMedicao(id, 2030, 1, 10);
  const mComPino = await getMeta(id);
  // medicao: mes1=10, mes2 e mes3 dividem 80 (40 cada)
  // oficial inicial: mes1=10 (cobre tudo), saldo=60 vai pro mes2 e mes3
  ok('com pino: mes 1 medicao=10 e oficialAlocado=10 (cobrindo tudo)', mComPino.meses[0].medicao === '10.00' && mComPino.meses[0].oficialAlocado === '10.00');
  ok('com pino: mes 2 medicao=40 (redistribuiu)', mComPino.meses[1].medicao === '40.00');
  ok('com pino: mes 2 oficialAlocado=40 (oficial avancou)', mComPino.meses[1].oficialAlocado === '40.00');
  ok('com pino: mes 3 oficialAlocado=20 (sobra do oficial)', parseFloat(mComPino.meses[2].oficialAlocado) === 20);
  ok('oficial redistribuido junto com medicao', mComPino.meses[0].oficialAlocado !== mSemPino.meses[0].oficialAlocado || mComPino.meses[1].oficialAlocado !== mSemPino.meses[1].oficialAlocado);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 10. Mes fechado: rejeita pino de medicao ─────────────────────');
{
  // Criar fechamento para 2025/01 (mês já passado)
  const fecRes = await api('POST', '/api/fechamentos', { ano: 2025, mes: 1 }, ADMIN_TOKEN);
  const fecId  = fecRes.data?.id;

  const id = await criarProjeto({ codigo: 'MT-010', valorTotal: 100, mesesN: 2, inicioAno: 2025, inicioMes: 1 });
  projIds.push(id);
  const r = await pinMedicao(id, 2025, 1, 50);
  ok('PUT pino-medicao em mes fechado → 409', r.status === 409);
  ok('erro menciona fechado', r.data?.error?.includes('fechado') ?? false);

  // Verificar que o mes fechado aparece corretamente no GET (medicao normal, pinadaMedicao=false)
  const m = await getMeta(id);
  const mesFechado = m.meses.find(x => x.ano === 2025 && x.mes === 1);
  ok('mes fechado: fechado=true', mesFechado?.fechado === true);
  ok('mes fechado: pinadaMedicao=false (pino foi rejeitado)', mesFechado?.pinadaMedicao === false);

  if (fecId) await api('DELETE', `/api/fechamentos/${fecId}`, null, ADMIN_TOKEN);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 11. DELETE pino-medicao: restaura distribuicao uniforme ──────');
{
  const id = await criarProjeto({ codigo: 'MT-011', valorTotal: 90, mesesN: 3 });
  projIds.push(id);
  await pinMedicao(id, 2030, 1, 60);
  const antes = await getMeta(id);
  ok('antes: mes 1 medicao=60', antes.meses[0].medicao === '60.00');

  const del = await delMedicao(id, 2030, 1);
  ok('DELETE pino-medicao → 200', del.status === 200);

  const depois = await getMeta(id);
  ok('depois: mes 1 medicao=30 (voltou uniforme)', depois.meses[0].medicao === '30.00');
  ok('depois: pinadaMedicao=false', depois.meses[0].pinadaMedicao === false);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 12. Validacoes dos endpoints ─────────────────────────────────');
{
  const id = await criarProjeto({ codigo: 'MT-012', valorTotal: 100, mesesN: 2 });
  projIds.push(id);
  ok('medicao < 0 → 400',    (await pinMedicao(id, 2030, 1, -1)).status === 400);
  ok('ano invalido → 400',   (await pinMedicao(id, 1900, 1, 10)).status === 400);
  ok('mes fora vigencia → 400', (await pinMedicao(id, 2031, 6, 10)).status === 400);
  ok('DELETE sem pino → 404', (await delMedicao(id, 2030, 1)).status === 404);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── Limpeza ───────────────────────────────────────────────────────');
for (const id of projIds) {
  try { await api('DELETE', `/api/projetos/${id}`, null, TOKEN); } catch {}
}
console.log(`  ${projIds.length} projetos removidos.`);

// ── Resultado ──────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════');
console.log(`  TOTAL: ${passed + failed} | ✅ ${passed} | ❌ ${failed}`);
if (erros.length) console.log('  Falhas:', erros);
process.exit(failed > 0 ? 1 : 0);
