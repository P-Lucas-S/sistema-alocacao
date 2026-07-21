// Teste do passo 1 da spec de papéis: chefe/diretor existem (login, role correto)
// e ainda NÃO têm acesso a nada (requireRole os exclui de tudo).
// Rode com: node test-papeis.mjs
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
  return { status: res.status, data };
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

async function main() {
  console.log('── Login: chefe e diretor existem, role correto ───');
  let tokenChefe, tokenDiretor;
  {
    const { status, data } = await login('chefe@sistema.dev', 'chefe123');
    check('Chefe loga (200)', status === 200, { status, data });
    check('Chefe.user.role === "chefe"', data?.user?.role === 'chefe', data?.user);
    tokenChefe = data?.token;
  }
  {
    const { status, data } = await login('diretor@sistema.dev', 'diretor123');
    check('Diretor loga (200)', status === 200, { status, data });
    check('Diretor.user.role === "diretor"', data?.user?.role === 'diretor', data?.user);
    tokenDiretor = data?.token;
  }

  console.log('\n── Login: papéis antigos continuam intactos ────────');
  {
    const { status, data } = await login('admin@sistema.dev', 'admin123');
    check('Admin loga (200) e role intacto', status === 200 && data?.user?.role === 'admin', data?.user);
  }
  {
    const { status, data } = await login('gestor1@sistema.dev', 'gestor123');
    check('Gestor1 loga (200) e role intacto', status === 200 && data?.user?.role === 'gestor', data?.user);
  }
  {
    const { status, data } = await login('coord@sistema.dev', 'coord123');
    check('Coordenação loga (200) e role intacto', status === 200 && data?.user?.role === 'coordenacao', data?.user);
  }

  console.log('\n── Chefe/diretor barrados nas rotas que ainda não são deles ──');
  {
    // Rota só-admin
    const { status: sChefe } = await api('POST', '/fechamentos', tokenChefe, { ano: 2026, mes: 1 });
    check('Chefe → 403 em POST /fechamentos (só-admin)', sChefe === 403, sChefe);

    const { status: sDiretor } = await api('POST', '/fechamentos', tokenDiretor, { ano: 2026, mes: 1 });
    check('Diretor → 403 em POST /fechamentos (só-admin)', sDiretor === 403, sDiretor);
  }
  {
    // Rota admin/gestor/chefe — corpo qualquer, requireRole roda ANTES da
    // validação de corpo. O chefe-override (commit 3310d02, "posse na escrita
    // de alocacao (403 para gestor nao-dono) - F0") liberou o chefe nesta
    // rota de propósito — ele passa pelo requireRole e cai na validação de
    // corpo (400), não mais barrado por papel. O diretor continua de fora.
    const corpoQualquer = { foo: 'bar' };

    const { status: sChefe } = await api('POST', '/alocacoes', tokenChefe, corpoQualquer);
    check('Chefe → 400 em POST /alocacoes (chefe-override liberou o papel; falha é de corpo, não de permissão)', sChefe === 400, sChefe);

    const { status: sDiretor } = await api('POST', '/alocacoes', tokenDiretor, corpoQualquer);
    check('Diretor → 403 em POST /alocacoes (admin/gestor/chefe), antes de validar corpo', sDiretor === 403, sDiretor);
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log(`Resultado: ${pass} passou(aram), ${fail} falhou(aram).`);
  if (fail > 0) process.exit(1);
}

main().catch(err => {
  console.error('Erro fatal no teste:', err);
  process.exit(1);
});
