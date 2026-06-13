// test-f-a.mjs — testes de criar + listar solicitações de remanejamento (F-a)
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

let r = await req('POST', '/api/auth/register', { name: `Admin FA ${id}`, email: `admin-fa-${id}@test.dev`, password: 'Teste123!', role: 'admin' });
if (r.status !== 201) fail('register admin', JSON.stringify(r.data));
const tokenAdmin = r.data.token;

const g1 = uid(), g2 = uid(), g3 = uid(), co = uid();

r = await req('POST', '/api/auth/register', { name: `G1 FA ${g1}`, email: `g1-fa-${g1}@test.dev`, password: 'Teste123!', role: 'gestor' });
if (r.status !== 201) fail('register g1', JSON.stringify(r.data));
const tokenG1 = r.data.token;

r = await req('POST', '/api/auth/register', { name: `G2 FA ${g2}`, email: `g2-fa-${g2}@test.dev`, password: 'Teste123!', role: 'gestor' });
if (r.status !== 201) fail('register g2', JSON.stringify(r.data));
const tokenG2 = r.data.token;

r = await req('POST', '/api/auth/register', { name: `G3 FA ${g3}`, email: `g3-fa-${g3}@test.dev`, password: 'Teste123!', role: 'gestor' });
if (r.status !== 201) fail('register g3', JSON.stringify(r.data));
const tokenG3 = r.data.token;

r = await req('POST', '/api/auth/register', { name: `Coord FA ${co}`, email: `coord-fa-${co}@test.dev`, password: 'Teste123!', role: 'coordenador' });
if (r.status !== 201) fail('register coord', JSON.stringify(r.data));
const tokenCoord = r.data.token;

// colaborador principal (ativo)
r = await req('POST', '/api/colaboradores', { nome: `Colab FA ${id}`, email: `colab-fa-${id}@test.dev` }, tokenAdmin);
if (r.status !== 201) fail('create colab', JSON.stringify(r.data));
const colabId = r.data.colaborador.id;

// colaborador inativo
r = await req('POST', '/api/colaboradores', { nome: `Inativo FA ${id}`, email: `inativo-fa-${id}@test.dev` }, tokenAdmin);
if (r.status !== 201) fail('create colab inativo', JSON.stringify(r.data));
const colabInativoId = r.data.colaborador.id;
r = await req('PATCH', `/api/colaboradores/${colabInativoId}/ativo`, { ativo: false }, tokenAdmin);
if (r.status !== 200) fail('inativar colab', JSON.stringify(r.data));

// projetos
r = await req('POST', '/api/projetos', { codigo: `FA1${g1.slice(0,4)}`, nome: `Proj G1 FA`, prestacoesContas: ['2027-01-31'] }, tokenG1);
if (r.status !== 201) fail('create proj g1', JSON.stringify(r.data));
const projetoG1Id = r.data.id;

r = await req('POST', `/api/projetos/${projetoG1Id}/macros`, { nome: 'Macro G1' }, tokenG1);
if (r.status !== 201) fail('create macro g1', JSON.stringify(r.data));
const macroG1Id = r.data.id;
const microG1Id = r.data.microEntregas[0].id;

r = await req('POST', '/api/projetos', { codigo: `FA2${g2.slice(0,4)}`, nome: `Proj G2 FA`, prestacoesContas: ['2027-01-31'] }, tokenG2);
if (r.status !== 201) fail('create proj g2', JSON.stringify(r.data));
const projetoG2Id = r.data.id;

r = await req('POST', `/api/projetos/${projetoG2Id}/macros`, { nome: 'Macro G2' }, tokenG2);
if (r.status !== 201) fail('create macro g2', JSON.stringify(r.data));
const macroG2Id = r.data.id;
const microG2Id = r.data.microEntregas[0].id;

const ANO = 2025, MES = 8;

// gestor2 aloca colaborador no mesmo mês (para o broadcast)
r = await req('POST', '/api/alocacoes', {
  colaboradorId: colabId, projetoId: projetoG2Id,
  macroEntregaId: macroG2Id, microEntregaId: microG2Id,
  ano: ANO, mes: MES, horasPlanejadas: 40,
}, tokenG2);
if (r.status !== 201) fail('setup aloc g2', JSON.stringify(r.data));

console.log('\n─── Testes F-a: criar + listar solicitações de remanejamento ───\n');

// ── T1: coordenador tenta criar → 403 ─────────────────────────────────────
r = await req('POST', '/api/remanejamento/solicitacoes', {
  colaboradorId: colabId, projetoDestinoId: projetoG1Id,
  macroEntregaDestinoId: macroG1Id, microEntregaDestinoId: microG1Id,
  ano: ANO, mes: MES, horasSolicitadas: 20,
}, tokenCoord);
if (r.status !== 403) fail('T1 coord 403', `esperado 403, got ${r.status}`);
ok('T1: coordenador tenta criar → 403');

// ── T2: ano/mes inválido → 400 ─────────────────────────────────────────────
r = await req('POST', '/api/remanejamento/solicitacoes', {
  colaboradorId: colabId, projetoDestinoId: projetoG1Id,
  macroEntregaDestinoId: macroG1Id, microEntregaDestinoId: microG1Id,
  ano: 1999, mes: MES, horasSolicitadas: 20,
}, tokenG1);
if (r.status !== 400) fail('T2a ano invalido', `esperado 400, got ${r.status}`);

r = await req('POST', '/api/remanejamento/solicitacoes', {
  colaboradorId: colabId, projetoDestinoId: projetoG1Id,
  macroEntregaDestinoId: macroG1Id, microEntregaDestinoId: microG1Id,
  ano: ANO, mes: 13, horasSolicitadas: 20,
}, tokenG1);
if (r.status !== 400) fail('T2b mes invalido', `esperado 400, got ${r.status}`);
ok('T2: ano/mes inválido → 400');

// ── T3: horasSolicitadas <= 0 → 400 ──────────────────────────────────────
r = await req('POST', '/api/remanejamento/solicitacoes', {
  colaboradorId: colabId, projetoDestinoId: projetoG1Id,
  macroEntregaDestinoId: macroG1Id, microEntregaDestinoId: microG1Id,
  ano: ANO, mes: MES, horasSolicitadas: 0,
}, tokenG1);
if (r.status !== 400) fail('T3a zero', `esperado 400, got ${r.status}`);

r = await req('POST', '/api/remanejamento/solicitacoes', {
  colaboradorId: colabId, projetoDestinoId: projetoG1Id,
  macroEntregaDestinoId: macroG1Id, microEntregaDestinoId: microG1Id,
  ano: ANO, mes: MES, horasSolicitadas: -10,
}, tokenG1);
if (r.status !== 400) fail('T3b negativo', `esperado 400, got ${r.status}`);
ok('T3: horasSolicitadas <= 0 → 400');

// ── T4: mês fechado → 409 mesFechado ──────────────────────────────────────
const MES_F = 9;
r = await req('POST', '/api/fechamentos', { ano: ANO, mes: MES_F }, tokenAdmin);
if (r.status !== 201) fail('T4 fechar', JSON.stringify(r.data));

r = await req('POST', '/api/remanejamento/solicitacoes', {
  colaboradorId: colabId, projetoDestinoId: projetoG1Id,
  macroEntregaDestinoId: macroG1Id, microEntregaDestinoId: microG1Id,
  ano: ANO, mes: MES_F, horasSolicitadas: 20,
}, tokenG1);
if (r.status !== 409)     fail('T4 409',          `esperado 409, got ${r.status}`);
if (!r.data.mesFechado)   fail('T4 mesFechado',   `esperado mesFechado:true`);

r = await req('DELETE', `/api/fechamentos/${ANO}/${MES_F}`, undefined, tokenAdmin);
if (r.status !== 200) fail('T4 reabrir', JSON.stringify(r.data));
ok('T4: mês fechado → 409 mesFechado (fechar/tentar/reabrir)');

// ── T5a: colaborador inexistente → 404 ────────────────────────────────────
r = await req('POST', '/api/remanejamento/solicitacoes', {
  colaboradorId: 'nao-existe', projetoDestinoId: projetoG1Id,
  macroEntregaDestinoId: macroG1Id, microEntregaDestinoId: microG1Id,
  ano: ANO, mes: MES, horasSolicitadas: 20,
}, tokenG1);
if (r.status !== 404) fail('T5a colab inexistente', `esperado 404, got ${r.status}`);
ok('T5a: colaborador inexistente → 404');

// ── T5b: colaborador inativo → 400 ────────────────────────────────────────
r = await req('POST', '/api/remanejamento/solicitacoes', {
  colaboradorId: colabInativoId, projetoDestinoId: projetoG1Id,
  macroEntregaDestinoId: macroG1Id, microEntregaDestinoId: microG1Id,
  ano: ANO, mes: MES, horasSolicitadas: 20,
}, tokenG1);
if (r.status !== 400) fail('T5b colab inativo', `esperado 400, got ${r.status}`);
ok('T5b: colaborador inativo → 400');

// ── T6: projeto não pertence ao solicitante → 403 ─────────────────────────
r = await req('POST', '/api/remanejamento/solicitacoes', {
  colaboradorId: colabId, projetoDestinoId: projetoG2Id,
  macroEntregaDestinoId: macroG2Id, microEntregaDestinoId: microG2Id,
  ano: ANO, mes: MES, horasSolicitadas: 20,
}, tokenG1);
if (r.status !== 403) fail('T6 projeto alheio', `esperado 403, got ${r.status}`);
ok('T6: projeto destino não é do solicitante (gestor) → 403');

// ── T6b: projeto destino arquivado → 400 ──────────────────────────────────
r = await req('PATCH', `/api/projetos/${projetoG1Id}/status`, { status: 'arquivado' }, tokenG1);
if (r.status !== 200) fail('T6b arquivar', JSON.stringify(r.data));

r = await req('POST', '/api/remanejamento/solicitacoes', {
  colaboradorId: colabId, projetoDestinoId: projetoG1Id,
  macroEntregaDestinoId: macroG1Id, microEntregaDestinoId: microG1Id,
  ano: ANO, mes: MES, horasSolicitadas: 20,
}, tokenG1);
if (r.status !== 400) fail('T6b projeto arquivado', `esperado 400, got ${r.status}`);
if (!r.data.error?.toLowerCase().includes('arquiv')) fail('T6b msg', `mensagem inesperada: ${r.data.error}`);

// reativar para os testes seguintes
r = await req('PATCH', `/api/projetos/${projetoG1Id}/status`, { status: 'ativo' }, tokenG1);
if (r.status !== 200) fail('T6b reativar', JSON.stringify(r.data));
ok('T6b: projeto destino arquivado → 400');

// ── T7: macro/micro fora da cadeia → 400 ─────────────────────────────────
r = await req('POST', '/api/remanejamento/solicitacoes', {
  colaboradorId: colabId, projetoDestinoId: projetoG1Id,
  macroEntregaDestinoId: macroG2Id,  // macro de outro projeto
  microEntregaDestinoId: microG2Id,
  ano: ANO, mes: MES, horasSolicitadas: 20,
}, tokenG1);
if (r.status !== 400) fail('T7a macro fora', `esperado 400, got ${r.status}`);

r = await req('POST', '/api/remanejamento/solicitacoes', {
  colaboradorId: colabId, projetoDestinoId: projetoG1Id,
  macroEntregaDestinoId: macroG1Id,
  microEntregaDestinoId: microG2Id,  // micro de outra macro
  ano: ANO, mes: MES, horasSolicitadas: 20,
}, tokenG1);
if (r.status !== 400) fail('T7b micro fora', `esperado 400, got ${r.status}`);
ok('T7: macro/micro fora da cadeia do projeto → 400');

// ── T8: criar solicitação válida → 201 ────────────────────────────────────
r = await req('POST', '/api/remanejamento/solicitacoes', {
  colaboradorId: colabId, projetoDestinoId: projetoG1Id,
  macroEntregaDestinoId: macroG1Id, microEntregaDestinoId: microG1Id,
  ano: ANO, mes: MES, horasSolicitadas: 30,
}, tokenG1);
if (r.status !== 201) fail('T8 criar', JSON.stringify(r.data));
const sol = r.data.solicitacao;
if (sol.status !== 'aberta')           fail('T8 status',    `esperado 'aberta', got '${sol.status}'`);
if (!sol.id)                           fail('T8 id',        'esperado id');
if (!sol.colaborador?.nome)            fail('T8 colab nome','esperado colaborador.nome');
if (!sol.projetoDestino?.nome)         fail('T8 proj nome', 'esperado projetoDestino.nome');
if (!sol.solicitante?.name)            fail('T8 sol name',  'esperado solicitante.name');
ok('T8: criar solicitação válida → 201, status=aberta, nomes incluídos');
const solId = sol.id;

// ── T9: broadcast / listagem ──────────────────────────────────────────────

// gestor1 (solicitante) → em 'minhas', horasJaCedidas=0, horasRestantes=30
r = await req('GET', '/api/remanejamento/solicitacoes', undefined, tokenG1);
if (r.status !== 200) fail('T9 get g1', `esperado 200, got ${r.status}`);
const g1minhas    = (r.data.minhas    ?? []).find(s => s.id === solId);
const g1recebidas = (r.data.recebidas ?? []).find(s => s.id === solId);
if (!g1minhas)    fail('T9a minhas',    'solicitação não aparece em minhas do solicitante');
if (g1recebidas)  fail('T9a recebidas', 'solicitação não deve aparecer em recebidas do próprio solicitante');
if (parseFloat(g1minhas.horasJaCedidas) !== 0)  fail('T9a horasJaCedidas', `esperado 0, got ${g1minhas.horasJaCedidas}`);
if (parseFloat(g1minhas.horasRestantes) !== 30) fail('T9a horasRestantes', `esperado 30, got ${g1minhas.horasRestantes}`);
ok('T9a: gestor1 (solicitante) vê em minhas (horasJaCedidas=0, horasRestantes=30), não em recebidas');

// gestor2 (tem o colaborador naquele mês) → aparece em recebidas
r = await req('GET', '/api/remanejamento/solicitacoes', undefined, tokenG2);
if (r.status !== 200) fail('T9b get g2', `esperado 200, got ${r.status}`);
const g2recebidas = (r.data.recebidas ?? []).find(s => s.id === solId);
if (!g2recebidas) fail('T9b', 'gestor2 (tem o colaborador no mês) deveria ver em recebidas');
ok('T9b: gestor2 (tem o colaborador naquele mês) vê em recebidas');

// gestor3 (NÃO tem o colaborador naquele mês) → NÃO aparece em recebidas
r = await req('GET', '/api/remanejamento/solicitacoes', undefined, tokenG3);
if (r.status !== 200) fail('T9c get g3', `esperado 200, got ${r.status}`);
const g3recebidas = (r.data.recebidas ?? []).find(s => s.id === solId);
if (g3recebidas) fail('T9c', 'gestor3 (sem o colaborador no mês) NÃO deveria ver em recebidas');
ok('T9c: gestor3 (sem o colaborador naquele mês) NÃO vê em recebidas');

console.log('\n─── Todos os testes F-a passaram ✓ ───\n');
