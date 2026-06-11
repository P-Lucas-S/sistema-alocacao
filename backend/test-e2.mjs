// test-e2.mjs — testes do log de auditoria do planejado (E2)
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

const gestorNome = `Gestor E2 ${id}`;
let r = await req('POST', '/api/auth/register', { name: gestorNome, email: `gestor-e2-${id}@test.dev`, password: 'Teste123!', role: 'gestor' });
if (r.status !== 201) fail('register gestor', JSON.stringify(r.data));
const tokenGestor = r.data.token;

r = await req('POST', '/api/auth/register', { name: `Admin E2 ${id}`, email: `admin-e2-${id}@test.dev`, password: 'Teste123!', role: 'admin' });
if (r.status !== 201) fail('register admin', JSON.stringify(r.data));
const tokenAdmin = r.data.token;

r = await req('POST', '/api/colaboradores', { nome: `Colab E2 ${id}`, email: `colab-e2-${id}@test.dev` }, tokenAdmin);
if (r.status !== 201) fail('create colab', JSON.stringify(r.data));
const colabId = r.data.colaborador.id;

r = await req('POST', '/api/projetos', { codigo: `E2${id}`, nome: `Proj E2 ${id}`, prestacoesContas: ['2027-01-31'] }, tokenGestor);
if (r.status !== 201) fail('create projeto', JSON.stringify(r.data));
const projetoId = r.data.id;

r = await req('POST', `/api/projetos/${projetoId}/macros`, { nome: 'Macro E2' }, tokenGestor);
if (r.status !== 201) fail('create macro', JSON.stringify(r.data));
const macroId = r.data.id;
const microId = r.data.microEntregas[0].id;

const ANO = 2025, MES = 5;

console.log('\n─── Testes E2: log de auditoria do planejado ───\n');

// ── T1: criar alocação → 1 log 'criou' ────────────────────────────────────
r = await req('POST', '/api/alocacoes', {
  colaboradorId: colabId, projetoId, macroEntregaId: macroId, microEntregaId: microId,
  ano: ANO, mes: MES, horasPlanejadas: 40,
}, tokenGestor);
if (r.status !== 201) fail('T1 criar aloc', JSON.stringify(r.data));
const alocId = r.data.alocacao.id;

r = await req('GET', `/api/alocacoes/${alocId}/log`, undefined, tokenGestor);
if (r.status !== 200) fail('T1 get log status', `esperado 200, got ${r.status}`);
if (r.data.length !== 1) fail('T1 count', `esperado 1 log, got ${r.data.length}: ${JSON.stringify(r.data)}`);
const log1 = r.data[0];
if (log1.acao !== 'criou')                    fail('T1 acao',             `esperado 'criou', got '${log1.acao}'`);
if (log1.horasAnteriores !== null)            fail('T1 horasAnteriores',  `esperado null, got ${log1.horasAnteriores}`);
if (parseFloat(log1.horasNovas) !== 40)       fail('T1 horasNovas',       `esperado 40, got ${log1.horasNovas}`);
if (log1.usuario.name !== gestorNome)         fail('T1 usuario',          `esperado '${gestorNome}', got '${log1.usuario.name}'`);
ok('T1: criar → 1 log criou (anterior=null, nova=40, usuário correto)');

// ── T2: alterar para outro valor → log 'alterou' ──────────────────────────
r = await req('POST', '/api/alocacoes', {
  colaboradorId: colabId, projetoId, macroEntregaId: macroId, microEntregaId: microId,
  ano: ANO, mes: MES, horasPlanejadas: 60,
}, tokenGestor);
if (r.status !== 201) fail('T2 alterar aloc', JSON.stringify(r.data));

r = await req('GET', `/api/alocacoes/${alocId}/log`, undefined, tokenGestor);
if (r.data.length !== 2)                       fail('T2 count',    `esperado 2 logs, got ${r.data.length}`);
const log2 = r.data[0]; // mais recente primeiro
if (log2.acao !== 'alterou')                   fail('T2 acao',     `esperado 'alterou', got '${log2.acao}'`);
if (parseFloat(log2.horasAnteriores) !== 40)   fail('T2 anterior', `esperado 40, got ${log2.horasAnteriores}`);
if (parseFloat(log2.horasNovas) !== 60)        fail('T2 nova',     `esperado 60, got ${log2.horasNovas}`);
ok('T2: alterar 40→60 → log alterou (anterior=40, nova=60)');

// ── T3: upsert com MESMO valor → NÃO cria log ─────────────────────────────
r = await req('POST', '/api/alocacoes', {
  colaboradorId: colabId, projetoId, macroEntregaId: macroId, microEntregaId: microId,
  ano: ANO, mes: MES, horasPlanejadas: 60,
}, tokenGestor);
if (r.status !== 201) fail('T3 upsert mesmo valor', JSON.stringify(r.data));

r = await req('GET', `/api/alocacoes/${alocId}/log`, undefined, tokenGestor);
if (r.data.length !== 2) fail('T3 count', `esperado ainda 2 logs, got ${r.data.length}`);
ok('T3: upsert com mesmo valor → NÃO gera log (contagem permanece 2)');

// ── T4: PATCH /realizado → NÃO cria log ──────────────────────────────────
r = await req('PATCH', `/api/alocacoes/${alocId}/realizado`, { horasRealizadas: 55 }, tokenGestor);
if (r.status !== 200) fail('T4 patch realizado', JSON.stringify(r.data));

r = await req('GET', `/api/alocacoes/${alocId}/log`, undefined, tokenGestor);
if (r.data.length !== 2) fail('T4 count', `esperado ainda 2 logs, got ${r.data.length}`);
ok('T4: PATCH /realizado → NÃO cria log (escopo é só o planejado)');

// ── T5: copiar-realizado → NÃO cria log ──────────────────────────────────
const idCopiar = uid();
r = await req('POST', '/api/colaboradores', { nome: `Colab Copiar ${idCopiar}`, email: `colab-cp-${idCopiar}@test.dev` }, tokenAdmin);
if (r.status !== 201) fail('T5 colab copiar', JSON.stringify(r.data));
const colabIdCopiar = r.data.colaborador.id;

r = await req('POST', '/api/alocacoes', {
  colaboradorId: colabIdCopiar, projetoId, macroEntregaId: macroId, microEntregaId: microId,
  ano: ANO, mes: 6, horasPlanejadas: 30,
}, tokenGestor);
if (r.status !== 201) fail('T5 criar aloc copiar', JSON.stringify(r.data));
const alocIdCopiar = r.data.alocacao.id;

r = await req('GET', `/api/alocacoes/${alocIdCopiar}/log`, undefined, tokenGestor);
const countAntesCopiar = r.data.length; // deve ser 1

r = await req('POST', '/api/alocacoes/copiar-realizado', { ano: ANO, mes: 6 }, tokenGestor);
if (r.status !== 200) fail('T5 copiar realizado', JSON.stringify(r.data));

r = await req('GET', `/api/alocacoes/${alocIdCopiar}/log`, undefined, tokenGestor);
if (r.data.length !== countAntesCopiar) fail('T5 count', `esperado ${countAntesCopiar} logs, got ${r.data.length}`);
ok('T5: copiar-realizado → NÃO cria log');

// ── T6: ordem mais nova primeiro ─────────────────────────────────────────
r = await req('GET', `/api/alocacoes/${alocId}/log`, undefined, tokenGestor);
if (r.data.length < 2) fail('T6 count', `precisa de ao menos 2 logs, got ${r.data.length}`);
const datas = r.data.map(l => new Date(l.criadoEm).getTime());
for (let i = 1; i < datas.length; i++) {
  if (datas[i - 1] < datas[i]) {
    fail('T6 ordem', `entrada [${i - 1}] mais antiga que [${i}] — esperado mais nova primeiro`);
  }
}
ok('T6: logs retornados mais novo primeiro (criadoEm desc)');

// ── T7: apagar alocação → log 'removeu', log sobrevive à deleção ──────────
r = await req('DELETE', `/api/alocacoes/${alocId}`, undefined, tokenGestor);
if (r.status !== 200) fail('T7 delete', JSON.stringify(r.data));

// alocacao foi deletada; o log deve sobreviver
r = await req('GET', `/api/alocacoes/${alocId}/log`, undefined, tokenGestor);
if (r.status !== 200)    fail('T7 log status', `esperado 200, got ${r.status}`);
if (r.data.length !== 3) fail('T7 count',      `esperado 3 logs (criou+alterou+removeu), got ${r.data.length}`);
const logRemoveu = r.data[0];
if (logRemoveu.acao !== 'removeu')              fail('T7 acao',     `esperado 'removeu', got '${logRemoveu.acao}'`);
if (parseFloat(logRemoveu.horasAnteriores) !== 60) fail('T7 anterior', `esperado 60, got ${logRemoveu.horasAnteriores}`);
if (logRemoveu.horasNovas !== null)             fail('T7 nova',     `esperado null, got ${logRemoveu.horasNovas}`);
ok('T7: DELETE → log removeu (anterior=60, nova=null); log sobrevive à deleção da alocação');

// ── T8: coordenador não pode acessar o log → 403 ─────────────────────────
const idCoord = uid();
r = await req('POST', '/api/auth/register', { name: `Coord E2 ${idCoord}`, email: `coord-e2-${idCoord}@test.dev`, password: 'Teste123!', role: 'coordenador' });
if (r.status !== 201) fail('T8 register coord', JSON.stringify(r.data));
const tokenCoord = r.data.token;

r = await req('GET', `/api/alocacoes/${alocId}/log`, undefined, tokenCoord);
if (r.status !== 403) fail('T8 coord 403', `esperado 403, got ${r.status}`);
ok('T8: coordenador não pode acessar log → 403');

console.log('\n─── Todos os testes E2 passaram ✓ ───\n');
