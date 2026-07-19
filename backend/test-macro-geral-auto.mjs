// test-macro-geral-auto.mjs
// Verifica que todo projeto novo nasce com macro "Geral" + micro "Geral" automáticas.
// Rode com: node test-macro-geral-auto.mjs (backend em http://localhost:3001)

const BASE  = 'http://localhost:3001/api';
const STAMP = Date.now();

let pass = 0;
let fail = 0;

function ok(label, condition, extra) {
  if (condition) { pass++; console.log(`  ✅ ${label}`); }
  else           { fail++; console.log(`  ❌ ${label}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`); }
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

async function login(email, password) {
  const { status, data } = await api('POST', '/auth/login', null, { email, password });
  if (status !== 200 || !data?.token) throw new Error(`Login falhou para ${email}: ${JSON.stringify(data)}`);
  return data.token;
}

// ── Boot ─────────────────────────────────────────────────────────────────────
const adminToken   = await login('admin@sistema.dev',   'admin123');
const gestorToken  = await login('gestor1@sistema.dev', 'gestor123');

const { data: categorias } = await api('GET', '/categorias', adminToken);
const categoriaId = categorias?.find(c => c.ativo)?.id;
if (!categoriaId) throw new Error('Nenhuma categoria ativa encontrada no seed');

const projetoIds = [];
async function criarProjeto(token, codigo) {
  const { status, data } = await api('POST', '/projetos', token, {
    codigo: `${codigo}-${STAMP}`,
    nome: `Projeto ${codigo}`,
    prestacoesContas: ['2027-12-31'],
    categoriaId,
  });
  if (status !== 201 || !data?.id) throw new Error(`Falha ao criar projeto ${codigo}: ${JSON.stringify(data)}`);
  projetoIds.push(data.id);
  return data;
}

async function getMacros(token, projetoId) {
  const { data } = await api('GET', `/projetos/${projetoId}/macros`, token);
  return Array.isArray(data) ? data : [];
}

// ── Cenário 1: nasce com macro + micro "Geral" ────────────────────────────
console.log('\n── 1. Projeto novo: macro "Geral" + micro "Geral" automáticas ──────────');
{
  const projeto = await criarProjeto(gestorToken, 'MG-001');
  const macros  = await getMacros(gestorToken, projeto.id);

  ok('exatamente 1 macro', macros.length === 1, macros.map(m => m.nome));
  ok('macro se chama "Geral"', macros[0]?.nome === 'Geral', macros[0]?.nome);
  ok('macro tem status "ativa"', macros[0]?.status === 'ativa', macros[0]?.status);

  const micros = macros[0]?.microEntregas ?? [];
  ok('macro tem exatamente 1 micro', micros.length === 1, micros.map(m => m.nome));
  ok('micro se chama "Geral"', micros[0]?.nome === 'Geral', micros[0]?.nome);
  ok('micro tem status "pendente"', micros[0]?.status === 'pendente', micros[0]?.status);
}

// ── Cenário 2: wizard não bloqueia em projeto recém-criado ───────────────
console.log('\n── 2. Wizard não bloqueia: GET macros retorna ≥ 1 (sem CTA) ──────────');
{
  const projeto = await criarProjeto(gestorToken, 'MG-002');
  const macros  = await getMacros(gestorToken, projeto.id);

  ok('GET macros retorna ≥ 1 macro', macros.length >= 1, macros.length);
  // A UI exibe CTA quando macros.length === 0; com ≥1 o wizard mostra o select.
  ok('condicao CTA (macros.length === 0) é false', macros.length !== 0, macros.length);
  // A primeira micro (Geral) é necessária como microEntregaId no POST /alocacoes
  const microId = macros[0]?.microEntregas?.[0]?.id;
  ok('micro "Geral" disponível como destino de alocação', !!microId, microId);
}

// ── Cenário 3: macro "Geral" pode ser renomeada normalmente ──────────────
console.log('\n── 3. Renomear macro "Geral" → funciona normalmente ────────────────────');
{
  const projeto = await criarProjeto(gestorToken, 'MG-003');
  const macros  = await getMacros(gestorToken, projeto.id);
  const macroId = macros[0]?.id;

  const { status, data } = await api('PUT', `/projetos/${projeto.id}/macros/${macroId}`, gestorToken, {
    nome: 'Entrega Principal',
  });
  ok('PUT renomear → 200', status === 200, { status, data });
  ok('nome atualizado', data?.nome === 'Entrega Principal', data?.nome);

  // Confirma via GET
  const macrosAtual = await getMacros(gestorToken, projeto.id);
  ok('GET confirma novo nome', macrosAtual[0]?.nome === 'Entrega Principal', macrosAtual[0]?.nome);
}

// ── Cenário 4: macro "Geral" pode ser excluída normalmente ───────────────
console.log('\n── 4. Excluir macro "Geral" → funciona normalmente ─────────────────────');
{
  const projeto = await criarProjeto(gestorToken, 'MG-004');
  const macros  = await getMacros(gestorToken, projeto.id);
  const macroId = macros[0]?.id;

  // 1ª chamada: pede confirmação (padrão do sistema — mesmo para macro vazia)
  const { status: s1, data: d1 } = await api('DELETE', `/projetos/${projeto.id}/macros/${macroId}`, gestorToken);
  ok('1ª chamada → 200 needsConfirmation', s1 === 200 && d1?.needsConfirmation === true, { s1, d1 });

  // 2ª chamada: confirma exclusão
  const { status: s2, data: d2 } = await api('DELETE', `/projetos/${projeto.id}/macros/${macroId}?confirmar=true`, gestorToken);
  ok('2ª chamada (confirmar=true) → 200 ok', s2 === 200 && d2?.ok === true, { s2, d2 });

  // Confirma via GET: projeto agora sem macros
  const macrosApos = await getMacros(gestorToken, projeto.id);
  ok('projeto sem macros após exclusão', macrosApos.length === 0, macrosApos.length);
}

// ── Cenário 5: admin também cria projeto com macro automática ────────────
console.log('\n── 5. Admin cria projeto → macro "Geral" automática ────────────────────');
{
  // admin precisa informar gestorId ao criar
  const { data: users } = await api('GET', '/usuarios', adminToken);
  const gestor = users?.find(u => u.role === 'gestor');
  const { status, data: projeto } = await api('POST', '/projetos', adminToken, {
    codigo:          `MG-ADM-${STAMP}`,
    nome:            'Projeto Admin Teste',
    prestacoesContas: ['2027-12-31'],
    categoriaId,
    gestorId:        gestor?.id,
  });
  if (status === 201) {
    projetoIds.push(projeto.id);
    const macros = await getMacros(adminToken, projeto.id);
    ok('admin: 1 macro criada', macros.length === 1, macros.length);
    ok('admin: macro se chama "Geral"', macros[0]?.nome === 'Geral', macros[0]?.nome);
    ok('admin: micro "Geral" presente', macros[0]?.microEntregas?.[0]?.nome === 'Geral');
  } else {
    ok('admin: projeto criado (status 201)', false, { status, data: projeto });
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────
for (const id of projetoIds) {
  try {
    // Excluir macros primeiro (se houver)
    const macros = await getMacros(adminToken, id);
    for (const m of macros) {
      await api('DELETE', `/projetos/${id}/macros/${m.id}`, adminToken);
      await api('DELETE', `/projetos/${id}/macros/${m.id}?confirmar=true`, adminToken);
    }
    await api('DELETE', `/projetos/${id}?confirmar=true`, adminToken);
  } catch { /* cleanup best-effort */ }
}

// ── Resultado ─────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(52)}`);
console.log(`Resultado: ${pass} passou, ${fail} falhou`);
if (fail > 0) process.exit(1);
