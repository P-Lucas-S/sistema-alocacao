// test-c3a.mjs — testes do PATCH /api/alocacoes/:id/realizado
import { randomBytes } from 'crypto';

const uid = () => randomBytes(4).toString('hex');
const API = 'http://localhost:3001';

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

// 1) gestor principal
let r = await req('POST', '/api/auth/register', { name: `Gestor C3A ${id}`, email: `gc3a-${id}@test.dev`, password: 'Teste123!', role: 'gestor' });
if (r.status !== 201) fail('register gestor', JSON.stringify(r.data));
const tokenGestor = r.data.token;

// 2) segundo gestor (teste de ownership)
const id2 = uid();
r = await req('POST', '/api/auth/register', { name: `Gestor C3A2 ${id2}`, email: `gc3a2-${id2}@test.dev`, password: 'Teste123!', role: 'gestor' });
if (r.status !== 201) fail('register gestor2', JSON.stringify(r.data));
const tokenGestor2 = r.data.token;

// 3) coordenador (qualquer role ≠ admin/gestor)
const id3 = uid();
r = await req('POST', '/api/auth/register', { name: `Coord C3A ${id3}`, email: `cc3a-${id3}@test.dev`, password: 'Teste123!', role: 'coordenador' });
if (r.status !== 201) fail('register coord', JSON.stringify(r.data));
const tokenCoord = r.data.token;

// 4) colaborador
r = await req('POST', '/api/colaboradores', { nome: `Colab C3A ${id}`, email: `colab-c3a-${id}@test.dev` }, tokenGestor);
if (r.status !== 201) fail('create colaborador', JSON.stringify(r.data));
const colabId = r.data.colaborador.id;

// 5) projeto (do gestor principal)
r = await req('POST', '/api/projetos', { codigo: `C3A${id}`, nome: `Projeto C3A ${id}`, prestacoesContas: ['2027-01-31'] }, tokenGestor);
if (r.status !== 201) fail('create projeto', JSON.stringify(r.data));
const projetoId = r.data.id;

// 6) macro (retorna macro + microEntregas criadas automaticamente)
r = await req('POST', `/api/projetos/${projetoId}/macros`, { nome: 'Macro C3A' }, tokenGestor);
if (r.status !== 201) fail('create macro', JSON.stringify(r.data));
const macroId = r.data.id;
const microId = r.data.microEntregas[0].id;  // micro "Geral" criada automaticamente

// 7) alocação de 100h planejadas (mês 8/2026 — fresco)
r = await req('POST', '/api/alocacoes', {
  colaboradorId: colabId, projetoId, macroEntregaId: macroId, microEntregaId: microId,
  ano: 2026, mes: 8, horasPlanejadas: 100,
}, tokenGestor);
if (r.status !== 201) fail('create alocacao', JSON.stringify(r.data));
const alocacaoId = r.data.alocacao.id;

console.log('\n─── Testes C3-a: PATCH /api/alocacoes/:id/realizado ───\n');

// ── T1: setar realizado → 200, valor gravado ──────────────────────────────────
r = await req('PATCH', `/api/alocacoes/${alocacaoId}/realizado`, { horasRealizadas: 80 }, tokenGestor);
if (r.status !== 200) fail('T1 status', `esperado 200, got ${r.status}: ${JSON.stringify(r.data)}`);
if (String(r.data.alocacao.horasRealizadas) !== '80') fail('T1 valor', `esperado 80, got ${r.data.alocacao.horasRealizadas}`);
ok('T1: setar realizado 80h → 200, valor correto');

// ── T2: realizado pode exceder planejado (100 planejado → 120 realizado) ───────
r = await req('PATCH', `/api/alocacoes/${alocacaoId}/realizado`, { horasRealizadas: 120 }, tokenGestor);
if (r.status !== 200) fail('T2 status', `esperado 200, got ${r.status}: ${JSON.stringify(r.data)}`);
if (String(r.data.alocacao.horasRealizadas) !== '120') fail('T2 valor', `esperado 120, got ${r.data.alocacao.horasRealizadas}`);
ok('T2: realizado 120h > planejado 100h → permitido, 200');

// ── T3: realizado NÃO consome teto — planejado pode somar 220 normalmente ──────
// Estado: colaborador tem 100h planejadas + realizado=120 (acima do planejado).
// Criar segunda micro e alocar +120h planejadas → total planejado = 220 (deve passar).
r = await req('POST', `/api/projetos/${projetoId}/macros/${macroId}/micros`, { nome: 'Extra C3A' }, tokenGestor);
if (r.status !== 201) fail('T3 create micro2', JSON.stringify(r.data));
const microId2 = r.data.id;

const somaAntes = 100; // só a alocação que criamos
r = await req('POST', '/api/alocacoes', {
  colaboradorId: colabId, projetoId, macroEntregaId: macroId, microEntregaId: microId2,
  ano: 2026, mes: 8, horasPlanejadas: 120,
}, tokenGestor);
if (r.status !== 201) fail('T3 +120h planejadas bloqueou', `esperado 201, got ${r.status}: ${JSON.stringify(r.data)}`);

r = await req('GET', `/api/alocacoes?colaboradorId=${colabId}&ano=2026&mes=8`, undefined, tokenGestor);
const somaDepois = r.data.reduce((s, a) => s + parseFloat(a.horasPlanejadas), 0);
if (somaDepois !== 220) fail('T3 soma planejada', `esperado 220, got ${somaDepois}`);
ok(`T3: realizado(120) não consome teto — planejado: ${somaAntes}h → +120h → ${somaDepois}h (sem bloqueio)`);

// ── T4: limpar com null → coluna volta a null ─────────────────────────────────
r = await req('PATCH', `/api/alocacoes/${alocacaoId}/realizado`, { horasRealizadas: null }, tokenGestor);
if (r.status !== 200) fail('T4 status', `esperado 200, got ${r.status}: ${JSON.stringify(r.data)}`);
if (r.data.alocacao.horasRealizadas !== null) fail('T4 null', `esperado null, got ${r.data.alocacao.horasRealizadas}`);
ok('T4: limpar com null → horasRealizadas = null');

// ── T5a: negativo → 400 ───────────────────────────────────────────────────────
r = await req('PATCH', `/api/alocacoes/${alocacaoId}/realizado`, { horasRealizadas: -5 }, tokenGestor);
if (r.status !== 400) fail('T5a', `esperado 400, got ${r.status}`);
ok('T5a: negativo (-5) → 400');

// ── T5b: alocação inexistente → 404 ──────────────────────────────────────────
r = await req('PATCH', '/api/alocacoes/id-nao-existe-xyz/realizado', { horasRealizadas: 10 }, tokenGestor);
if (r.status !== 404) fail('T5b', `esperado 404, got ${r.status}`);
ok('T5b: alocação inexistente → 404');

// ── T5c: valor acima do limite Decimal(6,2) → 400 ────────────────────────────
r = await req('PATCH', `/api/alocacoes/${alocacaoId}/realizado`, { horasRealizadas: 10000 }, tokenGestor);
if (r.status !== 400) fail('T5c', `esperado 400, got ${r.status}`);
ok('T5c: valor > 9999.99 (10000) → 400 (teto de sanidade da coluna)');

// ── T6a: coordenador → 403 ────────────────────────────────────────────────────
r = await req('PATCH', `/api/alocacoes/${alocacaoId}/realizado`, { horasRealizadas: 50 }, tokenCoord);
if (r.status !== 403) fail('T6a', `esperado 403, got ${r.status}`);
ok('T6a: coordenador → 403 (requireRole bloqueia)');

// ── T6b: gestor2 em alocação do projeto do gestor1 → 403 (ownership F0) ─────
r = await req('PATCH', `/api/alocacoes/${alocacaoId}/realizado`, { horasRealizadas: 30 }, tokenGestor2);
if (r.status !== 403) fail('T6b', `esperado 403 (ownership check F0), got ${r.status}: ${JSON.stringify(r.data)}`);
ok('T6b: gestor2 em projeto do gestor1 → 403 (Posse na Escrita — F0)');

console.log('\n─── Todos os testes C3-a passaram ✓ ───\n');
