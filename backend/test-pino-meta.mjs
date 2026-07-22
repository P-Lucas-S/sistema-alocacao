// Teste do pino de meta mensal (F2b-i).
// Rode com: node test-pino-meta.mjs
// Pressupõe backend em http://localhost:3001 com seed padrão.

import { PrismaClient } from '@prisma/client';

const BASE  = 'http://localhost:3001/api';
const STAMP = Date.now();
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;

function check(label, condition, extra) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    pass++;
  } else {
    console.log(`  ❌ ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`);
    fail++;
  }
}

function somaExata(arr, campo) {
  const centavos = arr.reduce((acc, m) => acc + Math.round(parseFloat(m[campo]) * 100), 0);
  return (centavos / 100).toFixed(2);
}

function addDays(n) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, data };
}

const projetosCriados = [];

async function main() {
  console.log('── Login ─────────────────────────────────────────────────');
  const tokenGestor1 = await login('gestor1@sistema.dev', 'gestor123');
  const tokenGestor3 = await login('gestor3@sistema.dev', 'gestor123');
  const tokenAdmin   = await login('admin@sistema.dev', 'admin123');
  console.log('  Tokens obtidos.\n');

  const { data: categorias } = await api('GET', '/categorias?ativo=true', tokenAdmin);
  const categoriaId = categorias[0].id;

  // ── Setup ──────────────────────────────────────────────────────────────────
  console.log('── Setup: criando projeto ────────────────────────────────');
  const { status: sP, data: proj } = await api('POST', '/projetos', tokenGestor1, {
    codigo: `PINO-${STAMP}`, nome: 'Projeto Pino Teste',
    prestacoesContas: [addDays(30)], categoriaId,
    valorTotal: 120000, valorOficial: 24000,
    estrategiaOficial: 'proporcional',
    vigenciaInicio: '2026-01-01', vigenciaFim: '2026-06-30',
  });
  if (sP !== 201) throw new Error(`Criar projeto falhou: ${JSON.stringify(proj)}`);
  projetosCriados.push(proj.id);
  const pid = proj.id;
  console.log(`  Projeto criado: ${pid}\n`);

  // valorHT = 120000 - 24000 = 96000
  // 6 meses → medicaoBase = 20000.00, valorOficial 4000/mês
  // metaHT padrão/mês = 16000.00; soma = 96000.00

  // ── TESTE 1: GET sem pinos — soma exata e nenhum pinado ───────────────────
  console.log('── Teste 1: GET sem pinos ────────────────────────────────');
  {
    const { status, data } = await api('GET', `/projetos/${pid}/meta-apropriacao`, tokenGestor1);
    check('GET 200', status === 200, data);
    check('configurado: true', data.configurado === true, data);
    check('cascataPendente: false', data.resumo.cascataPendente === false, data.resumo);
    check('somaMetaHT = valorHT', data.resumo.somaMetaHT === data.resumo.valorHT, data.resumo);
    const nenhum = data.meses.every(m => m.pinado === false);
    check('todos os meses: pinado=false', nenhum, data.meses.map(m => m.pinado));
    const somaHT = somaExata(data.meses, 'metaHT');
    check(`soma(metaHT) = 96000.00 (got ${somaHT})`, somaHT === '96000.00', somaHT);
    console.log();
  }

  // ── TESTE 2: PUT pino em Jan/2026 com metaHT = 20000 ────────────────────
  console.log('── Teste 2: PUT pino → mês fica pinado ──────────────────');
  {
    const { status, data } = await api('PUT', `/projetos/${pid}/meta-apropriacao/pino`, tokenGestor1, {
      ano: 2026, mes: 1, metaHT: 20000,
    });
    check('PUT 200', status === 200, data);
    check('metaHT retornado = 20000.00', data.metaHT === '20000.00', data);
    console.log();
  }

  // ── TESTE 3: GET com pino no jan — cascataPendente diferente da situação padrão
  // (16000 pin → 20000: soma = 20000 + 5×16000 = 100000 ≠ 96000 → cascataPendente=true)
  console.log('── Teste 3: GET com pino — cascataPendente + soma descolada ─');
  {
    const { status, data } = await api('GET', `/projetos/${pid}/meta-apropriacao`, tokenGestor1);
    check('GET 200', status === 200, data);
    const jan = data.meses.find(m => m.mes === 1);
    check('Jan: pinado=true', jan?.pinado === true, jan);
    check('Jan: metaHT=20000.00', jan?.metaHT === '20000.00', jan);
    const fev = data.meses.find(m => m.mes === 2);
    check('Fev: pinado=false', fev?.pinado === false, fev);
    // soma = 20000 + 5*16000 = 100000 ≠ 96000 → cascata pendente
    check('cascataPendente=true (soma ≠ valorHT)', data.resumo.cascataPendente === true, data.resumo);
    check('somaMetaHT=100000.00', data.resumo.somaMetaHT === '100000.00', data.resumo);
    console.log();
  }

  // ── TESTE 4: PUT pino — atualizar valor do pino já existente ─────────────
  console.log('── Teste 4: PUT upsert — atualizar pino existente ───────');
  {
    const { status, data } = await api('PUT', `/projetos/${pid}/meta-apropriacao/pino`, tokenGestor1, {
      ano: 2026, mes: 1, metaHT: 16000,
    });
    check('PUT 200', status === 200, data);
    check('metaHT atualizado = 16000.00', data.metaHT === '16000.00', data);
    // Agora soma = 6×16000 = 96000 = valorHT → cascataPendente=false
    const { data: g } = await api('GET', `/projetos/${pid}/meta-apropriacao`, tokenGestor1);
    check('cascataPendente=false após pino = default', g.resumo.cascataPendente === false, g.resumo);
    console.log();
  }

  // ── TESTE 5: DELETE pino → volta ao padrão sem pinado ────────────────────
  console.log('── Teste 5: DELETE pino → mês volta ao estado padrão ────');
  {
    // Primeiro pina de novo com valor diferente para garantir que o delete reverte
    await api('PUT', `/projetos/${pid}/meta-apropriacao/pino`, tokenGestor1, {
      ano: 2026, mes: 2, metaHT: 30000,
    });
    const { status, data } = await api('DELETE', `/projetos/${pid}/meta-apropriacao/pino/2026/2`, tokenGestor1);
    check('DELETE 200', status === 200, data);
    check('removed=true', data.removed === true, data);

    const { data: g } = await api('GET', `/projetos/${pid}/meta-apropriacao`, tokenGestor1);
    const fev = g.meses.find(m => m.mes === 2);
    check('Fev: pinado=false após delete', fev?.pinado === false, fev);
    console.log();
  }

  // ── TESTE 6: DELETE de pino inexistente → 404 ────────────────────────────
  console.log('── Teste 6: DELETE pino inexistente → 404 ───────────────');
  {
    const { status } = await api('DELETE', `/projetos/${pid}/meta-apropriacao/pino/2026/3`, tokenGestor1);
    check('404 para pino não encontrado', status === 404, status);
    console.log();
  }

  // ── TESTE 7: PUT fora da vigência → 400 ──────────────────────────────────
  console.log('── Teste 7: PUT mês fora da vigência → 400 ──────────────');
  {
    const { status, data } = await api('PUT', `/projetos/${pid}/meta-apropriacao/pino`, tokenGestor1, {
      ano: 2026, mes: 7, metaHT: 10000,
    });
    check('400 para mês fora da vigência', status === 400, { status, data });
    console.log();
  }

  // ── TESTE 8: PUT metaHT negativo → 400 ───────────────────────────────────
  console.log('── Teste 8: PUT metaHT negativo → 400 ───────────────────');
  {
    const { status, data } = await api('PUT', `/projetos/${pid}/meta-apropriacao/pino`, tokenGestor1, {
      ano: 2026, mes: 1, metaHT: -100,
    });
    check('400 para metaHT negativo', status === 400, { status, data });
    console.log();
  }

  // ── TESTE 9: Escopo — gestor não-dono → 403 ──────────────────────────────
  console.log('── Teste 9: escopo — gestor não-dono → 403 ──────────────');
  {
    const { status: sP } = await api('PUT', `/projetos/${pid}/meta-apropriacao/pino`, tokenGestor3, {
      ano: 2026, mes: 1, metaHT: 5000,
    });
    check('PUT gestor não-dono → 403', sP === 403, sP);
    const { status: sD } = await api('DELETE', `/projetos/${pid}/meta-apropriacao/pino/2026/1`, tokenGestor3);
    check('DELETE gestor não-dono → 403', sD === 403, sD);
    console.log();
  }

  // ── TESTE 10: Escopo — admin acessa qualquer projeto ─────────────────────
  console.log('── Teste 10: escopo — admin acessa qualquer projeto ──────');
  {
    const { status: sP } = await api('PUT', `/projetos/${pid}/meta-apropriacao/pino`, tokenAdmin, {
      ano: 2026, mes: 3, metaHT: 18000,
    });
    check('PUT admin → 200', sP === 200, sP);
    const { status: sD } = await api('DELETE', `/projetos/${pid}/meta-apropriacao/pino/2026/3`, tokenAdmin);
    check('DELETE admin → 200', sD === 200, sD);
    console.log();
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  // Ordem: dependentes antes dos pais — macro_entregas e alocacoes são ON DELETE
  // RESTRICT (só meta/medicao/oficial ajustes cascateiam). O projeto criado tem
  // uma macro (Geral), então ela precisa sair antes do projeto.
  console.log('── Cleanup ───────────────────────────────────────────────');
  await prisma.metaMensalAjuste.deleteMany({ where: { projetoId: { in: projetosCriados } } });
  await prisma.medicaoMensalAjuste.deleteMany({ where: { projetoId: { in: projetosCriados } } });
  await prisma.oficialMensalAjuste.deleteMany({ where: { projetoId: { in: projetosCriados } } });
  await prisma.alocacao.deleteMany({ where: { projetoId: { in: projetosCriados } } });
  await prisma.microEntrega.deleteMany({ where: { macroEntrega: { projetoId: { in: projetosCriados } } } });
  await prisma.macroEntrega.deleteMany({ where: { projetoId: { in: projetosCriados } } });
  await prisma.projeto.deleteMany({ where: { id: { in: projetosCriados } } });
  console.log(`  ${projetosCriados.length} projeto(s) removido(s).\n`);

  // ── Resultado ─────────────────────────────────────────────────────────────
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  TOTAL: ${pass + fail} | ✅ ${pass} | ❌ ${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
