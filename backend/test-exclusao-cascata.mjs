// Teste da cascata de exclusão permanente de projeto (Spec_Papeis_Posse_Exclusao,
// passo 5b). As funções são internas (não há rota ainda) — importadas direto
// do módulo via tsx. Rode com: node --import tsx/esm test-exclusao-cascata.mjs
// Pressupõe backend de pé em http://localhost:3001 com o seed padrão carregado.

import { PrismaClient } from '@prisma/client';
import { precheckExclusao, executarExclusaoCascata, ExclusaoBloqueadaError } from './src/lib/exclusaoProjeto.ts';

const BASE = 'http://localhost:3001/api';
const STAMP = Date.now();
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
  const { token: tokenAdmin }                  = await login('admin@sistema.dev', 'admin123');
  console.log(`chefe=${chefe.id} gestor1=${gestor1.id}\n`);

  // GET /categorias 403 pra chefe (gap conhecido do passo 4b) — busca com gestor1
  const { data: categorias } = await api('GET', '/categorias?ativo=true', tokenGestor1);
  const categoriaId = categorias[0].id;
  const { data: colaboradores } = await api('GET', '/colaboradores?ativo=true', tokenChefe);
  const colaborador = colaboradores[0];

  const codigoReuso = `EXCL${STAMP}`;
  let projeto1Id, alocacao1Id, alocacao2Id;
  let lapideId;
  let logIds = [];

  console.log('── Setup: projeto com 1 macro + 2 alocações (mês aberto) ──');
  {
    const { status, data } = await api('POST', '/projetos', tokenChefe, {
      codigo: codigoReuso, nome: 'Projeto Exclusão Teste',
      prestacoesContas: ['2026-12-31'], categoriaId, gestorId: gestor1.id,
    });
    check('Projeto criado', status === 201, data);
    projeto1Id = data.id;

    const macroRes = await api('POST', `/projetos/${projeto1Id}/macros`, tokenChefe, { nome: 'Macro Excl' });
    const macroId = macroRes.data.id;
    const microId = macroRes.data.microEntregas.find(m => m.nome === 'Geral').id;

    const a1 = await api('POST', '/alocacoes', tokenChefe, {
      colaboradorId: colaborador.id, projetoId: projeto1Id, macroEntregaId: macroId, microEntregaId: microId,
      ano: 2026, mes: 10, horasPlanejadas: 8,
    });
    const a2 = await api('POST', '/alocacoes', tokenChefe, {
      colaboradorId: colaborador.id, projetoId: projeto1Id, macroEntregaId: macroId, microEntregaId: microId,
      ano: 2026, mes: 11, horasPlanejadas: 12,
    });
    check('Alocação 1 criada (8h, 2026-10)', a1.status === 201, a1);
    check('Alocação 2 criada (12h, 2026-11)', a2.status === 201, a2);
    alocacao1Id = a1.data.alocacao.id;
    alocacao2Id = a2.data.alocacao.id;
  }

  console.log('\n── precheckExclusao → excluível ────────────────────');
  {
    const result = await precheckExclusao(projeto1Id);
    check('ok: true', result.ok === true, result);
    check('totalAlocacoes === 2', result.ok && result.totalAlocacoes === 2, result);
    check('totalHoras === 20', result.ok && parseFloat(result.totalHoras) === 20, result);
  }

  console.log('\n── executarExclusaoCascata ─────────────────────────');
  {
    const resultado = await executarExclusaoCascata(projeto1Id, {
      solicitanteId: gestor1.id, aprovadorId: chefe.id, motivo: 'teste',
    });
    check('excluido: true', resultado.excluido === true, resultado);
    check('codigo retornado correto', resultado.codigo === codigoReuso, resultado);
    check('totalAlocacoesApagadas === 2', resultado.totalAlocacoesApagadas === 2, resultado);
  }

  console.log('\n── Projeto e filhos sumiram ────────────────────────');
  {
    const projeto = await prisma.projeto.findUnique({ where: { id: projeto1Id } });
    check('Projeto não existe mais', projeto === null, projeto);
    const alocs = await prisma.alocacao.findMany({ where: { projetoId: projeto1Id } });
    check('Alocações sumiram', alocs.length === 0, alocs);
    const macros = await prisma.macroEntrega.findMany({ where: { projetoId: projeto1Id } });
    check('Macros sumiram', macros.length === 0, macros);
    const prest = await prisma.prestacaoContas.findMany({ where: { projetoId: projeto1Id } });
    check('Prestações sumiram', prest.length === 0, prest);
  }

  console.log('\n── Logs \'removeu\' sobrevivem (contexto denormalizado) ──');
  {
    // POST /alocacoes já grava um log 'criou' na criação — filtra só os
    // 'removeu' que a cascata gravou, pra não confundir os dois.
    const todosLogs = await prisma.alocacaoLog.findMany({
      where: { alocacaoId: { in: [alocacao1Id, alocacao2Id] } },
    });
    logIds = todosLogs.map(l => l.id); // limpa 'criou' + 'removeu' no fim

    const logs = todosLogs.filter(l => l.acao === 'removeu');
    check('2 logs \'removeu\' gravados (mais os 2 \'criou\' da criação, ignorados aqui)', logs.length === 2, todosLogs);
    check('Todos usuarioId=chefe', logs.every(l => l.usuarioId === chefe.id), logs);
    const log8h  = logs.find(l => l.alocacaoId === alocacao1Id);
    const log12h = logs.find(l => l.alocacaoId === alocacao2Id);
    check('Log da alocação de 8h com horasAnteriores=8',  log8h  && parseFloat(log8h.horasAnteriores)  === 8,  log8h);
    check('Log da alocação de 12h com horasAnteriores=12', log12h && parseFloat(log12h.horasAnteriores) === 12, log12h);
    check('horasNovas=null nos dois \'removeu\'', logs.every(l => l.horasNovas === null), logs);
  }

  console.log('\n── Lápide gravada em projeto_excluido ──────────────');
  {
    const lapides = await prisma.projetoExcluido.findMany({ where: { projetoIdOriginal: projeto1Id } });
    check('Exatamente 1 lápide', lapides.length === 1, lapides);
    const l = lapides[0];
    check('codigo correto', l?.codigo === codigoReuso, l);
    check('nome correto', l?.nome === 'Projeto Exclusão Teste', l);
    check('gestorIdOriginal === gestor1', l?.gestorIdOriginal === gestor1.id, l);
    check('criadoPorIdOriginal === chefe', l?.criadoPorIdOriginal === chefe.id, l);
    check('aprovadorId === chefe', l?.aprovadorId === chefe.id, l);
    check('solicitanteId === gestor1', l?.solicitanteId === gestor1.id, l);
    check('motivo === "teste"', l?.motivo === 'teste', l);
    lapideId = l?.id;
  }

  console.log('\n── Código liberado: reuso sem 409 ──────────────────');
  let projetoReusoId;
  {
    const { status, data } = await api('POST', '/projetos', tokenChefe, {
      codigo: codigoReuso, nome: 'Projeto Reuso de Código',
      prestacoesContas: ['2026-12-31'], categoriaId, gestorId: gestor1.id,
    });
    check('Criado sem 409 (código liberado)', status === 201, { status, data });
    projetoReusoId = data?.id;
  }

  console.log('\n── Mês FECHADO bloqueia a exclusão ─────────────────');
  const anoF = 2030, mesF = 5;
  let projeto2Id, alocacao3Id, macro2Id, micro2Id;
  {
    const { data: proj2 } = await api('POST', '/projetos', tokenChefe, {
      codigo: `EXCLFECH${STAMP}`, nome: 'Projeto Mês Fechado Teste',
      prestacoesContas: ['2026-12-31'], categoriaId, gestorId: gestor1.id,
    });
    projeto2Id = proj2.id;
    const macroRes2 = await api('POST', `/projetos/${projeto2Id}/macros`, tokenChefe, { nome: 'Macro Fechado' });
    macro2Id = macroRes2.data.id;
    micro2Id = macroRes2.data.microEntregas.find(m => m.nome === 'Geral').id;

    // Cria a alocação ENQUANTO o mês ainda está aberto
    const a3 = await api('POST', '/alocacoes', tokenChefe, {
      colaboradorId: colaborador.id, projetoId: projeto2Id, macroEntregaId: macro2Id, microEntregaId: micro2Id,
      ano: anoF, mes: mesF, horasPlanejadas: 5,
    });
    check('Alocação criada antes do fechamento', a3.status === 201, a3);
    alocacao3Id = a3.data.alocacao.id;

    const fecha = await api('POST', '/fechamentos', tokenAdmin, { ano: anoF, mes: mesF });
    check(`Mês ${mesF}/${anoF} fechado`, fecha.status === 201, fecha);
  }
  {
    const result = await precheckExclusao(projeto2Id);
    check('precheck: ok false / motivo mes_fechado', result.ok === false && result.motivo === 'mes_fechado', result);
    check('mesesFechados contém o mês certo', result.ok === false && result.motivo === 'mes_fechado' &&
      result.mesesFechados.some(m => m.ano === anoF && m.mes === mesF), result);
  }
  {
    let lancou = false;
    let ehErroCorreto = false;
    try {
      await executarExclusaoCascata(projeto2Id, { solicitanteId: null, aprovadorId: chefe.id, motivo: null });
    } catch (err) {
      lancou = true;
      ehErroCorreto = err instanceof ExclusaoBloqueadaError;
    }
    check('executarExclusaoCascata lançou erro', lancou, lancou);
    check('Erro é ExclusaoBloqueadaError', ehErroCorreto, ehErroCorreto);
  }
  {
    const projeto2 = await prisma.projeto.findUnique({ where: { id: projeto2Id } });
    check('Projeto 2 AINDA existe (nada foi apagado)', projeto2 !== null, projeto2);
    const aloc3 = await prisma.alocacao.findUnique({ where: { id: alocacao3Id } });
    check('Alocação 3 AINDA existe (nada foi apagado)', aloc3 !== null, aloc3);
  }
  {
    const reabre = await api('DELETE', `/fechamentos/${anoF}/${mesF}`, tokenAdmin);
    check(`Mês ${mesF}/${anoF} reaberto`, reabre.status === 200, reabre);
  }

  // ── Limpeza ────────────────────────────────────────────────────────────────
  console.log('\n── Limpeza ──────────────────────────────────────────');
  try {
    if (lapideId) await prisma.projetoExcluido.deleteMany({ where: { id: lapideId } });
    if (logIds.length) await prisma.alocacaoLog.deleteMany({ where: { id: { in: logIds } } });

    // Projeto de reuso de código
    if (projetoReusoId) {
      await prisma.macroEntrega.deleteMany({ where: { projetoId: projetoReusoId } });
      await prisma.prestacaoContas.deleteMany({ where: { projetoId: projetoReusoId } });
      await prisma.projeto.delete({ where: { id: projetoReusoId } }).catch(() => {});
    }

    // Projeto do caso mês-fechado (mês já reaberto acima)
    await prisma.alocacao.deleteMany({ where: { projetoId: projeto2Id } });
    await prisma.microEntrega.deleteMany({ where: { macroEntregaId: macro2Id } });
    await prisma.macroEntrega.deleteMany({ where: { projetoId: projeto2Id } });
    await prisma.prestacaoContas.deleteMany({ where: { projetoId: projeto2Id } });
    await prisma.projeto.delete({ where: { id: projeto2Id } }).catch(() => {});

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
