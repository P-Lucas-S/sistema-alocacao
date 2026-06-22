// Teste do fluxo de exclusão permanente de projeto (Spec_Papeis_Posse_Exclusao,
// passo 5c) — as 4 rotas: solicitar/aprovar/recusar/excluir-direto.
// Rode com: node test-exclusao-fluxo.mjs
// Pressupõe backend de pé em http://localhost:3001 com o seed padrão carregado.

import { PrismaClient } from '@prisma/client';

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

let tokenChefe, chefe, tokenGestor1, gestor1, tokenGestor2, gestor2, tokenAdmin, tokenCoord, tokenDiretor;
let categoriaId, colaborador;
const projetosVivos = []; // [{projetoId, macroId}] — limpos no fim se ainda existirem
const lapidesIds = [];
const todosAlocacaoIds = []; // TODA alocação criada no teste — pra limpar os logs órfãos no fim
const mesesParaReabrir = []; // [{ano,mes}]

async function criarProjetoComAlocacao(sufixo, ano, mes, horas) {
  const codigo = `FLX${STAMP}${sufixo}`;
  const { data: proj } = await api('POST', '/projetos', tokenChefe, {
    codigo, nome: `Projeto Fluxo ${sufixo}`,
    prestacoesContas: ['2026-12-31'], categoriaId, gestorId: gestor1.id,
  });
  const macroRes = await api('POST', `/projetos/${proj.id}/macros`, tokenChefe, { nome: 'Macro' });
  const macroId = macroRes.data.id;
  const microId = macroRes.data.microEntregas.find(m => m.nome === 'Geral').id;
  const alocRes = await api('POST', '/alocacoes', tokenChefe, {
    colaboradorId: colaborador.id, projetoId: proj.id, macroEntregaId: macroId, microEntregaId: microId,
    ano, mes, horasPlanejadas: horas,
  });
  const info = { projetoId: proj.id, macroId, microId, alocacaoId: alocRes.data.alocacao.id };
  projetosVivos.push(info);
  todosAlocacaoIds.push(info.alocacaoId);
  return info;
}

async function main() {
  console.log('── Login ──────────────────────────────────────────');
  ({ token: tokenChefe,   user: chefe }   = await login('chefe@sistema.dev', 'chefe123'));
  ({ token: tokenGestor1, user: gestor1 } = await login('gestor1@sistema.dev', 'gestor123'));
  ({ token: tokenGestor2, user: gestor2 } = await login('gestor2@sistema.dev', 'gestor123'));
  ({ token: tokenAdmin }                  = await login('admin@sistema.dev', 'admin123'));
  ({ token: tokenCoord }                  = await login('coord@sistema.dev', 'coord123'));
  ({ token: tokenDiretor }                = await login('diretor@sistema.dev', 'diretor123'));
  console.log(`chefe=${chefe.id} gestor1=${gestor1.id} gestor2=${gestor2.id}\n`);

  // GET /categorias 403 pra chefe (gap conhecido) — busca com gestor1
  const catRes = await api('GET', '/categorias?ativo=true', tokenGestor1);
  categoriaId = catRes.data[0].id;
  const colabRes = await api('GET', '/colaboradores?ativo=true', tokenChefe);
  colaborador = colabRes.data[0];

  // ════════════════════════════════════════════════════════════════════════
  console.log('── FLUXO FELIZ: gestor pede, chefe aprova ──────────');
  // ════════════════════════════════════════════════════════════════════════
  {
    const proj = await criarProjetoComAlocacao('FELIZ', 2026, 9, 5);

    const sol = await api('POST', `/projetos/${proj.projetoId}/solicitar-exclusao`, tokenGestor1, { motivo: 'engano' });
    check('solicitar-exclusao → 200', sol.status === 200, sol);
    check('status = pendente_exclusao', sol.data?.status === 'pendente_exclusao', sol.data);
    check('exclusaoSolicitadaPorId = gestor1', sol.data?.exclusaoSolicitadaPorId === gestor1.id, sol.data);

    const apr = await api('POST', `/projetos/${proj.projetoId}/aprovar-exclusao`, tokenChefe);
    check('aprovar-exclusao → 200 excluido:true', apr.status === 200 && apr.data?.excluido === true, apr);

    const sumiu = await prisma.projeto.findUnique({ where: { id: proj.projetoId } });
    check('Projeto sumiu', sumiu === null, sumiu);

    const lapide = await prisma.projetoExcluido.findFirst({ where: { projetoIdOriginal: proj.projetoId } });
    check('Lápide existe', !!lapide, lapide);
    check('solicitanteId = gestor1', lapide?.solicitanteId === gestor1.id, lapide);
    check('aprovadorId = chefe', lapide?.aprovadorId === chefe.id, lapide);
    check('motivo = "engano"', lapide?.motivo === 'engano', lapide);
    if (lapide) lapidesIds.push(lapide.id);
    projetosVivos.splice(projetosVivos.findIndex(p => p.projetoId === proj.projetoId), 1);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── RECUSA ───────────────────────────────────────────');
  // ════════════════════════════════════════════════════════════════════════
  let projRecusado;
  {
    projRecusado = await criarProjetoComAlocacao('RECUSA', 2026, 9, 5);
    await api('POST', `/projetos/${projRecusado.projetoId}/solicitar-exclusao`, tokenGestor1, { motivo: 'x' });

    const rec = await api('POST', `/projetos/${projRecusado.projetoId}/recusar-exclusao`, tokenChefe);
    check('recusar-exclusao → 200', rec.status === 200, rec);
    check('status volta a ativo', rec.data?.status === 'ativo', rec.data);
    check('exclusaoSolicitadaPorId = null', rec.data?.exclusaoSolicitadaPorId === null, rec.data);
    check('motivoExclusao = null', rec.data?.motivoExclusao === null, rec.data);

    const aindaExiste = await prisma.projeto.findUnique({ where: { id: projRecusado.projetoId } });
    check('Projeto AINDA existe', aindaExiste !== null, aindaExiste);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── EXCLUIR DIRETO (sem pedido prévio) ──────────────');
  // ════════════════════════════════════════════════════════════════════════
  {
    const proj = await criarProjetoComAlocacao('DIRETOSEM', 2026, 9, 5);

    const del = await api('DELETE', `/projetos/${proj.projetoId}/excluir-direto`, tokenChefe, { motivo: 'limpeza' });
    check('excluir-direto → 200 excluido:true', del.status === 200 && del.data?.excluido === true, del);

    const lapide = await prisma.projetoExcluido.findFirst({ where: { projetoIdOriginal: proj.projetoId } });
    check('Lápide existe', !!lapide, lapide);
    check('solicitanteId = null (não houve pedido)', lapide?.solicitanteId === null, lapide);
    check('motivo = "limpeza"', lapide?.motivo === 'limpeza', lapide);
    if (lapide) lapidesIds.push(lapide.id);
    projetosVivos.splice(projetosVivos.findIndex(p => p.projetoId === proj.projetoId), 1);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── EXCLUIR DIRETO (projeto já pendente) ────────────');
  // ════════════════════════════════════════════════════════════════════════
  {
    const proj = await criarProjetoComAlocacao('DIRETOCOM', 2026, 9, 5);
    await api('POST', `/projetos/${proj.projetoId}/solicitar-exclusao`, tokenGestor1, { motivo: 'pedido do gestor' });

    const del = await api('DELETE', `/projetos/${proj.projetoId}/excluir-direto`, tokenChefe); // SEM motivo no corpo
    check('excluir-direto (sem motivo no corpo) → 200', del.status === 200 && del.data?.excluido === true, del);

    const lapide = await prisma.projetoExcluido.findFirst({ where: { projetoIdOriginal: proj.projetoId } });
    check('solicitanteId = gestor1 (preservou quem pediu)', lapide?.solicitanteId === gestor1.id, lapide);
    check('motivo = "pedido do gestor" (preservou o motivo)', lapide?.motivo === 'pedido do gestor', lapide);
    if (lapide) lapidesIds.push(lapide.id);
    projetosVivos.splice(projetosVivos.findIndex(p => p.projetoId === proj.projetoId), 1);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── GUARDAS ──────────────────────────────────────────');
  // ════════════════════════════════════════════════════════════════════════
  let projGuardas;
  {
    projGuardas = await criarProjetoComAlocacao('GUARDAS', 2026, 9, 5);

    const naoDono = await api('POST', `/projetos/${projGuardas.projetoId}/solicitar-exclusao`, tokenGestor2, {});
    check('gestor2 (não-dono) solicitar-exclusao → 403', naoDono.status === 403, naoDono);

    const chefeSolicita = await api('POST', `/projetos/${projGuardas.projetoId}/solicitar-exclusao`, tokenChefe, {});
    check('chefe solicitar-exclusao → 403 (não solicita)', chefeSolicita.status === 403, chefeSolicita);

    for (const [papel, token] of [['coordenação', tokenCoord], ['diretor', tokenDiretor]]) {
      const s = await api('POST', `/projetos/${projGuardas.projetoId}/solicitar-exclusao`, token, {});
      check(`${papel} solicitar-exclusao → 403`, s.status === 403, s);
      const a = await api('POST', `/projetos/${projGuardas.projetoId}/aprovar-exclusao`, token);
      check(`${papel} aprovar-exclusao → 403`, a.status === 403, a);
      const r = await api('POST', `/projetos/${projGuardas.projetoId}/recusar-exclusao`, token);
      check(`${papel} recusar-exclusao → 403`, r.status === 403, r);
      const d = await api('DELETE', `/projetos/${projGuardas.projetoId}/excluir-direto`, token, {});
      check(`${papel} excluir-direto → 403`, d.status === 403, d);
    }

    const gestorAprova = await api('POST', `/projetos/${projGuardas.projetoId}/aprovar-exclusao`, tokenGestor1);
    check('gestor1 aprovar-exclusao → 403 (só chefe)', gestorAprova.status === 403, gestorAprova);
    const gestorExclui = await api('DELETE', `/projetos/${projGuardas.projetoId}/excluir-direto`, tokenGestor1, {});
    check('gestor1 excluir-direto → 403 (só chefe)', gestorExclui.status === 403, gestorExclui);

    // Agora solicita de fato (dono, válido) e tenta solicitar de novo → 409
    const ok1 = await api('POST', `/projetos/${projGuardas.projetoId}/solicitar-exclusao`, tokenGestor1, {});
    check('1ª solicitação válida → 200', ok1.status === 200, ok1);
    const ok2 = await api('POST', `/projetos/${projGuardas.projetoId}/solicitar-exclusao`, tokenGestor1, {});
    check('2ª solicitação (já pendente) → 409', ok2.status === 409, ok2);

    // Recusa pra liberar, depois tenta aprovar/recusar sem estar pendente → 409
    await api('POST', `/projetos/${projGuardas.projetoId}/recusar-exclusao`, tokenChefe);
    const aprSemPendente = await api('POST', `/projetos/${projGuardas.projetoId}/aprovar-exclusao`, tokenChefe);
    check('aprovar sem estar pendente → 409', aprSemPendente.status === 409, aprSemPendente);
    const recSemPendente = await api('POST', `/projetos/${projGuardas.projetoId}/recusar-exclusao`, tokenChefe);
    check('recusar sem estar pendente → 409', recSemPendente.status === 409, recSemPendente);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── ARQUIVADO pode ser solicitado e aprovado ────────');
  // ════════════════════════════════════════════════════════════════════════
  {
    const proj = await criarProjetoComAlocacao('ARQUIVADO', 2026, 9, 5);
    const arq = await api('PATCH', `/projetos/${proj.projetoId}/status`, tokenChefe, { status: 'arquivado' });
    check('Projeto arquivado', arq.status === 200, arq);

    const sol = await api('POST', `/projetos/${proj.projetoId}/solicitar-exclusao`, tokenGestor1, {});
    check('solicitar-exclusao em projeto arquivado → 200', sol.status === 200, sol);

    const apr = await api('POST', `/projetos/${proj.projetoId}/aprovar-exclusao`, tokenChefe);
    check('aprovar-exclusao → 200 excluido:true', apr.status === 200 && apr.data?.excluido === true, apr);

    const lapide = await prisma.projetoExcluido.findFirst({ where: { projetoIdOriginal: proj.projetoId } });
    if (lapide) lapidesIds.push(lapide.id);
    projetosVivos.splice(projetosVivos.findIndex(p => p.projetoId === proj.projetoId), 1);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── ARQUIVADO recusado volta a ARQUIVADO (não a ativo) ──');
  // ════════════════════════════════════════════════════════════════════════
  {
    const proj = await criarProjetoComAlocacao('ARQUIVRECUSA', 2026, 9, 5);
    const arq = await api('PATCH', `/projetos/${proj.projetoId}/status`, tokenChefe, { status: 'arquivado' });
    check('Projeto arquivado', arq.status === 200, arq);

    const sol = await api('POST', `/projetos/${proj.projetoId}/solicitar-exclusao`, tokenGestor1, {});
    check('solicitar-exclusao em projeto arquivado → 200', sol.status === 200, sol);
    check('status = pendente_exclusao', sol.data?.status === 'pendente_exclusao', sol.data);

    const rec = await api('POST', `/projetos/${proj.projetoId}/recusar-exclusao`, tokenChefe);
    check('recusar-exclusao → 200', rec.status === 200, rec);
    check('status volta a ARQUIVADO (não ativo)', rec.data?.status === 'arquivado', rec.data);
    check('exclusaoSolicitadaPorId = null', rec.data?.exclusaoSolicitadaPorId === null, rec.data);
    check('motivoExclusao = null', rec.data?.motivoExclusao === null, rec.data);
    check('statusAnteriorExclusao = null', rec.data?.statusAnteriorExclusao === null, rec.data);

    const aindaExiste = await prisma.projeto.findUnique({ where: { id: proj.projetoId } });
    check('Projeto AINDA existe', aindaExiste !== null, aindaExiste);
    // permanece em projetosVivos — limpo no fim
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── MÊS FECHADO bloqueia a aprovação ────────────────');
  // ════════════════════════════════════════════════════════════════════════
  {
    const anoF = 2027, mesF = 3;
    const proj = await criarProjetoComAlocacao('MESFECHADO', anoF, mesF, 5);

    const fecha = await api('POST', '/fechamentos', tokenAdmin, { ano: anoF, mes: mesF });
    check(`Mês ${mesF}/${anoF} fechado`, fecha.status === 201, fecha);
    mesesParaReabrir.push({ ano: anoF, mes: mesF });

    await api('POST', `/projetos/${proj.projetoId}/solicitar-exclusao`, tokenGestor1, {});
    const apr = await api('POST', `/projetos/${proj.projetoId}/aprovar-exclusao`, tokenChefe);
    check('aprovar-exclusao com mês fechado → 409', apr.status === 409, apr);
    check('mesesFechados contém o mês certo', apr.data?.mesesFechados?.some(m => m.ano === anoF && m.mes === mesF), apr.data);

    const aindaExiste = await prisma.projeto.findUnique({ where: { id: proj.projetoId } });
    check('Projeto AINDA existe (nada foi apagado)', aindaExiste !== null, aindaExiste);
  }

  // ── Limpeza ────────────────────────────────────────────────────────────────
  console.log('\n── Limpeza ──────────────────────────────────────────');
  try {
    for (const { ano, mes } of mesesParaReabrir) {
      const r = await api('DELETE', `/fechamentos/${ano}/${mes}`, tokenAdmin);
      console.log(`  Mês ${mes}/${ano} reaberto: ${r.status === 200 ? 'ok' : JSON.stringify(r)}`);
    }

    if (lapidesIds.length) await prisma.projetoExcluido.deleteMany({ where: { id: { in: lapidesIds } } });

    // Logs órfãos ('criou' + eventual 'removeu') de TODA alocação criada no teste —
    // cobre tanto as que sobrevivem (projetosVivos) quanto as já apagadas pela cascata.
    if (todosAlocacaoIds.length) {
      await prisma.alocacaoLog.deleteMany({ where: { alocacaoId: { in: todosAlocacaoIds } } });
    }

    // Projetos que NÃO foram excluídos durante o teste (recusa/guardas/mês-fechado)
    for (const p of projetosVivos) {
      await prisma.alocacao.deleteMany({ where: { id: p.alocacaoId } });
      await prisma.microEntrega.deleteMany({ where: { macroEntregaId: p.macroId } });
      await prisma.macroEntrega.deleteMany({ where: { id: p.macroId } });
      await prisma.prestacaoContas.deleteMany({ where: { projetoId: p.projetoId } });
      await prisma.projeto.deleteMany({ where: { id: p.projetoId } });
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
