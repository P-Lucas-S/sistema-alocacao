// Script de inspeção detalhada do teste de segurança do filtro por gestor
// Mostra os IDs/códigos concretos para cada endpoint — sem alterar nada.
// node test-seguranca-detalhe.mjs

const BASE = 'http://localhost:3001/api';
const ANO = 2026; const MES = 6;
const G1 = 'seed-gestor-001';
const G2 = 'seed-gestor-002';

async function login(email, password) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  return d.token;
}

async function api(method, path, token) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  let d = null;
  try { d = await r.json(); } catch {}
  return { status: r.status, data: d };
}

function listProj(arr) {
  if (!arr || arr.length === 0) return '(vazio)';
  return arr.map(p => p.codigo || p.projetoId || p.id).sort().join(', ');
}

async function main() {
  const tAdmin   = await login('admin@sistema.dev',   'admin123');
  const tGestor1 = await login('gestor1@sistema.dev', 'gestor123');
  const tChefe   = await login('chefe@sistema.dev',   'chefe123');

  // ── Dados base: projetos de cada gestor ───────────────────────────────────
  const { data: projG1All }  = await api('GET', '/projetos', tGestor1);
  const { data: projG2All }  = await api('GET', '/projetos?gestorId=' + G2, tAdmin);
  const { data: projAll }    = await api('GET', '/projetos', tAdmin);

  const idsG1  = new Set(projG1All.map(p => p.id));
  const idsG2  = new Set(projG2All.map(p => p.id));
  const codsG1 = projG1All.map(p => p.codigo).sort();
  const codsG2 = projG2All.map(p => p.codigo).sort();

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║           INSPEÇÃO DE SEGURANÇA — FILTRO DO CHEFE POR GESTOR            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');

  console.log('\n━━━ CONTEXTO: quem tem o quê ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Gestor1 (${G1}) — ${projG1All.length} projetos: ${codsG1.join(', ')}`);
  console.log(`  Gestor2 (${G2}) — ${projG2All.length} projetos: ${codsG2.join(', ')}`);
  console.log(`  Total (admin)   — ${projAll.length} projetos: ${projAll.map(p=>p.codigo).sort().join(', ')}`);

  const intersect = codsG1.filter(c => codsG2.includes(c));
  console.log(`\n  Interseção G1∩G2: ${intersect.length === 0 ? '✅ ZERO projetos em comum (conjuntos distintos)' : '⚠️  ' + intersect.join(', ')}`);

  // ══════════════════════════════════════════════════════════════════════════
  // ENDPOINT 1: /api/projetos
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n━━━ ENDPOINT 1: /api/projetos ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  {
    const { data } = await api('GET', '/projetos?gestorId=' + G2, tGestor1);
    const retornados = data.map(p => p.codigo).sort();
    const vazamento  = retornados.filter(c => codsG2.includes(c));

    console.log(`  Gestor1 chama: GET /projetos?gestorId=${G2}`);
    console.log(`  Resultado (${data.length} proj): ${retornados.join(', ')}`);
    console.log(`  Esperado     (${codsG1.length} proj): ${codsG1.join(', ')}`);
    console.log(`  Projetos de G2 na resposta: ${vazamento.length === 0 ? '✅ NENHUM' : '❌ VAZAMENTO: ' + vazamento.join(', ')}`);
    console.log(`  Contagens batem: ${data.length === codsG1.length ? '✅ SIM (' + data.length + '==' + codsG1.length + ')' : '❌ NÃO (' + data.length + '!=' + codsG1.length + ')'}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ENDPOINT 2: /api/alocacoes/grid
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n━━━ ENDPOINT 2: /api/alocacoes/grid ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  {
    const { data } = await api('GET', `/alocacoes/grid?ano=${ANO}&mes=${MES}&gestorId=${G2}`, tGestor1);
    const projGrid   = data?.projetos ?? [];
    const retornados = projGrid.map(p => p.codigo).sort();
    const vazamento  = retornados.filter(c => codsG2.includes(c));

    console.log(`  Gestor1 chama: GET /alocacoes/grid?ano=${ANO}&mes=${MES}&gestorId=${G2}`);
    console.log(`  Projetos na grade (${projGrid.length}): ${retornados.length ? retornados.join(', ') : '(vazio — sem alocações no mês)'}`);
    console.log(`  Projetos de G2 na grade: ${vazamento.length === 0 ? '✅ NENHUM' : '❌ VAZAMENTO: ' + vazamento.join(', ')}`);
    console.log(`  Contagem ≤ cntG1: ${projGrid.length <= codsG1.length ? '✅ SIM (' + projGrid.length + '<=' + codsG1.length + ')' : '❌ NÃO'}`);

    // Verifica o mesmo mês SEM filtro para G1 (baseline do grid)
    const { data: gridBase } = await api('GET', `/alocacoes/grid?ano=${ANO}&mes=${MES}`, tGestor1);
    const baseGrid = gridBase?.projetos ?? [];
    console.log(`  Baseline G1 (sem ?gestorId): ${baseGrid.length} proj — ${baseGrid.map(p=>p.codigo).sort().join(', ')}`);
    console.log(`  Resultado COM ?gestorId=G2 idêntico ao baseline: ${JSON.stringify(retornados) === JSON.stringify(baseGrid.map(p=>p.codigo).sort()) ? '✅ SIM' : '❌ NÃO'}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ENDPOINT 3: /api/relatorios/custos
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n━━━ ENDPOINT 3: /api/relatorios/custos ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  {
    const { data } = await api('GET', '/relatorios/custos?gestorId=' + G2, tGestor1);
    const retornados = data.map(p => p.codigo).sort();
    const vazamento  = retornados.filter(c => codsG2.includes(c));

    console.log(`  Gestor1 chama: GET /relatorios/custos?gestorId=${G2}`);
    console.log(`  Resultado (${data.length} proj): ${retornados.join(', ')}`);
    console.log(`  Esperado     (${codsG1.length} proj): ${codsG1.join(', ')}`);
    console.log(`  Projetos de G2 na resposta: ${vazamento.length === 0 ? '✅ NENHUM' : '❌ VAZAMENTO: ' + vazamento.join(', ')}`);
    console.log(`  Contagens batem: ${data.length === codsG1.length ? '✅ SIM (' + data.length + '==' + codsG1.length + ')' : '❌ NÃO'}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ENDPOINT 4: /api/dashboards/projetos  (Prioridades)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n━━━ ENDPOINT 4: /api/dashboards/projetos (Prioridades) ━━━━━━━━━━━━━━━');
  {
    const { data } = await api('GET', `/dashboards/projetos?ano=${ANO}&mes=${MES}&gestorId=${G2}`, tGestor1);
    // Desde o fixar/pausar o shape é { itens, pausados, totalPausados, ... },
    // não mais um array puro. Pausados continuam no MESMO escopo de gestor
    // que itens — só saíram da fila ativa — então um projeto de G2 vazando
    // em pausados é vazamento igual a vazar em itens: a verificação junta os
    // dois.
    const todos = [...(data.itens ?? []), ...(data.pausados ?? [])];
    const retornados = todos.map(p => p.codigo).sort();
    const vazamento  = retornados.filter(c => codsG2.includes(c));

    console.log(`  Gestor1 chama: GET /dashboards/projetos?ano=${ANO}&mes=${MES}&gestorId=${G2}`);
    console.log(`  Resultado (${todos.length} proj no mês, itens+pausados): ${retornados.length ? retornados.join(', ') : '(0 — sem alocações no mês para G1)'}`);
    console.log(`  Projetos de G2 na resposta: ${vazamento.length === 0 ? '✅ NENHUM' : '❌ VAZAMENTO: ' + vazamento.join(', ')}`);
    console.log(`  Contagem ≤ cntG1: ${todos.length <= codsG1.length ? '✅ SIM (' + todos.length + '<=' + codsG1.length + ')' : '❌ NÃO'}`);

    // Baseline sem filtro para comparar (também itens+pausados)
    const { data: dashBase } = await api('GET', `/dashboards/projetos?ano=${ANO}&mes=${MES}`, tGestor1);
    const todosBase = [...(dashBase.itens ?? []), ...(dashBase.pausados ?? [])];
    console.log(`  Baseline G1 (sem ?gestorId): ${todosBase.length} proj — ${todosBase.map(p=>p.codigo).sort().join(', ')}`);
    console.log(`  Resultado COM ?gestorId=G2 idêntico ao baseline: ${JSON.stringify(retornados) === JSON.stringify(todosBase.map(p=>p.codigo).sort()) ? '✅ SIM' : '❌ NÃO'}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CASO POSITIVO: chefe com ?gestorId=G1 → recebe exatamente os proj de G1
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n━━━ CASO POSITIVO: chefe filtra por gestor1 ━━━━━━━━━━━━━━━━━━━━━━━━━━');
  {
    const { data } = await api('GET', '/projetos?gestorId=' + G1, tChefe);
    const retornados = data.map(p => p.codigo).sort();
    const extra = retornados.filter(c => !codsG1.includes(c));
    const faltam = codsG1.filter(c => !retornados.includes(c));

    console.log(`  Chefe chama: GET /projetos?gestorId=${G1}`);
    console.log(`  Resultado (${data.length} proj): ${retornados.join(', ')}`);
    console.log(`  Esperado  (${codsG1.length} proj): ${codsG1.join(', ')}`);
    console.log(`  Projetos extras (não são de G1): ${extra.length === 0 ? '✅ NENHUM' : '❌ ' + extra.join(', ')}`);
    console.log(`  Projetos de G1 faltando: ${faltam.length === 0 ? '✅ NENHUM' : '❌ ' + faltam.join(', ')}`);
    console.log(`  Resultado == conjunto G1: ${extra.length === 0 && faltam.length === 0 ? '✅ SIM' : '❌ NÃO'}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SEM FILTRO: chefe sem ?gestorId= → todos os projetos
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n━━━ SEM FILTRO: chefe → todos os projetos ━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  {
    const { data } = await api('GET', '/projetos', tChefe);
    const retornados = data.map(p => p.codigo).sort();
    const total      = projAll.map(p => p.codigo).sort();
    console.log(`  Chefe chama: GET /projetos (sem ?gestorId=)`);
    console.log(`  Resultado (${data.length} proj): ${retornados.join(', ')}`);
    console.log(`  Total admin  (${total.length} proj): ${total.join(', ')}`);
    console.log(`  Chefe vê tudo: ${data.length === total.length ? '✅ SIM (' + data.length + '==' + total.length + ')' : '❌ NÃO (' + data.length + '!=' + total.length + ')'}`);
  }

  console.log('\n══════════════════════════════════════════════════════════════════════════');
}

main().catch(e => { console.error(e); process.exit(1); });
