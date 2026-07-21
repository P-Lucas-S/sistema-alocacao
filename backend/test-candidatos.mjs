// Teste do endpoint GET /api/alocacoes/candidatos (passo 4c-backend).
// Rode com: node test-candidatos.mjs
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
  let data = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, data };
}

async function main() {
  console.log('── Login ──────────────────────────────────────────');
  const tokenGestor1 = await login('gestor1@sistema.dev', 'gestor123');
  const tokenGestor3 = await login('gestor3@sistema.dev', 'gestor123');
  const tokenCoord   = await login('coord@sistema.dev', 'coord123');
  const tokenDiretor = await login('diretor@sistema.dev', 'diretor123');
  console.log('Tokens obtidos.\n');

  const { data: profissoes } = await api('GET', '/profissoes?ativo=true', tokenGestor1);
  const profDev    = profissoes.find(p => p.nome === 'Desenvolvedor(a) de Software');
  const profDesign = profissoes.find(p => p.nome === 'Designer Gráfico');
  check('Profissão "Desenvolvedor(a) de Software" existe', !!profDev, profissoes.map(p => p.nome));
  check('Profissão "Designer Gráfico" existe', !!profDesign, profissoes.map(p => p.nome));

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Caso A: gestor1 × Dev × Jun/2026 — exclusão "já aloquei" ──');
  // Caio Henrique (sc-03) já está alocado por gestor1 (SEED01, 100h) em Jun/26.
  // Os outros 6 devs ativos (Gustavo, Leonardo, Paulo, Ulisses, Abel, Emerson)
  // não foram alocados por gestor1 em Jun/26 → devem aparecer como candidatos.
  // ════════════════════════════════════════════════════════════════════════
  {
    const { status, data } = await api('GET', `/alocacoes/candidatos?profissaoId=${profDev.id}&ano=2026&mes=6`, tokenGestor1);
    check('Status 200', status === 200, { status, data });
    check('Todos os candidatos são da profissão filtrada', data.every(c => c.profissao?.id === profDev.id), data);
    check('Caio Henrique (já alocado por gestor1) NÃO aparece', !data.some(c => c.nome === 'Caio Henrique'), data.map(c => c.nome));
    check('Exatamente 6 candidatos (7 devs ativos - 1 já alocado)', data.length === 6, data.map(c => c.nome));
    check('Respeita o limite (<= 20)', data.length <= 20, data.length);

    // Ordenado por disponível desc: primeiro >= último
    if (data.length >= 2) {
      const primeiro = parseFloat(data[0].disponivel);
      const ultimo   = parseFloat(data[data.length - 1].disponivel);
      check('Ordenado por disponível desc (primeiro >= último)', primeiro >= ultimo, { primeiro, ultimo });
    }

    // disponivel = 220 - totalAlocado, pra cada um
    const formulaOk = data.every(c => Math.abs(parseFloat(c.disponivel) - (220 - parseFloat(c.totalAlocado))) < 0.001);
    check('disponivel = 220 - totalAlocado em todos', formulaOk, data.map(c => ({ nome: c.nome, totalAlocado: c.totalAlocado, disponivel: c.disponivel })));

    // Gustavo Pires está com 80h alocadas (por gestor2) em Jun/26 → disponivel = 140
    const gustavo = data.find(c => c.nome === 'Gustavo Pires');
    check('Gustavo Pires: totalAlocado=80, disponivel=140 (alocado por gestor2, não eu)', gustavo?.totalAlocado === '80' && gustavo?.disponivel === '140', gustavo);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Caso B: gestor3 × Designer Gráfico × Jun/2026 — exclusão "220h" ──');
  // Enzo Carvalho está em 220h em Jun/26 (gestor1+gestor2, NÃO gestor3) →
  // deve ser excluído por disponivel=0, NÃO por "já alocado por mim".
  // Juliana Ferreira está alocada por gestor3 (SEED10) em Jun/26 → excluída
  // por "já alocado por mim".
  // ════════════════════════════════════════════════════════════════════════
  {
    const { status, data } = await api('GET', `/alocacoes/candidatos?profissaoId=${profDesign.id}&ano=2026&mes=6`, tokenGestor3);
    check('Status 200', status === 200, { status, data });
    check('Enzo Carvalho (220h, teto cheio) NÃO aparece', !data.some(c => c.nome === 'Enzo Carvalho'), data.map(c => c.nome));
    check('Juliana Ferreira (já alocada por gestor3) NÃO aparece', !data.some(c => c.nome === 'Juliana Ferreira'), data.map(c => c.nome));
    check('Exatamente 5 candidatos', data.length === 5, data.map(c => c.nome));

    const adriana = data.find(c => c.nome === 'Adriana Lima');
    check('Adriana Lima: totalAlocado=80 (gestor1, não eu), disponivel=140', adriana?.totalAlocado === '80' && adriana?.disponivel === '140', adriana);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Permissão: coordenação lê, diretor continua fora ────');
  // ════════════════════════════════════════════════════════════════════════
  {
    // Fase B da auditoria (item 2.4): /candidatos é SÓ LEITURA e a faixa do
    // Grid dispara pra qualquer papel que filtre por profissão — coordenação
    // (que já vê o Grid em modo leitura) passou a ter acesso de propósito.
    const { status } = await api('GET', `/alocacoes/candidatos?profissaoId=${profDev.id}&ano=2026&mes=6`, tokenCoord);
    check('Coordenação → 200 (fase B liberou leitura)', status === 200, status);
  }
  {
    const { status } = await api('GET', `/alocacoes/candidatos?profissaoId=${profDev.id}&ano=2026&mes=6`, tokenDiretor);
    check('Diretor → 403 (continua fora — não usa o Grid)', status === 403, status);
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log(`Resultado: ${pass} passou(aram), ${fail} falhou(aram).`);
  if (fail > 0) process.exit(1);
}

main().catch(err => {
  console.error('Erro fatal no teste:', err);
  process.exit(1);
});
