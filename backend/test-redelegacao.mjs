// Teste da re-delegação de projeto (Spec_Papeis_Posse_Exclusao, passo 4b).
// Rode com: node test-redelegacao.mjs
// Pressupõe backend de pé em http://localhost:3001 com o seed padrão carregado.

import { PrismaClient } from '@prisma/client';

const BASE = 'http://localhost:3001/api';
const STAMP = Date.now();

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
  const { token: tokenChefe,   user: chefe }   = await login('chefe@sistema.dev', 'chefe123');
  const { token: tokenGestor1, user: gestor1 } = await login('gestor1@sistema.dev', 'gestor123');
  const { token: tokenGestor2, user: gestor2 } = await login('gestor2@sistema.dev', 'gestor123');
  const { token: tokenAdmin }                  = await login('admin@sistema.dev', 'admin123');
  const { token: tokenDiretor, user: diretor } = await login('diretor@sistema.dev', 'diretor123');
  console.log(`chefe=${chefe.id} gestor1=${gestor1.id} gestor2=${gestor2.id}\n`);

  // Nota: GET /api/categorias hoje exige admin/gestor/coordenacao — 'chefe' não
  // está nessa lista (gap pré-existente, fora do escopo deste passo). Busca com
  // o token do gestor1 só pra montar o setup; as chamadas de re-delegação em si
  // usam tokenChefe normalmente.
  const { data: categorias } = await api('GET', '/categorias?ativo=true', tokenGestor1);
  const categoriaId = categorias[0].id;
  const { data: colaboradores } = await api('GET', '/colaboradores?ativo=true', tokenChefe);
  const colaborador = colaboradores[0];

  console.log('── Setup: chefe cria projeto delegado ao gestor1 + 1 alocação ──');
  const ANO = 2026, MES = 12;
  let projetoId, macroId, microId, alocacaoId, horasOriginais;
  {
    const { status, data } = await api('POST', '/projetos', tokenChefe, {
      codigo: `REDEL${STAMP}`, nome: 'Projeto Redelegação Teste',
      prestacoesContas: ['2026-12-31'], categoriaId, gestorId: gestor1.id,
    });
    check('Projeto criado (gestorId=gestor1)', status === 201 && data?.gestorId === gestor1.id, data);
    projetoId = data.id;

    const macroRes = await api('POST', `/projetos/${projetoId}/macros`, tokenChefe, { nome: 'Macro Redel' });
    macroId = macroRes.data.id;
    microId = macroRes.data.microEntregas.find(m => m.nome === 'Geral').id;

    const alocRes = await api('POST', '/alocacoes', tokenChefe, {
      colaboradorId: colaborador.id, projetoId, macroEntregaId: macroId, microEntregaId: microId,
      ano: ANO, mes: MES, horasPlanejadas: 10,
    });
    check('Alocação criada', alocRes.status === 201, alocRes);
    alocacaoId = alocRes.data.alocacao.id;
    horasOriginais = alocRes.data.alocacao.horasPlanejadas;
  }

  console.log('\n── Chefe re-delega o projeto pro gestor2 ───────────');
  {
    const { status, data } = await api('PATCH', `/projetos/${projetoId}/redelegar`, tokenChefe, { gestorId: gestor2.id });
    check('Status 200', status === 200, { status, data });
    check('projeto.gestorId === gestor2', data?.gestorId === gestor2.id, data);
  }

  const prisma = new PrismaClient();
  console.log('\n── Linha de auditoria em redelegacoes ──────────────');
  {
    const linhas = await prisma.redelegacao.findMany({ where: { projetoId } });
    check('Exatamente 1 linha gravada', linhas.length === 1, linhas);
    const r = linhas[0];
    check('projetoId correto', r?.projetoId === projetoId, r);
    check('gestorAnteriorId === gestor1', r?.gestorAnteriorId === gestor1.id, r);
    check('gestorNovoId === gestor2', r?.gestorNovoId === gestor2.id, r);
    check('redelegadoPorId === chefe', r?.redelegadoPorId === chefe.id, r);
  }

  console.log('\n── INVARIANTE: a alocação não foi tocada ───────────');
  {
    const aloc = await prisma.alocacao.findUnique({ where: { id: alocacaoId } });
    check('Alocação ainda existe', !!aloc, aloc);
    check('horasPlanejadas inalteradas', aloc?.horasPlanejadas.toString() === horasOriginais, { aloc, horasOriginais });
    check('projetoId inalterado', aloc?.projetoId === projetoId, aloc);
    check('macroEntregaId inalterado', aloc?.macroEntregaId === macroId, aloc);
    check('microEntregaId inalterado', aloc?.microEntregaId === microId, aloc);
  }

  console.log('\n── Troca de grid: saiu do gestor1, entrou no gestor2 ──');
  {
    const { data: gridG2 } = await api('GET', `/alocacoes/grid?ano=${ANO}&mes=${MES}`, tokenGestor2);
    check('Projeto aparece nas colunas do gestor2', gridG2.projetos.some(p => p.id === projetoId), gridG2.projetos.map(p => p.codigo));
  }
  {
    const { data: gridG1 } = await api('GET', `/alocacoes/grid?ano=${ANO}&mes=${MES}`, tokenGestor1);
    check('Projeto NÃO aparece mais nas colunas do gestor1', !gridG1.projetos.some(p => p.id === projetoId), gridG1.projetos.map(p => p.codigo));
  }

  console.log('\n── Autorização: só chefe re-delega ─────────────────');
  {
    const { status } = await api('PATCH', `/projetos/${projetoId}/redelegar`, tokenGestor1, { gestorId: gestor1.id });
    check('Gestor comum → 403', status === 403, status);
  }
  {
    const { status } = await api('PATCH', `/projetos/${projetoId}/redelegar`, tokenAdmin, { gestorId: gestor1.id });
    check('Admin → 403 (só chefe)', status === 403, status);
  }

  console.log('\n── Validações de negócio ───────────────────────────');
  {
    const { status, data } = await api('PATCH', `/projetos/${projetoId}/redelegar`, tokenChefe, { gestorId: diretor.id });
    check('Re-delegar pro diretor (não-gestor) → 400', status === 400, { status, data });
  }
  {
    const { status, data } = await api('PATCH', `/projetos/${projetoId}/redelegar`, tokenChefe, { gestorId: gestor2.id });
    check('Re-delegar pro mesmo gestor atual (gestor2) → 400', status === 400, { status, data });
  }

  console.log('\n── Projeto arquivado não pode ser re-delegado ──────');
  let projetoArquivadoId;
  {
    const { data: projArq } = await api('POST', '/projetos', tokenChefe, {
      codigo: `REDELARQ${STAMP}`, nome: 'Projeto Arquivado Teste',
      prestacoesContas: ['2026-12-31'], categoriaId, gestorId: gestor1.id,
    });
    projetoArquivadoId = projArq.id;
    const arq = await api('PATCH', `/projetos/${projetoArquivadoId}/status`, tokenChefe, { status: 'arquivado' });
    check('Projeto arquivado com sucesso', arq.status === 200, arq);

    const { status, data } = await api('PATCH', `/projetos/${projetoArquivadoId}/redelegar`, tokenChefe, { gestorId: gestor2.id });
    check('Re-delegar projeto arquivado → 400', status === 400, { status, data });
  }

  console.log('\n── Projeto inexistente → 404 ───────────────────────');
  {
    const { status } = await api('PATCH', '/projetos/nao-existe-xyz/redelegar', tokenChefe, { gestorId: gestor2.id });
    check('Status 404', status === 404, status);
  }

  // ── Limpeza ────────────────────────────────────────────────────────────────
  console.log('\n── Limpeza ──────────────────────────────────────────');
  try {
    await prisma.redelegacao.deleteMany({ where: { projetoId: { in: [projetoId, projetoArquivadoId] } } });
    await prisma.alocacaoLog.deleteMany({ where: { alocacaoId } });
    await prisma.alocacao.deleteMany({ where: { id: alocacaoId } });
    await prisma.microEntrega.deleteMany({ where: { macroEntrega: { projetoId: { in: [projetoId, projetoArquivadoId] } } } });
    await prisma.macroEntrega.deleteMany({ where: { projetoId: { in: [projetoId, projetoArquivadoId] } } });
    await prisma.prestacaoContas.deleteMany({ where: { projetoId: { in: [projetoId, projetoArquivadoId] } } });
    await prisma.projeto.deleteMany({ where: { id: { in: [projetoId, projetoArquivadoId] } } });
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
