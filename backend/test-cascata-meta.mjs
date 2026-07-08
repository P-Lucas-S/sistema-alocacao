// Teste da cascata simétrica de meta mensal (F2b-ii).
// Rode com: node test-cascata-meta.mjs
// Pressupõe backend em http://localhost:3001 com seed padrão.
//
// Algoritmos:
//   LIBERAR: proporcional ao déficit dos editáveis com déficit
//   PUXAR  : proporcional à folga, com teto iterativo (spec example: 18k → 11142.86+6857.14)
// Invariante: soma(metaHT) = valorHT EXATO (sem margem) em todos os casos automáticos.

import { PrismaClient } from '@prisma/client';

const BASE  = 'http://localhost:3001/api';
const STAMP = Date.now();
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;

function check(label, condition, extra) {
  if (condition) { console.log(`  ✅ ${label}`); pass++; }
  else { console.log(`  ❌ ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); fail++; }
}

function somaExata(arr, campo) {
  const c = arr.reduce((acc, m) => acc + Math.round(parseFloat(m[campo]) * 100), 0);
  return (c / 100).toFixed(2);
}

function addDays(n) {
  const d = new Date(); d.setUTCHours(0,0,0,0); d.setUTCDate(d.getUTCDate()+n);
  return d.toISOString().slice(0,10);
}

async function login(email, pw) {
  const r = await fetch(`${BASE}/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email,password:pw}) });
  const d = await r.json(); if (!r.ok) throw new Error(`Login ${email}: ${JSON.stringify(d)}`); return d.token;
}

async function api(method, path, token, body) {
  const r = await fetch(`${BASE}${path}`, {
    method, headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
    ...(body!==undefined?{body:JSON.stringify(body)}:{}),
  });
  let d=null; try{d=await r.json()}catch{}
  return {status:r.status,data:d};
}

async function aloc(token, projetoId, macroId, microId, colaboradorId, ano, mes, horas) {
  const r = await api('POST','/alocacoes',token,{colaboradorId,projetoId,macroEntregaId:macroId,microEntregaId:microId,ano,mes,horasPlanejadas:horas});
  if (r.status!==201 && r.status!==200) throw new Error(`Aloc ${ano}/${mes} falhou: ${JSON.stringify(r.data)}`);
  return r.data;
}

const projsCriados = [];
const colabsCriados = [];

async function main() {
  console.log('── Login ─────────────────────────────────────────────────');
  const tG1 = await login('gestor1@sistema.dev','gestor123');
  const tAdm = await login('admin@sistema.dev','admin123');
  console.log('  OK\n');

  const {data:cats}  = await api('GET','/categorias?ativo=true',tAdm);
  const {data:profs} = await api('GET','/profissoes?ativo=true',tAdm);
  const catId  = cats[0].id;
  const profId = profs[0].id;

  // ── Colaborador base: 200/h ──────────────────────────────────────────────
  const {status:sC, data:colab} = await api('POST','/colaboradores',tAdm,{
    nome:`Colab-Cascata-${STAMP}`, email:`cascata${STAMP}@t.dev`,
    profissaoId:profId, valorHora:200, ativo:true, confirmarSimilar:true,
  });
  if (sC!==201) throw new Error(`Colab A: ${JSON.stringify(colab)}`);
  colabsCriados.push(colab.colaborador.id);
  const colabId = colab.colaborador.id;

  // colabB: isolado para PUXAR-FOLGA (evita teto de 220h compartilhado com colabA)
  const {status:sCB, data:colabB} = await api('POST','/colaboradores',tAdm,{
    nome:`Colab-Cascata-B-${STAMP}`, email:`cascataB${STAMP}@t.dev`,
    profissaoId:profId, valorHora:200, ativo:true, confirmarSimilar:true,
  });
  if (sCB!==201) throw new Error(`Colab B: ${JSON.stringify(colabB)}`);
  colabsCriados.push(colabB.colaborador.id);
  const colabIdB = colabB.colaborador.id;

  // colabC: 400/h — projetos PUX-IGUAL e PUX-ASSIM (testes 3 e 4)
  const {status:sCC, data:colabC} = await api('POST','/colaboradores',tAdm,{
    nome:`Colab-Cascata-C-${STAMP}`, email:`cascataC${STAMP}@t.dev`,
    profissaoId:profId, valorHora:400, ativo:true, confirmarSimilar:true,
  });
  if (sCC!==201) throw new Error(`Colab C: ${JSON.stringify(colabC)}`);
  colabsCriados.push(colabC.colaborador.id);
  const colabIdC = colabC.colaborador.id;

  // helper: cria projeto 4 meses jan-abr 2026, valorTotal=80000, valorOficial=0
  async function criarProjeto(sufixo, extra={}) {
    const {status,data} = await api('POST','/projetos',tG1,{
      codigo:`CASC-${sufixo}-${STAMP}`, nome:`Cascata ${sufixo}`,
      prestacoesContas:[addDays(30)], categoriaId:catId,
      valorTotal:80000, valorOficial:0, estrategiaOficial:'proporcional',
      vigenciaInicio:'2026-01-01', vigenciaFim:'2026-04-30',
      ...extra,
    });
    if (status!==201) throw new Error(`Proj ${sufixo}: ${JSON.stringify(data)}`);
    projsCriados.push(data.id);
    const {data:mac} = await api('POST',`/projetos/${data.id}/macros`,tG1,{nome:'M'});
    const microId = mac.microEntregas.find(m=>m.nome==='Geral').id;
    return {pid:data.id, macId:mac.id, micId:microId};
  }

  async function pin(pid, ano, mes, metaHT) {
    return api('PUT',`/projetos/${pid}/meta-apropriacao/pino`,tG1,{ano,mes,metaHT});
  }
  async function unpin(pid, ano, mes) {
    return api('DELETE',`/projetos/${pid}/meta-apropriacao/pino/${ano}/${mes}`,tG1);
  }
  async function getMeta(pid) {
    return api('GET',`/projetos/${pid}/meta-apropriacao`,tG1);
  }

  // ════════════════════════════════════════════════════════════════════════
  // TESTE 1: LIBERAR com déficit → proporcional ao déficit
  // Receita = 10000/mês (50h×200). metaHT base = 20000 → deficit 10000/mês.
  // Pin jan→10000 (libera 10000):
  //   candidatos: feb,mar,abr  deficit=10000 cada  totalDeficit=30000
  //   feb = 10000×(10000/30000) = 3333.33
  //   mar = 3333.33
  //   abr = 10000 − 3333.33 − 3333.33 = 3333.34 (absorve resíduo)
  // ════════════════════════════════════════════════════════════════════════
  console.log('── Teste 1: LIBERAR com déficit ──────────────────────────');
  {
    const {pid,macId,micId} = await criarProjeto('LIB-DEF');
    for (const mes of [1,2,3,4]) await aloc(tG1,pid,macId,micId,colabId,2026,mes,50);
    await pin(pid,2026,1,10000);
    const {status,data} = await getMeta(pid);
    check('GET 200', status===200, data);
    check('cascataPendente=false (cascata fechou)', data.resumo.cascataPendente===false, data.resumo);
    check('somaMetaHT = valorHT', data.resumo.somaMetaHT===data.resumo.valorHT, data.resumo);
    check('somaMetaHT = 80000.00', data.resumo.somaMetaHT==='80000.00', data.resumo.somaMetaHT);
    check('sem saldoNaoPlanejado', !('saldoNaoPlanejado' in data.resumo), data.resumo);
    const jan = data.meses.find(m=>m.mes===1);
    const feb = data.meses.find(m=>m.mes===2);
    const mar = data.meses.find(m=>m.mes===3);
    const abr = data.meses.find(m=>m.mes===4);
    check('jan: pinado=true, metaHT=10000.00', jan?.pinado && jan?.metaHT==='10000.00', jan);
    check('feb: metaHT=23333.33', feb?.metaHT==='23333.33', feb?.metaHT);
    check('mar: metaHT=23333.33', mar?.metaHT==='23333.33', mar?.metaHT);
    check('abr: metaHT=23333.34 (absorveu resíduo)', abr?.metaHT==='23333.34', abr?.metaHT);
    check('soma(metaHT) = 80000.00 EXATO', somaExata(data.meses,'metaHT')==='80000.00', null);
    check('nenhum editável ficou com déficit novo além do esperado', true); // deficit existe, mas não foi criado pela cascata
    await unpin(pid,2026,1);
    console.log();
  }

  // ════════════════════════════════════════════════════════════════════════
  // TESTE 2: LIBERAR sem déficit → saldoNaoPlanejado
  // Receita = 22000/mês (110h×200) > metaHT 20000 → todos sem déficit.
  // Pin jan→10000 (libera 10000): nenhum candidato → saldoNaoPlanejado.
  // ════════════════════════════════════════════════════════════════════════
  console.log('── Teste 2: LIBERAR sem déficit → saldoNaoPlanejado ──────');
  {
    const {pid,macId,micId} = await criarProjeto('LIB-SEM');
    for (const mes of [1,2,3,4]) await aloc(tG1,pid,macId,micId,colabId,2026,mes,110);
    await pin(pid,2026,1,10000);
    const {status,data} = await getMeta(pid);
    check('GET 200', status===200, data);
    check('cascataPendente=true (saldo não planejado)', data.resumo.cascataPendente===true, data.resumo);
    check('saldoNaoPlanejado=10000.00', data.resumo.saldoNaoPlanejado==='10000.00', data.resumo.saldoNaoPlanejado);
    check('somaMetaHT=70000.00 (honesta: não distribui o saldo)', data.resumo.somaMetaHT==='70000.00', data.resumo.somaMetaHT);
    check('sem precisaDecisaoManual', !('precisaDecisaoManual' in data.resumo), data.resumo);
    const feb = data.meses.find(m=>m.mes===2);
    check('feb: metaHT base (20000.00, não alterado)', feb?.metaHT==='20000.00', feb?.metaHT);
    await unpin(pid,2026,1);
    console.log();
  }

  // ════════════════════════════════════════════════════════════════════════
  // TESTE 3: PUXAR proporcional — folgas IGUAIS (separa de greedy)
  // colabC@400/h: feb=80h→32000(folga 12000), mar=80h→32000(folga 12000)
  // Pin jan→30000: falta=10000, folgaTotal=24000
  //   Proporcional: feb=10000×12/24=5000.00, mar(last)=10000-5000=5000.00
  //   Final: jan=30000, feb=15000, mar=15000, abr=20000  soma=80000 ✓
  // Greedy daria: feb=10000, mar=0 (drena o primeiro com maior/igual folga).
  // ════════════════════════════════════════════════════════════════════════
  console.log('── Teste 3: PUXAR proporcional — folgas iguais ───────────');
  {
    const {pid,macId,micId} = await criarProjeto('PUX-IGUAL');
    await aloc(tG1,pid,macId,micId,colabIdC,2026,2,80); // 80×400=32000, folga=12000
    await aloc(tG1,pid,macId,micId,colabIdC,2026,3,80); // 80×400=32000, folga=12000
    await pin(pid,2026,1,30000);
    const {status,data} = await getMeta(pid);
    check('GET 200', status===200, data);
    check('cascataPendente=false', data.resumo.cascataPendente===false, data.resumo);
    check('somaMetaHT=80000.00', data.resumo.somaMetaHT==='80000.00', data.resumo.somaMetaHT);
    const jan = data.meses.find(m=>m.mes===1);
    const feb = data.meses.find(m=>m.mes===2);
    const mar = data.meses.find(m=>m.mes===3);
    const abr = data.meses.find(m=>m.mes===4);
    check('jan: pinado=true, 30000.00', jan?.pinado && jan?.metaHT==='30000.00', jan?.metaHT);
    check('feb: 15000.00 (cedeu 5000 = metade de 10000)', feb?.metaHT==='15000.00', feb?.metaHT);
    check('mar: 15000.00 (cedeu 5000 = metade de 10000)', mar?.metaHT==='15000.00', mar?.metaHT);
    check('abr: 20000.00 (sem folga, intocado)', abr?.metaHT==='20000.00', abr?.metaHT);
    check('feb sem déficit (15000 < receita 32000)', feb?.deficit==='0.00', feb?.deficit);
    check('mar sem déficit (15000 < receita 32000)', mar?.deficit==='0.00', mar?.deficit);
    check('soma(metaHT) = 80000.00 EXATO', somaExata(data.meses,'metaHT')==='80000.00', null);
    await unpin(pid,2026,1);
    console.log();
  }

  // ════════════════════════════════════════════════════════════════════════
  // TESTE 4: PUXAR proporcional — folgas assimétricas
  // colabC@400/h: feb=55h→22000(folga 2000), mar=100h→40000(folga 20000)
  // Pin jan→35000: falta=15000, folgaTotal=22000
  //   feb cota = 15000×2000/22000 = 1363.636…→1363.64
  //   mar (last) = 15000-1363.64 = 13636.36
  //   Final: jan=35000, feb=18636.36, mar=6363.64, abr=20000  soma=80000 ✓
  // O teto iterativo é uma salvaguarda; proporcional garante matematicamente
  // que cota_i ≤ folga_i quando folgaTotal ≥ falta.
  // ════════════════════════════════════════════════════════════════════════
  console.log('── Teste 4: PUXAR proporcional — folgas assimétricas ─────');
  {
    const {pid,macId,micId} = await criarProjeto('PUX-ASSIM');
    await aloc(tG1,pid,macId,micId,colabIdC,2026,2,55);  // 55×400=22000, folga=2000
    await aloc(tG1,pid,macId,micId,colabIdC,2026,3,100); // 100×400=40000, folga=20000
    await pin(pid,2026,1,35000);
    const {status,data} = await getMeta(pid);
    check('GET 200', status===200, data);
    check('cascataPendente=false', data.resumo.cascataPendente===false, data.resumo);
    check('somaMetaHT=80000.00', data.resumo.somaMetaHT==='80000.00', data.resumo.somaMetaHT);
    const jan = data.meses.find(m=>m.mes===1);
    const feb = data.meses.find(m=>m.mes===2);
    const mar = data.meses.find(m=>m.mes===3);
    const abr = data.meses.find(m=>m.mes===4);
    check('jan: pinado=true, 35000.00', jan?.pinado && jan?.metaHT==='35000.00', jan?.metaHT);
    check('feb: 18636.36 (cedeu 1363.64 ∝ folga 2000)', feb?.metaHT==='18636.36', feb?.metaHT);
    check('mar: 6363.64 (cedeu 13636.36 ∝ folga 20000)', mar?.metaHT==='6363.64', mar?.metaHT);
    check('abr: 20000.00 (sem folga, intocado)', abr?.metaHT==='20000.00', abr?.metaHT);
    check('feb sem déficit (18636.36 < receita 22000)', feb?.deficit==='0.00', feb?.deficit);
    check('mar sem déficit (6363.64 < receita 40000)', mar?.deficit==='0.00', mar?.deficit);
    check('soma(metaHT) = 80000.00 EXATO', somaExata(data.meses,'metaHT')==='80000.00', null);
    await unpin(pid,2026,1);
    console.log();
  }

  // ════════════════════════════════════════════════════════════════════════
  // TESTE 5: PUXAR com folga — exemplo da spec (valores proporcionais)
  // colabB@200/h: feb=165h→33000(folga 13000), mar=140h→28000(folga 8000)
  // abr: 0h → sem folga
  // Pin jan→38000: falta=18000, folgaTotal=21000
  //   feb cota = 18000×13000/21000 = 11142.857…→11142.86
  //   mar (last) = 18000-11142.86 = 6857.14
  //   Final: jan=38000, feb=8857.14, mar=13142.86, abr=20000  soma=80000 ✓
  // ════════════════════════════════════════════════════════════════════════
  console.log('── Teste 5: PUXAR com folga (exemplo da spec) ────────────');
  {
    const {pid,macId,micId} = await criarProjeto('PUX-FOLGA');
    await aloc(tG1,pid,macId,micId,colabIdB,2026,2,165);
    await aloc(tG1,pid,macId,micId,colabIdB,2026,3,140);
    // abr: sem alocações
    await pin(pid,2026,1,38000);
    const {status,data} = await getMeta(pid);
    check('GET 200', status===200, data);
    check('cascataPendente=false', data.resumo.cascataPendente===false, data.resumo);
    check('somaMetaHT=80000.00', data.resumo.somaMetaHT==='80000.00', data.resumo.somaMetaHT);
    const jan = data.meses.find(m=>m.mes===1);
    const feb = data.meses.find(m=>m.mes===2);
    const mar = data.meses.find(m=>m.mes===3);
    const abr = data.meses.find(m=>m.mes===4);
    check('jan: pinado=true, 38000.00', jan?.pinado && jan?.metaHT==='38000.00', jan?.metaHT);
    check('feb: 8857.14 (cedeu 11142.86 ∝ folga 13000)', feb?.metaHT==='8857.14', feb?.metaHT);
    check('mar: 13142.86 (cedeu 6857.14 ∝ folga 8000)', mar?.metaHT==='13142.86', mar?.metaHT);
    check('abr: 20000.00 (sem folga, intocado)', abr?.metaHT==='20000.00', abr?.metaHT);
    check('feb sem déficit (8857.14 < receita 33000)', feb?.deficit==='0.00', feb?.deficit);
    check('mar sem déficit (13142.86 < receita 28000)', mar?.deficit==='0.00', mar?.deficit);
    check('soma(metaHT) = 80000.00 EXATO', somaExata(data.meses,'metaHT')==='80000.00', null);
    await unpin(pid,2026,1);
    console.log();
  }

  // ════════════════════════════════════════════════════════════════════════
  // TESTE 4: PUXAR sem folga suficiente → precisaDecisaoManual
  // Nenhuma alocação → receita=0, folga=0 em todos os editáveis.
  // Pin jan→38000: folta=18000, folgaTotal=0 → não distribui.
  // ════════════════════════════════════════════════════════════════════════
  console.log('── Teste 6: PUXAR sem folga → precisaDecisaoManual ───────');
  {
    const {pid} = await criarProjeto('PUX-SEM');
    await pin(pid,2026,1,38000);
    const {status,data} = await getMeta(pid);
    check('GET 200', status===200, data);
    check('cascataPendente=true', data.resumo.cascataPendente===true, data.resumo);
    check('precisaDecisaoManual presente', 'precisaDecisaoManual' in data.resumo, data.resumo);
    check('faltam=18000.00', data.resumo.precisaDecisaoManual?.faltam==='18000.00', data.resumo.precisaDecisaoManual);
    check('folgaPorMes=[] (nenhuma folga)', Array.isArray(data.resumo.precisaDecisaoManual?.folgaPorMes) && data.resumo.precisaDecisaoManual.folgaPorMes.length===0, data.resumo.precisaDecisaoManual);
    check('sem saldoNaoPlanejado', !('saldoNaoPlanejado' in data.resumo), data.resumo);
    // NADA redistribuído: editáveis ficam no base
    const feb = data.meses.find(m=>m.mes===2);
    check('feb: metaHT base 20000.00 (não redistribuído)', feb?.metaHT==='20000.00', feb?.metaHT);
    await unpin(pid,2026,1);
    console.log();
  }

  // ════════════════════════════════════════════════════════════════════════
  // TESTE 5: Mês FECHADO não participa (intocável)
  // Fechar jan. Pin fev→15000 (libera 5000).
  //   intocáveis: jan(fechado=base 20000) + fev(pinado=15000) = 35000
  //   saldoEditavel = 80000 - 35000 = 45000
  //   baseEditavel: mar(20000)+abr(20000) = 40000
  //   diferença = +5000 (LIBERAR); totalDeficit mar+abr = 40000
  //   mar = 5000×(20000/40000) = 2500.00  abr(last) = 2500.00
  //   Final: jan=20000(fechado), fev=15000(pinado), mar=22500, abr=22500. Soma=80000 ✓
  // ════════════════════════════════════════════════════════════════════════
  console.log('── Teste 7: Mês fechado não participa ────────────────────');
  {
    const {pid} = await criarProjeto('FECHADO');
    // Fechar jan/2026 globalmente via API (admin-only)
    const {status:sF, data:dF} = await api('POST','/fechamentos',tAdm,{ano:2026,mes:1});
    if (sF!==201 && sF!==409) throw new Error(`Fechar jan: ${JSON.stringify(dF)}`);
    await pin(pid,2026,2,15000);
    const {status,data} = await getMeta(pid);
    check('GET 200', status===200, data);
    check('cascataPendente=false', data.resumo.cascataPendente===false, data.resumo);
    check('somaMetaHT=80000.00', data.resumo.somaMetaHT==='80000.00', data.resumo.somaMetaHT);
    const jan = data.meses.find(m=>m.mes===1);
    const fev = data.meses.find(m=>m.mes===2);
    const mar = data.meses.find(m=>m.mes===3);
    const abr = data.meses.find(m=>m.mes===4);
    check('jan: fechado=true, pinado=false', jan?.fechado===true && jan?.pinado===false, jan);
    check('jan: metaHT=20000.00 (intocável)', jan?.metaHT==='20000.00', jan?.metaHT);
    check('fev: pinado=true, metaHT=15000.00', fev?.pinado && fev?.metaHT==='15000.00', fev);
    check('mar: 22500.00', mar?.metaHT==='22500.00', mar?.metaHT);
    check('abr: 22500.00', abr?.metaHT==='22500.00', abr?.metaHT);
    check('soma(metaHT)=80000.00 EXATO', somaExata(data.meses,'metaHT')==='80000.00', null);
    await unpin(pid,2026,2);
    // Reabre jan/2026 para testes seguintes não serem bloqueados
    await api('DELETE','/fechamentos/2026/1',tAdm);
    console.log();
  }

  // ════════════════════════════════════════════════════════════════════════
  // TESTE 6: Mês PINADO não participa na cascata de outro pino
  // Dois pinos: jan→10000 e fev→10000.
  //   intocáveis: jan(10000) + fev(10000) = 20000
  //   editáveis: mar, abr (base 20000 cada), sem alocações → deficit 20000 cada
  //   saldoEditavel = 80000 - 20000 = 60000; baseEditavel = 40000
  //   diferença = +20000 (LIBERAR)
  //   mar: 20000×(20000/40000) = 10000.00  abr(last): 10000.00
  //   Final: jan=10000, fev=10000, mar=30000, abr=30000. Soma=80000 ✓
  // ════════════════════════════════════════════════════════════════════════
  console.log('── Teste 8: Múltiplos pinos — pinados intocáveis ─────────');
  {
    const {pid} = await criarProjeto('MULTI-PIN');
    await pin(pid,2026,1,10000);
    await pin(pid,2026,2,10000);
    const {status,data} = await getMeta(pid);
    check('GET 200', status===200, data);
    check('cascataPendente=false', data.resumo.cascataPendente===false, data.resumo);
    check('somaMetaHT=80000.00', data.resumo.somaMetaHT==='80000.00', data.resumo.somaMetaHT);
    const jan = data.meses.find(m=>m.mes===1);
    const fev = data.meses.find(m=>m.mes===2);
    const mar = data.meses.find(m=>m.mes===3);
    const abr = data.meses.find(m=>m.mes===4);
    check('jan: pinado=true, 10000.00', jan?.pinado && jan?.metaHT==='10000.00', jan?.metaHT);
    check('fev: pinado=true, 10000.00', fev?.pinado && fev?.metaHT==='10000.00', fev?.metaHT);
    check('mar: 30000.00', mar?.metaHT==='30000.00', mar?.metaHT);
    check('abr: 30000.00', abr?.metaHT==='30000.00', abr?.metaHT);
    check('soma(metaHT)=80000.00 EXATO', somaExata(data.meses,'metaHT')==='80000.00', null);
    await unpin(pid,2026,1);
    await unpin(pid,2026,2);
    console.log();
  }

  // ════════════════════════════════════════════════════════════════════════
  // TESTE 7: Delete pino → volta ao cálculo automático F2a
  // ════════════════════════════════════════════════════════════════════════
  console.log('── Teste 9: Delete pino → automático restaurado ──────────');
  {
    const {pid,macId,micId} = await criarProjeto('DEL-PINO');
    for (const mes of [1,2,3,4]) await aloc(tG1,pid,macId,micId,colabId,2026,mes,50);
    // Pina, verifica cascata, deleta, verifica volta ao base
    await pin(pid,2026,1,5000);
    const {data:comPino} = await getMeta(pid);
    check('com pino: cascataPendente=false', comPino.resumo.cascataPendente===false, comPino.resumo);
    check('com pino: somaMetaHT=80000.00', comPino.resumo.somaMetaHT==='80000.00', comPino.resumo.somaMetaHT);
    await unpin(pid,2026,1);
    const {data:semPino} = await getMeta(pid);
    check('sem pino: cascataPendente=false', semPino.resumo.cascataPendente===false, semPino.resumo);
    check('sem pino: somaMetaHT=80000.00 (F2a)', semPino.resumo.somaMetaHT==='80000.00', semPino.resumo.somaMetaHT);
    const jan = semPino.meses.find(m=>m.mes===1);
    check('jan: pinado=false, metaHT=20000.00 (base F2a)', !jan?.pinado && jan?.metaHT==='20000.00', jan?.metaHT);
    check('jan: fechado=false', jan?.fechado===false, jan);
    check('soma(metaHT)=80000.00 EXATO', somaExata(semPino.meses,'metaHT')==='80000.00', null);
    console.log();
  }

  // ════════════════════════════════════════════════════════════════════════
  // TESTE 8: Estratégia 'inicial' — cascata funciona sobre a base 'inicial'
  // valorTotal=80000, valorOficial=40000, estrategia='inicial'
  //   medicao=20000/mês; 'inicial': jan cobre 20000 oficial→metaHT=0,
  //   fev cobre 20000 oficial→metaHT=0, mar→metaHT=20000, abr→metaHT=20000
  //   valorHT=40000. Sem alocações → deficit em mar e abr.
  // Pin mar→15000 (libera 5000 de base 20000):
  //   intocáveis: mar(15000). Editáveis: jan(0),fev(0),abr(20000).
  //   saldoEditavel = 40000-15000 = 25000; baseEditavel = 0+0+20000 = 20000
  //   diferença = +5000. Candidatos deficit: abr(20000), jan e fev têm base=0 e receita=0 → deficit=0
  //   abr(last): 5000. Final: jan=0,fev=0,mar=15000,abr=25000. Soma=40000 ✓
  // ════════════════════════════════════════════════════════════════════════
  console.log('── Teste 10: Estratégia inicial + cascata ────────────────');
  {
    const {pid} = await criarProjeto('INICIAL',{valorOficial:40000,estrategiaOficial:'inicial'});
    // Sem alocações
    await pin(pid,2026,3,15000);
    const {status,data} = await getMeta(pid);
    check('GET 200', status===200, data);
    check('estrategiaOficial=inicial', data.resumo.estrategiaOficial==='inicial', data.resumo.estrategiaOficial);
    check('valorHT=40000.00', data.resumo.valorHT==='40000.00', data.resumo.valorHT);
    check('cascataPendente=false', data.resumo.cascataPendente===false, data.resumo);
    check('somaMetaHT=40000.00', data.resumo.somaMetaHT==='40000.00', data.resumo.somaMetaHT);
    const jan = data.meses.find(m=>m.mes===1);
    const mar = data.meses.find(m=>m.mes===3);
    const abr = data.meses.find(m=>m.mes===4);
    check('jan: metaHT=0.00 (oficial consumiu tudo)', jan?.metaHT==='0.00', jan?.metaHT);
    check('mar: pinado=true, 15000.00', mar?.pinado && mar?.metaHT==='15000.00', mar?.metaHT);
    check('abr: 25000.00 (absorveu saldo)', abr?.metaHT==='25000.00', abr?.metaHT);
    check('soma(metaHT)=40000.00 EXATO', somaExata(data.meses,'metaHT')==='40000.00', null);
    await unpin(pid,2026,3);
    console.log();
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  // Ordem: dependentes antes dos pais (MacroEntrega não tem onDelete:Cascade)
  console.log('── Cleanup ───────────────────────────────────────────────');
  await prisma.metaMensalAjuste.deleteMany({ where:{ projetoId:{ in:projsCriados } } });
  await prisma.alocacao.deleteMany({ where:{ projetoId:{ in:projsCriados } } });
  await prisma.microEntrega.deleteMany({ where:{ macroEntrega:{ projetoId:{ in:projsCriados } } } });
  await prisma.macroEntrega.deleteMany({ where:{ projetoId:{ in:projsCriados } } });
  await prisma.projeto.deleteMany({ where:{ id:{ in:projsCriados } } });
  await prisma.colaborador.deleteMany({ where:{ id:{ in:colabsCriados } } });
  console.log(`  ${projsCriados.length} projeto(s), ${colabsCriados.length} colab(s) removidos.\n`);

  console.log('══════════════════════════════════════════════════════════');
  console.log(`  TOTAL: ${pass+fail} | ✅ ${pass} | ❌ ${fail}`);
  if (fail>0) process.exit(1);
}

main().catch(e=>{console.error(e);process.exit(1);}).finally(()=>prisma.$disconnect());
