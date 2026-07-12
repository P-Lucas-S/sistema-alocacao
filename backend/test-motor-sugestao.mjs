// Teste do motor de sugestão (POST /api/projetos/:id/sugestao-equipe) — F4a.
// Rode: node test-motor-sugestao.mjs (a partir de backend/)
// Invariantes spec §4 cobertos para F4a.

import { PrismaClient } from '@prisma/client';

const BASE  = 'http://localhost:3001/api';
const STAMP = Date.now();
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
function check(label, cond, extra) {
  if (cond) { console.log(`  ✅ ${label}`); pass++; }
  else       { console.log(`  ❌ ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); fail++; }
}

async function login(email, pw) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Login falhou (${email}): ${JSON.stringify(d)}`);
  return d.token;
}
async function api(method, path, token, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

function addDays(n) {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const PRESTACAO = addDays(30);
const ANO = 2026; const MES = 8; const MES_STR = '2026-08';

const criados = { projetos: [], colaboradores: [] };

async function criarProjeto(token, extra) {
  const { status, data } = await api('POST', '/projetos', token, {
    prestacoesContas: [PRESTACAO], ...extra,
  });
  if (status !== 201) throw new Error(`Criar projeto falhou: ${JSON.stringify(data)}`);
  criados.projetos.push(data.id); return data;
}
async function criarColab(token, campos) {
  const { status, data } = await api('POST', '/colaboradores', token, campos);
  if (!data?.colaborador) throw new Error(`Criar colab falhou (${status}): ${JSON.stringify(data)}`);
  criados.colaboradores.push(data.colaborador.id); return data.colaborador;
}
async function criarMacroGeral(token, projetoId) {
  const { data } = await api('POST', `/projetos/${projetoId}/macros`, token, { nome: 'Macro' });
  return { macroId: data.id, microId: data.microEntregas.find(m => m.nome === 'Geral').id };
}
async function alocar(token, body) {
  const { status, data } = await api('POST', '/alocacoes', token, body);
  if (status !== 201) throw new Error(`Alocar falhou (${status}): ${JSON.stringify(data)}`);
  return data;
}
async function cleanAllocs(...colabIds) {
  for (const cid of colabIds)
    await prisma.alocacao.deleteMany({ where: { colaboradorId: cid, ano: ANO, mes: MES } });
}
function sugerir(token, projetoId, body) {
  return api('POST', `/projetos/${projetoId}/sugestao-equipe`, token, body);
}

async function main() {
  console.log('── Login ──────────────────────────────────────────────');
  const tAdmin = await login('admin@sistema.dev', 'admin123');
  const tG1    = await login('gestor1@sistema.dev', 'gestor123');
  const tG2    = await login('gestor2@sistema.dev', 'gestor123');
  console.log('  OK\n');

  const { data: cats  } = await api('GET', '/categorias?ativo=true', tAdmin);
  const { data: profs } = await api('GET', '/profissoes?ativo=true', tAdmin);
  if (!cats?.length || !profs?.length) throw new Error('Seed sem categorias/profissões');
  const catId  = cats[0].id;
  const profA  = profs[0].id;
  const profB  = profs[1]?.id ?? profs[0].id;

  console.log('── Setup ───────────────────────────────────────────────');
  // Projeto principal: 100000/12 ≈ 8333.33/mês → todo HT
  const proj = await criarProjeto(tG1, {
    codigo: `MOTOR-${STAMP}`, nome: `Motor ${STAMP}`, categoriaId: catId,
    valorTotal: 100000, valorOficial: 0, estrategiaOficial: 'proporcional',
    vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31',
  });
  const { macroId, microId } = await criarMacroGeral(tG1, proj.id);

  // Projeto de outro gestor (posse)
  const proj2 = await criarProjeto(tG2, {
    codigo: `MOTOR2-${STAMP}`, nome: `Motor2 ${STAMP}`, categoriaId: catId,
    valorTotal: 50000, valorOficial: 0, estrategiaOficial: 'proporcional',
    vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31',
  });

  // 6 colaboradores
  const cA = await criarColab(tAdmin, { nome: `Motor A ${STAMP}`, email: `motor.a.${STAMP}@t.dev`, valorHora: 100, profissaoId: profA, confirmarSimilar: true });
  const cB = await criarColab(tAdmin, { nome: `Motor B ${STAMP}`, email: `motor.b.${STAMP}@t.dev`, valorHora: 100, profissaoId: profA, confirmarSimilar: true });
  const cC = await criarColab(tAdmin, { nome: `Motor C ${STAMP}`, email: `motor.c.${STAMP}@t.dev`, valorHora: 50,  profissaoId: profA, tarifas: [{ categoriaId: catId, valorHora: 150 }], confirmarSimilar: true });
  const cD = await criarColab(tAdmin, { nome: `Motor D ${STAMP}`, email: `motor.d.${STAMP}@t.dev`, valorHora: 80,  profissaoId: profB, confirmarSimilar: true });
  const cE = await criarColab(tAdmin, { nome: `Motor E ${STAMP}`, email: `motor.e.${STAMP}@t.dev`, valorHora: 100, profissaoId: profA, confirmarSimilar: true });
  const cF = await criarColab(tAdmin, { nome: `Motor F ${STAMP}`, email: `motor.f.${STAMP}@t.dev`, valorHora: 1,   profissaoId: profA, confirmarSimilar: true });
  // cF sem tarifa (API não aceita null → zeramos via Prisma)
  await prisma.colaborador.update({ where: { id: cF.id }, data: { valorHora: null } });

  console.log(`  proj=${proj.id}, colabs: A=${cA.id} B=${cB.id} C=${cC.id} D=${cD.id} E=${cE.id} F=${cF.id}\n`);

  // ═══════════════════════════════════════════════════════════
  // T15a: Posse — gestor não-dono → 403
  // ═══════════════════════════════════════════════════════════
  console.log('── T15a: Posse (gestor não-dono → 403) ────────────────');
  { const { status } = await sugerir(tG1, proj2.id, { mes: MES_STR });
    check('gestor não-dono → 403', status === 403); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // T11: Mês fechado → 400
  // ═══════════════════════════════════════════════════════════
  console.log('── T11: Mês fechado → 400 ─────────────────────────────');
  { const { status: sf } = await api('POST', '/fechamentos', tAdmin, { ano: 2026, mes: 1 });
    check('Fechar jan/2026', sf === 200 || sf === 201);
    const { status } = await sugerir(tG1, proj.id, { mes: '2026-01' });
    check('Mês fechado → 400', status === 400);
    await api('DELETE', '/fechamentos/2026/1', tAdmin); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // T15b: Read-only (nenhuma escrita no banco)
  // ═══════════════════════════════════════════════════════════
  console.log('── T15b: Read-only ─────────────────────────────────────');
  { const antes = await prisma.alocacao.count();
    await sugerir(tG1, proj.id, { mes: MES_STR });
    const depois = await prisma.alocacao.count();
    check('Contagem idêntica antes/depois', antes === depois, { antes, depois }); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // T1: Determinismo — mesma entrada 2x → JSON idêntico
  // ═══════════════════════════════════════════════════════════
  console.log('── T1: Determinismo ────────────────────────────────────');
  { const body = { mes: MES_STR, profissoes: [profA], excluidos: [cC.id, cD.id, cE.id, cF.id] };
    const { data: r1 } = await sugerir(tG1, proj.id, body);
    const { data: r2 } = await sugerir(tG1, proj.id, body);
    const eq = JSON.stringify({ ...r1, geradoEm: null }) === JSON.stringify({ ...r2, geradoEm: null });
    check('2x → mesmo JSON (exceto geradoEm)', eq); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // T2: Waterfall — 2 externos com disp igual, déficit cabe em 1
  //   Sub-projeto com deficit=400. ceilBloco(400/100)=4h.
  //   O de menor id leva tudo (4h × 100 = 400 = déficit). O outro não aparece.
  // ═══════════════════════════════════════════════════════════
  console.log('── T2: Waterfall ───────────────────────────────────────');
  { const pWF = await criarProjeto(tG1, {
      codigo: `WF-${STAMP}`, nome: `WF ${STAMP}`, categoriaId: catId,
      valorTotal: 4800, valorOficial: 0, estrategiaOficial: 'proporcional',  // 400/mês
      vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31',
    });
    await criarMacroGeral(tG1, pWF.id);
    // cA e cB: disp=220h cada, tarifa=100. déficit=400 → 4h fecha tudo.
    const { status, data } = await sugerir(tG1, pWF.id, {
      mes: MES_STR,
      profissoes: [profA],
      excluidos: [cC.id, cD.id, cE.id, cF.id],
      minHorasNovo: 1,  // sem Rule B para isolar o teste de waterfall
    });
    check('Status 200', status === 200, { status });
    const linhas = data?.linhas ?? [];
    // Exatamente UM dos dois aparece (waterfall — quem tem menor id)
    const apareceu = linhas.filter(l => l.colaboradorId === cA.id || l.colaboradorId === cB.id);
    check('Exatamente 1 externo sugerido (waterfall, não round-robin)', apareceu.length === 1, apareceu.length);
    const winner = apareceu[0]?.colaboradorId;
    const loser  = winner === cA.id ? cB.id : cA.id;
    check('Vencedor tem id < perdedor (id ASC desempata)', winner < loser, { winner, loser });
    check('Vencedor recebeu 4h (ceilBloco(400/100))', apareceu[0]?.horas === 4, apareceu[0]?.horas);
    check('deficitRemanescente = 0.00', data?.totaisPorMes?.[0]?.deficitRemanescente === '0.00', data?.totaisPorMes?.[0]?.deficitRemanescente);
    const sobra = parseFloat(data?.totaisPorMes?.[0]?.sobra ?? 'X');
    check('sobra = 0.00 (4h × 100 = 400 = deficit exato)', Math.abs(sobra) < 0.01, data?.totaisPorMes?.[0]?.sobra);
    await api('DELETE', `/projetos/${pWF.id}`, tAdmin); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // T3: Camadas — equipe atual consome antes de externo com folga maior
  //   cA: equipe (alocado no projeto), disp=100h
  //   cB: externo, disp=220h (maior!)
  //   Sub-projeto deficit=400 → 4h fecha. cA (equipe, disp=100) entra primeiro.
  // ═══════════════════════════════════════════════════════════
  console.log('── T3: Camadas (equipe antes de externo) ───────────────');
  { const p3 = await criarProjeto(tG1, {
      codigo: `CAM-${STAMP}`, nome: `Cam ${STAMP}`, categoriaId: catId,
      valorTotal: 4800, valorOficial: 0, estrategiaOficial: 'proporcional',
      vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31',
    });
    const { macroId: m3, microId: mi3 } = await criarMacroGeral(tG1, p3.id);
    // Deixa cA com disp=100h: 120h em outro projeto
    const pAux3 = await criarProjeto(tG1, {
      codigo: `AUX3-${STAMP}`, nome: `Aux3 ${STAMP}`, categoriaId: catId,
      valorTotal: 50000, valorOficial: 0, estrategiaOficial: 'proporcional',
      vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31',
    });
    const { macroId: ma3, microId: mia3 } = await criarMacroGeral(tG1, pAux3.id);
    await alocar(tG1, { colaboradorId: cA.id, projetoId: pAux3.id, macroEntregaId: ma3, microEntregaId: mia3, ano: ANO, mes: MES, horasPlanejadas: 119 });
    // Aloca cA no projeto de teste (entra na equipe atual; 1h simbólico — API exige >0)
    // Total: 119+1=120h → disp=100h
    await alocar(tG1, { colaboradorId: cA.id, projetoId: p3.id, macroEntregaId: m3, microEntregaId: mi3, ano: ANO, mes: MES, horasPlanejadas: 1 });

    const { status, data } = await sugerir(tG1, p3.id, {
      mes: MES_STR,
      profissoes: [profA],
      excluidos: [cC.id, cD.id, cE.id, cF.id],
    });
    check('Status 200', status === 200, { status });
    const linhaA = data?.linhas?.find(l => l.colaboradorId === cA.id);
    const linhaB = data?.linhas?.find(l => l.colaboradorId === cB.id);
    check('cA (equipe): camada = "equipe"', linhaA?.camada === 'equipe', linhaA?.camada);
    check('cA fecha o déficit (4h)', linhaA?.horas === 4, linhaA?.horas);
    check('cB não aparece (equipe consome antes do externo)', !linhaB, linhaB);
    await cleanAllocs(cA.id);
    await api('DELETE', `/projetos/${pAux3.id}`, tAdmin);
    await api('DELETE', `/projetos/${p3.id}`, tAdmin); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // T5: Ceil — sobra reportada (déficit que não fecha em blocos exatos)
  //   Projeto com deficit=8333.33. ceilBloco(8333.33/100)=84h → 8400>deficit.
  //   Sobra = 8400 - 8333.33 = 66.67. deficitRemanescente = 0.
  // ═══════════════════════════════════════════════════════════
  console.log('── T5: Ceil (sobra reportada) ──────────────────────────');
  { const { status, data } = await sugerir(tG1, proj.id, {
      mes: MES_STR,
      profissoes: [profA],
      excluidos: [cB.id, cC.id, cD.id, cE.id, cF.id],
      maxHorasPessoa: 220,  // remove cap para cA fechar sozinho
    });
    check('Status 200', status === 200, { status });
    // cA: ceilBloco(8333.33/100) = ceil(83.33/4)*4 = 84h
    const linhaA = data?.linhas?.find(l => l.colaboradorId === cA.id);
    check('cA recebe 84h (ceilBloco fecha por cima)', linhaA?.horas === 84, linhaA?.horas);
    check('deficitRemanescente = 0.00 (déficit coberto)', data?.totaisPorMes?.[0]?.deficitRemanescente === '0.00', data?.totaisPorMes?.[0]?.deficitRemanescente);
    const sobra = parseFloat(data?.totaisPorMes?.[0]?.sobra ?? 'X');
    check('sobra ≈ 66.67 (8400 - 8333.33)', Math.abs(sobra - 66.67) < 0.02, data?.totaisPorMes?.[0]?.sobra); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // T6: floorBloco×disponibilidade — 6h livres → contribui 4h
  //   cA em equipe do projeto. disp total = 6h (214h em projAux).
  //   floorBloco(6) = 4h. cB (externo, 220h) completa o resto.
  // ═══════════════════════════════════════════════════════════
  console.log('── T6: floorBloco×disponibilidade (6h livres → 4h) ────');
  { const pAux6 = await criarProjeto(tG1, {
      codigo: `AUX6-${STAMP}`, nome: `Aux6 ${STAMP}`, categoriaId: catId,
      valorTotal: 50000, valorOficial: 0, estrategiaOficial: 'proporcional',
      vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31',
    });
    const { macroId: ma6, microId: mia6 } = await criarMacroGeral(tG1, pAux6.id);
    // Alocar cA no proj (equipe, 1h simbólico) + 213h em pAux6 → total=214h → disp=6h
    await alocar(tG1, { colaboradorId: cA.id, projetoId: proj.id,  macroEntregaId: macroId, microEntregaId: microId, ano: ANO, mes: MES, horasPlanejadas: 1 });
    await alocar(tG1, { colaboradorId: cA.id, projetoId: pAux6.id, macroEntregaId: ma6,    microEntregaId: mia6,   ano: ANO, mes: MES, horasPlanejadas: 213 });

    const { status, data } = await sugerir(tG1, proj.id, {
      mes: MES_STR,
      profissoes: [profA],
      excluidos: [cC.id, cD.id, cE.id, cF.id],
      maxHorasPessoa: 220,  // sem cap → cB pode tomar ceilBloco(7933.33/100)=80h
    });
    check('Status 200', status === 200, { status });
    const linhaA = data?.linhas?.find(l => l.colaboradorId === cA.id);
    check('cA (equipe, 6h livres) contribui 4h (floorBloco)', linhaA?.horas === 4, linhaA?.horas);
    check('cA: dispVista=6h', linhaA?.disponibilidadeVista === 6, linhaA?.disponibilidadeVista);
    check('cA: dispApos=2h', linhaA?.disponibilidadeApos === 2, linhaA?.disponibilidadeApos);
    check('cA: camada=equipe (não é nova)', linhaA?.camada === 'equipe', linhaA?.camada);
    // cB fecha o resto: 8333.33 - 4×100 = 7933.33 → ceilBloco(7933.33/100) = ceilBloco(79.33) = 80h
    const linhaB = data?.linhas?.find(l => l.colaboradorId === cB.id);
    check('cB (externo) completa: 80h', linhaB?.horas === 80, linhaB?.horas);
    await cleanAllocs(cA.id);
    await api('DELETE', `/projetos/${pAux6.id}`, tAdmin); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // T7a: Mínimo novo, regra A — teto < minHorasNovo → pulada + diagnóstico
  //   cA (novo) com apenas 6h livres. tetoPessoa=floorBloco(6)=4h < 8h → SKIP.
  //   cB (novo) com 220h livres fecha o déficit.
  // ═══════════════════════════════════════════════════════════
  console.log('── T7a: Mínimo novo (teto 4h < 8h → pula) ─────────────');
  { const pAux7a = await criarProjeto(tG1, {
      codigo: `AUX7A-${STAMP}`, nome: `Aux7a ${STAMP}`, categoriaId: catId,
      valorTotal: 50000, valorOficial: 0, estrategiaOficial: 'proporcional',
      vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31',
    });
    const { macroId: ma7a, microId: mia7a } = await criarMacroGeral(tG1, pAux7a.id);
    // cA: 214h alocadas em projAux → disp=6h → tetoPessoa=4h < 8h → SKIP
    await alocar(tG1, { colaboradorId: cA.id, projetoId: pAux7a.id, macroEntregaId: ma7a, microEntregaId: mia7a, ano: ANO, mes: MES, horasPlanejadas: 214 });

    const { status, data } = await sugerir(tG1, proj.id, {
      mes: MES_STR,
      profissoes: [profA],
      excluidos: [cC.id, cD.id, cE.id, cF.id],
      minHorasNovo: 8,
    });
    check('Status 200', status === 200, { status });
    const linhaA = data?.linhas?.find(l => l.colaboradorId === cA.id);
    check('cA (teto 4h < 8h): não aparece nas linhas', !linhaA, linhaA);
    // cB (220h, novo) fecha o déficit
    const linhaB = data?.linhas?.find(l => l.colaboradorId === cB.id);
    check('cB aparece (cA pulada, cB fecha)', linhaB !== undefined, linhaB?.horas);
    check('cB: camada=novo', linhaB?.camada === 'novo', linhaB?.camada);
    await cleanAllocs(cA.id);
    await api('DELETE', `/projetos/${pAux7a.id}`, tAdmin); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // T7b: Mínimo novo, regra B — precisaria 4h → entra com 8h, sobra reportada
  //   Projeto com deficit=400. cA (novo, 220h): ceilBloco(400/100)=4h < 8h → entra com 8h.
  //   Sobra = 8×100 - 400 = 400.
  // ═══════════════════════════════════════════════════════════
  console.log('── T7b: Mínimo novo (4h → entra com 8h, sobra=400) ────');
  { const p7b = await criarProjeto(tG1, {
      codigo: `T7B-${STAMP}`, nome: `T7b ${STAMP}`, categoriaId: catId,
      valorTotal: 4800, valorOficial: 0, estrategiaOficial: 'proporcional',  // 400/mês
      vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31',
    });
    await criarMacroGeral(tG1, p7b.id);
    const { status, data } = await sugerir(tG1, p7b.id, {
      mes: MES_STR,
      profissoes: [profA],
      excluidos: [cC.id, cD.id, cE.id, cF.id],
      minHorasNovo: 8,
    });
    check('Status 200', status === 200, { status });
    // Quem ganhar (id menor entre cA e cB): entra com 8h (não 4h)
    const linhas = data?.linhas ?? [];
    const winner = linhas[0];
    check('Vencedor entra com 8h (mínimo novo)', winner?.horas === 8, winner?.horas);
    check('Camada = novo', winner?.camada === 'novo', winner?.camada);
    const sobra = parseFloat(data?.totaisPorMes?.[0]?.sobra ?? 'X');
    check('sobra = 400.00 (8×100 − 400)', Math.abs(sobra - 400) < 0.01, data?.totaisPorMes?.[0]?.sobra);
    check('deficitRemanescente = 0.00', data?.totaisPorMes?.[0]?.deficitRemanescente === '0.00', data?.totaisPorMes?.[0]?.deficitRemanescente);
    await api('DELETE', `/projetos/${p7b.id}`, tAdmin); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // T8: Fixado com minHoras em mês sem déficit → entra com o mínimo
  //   cB pré-alocado cobre deficit=400. cA fixado com minHoras=20 → entra mesmo assim.
  // ═══════════════════════════════════════════════════════════
  console.log('── T8: Fixado com minHoras sem déficit ─────────────────');
  { const p8 = await criarProjeto(tG1, {
      codigo: `T8-${STAMP}`, nome: `T8 ${STAMP}`, categoriaId: catId,
      valorTotal: 4800, valorOficial: 0, estrategiaOficial: 'proporcional',
      vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31',
    });
    const { macroId: m8, microId: mi8 } = await criarMacroGeral(tG1, p8.id);
    // cB já cobre o déficit (4h × 100 = 400)
    await alocar(tG1, { colaboradorId: cB.id, projetoId: p8.id, macroEntregaId: m8, microEntregaId: mi8, ano: ANO, mes: MES, horasPlanejadas: 4 });
    const { status, data } = await sugerir(tG1, p8.id, {
      mes: MES_STR,
      fixados: [{ colaboradorId: cA.id, minHoras: 20 }],
      excluidos: [cC.id, cD.id, cE.id, cF.id],
    });
    check('Status 200', status === 200, { status });
    const linhaA = data?.linhas?.find(l => l.colaboradorId === cA.id);
    check('cA fixado entra mesmo com déficit=0', !!linhaA, linhaA);
    check('cA: horas=20 (ceilBloco(20)=20, mínimo)', linhaA?.horas === 20, linhaA?.horas);
    check('cA: camada=fixado', linhaA?.camada === 'fixado', linhaA?.camada);
    await cleanAllocs(cB.id);
    await api('DELETE', `/projetos/${p8.id}`, tAdmin); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // T10a: Excluído jamais aparece
  // ═══════════════════════════════════════════════════════════
  console.log('── T10a: Excluído jamais aparece ───────────────────────');
  { const { status, data } = await sugerir(tG1, proj.id, {
      mes: MES_STR, profissoes: [profA], excluidos: [cE.id, cC.id, cD.id, cF.id],
    });
    check('Status 200', status === 200, { status });
    check('cE excluído: não aparece', !data?.linhas?.find(l => l.colaboradorId === cE.id)); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // T10b: Profissão filtra
  // ═══════════════════════════════════════════════════════════
  console.log('── T10b: Profissão filtra ──────────────────────────────');
  { const { status, data } = await sugerir(tG1, proj.id, {
      mes: MES_STR, profissoes: [profA], excluidos: [cC.id, cE.id, cF.id],
    });
    check('Status 200', status === 200, { status });
    if (profB !== profA) {
      check('cD (profB) não aparece com filtro profA', !data?.linhas?.find(l => l.colaboradorId === cD.id));
    } else {
      check('Skip (seed com 1 profissão apenas)', true);
    }
  }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // T12: Déficit com mês PINADO → motor usa valor pinado
  //   Pina ago/2026 com metaHT=5000. Motor: deficit=5000 (não 8333.33).
  // ═══════════════════════════════════════════════════════════
  console.log('── T12: Déficit com mês pinado ─────────────────────────');
  { const pPin = await criarProjeto(tG1, {
      codigo: `PIN-${STAMP}`, nome: `Pin ${STAMP}`, categoriaId: catId,
      valorTotal: 100000, valorOficial: 0, estrategiaOficial: 'proporcional',
      vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31',
    });
    await criarMacroGeral(tG1, pPin.id);
    const { status: sp } = await api('PUT', `/projetos/${pPin.id}/meta-apropriacao/pino`, tG1, { ano: ANO, mes: MES, metaHT: 5000 });
    check('Pino criado', sp === 200 || sp === 201);
    const { data: meta } = await api('GET', `/projetos/${pPin.id}/meta-apropriacao`, tG1);
    check('GET meta: deficit pinado = 5000.00', meta?.meses?.find(m => m.ano === ANO && m.mes === MES)?.deficit === '5000.00');
    const { status, data } = await sugerir(tG1, pPin.id, {
      mes: MES_STR, profissoes: [profA], excluidos: [cC.id, cD.id, cE.id, cF.id],
      maxHorasPessoa: 220,
    });
    check('Status 200', status === 200, { status });
    check('Motor: deficit = 5000.00 (pino aplicado)', data?.totaisPorMes?.[0]?.deficit === '5000.00', data?.totaisPorMes?.[0]?.deficit);
    // ceilBloco(5000/100)=52h (não 84h do não-pinado)
    const totalH = data?.linhas?.reduce((s, l) => s + l.horas, 0) ?? 0;
    check('Horas totais = 52h (52×100=5200, sobra=200)', totalH === 52, totalH);
    await api('DELETE', `/projetos/${pPin.id}`, tAdmin); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // T13: Tarifa com exceção de categoria (resolverTarifa)
  //   cC: valorHora=50, override=150 para catId. Motor usa 150.
  //   deficit=400 → ceilBloco(400/150)=ceil(2.67/4)*4=4h × 150=600 > 400. coberto.
  // ═══════════════════════════════════════════════════════════
  console.log('── T13: Tarifa com exceção de categoria ────────────────');
  { const pCat = await criarProjeto(tG1, {
      codigo: `CAT-${STAMP}`, nome: `Cat ${STAMP}`, categoriaId: catId,
      valorTotal: 4800, valorOficial: 0, estrategiaOficial: 'proporcional',
      vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31',
    });
    await criarMacroGeral(tG1, pCat.id);
    const { status, data } = await sugerir(tG1, pCat.id, {
      mes: MES_STR,
      fixados: [{ colaboradorId: cC.id }],  // garante que cC é sempre camada 1
      excluidos: [cA.id, cB.id, cD.id, cE.id, cF.id],
    });
    check('Status 200', status === 200, { status });
    const linhaC = data?.linhas?.find(l => l.colaboradorId === cC.id);
    check('cC aparece', !!linhaC, linhaC);
    check('cC: tarifa=150.00 (exceção, não 50)', linhaC?.tarifa === '150.00', linhaC?.tarifa);
    // ceilBloco(400/150) = ceil(2.667/4)*4 = 4h
    check('cC: horas=4h (ceilBloco(400/150))', linhaC?.horas === 4, linhaC?.horas);
    await api('DELETE', `/projetos/${pCat.id}`, tAdmin); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // T14: maxHorasPessoa respeitado
  //   deficit=8333.33, maxHorasPessoa=40 → cA capado 40h; cB capado 40h também.
  //   cA: floorBloco(min(220,40))=40h → 40h. cB: alvo=ceilBloco(4333.33/100)=44h → min(44,40)=40h.
  //   Ambos capados: deficitRemanescente=8333.33-4000-4000=333.33 > 0.
  // ═══════════════════════════════════════════════════════════
  console.log('── T14: maxHorasPessoa ─────────────────────────────────');
  { const { status, data } = await sugerir(tG1, proj.id, {
      mes: MES_STR, profissoes: [profA], excluidos: [cC.id, cD.id, cE.id, cF.id],
      maxHorasPessoa: 40,
    });
    check('Status 200', status === 200, { status });
    const linhaA = data?.linhas?.find(l => l.colaboradorId === cA.id);
    const linhaB = data?.linhas?.find(l => l.colaboradorId === cB.id);
    check('cA: 40h (capado pelo maxHorasPessoa)', linhaA?.horas === 40, linhaA?.horas);
    check('cB: 40h (capado também — alvo=44h mas teto=40h)', linhaB?.horas === 40, linhaB?.horas);
    const remVal = parseFloat(data?.remanescentes?.[0]?.valor ?? '0');
    check('deficitRemanescente > 0 (ambos capados, 333.33 não coberto)', remVal > 0, data?.remanescentes?.[0]?.valor); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // TF: Sem tarifa → excluído + aviso
  // ═══════════════════════════════════════════════════════════
  console.log('── TF: Sem tarifa → excluído + aviso ───────────────────');
  { const { status, data } = await sugerir(tG1, proj.id, {
      mes: MES_STR, profissoes: [profA], excluidos: [cD.id, cE.id],
    });
    check('Status 200', status === 200, { status });
    check('cF (sem tarifa): não aparece', !data?.linhas?.find(l => l.colaboradorId === cF.id));
    const temAviso = (data?.avisos ?? []).some(a => a.toLowerCase().includes('motor f'));
    check('cF: aviso emitido', temAviso, data?.avisos); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // T16: Capacidade insuficiente → remanescente R$ + diagnóstico
  //   Esgota cA (6h disp) e cB (0h disp). minHorasNovo=8 → cA pulada.
  //   déficit não coberto → remanescente em R$.
  // ═══════════════════════════════════════════════════════════
  console.log('── T16: Capacidade insuficiente ────────────────────────');
  { const pAux16 = await criarProjeto(tG1, {
      codigo: `AUX16-${STAMP}`, nome: `Aux16 ${STAMP}`, categoriaId: catId,
      valorTotal: 50000, valorOficial: 0, estrategiaOficial: 'proporcional',
      vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31',
    });
    const { macroId: ma16, microId: mia16 } = await criarMacroGeral(tG1, pAux16.id);
    await alocar(tG1, { colaboradorId: cA.id, projetoId: pAux16.id, macroEntregaId: ma16, microEntregaId: mia16, ano: ANO, mes: MES, horasPlanejadas: 214 }); // cA: 6h livres
    await alocar(tG1, { colaboradorId: cB.id, projetoId: pAux16.id, macroEntregaId: ma16, microEntregaId: mia16, ano: ANO, mes: MES, horasPlanejadas: 220 }); // cB: 0h livres
    const { status, data } = await sugerir(tG1, proj.id, {
      mes: MES_STR, profissoes: [profA], excluidos: [cC.id, cD.id, cE.id, cF.id],
      minHorasNovo: 8,
    });
    check('Status 200', status === 200, { status });
    check('Sem linhas (cA teto<8h, cB disp=0)', data?.linhas?.length === 0, data?.linhas?.length);
    check('remanescentes.length=1', data?.remanescentes?.length === 1, data?.remanescentes?.length);
    const rem = data?.remanescentes?.[0];
    check('remanescente.mes=2026-08', rem?.mes === MES_STR, rem?.mes);
    check('remanescente.valor > 0 (em R$, não em horas)', parseFloat(rem?.valor ?? '0') > 0, rem?.valor);
    check('diagnostico não vazio', rem?.diagnostico?.length > 0, rem?.diagnostico);
    await cleanAllocs(cA.id, cB.id);
    await api('DELETE', `/projetos/${pAux16.id}`, tAdmin); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // ── F4b: ORQUESTRAÇÃO MULTI-MES ──────────────────────────
  // Período de testes F4b: julho + agosto + setembro 2026
  // Sub-projetos dedicados para não poluir os testes F4a.
  // ═══════════════════════════════════════════════════════════
  const JUL = '2026-07'; const AGO = '2026-08'; const SET = '2026-09';
  const JUL_ANO = 2026,  JUL_MES = 7;
  const AGO_ANO = 2026,  AGO_MES = 8;
  const SET_ANO = 2026,  SET_MES = 9;

  // Projeto base F4b: 3 meses (Jul-Set), deficit=2000/mês (valorTotal=6000)
  const projF4b = await criarProjeto(tG1, {
    codigo: `F4B-${STAMP}`, nome: `F4b ${STAMP}`, categoriaId: catId,
    valorTotal: 6000, valorOficial: 0, estrategiaOficial: 'proporcional',
    vigenciaInicio: '2026-07-01', vigenciaFim: '2026-09-30',
  });
  await criarMacroGeral(tG1, projF4b.id);
  // 6000/3 meses = 2000/mês. ceilBloco(2000/100) = 20h.

  // ═══════════════════════════════════════════════════════════
  // TF4b-1: Promoção intra-execução
  //   cA externo em Jul → camada='novo'. Em Ago (mesma execução) → camada='equipe'.
  // ═══════════════════════════════════════════════════════════
  console.log('── TF4b-1: Promoção intra-execução ────────────────────');
  { const { status, data } = await sugerir(tG1, projF4b.id, {
      meses: [JUL, AGO],
      profissoes: [profA],
      excluidos: [cB.id, cC.id, cD.id, cE.id, cF.id],
      maxHorasPessoa: 220,
      minHorasNovo: 1,
    });
    check('Status 200', status === 200, { status });
    const linhaJul = data?.linhas?.find(l => l.colaboradorId === cA.id && l.mes === JUL);
    const linhaAgo = data?.linhas?.find(l => l.colaboradorId === cA.id && l.mes === AGO);
    check('cA[Jul]: camada=novo (primeiro contato)', linhaJul?.camada === 'novo', linhaJul?.camada);
    check('cA[Ago]: camada=equipe (promovido)', linhaAgo?.camada === 'equipe', linhaAgo?.camada);
    check('cA[Jul]: 20h (ceilBloco(2000/100))', linhaJul?.horas === 20, linhaJul?.horas);
    check('cA[Ago]: 20h (equipe, fecha o deficit)', linhaAgo?.horas === 20, linhaAgo?.horas);
    check('totaisPorMes.length=2 (Jul+Ago)', data?.totaisPorMes?.length === 2, data?.totaisPorMes?.length);
    check('parametros.meses=["2026-07","2026-08"]', JSON.stringify(data?.parametros?.meses) === JSON.stringify([JUL, AGO])); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // TF4b-2: maxExternos GLOBAL (conta nomes distintos em TODA a execução)
  //   maxExternos=1, 2 candidatos (cA e cB), 2 meses.
  //   Só 1 novo distinto permitido: quem tem menor id (cA ou cB) vira 'novo' em Jul,
  //   promovido a 'equipe' em Ago. O outro nunca aparece. remanescentes em ambos os meses.
  // ═══════════════════════════════════════════════════════════
  console.log('── TF4b-2: maxExternos global ──────────────────────────');
  { const projMaxExt = await criarProjeto(tG1, {
      codigo: `EXT-${STAMP}`, nome: `Ext ${STAMP}`, categoriaId: catId,
      valorTotal: 12000, valorOficial: 0, estrategiaOficial: 'proporcional',  // 4000/mês
      vigenciaInicio: '2026-07-01', vigenciaFim: '2026-09-30',
    });
    await criarMacroGeral(tG1, projMaxExt.id);
    // deficit=4000/mês. maxHorasPessoa=12: cA|cB pega 12h × 100 = 1200. restante=2800.
    // O 2º candidato bloqueado por maxExternos=1. remanescente=2800/mês.
    const { status, data } = await sugerir(tG1, projMaxExt.id, {
      meses: [JUL, AGO],
      profissoes: [profA],
      excluidos: [cC.id, cD.id, cE.id, cF.id],
      maxHorasPessoa: 12,
      maxExternos: 1,
      minHorasNovo: 1,
    });
    check('Status 200', status === 200, { status });
    const novosIds = new Set((data?.linhas ?? []).filter(l => l.camada === 'novo').map(l => l.colaboradorId));
    check('Exatamente 1 novo distinto em toda a execução (maxExternos=1)', novosIds.size === 1, novosIds.size);
    const vencedor = [...novosIds][0];
    const bloqueado = vencedor === cA.id ? cB.id : cA.id;
    check('Vencedor (menor id) tem id < bloqueado', vencedor < bloqueado, { vencedor, bloqueado });
    check('Bloqueado jamais aparece', !data?.linhas?.find(l => l.colaboradorId === bloqueado));
    // Vencedor: novo em Jul → equipe em Ago
    const vJul = data?.linhas?.find(l => l.colaboradorId === vencedor && l.mes === JUL);
    const vAgo = data?.linhas?.find(l => l.colaboradorId === vencedor && l.mes === AGO);
    check('Vencedor[Jul]: camada=novo', vJul?.camada === 'novo', vJul?.camada);
    check('Vencedor[Ago]: camada=equipe (promovido, não blocado)', vAgo?.camada === 'equipe', vAgo?.camada);
    check('remanescentes.length=2 (ambos os meses têm saldo)', data?.remanescentes?.length === 2, data?.remanescentes?.length);
    await api('DELETE', `/projetos/${projMaxExt.id}`, tAdmin); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // TF4b-3: Ordem cronológica
  //   Meses passados FORA DE ORDEM no body → processados em ordem crescente.
  //   Promoção de Jul afeta Ago (não o contrário).
  // ═══════════════════════════════════════════════════════════
  console.log('── TF4b-3: Ordem cronológica (meses fora de ordem) ────');
  { const { status, data: d1 } = await sugerir(tG1, projF4b.id, {
      meses: [AGO, JUL],  // fora de ordem
      profissoes: [profA],
      excluidos: [cB.id, cC.id, cD.id, cE.id, cF.id],
      maxHorasPessoa: 220, minHorasNovo: 1,
    });
    const { data: d2 } = await sugerir(tG1, projF4b.id, {
      meses: [JUL, AGO],  // ordem correta
      profissoes: [profA],
      excluidos: [cB.id, cC.id, cD.id, cE.id, cF.id],
      maxHorasPessoa: 220, minHorasNovo: 1,
    });
    check('Status 200', status === 200, { status });
    // Resultado idêntico independente da ordem de entrada
    const norm = d => JSON.stringify({ ...d, geradoEm: null });
    check('Resultado idêntico (motor ordena internamente)', norm(d1) === norm(d2));
    // cA[Jul] = novo, cA[Ago] = equipe (promoção aplicada mesmo com input invertido)
    const linhaJul = d1?.linhas?.find(l => l.colaboradorId === cA.id && l.mes === JUL);
    const linhaAgo = d1?.linhas?.find(l => l.colaboradorId === cA.id && l.mes === AGO);
    check('cA[Jul]: camada=novo (processado primeiro)', linhaJul?.camada === 'novo', linhaJul?.camada);
    check('cA[Ago]: camada=equipe (promoção de Jul)', linhaAgo?.camada === 'equipe', linhaAgo?.camada); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // TF4b-4: Disponibilidade POR MÊS — sem transbordo
  //   cA: 220h em Jul, 8h em Ago (212h alocadas em projAux4b em Ago).
  //   Jul: recebe 20h (deficit=2000, sem cap). Ago: recebe 8h (floorBloco(8)=8h).
  //   O consumo de Jul NÃO reduz a disponibilidade de Ago.
  // ═══════════════════════════════════════════════════════════
  console.log('── TF4b-4: Disponibilidade por mês (sem transbordo) ───');
  { const pAux4b = await criarProjeto(tG1, {
      codigo: `AUX4B-${STAMP}`, nome: `Aux4b ${STAMP}`, categoriaId: catId,
      valorTotal: 50000, valorOficial: 0, estrategiaOficial: 'proporcional',
      vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31',
    });
    const { macroId: ma4b, microId: mia4b } = await criarMacroGeral(tG1, pAux4b.id);
    // cA com 212h em Ago (projAux4b) → disp de Ago = 8h. Jul: sem pre-alloc → disp=220h.
    await alocar(tG1, { colaboradorId: cA.id, projetoId: pAux4b.id, macroEntregaId: ma4b, microEntregaId: mia4b, ano: AGO_ANO, mes: AGO_MES, horasPlanejadas: 212 });

    const { status, data } = await sugerir(tG1, projF4b.id, {
      meses: [JUL, AGO],
      profissoes: [profA],
      excluidos: [cB.id, cC.id, cD.id, cE.id, cF.id],
      maxHorasPessoa: 220, minHorasNovo: 1,
    });
    check('Status 200', status === 200, { status });
    const linhaJul = data?.linhas?.find(l => l.colaboradorId === cA.id && l.mes === JUL);
    const linhaAgo = data?.linhas?.find(l => l.colaboradorId === cA.id && l.mes === AGO);
    check('cA[Jul]: dispVista=220h (sem pre-alloc em Jul)', linhaJul?.disponibilidadeVista === 220, linhaJul?.disponibilidadeVista);
    check('cA[Jul]: 20h (deficit=2000, tarifa=100)', linhaJul?.horas === 20, linhaJul?.horas);
    check('cA[Ago]: dispVista=8h (212h em projAux4b)', linhaAgo?.disponibilidadeVista === 8, linhaAgo?.disponibilidadeVista);
    check('cA[Ago]: 8h (floorBloco(8)=8h, não transbordou de Jul)', linhaAgo?.horas === 8, linhaAgo?.horas);
    check('cA[Ago]: camada=equipe (promovido de Jul)', linhaAgo?.camada === 'equipe', linhaAgo?.camada);
    await prisma.alocacao.deleteMany({ where: { colaboradorId: cA.id, ano: AGO_ANO, mes: AGO_MES } });
    await api('DELETE', `/projetos/${pAux4b.id}`, tAdmin); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // TF4b-5: Mês fechado no meio do período → pulado; os outros processados
  // ═══════════════════════════════════════════════════════════
  console.log('── TF4b-5: Mês fechado no meio do período ──────────────');
  { const { status: sf } = await api('POST', '/fechamentos', tAdmin, { ano: AGO_ANO, mes: AGO_MES });
    check('Fechar ago/2026', sf === 200 || sf === 201);
    const { status, data } = await sugerir(tG1, projF4b.id, {
      meses: [JUL, AGO, SET],
      profissoes: [profA],
      excluidos: [cB.id, cC.id, cD.id, cE.id, cF.id],
      maxHorasPessoa: 220, minHorasNovo: 1,
    });
    check('Status 200', status === 200, { status });
    const linhasAgo = (data?.linhas ?? []).filter(l => l.mes === AGO);
    check('Ago fechado: zero linhas', linhasAgo.length === 0, linhasAgo.length);
    const linhasJul = (data?.linhas ?? []).filter(l => l.mes === JUL);
    const linhasSet = (data?.linhas ?? []).filter(l => l.mes === SET);
    check('Jul processado (tem linhas)', linhasJul.length > 0, linhasJul.length);
    check('Set processado (tem linhas)', linhasSet.length > 0, linhasSet.length);
    const avisoFecho = (data?.avisos ?? []).some(a => a.includes(AGO) && a.includes('fechado'));
    check('Aviso de mês fechado emitido', avisoFecho, data?.avisos);
    // Jul → cA novo; Set → cA equipe (promoção pulou o Ago fechado)
    const cAJul = linhasJul.find(l => l.colaboradorId === cA.id);
    const cASet = linhasSet.find(l => l.colaboradorId === cA.id);
    check('cA[Jul]: novo', cAJul?.camada === 'novo', cAJul?.camada);
    check('cA[Set]: equipe (promoção atravessa mês fechado)', cASet?.camada === 'equipe', cASet?.camada);
    await api('DELETE', `/fechamentos/${AGO_ANO}/${AGO_MES}`, tAdmin); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // TF4b-6: Determinismo multi-mês — mesma entrada 2x → JSON idêntico
  // ═══════════════════════════════════════════════════════════
  console.log('── TF4b-6: Determinismo multi-mês ─────────────────────');
  { const body = {
      meses: [JUL, AGO, SET],
      profissoes: [profA],
      excluidos: [cC.id, cD.id, cE.id, cF.id],
      maxHorasPessoa: 220, minHorasNovo: 1,
    };
    const { data: r1 } = await sugerir(tG1, projF4b.id, body);
    const { data: r2 } = await sugerir(tG1, projF4b.id, body);
    const eq = JSON.stringify({ ...r1, geradoEm: null }) === JSON.stringify({ ...r2, geradoEm: null });
    check('2x (multi-mês) → mesmo JSON (exceto geradoEm)', eq); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // TF4b-7: Default months — sem mes/meses → todos os meses abertos c/ deficit
  // ═══════════════════════════════════════════════════════════
  console.log('── TF4b-7: Default months (sem mes/meses no body) ─────');
  { const { status, data } = await sugerir(tG1, projF4b.id, {
      profissoes: [profA],
      excluidos: [cC.id, cD.id, cE.id, cF.id],
      maxHorasPessoa: 220, minHorasNovo: 1,
    });
    check('Status 200', status === 200, { status });
    check('totaisPorMes.length=3 (Jul, Ago, Set — todos abertos)', data?.totaisPorMes?.length === 3, data?.totaisPorMes?.length);
    check('parametros.meses.length=3', data?.parametros?.meses?.length === 3, data?.parametros?.meses);
    const mesesNaResp = (data?.totaisPorMes ?? []).map(t => t.mes);
    check('Jul está na resposta', mesesNaResp.includes(JUL), mesesNaResp);
    check('Ago está na resposta', mesesNaResp.includes(AGO), mesesNaResp);
    check('Set está na resposta', mesesNaResp.includes(SET), mesesNaResp); }
  console.log();

  // ═══════════════════════════════════════════════════════════
  // TF4b-8: Remanescentes — meses com saldos diferentes
  //   Jul: cA fecha o deficit. Set: cA com 4h livres (restante não coberto).
  //   remanescentes[] só contém Set; Jul não aparece.
  // ═══════════════════════════════════════════════════════════
  console.log('── TF4b-8: Remanescentes seletivos ────────────────────');
  { const pAux4b8 = await criarProjeto(tG1, {
      codigo: `AUX4B8-${STAMP}`, nome: `Aux4b8 ${STAMP}`, categoriaId: catId,
      valorTotal: 50000, valorOficial: 0, estrategiaOficial: 'proporcional',
      vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31',
    });
    const { macroId: ma8, microId: mia8 } = await criarMacroGeral(tG1, pAux4b8.id);
    // cA: 216h em Set → disp Set = 4h. floorBloco(4)=4h < minHorasNovo=8 → SKIP em Set.
    // Resultado: Jul coberto (cA 20h), Set não coberto (remanescente=2000).
    await alocar(tG1, { colaboradorId: cA.id, projetoId: pAux4b8.id, macroEntregaId: ma8, microEntregaId: mia8, ano: SET_ANO, mes: SET_MES, horasPlanejadas: 216 });

    const { status, data } = await sugerir(tG1, projF4b.id, {
      meses: [JUL, SET],
      profissoes: [profA],
      excluidos: [cB.id, cC.id, cD.id, cE.id, cF.id],
      maxHorasPessoa: 220, minHorasNovo: 8,
    });
    check('Status 200', status === 200, { status });
    const remMeses = (data?.remanescentes ?? []).map(r => r.mes);
    check('Jul não tem remanescente (coberto)', !remMeses.includes(JUL), remMeses);
    check('Set tem remanescente (cA teto=4h < 8h → skip)', remMeses.includes(SET), remMeses);
    const remSet = (data?.remanescentes ?? []).find(r => r.mes === SET);
    check('remanescente Set: valor > 0 (em R$)', parseFloat(remSet?.valor ?? '0') > 0, remSet?.valor);
    check('remanescente Set: diagnostico não vazio', remSet?.diagnostico?.length > 0, remSet?.diagnostico);
    await prisma.alocacao.deleteMany({ where: { colaboradorId: cA.id, ano: SET_ANO, mes: SET_MES } });
    await api('DELETE', `/projetos/${pAux4b8.id}`, tAdmin); }
  console.log();

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`TOTAL: ${pass + fail} | ✅ ${pass} | ❌ ${fail}`);
  if (fail > 0) process.exitCode = 1;
}

async function cleanup() {
  console.log('\n── Limpeza ─────────────────────────────────────────────');
  const token = await login('admin@sistema.dev', 'admin123').catch(() => null);
  for (const pid of criados.projetos) {
    try { await api('DELETE', `/projetos/${pid}`, token); } catch {}
  }
  if (criados.colaboradores.length > 0) {
    try {
      await prisma.colaborador.updateMany({
        where: { id: { in: criados.colaboradores } }, data: { ativo: false },
      });
    } catch {}
  }
  await prisma.$disconnect();
  console.log('  Concluída.');
}

main().catch(e => { console.error('\n💥 Erro fatal:', e); process.exitCode = 1; }).finally(cleanup);
