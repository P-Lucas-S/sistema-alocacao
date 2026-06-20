// Teste manual do resolvedor de tarifa aplicado ao relatório de custos.
// Rode com: node test-tarifa.mjs
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

function acharColaborador(projeto, nome) {
  return projeto?.colaboradores.find(c => c.nome === nome);
}

async function main() {
  console.log('── Login ──────────────────────────────────────────');
  const token = await login('gestor1@sistema.dev', 'gestor123');
  console.log('Token obtido para gestor1.\n');

  console.log('── GET /api/relatorios/custos ──────────────────────');
  const res = await fetch(`${BASE}/relatorios/custos`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  check('Status 200', res.status === 200, { status: res.status });
  const projetos = await res.json();

  const finep = projetos.find(p => p.codigo === 'SEED03');
  const bndes = projetos.find(p => p.codigo === 'SEED01');
  check('Projeto SEED03 (FINEP) presente', !!finep, projetos.map(p => p.codigo));
  check('Projeto SEED01 (BNDES) presente', !!bndes, projetos.map(p => p.codigo));

  console.log('\n── Samuel Gomes em SEED03 (FINEP) → tarifa específica ──');
  {
    const c = acharColaborador(finep, 'Samuel Gomes');
    check('Encontrado em SEED03', !!c, finep?.colaboradores);
    check('origem = especifica', c?.origem === 'especifica', c);
    check('valorHora = 85.50 (override)', c && parseFloat(c.valorHora) === 85.5, c);
    check('custo = 40h × 85.50 = 3420.00', c && c.custo === '3420.00', c);
  }

  console.log('\n── Samuel Gomes em SEED01 (BNDES) → tarifa padrão ──');
  {
    const c = acharColaborador(bndes, 'Samuel Gomes');
    check('Encontrado em SEED01', !!c, bndes?.colaboradores);
    check('origem = padrao', c?.origem === 'padrao', c);
    check('valorHora = 110.00 (padrão do colaborador)', c && parseFloat(c.valorHora) === 110, c);
    check('custo = 30h × 110.00 = 3300.00', c && c.custo === '3300.00', c);
  }

  console.log('\n── Colaborador sem override usa o padrão (qualquer projeto) ──');
  {
    // Adriana Lima (sc-01) não tem nenhuma tarifa específica — sempre origem padrao
    const adriana01 = acharColaborador(projetos.find(p => p.codigo === 'SEED01'), 'Adriana Lima');
    const adriana02 = acharColaborador(projetos.find(p => p.codigo === 'SEED02'), 'Adriana Lima');
    check('Adriana Lima em SEED01 → origem padrao', adriana01?.origem === 'padrao', adriana01);
    check('Adriana Lima em SEED02 → origem padrao', adriana02?.origem === 'padrao', adriana02);
    check('Mesmo valorHora (110.00) nos dois projetos', adriana01 && adriana02 && adriana01.valorHora === adriana02.valorHora, { adriana01, adriana02 });
  }

  console.log('\n── Outros colaboradores com override FINEP ──────────');
  {
    const fabiana = acharColaborador(finep, 'Fabiana Costa');
    check('Fabiana Costa em SEED03 → origem especifica', fabiana?.origem === 'especifica', fabiana);
    check('Fabiana Costa valorHora = 60.00', fabiana && parseFloat(fabiana.valorHora) === 60, fabiana);

    const yago = acharColaborador(finep, 'Yago Cavalcanti');
    check('Yago Cavalcanti em SEED03 → origem especifica', yago?.origem === 'especifica', yago);
    check('Yago Cavalcanti valorHora = 90.00', yago && parseFloat(yago.valorHora) === 90, yago);
  }

  console.log('\n── Totais por projeto batem com a soma das linhas ────');
  for (const proj of projetos) {
    const somaLinhas = proj.colaboradores.reduce((s, c) => s + (c.custo != null ? parseFloat(c.custo) : 0), 0);
    const totalArredondado = Math.round(somaLinhas * 100) / 100;
    const totalDeclarado = parseFloat(proj.custoTotal);
    check(
      `${proj.codigo}: soma das linhas (${totalArredondado.toFixed(2)}) = custoTotal (${proj.custoTotal})`,
      Math.abs(totalArredondado - totalDeclarado) < 0.005,
      { totalArredondado, custoTotal: proj.custoTotal },
    );
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log(`Resultado: ${pass} passou(aram), ${fail} falhou(aram).`);
  if (fail > 0) process.exit(1);
}

main().catch(err => {
  console.error('Erro fatal no teste:', err);
  process.exit(1);
});
