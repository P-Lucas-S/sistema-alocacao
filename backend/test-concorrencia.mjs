// Teste de concorrência do teto de 220h
// Cenário: colaborador com 200h alocadas (20h livres)
// Dispara 2 requisições simultâneas de 15h cada → deve: UMA passa, OUTRA bloqueia
// Resultado ERRADO: ambas passam → total = 230h → teto furado

import { randomBytes } from 'crypto';
const uid = () => randomBytes(5).toString('hex'); // 10 chars hex únicos

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

async function setup(token) {
  const id = uid(); // único por rodada
  const categoriaId  = await getCategoriaId(token);
  const profissaoId  = await getProfissaoId(token);

  const colab = await post('/api/colaboradores', {
    nome: `Corrida ${id}`,
    email: `cr${id}@teste.dev`,
    valorHora: 100,
    profissaoId,
  }, token);
  if (colab.status !== 201)
    throw new Error(`Colaborador falhou (${colab.status}): ${JSON.stringify(colab.data)}`);

  const proj = await post('/api/projetos', {
    codigo: `C${id}`,
    nome: `Projeto ${id}`,
    prestacoesContas: ['2027-01-31'],
    categoriaId,
  }, token);
  if (proj.status !== 201)
    throw new Error(`Projeto falhou (${proj.status}): ${JSON.stringify(proj.data)}`);

  const macro = await post(`/api/projetos/${proj.data.id}/macros`, { nome: 'M' }, token);
  if (macro.status !== 201)
    throw new Error(`Macro falhou (${macro.status}): ${JSON.stringify(macro.data)}`);

  return {
    colabId: colab.data.colaborador.id,
    projId:  proj.data.id,
    macroId: macro.data.id,
    microId: macro.data.microEntregas[0].id,
  };
}

async function runRodada(token, n) {
  // Setup base — colaborador fresco, sem alocações no mês 9/2027
  const base = await setup(token);

  // Alocar 200h base → sobram 20h
  const r200 = await post('/api/alocacoes', {
    colaboradorId:  base.colabId,
    projetoId:      base.projId,
    macroEntregaId: base.macroId,
    microEntregaId: base.microId,
    ano: 2027, mes: 9, horasPlanejadas: 200,
  }, token);
  if (r200.status !== 201)
    return { rodada: n, erro: `Setup 200h falhou: ${JSON.stringify(r200.data)}` };

  // Dois projetos diferentes para os dois "ataques" concorrentes
  const categoriaId = await getCategoriaId(token);
  const pA   = await post('/api/projetos', { codigo: `A${uid()}`, nome: 'Ataque A', prestacoesContas: ['2027-01-31'], categoriaId }, token);
  if (pA.status !== 201) throw new Error(`ProjA falhou: ${JSON.stringify(pA.data)}`);
  const mA   = await post(`/api/projetos/${pA.data.id}/macros`, { nome: 'MA' }, token);

  const pB   = await post('/api/projetos', { codigo: `B${uid()}`, nome: 'Ataque B', prestacoesContas: ['2027-01-31'], categoriaId }, token);
  if (pB.status !== 201) throw new Error(`ProjB falhou: ${JSON.stringify(pB.data)}`);
  const mB   = await post(`/api/projetos/${pB.data.id}/macros`, { nome: 'MB' }, token);

  const bodyA = {
    colaboradorId: base.colabId, projetoId: pA.data.id,
    macroEntregaId: mA.data.id, microEntregaId: mA.data.microEntregas[0].id,
    ano: 2027, mes: 9, horasPlanejadas: 15,
  };
  const bodyB = {
    colaboradorId: base.colabId, projetoId: pB.data.id,
    macroEntregaId: mB.data.id, microEntregaId: mB.data.microEntregas[0].id,
    ano: 2027, mes: 9, horasPlanejadas: 15,
  };

  // ── Requisições SIMULTÂNEAS ────────────────────────────────────────────
  // Promise.all faz os dois fetch() antes de qualquer await — ambos os pacotes
  // TCP são enviados quase ao mesmo tempo. No servidor, ambas as transações
  // começam; a segunda bloqueia em SELECT colaboradores FOR UPDATE até a
  // primeira fazer COMMIT, então lê o total atualizado.
  const [rA, rB] = await Promise.all([
    post('/api/alocacoes', bodyA, token),
    post('/api/alocacoes', bodyB, token),
  ]);

  const passouA  = rA.status === 201;
  const passouB  = rB.status === 201;
  const bloqA    = rA.status === 409 && rA.data.bloqueado;
  const bloqB    = rB.status === 409 && rB.data.bloqueado;

  // Verificar total real no banco — fonte de verdade
  const listResp = await fetch(
    `${API}/api/alocacoes?colaboradorId=${base.colabId}&ano=2027&mes=9`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const lista     = await listResp.json();
  const totalReal = lista.reduce((s, a) => s + parseFloat(a.horasPlanejadas), 0);

  const exatamenteUmaPassou = (passouA ? 1 : 0) + (passouB ? 1 : 0) === 1;
  const correto = exatamenteUmaPassou && totalReal <= 220;

  return {
    rodada: n, correto,
    A: passouA ? 'PASSOU' : (bloqA ? 'BLOQUEOU' : `ERR:${rA.status}`),
    B: passouB ? 'PASSOU' : (bloqB ? 'BLOQUEOU' : `ERR:${rB.status}`),
    totalReal,
    furou: totalReal > 220,
  };
}

async function main() {
  const token = await login('gestor1@sistema.dev', 'gestor123');
  console.log('Token obtido. Rodando 8 rodadas...\n');

  let todasOk = true;
  for (let i = 1; i <= 8; i++) {
    let r;
    try {
      r = await runRodada(token, i);
    } catch (e) {
      console.log(`❌ Rodada ${i}: ERRO DE SETUP — ${e.message}`);
      todasOk = false;
      continue;
    }
    const icon  = r.correto ? '✅' : '❌';
    const furou = r.furou   ? '  ⚠️  TETO FURADO!' : '';
    console.log(`${icon} Rodada ${r.rodada}: A=${r.A} | B=${r.B} | total=${r.totalReal}h${furou}`);
    if (r.erro)    { console.log(`   ERRO: ${r.erro}`); }
    if (!r.correto) todasOk = false;
  }

  console.log(
    `\n${todasOk
      ? '✅  TODAS AS RODADAS OK — lock protege o teto sob concorrência'
      : '❌  FALHA — revisar o mecanismo de lock'}`
  );
}

main().catch(console.error);
