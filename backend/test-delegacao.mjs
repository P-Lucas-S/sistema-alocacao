// Teste da delegação de posse na criação de projeto (Spec_Papeis_Posse_Exclusao, passo 2b).
// Rode com: node test-delegacao.mjs
// Pressupõe backend de pé em http://localhost:3001 com o seed padrão carregado.

import { PrismaClient } from '@prisma/client';

const BASE = 'http://localhost:3001/api';
const STAMP = Date.now();

let pass = 0;
let fail = 0;
const projetosCriados = [];

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
  return { token: data.token, user: data.user };
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

function corpoProjeto(extra, categoriaId, n) {
  return {
    codigo: `DELEG${STAMP}${n}`, nome: `Projeto Delegação Teste ${n}`,
    prestacoesContas: ['2026-12-31'], categoriaId,
    ...extra,
  };
}

async function main() {
  console.log('── Login ──────────────────────────────────────────');
  const { token: tokenGestor1, user: gestor1 } = await login('gestor1@sistema.dev', 'gestor123');
  const { token: tokenGestor2, user: gestor2 } = await login('gestor2@sistema.dev', 'gestor123');
  const { token: tokenChefe,   user: chefe }   = await login('chefe@sistema.dev', 'chefe123');
  const { token: tokenDiretor, user: diretor } = await login('diretor@sistema.dev', 'diretor123');
  const { token: tokenCoord }                  = await login('coord@sistema.dev', 'coord123');
  console.log(`gestor1=${gestor1.id} gestor2=${gestor2.id} chefe=${chefe.id} diretor=${diretor.id}\n`);

  const { data: categorias } = await api('GET', '/categorias?ativo=true', tokenGestor1);
  const categoriaId = categorias[0].id;

  console.log('── 1) Gestor cria sem gestorId no corpo ────────────');
  {
    const { status, data } = await api('POST', '/projetos', tokenGestor1, corpoProjeto({}, categoriaId, 1));
    check('Status 201', status === 201, { status, data });
    check('gestorId == gestor1', data?.gestorId === gestor1.id, data);
    check('criadoPorId == gestor1', data?.criadoPorId === gestor1.id, data);
    if (data?.id) projetosCriados.push(data.id);
  }

  console.log('\n── 2) Chefe cria COM gestorId = gestor2 (delegação) ──');
  {
    const { status, data } = await api('POST', '/projetos', tokenChefe, corpoProjeto({ gestorId: gestor2.id }, categoriaId, 2));
    check('Status 201', status === 201, { status, data });
    check('gestorId == gestor2 (delegado)', data?.gestorId === gestor2.id, data);
    check('criadoPorId == chefe', data?.criadoPorId === chefe.id, data);
    if (data?.id) projetosCriados.push(data.id);
  }

  console.log('\n── 3) Chefe cria SEM gestorId (mantém pra si) ──────');
  {
    const { status, data } = await api('POST', '/projetos', tokenChefe, corpoProjeto({}, categoriaId, 3));
    check('Status 201', status === 201, { status, data });
    check('gestorId == chefe (mantido)', data?.gestorId === chefe.id, data);
    check('criadoPorId == chefe', data?.criadoPorId === chefe.id, data);
    if (data?.id) projetosCriados.push(data.id);
  }

  console.log('\n── 4) Chefe cria COM gestorId de não-gestor → 400 ──');
  {
    const { status, data } = await api('POST', '/projetos', tokenChefe, corpoProjeto({ gestorId: diretor.id }, categoriaId, 4));
    check('gestorId = diretor → 400', status === 400, { status, data });
  }
  {
    const { status, data } = await api('POST', '/projetos', tokenChefe, corpoProjeto({ gestorId: chefe.id }, categoriaId, 5));
    check('gestorId = o próprio chefe → 400', status === 400, { status, data });
  }

  console.log('\n── 5) Coordenação e diretor → 403 ──────────────────');
  {
    const { status, data } = await api('POST', '/projetos', tokenCoord, corpoProjeto({}, categoriaId, 6));
    check('Coordenação → 403', status === 403, { status, data });
  }
  {
    const { status, data } = await api('POST', '/projetos', tokenDiretor, corpoProjeto({}, categoriaId, 7));
    check('Diretor → 403', status === 403, { status, data });
  }

  console.log('\n── 6) Gestor mandando gestorId de outro gestor → ignorado ──');
  {
    const { status, data } = await api('POST', '/projetos', tokenGestor1, corpoProjeto({ gestorId: gestor2.id }, categoriaId, 8));
    check('Status 201', status === 201, { status, data });
    check('gestorId == gestor1 (gestorId do corpo foi ignorado)', data?.gestorId === gestor1.id, data);
    check('criadoPorId == gestor1', data?.criadoPorId === gestor1.id, data);
    if (data?.id) projetosCriados.push(data.id);
  }

  // ── Limpeza ────────────────────────────────────────────────────────────────
  console.log('\n── Limpeza dos projetos de teste ───────────────────');
  const prisma = new PrismaClient();
  try {
    for (const projetoId of projetosCriados) {
      await prisma.alocacao.deleteMany({ where: { projetoId } });
      await prisma.microEntrega.deleteMany({ where: { macroEntrega: { projetoId } } });
      await prisma.macroEntrega.deleteMany({ where: { projetoId } });
      await prisma.prestacaoContas.deleteMany({ where: { projetoId } });
      await prisma.projeto.delete({ where: { id: projetoId } });
    }
    console.log(`${projetosCriados.length} projeto(s) de teste removido(s).`);
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
  console.error('Erro fatal no teste:', err);
  process.exit(1);
});
