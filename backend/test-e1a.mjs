// test-e1a.mjs — testes do fechamento mensal (E1-a)
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

// admin
let r = await req('POST', '/api/auth/register', { name: `Admin E1A ${id}`, email: `admin-e1a-${id}@test.dev`, password: 'Teste123!', role: 'admin' });
if (r.status !== 201) fail('register admin', JSON.stringify(r.data));
const tokenAdmin = r.data.token;

// gestor
const idG = uid();
r = await req('POST', '/api/auth/register', { name: `Gestor E1A ${idG}`, email: `gestor-e1a-${idG}@test.dev`, password: 'Teste123!', role: 'gestor' });
if (r.status !== 201) fail('register gestor', JSON.stringify(r.data));
const tokenGestor = r.data.token;

// coordenador
const idC = uid();
r = await req('POST', '/api/auth/register', { name: `Coord E1A ${idC}`, email: `coord-e1a-${idC}@test.dev`, password: 'Teste123!', role: 'coordenador' });
if (r.status !== 201) fail('register coord', JSON.stringify(r.data));
const tokenCoord = r.data.token;

// colaborador + projeto + macro + micro + alocação (para testar travas)
r = await req('POST', '/api/colaboradores', { nome: `Colab E1A ${id}`, email: `colab-e1a-${id}@test.dev` }, tokenAdmin);
if (r.status !== 201) fail('create colab', JSON.stringify(r.data));
const colabId = r.data.colaborador.id;

r = await req('POST', '/api/projetos', { codigo: `E1A${id}`, nome: `Proj E1A ${id}`, prestacoesContas: ['2027-01-31'] }, tokenGestor);
if (r.status !== 201) fail('create projeto', JSON.stringify(r.data));
const projetoId = r.data.id;

r = await req('POST', `/api/projetos/${projetoId}/macros`, { nome: 'Macro E1A' }, tokenGestor);
if (r.status !== 201) fail('create macro', JSON.stringify(r.data));
const macroId = r.data.id;
const microId = r.data.microEntregas[0].id;

// Alocações em dois meses diferentes:
//   mês 3/2025 → será fechado nos testes
//   mês 4/2025 → permanece aberto
r = await req('POST', '/api/alocacoes', {
  colaboradorId: colabId, projetoId, macroEntregaId: macroId, microEntregaId: microId,
  ano: 2025, mes: 3, horasPlanejadas: 50,
}, tokenGestor);
if (r.status !== 201) fail('create aloc mar', JSON.stringify(r.data));
const alocMarId = r.data.alocacao.id;

r = await req('POST', '/api/alocacoes', {
  colaboradorId: colabId, projetoId, macroEntregaId: macroId, microEntregaId: microId,
  ano: 2025, mes: 4, horasPlanejadas: 60,
}, tokenGestor);
if (r.status !== 201) fail('create aloc abr', JSON.stringify(r.data));
const alocAbrId = r.data.alocacao.id;

// Mês de teste para fechar: 3/2025
const ANO = 2025, MES_FECHADO = 3, MES_ABERTO = 4;

console.log('\n─── Testes E1-a: fechamento mensal ───\n');

// ── T1: gestor tenta fechar → 403 ────────────────────────────────────────────
r = await req('POST', '/api/fechamentos', { ano: ANO, mes: MES_FECHADO }, tokenGestor);
if (r.status !== 403) fail('T1 gestor 403', `esperado 403, got ${r.status}`);
ok('T1: gestor tenta fechar → 403');

// ── T2: coordenador tenta fechar → 403 ───────────────────────────────────────
r = await req('POST', '/api/fechamentos', { ano: ANO, mes: MES_FECHADO }, tokenCoord);
if (r.status !== 403) fail('T2 coord 403', `esperado 403, got ${r.status}`);
ok('T2: coordenador tenta fechar → 403');

// ── T3: admin fecha o mês → 201, registro existe ─────────────────────────────
r = await req('POST', '/api/fechamentos', { ano: ANO, mes: MES_FECHADO }, tokenAdmin);
if (r.status !== 201) fail('T3 fechar', `esperado 201, got ${r.status}: ${JSON.stringify(r.data)}`);
if (!r.data.fechamento?.id) fail('T3 shape', `esperado fechamento.id, got ${JSON.stringify(r.data)}`);
if (r.data.fechamento.ano !== ANO || r.data.fechamento.mes !== MES_FECHADO) fail('T3 values', `esperado ano/mes corretos`);
ok('T3: admin fecha o mês → 201, registro retornado');

// ── T4: fechar mês já fechado → 409 ──────────────────────────────────────────
r = await req('POST', '/api/fechamentos', { ano: ANO, mes: MES_FECHADO }, tokenAdmin);
if (r.status !== 409) fail('T4 409', `esperado 409, got ${r.status}`);
ok('T4: fechar mês já fechado → 409');

// ── T5: GET /grid com mês fechado retorna fechado: true ──────────────────────
r = await req('GET', `/api/alocacoes/grid?ano=${ANO}&mes=${MES_FECHADO}`, undefined, tokenGestor);
if (r.status !== 200) fail('T5 grid', `esperado 200, got ${r.status}`);
if (r.data.fechado !== true) fail('T5 fechado', `esperado fechado=true, got ${r.data.fechado}`);
ok('T5: GET /grid retorna fechado=true para mês fechado');

// ── T6: GET /grid com mês aberto retorna fechado: false ──────────────────────
r = await req('GET', `/api/alocacoes/grid?ano=${ANO}&mes=${MES_ABERTO}`, undefined, tokenGestor);
if (r.status !== 200) fail('T6 grid', `esperado 200, got ${r.status}`);
if (r.data.fechado !== false) fail('T6 aberto', `esperado fechado=false, got ${r.data.fechado}`);
ok('T6: GET /grid retorna fechado=false para mês aberto');

// ── T7: writes no mês FECHADO → 409 mesFechado ───────────────────────────────

// T7a: POST /alocacoes no mês fechado → 409
r = await req('POST', '/api/alocacoes', {
  colaboradorId: colabId, projetoId, macroEntregaId: macroId, microEntregaId: microId,
  ano: ANO, mes: MES_FECHADO, horasPlanejadas: 10,
}, tokenGestor);
if (r.status !== 409) fail('T7a POST aloc', `esperado 409, got ${r.status}`);
if (!r.data.mesFechado) fail('T7a mesFechado flag', `esperado mesFechado:true, got ${JSON.stringify(r.data)}`);
ok('T7a: POST /alocacoes no mês fechado → 409 mesFechado');

// T7b: PATCH /:id/realizado no mês fechado → 409
r = await req('PATCH', `/api/alocacoes/${alocMarId}/realizado`, { horasRealizadas: 30 }, tokenGestor);
if (r.status !== 409) fail('T7b PATCH realizado', `esperado 409, got ${r.status}`);
if (!r.data.mesFechado) fail('T7b mesFechado flag', `esperado mesFechado:true`);
ok('T7b: PATCH /realizado no mês fechado → 409 mesFechado');

// T7c: DELETE /alocacoes/:id no mês fechado → 409
r = await req('DELETE', `/api/alocacoes/${alocMarId}`, undefined, tokenGestor);
if (r.status !== 409) fail('T7c DELETE', `esperado 409, got ${r.status}`);
if (!r.data.mesFechado) fail('T7c mesFechado flag', `esperado mesFechado:true`);
ok('T7c: DELETE /alocacoes/:id no mês fechado → 409 mesFechado');

// T7d: POST /copiar-realizado no mês fechado → 409
r = await req('POST', '/api/alocacoes/copiar-realizado', { ano: ANO, mes: MES_FECHADO }, tokenGestor);
if (r.status !== 409) fail('T7d copiar', `esperado 409, got ${r.status}`);
if (!r.data.mesFechado) fail('T7d mesFechado flag', `esperado mesFechado:true`);
ok('T7d: POST /copiar-realizado no mês fechado → 409 mesFechado');

// ── T8: writes no mês ABERTO continuam funcionando ───────────────────────────

// T8a: PATCH realizado no mês aberto → 200
r = await req('PATCH', `/api/alocacoes/${alocAbrId}/realizado`, { horasRealizadas: 40 }, tokenGestor);
if (r.status !== 200) fail('T8a PATCH aberto', `esperado 200, got ${r.status}: ${JSON.stringify(r.data)}`);
ok('T8a: PATCH /realizado no mês aberto → 200 (trava não afeta)');

// T8b: copiar-realizado no mês aberto → 200 (já há realizado, atualizadas=0 mas não é 409)
r = await req('POST', '/api/alocacoes/copiar-realizado', { ano: ANO, mes: MES_ABERTO }, tokenGestor);
if (r.status !== 200) fail('T8b copiar aberto', `esperado 200, got ${r.status}: ${JSON.stringify(r.data)}`);
ok('T8b: POST /copiar-realizado no mês aberto → 200 (trava não afeta)');

// ── T9: admin reabre o mês ────────────────────────────────────────────────────

// T9a: gestor tenta reabrir → 403
r = await req('DELETE', `/api/fechamentos/${ANO}/${MES_FECHADO}`, undefined, tokenGestor);
if (r.status !== 403) fail('T9a gestor reabrir 403', `esperado 403, got ${r.status}`);
ok('T9a: gestor tenta reabrir → 403');

// T9b: coordenador tenta reabrir → 403
r = await req('DELETE', `/api/fechamentos/${ANO}/${MES_FECHADO}`, undefined, tokenCoord);
if (r.status !== 403) fail('T9b coord reabrir 403', `esperado 403, got ${r.status}`);
ok('T9b: coordenador tenta reabrir → 403');

// T9c: reabrir mês não fechado → 404
r = await req('DELETE', `/api/fechamentos/${ANO}/7`, undefined, tokenAdmin);
if (r.status !== 404) fail('T9c 404', `esperado 404, got ${r.status}`);
ok('T9c: reabrir mês não fechado → 404');

// T9d: admin reabre → 200
r = await req('DELETE', `/api/fechamentos/${ANO}/${MES_FECHADO}`, undefined, tokenAdmin);
if (r.status !== 200) fail('T9d reabrir', `esperado 200, got ${r.status}: ${JSON.stringify(r.data)}`);
if (!r.data.success) fail('T9d success', `esperado {success:true}`);
ok('T9d: admin reabre o mês → 200 {success:true}');

// T9e: após reabrir, writes voltam a funcionar
r = await req('PATCH', `/api/alocacoes/${alocMarId}/realizado`, { horasRealizadas: 45 }, tokenGestor);
if (r.status !== 200) fail('T9e write pós-reabertura', `esperado 200, got ${r.status}: ${JSON.stringify(r.data)}`);
ok('T9e: PATCH /realizado pós-reabertura → 200 (write destravado)');

// T9f: GET /grid reflete fechado=false após reabertura
r = await req('GET', `/api/alocacoes/grid?ano=${ANO}&mes=${MES_FECHADO}`, undefined, tokenGestor);
if (r.data.fechado !== false) fail('T9f grid fechado', `esperado fechado=false após reabrir, got ${r.data.fechado}`);
ok('T9f: GET /grid retorna fechado=false após reabertura');

console.log('\n─── Todos os testes E1-a passaram ✓ ───\n');
