// test-f-c.mjs — testes de cancelar/encerrar solicitações (F-c) + corrida cancelar×cessão
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

let r = await req('POST', '/api/auth/register', { name: `Admin FC ${id}`, email: `admin-fc-${id}@test.dev`, password: 'Teste123!', role: 'admin' });
if (r.status !== 201) fail('register admin', JSON.stringify(r.data));
const tokenAdmin = r.data.token;

const ga = uid(), gb = uid(), gc = uid();

r = await req('POST', '/api/auth/register', { name: `GA FC ${ga}`, email: `ga-fc-${ga}@test.dev`, password: 'Teste123!', role: 'gestor' });
if (r.status !== 201) fail('register gA', JSON.stringify(r.data));
const tokenGA = r.data.token;

r = await req('POST', '/api/auth/register', { name: `GB FC ${gb}`, email: `gb-fc-${gb}@test.dev`, password: 'Teste123!', role: 'gestor' });
if (r.status !== 201) fail('register gB', JSON.stringify(r.data));
const tokenGB = r.data.token;

r = await req('POST', '/api/auth/register', { name: `GC FC ${gc}`, email: `gc-fc-${gc}@test.dev`, password: 'Teste123!', role: 'gestor' });
if (r.status !== 201) fail('register gC', JSON.stringify(r.data));
const tokenGC = r.data.token;

r = await req('POST', '/api/auth/register', { name: `Coord FC ${id}`, email: `coord-fc-${id}@test.dev`, password: 'Teste123!', role: 'coordenador' });
if (r.status !== 201) fail('register coord', JSON.stringify(r.data));
const tokenCoord = r.data.token;

r = await req('POST', '/api/colaboradores', { nome: `Colab FC ${id}`, email: `colab-fc-${id}@test.dev` }, tokenAdmin);
if (r.status !== 201) fail('create colab', JSON.stringify(r.data));
const colabId = r.data.colaborador.id;

// Proj A (destino das solicitações de gA)
r = await req('POST', '/api/projetos', { codigo: `FCA${ga.slice(0,4)}`, nome: `Proj A FC`, prestacoesContas: ['2027-01-31'] }, tokenGA);
if (r.status !== 201) fail('proj A', JSON.stringify(r.data));
const projetoAId = r.data.id;
r = await req('POST', `/api/projetos/${projetoAId}/macros`, { nome: 'Macro A' }, tokenGA);
if (r.status !== 201) fail('macro A', JSON.stringify(r.data));
const macroAId = r.data.id;
const microAId = r.data.microEntregas[0].id;

// Proj B (origem das cessões de gB)
r = await req('POST', '/api/projetos', { codigo: `FCB${gb.slice(0,4)}`, nome: `Proj B FC`, prestacoesContas: ['2027-01-31'] }, tokenGB);
if (r.status !== 201) fail('proj B', JSON.stringify(r.data));
const projetoBId = r.data.id;
r = await req('POST', `/api/projetos/${projetoBId}/macros`, { nome: 'Macro B' }, tokenGB);
if (r.status !== 201) fail('macro B', JSON.stringify(r.data));
const macroBId = r.data.id;
const microBId = r.data.microEntregas[0].id;

// Proj C (outro gestor para testar 403)
r = await req('POST', '/api/projetos', { codigo: `FCC${gc.slice(0,4)}`, nome: `Proj C FC`, prestacoesContas: ['2027-01-31'] }, tokenGC);
if (r.status !== 201) fail('proj C', JSON.stringify(r.data));
const projetoCId = r.data.id;
r = await req('POST', `/api/projetos/${projetoCId}/macros`, { nome: 'Macro C' }, tokenGC);
if (r.status !== 201) fail('macro C', JSON.stringify(r.data));
const macroCId = r.data.id;
const microCId = r.data.microEntregas[0].id;

const ANO = 2025, MES = 7;

// Alocação de gB (origem para cessões)
r = await req('POST', '/api/alocacoes', { colaboradorId: colabId, projetoId: projetoBId, macroEntregaId: macroBId, microEntregaId: microBId, ano: ANO, mes: MES, horasPlanejadas: 80 }, tokenGB);
if (r.status !== 201) fail('aloc B', JSON.stringify(r.data));
const alocBId = r.data.alocacao.id;

// Helper: cria uma nova solicitação de gA
async function criarSol(horasSolicitadas = 30) {
  const r = await req('POST', '/api/remanejamento/solicitacoes', {
    colaboradorId: colabId, projetoDestinoId: projetoAId,
    macroEntregaDestinoId: macroAId, microEntregaDestinoId: microAId,
    ano: ANO, mes: MES, horasSolicitadas,
  }, tokenGA);
  if (r.status !== 201) fail('criarSol', JSON.stringify(r.data));
  return r.data.solicitacao.id;
}

// Helper: realiza uma cessão de gB para uma solicitação
async function ceder(solId, horas) {
  const r = await req('POST', `/api/remanejamento/solicitacoes/${solId}/cessoes`, {
    alocacaoOrigemId: alocBId, horasCedidas: horas, idempotencia: `fc-${uid()}`,
  }, tokenGB);
  if (r.status !== 201) fail('ceder', JSON.stringify(r.data));
  return r.data;
}

console.log('\n─── Testes F-c: cancelar / encerrar solicitações ───\n');

// ── T1: cancelar 'aberta' SEM cessões → 200, status 'cancelada' ───────────
{
  const solId = await criarSol();
  r = await req('POST', `/api/remanejamento/solicitacoes/${solId}/cancelar`, undefined, tokenGA);
  if (r.status !== 200)                    fail('T1 status',     `esperado 200, got ${r.status}: ${JSON.stringify(r.data)}`);
  if (r.data.solicitacao.status !== 'cancelada') fail('T1 sol status', `esperado 'cancelada', got '${r.data.solicitacao.status}'`);
  if (!r.data.solicitacao.fechadoEm)       fail('T1 fechadoEm',  'esperado fechadoEm preenchido');
  ok('T1: cancelar aberta sem cessões → 200, status=cancelada');
}

// ── T2: cancelar com cessões → 409 (use encerrar) ─────────────────────────
{
  const solId = await criarSol();
  await ceder(solId, 10);
  r = await req('POST', `/api/remanejamento/solicitacoes/${solId}/cancelar`, undefined, tokenGA);
  if (r.status !== 409) fail('T2', `esperado 409, got ${r.status}`);
  if (!r.data.error?.includes('encerrar')) fail('T2 msg', `mensagem inesperada: ${r.data.error}`);
  ok('T2: cancelar com cessões → 409 (use encerrar)');
}

// ── T3: cancelar por quem não é o solicitante → 403 ──────────────────────
{
  const solId = await criarSol();
  r = await req('POST', `/api/remanejamento/solicitacoes/${solId}/cancelar`, undefined, tokenGB);
  if (r.status !== 403) fail('T3a cancelar 403', `esperado 403, got ${r.status}`);

  r = await req('POST', `/api/remanejamento/solicitacoes/${solId}/encerrar`, undefined, tokenGB);
  if (r.status !== 403) fail('T3b encerrar 403', `esperado 403, got ${r.status}`);
  ok('T3: cancelar/encerrar por não-solicitante (gestor alheio) → 403');
}

// ── T4: cancelar/encerrar já 'atendida' → 409 ─────────────────────────────
{
  const solId = await criarSol(20);
  await ceder(solId, 20);  // isso fecha como 'atendida'

  r = await req('POST', `/api/remanejamento/solicitacoes/${solId}/cancelar`, undefined, tokenGA);
  if (r.status !== 409) fail('T4a cancelar atendida', `esperado 409, got ${r.status}`);

  r = await req('POST', `/api/remanejamento/solicitacoes/${solId}/encerrar`, undefined, tokenGA);
  if (r.status !== 409) fail('T4b encerrar atendida', `esperado 409, got ${r.status}`);
  ok('T4: cancelar/encerrar uma já atendida → 409');
}

// ── T5: encerrar 'aberta' COM cessões → 200, status 'encerrada_parcial' ───
{
  const solId = await criarSol(30);
  await ceder(solId, 15);   // cede parcialmente (15 de 30)

  // Verifica horas de destino ANTES do encerramento
  r = await req('GET', `/api/alocacoes?colaboradorId=${colabId}&projetoId=${projetoAId}&ano=${ANO}&mes=${MES}`, undefined, tokenAdmin);
  const horasDestinoAntes = r.data.reduce((s, a) => s + parseFloat(a.horasPlanejadas), 0);

  r = await req('POST', `/api/remanejamento/solicitacoes/${solId}/encerrar`, undefined, tokenGA);
  if (r.status !== 200)                           fail('T5 status',     `esperado 200, got ${r.status}: ${JSON.stringify(r.data)}`);
  if (r.data.solicitacao.status !== 'encerrada_parcial') fail('T5 sol status', `esperado 'encerrada_parcial', got '${r.data.solicitacao.status}'`);
  if (!r.data.solicitacao.fechadoEm)              fail('T5 fechadoEm',  'esperado fechadoEm preenchido');

  // Horas de destino NÃO mudaram (ficam definitivas)
  r = await req('GET', `/api/alocacoes?colaboradorId=${colabId}&projetoId=${projetoAId}&ano=${ANO}&mes=${MES}`, undefined, tokenAdmin);
  const horasDestinoDepois = r.data.reduce((s, a) => s + parseFloat(a.horasPlanejadas), 0);
  if (Math.abs(horasDestinoAntes - horasDestinoDepois) > 0.001) {
    fail('T5 horas destino', `esperado ${horasDestinoAntes}, got ${horasDestinoDepois}`);
  }
  ok('T5: encerrar aberta com cessões → 200, status=encerrada_parcial, horas cedidas permanecem');
}

// ── T6: encerrar 'aberta' SEM cessões → 409 (use cancelar) ───────────────
{
  const solId = await criarSol();
  r = await req('POST', `/api/remanejamento/solicitacoes/${solId}/encerrar`, undefined, tokenGA);
  if (r.status !== 409) fail('T6', `esperado 409, got ${r.status}`);
  if (!r.data.error?.includes('cancelar')) fail('T6 msg', `mensagem inesperada: ${r.data.error}`);
  ok('T6: encerrar aberta sem cessões → 409 (use cancelar)');
}

// ── T7: cancelar uma já 'cancelada' → 409 ────────────────────────────────
{
  const solId = await criarSol();
  r = await req('POST', `/api/remanejamento/solicitacoes/${solId}/cancelar`, undefined, tokenGA);
  if (r.status !== 200) fail('T7 1a', JSON.stringify(r.data));

  r = await req('POST', `/api/remanejamento/solicitacoes/${solId}/cancelar`, undefined, tokenGA);
  if (r.status !== 409) fail('T7 2a', `esperado 409, got ${r.status}`);
  ok('T7: cancelar uma já cancelada → 409');
}

// ── T8: coordenador → 403 nos dois ───────────────────────────────────────
{
  const solId = await criarSol();
  r = await req('POST', `/api/remanejamento/solicitacoes/${solId}/cancelar`, undefined, tokenCoord);
  if (r.status !== 403) fail('T8a coord cancelar', `esperado 403, got ${r.status}`);

  r = await req('POST', `/api/remanejamento/solicitacoes/${solId}/encerrar`, undefined, tokenCoord);
  if (r.status !== 403) fail('T8b coord encerrar', `esperado 403, got ${r.status}`);
  ok('T8: coordenador → 403 em cancelar e encerrar');
}

// ── T9: admin pode cancelar solicitação de outro gestor ───────────────────
{
  const solId = await criarSol();
  r = await req('POST', `/api/remanejamento/solicitacoes/${solId}/cancelar`, undefined, tokenAdmin);
  if (r.status !== 200)                    fail('T9 status', `esperado 200, got ${r.status}`);
  if (r.data.solicitacao.status !== 'cancelada') fail('T9 sol status', `esperado 'cancelada'`);
  ok('T9: admin pode cancelar solicitação de outro gestor');
}

console.log('\n─── Testes funcionais F-c: todos passaram ✓ ───\n');

// ── Teste de corrida: cancelar × cessão na mesma solicitação ─────────────
console.log('─── Corrida cancelar × cessão (4 rodadas) ───\n');

// Setup de corrida: alocação de gC (separada da alocação de gB usada acima)
r = await req('POST', '/api/alocacoes', {
  colaboradorId: colabId, projetoId: projetoCId,
  macroEntregaId: macroCId, microEntregaId: microCId,
  ano: ANO, mes: MES + 1, horasPlanejadas: 40,
}, tokenGC);
if (r.status !== 201) fail('aloc C corrida', JSON.stringify(r.data));
const alocCCorridaId = r.data.alocacao.id;

for (let rodada = 1; rodada <= 4; rodada++) {
  // Cria uma solicitação nova a cada rodada (gA pede colab, destino=projetoA, mês diferente)
  const MES_R = MES + 1;
  r = await req('POST', '/api/remanejamento/solicitacoes', {
    colaboradorId: colabId, projetoDestinoId: projetoAId,
    macroEntregaDestinoId: macroAId, microEntregaDestinoId: microAId,
    ano: ANO, mes: MES_R, horasSolicitadas: 20,
  }, tokenGA);
  if (r.status !== 201) fail(`R${rodada} criar sol`, JSON.stringify(r.data));
  const solCorridaId = r.data.solicitacao.id;

  // Dispara cancelar (gA) e cessão (gC) em PARALELO
  const [resCancelar, resCessao] = await Promise.all([
    req('POST', `/api/remanejamento/solicitacoes/${solCorridaId}/cancelar`, undefined, tokenGA),
    req('POST', `/api/remanejamento/solicitacoes/${solCorridaId}/cessoes`, {
      alocacaoOrigemId: alocCCorridaId, horasCedidas: 15, idempotencia: `corrida-${uid()}`,
    }, tokenGC),
  ]);

  // Inspeciona estado real no banco
  r = await req('GET', '/api/remanejamento/solicitacoes', undefined, tokenGA);
  const solFinal = r.data.minhas.find(s => s.id === solCorridaId);
  if (!solFinal) fail(`R${rodada} sol not found`, 'solicitação não está em minhas');

  const statusFinal  = solFinal.status;
  const cessoesSoma  = parseFloat(solFinal.horasJaCedidas ?? '0');

  // INVARIANTE: nunca 'cancelada' COM cessões
  if (statusFinal === 'cancelada' && cessoesSoma > 0) {
    fail(`R${rodada} invariante`, `status=cancelada mas cessoes=${cessoesSoma} — BUG!`);
  }

  // Verifica coerência dos resultados HTTP
  let quemGanhou;
  if (resCancelar.status === 200 && (resCessao.status === 409 || resCessao.status === 404)) {
    // Cancelar ganhou: cessão deve ter recusado (solicitação não estava aberta)
    if (statusFinal !== 'cancelada') fail(`R${rodada} cancelar ganhou mas status=${statusFinal}`, '');
    quemGanhou = 'cancelar';
  } else if (resCessao.status === 201 && resCancelar.status === 409) {
    // Cessão ganhou: cancelar deve ter recusado (já tem cessões)
    if (cessoesSoma <= 0) fail(`R${rodada} cessao ganhou mas cessoesSoma=0`, '');
    quemGanhou = 'cessão';
  } else {
    // Qualquer outro resultado válido: e.g., ambos recusaram por razões diferentes
    // Mas nunca deve ter cancelada+cessoes
    quemGanhou = `cancelar=${resCancelar.status} cessão=${resCessao.status}`;
  }

  console.log(`  ✅ Rodada ${rodada}: ${quemGanhou} | status=${statusFinal} | cessoes=${cessoesSoma}h | invariante=✓`);
}

console.log('\n─── Corrida cancelar×cessão: invariante mantido em todas as rodadas ✓ ───\n');
