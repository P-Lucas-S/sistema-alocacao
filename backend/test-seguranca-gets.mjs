// Teste da FASE A da auditoria: fecha os GETs sem requireRole (itens 2.5, 2.6,
// 2.7, 2.9 do AUDITORIA_CODIGO.md). O diretor não pode mais baixar diretamente
// nomes de colaboradores/tarifas, o grid, ou dados de projeto — a visão
// agregada dos dashboards é a única porta dele. Papéis legítimos continuam OK.
// Rode com: node test-seguranca-gets.mjs
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
  return data?.token;
}

async function api(method, path, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  let data = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, data };
}

async function main() {
  const [tAdmin, tGestor, tChefe, tCoord, tDiretor] = await Promise.all([
    login('admin@sistema.dev',   'admin123'),
    login('gestor1@sistema.dev', 'gestor123'),
    login('chefe@sistema.dev',   'chefe123'),
    login('coord@sistema.dev',   'coord123'),
    login('diretor@sistema.dev', 'diretor123'),
  ]);
  console.log('  Todos os 5 tokens obtidos.\n');

  // ═══════════════════════════════════════════════════════════════════════
  console.log('── Diretor → 403 nos GETs que expõem indivíduo/tarifa ─────');
  // ═══════════════════════════════════════════════════════════════════════
  {
    const { status } = await api('GET', '/colaboradores', tDiretor);
    check('Diretor: GET /colaboradores → 403', status === 403, { status });
  }
  {
    const { data: colabs } = await api('GET', '/colaboradores', tAdmin);
    const anyId = colabs?.[0]?.id;
    const { status } = await api('GET', `/colaboradores/${anyId}`, tDiretor);
    check('Diretor: GET /colaboradores/:id → 403', status === 403, { status });
  }
  {
    const { status } = await api('GET', '/alocacoes/grid?ano=2026&mes=7', tDiretor);
    check('Diretor: GET /alocacoes/grid → 403', status === 403, { status });
  }
  {
    const { status } = await api('GET', '/alocacoes', tDiretor);
    check('Diretor: GET /alocacoes → 403', status === 403, { status });
  }
  {
    const { status } = await api('GET', '/users', tDiretor);
    check('Diretor: GET /users (completo) → 403', status === 403, { status });
  }
  {
    const { status } = await api('GET', '/projetos', tDiretor);
    check('Diretor: GET /projetos → 403', status === 403, { status });
  }
  {
    const { data: projs } = await api('GET', '/projetos', tAdmin);
    const anyId = projs?.[0]?.id;
    const { status: s1 } = await api('GET', `/projetos/${anyId}`, tDiretor);
    check('Diretor: GET /projetos/:id → 403', s1 === 403, { status: s1 });

    const { status: s2 } = await api('GET', `/projetos/${anyId}/meta-apropriacao`, tDiretor);
    check('Diretor: GET /projetos/:id/meta-apropriacao → 403', s2 === 403, { status: s2 });

    const { status: s3 } = await api('GET', `/projetos/${anyId}/macros`, tDiretor);
    check('Diretor: GET /projetos/:id/macros → 403', s3 === 403, { status: s3 });
  }

  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Diretor mantém acesso ao que É dele ─────────────────────');
  // ═══════════════════════════════════════════════════════════════════════
  {
    const { status, data } = await api('GET', '/users/gestores', tDiretor);
    check('Diretor: GET /users/gestores → 200 (seletor "ver como" funciona)', status === 200, { status });
    check('Diretor: /users/gestores devolve só id+name', Array.isArray(data) && data.every(g => Object.keys(g).sort().join(',') === 'id,name'), data);
  }
  {
    const { status } = await api('GET', '/dashboards/projetos?ano=2026&mes=7', tDiretor);
    check('Diretor: GET /dashboards/projetos → 200', status === 200, { status });
  }
  {
    const { status } = await api('GET', '/dashboards/capacidade?ano=2026&mes=7', tDiretor);
    check('Diretor: GET /dashboards/capacidade → 200', status === 200, { status });
  }

  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Papéis legítimos continuam 200 ──────────────────────────');
  // ═══════════════════════════════════════════════════════════════════════
  {
    const { status } = await api('GET', '/colaboradores', tGestor);
    check('Gestor: GET /colaboradores → 200', status === 200, { status });
  }
  {
    const { status } = await api('GET', '/colaboradores', tCoord);
    check('Coordenação: GET /colaboradores → 200', status === 200, { status });
  }
  {
    const { status } = await api('GET', '/colaboradores', tChefe);
    check('Chefe: GET /colaboradores → 200', status === 200, { status });
  }
  {
    const { status } = await api('GET', '/alocacoes/grid?ano=2026&mes=7', tCoord);
    check('Coordenação: GET /alocacoes/grid → 200', status === 200, { status });
  }
  {
    const { status } = await api('GET', '/projetos', tGestor);
    check('Gestor: GET /projetos → 200', status === 200, { status });
  }
  {
    const { status } = await api('GET', '/projetos', tCoord);
    check('Coordenação: GET /projetos → 200', status === 200, { status });
  }
  {
    const { status } = await api('GET', '/projetos', tChefe);
    check('Chefe: GET /projetos → 200', status === 200, { status });
  }
  {
    const { status } = await api('GET', '/users', tAdmin);
    check('Admin: GET /users (completo) → 200', status === 200, { status });
  }
  {
    const { status } = await api('GET', '/users/gestores', tChefe);
    check('Chefe: GET /users/gestores → 200', status === 200, { status });
  }
  {
    const { status } = await api('GET', '/users/gestores', tCoord);
    check('Coordenação: GET /users/gestores → 200', status === 200, { status });
  }

  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── Não-admin barrado no /users completo ────────────────────');
  // ═══════════════════════════════════════════════════════════════════════
  {
    const { status } = await api('GET', '/users', tGestor);
    check('Gestor: GET /users (completo) → 403', status === 403, { status });
  }

  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`Resultado: ${pass} passou(aram), ${fail} falhou(aram).`);
  if (fail > 0) process.exit(1);
}

main().catch(err => {
  console.error('Erro fatal no teste:', err);
  process.exit(1);
});
