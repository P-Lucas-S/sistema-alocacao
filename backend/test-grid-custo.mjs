// Teste manual do resolvedor de tarifa aplicado ao GET /api/alocacoes/grid.
// Rode com: node test-grid-custo.mjs
// Pressupõe backend de pé em http://localhost:3001 com o seed padrão carregado.
//
// Cenário do seed (Jul/2026):
//   sp-03 (SEED03, FINEP):  Samuel Gomes (sc-17) 40h — override FINEP 85.50
//   sp-01 (SEED01, BNDES):  Leonardo Alves (sc-11) 80h (padrão 145) +
//                            Samuel Gomes (sc-17) 30h (sem override BNDES → padrão 110)
//   sp-06 (SEED06, gestor2): Leonardo Alves 60h — fora do escopo do gestor1.

const BASE = 'http://localhost:3001/api';
const ANO = 2026;
const MES = 7;

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

async function main() {
  console.log('── Login ──────────────────────────────────────────');
  const token = await login('gestor1@sistema.dev', 'gestor123');
  console.log('Token obtido para gestor1.\n');

  console.log(`── GET /api/alocacoes/grid?ano=${ANO}&mes=${MES} ──────────────`);
  const res = await fetch(`${BASE}/alocacoes/grid?ano=${ANO}&mes=${MES}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  check('Status 200', res.status === 200, { status: res.status });
  const data = await res.json();

  const seed03 = data.projetos.find(p => p.codigo === 'SEED03');
  const seed01 = data.projetos.find(p => p.codigo === 'SEED01');
  check('Projeto SEED03 (FINEP) presente nas colunas', !!seed03, data.projetos.map(p => p.codigo));
  check('Projeto SEED01 (BNDES) presente nas colunas', !!seed01, data.projetos.map(p => p.codigo));
  check('SEED03 tem categoriaId = cat-finep', seed03?.categoriaId === 'cat-finep', seed03);
  check('SEED01 tem categoriaId = cat-bndes', seed01?.categoriaId === 'cat-bndes', seed01);

  console.log('\n── custoPorProjeto usa os overrides corretos ───────');
  {
    // SEED03/Jul só tem Samuel Gomes (40h, override 85.50) → 40 × 85.50 = 3420.00
    check(
      'custoPorProjeto[SEED03] = 3420.00 (40h × 85.50, não × 110 padrão)',
      data.custoPorProjeto[seed03.id] === '3420.00',
      data.custoPorProjeto[seed03.id],
    );
    // SEED01/Jul: Leonardo Alves 80h×145 (padrão) + Samuel Gomes 30h×110 (padrão, sem override BNDES) = 14900.00
    check(
      'custoPorProjeto[SEED01] = 14900.00 (Leonardo 80×145 + Samuel 30×110, ambos padrão)',
      data.custoPorProjeto[seed01.id] === '14900.00',
      data.custoPorProjeto[seed01.id],
    );
  }

  console.log('\n── saldo.custo do Samuel Gomes soma as duas tarifas ──');
  {
    const samuel = data.linhas.find(l => l.colaborador.nome === 'Samuel Gomes');
    check('Samuel Gomes encontrado nas linhas', !!samuel, data.linhas.map(l => l.colaborador.nome));
    // 40h × 85.50 (FINEP, especifica) + 30h × 110.00 (BNDES, padrao) = 3420 + 3300 = 6720.00
    check(
      'saldo.custo = 6720.00 (parte FINEP com override + parte BNDES com padrão)',
      samuel?.saldo.custo === '6720.00',
      samuel?.saldo,
    );
  }

  console.log('\n── Colaborador sem override usa o padrão ───────────');
  {
    const leonardo = data.linhas.find(l => l.colaborador.nome === 'Leonardo Alves');
    check('Leonardo Alves encontrado nas linhas', !!leonardo, data.linhas.map(l => l.colaborador.nome));
    // Só sp-01 conta pro gestor1 (sp-06 é do gestor2, fora do escopo) → 80h × 145 (padrão) = 11600.00
    check(
      'saldo.custo = 11600.00 (80h × 145 padrão, só a parte do gestor1)',
      leonardo?.saldo.custo === '11600.00',
      leonardo?.saldo,
    );
  }

  console.log('\n── (Sanidade) saldo de HORAS e teto não mudaram ────');
  {
    const samuel = data.linhas.find(l => l.colaborador.nome === 'Samuel Gomes');
    check('Samuel: totalMeusProj = 70 (40+30)', samuel?.saldo.totalMeusProj === '70', samuel?.saldo);
    check('Samuel: totalGeral = 70', samuel?.saldo.totalGeral === '70', samuel?.saldo);
    check('Samuel: disponivel = 150 (220-70)', samuel?.saldo.disponivel === '150', samuel?.saldo);

    const leonardo = data.linhas.find(l => l.colaborador.nome === 'Leonardo Alves');
    check('Leonardo: totalMeusProj = 80', leonardo?.saldo.totalMeusProj === '80', leonardo?.saldo);
    check('Leonardo: totalOutros = 60 (sp-06, gestor2)', leonardo?.saldo.totalOutros === '60', leonardo?.saldo);
    check('Leonardo: totalGeral = 140', leonardo?.saldo.totalGeral === '140', leonardo?.saldo);
    check('Leonardo: disponivel = 80 (220-140)', leonardo?.saldo.disponivel === '80', leonardo?.saldo);
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log(`Resultado: ${pass} passou(aram), ${fail} falhou(aram).`);
  if (fail > 0) process.exit(1);
}

main().catch(err => {
  console.error('Erro fatal no teste:', err);
  process.exit(1);
});
