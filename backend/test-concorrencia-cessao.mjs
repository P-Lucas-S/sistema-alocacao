// test-concorrencia-cessao.mjs — garante que duas cessões paralelas nunca cedem mais do que o solicitado
// e preservam net-zero do colaborador no mês
import { randomBytes } from 'crypto';

const uid  = () => randomBytes(4).toString('hex');
const API  = 'http://localhost:3001';
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

// ── Setup uma vez ─────────────────────────────────────────────────────────────
const id = uid();

// Login com usuários do seed (registro desabilitado no ambiente)
const _logins = await Promise.all([
  req('POST', '/api/auth/login', { email: 'admin@sistema.dev',   password: 'admin123'   }, undefined),
  req('POST', '/api/auth/login', { email: 'gestor1@sistema.dev', password: 'gestor123' }, undefined),
  req('POST', '/api/auth/login', { email: 'gestor2@sistema.dev', password: 'gestor123' }, undefined),
  req('POST', '/api/auth/login', { email: 'gestor3@sistema.dev', password: 'gestor123' }, undefined),
]);
for (const [label, res] of [['admin', _logins[0]], ['gestor1', _logins[1]], ['gestor2', _logins[2]], ['gestor3', _logins[3]]]) {
  if (!res.data.token) { console.error(`login ${label} falhou`, res.data); process.exit(1); }
}
const tokenAdmin = _logins[0].data.token;
const tokenGA    = _logins[1].data.token; // gestor1 — solicitante (recebe no destino)
const tokenGB1   = _logins[2].data.token; // gestor2 — cedente 1
const tokenGB2   = _logins[3].data.token; // gestor3 — cedente 2

// Categoria e profissão (obrigatórios desde atualização do schema)
let r = await req('GET', '/api/categorias?ativo=true', undefined, tokenAdmin);
if (r.status !== 200 || !r.data[0]) { console.error('categorias', r.data); process.exit(1); }
const categoriaId = r.data[0].id;

r = await req('GET', '/api/profissoes?ativo=true', undefined, tokenAdmin);
if (r.status !== 200 || !r.data[0]) { console.error('profissoes', r.data); process.exit(1); }
const profissaoId = r.data[0].id;

// Projetos fixos (reutilizados em cada rodada)
r = await req('POST', '/api/projetos', { codigo: `CCSA${id}`, nome: 'Proj A CC', prestacoesContas: ['2027-01-31'], categoriaId }, tokenGA);
if (r.status !== 201) { console.error('proj A', r.data); process.exit(1); }
const projetoAId = r.data.id;
r = await req('POST', `/api/projetos/${projetoAId}/macros`, { nome: 'Macro A' }, tokenGA);
if (r.status !== 201) { console.error('macro A', r.data); process.exit(1); }
const macroAId = r.data.id;
const microAId = r.data.microEntregas[0].id;

r = await req('POST', '/api/projetos', { codigo: `CCSB1${id}`, nome: 'Proj B1 CC', prestacoesContas: ['2027-01-31'], categoriaId }, tokenGB1);
if (r.status !== 201) { console.error('proj B1', r.data); process.exit(1); }
const projetoB1Id = r.data.id;
r = await req('POST', `/api/projetos/${projetoB1Id}/macros`, { nome: 'Macro B1' }, tokenGB1);
if (r.status !== 201) { console.error('macro B1', r.data); process.exit(1); }
const macroB1Id = r.data.id;
const microB1Id = r.data.microEntregas[0].id;

r = await req('POST', '/api/projetos', { codigo: `CCSB2${id}`, nome: 'Proj B2 CC', prestacoesContas: ['2027-01-31'], categoriaId }, tokenGB2);
if (r.status !== 201) { console.error('proj B2', r.data); process.exit(1); }
const projetoB2Id = r.data.id;
r = await req('POST', `/api/projetos/${projetoB2Id}/macros`, { nome: 'Macro B2' }, tokenGB2);
if (r.status !== 201) { console.error('macro B2', r.data); process.exit(1); }
const macroB2Id = r.data.id;
const microB2Id = r.data.microEntregas[0].id;

const RODADAS = 8;
let rodadasOk = 0;
const ANO = 2025;

console.log(`\nTokens obtidos. Rodando ${RODADAS} rodadas...\n`);

for (let rodada = 1; rodada <= RODADAS; rodada++) {
  // Mês diferente a cada rodada para evitar conflito de alocações únicas
  const MES = rodada;

  // Colaborador novo a cada rodada (garante isolamento total)
  r = await req('POST', '/api/colaboradores', { nome: `CC Colab R${rodada} ${uid()}`, email: `cc-r${rodada}-${uid()}@test.dev`, valorHora: 50, profissaoId }, tokenAdmin);
  if (r.status !== 201) fail(`R${rodada} colab`, JSON.stringify(r.data));
  const colabId = r.data.colaborador.id;

  // Alocações de B1 e B2 (20h cada)
  r = await req('POST', '/api/alocacoes', { colaboradorId: colabId, projetoId: projetoB1Id, macroEntregaId: macroB1Id, microEntregaId: microB1Id, ano: ANO, mes: MES, horasPlanejadas: 20 }, tokenGB1);
  if (r.status !== 201) fail(`R${rodada} aloc B1`, JSON.stringify(r.data));
  const alocB1Id = r.data.alocacao.id;

  r = await req('POST', '/api/alocacoes', { colaboradorId: colabId, projetoId: projetoB2Id, macroEntregaId: macroB2Id, microEntregaId: microB2Id, ano: ANO, mes: MES, horasPlanejadas: 20 }, tokenGB2);
  if (r.status !== 201) fail(`R${rodada} aloc B2`, JSON.stringify(r.data));
  const alocB2Id = r.data.alocacao.id;

  // Total inicial: 40h (B1=20 + B2=20, destino ainda não existe)
  const totalInicial = 40;

  // Solicitação de 30h (destino = projetoA)
  r = await req('POST', '/api/remanejamento/solicitacoes', { colaboradorId: colabId, projetoDestinoId: projetoAId, macroEntregaDestinoId: macroAId, microEntregaDestinoId: microAId, ano: ANO, mes: MES, horasSolicitadas: 30 }, tokenGA);
  if (r.status !== 201) fail(`R${rodada} sol`, JSON.stringify(r.data));
  const solId = r.data.solicitacao.id;

  // Dispara B1 cede 20h e B2 cede 20h em PARALELO (mesmas idempotencias únicas)
  const [resB1, resB2] = await Promise.all([
    req('POST', `/api/remanejamento/solicitacoes/${solId}/cessoes`, { alocacaoOrigemId: alocB1Id, horasCedidas: 20, idempotencia: `r${rodada}-b1-${uid()}` }, tokenGB1),
    req('POST', `/api/remanejamento/solicitacoes/${solId}/cessoes`, { alocacaoOrigemId: alocB2Id, horasCedidas: 20, idempotencia: `r${rodada}-b2-${uid()}` }, tokenGB2),
  ]);

  // Ambas devem ter respondido 201 (uma ajusta para 10h, mas ambas são criadas)
  if (resB1.status !== 201) fail(`R${rodada} B1 status`, `esperado 201, got ${resB1.status}: ${JSON.stringify(resB1.data)}`);
  if (resB2.status !== 201) fail(`R${rodada} B2 status`, `esperado 201, got ${resB2.status}: ${JSON.stringify(resB2.data)}`);

  const efetivas1 = parseFloat(resB1.data.horasCedidasEfetivas);
  const efetivas2 = parseFloat(resB2.data.horasCedidasEfetivas);
  const totalCedido = efetivas1 + efetivas2;

  // Total cedido deve ser exatamente 30h (uma entrou com 20h, a outra foi ajustada para 10h)
  if (Math.abs(totalCedido - 30) > 0.001) {
    fail(`R${rodada} total cedido`, `esperado 30, got ${totalCedido} (B1=${efetivas1}, B2=${efetivas2})`);
  }

  // Exatamente uma deve ter sido ajustada
  const umAjustado = (resB1.data.ajustado ? 1 : 0) + (resB2.data.ajustado ? 1 : 0);
  if (umAjustado !== 1) {
    fail(`R${rodada} ajustado`, `esperado 1 ajustado, got ${umAjustado}`);
  }

  // Solicitação deve estar 'atendida'
  r = await req('GET', '/api/remanejamento/solicitacoes', undefined, tokenGA);
  const sol = r.data.minhas.find(s => s.id === solId);
  if (sol?.status !== 'atendida') {
    fail(`R${rodada} status sol`, `esperado 'atendida', got '${sol?.status}'`);
  }

  // Net-zero: total de horas do colaborador no mês deve ser igual ao total inicial
  r = await req('GET', `/api/alocacoes?colaboradorId=${colabId}&ano=${ANO}&mes=${MES}`, undefined, tokenAdmin);
  const totalFinal = r.data.reduce((s, a) => s + parseFloat(a.horasPlanejadas), 0);
  if (Math.abs(totalFinal - totalInicial) > 0.001) {
    fail(`R${rodada} net-zero`, `antes=${totalInicial} depois=${totalFinal}`);
  }

  // Nenhuma origem deve ter ficado negativa
  r = await req('GET', `/api/alocacoes?colaboradorId=${colabId}&ano=${ANO}&mes=${MES}`, undefined, tokenAdmin);
  for (const aloc of r.data) {
    if (parseFloat(aloc.horasPlanejadas) < 0) {
      fail(`R${rodada} negativo`, `alocação ${aloc.id} ficou com ${aloc.horasPlanejadas}h`);
    }
  }

  console.log(`  ✅ Rodada ${rodada}: B1=${efetivas1}h | B2=${efetivas2}h | total=${totalCedido}h | net-zero=✓`);
  rodadasOk++;
}

console.log(`\n✅  TODAS AS ${rodadasOk} RODADAS OK — lock protege cessão sob concorrência\n`);
