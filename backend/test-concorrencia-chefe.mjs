// Teste de concorrência do teto de 220h — MESMO molde do test-concorrencia.mjs,
// mas um dos dois lados disparando é o CHEFE (override), não outro gestor.
// Cenário: colaborador com 200h alocadas (20h livres). Chefe e gestor1 disparam
// 15h cada, simultaneamente, pro MESMO colaborador/mês → soma estouraria 220h.
// Resultado ERRADO: ambos passam → total = 230h → teto furado.

import { randomBytes } from 'crypto';
const uid = () => randomBytes(5).toString('hex');

const API = 'http://localhost:3001';

async function login(email, password) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return (await r.json()).token;
}

async function post(path, body, token) {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  return { status: r.status, data };
}

let categoriaIdCache = null;
async function getCategoriaId(token) {
  if (categoriaIdCache) return categoriaIdCache;
  const r = await fetch(`${API}/api/categorias?ativo=true`, { headers: { Authorization: `Bearer ${token}` } });
  const cats = await r.json();
  categoriaIdCache = cats[0].id;
  return categoriaIdCache;
}

let profissaoIdCache = null;
async function getProfissaoId(token) {
  if (profissaoIdCache) return profissaoIdCache;
  const r = await fetch(`${API}/api/profissoes?ativo=true`, { headers: { Authorization: `Bearer ${token}` } });
  const profs = await r.json();
  profissaoIdCache = profs[0].id;
  return profissaoIdCache;
}

// Setup feito pelo gestor1 (dono "natural") — colaborador + projeto base.
// O chefe vai operar esse MESMO colaborador/projeto por override, sem ser dono.
async function setup(tokenGestor) {
  const id = uid();
  const categoriaId = await getCategoriaId(tokenGestor);
  const profissaoId = await getProfissaoId(tokenGestor);

  const colab = await post('/api/colaboradores', {
    nome: `CorridaChefe ${id}`,
    email: `crc${id}@teste.dev`,
    valorHora: 100,
    profissaoId,
  }, tokenGestor);
  if (colab.status !== 201)
    throw new Error(`Colaborador falhou (${colab.status}): ${JSON.stringify(colab.data)}`);

  const proj = await post('/api/projetos', {
    codigo: `CC${id}`,
    nome: `Projeto Chefe ${id}`,
    prestacoesContas: ['2027-01-31'],
    categoriaId,
  }, tokenGestor);
  if (proj.status !== 201)
    throw new Error(`Projeto falhou (${proj.status}): ${JSON.stringify(proj.data)}`);

  const macro = await post(`/api/projetos/${proj.data.id}/macros`, { nome: 'M' }, tokenGestor);
  if (macro.status !== 201)
    throw new Error(`Macro falhou (${macro.status}): ${JSON.stringify(macro.data)}`);

  return {
    colabId: colab.data.colaborador.id,
    projId:  proj.data.id,
    macroId: macro.data.id,
    microId: macro.data.microEntregas[0].id,
  };
}

async function runRodada(tokenGestor, tokenChefe, n) {
  const base = await setup(tokenGestor);
  const categoriaId = await getCategoriaId(tokenGestor);

  // Alocar 200h base (pelo gestor, dono) → sobram 20h
  const r200 = await post('/api/alocacoes', {
    colaboradorId:  base.colabId,
    projetoId:      base.projId,
    macroEntregaId: base.macroId,
    microEntregaId: base.microId,
    ano: 2027, mes: 9, horasPlanejadas: 200,
  }, tokenGestor);
  if (r200.status !== 201)
    return { rodada: n, erro: `Setup 200h falhou: ${JSON.stringify(r200.data)}` };

  // Dois projetos "de ataque" — um o CHEFE vai usar (sem ser dono), outro o gestor.
  const pA = await post('/api/projetos', { codigo: `CA${uid()}`, nome: 'Ataque Chefe', prestacoesContas: ['2027-01-31'], categoriaId }, tokenGestor);
  if (pA.status !== 201) throw new Error(`ProjA falhou: ${JSON.stringify(pA.data)}`);
  const mA = await post(`/api/projetos/${pA.data.id}/macros`, { nome: 'MA' }, tokenGestor);

  const pB = await post('/api/projetos', { codigo: `CB${uid()}`, nome: 'Ataque Gestor', prestacoesContas: ['2027-01-31'], categoriaId }, tokenGestor);
  if (pB.status !== 201) throw new Error(`ProjB falhou: ${JSON.stringify(pB.data)}`);
  const mB = await post(`/api/projetos/${pB.data.id}/macros`, { nome: 'MB' }, tokenGestor);

  const bodyChefe = {
    colaboradorId: base.colabId, projetoId: pA.data.id,
    macroEntregaId: mA.data.id, microEntregaId: mA.data.microEntregas[0].id,
    ano: 2027, mes: 9, horasPlanejadas: 15,
  };
  const bodyGestor = {
    colaboradorId: base.colabId, projetoId: pB.data.id,
    macroEntregaId: mB.data.id, microEntregaId: mB.data.microEntregas[0].id,
    ano: 2027, mes: 9, horasPlanejadas: 15,
  };

  // ── Requisições SIMULTÂNEAS: chefe (override, projeto pA não é dele) x gestor1 (dono de pB) ──
  const [rChefe, rGestor] = await Promise.all([
    post('/api/alocacoes', bodyChefe, tokenChefe),
    post('/api/alocacoes', bodyGestor, tokenGestor),
  ]);

  const passouChefe  = rChefe.status === 201;
  const passouGestor = rGestor.status === 201;
  const bloqChefe    = rChefe.status === 409 && rChefe.data.bloqueado;
  const bloqGestor   = rGestor.status === 409 && rGestor.data.bloqueado;

  // Verificar total real no banco — fonte de verdade
  const listResp = await fetch(
    `${API}/api/alocacoes?colaboradorId=${base.colabId}&ano=2027&mes=9`,
    { headers: { Authorization: `Bearer ${tokenGestor}` } }
  );
  const lista     = await listResp.json();
  const totalReal = lista.reduce((s, a) => s + parseFloat(a.horasPlanejadas), 0);

  const exatamenteUmaPassou = (passouChefe ? 1 : 0) + (passouGestor ? 1 : 0) === 1;
  const correto = exatamenteUmaPassou && totalReal <= 220;

  return {
    rodada: n, correto,
    Chefe:  passouChefe  ? 'PASSOU' : (bloqChefe  ? 'BLOQUEOU' : `ERR:${rChefe.status}`),
    Gestor: passouGestor ? 'PASSOU' : (bloqGestor ? 'BLOQUEOU' : `ERR:${rGestor.status}`),
    totalReal,
    furou: totalReal > 220,
  };
}

async function main() {
  const tokenGestor = await login('gestor1@sistema.dev', 'gestor123');
  const tokenChefe  = await login('chefe@sistema.dev', 'chefe123');
  console.log('Tokens obtidos. Rodando 8 rodadas (chefe × gestor)...\n');

  let todasOk = true;
  for (let i = 1; i <= 8; i++) {
    let r;
    try {
      r = await runRodada(tokenGestor, tokenChefe, i);
    } catch (e) {
      console.log(`❌ Rodada ${i}: ERRO DE SETUP — ${e.message}`);
      todasOk = false;
      continue;
    }
    const icon  = r.correto ? '✅' : '❌';
    const furou = r.furou   ? '  ⚠️  TETO FURADO!' : '';
    console.log(`${icon} Rodada ${r.rodada}: Chefe=${r.Chefe} | Gestor=${r.Gestor} | total=${r.totalReal}h${furou}`);
    if (r.erro)    { console.log(`   ERRO: ${r.erro}`); }
    if (!r.correto) todasOk = false;
  }

  console.log(
    `\n${todasOk
      ? '✅  TODAS AS RODADAS OK — lock protege o teto sob concorrência (chefe incluso, sem atalho)'
      : '❌  FALHA — revisar o mecanismo de lock com chefe'}`
  );
  if (!todasOk) process.exit(1);
}

main().catch(console.error);
