// Teste manual do vínculo Projeto ↔ CategoriaProjeto — rode com: node test-projeto-categoria.mjs
// Pressupõe backend de pé em http://localhost:3001 com o seed padrão carregado.

const BASE = 'http://localhost:3001/api';
const CODIGO = 'TCAT' + Date.now();

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

function projetoBase(extra = {}) {
  return {
    codigo: CODIGO,
    nome: 'Projeto Teste Categoria',
    prestacoesContas: ['2026-12-31'],
    ...extra,
  };
}

async function main() {
  console.log('── Login ──────────────────────────────────────────');
  const token = await login('gestor1@sistema.dev', 'gestor123');
  console.log('Token obtido para gestor1.\n');

  console.log('── POST projeto SEM categoriaId → 400 ──────────────');
  {
    const { status, data } = await api('POST', '/projetos', token, projetoBase());
    check('Status 400', status === 400, { status, data });
    check('Mensagem "Programa é obrigatório"', data?.error === 'Programa é obrigatório', data);
  }

  console.log('\n── POST projeto com categoriaId inválido → 400 ─────');
  {
    const { status, data } = await api('POST', '/projetos', token, projetoBase({ categoriaId: 'nao-existe' }));
    check('Status 400', status === 400, { status, data });
    check('Mensagem "Programa não encontrado"', data?.error === 'Programa não encontrado', data);
  }

  console.log('\n── Programa inativo: cria, desativa, tenta usar ────');
  let categoriaInativaId;
  {
    const nomeCat = 'TESTE-INATIVO-' + Date.now();
    const { status, data } = await api('POST', '/categorias', token, { nome: nomeCat });
    check('Categoria de teste criada (201)', status === 201, { status, data });
    categoriaInativaId = data?.categoria?.id;

    const patch = await api('PATCH', `/categorias/${categoriaInativaId}`, token, { ativo: false });
    check('Categoria desativada (200)', patch.status === 200 && patch.data?.ativo === false, patch);
  }
  {
    const { status, data } = await api('POST', '/projetos', token, projetoBase({ categoriaId: categoriaInativaId }));
    check('Status 400 (programa inativo)', status === 400, { status, data });
    check('Mensagem "Programa inativo"', data?.error === 'Programa inativo', data);
  }

  console.log('\n── POST projeto com programa válido e ativo → 201 ──');
  let projetoId, categoriaOriginalId, categoriaAlternativaId;
  {
    const { data: categorias } = await api('GET', '/categorias?ativo=true', token);
    check('GET /categorias?ativo=true retorna ao menos 2 ativas', Array.isArray(categorias) && categorias.length >= 2, categorias);
    categoriaOriginalId    = categorias[0].id;
    categoriaAlternativaId = categorias[1].id;

    const { status, data } = await api('POST', '/projetos', token, projetoBase({ categoriaId: categoriaOriginalId }));
    check('Status 201', status === 201, { status, data });
    check('Resposta traz categoria.id correta', data?.categoria?.id === categoriaOriginalId, data?.categoria);
    check('Resposta traz categoria.nome', typeof data?.categoria?.nome === 'string' && data.categoria.nome.length > 0, data?.categoria);
    projetoId = data?.id;
  }
  {
    const { status, data } = await api('GET', `/projetos/${projetoId}`, token);
    check('GET detalhe reflete a categoria', status === 200 && data?.categoria?.id === categoriaOriginalId, data?.categoria);
  }

  console.log('\n── PATCH trocando categoriaId por outro válido → 200 ──');
  {
    const { status, data } = await api('PUT', `/projetos/${projetoId}`, token, { categoriaId: categoriaAlternativaId });
    check('Status 200', status === 200, { status, data });
    check('Categoria atualizada na resposta', data?.categoria?.id === categoriaAlternativaId, data?.categoria);
  }
  {
    const { status, data } = await api('GET', `/projetos/${projetoId}`, token);
    check('GET detalhe reflete a troca', status === 200 && data?.categoria?.id === categoriaAlternativaId, data?.categoria);
  }

  console.log('\n── PATCH com categoriaId: null → 400 ───────────────');
  {
    const { status, data } = await api('PUT', `/projetos/${projetoId}`, token, { categoriaId: null });
    check('Status 400', status === 400, { status, data });
    check('Mensagem "Programa é obrigatório"', data?.error === 'Programa é obrigatório', data);
  }
  {
    const { status, data } = await api('GET', `/projetos/${projetoId}`, token);
    check('Programa não foi removido (continua o alternativo)', status === 200 && data?.categoria?.id === categoriaAlternativaId, data?.categoria);
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log(`Resultado: ${pass} passou(aram), ${fail} falhou(aram).`);
  if (fail > 0) process.exit(1);
}

main().catch(err => {
  console.error('Erro fatal no teste:', err);
  process.exit(1);
});
