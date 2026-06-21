// Teste da exclusão de macro em cascata (alocações + log + micros + macro).
// Rode com: node test-apagar-macro-cascata.mjs
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

async function criarMacro(token, projetoId, nome) {
  const { status, data } = await api('POST', `/projetos/${projetoId}/macros`, token, { nome });
  return { status, macro: data };
}

async function listarMacros(token, projetoId) {
  const { data } = await api('GET', `/projetos/${projetoId}/macros`, token);
  return data;
}

async function main() {
  console.log('── Login ──────────────────────────────────────────');
  const tokenAdmin   = await login('admin@sistema.dev', 'admin123');
  const tokenGestor1 = await login('gestor1@sistema.dev', 'gestor123');
  const tokenGestor2 = await login('gestor2@sistema.dev', 'gestor123');
  const tokenCoord   = await login('coord@sistema.dev', 'coord123');
  console.log('Tokens obtidos.\n');

  const { data: categorias } = await api('GET', '/categorias?ativo=true', tokenGestor1);
  const categoria = categorias[0];

  const { data: colaboradores } = await api('GET', '/colaboradores?ativo=true', tokenGestor1);
  const colaborador = colaboradores[0];
  console.log(`Categoria: ${categoria.nome} · Colaborador: ${colaborador.nome}\n`);

  console.log('── Criar PROJETO DE TESTE (gestor1) ────────────────');
  const codigoProjeto = `CASC${STAMP}`;
  const { data: projeto } = await api('POST', '/projetos', tokenGestor1, {
    codigo: codigoProjeto, nome: 'Projeto Cascata de Teste',
    prestacoesContas: ['2026-12-31'], categoriaId: categoria.id,
  });
  const projetoId = projeto.id;
  console.log(`Projeto: ${projeto.codigo} (${projetoId})\n`);

  // ════════════════════════════════════════════════════════════════════════
  console.log('── Cenário 3: macro SEM alocação → também passa por needsConfirmation ──');
  // ════════════════════════════════════════════════════════════════════════
  {
    const { macro } = await criarMacro(tokenGestor1, projetoId, 'Macro sem alocação');

    // 1ª chamada (sem ?confirmar) — NUNCA apaga, mesmo vazia
    const { status, data } = await api('DELETE', `/projetos/${projetoId}/macros/${macro.id}`, tokenGestor1);
    check('1ª chamada: status 200', status === 200, { status, data });
    check('needsConfirmation: true (mesmo vazia)', data?.needsConfirmation === true, data);
    check('totalAlocacoes = 0', data?.totalAlocacoes === 0, data);

    const macrosAntes = await listarMacros(tokenGestor1, projetoId);
    check('Macro AINDA existe após a 1ª chamada (nada apagado)', macrosAntes.some(m => m.id === macro.id), macrosAntes.map(m => m.nome));

    // 2ª chamada (?confirmar=true) — agora apaga
    const { status: status2, data: data2 } = await api('DELETE', `/projetos/${projetoId}/macros/${macro.id}?confirmar=true`, tokenGestor1);
    check('2ª chamada: status 200', status2 === 200, { status2, data2 });
    check('ok: true', data2?.ok === true, data2);
    check('alocacoesRemovidas = 0', data2?.alocacoesRemovidas === 0, data2);

    const macrosDepois = await listarMacros(tokenGestor1, projetoId);
    check('Macro realmente some da lista', !macrosDepois.some(m => m.id === macro.id), macrosDepois.map(m => m.nome));
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Cenário 1: macro COM alocação em mês ABERTO → cascata ──');
  // ════════════════════════════════════════════════════════════════════════
  let macroOpenId, geralOpenId, alocOpenIds;
  {
    const { macro } = await criarMacro(tokenGestor1, projetoId, 'Macro com alocação (mês aberto)');
    macroOpenId = macro.id;
    geralOpenId = macro.microEntregas.find(m => m.nome === 'Geral').id;

    const { status: s1, data: a1 } = await api('POST', '/alocacoes', tokenGestor1, {
      colaboradorId: colaborador.id, projetoId, macroEntregaId: macroOpenId, microEntregaId: geralOpenId,
      ano: 2026, mes: 11, horasPlanejadas: 8,
    });
    const { status: s2, data: a2 } = await api('POST', '/alocacoes', tokenGestor1, {
      colaboradorId: colaborador.id, projetoId, macroEntregaId: macroOpenId, microEntregaId: geralOpenId,
      ano: 2026, mes: 12, horasPlanejadas: 12,
    });
    check('Alocação 1 criada (8h, 2026-11)', s1 === 201, a1);
    check('Alocação 2 criada (12h, 2026-12)', s2 === 201, a2);
    alocOpenIds = [a1.alocacao.id, a2.alocacao.id];

    // 1ª chamada — sem ?confirmar
    const { status, data } = await api('DELETE', `/projetos/${projetoId}/macros/${macroOpenId}`, tokenGestor1);
    check('1ª chamada: status 200', status === 200, { status, data });
    check('needsConfirmation: true', data?.needsConfirmation === true, data);
    check('totalAlocacoes = 2', data?.totalAlocacoes === 2, data);
    check('totalHoras = 20', parseFloat(data?.totalHoras) === 20, data);

    const macrosAntes = await listarMacros(tokenGestor1, projetoId);
    check('Macro AINDA existe após a 1ª chamada (nada apagado)', macrosAntes.some(m => m.id === macroOpenId), macrosAntes.map(m => m.nome));

    // 2ª chamada — confirmar=true
    const { status: status2, data: data2 } = await api('DELETE', `/projetos/${projetoId}/macros/${macroOpenId}?confirmar=true`, tokenGestor1);
    check('2ª chamada: status 200', status2 === 200, { status2, data2 });
    check('ok: true', data2?.ok === true, data2);
    check('alocacoesRemovidas = 2', data2?.alocacoesRemovidas === 2, data2);

    const macrosDepois = await listarMacros(tokenGestor1, projetoId);
    check('Macro some da lista', !macrosDepois.some(m => m.id === macroOpenId), macrosDepois.map(m => m.nome));

    const { data: alocsRestantes } = await api('GET', `/alocacoes?projetoId=${projetoId}&ano=2026&mes=11`, tokenGestor1);
    check('Alocações da macro realmente removidas do banco', !alocsRestantes.some(a => a.id === alocOpenIds[0]), alocsRestantes);

    // Log de auditoria 'removeu' pra cada alocação apagada
    for (const alocId of alocOpenIds) {
      const { data: logs } = await api('GET', `/alocacoes/${alocId}/log`, tokenGestor1);
      const temRemoveu = Array.isArray(logs) && logs.some(l => l.acao === 'removeu' && l.alocacaoId === alocId);
      check(`Log 'removeu' registrado pra alocação ${alocId}`, temRemoveu, logs);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Cenário 5 (sanidade): outra macro/alocação do projeto fica intacta ──');
  // ════════════════════════════════════════════════════════════════════════
  let macroOtherId, alocOtherId;
  {
    const { macro } = await criarMacro(tokenGestor1, projetoId, 'Macro intocada');
    macroOtherId = macro.id;
    const geralOtherId = macro.microEntregas.find(m => m.nome === 'Geral').id;
    const { data: alocOther } = await api('POST', '/alocacoes', tokenGestor1, {
      colaboradorId: colaborador.id, projetoId, macroEntregaId: macroOtherId, microEntregaId: geralOtherId,
      ano: 2026, mes: 11, horasPlanejadas: 5,
    });
    alocOtherId = alocOther.alocacao.id;

    // Essa macro foi criada DEPOIS do cenário 1 já ter rodado — confirma que
    // ela e sua alocação seguem vivas e não foram afetadas pela cascata anterior.
    const macrosAgora = await listarMacros(tokenGestor1, projetoId);
    check('Macro intocada presente', macrosAgora.some(m => m.id === macroOtherId), macrosAgora.map(m => m.nome));
    const { data: alocsAgora } = await api('GET', `/alocacoes?projetoId=${projetoId}&ano=2026&mes=11`, tokenGestor1);
    check('Alocação da macro intocada presente', alocsAgora.some(a => a.id === alocOtherId), alocsAgora.map(a => a.id));
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Cenário 2: macro COM alocação em mês FECHADO → 400, nada apagado ──');
  // ════════════════════════════════════════════════════════════════════════
  const anoFechado = 2031, mesFechado = 1;
  let macroClosedId, alocClosedId;
  {
    const { macro } = await criarMacro(tokenGestor1, projetoId, 'Macro com alocação (mês fechado)');
    macroClosedId = macro.id;
    const geralClosedId = macro.microEntregas.find(m => m.nome === 'Geral').id;

    // Cria a alocação ENQUANTO o mês ainda está aberto (POST /alocacoes bloqueia em mês fechado)
    const { status: sA, data: dA } = await api('POST', '/alocacoes', tokenGestor1, {
      colaboradorId: colaborador.id, projetoId, macroEntregaId: macroClosedId, microEntregaId: geralClosedId,
      ano: anoFechado, mes: mesFechado, horasPlanejadas: 7,
    });
    check('Alocação criada antes do fechamento', sA === 201, dA);
    alocClosedId = dA.alocacao.id;

    // Admin fecha o mês
    const { status: sFecha, data: dFecha } = await api('POST', '/fechamentos', tokenAdmin, { ano: anoFechado, mes: mesFechado });
    check(`Mês ${mesFechado}/${anoFechado} fechado pelo admin`, sFecha === 201, dFecha);

    // 1ª chamada (sem confirmar) — deve bloquear, NÃO needsConfirmation
    const { status: s1, data: d1 } = await api('DELETE', `/projetos/${projetoId}/macros/${macroClosedId}`, tokenGestor1);
    check('1ª chamada: status 400 (mês fechado)', s1 === 400, { s1, d1 });
    check('Mensagem cita o mês fechado (01/2031)', /01\/2031/.test(d1?.error ?? ''), d1);
    check('NÃO é needsConfirmation', d1?.needsConfirmation === undefined, d1);

    // 2ª chamada com confirmar=true — revalidação defensiva também bloqueia
    const { status: s2, data: d2 } = await api('DELETE', `/projetos/${projetoId}/macros/${macroClosedId}?confirmar=true`, tokenGestor1);
    check('2ª chamada (?confirmar=true): status 400 também', s2 === 400, { s2, d2 });

    // Nada foi apagado
    const macrosAgora = await listarMacros(tokenGestor1, projetoId);
    check('Macro do mês fechado AINDA existe', macrosAgora.some(m => m.id === macroClosedId), macrosAgora.map(m => m.nome));

    // Reabre o mês pra não deixar lixo permanente no ambiente
    const { status: sReabre } = await api('DELETE', `/fechamentos/${anoFechado}/${mesFechado}`, tokenAdmin);
    check(`Mês ${mesFechado}/${anoFechado} reaberto`, sReabre === 200, sReabre);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Cenário 4: autorização (coordenação 403; gestor não-dono 403) ──');
  // ════════════════════════════════════════════════════════════════════════
  let macroAuthId;
  {
    const { macro } = await criarMacro(tokenGestor1, projetoId, 'Macro p/ teste de autorização');
    macroAuthId = macro.id;

    const { status: sCoord, data: dCoord } = await api('DELETE', `/projetos/${projetoId}/macros/${macroAuthId}`, tokenCoord);
    check('Coordenação recebe 403', sCoord === 403, { sCoord, dCoord });

    const { status: sG2, data: dG2 } = await api('DELETE', `/projetos/${projetoId}/macros/${macroAuthId}`, tokenGestor2);
    check('Gestor não-dono (gestor2) recebe 403', sG2 === 403, { sG2, dG2 });

    const macrosAgora = await listarMacros(tokenGestor1, projetoId);
    check('Macro segue intacta após as duas tentativas negadas', macrosAgora.some(m => m.id === macroAuthId), macrosAgora.map(m => m.nome));
  }

  // ── Limpeza ────────────────────────────────────────────────────────────────
  console.log('\n── Limpeza do projeto de teste ─────────────────────');
  const prisma = new PrismaClient();
  try {
    await prisma.alocacao.deleteMany({ where: { projetoId } });
    await prisma.microEntrega.deleteMany({ where: { macroEntrega: { projetoId } } });
    await prisma.macroEntrega.deleteMany({ where: { projetoId } });
    await prisma.prestacaoContas.deleteMany({ where: { projetoId } });
    await prisma.projeto.delete({ where: { id: projetoId } });
    console.log(`Projeto de teste ${projetoId} (${codigoProjeto}) removido.`);
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
