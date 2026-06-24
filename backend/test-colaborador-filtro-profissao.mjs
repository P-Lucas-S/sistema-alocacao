// Teste do filtro ?profissaoId= em GET /api/colaboradores (passo 4a).
// Rode com: node test-colaborador-filtro-profissao.mjs
// Pressupõe backend de pé em http://localhost:3001 com o seed padrão carregado.
// Somente leitura — não cria/altera/limpa nada.

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

async function api(method, path, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function main() {
  console.log('── Login ──────────────────────────────────────────');
  const tokenGestor = await login('gestor1@sistema.dev', 'gestor123');
  console.log('Token obtido para gestor.\n');

  console.log('── Sem filtro: GET /colaboradores?ativo=true → todos ──');
  const { data: todos } = await api('GET', '/colaboradores?ativo=true', tokenGestor);
  check('Retorna os 30 colaboradores do seed', todos.length === 30, todos.length);

  // Escolhe uma profissão do seed que tenha mais de 1 colaborador (Desenvolvedor(a) de Software)
  const { data: profissoes } = await api('GET', '/profissoes?ativo=true', tokenGestor);
  const profDev = profissoes.find(p => p.nome === 'Desenvolvedor(a) de Software');
  check('Profissão "Desenvolvedor(a) de Software" existe no seed', !!profDev, profissoes.map(p => p.nome));

  console.log('\n── Com filtro ?profissaoId=<dev> ────────────────────');
  const { status, data: filtrados } = await api('GET', `/colaboradores?ativo=true&profissaoId=${profDev.id}`, tokenGestor);
  check('Status 200', status === 200, status);
  check('Retornou pelo menos 1 colaborador', filtrados.length > 0, filtrados.length);
  check('TODOS os retornados têm a profissão filtrada', filtrados.every(c => c.profissao?.id === profDev.id), filtrados.map(c => ({ nome: c.nome, profissao: c.profissao })));
  check('É um subconjunto estrito (menos que o total de 30)', filtrados.length < todos.length, { filtrados: filtrados.length, todos: todos.length });

  console.log('\n── Filtro com profissaoId inexistente → vazio ──────');
  const { data: vazio } = await api('GET', '/colaboradores?ativo=true&profissaoId=prof-nao-existe-xyz', tokenGestor);
  check('Retorna array vazio (nenhum colaborador com essa profissão)', Array.isArray(vazio) && vazio.length === 0, vazio);

  console.log('\n──────────────────────────────────────────────────');
  console.log(`Resultado: ${pass} passou(aram), ${fail} falhou(aram).`);
  if (fail > 0) process.exit(1);
}

main().catch(err => {
  console.error('Erro fatal no teste:', err);
  process.exit(1);
});
