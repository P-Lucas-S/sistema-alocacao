// test-f-b.mjs — testes de cessão de remanejamento (F-b)
import { randomBytes } from 'crypto';

const uid  = () => randomBytes(4).toString('hex');
const API  = 'http://localhost:3001';
const ok   = (label) => console.log(`  ✓ ${label}`);
const fail = (label, detail) => { console.error(`  ✗ ${label}: ${detail}`); process.exit(1); };

async function req(method, path, body, token) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${API}${path}`, opts);
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

// ── Setup ─────────────────────────────────────────────────────────────────────
const id = uid();

let r = await req('POST', '/api/auth/register', { name: `Admin FB ${id}`, email: `admin-fb-${id}@test.dev`, password: 'Teste123!', role: 'admin' });
if (r.status !== 201) fail('register admin', JSON.stringify(r.data));
const tokenAdmin = r.data.token;

const ga = uid(), gb = uid(), gc = uid();

r = await req('POST', '/api/auth/register', { name: `GA FB ${ga}`, email: `ga-fb-${ga}@test.dev`, password: 'Teste123!', role: 'gestor' });
if (r.status !== 201) fail('register gA', JSON.stringify(r.data));
const tokenGA = r.data.token;

r = await req('POST', '/api/auth/register', { name: `GB FB ${gb}`, email: `gb-fb-${gb}@test.dev`, password: 'Teste123!', role: 'gestor' });
if (r.status !== 201) fail('register gB', JSON.stringify(r.data));
const tokenGB = r.data.token;

r = await req('POST', '/api/auth/register', { name: `GC FB ${gc}`, email: `gc-fb-${gc}@test.dev`, password: 'Teste123!', role: 'gestor' });
if (r.status !== 201) fail('register gC', JSON.stringify(r.data));
const tokenGC = r.data.token;

r = await req('POST', '/api/auth/register', { name: `Coord FB ${id}`, email: `coord-fb-${id}@test.dev`, password: 'Teste123!', role: 'coordenador' });
if (r.status !== 201) fail('register coord', JSON.stringify(r.data));
const tokenCoord = r.data.token;

// colaborador
r = await req('POST', '/api/colaboradores', { nome: `Colab FB ${id}`, email: `colab-fb-${id}@test.dev` }, tokenAdmin);
if (r.status !== 201) fail('create colab', JSON.stringify(r.data));
const colabId = r.data.colaborador.id;

// projetos
r = await req('POST', '/api/projetos', { codigo: `FBA${ga.slice(0,4)}`, nome: `Proj A FB`, prestacoesContas: ['2027-01-31'] }, tokenGA);
if (r.status !== 201) fail('create proj A', JSON.stringify(r.data));
const projetoAId = r.data.id;
r = await req('POST', `/api/projetos/${projetoAId}/macros`, { nome: 'Macro A' }, tokenGA);
if (r.status !== 201) fail('create macro A', JSON.stringify(r.data));
const macroAId = r.data.id;
const microAId = r.data.microEntregas[0].id;

r = await req('POST', '/api/projetos', { codigo: `FBB${gb.slice(0,4)}`, nome: `Proj B FB`, prestacoesContas: ['2027-01-31'] }, tokenGB);
if (r.status !== 201) fail('create proj B', JSON.stringify(r.data));
const projetoBId = r.data.id;
r = await req('POST', `/api/projetos/${projetoBId}/macros`, { nome: 'Macro B' }, tokenGB);
if (r.status !== 201) fail('create macro B', JSON.stringify(r.data));
const macroBId = r.data.id;
const microBId = r.data.microEntregas[0].id;

r = await req('POST', '/api/projetos', { codigo: `FBC${gc.slice(0,4)}`, nome: `Proj C FB`, prestacoesContas: ['2027-01-31'] }, tokenGC);
if (r.status !== 201) fail('create proj C', JSON.stringify(r.data));
const projetoCId = r.data.id;
r = await req('POST', `/api/projetos/${projetoCId}/macros`, { nome: 'Macro C' }, tokenGC);
if (r.status !== 201) fail('create macro C', JSON.stringify(r.data));
const macroCId = r.data.id;
const microCId = r.data.microEntregas[0].id;

const ANO = 2025, MES = 10;

// Alocações de origem: gB e gC têm colab no mesmo mês
r = await req('POST', '/api/alocacoes', { colaboradorId: colabId, projetoId: projetoBId, macroEntregaId: macroBId, microEntregaId: microBId, ano: ANO, mes: MES, horasPlanejadas: 80 }, tokenGB);
if (r.status !== 201) fail('aloc B', JSON.stringify(r.data));
const alocBId = r.data.alocacao.id;

r = await req('POST', '/api/alocacoes', { colaboradorId: colabId, projetoId: projetoCId, macroEntregaId: macroCId, microEntregaId: microCId, ano: ANO, mes: MES, horasPlanejadas: 60 }, tokenGC);
if (r.status !== 201) fail('aloc C', JSON.stringify(r.data));
const alocCId = r.data.alocacao.id;

// Solicitação principal: gA quer 30h do colab, destino = projetoA
r = await req('POST', '/api/remanejamento/solicitacoes', { colaboradorId: colabId, projetoDestinoId: projetoAId, macroEntregaDestinoId: macroAId, microEntregaDestinoId: microAId, ano: ANO, mes: MES, horasSolicitadas: 30 }, tokenGA);
if (r.status !== 201) fail('criar sol', JSON.stringify(r.data));
const solId = r.data.solicitacao.id;

console.log('\n─── Testes F-b: cessão de remanejamento ───\n');

// ── T1: coordenador → 403 ─────────────────────────────────────────────────
r = await req('POST', `/api/remanejamento/solicitacoes/${solId}/cessoes`, { alocacaoOrigemId: alocBId, horasCedidas: 10, idempotencia: `coord-${uid()}` }, tokenCoord);
if (r.status !== 403) fail('T1 coord 403', `esperado 403, got ${r.status}`);
ok('T1: coordenador → 403');

// ── T2: origem não é do cedente → 403 ─────────────────────────────────────
// gB tenta ceder alocação de gC
r = await req('POST', `/api/remanejamento/solicitacoes/${solId}/cessoes`, { alocacaoOrigemId: alocCId, horasCedidas: 10, idempotencia: `t2-${uid()}` }, tokenGB);
if (r.status !== 403) fail('T2 origem alheia 403', `esperado 403, got ${r.status}`);
ok('T2: origem não é do cedente → 403');

// ── T3a: origem de outro colaborador → 400 ────────────────────────────────
// Cria colab2 com alocação, usa como origem
r = await req('POST', '/api/colaboradores', { nome: `Colab2 FB ${id}`, email: `colab2-fb-${id}@test.dev`, confirmarSimilar: true }, tokenAdmin);
if (r.status !== 201) fail('colab2', JSON.stringify(r.data));
const colab2Id = r.data.colaborador.id;
r = await req('POST', '/api/alocacoes', { colaboradorId: colab2Id, projetoId: projetoBId, macroEntregaId: macroBId, microEntregaId: microBId, ano: ANO, mes: MES, horasPlanejadas: 20 }, tokenGB);
if (r.status !== 201) fail('aloc colab2', JSON.stringify(r.data));
const alocColab2Id = r.data.alocacao.id;

r = await req('POST', `/api/remanejamento/solicitacoes/${solId}/cessoes`, { alocacaoOrigemId: alocColab2Id, horasCedidas: 10, idempotencia: `t3a-${uid()}` }, tokenGB);
if (r.status !== 400) fail('T3a outro colab', `esperado 400, got ${r.status}`);
ok('T3a: origem é de outro colaborador → 400');

// ── T3b: origem de outro mês → 400 ────────────────────────────────────────
r = await req('POST', '/api/alocacoes', { colaboradorId: colabId, projetoId: projetoBId, macroEntregaId: macroBId, microEntregaId: microBId, ano: ANO, mes: MES + 1, horasPlanejadas: 20 }, tokenGB);
if (r.status !== 201) fail('aloc outro mes', JSON.stringify(r.data));
const alocOutroMesId = r.data.alocacao.id;

r = await req('POST', `/api/remanejamento/solicitacoes/${solId}/cessoes`, { alocacaoOrigemId: alocOutroMesId, horasCedidas: 10, idempotencia: `t3b-${uid()}` }, tokenGB);
if (r.status !== 400) fail('T3b outro mes', `esperado 400, got ${r.status}`);
ok('T3b: origem é de outro mês → 400');

// ── T4: origem == destino → 400 ────────────────────────────────────────────
// Solicitação cujo destino == projeto A, cedente = gA tem alocação no proj A
r = await req('POST', '/api/alocacoes', { colaboradorId: colabId, projetoId: projetoAId, macroEntregaId: macroAId, microEntregaId: microAId, ano: ANO, mes: MES, horasPlanejadas: 20 }, tokenGA);
if (r.status !== 201) fail('aloc A', JSON.stringify(r.data));
const alocAId = r.data.alocacao.id;

// Cria solicitação cujo destino = projetoA/macroA/microA (mesmo que a origem que vamos usar)
r = await req('POST', '/api/remanejamento/solicitacoes', { colaboradorId: colabId, projetoDestinoId: projetoAId, macroEntregaDestinoId: macroAId, microEntregaDestinoId: microAId, ano: ANO, mes: MES, horasSolicitadas: 5 }, tokenGA);
if (r.status !== 201) fail('sol para T4', JSON.stringify(r.data));
const solT4Id = r.data.solicitacao.id;

// gA tenta ceder sua própria alocação no projetoA (origem == destino)
r = await req('POST', `/api/remanejamento/solicitacoes/${solT4Id}/cessoes`, { alocacaoOrigemId: alocAId, horasCedidas: 5, idempotencia: `t4-${uid()}` }, tokenGA);
if (r.status !== 400) fail('T4 origem==destino', `esperado 400, got ${r.status}`);
ok('T4: origem e destino são a mesma alocação → 400');

// ── T5: ceder mais do que falta → ajustado + fecha ('atendida') ───────────
// solId pede 30h; gB cede 50h → ajusta para 30
r = await req('POST', `/api/remanejamento/solicitacoes/${solId}/cessoes`, {
  alocacaoOrigemId: alocBId,
  horasCedidas: 50,
  idempotencia: `t5-${uid()}`,
}, tokenGB);
if (r.status !== 201) fail('T5 criar', JSON.stringify(r.data));
const t5 = r.data;
if (!t5.ajustado)                             fail('T5 ajustado',   'esperado ajustado:true');
if (parseFloat(t5.horasCedidasEfetivas) !== 30) fail('T5 efetivas', `esperado 30, got ${t5.horasCedidasEfetivas}`);
if (!t5.atendida)                             fail('T5 atendida',   'esperado atendida:true');

// Verifica status no banco
r = await req('GET', '/api/remanejamento/solicitacoes', undefined, tokenGA);
const solStatus = r.data.minhas.find(s => s.id === solId);
if (solStatus?.status !== 'atendida') fail('T5 status banco', `esperado 'atendida', got '${solStatus?.status}'`);

// Verifica que origem caiu 30h (não 50h)
r = await req('GET', `/api/alocacoes?colaboradorId=${colabId}&ano=${ANO}&mes=${MES}`, undefined, tokenAdmin);
const alocBAtual = r.data.find(a => a.id === alocBId);
if (parseFloat(alocBAtual.horasPlanejadas) !== 50) fail('T5 origem', `esperado 80-30=50, got ${alocBAtual.horasPlanejadas}`);
ok('T5: ceder mais que falta → ajustado:true, horasCedidasEfetivas=30, status=atendida, origem decresceu 30');

// ── T6: ceder mais do que a origem tem → 400 ──────────────────────────────
// Nova solicitação de 100h; gC tem 60h — tenta ceder 80
r = await req('POST', '/api/remanejamento/solicitacoes', { colaboradorId: colabId, projetoDestinoId: projetoAId, macroEntregaDestinoId: macroAId, microEntregaDestinoId: microAId, ano: ANO, mes: MES, horasSolicitadas: 100 }, tokenGA);
if (r.status !== 201) fail('sol T6', JSON.stringify(r.data));
const solT6Id = r.data.solicitacao.id;

r = await req('POST', `/api/remanejamento/solicitacoes/${solT6Id}/cessoes`, { alocacaoOrigemId: alocCId, horasCedidas: 80, idempotencia: `t6-${uid()}` }, tokenGC);
if (r.status !== 400) fail('T6 origem sem horas', `esperado 400, got ${r.status}`);
if (!r.data.error?.includes('suficiente')) fail('T6 msg', `msg inesperada: ${r.data.error}`);
ok('T6: ceder mais que origem tem → 400 (suficiente)');

// ── T7: solicitação já 'atendida' → 409 ───────────────────────────────────
r = await req('POST', `/api/remanejamento/solicitacoes/${solId}/cessoes`, { alocacaoOrigemId: alocCId, horasCedidas: 5, idempotencia: `t7-${uid()}` }, tokenGC);
if (r.status !== 409) fail('T7 atendida 409', `esperado 409, got ${r.status}`);
ok('T7: solicitação já atendida → nova cessão → 409');

// ── T8: mês fechado → 409 mesFechado ─────────────────────────────────────
const MES_F = 11;
r = await req('POST', '/api/fechamentos', { ano: ANO, mes: MES_F }, tokenAdmin);
if (r.status !== 201) fail('T8 fechar', JSON.stringify(r.data));

// Cria alocação no mês fechado para teste (antes de fechar, para simular dado existente)
// Neste teste, a solicitação tem mes=MES_F — criamos antes de fechar
r = await req('POST', '/api/alocacoes', { colaboradorId: colabId, projetoId: projetoBId, macroEntregaId: macroBId, microEntregaId: microBId, ano: ANO, mes: MES_F, horasPlanejadas: 20 }, tokenGB);
if (r.status !== 409) {
  // Se o mês ainda não estava fechado, criamos a alocação, depois fechamos
  // Mas o mês MES_F acabou de ser fechado — a alocação pode ter sido criada ANTES do fechamento
  // Neste teste simplificamos: usamos outra alocação no mesmo mês fechado
}

// Cria solicitação num mês aberto e depois tenta cessar com mês fechado
// Usamos o mês MES+2 que está aberto, criamos tudo, depois fechamos
const MES_F2 = MES + 2;
r = await req('POST', '/api/alocacoes', { colaboradorId: colabId, projetoId: projetoBId, macroEntregaId: macroBId, microEntregaId: microBId, ano: ANO, mes: MES_F2, horasPlanejadas: 20 }, tokenGB);
if (r.status !== 201) fail('T8 aloc mf2', JSON.stringify(r.data));
const alocMesF2Id = r.data.alocacao.id;

r = await req('POST', '/api/remanejamento/solicitacoes', { colaboradorId: colabId, projetoDestinoId: projetoAId, macroEntregaDestinoId: macroAId, microEntregaDestinoId: microAId, ano: ANO, mes: MES_F2, horasSolicitadas: 10 }, tokenGA);
if (r.status !== 201) fail('T8 sol mf2', JSON.stringify(r.data));
const solMesF2Id = r.data.solicitacao.id;

// Fecha MES_F2
r = await req('POST', '/api/fechamentos', { ano: ANO, mes: MES_F2 }, tokenAdmin);
if (r.status !== 201) fail('T8 fechar mf2', JSON.stringify(r.data));

r = await req('POST', `/api/remanejamento/solicitacoes/${solMesF2Id}/cessoes`, { alocacaoOrigemId: alocMesF2Id, horasCedidas: 10, idempotencia: `t8-${uid()}` }, tokenGB);
if (r.status !== 409)   fail('T8 409',        `esperado 409, got ${r.status}`);
if (!r.data.mesFechado) fail('T8 mesFechado', 'esperado mesFechado:true');

// Reabre para não poluir outros testes
r = await req('DELETE', `/api/fechamentos/${ANO}/${MES_F}`, undefined, tokenAdmin);
r = await req('DELETE', `/api/fechamentos/${ANO}/${MES_F2}`, undefined, tokenAdmin);
ok('T8: mês fechado → 409 mesFechado');

// ── T9: idempotência ─────────────────────────────────────────────────────
// Nova solicitação e cessão com mesma idempotencia
r = await req('POST', '/api/remanejamento/solicitacoes', { colaboradorId: colabId, projetoDestinoId: projetoAId, macroEntregaDestinoId: macroAId, microEntregaDestinoId: microAId, ano: ANO, mes: MES, horasSolicitadas: 15 }, tokenGA);
if (r.status !== 201) fail('sol T9', JSON.stringify(r.data));
const solT9Id = r.data.solicitacao.id;

const idemp = `idemp-${uid()}`;
r = await req('POST', `/api/remanejamento/solicitacoes/${solT9Id}/cessoes`, { alocacaoOrigemId: alocCId, horasCedidas: 10, idempotencia: idemp }, tokenGC);
if (r.status !== 201) fail('T9 primeira', JSON.stringify(r.data));
const cessao1 = r.data.cessao;

// Lê horas da origem antes da 2ª chamada
r = await req('GET', `/api/alocacoes?colaboradorId=${colabId}&ano=${ANO}&mes=${MES}`, undefined, tokenAdmin);
const alocCAntes = parseFloat(r.data.find(a => a.id === alocCId).horasPlanejadas);

// Segunda chamada com mesma idempotencia → devolve mesma cessão, não move horas
r = await req('POST', `/api/remanejamento/solicitacoes/${solT9Id}/cessoes`, { alocacaoOrigemId: alocCId, horasCedidas: 10, idempotencia: idemp }, tokenGC);
if (r.status !== 200)                             fail('T9 segunda status',  `esperado 200, got ${r.status}`);
if (r.data.cessao.id !== cessao1.id)             fail('T9 mesma cessão',    'esperado mesma cessão');
if (!r.data.idempotente)                         fail('T9 idempotente flag','esperado idempotente:true');

// Horas da origem NÃO mudaram
r = await req('GET', `/api/alocacoes?colaboradorId=${colabId}&ano=${ANO}&mes=${MES}`, undefined, tokenAdmin);
const alocCDepois = parseFloat(r.data.find(a => a.id === alocCId).horasPlanejadas);
if (alocCAntes !== alocCDepois) fail('T9 origem', `esperado igual, antes=${alocCAntes} depois=${alocCDepois}`);
ok('T9: mesma idempotencia 2x → aplica 1x, devolve mesma cessão sem mover horas');

// ── T10: auditoria — cessaoId igual nos dois logs ─────────────────────────
// Usa a cessão do T9 (primeira chamada)
// Busca logs da origem
r = await req('GET', `/api/alocacoes/${alocCId}/log`, undefined, tokenAdmin);
if (r.status !== 200) fail('T10 log origem', JSON.stringify(r.data));
const logOrigem = r.data.find(l => l.cessaoId === cessao1.id);
if (!logOrigem) fail('T10 log origem cessaoId', `log da origem com cessaoId=${cessao1.id} não encontrado`);

// Busca logs da alocação de destino (projetoA do colab no mês)
r = await req('GET', `/api/alocacoes?colaboradorId=${colabId}&projetoId=${projetoAId}&ano=${ANO}&mes=${MES}`, undefined, tokenAdmin);
const alocDestino = r.data[0];
if (!alocDestino) fail('T10 alocacao destino', 'alocação destino não encontrada');

r = await req('GET', `/api/alocacoes/${alocDestino.id}/log`, undefined, tokenAdmin);
if (r.status !== 200) fail('T10 log destino', JSON.stringify(r.data));
const logDestino = r.data.find(l => l.cessaoId === cessao1.id);
if (!logDestino) fail('T10 log destino cessaoId', `log do destino com cessaoId=${cessao1.id} não encontrado`);

if (logOrigem.cessaoId !== logDestino.cessaoId) fail('T10 ids divergem', 'cessaoId deve ser igual nos dois logs');
ok('T10: logs de origem e destino existem com o mesmo cessaoId');

// ── T11: net-zero ─────────────────────────────────────────────────────────
// Total de horas do colab no mês deve ser o mesmo antes e depois de uma cessão
r = await req('GET', `/api/alocacoes?colaboradorId=${colabId}&ano=${ANO}&mes=${MES}`, undefined, tokenAdmin);
const totalAtual = r.data.reduce((s, a) => s + parseFloat(a.horasPlanejadas), 0);

// Nova solicitação + cessão
r = await req('POST', '/api/remanejamento/solicitacoes', { colaboradorId: colabId, projetoDestinoId: projetoAId, macroEntregaDestinoId: macroAId, microEntregaDestinoId: microAId, ano: ANO, mes: MES, horasSolicitadas: 5 }, tokenGA);
if (r.status !== 201) fail('sol T11', JSON.stringify(r.data));
const solT11Id = r.data.solicitacao.id;

r = await req('POST', `/api/remanejamento/solicitacoes/${solT11Id}/cessoes`, { alocacaoOrigemId: alocCId, horasCedidas: 5, idempotencia: `t11-${uid()}` }, tokenGC);
if (r.status !== 201) fail('T11 cessão', JSON.stringify(r.data));

r = await req('GET', `/api/alocacoes?colaboradorId=${colabId}&ano=${ANO}&mes=${MES}`, undefined, tokenAdmin);
const totalDepois = r.data.reduce((s, a) => s + parseFloat(a.horasPlanejadas), 0);

if (Math.abs(totalAtual - totalDepois) > 0.001) fail('T11 net-zero', `antes=${totalAtual} depois=${totalDepois}`);
ok('T11: net-zero — total de horas do colaborador no mês inalterado após cessão');

console.log('\n─── Todos os testes F-b passaram ✓ ───\n');
