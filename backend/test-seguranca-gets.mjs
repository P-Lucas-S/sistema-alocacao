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
  console.log('\n── Fase A-meio: payload do diretor nos dashboards é só agregado ──');
  // ═══════════════════════════════════════════════════════════════════════
  const ANO_DASH = 2026, MES_DASH = 7;
  {
    // Chefe sem filtro e diretor sem filtro têm o MESMO escopo total — todos
    // os projetos ativos — então dá pra comparar os agregados 1:1.
    const { data: cfg } = await api('GET', '/config/priorizacao', tChefe);
    const altaDias = cfg?.prazoAltaDias ?? 7;

    const { data: chefeProj }   = await api('GET', `/dashboards/projetos?ano=${ANO_DASH}&mes=${MES_DASH}`, tChefe);
    const { data: diretorProj } = await api('GET', `/dashboards/projetos?ano=${ANO_DASH}&mes=${MES_DASH}`, tDiretor);

    const todosChefe = [...chefeProj.itens, ...chefeProj.pausados];
    check('Cenário tem dados reais (senão a comparação seria vazia)', todosChefe.length > 0, { total: todosChefe.length });

    // ── Ausência: nunca itens/pausados, nunca nomes ────────────────────────
    check('Diretor /dashboards/projetos NÃO tem "itens"',    !('itens' in diretorProj),    diretorProj);
    check('Diretor /dashboards/projetos NÃO tem "pausados"', !('pausados' in diretorProj), diretorProj);

    const nomesDoChefe = [
      ...chefeProj.itens.map(i => i.nome),
      ...chefeProj.itens.map(i => i.gestorNome).filter(Boolean),
      ...chefeProj.pausados.map(i => i.nome),
    ];
    const jsonDiretorProj = JSON.stringify(diretorProj);
    const vazamentoNomesProj = nomesDoChefe.filter(n => n && jsonDiretorProj.includes(n));
    check('Diretor /dashboards/projetos NÃO contém nenhum nome de projeto/gestor visto pelo chefe',
      vazamentoNomesProj.length === 0, vazamentoNomesProj);

    // ── Agregados batem com os derivados da resposta do chefe (mesmo cálculo
    // que o frontend faria a partir das listas) ────────────────────────────
    const custoPorCategoriaChefe = ['alta', 'media', 'baixa', 'sem_prazo'].map(categoria => {
      const doCat  = todosChefe.filter(x => x.categoria === categoria);
      const custo  = doCat.reduce((s, x) => s + (x.custoPlanejado ? parseFloat(x.custoPlanejado) : 0), 0);
      return { categoria, count: doCat.length, custo };
    });
    const nPrestacChefe = todosChefe.filter(x =>
      x.diasAteVencimento !== null && x.diasAteVencimento >= 0 && x.diasAteVencimento <= altaDias
    ).length;
    const nSemAponChefe      = todosChefe.filter(x => x.horasRealizadas === null).length;
    const totalPlanChefe      = todosChefe.reduce((s, x) => s + (x.custoPlanejado ? parseFloat(x.custoPlanejado) : 0), 0);
    const totalHorasPlanChefe = todosChefe.reduce((s, x) => s + parseFloat(x.horasPlanejadas), 0);
    const totalHorasRealChefe = todosChefe.reduce((s, x) => s + (x.horasRealizadas ? parseFloat(x.horasRealizadas) : 0), 0);

    check('Diretor.nTotal === chefe (itens+pausados)', diretorProj.nTotal === todosChefe.length, { diretor: diretorProj.nTotal, chefe: todosChefe.length });
    check('Diretor.headcountAlocado === chefe.headcountAlocado', diretorProj.headcountAlocado === chefeProj.headcountAlocado, { diretor: diretorProj.headcountAlocado, chefe: chefeProj.headcountAlocado });
    check('Diretor.emSobrecarga === chefe.emSobrecarga', diretorProj.emSobrecarga === chefeProj.emSobrecarga, { diretor: diretorProj.emSobrecarga, chefe: chefeProj.emSobrecarga });
    check('Diretor.totalPausados === chefe.pausados.length', diretorProj.totalPausados === chefeProj.pausados.length, { diretor: diretorProj.totalPausados, chefe: chefeProj.pausados.length });
    check('Diretor.nPrestac === derivado do chefe', diretorProj.nPrestac === nPrestacChefe, { diretor: diretorProj.nPrestac, chefe: nPrestacChefe });
    check('Diretor.nSemApon === derivado do chefe', diretorProj.nSemApon === nSemAponChefe, { diretor: diretorProj.nSemApon, chefe: nSemAponChefe });
    check('Diretor.totalPlan === derivado do chefe', Math.abs(parseFloat(diretorProj.totalPlan) - totalPlanChefe) < 0.01, { diretor: diretorProj.totalPlan, chefe: totalPlanChefe });
    check('Diretor.totalHorasPlan === derivado do chefe', Math.abs(parseFloat(diretorProj.totalHorasPlan) - totalHorasPlanChefe) < 0.01, { diretor: diretorProj.totalHorasPlan, chefe: totalHorasPlanChefe });
    check('Diretor.totalHorasReal === derivado do chefe', Math.abs(parseFloat(diretorProj.totalHorasReal) - totalHorasRealChefe) < 0.01, { diretor: diretorProj.totalHorasReal, chefe: totalHorasRealChefe });

    for (const catChefe of custoPorCategoriaChefe) {
      const catDiretor = diretorProj.custoPorCategoria.find(c => c.categoria === catChefe.categoria);
      check(`Diretor.custoPorCategoria[${catChefe.categoria}].count === chefe`,
        catDiretor?.count === catChefe.count, { diretor: catDiretor?.count, chefe: catChefe.count });
      check(`Diretor.custoPorCategoria[${catChefe.categoria}].custo === chefe`,
        Math.abs(parseFloat(catDiretor?.custo ?? 'NaN') - catChefe.custo) < 0.01, { diretor: catDiretor?.custo, chefe: catChefe.custo });
    }
  }
  {
    const { data: chefeCap }   = await api('GET', `/dashboards/capacidade?ano=${ANO_DASH}&mes=${MES_DASH}`, tChefe);
    const { data: diretorCap } = await api('GET', `/dashboards/capacidade?ano=${ANO_DASH}&mes=${MES_DASH}`, tDiretor);

    check('Cenário de capacidade tem colaboradores reais', chefeCap.colaboradores.length > 0, { total: chefeCap.colaboradores.length });
    check('Diretor /dashboards/capacidade NÃO tem "colaboradores"', !('colaboradores' in diretorCap), diretorCap);

    const nomesColabsChefe = chefeCap.colaboradores.map(c => c.nome);
    const jsonDiretorCap   = JSON.stringify(diretorCap);
    const vazamentoColabs  = nomesColabsChefe.filter(n => n && jsonDiretorCap.includes(n));
    check('Diretor /dashboards/capacidade NÃO contém nenhum nome de colaborador visto pelo chefe',
      vazamentoColabs.length === 0, vazamentoColabs);

    const contPorTierChefe = { sobrecarregado: 0, saudavel: 0, ocioso: 0 };
    for (const c of chefeCap.colaboradores) contPorTierChefe[c.tier]++;

    check('Diretor.contagensPorTier === derivado do chefe',
      JSON.stringify(diretorCap.contagensPorTier) === JSON.stringify(contPorTierChefe),
      { diretor: diretorCap.contagensPorTier, chefe: contPorTierChefe });
    check('Diretor.headcountAlocado === chefe.headcountAlocado (capacidade)',
      diretorCap.headcountAlocado === chefeCap.headcountAlocado, { diretor: diretorCap.headcountAlocado, chefe: chefeCap.headcountAlocado });
    check('Diretor.emSobrecarga === chefe.emSobrecarga (capacidade)',
      diretorCap.emSobrecarga === chefeCap.emSobrecarga, { diretor: diretorCap.emSobrecarga, chefe: chefeCap.emSobrecarga });
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
