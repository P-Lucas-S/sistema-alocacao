// Testes do arco P2-config-a: GET/PUT /api/config/priorizacao
// e prova de que calcularPriorizacao LÊ a config (mudança de limiar altera categoria).
// Rode com: node test-config-priorizacao.mjs
// Pressupõe backend de pé em http://localhost:3001 com o seed padrão carregado.

import { PrismaClient } from '@prisma/client';

const BASE  = 'http://localhost:3001/api';
const STAMP = Date.now();
const ANO = 2031, MES = 3; // mês isolado, sem alocações do seed
const prisma = new PrismaClient();

let pass = 0, fail = 0;

function check(label, condition, extra) {
  if (condition) { console.log(`✅ ${label}`); pass++; }
  else           { console.log(`❌ ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); fail++; }
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

function addDays(n) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const projetosCriados = [];

async function criarProjeto(token, sufixo, dataPrestacao, categoriaId) {
  const codigo = `CFGTESTE-${sufixo}-${STAMP}`;
  const { status, data: proj } = await api('POST', '/projetos', token, {
    codigo, nome: `Config Teste ${sufixo}`,
    prestacoesContas: [dataPrestacao], categoriaId,
  });
  if (status !== 201) throw new Error(`Falha ao criar ${codigo}: ${JSON.stringify(proj)}`);
  projetosCriados.push(proj.id);
  return proj;
}

async function main() {
  console.log('── Login ────────────────────────────────────────────');
  const tokenAdmin  = await login('admin@sistema.dev',   'admin123');
  const tokenChefe  = await login('chefe@sistema.dev',   'chefe123');
  const tokenGestor = await login('gestor1@sistema.dev', 'gestor123');
  const tokenCoord  = await login('coord@sistema.dev',   'coord123');
  console.log('Tokens obtidos.\n');

  const { data: categorias } = await api('GET', '/categorias?ativo=true', tokenAdmin);
  const categoriaId = categorias[0].id;

  // ── Restaura defaults antes de tudo (idempotência) ───────────────────────
  await api('PUT', '/config/priorizacao', tokenAdmin, { prazoAltaDias: 7, prazoMediaDias: 30, tetoCapacidadeSinalPct: 95 });

  // ════════════════════════════════════════════════════════════════════════
  console.log('── GET /config/priorizacao ──────────────────────────');
  {
    const { status, data } = await api('GET', '/config/priorizacao', tokenAdmin);
    check('GET → 200', status === 200, status);
    check('prazoAltaDias = 7 (default)',           data?.prazoAltaDias          === 7,  data);
    check('prazoMediaDias = 30 (default)',          data?.prazoMediaDias         === 30, data);
    check('tetoCapacidadeSinalPct = 95 (default)', data?.tetoCapacidadeSinalPct === 95, data);
  }
  {
    const { status } = await api('GET', '/config/priorizacao', tokenCoord);
    check('Coordenação pode ler config → 200', status === 200, status);
  }
  {
    const { status } = await api('GET', '/config/priorizacao', tokenGestor);
    check('Gestor pode ler config → 200', status === 200, status);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── PUT /config/priorizacao — validações ─────────────');
  {
    const { status, data } = await api('PUT', '/config/priorizacao', tokenGestor,
      { prazoAltaDias: 5, prazoMediaDias: 20, tetoCapacidadeSinalPct: 90 });
    check('Gestor → 403 (só admin/chefe editam)', status === 403, { status, data });
  }
  {
    const { status, data } = await api('PUT', '/config/priorizacao', tokenAdmin,
      { prazoAltaDias: 30, prazoMediaDias: 30, tetoCapacidadeSinalPct: 95 });
    check('prazoMediaDias == prazoAltaDias → 400', status === 400, { status, data });
    check('mensagem menciona prazoMediaDias', data?.error?.includes('prazoMediaDias'), data?.error);
  }
  {
    const { status, data } = await api('PUT', '/config/priorizacao', tokenAdmin,
      { prazoAltaDias: 35, prazoMediaDias: 30, tetoCapacidadeSinalPct: 95 });
    check('prazoMediaDias < prazoAltaDias → 400', status === 400, { status, data });
  }
  {
    const { status, data } = await api('PUT', '/config/priorizacao', tokenAdmin,
      { prazoAltaDias: 0, prazoMediaDias: 30, tetoCapacidadeSinalPct: 95 });
    check('prazoAltaDias = 0 → 400 (< 1)', status === 400, { status, data });
  }
  {
    const { status, data } = await api('PUT', '/config/priorizacao', tokenAdmin,
      { prazoAltaDias: 7, prazoMediaDias: 30, tetoCapacidadeSinalPct: 0 });
    check('tetoCapacidadeSinalPct = 0 → 400 (< 1)', status === 400, { status, data });
  }
  {
    const { status, data } = await api('PUT', '/config/priorizacao', tokenAdmin,
      { prazoAltaDias: 7, prazoMediaDias: 30, tetoCapacidadeSinalPct: 101 });
    check('tetoCapacidadeSinalPct = 101 → 400 (> 100)', status === 400, { status, data });
  }
  {
    // chefe deve poder editar
    const { status, data } = await api('PUT', '/config/priorizacao', tokenChefe,
      { prazoAltaDias: 7, prazoMediaDias: 30, tetoCapacidadeSinalPct: 95 });
    check('Chefe pode editar → 200', status === 200, { status });
    check('updatedBy.name presente na resposta', !!data?.updatedBy?.name, data?.updatedBy);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── PROVA QUE O CÁLCULO LÊ A CONFIG ─────────────────');
  // Cenário: projeto que vence em 6 dias.
  //   Com defaults (alta <= 7d) → 'alta'
  //   Após PUT prazoAltaDias=5  → vence em 6d > 5d, e 6d <= 30d → 'media'
  const proj6d = await criarProjeto(tokenAdmin, '6DIAS', addDays(6), categoriaId);

  {
    // Config nos defaults: alta <= 7 dias → vence em 6 dias → 'alta'
    const { data: raw } = await api('GET', `/priorizacao?ano=${ANO}&mes=${MES}`, tokenAdmin);
    const p = raw.itens.find(x => x.projetoId === proj6d.id);
    check('Config default (alta≤7d): projeto +6d → categoria alta',
      p?.categoria === 'alta', { categoria: p?.categoria, prazoAltaDias: 7 });
  }

  // Altera config: prazoAltaDias = 5
  {
    const { status } = await api('PUT', '/config/priorizacao', tokenAdmin,
      { prazoAltaDias: 5, prazoMediaDias: 30, tetoCapacidadeSinalPct: 95 });
    check('PUT prazoAltaDias=5 → 200', status === 200, status);
  }

  {
    // Config alterada: alta <= 5 dias → vence em 6 dias > 5 → faixa media
    const { data: raw } = await api('GET', `/priorizacao?ano=${ANO}&mes=${MES}`, tokenAdmin);
    const p = raw.itens.find(x => x.projetoId === proj6d.id);
    check('Config alterada (alta≤5d): projeto +6d saiu de alta → agora media',
      p?.categoria === 'media', { categoria: p?.categoria, prazoAltaDias: 5 });
  }

  // Restaura defaults ao fim
  await api('PUT', '/config/priorizacao', tokenAdmin,
    { prazoAltaDias: 7, prazoMediaDias: 30, tetoCapacidadeSinalPct: 95 });
  {
    // Confirma que volta pra 'alta' após restaurar
    const { data: raw } = await api('GET', `/priorizacao?ano=${ANO}&mes=${MES}`, tokenAdmin);
    const p = raw.itens.find(x => x.projetoId === proj6d.id);
    check('Após restaurar defaults: projeto +6d volta pra alta',
      p?.categoria === 'alta', { categoria: p?.categoria });
  }

  // ── Limpeza ───────────────────────────────────────────────────────────
  console.log('\n── Limpeza ──────────────────────────────────────────');
  try {
    await prisma.alocacao.deleteMany({ where: { projetoId: { in: projetosCriados } } });
    await prisma.microEntrega.deleteMany({ where: { macroEntrega: { projetoId: { in: projetosCriados } } } });
    await prisma.macroEntrega.deleteMany({ where: { projetoId: { in: projetosCriados } } });
    await prisma.prestacaoContas.deleteMany({ where: { projetoId: { in: projetosCriados } } });
    await prisma.projeto.deleteMany({ where: { id: { in: projetosCriados } } });
    console.log('Limpeza concluída.');
  } catch (err) {
    console.log(`Falha na limpeza: ${err.message}`);
  } finally {
    await prisma.$disconnect();
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log(`Resultado: ${pass} passou(aram), ${fail} falhou(aram).`);
  if (fail > 0) process.exit(1);
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
