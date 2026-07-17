// FASE A — Teste do filtro do chefe por gestor (?gestorId=)
// 4 endpoints: /api/alocacoes/grid, /api/projetos, /api/relatorios/custos, /api/dashboards/projetos
// Cobre: segurança (gestor ignora o param), filtro amplo, erros 400, requireRole do Custos
// node test-filtro-gestor.mjs (backend em http://localhost:3001)

const BASE = 'http://localhost:3001/api';
const ANO = 2026; const MES = 6;

const G1 = 'seed-gestor-001';
const G2 = 'seed-gestor-002';

let pass = 0; let fail = 0;

function ok(label, cond, extra) {
  if (cond) { console.log(`  ✅ ${label}`); pass++; }
  else       { console.log(`  ❌ ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); fail++; }
}

async function login(email, password) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  if (r.status !== 200) throw new Error(`Login falhou: ${email} → ${r.status} ${JSON.stringify(d)}`);
  return d.token;
}

async function api(method, path, token, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let d = null;
  try { d = await r.json(); } catch { /* sem corpo */ }
  return { status: r.status, data: d };
}

async function main() {
  // ── Login ──────────────────────────────────────────────────────────────────
  console.log('── Setup: login ──────────────────────────────────────────────────────────');
  const [tAdmin, tGestor1, tGestor2, tChefe, tCoord, tDiretor] = await Promise.all([
    login('admin@sistema.dev',    'admin123'),
    login('gestor1@sistema.dev',  'gestor123'),
    login('gestor2@sistema.dev',  'gestor123'),
    login('chefe@sistema.dev',    'chefe123'),
    login('coord@sistema.dev',    'coord123'),
    login('diretor@sistema.dev',  'diretor123'),
  ]);
  console.log('  Todos os 6 usuários logaram com sucesso.');

  // ── Baseline: quantos projetos cada gestor tem ────────────────────────────
  const { data: projG1 } = await api('GET', '/projetos', tGestor1);
  const { data: projG2 } = await api('GET', '/projetos', tGestor2);
  const { data: projAll } = await api('GET', '/projetos', tAdmin);
  const cntG1  = projG1?.length ?? 0;
  const cntG2  = projG2?.length ?? 0;
  const cntAll = projAll?.length ?? 0;
  console.log(`\n  Baseline: G1=${cntG1} proj | G2=${cntG2} proj | total=${cntAll} proj`);

  // ═══════════════════════════════════════════════════════════════════════════
  // SEÇÃO 1 — ANTI-REGRESSÃO: sem ?gestorId= o comportamento é idêntico
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── 1. Anti-regressão: sem ?gestorId= ────────────────────────────────────');

  {
    const { status, data } = await api('GET', `/projetos`, tAdmin);
    ok('Admin sem filtro → 200', status === 200, status);
    ok('Admin sem filtro → todos os projetos', (data?.length ?? 0) === cntAll, data?.length);
  }
  {
    const { status, data } = await api('GET', `/projetos`, tGestor1);
    ok('Gestor1 sem filtro → seus projetos', status === 200 && data?.length === cntG1, data?.length);
  }
  {
    const { status } = await api('GET', `/alocacoes/grid?ano=${ANO}&mes=${MES}`, tAdmin);
    ok('Grid admin sem filtro → 200', status === 200, status);
  }
  {
    const { status } = await api('GET', `/dashboards/projetos?ano=${ANO}&mes=${MES}`, tAdmin);
    ok('Dashboard admin sem filtro → 200', status === 200, status);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEÇÃO 2 — ⚠️  SEGURANÇA CRÍTICA: gestor com ?gestorId= de OUTRO gestor
  //           DEVE ser IGNORADO — gestor vê SOMENTE os próprios projetos
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── 2. ⚠️  SEGURANÇA — gestor não pode espiar outro gestor ───────────────');

  // 2a. /api/projetos
  {
    const { status, data } = await api('GET', `/projetos?gestorId=${G2}`, tGestor1);
    ok('[PROJETOS] Gestor1 + ?gestorId=G2 → 200 (não 400/403)', status === 200, status);
    ok('[PROJETOS] Gestor1 + ?gestorId=G2 → vê SOMENTE os próprios (cntG1)', data?.length === cntG1, `esperado=${cntG1} recebido=${data?.length}`);
    ok('[PROJETOS] Gestor1 + ?gestorId=G2 → NÃO vê projetos de G2', data?.length !== cntG2 || cntG1 === cntG2, `era pra ser ${cntG1} mas veio ${data?.length}`);
  }
  {
    const { status, data } = await api('GET', `/projetos?gestorId=${G1}`, tGestor2);
    ok('[PROJETOS] Gestor2 + ?gestorId=G1 → vê SOMENTE os próprios (cntG2)', data?.length === cntG2 && status === 200, `status=${status} cnt=${data?.length}`);
  }

  // 2b. /api/alocacoes/grid
  {
    const { status, data } = await api('GET', `/alocacoes/grid?ano=${ANO}&mes=${MES}&gestorId=${G2}`, tGestor1);
    ok('[GRID] Gestor1 + ?gestorId=G2 → 200', status === 200, status);
    const qtdProjGrid = data?.projetos?.length ?? -1;
    ok('[GRID] Gestor1 + ?gestorId=G2 → projetos = cntG1 (filtro ignorado)', qtdProjGrid === cntG1, `esperado=${cntG1} recebido=${qtdProjGrid}`);
  }

  // 2c. /api/relatorios/custos
  {
    const { status, data } = await api('GET', `/relatorios/custos?gestorId=${G2}`, tGestor1);
    ok('[CUSTOS] Gestor1 + ?gestorId=G2 → 200', status === 200, status);
    ok('[CUSTOS] Gestor1 + ?gestorId=G2 → resultado = cntG1 projetos', data?.length === cntG1, `esperado=${cntG1} recebido=${data?.length}`);
  }

  // 2d. /api/dashboards/projetos
  {
    const { status, data } = await api('GET', `/dashboards/projetos?ano=${ANO}&mes=${MES}&gestorId=${G2}`, tGestor1);
    ok('[DASHBOARD] Gestor1 + ?gestorId=G2 → 200', status === 200, status);
    // dashboard retorna só projetos COM alocação no mês — pode ser 0; o que valida é que
    // o escopo não mudou ao passar gestorId alheio (se > 0, deve ser ≤ cntG1)
    const qtd = data?.length ?? -1;
    ok('[DASHBOARD] Gestor1 + ?gestorId=G2 → escopo não ultrapassou cntG1', qtd <= cntG1, `cntG1=${cntG1} recebido=${qtd}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEÇÃO 3 — FILTRO AMPLO: admin/chefe com ?gestorId= vê só aquele gestor
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── 3. Filtro amplo: admin/chefe vê só o gestor-alvo ─────────────────────');

  // 3a. Admin filtra por G1
  {
    const { status, data } = await api('GET', `/projetos?gestorId=${G1}`, tAdmin);
    ok('[PROJETOS] Admin + ?gestorId=G1 → 200', status === 200, status);
    ok('[PROJETOS] Admin + ?gestorId=G1 → cntG1 projetos', data?.length === cntG1, `esperado=${cntG1} recebido=${data?.length}`);
  }
  // 3b. Admin filtra por G2
  {
    const { status, data } = await api('GET', `/projetos?gestorId=${G2}`, tAdmin);
    ok('[PROJETOS] Admin + ?gestorId=G2 → cntG2 projetos', status === 200 && data?.length === cntG2, `status=${status} cnt=${data?.length}`);
  }
  // 3c. Chefe filtra por G1 no grid
  {
    const { status, data } = await api('GET', `/alocacoes/grid?ano=${ANO}&mes=${MES}&gestorId=${G1}`, tChefe);
    ok('[GRID] Chefe + ?gestorId=G1 → 200', status === 200, status);
    const qtd = data?.projetos?.length ?? -1;
    ok('[GRID] Chefe + ?gestorId=G1 → projetos = cntG1', qtd === cntG1, `esperado=${cntG1} recebido=${qtd}`);
  }
  // 3d. Chefe filtra por G1 no /relatorios/custos
  {
    const { status, data } = await api('GET', `/relatorios/custos?gestorId=${G1}`, tChefe);
    ok('[CUSTOS] Chefe + ?gestorId=G1 → 200 e cntG1 projetos', status === 200 && data?.length === cntG1, `status=${status} cnt=${data?.length}`);
  }
  // 3e. Admin filtra por G1 no dashboard
  {
    const { status } = await api('GET', `/dashboards/projetos?ano=${ANO}&mes=${MES}&gestorId=${G1}`, tAdmin);
    ok('[DASHBOARD] Admin + ?gestorId=G1 → 200', status === 200, status);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEÇÃO 4 — ERROS: gestorId inválido → 400
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── 4. Erros: gestorId inválido → 400 ───────────────────────────────────');

  // 4a. ID inexistente
  {
    const { status } = await api('GET', `/projetos?gestorId=nao-existe-xyz`, tAdmin);
    ok('[PROJETOS] Admin + gestorId inexistente → 400', status === 400, status);
  }
  // 4b. ID de usuário com papel errado (admin, não gestor)
  {
    // Precisa do ID do admin — busca via /api/users
    const { data: users } = await api('GET', '/users', tAdmin);
    const adminUser = users?.find(u => u.role === 'admin');
    if (adminUser) {
      const { status } = await api('GET', `/projetos?gestorId=${adminUser.id}`, tAdmin);
      ok('[PROJETOS] Admin + gestorId=<admin> → 400 (papel errado)', status === 400, status);
    } else {
      ok('[PROJETOS] Admin + gestorId=<admin> → 400 (papel errado)', false, 'admin não encontrado em /api/users');
    }
  }
  // 4c. Mesmo no grid
  {
    const { status } = await api('GET', `/alocacoes/grid?ano=${ANO}&mes=${MES}&gestorId=id-invalido`, tAdmin);
    ok('[GRID] gestorId inválido → 400', status === 400, status);
  }
  // 4d. Mesmo no custos
  {
    const { status } = await api('GET', `/relatorios/custos?gestorId=id-invalido`, tChefe);
    ok('[CUSTOS] gestorId inválido → 400', status === 400, status);
  }
  // 4e. Mesmo no dashboard
  {
    const { status } = await api('GET', `/dashboards/projetos?ano=${ANO}&mes=${MES}&gestorId=id-invalido`, tAdmin);
    ok('[DASHBOARD] gestorId inválido → 400', status === 400, status);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEÇÃO 5 — requireRole: Custos agora acessível a chefe/coord/diretor
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── 5. Custos: chefe/coord/diretor agora passam (antes 403) ──────────────');

  {
    const { status } = await api('GET', '/relatorios/custos', tChefe);
    ok('Chefe → /relatorios/custos → 200 (antes era 403)', status === 200, status);
  }
  {
    const { status } = await api('GET', '/relatorios/custos', tCoord);
    ok('Coordenação → /relatorios/custos → 200 (antes era 403)', status === 200, status);
  }
  {
    const { status } = await api('GET', '/relatorios/custos', tDiretor);
    ok('Diretor → /relatorios/custos → 200 (antes era 403)', status === 200, status);
  }

  // ── Resultado ──────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(65)}`);
  console.log(`  ${pass + fail} testes — ✅ ${pass} passou  ❌ ${fail} falhou`);
  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
