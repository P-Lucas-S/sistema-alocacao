// Teste da cascata do OFICIAL editável por mês (Fase 1 — coluna Oficial).
// Rode com: node test-cascata-oficial.mjs
// Pressupõe backend em http://localhost:3001 com seed padrão.
//
// Algoritmo (espelha a cascata da meta):
//   Ativa só quando há pino de oficial. Intocável = pinado-de-oficial OU fechado.
//   Redistribui (valorOficial − soma dos carimbos intocáveis) entre os editáveis
//   PROPORCIONAL ao oficial-base de cada um; último absorve resíduo. Fallback:
//   base editável total = 0 → divisão igual. Teto+transbordo: capa na medição do
//   mês e transborda o excedente pro próximo editável (laço carry da proporcional).
//   Carimbo de um mês fechado = o valor que ele EFETIVAMENTE tem (pino se houver,
//   senão o oficial-base) — nunca recomputado. É o que fecha o invariante.
// Invariante: soma(oficial) = valorOficial EXATO (sem margem) nos casos não-estouro.

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

const projsCriados = [];
const colabsCriados = [];

async function main() {
  console.log('── Login ─────────────────────────────────────────────────');
  const tG1  = await login('gestor1@sistema.dev','gestor123');
  const tAdm = await login('admin@sistema.dev','admin123');
  console.log('  OK\n');

  const {data:cats}  = await api('GET','/categorias?ativo=true',tAdm);
  const {data:profs} = await api('GET','/profissoes?ativo=true',tAdm);
  const catId  = cats[0].id;
  const profId = profs[0].id;

  // helper: cria projeto jan-abr 2026, valorTotal=80000; oficial/estrategia via extra
  async function criarProjeto(sufixo, extra={}) {
    const {status,data} = await api('POST','/projetos',tG1,{
      codigo:`OFIC-${sufixo}-${STAMP}`, nome:`Oficial ${sufixo}`,
      prestacoesContas:[addDays(30)], categoriaId:catId,
      valorTotal:80000, valorOficial:40000, estrategiaOficial:'proporcional',
      vigenciaInicio:'2026-01-01', vigenciaFim:'2026-04-30',
      ...extra,
    });
    if (status!==201) throw new Error(`Proj ${sufixo}: ${JSON.stringify(data)}`);
    projsCriados.push(data.id);
    return data.id;
  }
  const pinOficial    = (pid,ano,mes,valorOficial) => api('PUT',`/projetos/${pid}/meta-apropriacao/pino-oficial`,tG1,{ano,mes,valorOficial});
  const unpinOficial  = (pid,ano,mes) => api('DELETE',`/projetos/${pid}/meta-apropriacao/pino-oficial/${ano}/${mes}`,tG1);
  const pinMedicao    = (pid,ano,mes,medicao) => api('PUT',`/projetos/${pid}/meta-apropriacao/pino-medicao`,tG1,{ano,mes,medicao});
  const pinMeta       = (pid,ano,mes,metaHT) => api('PUT',`/projetos/${pid}/meta-apropriacao/pino`,tG1,{ano,mes,metaHT});
  const getMeta       = (pid) => api('GET',`/projetos/${pid}/meta-apropriacao`,tG1);
  const mesOf = (data,mes) => data.meses.find(m=>m.mes===mes);

  // ════════════════════════════════════════════════════════════════════════
  // TESTE 1: PROPORCIONAL ao oficial-base + invariante + metaHT + coexistência
  // Medição pin jan=5000 → medicoes [5000,25000,25000,25000].
  // Oficial-base (proporcional, valorOficial=40000): uniforme 10000 + transbordo
  //   (jan capa em 5000, carry 5000 → fev) = [5000,15000,10000,10000].
  // Pin oficial jan=3000 → editáveis fev,mar,abr (base 15000,10000,10000; tot 35000):
  //   saldo=40000-3000=37000
  //   fev=37000×15000/35000=15857.14, mar=37000×10000/35000=10571.43,
  //   abr(last)=37000-15857.14-10571.43=10571.43  (todos < medição, sem teto)
  //   soma oficial = 3000+15857.14+10571.43+10571.43 = 40000 EXATO
  //   metaHT: jan=2000, fev=9142.86, mar=14428.57, abr=14428.57
  //   jan tem pino de MEDIÇÃO e de OFICIAL (coexistência de dois pinos).
  // ════════════════════════════════════════════════════════════════════════
  console.log('── Teste 1: proporcional ao oficial-base + invariante ────');
  {
    const pid = await criarProjeto('PROP');
    await pinMedicao(pid,2026,1,5000);
    await pinOficial(pid,2026,1,3000);
    const {status,data} = await getMeta(pid);
    check('GET 200', status===200, data);
    const jan=mesOf(data,1), fev=mesOf(data,2), mar=mesOf(data,3), abr=mesOf(data,4);
    check('jan: pinadaMedicao=true E pinadoOficial=true (coexistência)', jan?.pinadaMedicao===true && jan?.pinadoOficial===true, jan);
    check('jan: oficial=3000.00 (pino)', jan?.oficialAlocado==='3000.00', jan?.oficialAlocado);
    check('fev: oficial=15857.14 (∝ base 15000)', fev?.oficialAlocado==='15857.14', fev?.oficialAlocado);
    check('mar: oficial=10571.43 (∝ base 10000)', mar?.oficialAlocado==='10571.43', mar?.oficialAlocado);
    check('abr: oficial=10571.43 (absorveu resíduo)', abr?.oficialAlocado==='10571.43', abr?.oficialAlocado);
    check('fev/mar/abr ajustadoOficial=true', fev?.ajustadoOficial && mar?.ajustadoOficial && abr?.ajustadoOficial, {fev:fev?.ajustadoOficial,mar:mar?.ajustadoOficial,abr:abr?.ajustadoOficial});
    check('jan ajustadoOficial=false (pinado, intocável)', jan?.ajustadoOficial===false, jan?.ajustadoOficial);
    check('soma(oficial) = 40000.00 EXATO', somaExata(data.meses,'oficialAlocado')==='40000.00', somaExata(data.meses,'oficialAlocado'));
    check('metaHT jan=2000.00 (medicao-oficial)', jan?.metaHT==='2000.00', jan?.metaHT);
    check('metaHT fev=9142.86 (25000-15857.14)', fev?.metaHT==='9142.86', fev?.metaHT);
    console.log();
  }

  // ════════════════════════════════════════════════════════════════════════
  // TESTE 2: FALLBACK — todos os editáveis com oficial-base zero → divisão igual
  // Estratégia 'inicial', valorOficial=20000, medição uniforme 20000 →
  //   base 'inicial' = [20000,0,0,0] (guloso consome tudo em jan).
  // Pin oficial jan=8000 → editáveis fev,mar,abr têm base 0 (proporção impossível)
  //   → divisão IGUAL do saldo 12000: 4000/4000/4000. soma=20000 EXATO.
  // ════════════════════════════════════════════════════════════════════════
  console.log('── Teste 2: fallback (base editável zero → divisão igual) ─');
  {
    const pid = await criarProjeto('FALLBACK',{valorOficial:20000,estrategiaOficial:'inicial'});
    await pinOficial(pid,2026,1,8000);
    const {status,data} = await getMeta(pid);
    check('GET 200', status===200, data);
    check('estrategiaOficial=inicial', data.resumo.estrategiaOficial==='inicial', data.resumo.estrategiaOficial);
    const jan=mesOf(data,1), fev=mesOf(data,2), mar=mesOf(data,3), abr=mesOf(data,4);
    check('jan: oficial=8000.00 (pino)', jan?.oficialAlocado==='8000.00', jan?.oficialAlocado);
    check('fev=4000.00 (igual)', fev?.oficialAlocado==='4000.00', fev?.oficialAlocado);
    check('mar=4000.00 (igual)', mar?.oficialAlocado==='4000.00', mar?.oficialAlocado);
    check('abr=4000.00 (igual)', abr?.oficialAlocado==='4000.00', abr?.oficialAlocado);
    check('soma(oficial)=20000.00 EXATO', somaExata(data.meses,'oficialAlocado')==='20000.00', somaExata(data.meses,'oficialAlocado'));
    console.log();
  }

  // ════════════════════════════════════════════════════════════════════════
  // TESTE 3: TETO + TRANSBORDO — redistribuição que passaria da medição capa e
  //   transborda pro próximo editável. Medição pin fev=8000 →
  //   medicoes [24000,8000,24000,24000]; oficial-base [10000,8000,12000,10000].
  // Pin oficial jan=2000 → editáveis fev,mar,abr (base 8000,12000,10000; tot 30000):
  //   saldo=38000; proporcional: fev=10133.33, mar=15200.00, abr(last)=12666.67
  //   transbordo: fev capa em 8000 (carry 2133.33) → mar=15200+2133.33=17333.33;
  //   abr=12666.67. soma editáveis=38000; soma total oficial=40000 EXATO.
  //   metaHT fev=0 (oficial cobriu a medição). mar=24000-17333.33=6666.67 (parcial).
  // ════════════════════════════════════════════════════════════════════════
  console.log('── Teste 3: teto + transbordo (capa na medição) ──────────');
  {
    const pid = await criarProjeto('TETO');
    await pinMedicao(pid,2026,2,8000);
    await pinOficial(pid,2026,1,2000);
    const {status,data} = await getMeta(pid);
    check('GET 200', status===200, data);
    const jan=mesOf(data,1), fev=mesOf(data,2), mar=mesOf(data,3), abr=mesOf(data,4);
    check('jan: oficial=2000.00 (pino)', jan?.oficialAlocado==='2000.00', jan?.oficialAlocado);
    check('fev: oficial=8000.00 (CAPADO na medição 8000)', fev?.oficialAlocado==='8000.00', fev?.oficialAlocado);
    check('fev: metaHT=0.00 (oficial cobriu a medição)', fev?.metaHT==='0.00', fev?.metaHT);
    check('mar: oficial=17333.33 (absorveu transbordo 2133.33)', mar?.oficialAlocado==='17333.33', mar?.oficialAlocado);
    check('mar: metaHT=6666.67 (24000-17333.33, parcial)', mar?.metaHT==='6666.67', mar?.metaHT);
    check('abr: oficial=12666.67', abr?.oficialAlocado==='12666.67', abr?.oficialAlocado);
    check('soma(oficial)=40000.00 EXATO', somaExata(data.meses,'oficialAlocado')==='40000.00', somaExata(data.meses,'oficialAlocado'));
    console.log();
  }

  // ════════════════════════════════════════════════════════════════════════
  // TESTE 4: RECALCULO da META HT — oficial cobre a medição → metaHT=0;
  //   cobre parcial → metaHT = diferença. valorOficial=40000, medição uniforme
  //   20000, base 10000. Pin oficial jan=20000 (cobre a medição de jan):
  //   editáveis fev,mar,abr saldo=20000 igual → 6666.67/6666.67/6666.66.
  //   metaHT jan=0 (coberto); fev=20000-6666.67=13333.33 (parcial).
  // ════════════════════════════════════════════════════════════════════════
  console.log('── Teste 4: recálculo da meta (oficial cobre → metaHT 0) ─');
  {
    const pid = await criarProjeto('METARECALC');
    await pinOficial(pid,2026,1,20000);
    const {status,data} = await getMeta(pid);
    check('GET 200', status===200, data);
    const jan=mesOf(data,1), fev=mesOf(data,2);
    check('jan: oficial=20000.00 (cobre a medição)', jan?.oficialAlocado==='20000.00', jan?.oficialAlocado);
    check('jan: metaHT=0.00 (oficial cobriu a medição)', jan?.metaHT==='0.00', jan?.metaHT);
    check('fev: metaHT=13333.33 (20000-6666.67, parcial)', fev?.metaHT==='13333.33', fev?.metaHT);
    check('soma(oficial)=40000.00 EXATO', somaExata(data.meses,'oficialAlocado')==='40000.00', somaExata(data.meses,'oficialAlocado'));
    console.log();
  }

  // ════════════════════════════════════════════════════════════════════════
  // TESTE 5: DESPINO → volta ao oficial-base (distribuição por estratégia).
  //   Pin oficial jan=20000 (move os outros), despina → base uniforme 10000.
  // ════════════════════════════════════════════════════════════════════════
  console.log('── Teste 5: despino → volta ao oficial-base ──────────────');
  {
    const pid = await criarProjeto('DESPINO');
    await pinOficial(pid,2026,1,20000);
    const {data:comPino} = await getMeta(pid);
    check('com pino: jan oficial=20000.00', mesOf(comPino,1)?.oficialAlocado==='20000.00', mesOf(comPino,1)?.oficialAlocado);
    check('com pino: fev movido (≠10000)', mesOf(comPino,2)?.oficialAlocado!=='10000.00', mesOf(comPino,2)?.oficialAlocado);
    await unpinOficial(pid,2026,1);
    const {data:semPino} = await getMeta(pid);
    const meses = [1,2,3,4].map(m=>mesOf(semPino,m));
    check('sem pino: todos oficial=10000.00 (base)', meses.every(m=>m?.oficialAlocado==='10000.00'), meses.map(m=>m?.oficialAlocado));
    check('sem pino: nenhum pinadoOficial', meses.every(m=>m?.pinadoOficial===false), null);
    check('sem pino: nenhum ajustadoOficial', meses.every(m=>m?.ajustadoOficial===false), null);
    check('sem pino: soma(oficial)=40000.00 EXATO', somaExata(semPino.meses,'oficialAlocado')==='40000.00', null);
    console.log();
  }

  // ════════════════════════════════════════════════════════════════════════
  // TESTE 6: COEXISTÊNCIA dos TRÊS pinos no mesmo mês (meta+medição+oficial).
  //   Medição pin jan=10000 → medicoes [10000,23333.33,23333.33,23333.34];
  //   oficial-base 10000 cada. Pin oficial jan=6000; pin meta jan=3000.
  //   jan honra os três: medicao=10000, oficial=6000, metaHT=3000 (pino de meta).
  //   soma(oficial)=40000 EXATO; soma(metaHT)=40000 EXATO (cascata da meta fecha).
  // ════════════════════════════════════════════════════════════════════════
  console.log('── Teste 6: coexistência dos três pinos no mesmo mês ─────');
  {
    const pid = await criarProjeto('TRESPINOS');
    await pinMedicao(pid,2026,1,10000);
    await pinOficial(pid,2026,1,6000);
    await pinMeta(pid,2026,1,3000);
    const {status,data} = await getMeta(pid);
    check('GET 200', status===200, data);
    const jan=mesOf(data,1);
    check('jan: pinado(meta)=true E pinadaMedicao=true E pinadoOficial=true', jan?.pinado===true && jan?.pinadaMedicao===true && jan?.pinadoOficial===true, jan);
    check('jan: medicao=10000.00 (pino de medição)', jan?.medicao==='10000.00', jan?.medicao);
    check('jan: oficial=6000.00 (pino de oficial)', jan?.oficialAlocado==='6000.00', jan?.oficialAlocado);
    check('jan: metaHT=3000.00 (pino de meta vence)', jan?.metaHT==='3000.00', jan?.metaHT);
    check('soma(oficial)=40000.00 EXATO', somaExata(data.meses,'oficialAlocado')==='40000.00', somaExata(data.meses,'oficialAlocado'));
    check('soma(metaHT)=40000.00 EXATO (valorHT)', somaExata(data.meses,'metaHT')==='40000.00', somaExata(data.meses,'metaHT'));
    console.log();
  }

  // ════════════════════════════════════════════════════════════════════════
  // TESTE 7: MÊS FECHADO no meio (MANDATÓRIO — cobre a correção do saldoEditavel).
  //   base 10000 cada. Pin oficial mar=15000 (mar aberto), FECHA mar, pin jan=16000.
  //   mar fica intocável com CARIMBO=15000 (o pino que ele efetivamente tem — NÃO
  //   o oficial-base 10000). saldoEditavel = 40000 - carimbo(jan=16000) -
  //   carimbo(mar=15000) = 9000 → fev,abr = 4500 cada.
  //   soma = 16000 + 4500 + 15000 + 4500 = 40000 EXATO, com um fechado no meio.
  //   Prova a correção: subtrair o CARIMBO (15000) — o mesmo valor que mar exibe —
  //   fecha o invariante. A fórmula bugada (subtrair o oficial-BASE 10000) daria
  //   45000, furando por 5000 (= carimbo − base).
  // ════════════════════════════════════════════════════════════════════════
  console.log('── Teste 7: mês FECHADO no meio (correção do saldoEditavel) ─');
  {
    const pid = await criarProjeto('FECHADO');
    await pinOficial(pid,2026,3,15000);                       // pino no mar (ainda aberto)
    const {status:sF, data:dF} = await api('POST','/fechamentos',tAdm,{ano:2026,mes:3});
    if (sF!==201 && sF!==409) throw new Error(`Fechar mar: ${JSON.stringify(dF)}`);
    await pinOficial(pid,2026,1,16000);
    const {status,data} = await getMeta(pid);
    check('GET 200', status===200, data);
    const jan=mesOf(data,1), fev=mesOf(data,2), mar=mesOf(data,3), abr=mesOf(data,4);
    check('mar: fechado=true E pinadoOficial=true', mar?.fechado===true && mar?.pinadoOficial===true, mar);
    check('mar: oficial=15000.00 (CARIMBO — pino, não recomputado)', mar?.oficialAlocado==='15000.00', mar?.oficialAlocado);
    check('mar: ajustadoOficial=false (intocável)', mar?.ajustadoOficial===false, mar?.ajustadoOficial);
    check('jan: oficial=16000.00 (pino)', jan?.oficialAlocado==='16000.00', jan?.oficialAlocado);
    check('fev: oficial=4500.00 (editável, saldo 9000/2)', fev?.oficialAlocado==='4500.00', fev?.oficialAlocado);
    check('abr: oficial=4500.00 (editável)', abr?.oficialAlocado==='4500.00', abr?.oficialAlocado);
    check('soma(oficial)=40000.00 EXATO (com fechado no meio)', somaExata(data.meses,'oficialAlocado')==='40000.00', somaExata(data.meses,'oficialAlocado'));
    // Reabre mar/2026 para não bloquear nada depois
    await api('DELETE','/fechamentos/2026/3',tAdm);
    console.log();
  }

  // ════════════════════════════════════════════════════════════════════════
  // TESTE 8: ESTOURO — pinos de oficial somam acima do valorOficial.
  //   Pin jan=25000, fev=25000 (soma 50000 > 40000). Editáveis mar,abr → 0
  //   (oficial nunca negativo); aviso sinaliza. Invariante não é forçável (espelha
  //   a medição): o aviso É o sinal do estado inválido.
  // ════════════════════════════════════════════════════════════════════════
  console.log('── Teste 8: estouro (pinos de oficial > valorOficial) ────');
  {
    const pid = await criarProjeto('ESTOURO');
    await pinOficial(pid,2026,1,25000);
    await pinOficial(pid,2026,2,25000);
    const {status,data} = await getMeta(pid);
    check('GET 200', status===200, data);
    check('avisoEstouroOficial presente', 'avisoEstouroOficial' in data.resumo, data.resumo);
    check('aviso menciona R$ 10000.00 acima', typeof data.resumo.avisoEstouroOficial==='string' && data.resumo.avisoEstouroOficial.includes('10000.00'), data.resumo.avisoEstouroOficial);
    const jan=mesOf(data,1), fev=mesOf(data,2), mar=mesOf(data,3), abr=mesOf(data,4);
    check('jan: oficial=25000.00 (pino)', jan?.oficialAlocado==='25000.00', jan?.oficialAlocado);
    check('fev: oficial=25000.00 (pino)', fev?.oficialAlocado==='25000.00', fev?.oficialAlocado);
    check('mar: oficial=0.00 (editável zerado, nunca negativo)', mar?.oficialAlocado==='0.00', mar?.oficialAlocado);
    check('abr: oficial=0.00 (editável zerado, nunca negativo)', abr?.oficialAlocado==='0.00', abr?.oficialAlocado);
    console.log();
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  console.log('── Cleanup ───────────────────────────────────────────────');
  await api('DELETE','/fechamentos/2026/3',tAdm).catch(()=>{}); // defensivo (T7)
  await prisma.oficialMensalAjuste.deleteMany({ where:{ projetoId:{ in:projsCriados } } });
  await prisma.medicaoMensalAjuste.deleteMany({ where:{ projetoId:{ in:projsCriados } } });
  await prisma.metaMensalAjuste.deleteMany({ where:{ projetoId:{ in:projsCriados } } });
  await prisma.alocacao.deleteMany({ where:{ projetoId:{ in:projsCriados } } });
  await prisma.microEntrega.deleteMany({ where:{ macroEntrega:{ projetoId:{ in:projsCriados } } } });
  await prisma.macroEntrega.deleteMany({ where:{ projetoId:{ in:projsCriados } } });
  await prisma.projeto.deleteMany({ where:{ id:{ in:projsCriados } } });
  await prisma.colaborador.deleteMany({ where:{ id:{ in:colabsCriados } } });
  console.log(`  ${projsCriados.length} projeto(s) removidos.\n`);

  console.log('══════════════════════════════════════════════════════════');
  console.log(`  TOTAL: ${pass+fail} | ✅ ${pass} | ❌ ${fail}`);
  if (fail>0) process.exit(1);
}

main().catch(e=>{console.error(e);process.exit(1);}).finally(()=>prisma.$disconnect());
