// Teste manual do endpoint /api/categorias — rode com: node test-categorias.mjs
// Pressupõe backend de pé em http://localhost:3001 com o seed padrão carregado.

const BASE = 'http://localhost:3001/api';

let pass = 0;
let fail = 0;

function check(label, condition, extra) {
  if (condition) {
    console.log(`✅ ${label}`);
    pass++;
  } else {
    console.log(`❌ ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`);
    fail++;
  }
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
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, data };
}

async function main() {
  console.log('── Login ──────────────────────────────────────────');
  const tokenGestor = await login('gestor1@sistema.dev', 'gestor123');
  const tokenAdmin  = await login('admin@sistema.dev', 'admin123');
  const tokenCoord  = await login('coord@sistema.dev', 'coord123');
  console.log('Tokens obtidos para gestor, admin e coordenação.\n');

  console.log('── GET /api/categorias — lista os programas semeados ──');
  {
    const { status, data } = await api('GET', '/categorias', tokenGestor);
    check('GET retorna 200', status === 200, { status });
    const nomes = Array.isArray(data) ? data.map(c => c.nome).sort() : [];
    const esperados = ['BNDES', 'EMBRAPII', 'FINEP', 'SEBRAE', 'SENAI'];
    check('Contém os 5 programas semeados', esperados.every(n => nomes.includes(n)), nomes);
  }

  console.log('\n── POST "BNDES" (exato) → 409 ──────────────────────');
  {
    const { status, data } = await api('POST', '/categorias', tokenGestor, { nome: 'BNDES' });
    check('Status 409', status === 409, { status, data });
    check('Tem campo existente', data?.existente?.nome === 'BNDES', data);
  }

  console.log('\n── POST "bndes" (caixa diferente) → 409 ────────────');
  {
    const { status, data } = await api('POST', '/categorias', tokenGestor, { nome: 'bndes' });
    check('Status 409', status === 409, { status, data });
  }

  console.log('\n── POST "EMBRAPI" (similar, sem confirmarSimilar) ──');
  let aindaIgualAntes;
  {
    const before = await api('GET', '/categorias', tokenGestor);
    aindaIgualAntes = before.data.length;

    const { status, data } = await api('POST', '/categorias', tokenGestor, { nome: 'EMBRAPI' });
    check('Status 200 com needsConfirmation', status === 200 && data?.needsConfirmation === true, { status, data });
    check('similares contém EMBRAPII', (data?.similares ?? []).some(s => s.nome === 'EMBRAPII'), data?.similares);

    const after = await api('GET', '/categorias', tokenGestor);
    check('Nada foi criado (contagem inalterada)', after.data.length === aindaIgualAntes, { antes: aindaIgualAntes, depois: after.data.length });
  }

  console.log('\n── POST "EMBRAPI" com confirmarSimilar: true → cria ──');
  {
    const { status, data } = await api('POST', '/categorias', tokenGestor, { nome: 'EMBRAPI', confirmarSimilar: true });
    check('Status 201', status === 201, { status, data });
    check('Programa criado com nome EMBRAPI', data?.categoria?.nome === 'EMBRAPI', data);
  }

  console.log('\n── POST "FAPESP" (novo e distinto) → cria ──────────');
  let fapespId;
  {
    const { status, data } = await api('POST', '/categorias', tokenGestor, { nome: 'FAPESP' });
    check('Status 201', status === 201, { status, data });
    check('Programa criado com nome FAPESP', data?.categoria?.nome === 'FAPESP', data);
    fapespId = data?.categoria?.id;
  }

  console.log('\n── PATCH renomeando FAPESP → SENAI (já existe) → 409 ──');
  {
    const { status, data } = await api('PATCH', `/categorias/${fapespId}`, tokenGestor, { nome: 'SENAI' });
    check('Status 409', status === 409, { status, data });
  }

  console.log('\n── PATCH renomeando FAPESP → FAPESP-SP (novo) → ok ──');
  {
    const { status, data } = await api('PATCH', `/categorias/${fapespId}`, tokenGestor, { nome: 'FAPESP-SP' });
    check('Status 200', status === 200, { status, data });
    check('Nome atualizado', data?.nome === 'FAPESP-SP', data);
  }

  console.log('\n── PATCH desativando FAPESP-SP → ok ────────────────');
  {
    const { status, data } = await api('PATCH', `/categorias/${fapespId}`, tokenGestor, { ativo: false });
    check('Status 200', status === 200, { status, data });
    check('ativo = false', data?.ativo === false, data);
  }

  console.log('\n── Permissão: gestor faz POST; coordenação → 403 ───');
  {
    const { status } = await api('POST', '/categorias', tokenGestor, { nome: 'TESTE-PERMISSAO-GESTOR' });
    check('Gestor consegue POST (201)', status === 201, { status });
  }
  {
    const { status, data } = await api('POST', '/categorias', tokenCoord, { nome: 'TESTE-PERMISSAO-COORD' });
    check('Coordenação recebe 403 no POST', status === 403, { status, data });
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log(`Resultado: ${pass} passou(aram), ${fail} falhou(aram).`);
  if (fail > 0) process.exit(1);
}

main().catch(err => {
  console.error('Erro fatal no teste:', err);
  process.exit(1);
});
