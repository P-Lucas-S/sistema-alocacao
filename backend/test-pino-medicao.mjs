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
console.log('\n── 4. CASO DA CLIENTE: medicao=51000 + oficial=61538 → transbordo para mes2 ──');
{
  // Com transbordo: oficialBase=61538/mes. Mes1 (pin=51000 < 61538):
  //   carry = 61538-51000 = 10538 → oa[mes1]=51000, oa[mes2]=61538+10538=72076.
  //   medicao[mes2] = 200000-51000 = 149000 > 72076 → sem piso.
  // Antes do transbordo: piso disparava no mes1, metaHT=0 por corte. Agora: metaHT=0
  // porque oa=medicao (sem corte), e avisoPiso = null. soma(oa)=123076 exato.
  const id = await criarProjeto({ codigo: 'MT-004', valorTotal: 200000, valorOficial: 123076, mesesN: 2, estrategia: 'proporcional' });
  projIds.push(id);
  await pinMedicao(id, 2030, 1, 51000);
  const m = await getMeta(id);
  const [mes1, mes2] = m.meses;
  ok('mes1: medicao=51000.00', mes1.medicao === '51000.00');
  ok('mes1: oficial capped na medicao (51000.00, carry=10538 → mes2)', mes1.oficialAlocado === '51000.00');
  ok('mes1: metaHT=0.00 (oa=medicao, sem piso)', mes1.metaHT === '0.00');
  ok('mes1: deficit=0.00', mes1.deficit === '0.00');
  ok('mes1: avisoPiso=null (transbordo elimina o piso)', mes1.avisoPiso == null);
  ok('mes2: oficial=72076.00 (61538 + 10538 carry)', mes2.oficialAlocado === '72076.00');
  ok('mes2: metaHT=76924.00 (149000-72076)', mes2.metaHT === '76924.00');
  ok('totalCortadoPeloPiso=0.00 (nenhum mes com piso)', m.resumo.totalCortadoPeloPiso === '0.00');
  // soma(oa) = 51000+72076 = 123076 exato
  const somaOa = m.meses.reduce((acc, x) => acc + Math.round(parseFloat(x.oficialAlocado) * 100), 0) / 100;
  ok('INVARIANTE soma(oficialAlocado)=123076.00 exato', somaOa.toFixed(2) === '123076.00', somaOa);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 5. Piso com multiplos meses: transbordo resolve mes1, mes3 ainda preso ──');
{
  // 3 meses, vT=150000, vO=120000, proporcional. oficialBase=40000/mes.
  // Pin mes1=30000, mes3=20000. medicao[mes2]=100000.
  // Carry pass: mes1 raw=40000>30000 → oa=30000, carry=10000.
  //   mes2 raw=50000<100000 → oa=50000, carry=0.
  //   mes3 raw=40000>20000 → oa=20000, carry=20000.
  // Carry residual: mes3 e o ultimo mes → oa[mes3]+=20000 → oa=40000.
  // mes3 oa=40000>med=20000: piso ainda dispara (nao ha proximo mes).
  // Resultado: mes1 sem piso (carry resolveu), mes3 com piso (sem saida).
  // soma(oa) = 30000+50000+40000 = 120000 exato.
  const id = await criarProjeto({ codigo: 'MT-005', valorTotal: 150000, valorOficial: 120000, mesesN: 3, estrategia: 'proporcional' });
  projIds.push(id);
  await pinMedicao(id, 2030, 1, 30000);
  await pinMedicao(id, 2030, 3, 20000);
  const m = await getMeta(id);
  const mMap = Object.fromEntries(m.meses.map(x => [x.mes, x]));
  ok('mes 1 metaHT=0.00 (oa=medicao, sem piso)', mMap[1].metaHT === '0.00');
  ok('mes 1 avisoPiso=null (carry transferiu o excesso para mes2)', mMap[1].avisoPiso == null);
  ok('mes 2 sem piso (oa=50000 absorveu carry, medicao=100000)', mMap[2].avisoPiso == null);
  ok('mes 3 metaHT=0.00 (piso: oa=40000>med=20000, sem proximo mes)', mMap[3].metaHT === '0.00');
  ok('mes 3 avisoPiso=20000.00 (excesso sem saida)', mMap[3].avisoPiso?.includes('20000.00') ?? false);
  ok('totalCortadoPeloPiso=20000.00 (so mes3, carry resolveu mes1)', m.resumo.totalCortadoPeloPiso === '20000.00');
  ok('cascataPendente=false (piso nao e cascata)', m.resumo.cascataPendente === false);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 6. §4.1 transbordo absorve carry em cadeia, piso some totalmente ──');
{
  // 3 meses, vT=90, vO=90, proporcional (30/mes). Pin mes1=20.
  // medicao: mes1=20, mes2=35, mes3=35 (70 dividido em 2).
  // Carry pass: mes1 raw=30>20 → oa=20, carry=10.
  //   mes2 raw=40>35 → oa=35, carry=5.
  //   mes3 raw=35=35 → oa=35, carry=0.
  // Todos os meses ficam com oa=medicao: metaHT=0 em todos, sem piso em nenhum.
  // valorHT=0 → soma(metaHT)=0 correto. totalCortadoPeloPiso=0.
  const id = await criarProjeto({ codigo: 'MT-006', valorTotal: 90, valorOficial: 90, mesesN: 3, estrategia: 'proporcional' });
  projIds.push(id);
  await pinMedicao(id, 2030, 1, 20);
  const m = await getMeta(id);
  const [m1, m2, m3] = m.meses;
  ok('mes 1 metaHT=0 (oa=20=medicao, sem piso)', m1.metaHT === '0.00');
  ok('mes 1 avisoPiso=null (carry eliminou o excesso)', m1.avisoPiso == null);
  ok('mes 2 metaHT=0 (oa=35=medicao, carry de mes1 absorvido)', m2.metaHT === '0.00');
  ok('mes 2 sem avisoPiso', m2.avisoPiso == null);
  ok('mes 3 sem avisoPiso', m3.avisoPiso == null);
  ok('totalCortadoPeloPiso = 0.00 (transbordo em cadeia eliminou todos os pisos)', m.resumo.totalCortadoPeloPiso === '0.00');
  ok('cascataPendente = false', m.resumo.cascataPendente === false);
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
console.log('\n── 13. Exemplo numerico: 12 meses, mes1 pinado baixo, carry para mes2 ──');
{
  // vT=600000, vO=120000, proporcional, 12 meses, pin mes1=5000.
  // oficialBase = 120000/12 = 10000 exato.
  // medicao: mes1=5000; mes2-mes11=54090.91; mes12=54090.90 (residuo).
  // Carry pass: mes1 raw=10000>5000 → oa=5000, carry=5000.
  //   mes2 raw=15000<54090.91 → oa=15000, carry=0. Demais: oa=10000.
  // soma(oa) = 5000+15000+10×10000 = 120000 exato.
  // soma(metaHT) = 0+39090.91+9×44090.91+44090.90 = 480000 = valorHT exato.
  // ANTES do transbordo: soma(metaHT) = 485000 ≠ 480000 (5000 presos no piso).
  // O transbordo corrige uma inconsistencia real, nao so atende a cliente.
  const id = await criarProjeto({ codigo: 'MT-013', valorTotal: 600000, valorOficial: 120000, mesesN: 12, estrategia: 'proporcional' });
  projIds.push(id);
  await pinMedicao(id, 2030, 1, 5000);
  const m = await getMeta(id);
  const mes = Object.fromEntries(m.meses.map(x => [x.mes, x]));

  ok('mes1: oficial=5000.00 (carry=5000 para mes2)', mes[1].oficialAlocado === '5000.00');
  ok('mes1: metaHT=0.00 (oa=medicao, sem piso)', mes[1].metaHT === '0.00');
  ok('mes1: avisoPiso=null', mes[1].avisoPiso == null);
  ok('mes2: oficial=15000.00 (10000+5000 carry)', mes[2].oficialAlocado === '15000.00');
  ok('mes2: metaHT=39090.91 (54090.91-15000)', mes[2].metaHT === '39090.91');
  ok('mes3: oficial=10000.00 (sem carry)', mes[3].oficialAlocado === '10000.00');
  ok('mes3: metaHT=44090.91', mes[3].metaHT === '44090.91');
  ok('totalCortadoPeloPiso=0.00', m.resumo.totalCortadoPeloPiso === '0.00');

  const somaOa  = m.meses.reduce((acc, x) => acc + Math.round(parseFloat(x.oficialAlocado) * 100), 0);
  const somaMHT = m.meses.reduce((acc, x) => acc + Math.round(parseFloat(x.metaHT) * 100), 0);
  ok('INVARIANTE soma(oficialAlocado)=120000.00 exato', somaOa === 12000000, somaOa);
  ok('INVARIANTE soma(metaHT)=480000.00 exato (era 485000 antes do transbordo)', somaMHT === 48000000, somaMHT);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 14. Carry em cadeia: dois meses baixos seguidos, excedente acumula ──');
{
  // 4 meses, vT=100000, vO=90000, proporcional. oficialBase=22500.
  // Pin mes1=10000, mes2=10000. medicao: mes3=40000, mes4=40000.
  // Carry pass:
  //   mes1 raw=22500>10000 → oa=10000, carry=12500.
  //   mes2 raw=35000>10000 → oa=10000, carry=25000.
  //   mes3 raw=47500>40000 → oa=40000, carry=7500.
  //   mes4 raw=30000<40000 → oa=30000, carry=0.
  // soma(oa) = 10000+10000+40000+30000 = 90000 exato.
  // metaHT: mes1=0, mes2=0, mes3=0, mes4=10000. soma=10000=vHT exato.
  // totalCortadoPeloPiso=0.
  const id = await criarProjeto({ codigo: 'MT-014', valorTotal: 100000, valorOficial: 90000, mesesN: 4, estrategia: 'proporcional' });
  projIds.push(id);
  await pinMedicao(id, 2030, 1, 10000);
  await pinMedicao(id, 2030, 2, 10000);
  const m = await getMeta(id);
  const mes = Object.fromEntries(m.meses.map(x => [x.mes, x]));

  ok('mes1: oficial=10000.00 (carry=12500)', mes[1].oficialAlocado === '10000.00');
  ok('mes1: metaHT=0.00, avisoPiso=null', mes[1].metaHT === '0.00' && mes[1].avisoPiso == null);
  ok('mes2: oficial=10000.00 (carry acumulou=25000)', mes[2].oficialAlocado === '10000.00');
  ok('mes2: metaHT=0.00, avisoPiso=null', mes[2].metaHT === '0.00' && mes[2].avisoPiso == null);
  ok('mes3: oficial=40000.00 (carry=25000 absorvido)', mes[3].oficialAlocado === '40000.00');
  ok('mes3: metaHT=0.00 (oa=medicao)', mes[3].metaHT === '0.00');
  ok('mes4: oficial=30000.00 (carry=7500 absorvido, sobra=10000 p/ metaHT)', mes[4].oficialAlocado === '30000.00');
  ok('mes4: metaHT=10000.00', mes[4].metaHT === '10000.00');
  ok('totalCortadoPeloPiso=0.00 (carry resolveu todos)', m.resumo.totalCortadoPeloPiso === '0.00');

  const somaOa  = m.meses.reduce((acc, x) => acc + Math.round(parseFloat(x.oficialAlocado) * 100), 0);
  const somaMHT = m.meses.reduce((acc, x) => acc + Math.round(parseFloat(x.metaHT) * 100), 0);
  ok('INVARIANTE soma(oa)=90000.00 exato', somaOa === 9000000, somaOa);
  ok('INVARIANTE soma(metaHT)=10000.00 exato', somaMHT === 1000000, somaMHT);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 15. Regressao: inicial NAO foi afetada pelo transbordo ───────');
{
  // Mesmo cenario do T13 mas com estrategia='inicial'. O resultado deve ser
  // identico ao comportamento pre-transbordo (a 'inicial' ja era transbordo
  // por construcao — o carry da 'proporcional' nao toca nela).
  // 12 meses, vT=600000, vO=120000, pin mes1=5000.
  // Greedy: mes1=5000(saldo 115000), mes2=54090.91(saldo 60909.09),
  //   mes3=54090.91(saldo 6818.18), mes4=6818.18(saldo 0), mes5-12=0.
  // soma(oa)=120000, soma(metaHT)=480000.
  const id = await criarProjeto({ codigo: 'MT-015', valorTotal: 600000, valorOficial: 120000, mesesN: 12, estrategia: 'inicial' });
  projIds.push(id);
  await pinMedicao(id, 2030, 1, 5000);
  const m = await getMeta(id);
  const mes = Object.fromEntries(m.meses.map(x => [x.mes, x]));

  ok('inicial: mes1 oficialAlocado=5000.00 (saldo→115000)', mes[1].oficialAlocado === '5000.00');
  ok('inicial: mes1 metaHT=0.00', mes[1].metaHT === '0.00');
  ok('inicial: mes2 oficialAlocado=54090.91 (greedy, saldo→60909.09)', mes[2].oficialAlocado === '54090.91');
  ok('inicial: mes2 metaHT=0.00', mes[2].metaHT === '0.00');
  ok('inicial: mes3 oficialAlocado=54090.91 (saldo→6818.18)', mes[3].oficialAlocado === '54090.91');
  ok('inicial: mes4 oficialAlocado=6818.18 (saldo esgotado)', mes[4].oficialAlocado === '6818.18');
  ok('inicial: mes4 metaHT=47272.73 (54090.91-6818.18)', mes[4].metaHT === '47272.73');
  ok('inicial: mes5 oficialAlocado=0.00', mes[5].oficialAlocado === '0.00');
  ok('inicial: totalCortadoPeloPiso=0.00 (piso nunca dispara na inicial)', m.resumo.totalCortadoPeloPiso === '0.00');

  const somaOa  = m.meses.reduce((acc, x) => acc + Math.round(parseFloat(x.oficialAlocado) * 100), 0);
  const somaMHT = m.meses.reduce((acc, x) => acc + Math.round(parseFloat(x.metaHT) * 100), 0);
  ok('INVARIANTE soma(oa)=120000.00 exato', somaOa === 12000000, somaOa);
  ok('INVARIANTE soma(metaHT)=480000.00 exato', somaMHT === 48000000, somaMHT);
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
