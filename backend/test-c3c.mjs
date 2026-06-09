// test-c3c.mjs — testes do POST /api/alocacoes/copiar-realizado
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

// gestor principal
let r = await req('POST', '/api/auth/register', { name: `Gestor C3C ${id}`, email: `gc3c-${id}@test.dev`, password: 'Teste123!', role: 'gestor' });
if (r.status !== 201) fail('register gestor', JSON.stringify(r.data));
const tokenGestor = r.data.token;
const gestorId    = r.data.user.id;

// gestor2 (projetos separados)
const id2 = uid();
r = await req('POST', '/api/auth/register', { name: `Gestor2 C3C ${id2}`, email: `gc3c2-${id2}@test.dev`, password: 'Teste123!', role: 'gestor' });
if (r.status !== 201) fail('register gestor2', JSON.stringify(r.data));
const tokenGestor2 = r.data.token;

// coordenador (sem permissão)
const id3 = uid();
r = await req('POST', '/api/auth/register', { name: `Coord C3C ${id3}`, email: `cc3c-${id3}@test.dev`, password: 'Teste123!', role: 'coordenador' });
if (r.status !== 201) fail('register coord', JSON.stringify(r.data));
const tokenCoord = r.data.token;

// colaborador
r = await req('POST', '/api/colaboradores', { nome: `Colab C3C ${id}`, email: `colab-c3c-${id}@test.dev` }, tokenGestor);
if (r.status !== 201) fail('create colaborador', JSON.stringify(r.data));
const colabId = r.data.colaborador.id;

// projeto DO GESTOR
r = await req('POST', '/api/projetos', { codigo: `C3C${id}`, nome: `Projeto C3C ${id}`, prestacoesContas: ['2027-01-31'] }, tokenGestor);
if (r.status !== 201) fail('create projeto', JSON.stringify(r.data));
const projetoId = r.data.id;

// projeto DO GESTOR2
r = await req('POST', '/api/projetos', { codigo: `C3C2${id2}`, nome: `Projeto C3C2 ${id2}`, prestacoesContas: ['2027-01-31'] }, tokenGestor2);
if (r.status !== 201) fail('create projeto2', JSON.stringify(r.data));
const projetoId2 = r.data.id;

// macro + micro (projeto do gestor)
r = await req('POST', `/api/projetos/${projetoId}/macros`, { nome: 'Macro C3C' }, tokenGestor);
if (r.status !== 201) fail('create macro', JSON.stringify(r.data));
const macroId = r.data.id;
const microId = r.data.microEntregas[0].id;

// macro + micro (projeto do gestor2)
r = await req('POST', `/api/projetos/${projetoId2}/macros`, { nome: 'Macro C3C2' }, tokenGestor2);
if (r.status !== 201) fail('create macro2', JSON.stringify(r.data));
const macroId2 = r.data.id;
const microId2 = r.data.microEntregas[0].id;

// colaborador2 para alocar no projeto2
r = await req('POST', '/api/colaboradores', { nome: `Colab C3C2 ${id2}`, email: `colab-c3c2-${id2}@test.dev` }, tokenGestor2);
if (r.status !== 201) fail('create colaborador2', JSON.stringify(r.data));
const colabId2 = r.data.colaborador.id;

// alocação 1: 100h em projeto do gestor (mês 5/2026)
r = await req('POST', '/api/alocacoes', {
  colaboradorId: colabId, projetoId, macroEntregaId: macroId, microEntregaId: microId,
  ano: 2026, mes: 5, horasPlanejadas: 100,
}, tokenGestor);
if (r.status !== 201) fail('create alocacao1', JSON.stringify(r.data));
const aloc1Id = r.data.alocacao.id;

// alocação 2: 60h em projeto do gestor2 (mesmo colab, mês 5/2026)
r = await req('POST', '/api/alocacoes', {
  colaboradorId: colabId2, projetoId: projetoId2, macroEntregaId: macroId2, microEntregaId: microId2,
  ano: 2026, mes: 5, horasPlanejadas: 60,
}, tokenGestor2);
if (r.status !== 201) fail('create alocacao2', JSON.stringify(r.data));
const aloc2Id = r.data.alocacao.id;

console.log('\n─── Testes C3-c: POST /api/alocacoes/copiar-realizado ───\n');

// ── T1: coordenador → 403 ─────────────────────────────────────────────────────
r = await req('POST', '/api/alocacoes/copiar-realizado', { ano: 2026, mes: 5 }, tokenCoord);
if (r.status !== 403) fail('T1 403', `esperado 403, got ${r.status}`);
ok('T1: coordenador → 403');

// ── T2: ano inválido → 400 ────────────────────────────────────────────────────
r = await req('POST', '/api/alocacoes/copiar-realizado', { ano: 1999, mes: 5 }, tokenGestor);
if (r.status !== 400) fail('T2 400', `esperado 400, got ${r.status}`);
ok('T2: ano inválido (1999) → 400');

// ── T3: mes inválido → 400 ────────────────────────────────────────────────────
r = await req('POST', '/api/alocacoes/copiar-realizado', { ano: 2026, mes: 13 }, tokenGestor);
if (r.status !== 400) fail('T3 400', `esperado 400, got ${r.status}`);
ok('T3: mes inválido (13) → 400');

// ── T4: gestor copia apenas SEU projeto ──────────────────────────────────────
// Antes: aloc1 e aloc2 têm horas_realizadas = NULL
r = await req('POST', '/api/alocacoes/copiar-realizado', { ano: 2026, mes: 5 }, tokenGestor);
if (r.status !== 200) fail('T4 status', `esperado 200, got ${r.status}: ${JSON.stringify(r.data)}`);
if (typeof r.data.atualizadas !== 'number') fail('T4 shape', `esperado { atualizadas: N }, got ${JSON.stringify(r.data)}`);
if (r.data.atualizadas < 1) fail('T4 count', `esperado >= 1 alocação atualizada, got ${r.data.atualizadas}`);
ok(`T4: gestor copiou ${r.data.atualizadas} alocação(ões) do próprio projeto → 200`);

// Verificar que aloc1 foi atualizada
r = await req('GET', `/api/alocacoes?colaboradorId=${colabId}&ano=2026&mes=5`, undefined, tokenGestor);
const aloc1Atualizada = r.data.find(a => a.id === aloc1Id);
if (!aloc1Atualizada) fail('T4 find', 'alocação 1 não encontrada');
if (String(aloc1Atualizada.horasRealizadas) !== '100') fail('T4 valor', `esperado realizado=100, got ${aloc1Atualizada.horasRealizadas}`);
ok('T4b: aloc1 → horasRealizadas=100 (igual ao planejado)');

// Verificar que aloc2 (do gestor2) NÃO foi alterada pelo gestor1
r = await req('GET', `/api/alocacoes?colaboradorId=${colabId2}&ano=2026&mes=5`, undefined, tokenGestor2);
const aloc2NaoAlterada = r.data.find(a => a.id === aloc2Id);
if (!aloc2NaoAlterada) fail('T4c find', 'alocação 2 não encontrada');
if (aloc2NaoAlterada.horasRealizadas !== null) fail('T4c isolation', `gestor1 não deve copiar projeto do gestor2, mas horasRealizadas=${aloc2NaoAlterada.horasRealizadas}`);
ok('T4c: gestor1 não afetou alocação do projeto do gestor2 (isolamento correto)');

// ── T5: segunda chamada → atualizadas = 0 (nenhuma NULL restante no projeto) ──
r = await req('POST', '/api/alocacoes/copiar-realizado', { ano: 2026, mes: 5 }, tokenGestor);
if (r.status !== 200) fail('T5 status', `esperado 200, got ${r.status}`);
if (r.data.atualizadas !== 0) fail('T5 idempotente', `esperado 0 na segunda chamada, got ${r.data.atualizadas}`);
ok('T5: segunda chamada → atualizadas=0 (idempotente, não sobrescreve existente)');

// ── T6: aloc com realizado já preenchido não é sobrescrita ────────────────────
// Setar manualmente realizado=50 na aloc1 (antes era 100, a cópia não deve alterar)
// Já checado em T5 — confirmamos que realizado=100 permanece após segunda chamada.
// Vamos setar manualmente para 50 e confirmar que uma nova cópia não sobrescreve.
r = await req('PATCH', `/api/alocacoes/${aloc1Id}/realizado`, { horasRealizadas: 50 }, tokenGestor);
if (r.status !== 200) fail('T6 patch', `erro ao setar realizado=50: ${r.status}`);
r = await req('POST', '/api/alocacoes/copiar-realizado', { ano: 2026, mes: 5 }, tokenGestor);
if (r.status !== 200) fail('T6 copy', `esperado 200, got ${r.status}`);
if (r.data.atualizadas !== 0) fail('T6 não sobrescreve', `esperado 0 (não sobrescreve existente), got ${r.data.atualizadas}`);
r = await req('GET', `/api/alocacoes?colaboradorId=${colabId}&ano=2026&mes=5`, undefined, tokenGestor);
const aloc1Mantida = r.data.find(a => a.id === aloc1Id);
if (String(aloc1Mantida.horasRealizadas) !== '50') fail('T6 valor mantido', `esperado 50 (não sobrescrito), got ${aloc1Mantida.horasRealizadas}`);
ok('T6: realizado preenchido (50) não é sobrescrito pela cópia');

console.log('\n─── Todos os testes C3-c passaram ✓ ───\n');
