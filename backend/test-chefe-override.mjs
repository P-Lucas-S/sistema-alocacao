// Teste do override do chefe — opera projetos que não são dele, pelo mesmo
// caminho do gestor dono (mesmo alocarComLock, mesmo requireOwner).
// Rode com: node test-chefe-override.mjs
// Pressupõe backend de pé em http://localhost:3001 com o seed padrão carregado.

import { PrismaClient } from '@prisma/client';

const BASE = 'http://localhost:3001/api';

let pass = 0;
let fail = 0;
const alocacoesCriadas = [];
let macroCriadaId = null;
let projetoSeedId = null;

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

async function main() {
  console.log('── Login ──────────────────────────────────────────');
  const { token: tokenGestor1, user: gestor1 } = await login('gestor1@sistema.dev', 'gestor123');
  const { token: tokenGestor2, user: gestor2 } = await login('gestor2@sistema.dev', 'gestor123');
  const { token: tokenChefe,   user: chefe }   = await login('chefe@sistema.dev', 'chefe123');
  const { token: tokenDiretor }                = await login('diretor@sistema.dev', 'diretor123');
  const { token: tokenCoord }                  = await login('coord@sistema.dev', 'coord123');
  console.log(`gestor1=${gestor1.id} gestor2=${gestor2.id} chefe=${chefe.id}\n`);

  console.log('── Projeto do gestor1 (seed) — chefe NÃO é dono ────');
  const { data: projetosG1 } = await api('GET', '/projetos?status=ativo', tokenGestor1);
  const projetoSeed = projetosG1.find(p => p.gestorId === gestor1.id);
  check('Achou um projeto ativo do gestor1', !!projetoSeed, projetosG1.map(p => p.codigo));
  projetoSeedId = projetoSeed.id;
  console.log(`Projeto: ${projetoSeed.codigo} (gestor=${projetoSeed.gestorId}, chefe≠dono)\n`);

  const { data: macrosSeed } = await api('GET', `/projetos/${projetoSeedId}/macros`, tokenGestor1);
  const macroSeed = macrosSeed[0];
  const microGeralSeed = macroSeed.microEntregas.find(m => m.nome === 'Geral');

  const { data: colaboradores } = await api('GET', '/colaboradores?ativo=true', tokenChefe);
  const colaborador = colaboradores[0];

  console.log('── Chefe ALOCA num projeto que não é dele ──────────');
  {
    const { status, data } = await api('POST', '/alocacoes', tokenChefe, {
      colaboradorId: colaborador.id, projetoId: projetoSeedId,
      macroEntregaId: macroSeed.id, microEntregaId: microGeralSeed.id,
      ano: 2026, mes: 9, horasPlanejadas: 5,
    });
    check('Status 201 (override: opera projeto que não é dele)', status === 201, { status, data });
    if (data?.alocacao?.id) alocacoesCriadas.push(data.alocacao.id);
  }

  console.log('\n── Chefe EDITA o projeto (PUT /:id) ────────────────');
  {
    const { status, data } = await api('PUT', `/projetos/${projetoSeedId}`, tokenChefe, {
      nome: projetoSeed.nome, // mesmo nome — só confirma que a edição é aceita
    });
    check('Status 200', status === 200, { status, data });
  }

  console.log('\n── Chefe cria/edita/apaga uma MACRO nesse projeto ──');
  {
    const { status, data } = await api('POST', `/projetos/${projetoSeedId}/macros`, tokenChefe, { nome: 'Macro do Chefe (teste)' });
    check('Criar macro → 201', status === 201, { status, data });
    macroCriadaId = data?.id;
  }
  {
    const { status, data } = await api('PUT', `/projetos/${projetoSeedId}/macros/${macroCriadaId}`, tokenChefe, { nome: 'Macro do Chefe (renomeada)' });
    check('Editar macro → 200', status === 200, { status, data });
  }
  {
    // sem alocação → 1ª chamada já dá needsConfirmation; confirmar=true apaga
    const r1 = await api('DELETE', `/projetos/${projetoSeedId}/macros/${macroCriadaId}`, tokenChefe);
    check('Apagar macro (1ª chamada) → needsConfirmation', r1.data?.needsConfirmation === true, r1);
    const r2 = await api('DELETE', `/projetos/${projetoSeedId}/macros/${macroCriadaId}?confirmar=true`, tokenChefe);
    check('Apagar macro (confirmada) → ok:true', r2.status === 200 && r2.data?.ok === true, r2);
    macroCriadaId = null; // já apagada, não precisa entrar na limpeza
  }

  console.log('\n── Chefe roda copiar-realizado cobrindo OUTRO gestor (como admin) ──');
  {
    // Garante que há ao menos uma alocação SEM realizado em algum projeto do gestor2 em 2026/06 (seed)
    const { data: projetosG2 } = await api('GET', '/projetos?status=ativo', tokenGestor2);
    const projG2 = projetosG2.find(p => p.gestorId === gestor2.id);
    const { data: alocsG2 } = await api('GET', `/alocacoes?projetoId=${projG2.id}&ano=2026&mes=6`, tokenChefe);
    const semRealizado = alocsG2.filter(a => a.horasRealizadas === null).length;

    const { status, data } = await api('POST', '/alocacoes/copiar-realizado', tokenChefe, { ano: 2026, mes: 6 });
    check('Status 200', status === 200, { status, data });
    check('atualizadas > 0 (cobriu projeto de outro gestor, igual admin)', data?.atualizadas > 0, { data, semRealizado });
  }

  console.log('\n── Coordenação e diretor seguem 403 ────────────────');
  {
    const { status } = await api('POST', '/alocacoes', tokenCoord, {
      colaboradorId: colaborador.id, projetoId: projetoSeedId,
      macroEntregaId: macroSeed.id, microEntregaId: microGeralSeed.id,
      ano: 2026, mes: 9, horasPlanejadas: 1,
    });
    check('Coordenação → 403 em POST /alocacoes', status === 403, status);
  }
  {
    const { status } = await api('POST', '/alocacoes', tokenDiretor, {
      colaboradorId: colaborador.id, projetoId: projetoSeedId,
      macroEntregaId: macroSeed.id, microEntregaId: microGeralSeed.id,
      ano: 2026, mes: 9, horasPlanejadas: 1,
    });
    check('Diretor → 403 em POST /alocacoes', status === 403, status);
  }
  {
    const { status } = await api('PUT', `/projetos/${projetoSeedId}`, tokenCoord, { nome: projetoSeed.nome });
    check('Coordenação → 403 em PUT /projetos/:id', status === 403, status);
  }
  {
    const { status } = await api('PUT', `/projetos/${projetoSeedId}`, tokenDiretor, { nome: projetoSeed.nome });
    check('Diretor → 403 em PUT /projetos/:id', status === 403, status);
  }
  {
    const { status } = await api('POST', `/projetos/${projetoSeedId}/macros`, tokenCoord, { nome: 'X' });
    check('Coordenação → 403 em POST macros', status === 403, status);
  }
  {
    const { status } = await api('POST', `/projetos/${projetoSeedId}/macros`, tokenDiretor, { nome: 'X' });
    check('Diretor → 403 em POST macros', status === 403, status);
  }

  // ── Limpeza ────────────────────────────────────────────────────────────────
  console.log('\n── Limpeza ──────────────────────────────────────────');
  const prisma = new PrismaClient();
  try {
    for (const alocId of alocacoesCriadas) {
      await prisma.alocacaoLog.deleteMany({ where: { alocacaoId: alocId } });
      await prisma.alocacao.delete({ where: { id: alocId } }).catch(() => {});
    }
    if (macroCriadaId) {
      await prisma.microEntrega.deleteMany({ where: { macroEntregaId: macroCriadaId } });
      await prisma.macroEntrega.delete({ where: { id: macroCriadaId } }).catch(() => {});
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
