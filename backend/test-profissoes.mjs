// Teste manual do endpoint /api/profissoes — rode com: node test-profissoes.mjs
// Clone de test-areas-atuacao.mjs (mesmo molde). Pressupõe backend de pé em
// http://localhost:3001 com o seed padrão carregado.

import { PrismaClient } from '@prisma/client';

const BASE = 'http://localhost:3001/api';
const prisma = new PrismaClient();

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

async function main() {
  console.log('── Login ──────────────────────────────────────────');
  const tokenGestor  = await login('gestor1@sistema.dev', 'gestor123');
  const tokenCoord   = await login('coord@sistema.dev', 'coord123');
  const tokenChefe   = await login('chefe@sistema.dev', 'chefe123');
  const tokenDiretor = await login('diretor@sistema.dev', 'diretor123');
  console.log('Tokens obtidos para gestor, coordenação, chefe e diretor.\n');

  const idsCriados = []; // limpeza no fim

  console.log('── GET /api/profissoes — lista as profissões semeadas ──');
  {
    const { status, data } = await api('GET', '/profissoes', tokenGestor);
    check('GET retorna 200', status === 200, { status });
    const nomes = Array.isArray(data) ? data.map(p => p.nome).sort() : [];
    const esperados = ['Desenvolvedor(a) de Software', 'Designer UX/UI', 'Product Manager', 'Scrum Master'];
    check('Contém profissões semeadas', esperados.every(n => nomes.includes(n)), nomes);
    check('Total semeado = 20', nomes.length === 20, nomes);
  }

  console.log('\n── GET liberado: chefe e diretor recebem 200 ───────');
  {
    const { status } = await api('GET', '/profissoes', tokenChefe);
    check('Chefe → 200 (não 403)', status === 200, { status });
  }
  {
    const { status } = await api('GET', '/profissoes', tokenDiretor);
    check('Diretor → 200 (não 403)', status === 200, { status });
  }

  console.log('\n── POST "Desenvolvedor(a) de Software" (exato) → 409 ──');
  {
    const { status, data } = await api('POST', '/profissoes', tokenGestor, { nome: 'Desenvolvedor(a) de Software' });
    check('Status 409', status === 409, { status, data });
    check('Tem campo existente', data?.existente?.nome === 'Desenvolvedor(a) de Software', data);
  }

  console.log('\n── POST "desenvolvedor(a) de software" (caixa diferente) → 409, mesmo com confirmarSimilar:true ──');
  {
    const { status, data } = await api('POST', '/profissoes', tokenGestor, { nome: 'desenvolvedor(a) de software', confirmarSimilar: true });
    check('Status 409 (exato nunca contornável)', status === 409, { status, data });
  }

  console.log('\n── POST "Desenvolvedor(a) de Softwar" (similar, sem confirmarSimilar) ──');
  let aindaIgualAntes;
  {
    const before = await api('GET', '/profissoes', tokenGestor);
    aindaIgualAntes = before.data.length;

    const { status, data } = await api('POST', '/profissoes', tokenGestor, { nome: 'Desenvolvedor(a) de Softwar' });
    check('Status 200 com needsConfirmation', status === 200 && data?.needsConfirmation === true, { status, data });
    check('similares contém Desenvolvedor(a) de Software', (data?.similares ?? []).some(s => s.nome === 'Desenvolvedor(a) de Software'), data?.similares);

    const after = await api('GET', '/profissoes', tokenGestor);
    check('Nada foi criado (contagem inalterada)', after.data.length === aindaIgualAntes, { antes: aindaIgualAntes, depois: after.data.length });
  }

  console.log('\n── POST "Desenvolvedor(a) de Softwar" com confirmarSimilar: true → cria ──');
  {
    const { status, data } = await api('POST', '/profissoes', tokenGestor, { nome: 'Desenvolvedor(a) de Softwar', confirmarSimilar: true });
    check('Status 201', status === 201, { status, data });
    check('Profissão criada, chave "profissao"', data?.profissao?.nome === 'Desenvolvedor(a) de Softwar', data);
    if (data?.profissao?.id) idsCriados.push(data.profissao.id);
  }

  console.log('\n── POST "Eletricista" (novo e distinto) → cria ─────');
  let eletricistaId;
  {
    const { status, data } = await api('POST', '/profissoes', tokenGestor, { nome: 'Eletricista' });
    check('Status 201', status === 201, { status, data });
    check('Profissão criada com nome Eletricista', data?.profissao?.nome === 'Eletricista', data);
    eletricistaId = data?.profissao?.id;
    if (eletricistaId) idsCriados.push(eletricistaId);
  }

  console.log('\n── PATCH renomeando Eletricista → Scrum Master (já existe) → 409 ──');
  {
    const { status, data } = await api('PATCH', `/profissoes/${eletricistaId}`, tokenGestor, { nome: 'Scrum Master' });
    check('Status 409', status === 409, { status, data });
  }

  console.log('\n── PATCH renomeando Eletricista → Eletrotécnico (novo) → ok ──');
  {
    const { status, data } = await api('PATCH', `/profissoes/${eletricistaId}`, tokenGestor, { nome: 'Eletrotécnico' });
    check('Status 200, objeto direto (sem wrapper)', status === 200, { status, data });
    check('Nome atualizado', data?.nome === 'Eletrotécnico', data);
  }

  console.log('\n── PATCH desativando Eletrotécnico → ok ────────────');
  {
    const { status, data } = await api('PATCH', `/profissoes/${eletricistaId}`, tokenGestor, { ativo: false });
    check('Status 200', status === 200, { status, data });
    check('ativo = false', data?.ativo === false, data);
  }

  console.log('\n── Permissão: gestor faz POST; coordenação/diretor → 403 ──');
  let permGestorId;
  {
    const { status, data } = await api('POST', '/profissoes', tokenGestor, { nome: 'TESTE-PERMISSAO-GESTOR' });
    check('Gestor consegue POST (201)', status === 201, { status });
    permGestorId = data?.profissao?.id;
    if (permGestorId) idsCriados.push(permGestorId);
  }
  {
    const { status, data } = await api('POST', '/profissoes', tokenCoord, { nome: 'TESTE-PERMISSAO-COORD' });
    check('Coordenação recebe 403 no POST', status === 403, { status, data });
  }
  {
    const { status, data } = await api('POST', '/profissoes', tokenDiretor, { nome: 'TESTE-PERMISSAO-DIRETOR' });
    check('Diretor recebe 403 no POST', status === 403, { status, data });
  }

  // ── Limpeza (via Prisma) ────────────────────────────────────────────────────
  console.log('\n── Limpeza ──────────────────────────────────────────');
  try {
    if (idsCriados.length) {
      await prisma.profissao.deleteMany({ where: { id: { in: idsCriados } } });
    }
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
  console.error('Erro fatal no teste:', err);
  process.exit(1);
});
