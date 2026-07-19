// Teste das rotas PATCH /api/priorizacao/:projetoId/{fixar,desfixar,pausar,despausar}
// e do comportamento de ordenação com fixado/pausado no GET /api/priorizacao.
// Rode com: node test-fixar-pausar.mjs
// Pressupõe backend de pé em http://localhost:3001 com seed padrão.

import { PrismaClient } from '@prisma/client';

const BASE   = 'http://localhost:3001/api';
const STAMP  = Date.now();
const ANO    = 2031;   // mês isolado sem alocações do seed
const MES    = 3;
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;

function check(label, condition, extra) {
  if (condition) { console.log(`✅ ${label}`); pass++; }
  else           { console.log(`❌ ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); fail++; }
}

function addDays(n) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Login falhou para ${email}: ${JSON.stringify(data)}`);
  return data.token;
}

async function api(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, data };
}

const projetosCriados = [];

async function criarProjeto(token, sufixo, { dataPrestacao, categoriaId, colaboradorId, planejado }) {
  const codigo = `FIXTEST-${sufixo}-${STAMP}`;
  const { status, data: proj } = await api('POST', '/projetos', token, {
    codigo, nome: `Fixar/Pausar Teste ${sufixo}`,
    prestacoesContas: [dataPrestacao], categoriaId,
  });
  if (status !== 201) throw new Error(`Falha ao criar ${codigo}: ${JSON.stringify(proj)}`);
  projetosCriados.push(proj.id);

  const macroRes = await api('POST', `/projetos/${proj.id}/macros`, token, { nome: 'Macro' });
  const macroId  = macroRes.data.id;
  const microId  = macroRes.data.microEntregas.find(m => m.nome === 'Geral').id;

  if (colaboradorId && planejado != null) {
    const alocRes = await api('POST', '/alocacoes', token, {
      colaboradorId, projetoId: proj.id, macroEntregaId: macroId, microEntregaId: microId,
      ano: ANO, mes: MES, horasPlanejadas: planejado,
    });
    if (alocRes.status !== 201) throw new Error(`Falha ao alocar em ${codigo}`);
  }

  return { id: proj.id, codigo };
}

async function getItens(token, gestorId) {
  const qs = gestorId ? `&gestorId=${gestorId}` : '';
  const { status, data } = await api('GET', `/priorizacao?ano=${ANO}&mes=${MES}${qs}`, token);
  if (status !== 200) throw new Error(`GET priorizacao falhou: ${status} ${JSON.stringify(data)}`);
  return { itens: data.itens, itensPausados: data.itensPausados, totalPausados: data.totalPausados };
}

async function main() {
  console.log('── Login ──────────────────────────────────────────────');
  const tokenGestor1  = await login('gestor1@sistema.dev',  'gestor123');
  const tokenGestor3  = await login('gestor3@sistema.dev',  'gestor123');
  const tokenAdmin    = await login('admin@sistema.dev',    'admin123');
  const tokenChefe    = await login('chefe@sistema.dev',    'chefe123');
  const tokenCoord    = await login('coord@sistema.dev',    'coord123');
  const tokenDiretor  = await login('diretor@sistema.dev',  'diretor123');

  const { data: cats }   = await api('GET', '/categorias?ativo=true',      tokenAdmin);
  const { data: colabs } = await api('GET', '/colaboradores?ativo=true',   tokenAdmin);
  const catId = cats[0].id;
  const cId   = i => colabs[i].id;

  console.log('\n── Setup: projetos de teste ───────────────────────────');
  // Dois projetos ALTA (do gestor1)
  const alta1 = await criarProjeto(tokenGestor1, 'ALTA1', { dataPrestacao: addDays(2), categoriaId: catId, colaboradorId: cId(0), planejado: 100 });
  const alta2 = await criarProjeto(tokenGestor1, 'ALTA2', { dataPrestacao: addDays(5), categoriaId: catId, colaboradorId: cId(1), planejado: 80  });

  // Dois projetos MEDIA (do gestor1)
  const media1 = await criarProjeto(tokenGestor1, 'MEDIA1', { dataPrestacao: addDays(15), categoriaId: catId, colaboradorId: cId(2), planejado: 60 });
  const media2 = await criarProjeto(tokenGestor1, 'MEDIA2', { dataPrestacao: addDays(20), categoriaId: catId, colaboradorId: cId(3), planejado: 40 });

  // Um projeto BAIXA (do gestor1)
  const baixa1 = await criarProjeto(tokenGestor1, 'BAIXA1', { dataPrestacao: addDays(60), categoriaId: catId, colaboradorId: cId(4), planejado: 20 });

  // Projeto de gestor3 (pra testar permissão)
  const gestor3Proj = await criarProjeto(tokenGestor3, 'GESTOR3', { dataPrestacao: addDays(10), categoriaId: catId, colaboradorId: cId(5), planejado: 30 });

  console.log(`Setup ok — ${projetosCriados.length} projetos criados.\n`);

  // ── 1. Estado inicial ────────────────────────────────────────────────────
  console.log('── 1. Estado inicial: fixado/pausado = false ──────────');
  {
    const { itens } = await getItens(tokenGestor1);
    const p = itens.find(i => i.projetoId === media1.id);
    check('Estado inicial: fixado = false', p?.fixado === false, p);
    check('Estado inicial: pausado = false', p?.pausado === false, p);
  }

  // ── 2. PATCH fixar — resposta ────────────────────────────────────────────
  console.log('\n── 2. PATCH fixar ──────────────────────────────────────');
  {
    const { status, data } = await api('PATCH', `/priorizacao/${media1.id}/fixar`, tokenGestor1);
    check('PATCH fixar → 200', status === 200, { status, data });
    check('PATCH fixar → ok: true', data?.ok === true, data);
    check('PATCH fixar → acao: fixar', data?.acao === 'fixar', data);
  }

  // ── 3. O TESTE QUE SEPARA (item 5 do briefing) ──────────────────────────
  // Media fixado deve ser o PRIMEIRO entre os Médios, mas ABAIXO de todos os Altas.
  console.log('\n── 3. O TESTE QUE SEPARA ─────────── ★ MAIS IMPORTANTE ★');
  {
    const { itens } = await getItens(tokenGestor1);
    const findItem = id => itens.find(i => i.projetoId === id);

    const iAlta1  = findItem(alta1.id);
    const iAlta2  = findItem(alta2.id);
    const iMedia1 = findItem(media1.id);  // este está fixado
    const iMedia2 = findItem(media2.id);
    const iBaixa1 = findItem(baixa1.id);

    check('Media1 (fixado) está na fila ativa (itens)', !!iMedia1, itens.map(i => i.projetoId));
    check('Media1 fixado: campo fixado=true na resposta', iMedia1?.fixado === true, iMedia1);

    // Garantir que altas ainda vencem media fixado
    const altas  = itens.filter(i => i.categoria === 'alta'  && projetosCriados.includes(i.projetoId));
    const medias = itens.filter(i => i.categoria === 'media' && projetosCriados.includes(i.projetoId));

    check('Media fixado vem ABAIXO de todos os Altas (ordem)',
      altas.every(a => a.ordem < iMedia1.ordem),
      { mediasOrdem: iMedia1?.ordem, altasOrdens: altas.map(a => a.ordem) },
    );

    check('Media1 fixado é o PRIMEIRO dos Médios',
      medias.every(m => m.projetoId === media1.id || m.ordem > iMedia1.ordem),
      { media1ordem: iMedia1?.ordem, media2ordem: iMedia2?.ordem },
    );

    // Sanidade: a hierarquia alta → media → baixa ainda vale
    if (altas.length > 0 && medias.length > 0 && iBaixa1) {
      const maxAltaOrdem  = Math.max(...altas.map(a => a.ordem));
      const minMediaOrdem = Math.min(...medias.map(m => m.ordem));
      check('Hierarquia alta→media→baixa intacta com fixado',
        maxAltaOrdem < minMediaOrdem && minMediaOrdem < iBaixa1.ordem,
        { maxAlta: maxAltaOrdem, minMedia: minMediaOrdem, baixa: iBaixa1.ordem },
      );
    }
  }

  // ── 4. Dois fixados na mesma categoria → horas pendentes desc ───────────
  console.log('\n── 4. Dois fixados na mesma categoria ──────────────────');
  {
    await api('PATCH', `/priorizacao/${media2.id}/fixar`, tokenGestor1);

    const { itens } = await getItens(tokenGestor1);
    const iMedia1 = itens.find(i => i.projetoId === media1.id);
    const iMedia2 = itens.find(i => i.projetoId === media2.id);

    // media1 tem 60h, media2 tem 40h → media1 deve vir primeiro
    check('Com dois fixados: maior horasPendentes vem primeiro (media1 60h < media2 40h)',
      iMedia1.ordem < iMedia2.ordem,
      { media1: { ordem: iMedia1.ordem, h: iMedia1.horasPendentes }, media2: { ordem: iMedia2.ordem, h: iMedia2.horasPendentes } },
    );

    // desfixar media2 para não interferir nos próximos testes
    await api('PATCH', `/priorizacao/${media2.id}/desfixar`, tokenGestor1);
  }

  // ── 5. PATCH desfixar ────────────────────────────────────────────────────
  console.log('\n── 5. PATCH desfixar ────────────────────────────────────');
  {
    const { status, data } = await api('PATCH', `/priorizacao/${media1.id}/desfixar`, tokenGestor1);
    check('PATCH desfixar → 200', status === 200, data);

    const { itens } = await getItens(tokenGestor1);
    const iMedia1 = itens.find(i => i.projetoId === media1.id);
    check('Após desfixar: fixado=false', iMedia1?.fixado === false, iMedia1);

    const medias = itens.filter(i => i.categoria === 'media' && projetosCriados.includes(i.projetoId));
    const iMedia2 = itens.find(i => i.projetoId === media2.id);
    // media1(60h) > media2(40h) → media1 ainda vem primeiro por horas pendentes
    check('Após desfixar: ordenação volta a ser por horas pendentes (media1 60h antes de media2 40h)',
      iMedia1.ordem < iMedia2.ordem,
      { media1: iMedia1.ordem, media2: iMedia2.ordem },
    );
  }

  // ── 6. PATCH pausar ───────────────────────────────────────────────────────
  console.log('\n── 6. PATCH pausar ──────────────────────────────────────');
  {
    const { status, data } = await api('PATCH', `/priorizacao/${baixa1.id}/pausar`, tokenGestor1);
    check('PATCH pausar → 200', status === 200, data);
    check('PATCH pausar → acao: pausar', data?.acao === 'pausar', data);

    const { itens, itensPausados, totalPausados } = await getItens(tokenGestor1);

    const naBaixaFila  = itens.find(i => i.projetoId === baixa1.id);
    const naPausadosSec = itensPausados.find(i => i.projetoId === baixa1.id);

    check('Pausado NÃO aparece em itens (fila principal)', !naBaixaFila, itens.map(i => i.projetoId));
    check('Pausado aparece em itensPausados', !!naPausadosSec, itensPausados);
    check('itensPausados.pausado = true', naPausadosSec?.pausado === true, naPausadosSec);
    check('totalPausados = 1', totalPausados === 1, totalPausados);
  }

  // ── 7. Pausado não conta na sua categoria ────────────────────────────────
  console.log('\n── 7. Pausado não conta na categoria ────────────────────');
  {
    const { itens } = await getItens(tokenGestor1);
    const baixas = itens.filter(i => i.categoria === 'baixa' && projetosCriados.includes(i.projetoId));
    check('Categoria baixa agora vazia na fila ativa (baixa1 está pausado)', baixas.length === 0, baixas);
  }

  // ── 8. Fixar clears pausar, pausar clears fixar ─────────────────────────
  console.log('\n── 8. Mutually exclusive: fixar↔pausar ──────────────────');
  {
    // Pausa media1
    await api('PATCH', `/priorizacao/${media1.id}/pausar`, tokenGestor1);
    // Agora fixa media1 — deve limpar pausar
    await api('PATCH', `/priorizacao/${media1.id}/fixar`, tokenGestor1);

    const { itens, itensPausados } = await getItens(tokenGestor1);
    const naFila    = itens.find(i => i.projetoId === media1.id);
    const naPausado = itensPausados.find(i => i.projetoId === media1.id);

    check('fixar limpou pausar: projeto voltou à fila (itens)', !!naFila, itens.map(i => i.projetoId));
    check('fixar limpou pausar: não está em itensPausados',    !naPausado, itensPausados.map(i => i.projetoId));
    check('fixar limpou pausar: fixado=true', naFila?.fixado === true, naFila);

    // Agora pausa media1 (que estava fixado) — deve limpar fixar
    await api('PATCH', `/priorizacao/${media1.id}/pausar`, tokenGestor1);

    const { itens: itens2, itensPausados: ip2 } = await getItens(tokenGestor1);
    const naPausado2 = ip2.find(i => i.projetoId === media1.id);

    check('pausar limpou fixar: fixado=false', naPausado2?.fixado === false, naPausado2);
    check('pausar limpou fixar: pausado=true', naPausado2?.pausado === true, naPausado2);

    // Restaurar: desfixar baixa1 (pausado) e despausar media1
    await api('PATCH', `/priorizacao/${baixa1.id}/despausar`,  tokenGestor1);
    await api('PATCH', `/priorizacao/${media1.id}/despausar`,  tokenGestor1);
  }

  // ── 9. PATCH despausar ────────────────────────────────────────────────────
  console.log('\n── 9. PATCH despausar ───────────────────────────────────');
  {
    // Pausa baixa1 novamente para testar despausar
    await api('PATCH', `/priorizacao/${baixa1.id}/pausar`, tokenGestor1);
    const { status } = await api('PATCH', `/priorizacao/${baixa1.id}/despausar`, tokenGestor1);
    check('PATCH despausar → 200', status === 200, status);

    const { itens, totalPausados } = await getItens(tokenGestor1);
    const voltou = itens.find(i => i.projetoId === baixa1.id);
    check('Após despausar: projeto volta à fila', !!voltou, itens.map(i => i.projetoId));
    check('totalPausados = 0 após despausar todos', totalPausados === 0, totalPausados);
  }

  // ── 10. Permissões — gestor não pode alterar projeto de outro gestor ──────
  console.log('\n── 10. Permissões ────────────────────────────────────────');
  {
    // gestor1 tenta fixar projeto do gestor3
    const { status } = await api('PATCH', `/priorizacao/${gestor3Proj.id}/fixar`, tokenGestor1);
    check('Gestor não pode fixar projeto de outro gestor → 403', status === 403, status);
  }

  // ── 11. Chefe pode fixar qualquer projeto ────────────────────────────────
  {
    const { status } = await api('PATCH', `/priorizacao/${gestor3Proj.id}/fixar`, tokenChefe);
    check('Chefe pode fixar projeto de qualquer gestor → 200', status === 200, status);
    // desfixar para limpar
    await api('PATCH', `/priorizacao/${gestor3Proj.id}/desfixar`, tokenChefe);
  }

  // ── 12. Coordenação e Diretor → 403 ─────────────────────────────────────
  {
    const { status: sCoord }   = await api('PATCH', `/priorizacao/${media1.id}/fixar`, tokenCoord);
    const { status: sDiretor } = await api('PATCH', `/priorizacao/${media1.id}/fixar`, tokenDiretor);
    check('Coordenação → 403 no PATCH fixar', sCoord   === 403, sCoord);
    check('Diretor     → 403 no PATCH fixar', sDiretor === 403, sDiretor);
  }

  // ── 13. Log registrado para todas as ações ───────────────────────────────
  console.log('\n── 13. Log de ações ─────────────────────────────────────');
  {
    const logs = await prisma.prioridadeLog.findMany({
      where: { projetoId: { in: projetosCriados } },
      orderBy: { criadoEm: 'asc' },
    });

    const acoes = logs.map(l => l.acao);
    check('Log contém acao "fixar"',    acoes.includes('fixar'),    acoes);
    check('Log contém acao "desfixar"', acoes.includes('desfixar'), acoes);
    check('Log contém acao "pausar"',   acoes.includes('pausar'),   acoes);
    check('Log contém acao "despausar"',acoes.includes('despausar'),acoes);
    check('Todos os logs têm usuarioId preenchido', logs.every(l => !!l.usuarioId), logs.map(l => l.usuarioId));
    check('Todos os logs têm projetoId preenchido', logs.every(l => !!l.projetoId), logs.map(l => l.projetoId));
    console.log(`  (${logs.length} registros de log encontrados para os projetos de teste)`);
  }

  // ── Limpeza ───────────────────────────────────────────────────────────────
  console.log('\n── Limpeza ──────────────────────────────────────────────');
  try {
    await prisma.prioridadeLog.deleteMany({ where: { projetoId: { in: projetosCriados } } });
    await prisma.alocacao.deleteMany({ where: { projetoId: { in: projetosCriados } } });
    await prisma.microEntrega.deleteMany({ where: { macroEntrega: { projetoId: { in: projetosCriados } } } });
    await prisma.macroEntrega.deleteMany({ where: { projetoId: { in: projetosCriados } } });
    await prisma.prestacaoContas.deleteMany({ where: { projetoId: { in: projetosCriados } } });
    await prisma.projeto.deleteMany({ where: { id: { in: projetosCriados } } });
    console.log('Limpeza concluída.');
  } catch (err) {
    console.log(`Falha na limpeza: ${err.message}`);
  } finally {
    await prisma.$disconnect();
  }

  console.log('\n──────────────────────────────────────────────────────');
  console.log(`Resultado: ${pass} passou(aram), ${fail} falhou(aram).`);
  if (fail > 0) process.exit(1);
}

main().catch(err => {
  console.error('Erro fatal no teste:', err);
  process.exit(1);
});
