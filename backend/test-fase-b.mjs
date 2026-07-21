// Teste da FASE B da auditoria: fecha os 403 misteriosos (AUDITORIA_CODIGO.md
// itens 2.1, 2.2, 2.3+3.1, 2.4, 2.8). A classe do bug: o menu/tela oferece uma
// ação a um papel que o backend nega — clique vira 403 sem explicação (já
// aconteceu com o Custos). Aqui confirmamos que o chefe passa a agir em tudo
// que a UI já oferecia (remanejamento, programas, profissões, projetos) e que
// coordenação continua barrada nas escritas (só ganhou leitura de candidatos).
// Rode com: node test-fase-b.mjs
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
  const [tAdmin, tGestor, tChefe, tCoord, tDiretor] = await Promise.all([
    login('admin@sistema.dev',   'admin123'),
    login('gestor1@sistema.dev', 'gestor123'),
    login('chefe@sistema.dev',   'chefe123'),
    login('coord@sistema.dev',   'coord123'),
    login('diretor@sistema.dev', 'diretor123'),
  ]);
  console.log('  Todos os 5 tokens obtidos.\n');

  // ═══════════════════════════════════════════════════════════════════════
  console.log('── 1. Remanejamento: chefe passa a agir (5 endpoints) ──────');
  // ═══════════════════════════════════════════════════════════════════════
  {
    const { status } = await api('GET', '/remanejamento/solicitacoes', tChefe);
    check('Chefe: GET /remanejamento/solicitacoes → 200', status === 200, { status });
  }
  {
    // Corpo vazio → cai na validação de campos obrigatórios (400), nunca 403.
    const { status } = await api('POST', '/remanejamento/solicitacoes', tChefe, {});
    check('Chefe: POST /remanejamento/solicitacoes → 400 (corpo vazio, não 403)', status === 400, { status });
  }
  {
    // Solicitação inexistente → 404 depois do requireRole, nunca 403 de papel.
    const { status } = await api('POST', '/remanejamento/solicitacoes/id-inexistente/cessoes', tChefe, { alocacaoOrigemId: 'x', horasCedidas: 10, idempotencia: 'test-fase-b-1' });
    check('Chefe: POST /solicitacoes/:id/cessoes → 404 (id falso, não 403)', status === 404, { status });
  }
  {
    const { status } = await api('POST', '/remanejamento/solicitacoes/id-inexistente/cancelar', tChefe, {});
    check('Chefe: POST /solicitacoes/:id/cancelar → 404 (id falso, não 403)', status === 404, { status });
  }
  {
    const { status } = await api('POST', '/remanejamento/solicitacoes/id-inexistente/encerrar', tChefe, {});
    check('Chefe: POST /solicitacoes/:id/encerrar → 404 (id falso, não 403)', status === 404, { status });
  }
  {
    // Diretor continua fora de tudo isso.
    const { status: s1 } = await api('GET', '/remanejamento/solicitacoes', tDiretor);
    check('Diretor: GET /remanejamento/solicitacoes → 403', s1 === 403, { status: s1 });
    const { status: s2 } = await api('POST', '/remanejamento/solicitacoes', tDiretor, {});
    check('Diretor: POST /remanejamento/solicitacoes → 403', s2 === 403, { status: s2 });
  }

  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── 2. Programas e Profissões: chefe passa a criar/editar ───');
  // ═══════════════════════════════════════════════════════════════════════
  // Sufixo único por execução — nunca colide com sobra de rodadas anteriores
  // (nomes fixos causaram 409/needsConfirmation em runs repetidos).
  const RUN = Date.now();
  let progId, profId;
  {
    const { status, data } = await api('POST', '/categorias', tChefe, { nome: `TESTE-FASE-B-PROGRAMA-${RUN}`, confirmarSimilar: true });
    check('Chefe: POST /categorias → 201', status === 201, { status, data });
    progId = data?.categoria?.id;
  }
  {
    const { status } = await api('PATCH', `/categorias/${progId}`, tChefe, { nome: `TESTE-FASE-B-PROGRAMA-${RUN}-2` });
    check('Chefe: PATCH /categorias/:id → 200', status === 200, { status });
  }
  {
    const { status, data } = await api('POST', '/profissoes', tChefe, { nome: `TESTE-FASE-B-PROFISSAO-${RUN}`, confirmarSimilar: true });
    check('Chefe: POST /profissoes → 201', status === 201, { status, data });
    profId = data?.profissao?.id;
  }
  {
    const { status } = await api('PATCH', `/profissoes/${profId}`, tChefe, { nome: `TESTE-FASE-B-PROFISSAO-${RUN}-2` });
    check('Chefe: PATCH /profissoes/:id → 200', status === 200, { status });
  }
  {
    // Gestor não regrediu — já podia criar profissão (uso inline em Colaboradores).
    // confirmarSimilar:true pula o check de nome parecido (não é o que testamos aqui).
    const { status, data } = await api('POST', '/profissoes', tGestor, { nome: `TESTE-FASE-B-PROFISSAO-GESTOR-${RUN}`, confirmarSimilar: true });
    check('Gestor: POST /profissoes → 201 (não regrediu)', status === 201, { status, data });
    if (data?.profissao?.id) {
      await api('PATCH', `/profissoes/${data.profissao.id}`, tAdmin, { ativo: false });
    }
  }
  {
    const { status: s1 } = await api('POST', '/categorias', tCoord, { nome: 'X' });
    check('Coordenação: POST /categorias → 403 (continua sem escrita)', s1 === 403, { status: s1 });
    const { status: s2 } = await api('POST', '/categorias', tDiretor, { nome: 'X' });
    check('Diretor: POST /categorias → 403', s2 === 403, { status: s2 });
  }
  // Limpeza
  if (progId) await api('PATCH', `/categorias/${progId}`, tAdmin, { ativo: false });
  if (profId) await api('PATCH', `/profissoes/${profId}`, tAdmin, { ativo: false });

  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── 3. Candidatos: leitura liberada a chefe e coordenação ───');
  // ═══════════════════════════════════════════════════════════════════════
  {
    const { data: profs } = await api('GET', '/profissoes?ativo=true', tAdmin);
    const profissaoId = profs?.[0]?.id;
    const qs = `/alocacoes/candidatos?profissaoId=${profissaoId}&ano=2026&mes=7`;

    const { status: sChefe } = await api('GET', qs, tChefe);
    check('Chefe: GET /alocacoes/candidatos → 200', sChefe === 200, { status: sChefe });

    const { status: sCoord } = await api('GET', qs, tCoord);
    check('Coordenação: GET /alocacoes/candidatos → 200', sCoord === 200, { status: sCoord });

    // Escrita continua fora do alcance da coordenação — ela é só leitura.
    const { status: sPost } = await api('POST', '/alocacoes', tCoord, {});
    check('Coordenação: POST /alocacoes → 403 (continua sem escrita)', sPost === 403, { status: sPost });

    const { status: sDiretor } = await api('GET', qs, tDiretor);
    check('Diretor: GET /alocacoes/candidatos → 403 (continua fora)', sDiretor === 403, { status: sDiretor });
  }

  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── 5. Projetos: chefe edita (UI e backend já alinhados) ────');
  // ═══════════════════════════════════════════════════════════════════════
  {
    const { data: projs } = await api('GET', '/projetos?status=ativo', tAdmin);
    const anyId = projs?.[0]?.id;
    const nomeOriginal = projs?.[0]?.nome;

    const { status } = await api('PUT', `/projetos/${anyId}`, tChefe, { nome: nomeOriginal });
    check('Chefe: PUT /projetos/:id → 200 (backend já permitia; UI agora oferece)', status === 200, { status });

    const { status: s2 } = await api('PATCH', `/projetos/${anyId}/status`, tChefe, { status: 'ativo' });
    check('Chefe: PATCH /projetos/:id/status → 200', s2 === 200, { status: s2 });
  }

  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`Resultado: ${pass} passou(aram), ${fail} falhou(aram).`);
  if (fail > 0) process.exit(1);
}

main().catch(err => {
  console.error('Erro fatal no teste:', err);
  process.exit(1);
});
