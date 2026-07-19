// Teste do endpoint GET /api/priorizacao (fase P1).
// Rode com: node test-priorizacao.mjs
// Pressupõe backend de pé em http://localhost:3001 com o seed padrão carregado.
//
// Usa um mês ISOLADO (2030/01, sem nenhuma alocação do seed) pra controlar
// horasPendentes/sinalCapacidade com precisão. A CATEGORIA de prazo depende
// só da data de hoje vs. a prestação do projeto (não do ano/mês da query) —
// por isso os projetos REAIS do seed também aparecem na resposta (categoria
// 'baixa', horasPendentes=0 nesse mês vazio); os testes filtram pelo prefixo
// PRIORTESTE pra não depender disso.

import { PrismaClient } from '@prisma/client';

const BASE = 'http://localhost:3001/api';
const STAMP = Date.now();
const ANO = 2030, MES = 1; // mês isolado, sem nenhuma alocação do seed
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;

function check(label, condition, extra) {
  if (condition) {
    console.log(`✅ ${label}`);
    pass++;
  } else {
    console.log(`❌ ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`);
    fail++;
  }
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

const projetosCriados = []; // ids, pra limpeza no fim

async function criarProjetoComAlocacao(token, sufixo, { dataPrestacao, categoriaId, colaboradorId, planejado, realizado }) {
  const codigo = `PRIORTESTE-${sufixo}-${STAMP}`;
  const { status, data: proj } = await api('POST', '/projetos', token, {
    codigo, nome: `Priorização Teste ${sufixo}`,
    prestacoesContas: [dataPrestacao], categoriaId,
  });
  if (status !== 201) throw new Error(`Falha ao criar projeto ${codigo}: ${JSON.stringify(proj)}`);
  projetosCriados.push(proj.id);

  const macroRes = await api('POST', `/projetos/${proj.id}/macros`, token, { nome: 'Macro' });
  const macroId = macroRes.data.id;
  const microId = macroRes.data.microEntregas.find(m => m.nome === 'Geral').id;

  let alocacaoId = null;
  if (colaboradorId && planejado != null) {
    const alocRes = await api('POST', '/alocacoes', token, {
      colaboradorId, projetoId: proj.id, macroEntregaId: macroId, microEntregaId: microId,
      ano: ANO, mes: MES, horasPlanejadas: planejado,
    });
    if (alocRes.status !== 201) throw new Error(`Falha ao alocar em ${codigo}: ${JSON.stringify(alocRes.data)}`);
    alocacaoId = alocRes.data.alocacao.id;
    if (realizado != null) {
      await api('PATCH', `/alocacoes/${alocacaoId}/realizado`, token, { horasRealizadas: realizado });
    }
  }

  return { id: proj.id, codigo };
}

async function main() {
  console.log('── Login ──────────────────────────────────────────');
  const tokenGestor1 = await login('gestor1@sistema.dev', 'gestor123');
  const tokenGestor3 = await login('gestor3@sistema.dev', 'gestor123');
  const tokenAdmin   = await login('admin@sistema.dev', 'admin123');
  const tokenCoord   = await login('coord@sistema.dev', 'coord123');
  console.log('Tokens obtidos.\n');

  const { data: categorias } = await api('GET', '/categorias?ativo=true', tokenGestor1);
  const categoriaId = categorias[0].id;
  const { data: colaboradores } = await api('GET', '/colaboradores?ativo=true', tokenGestor1);
  const colab = i => colaboradores[i].id;

  console.log('── Setup: projetos de teste (mês isolado 2030/01) ──');
  const altaVencida = await criarProjetoComAlocacao(tokenGestor1, 'ALTA-VENCIDA', {
    dataPrestacao: addDays(-5), categoriaId, colaboradorId: colab(0), planejado: 200,
  });
  const altaA = await criarProjetoComAlocacao(tokenGestor1, 'ALTA-A', {
    dataPrestacao: addDays(2), categoriaId, colaboradorId: colab(1), planejado: 100, realizado: 20,
  });
  const altaB = await criarProjetoComAlocacao(tokenGestor1, 'ALTA-B', {
    dataPrestacao: addDays(5), categoriaId, colaboradorId: colab(2), planejado: 50,
  });
  const media = await criarProjetoComAlocacao(tokenGestor1, 'MEDIA', {
    dataPrestacao: addDays(15), categoriaId, colaboradorId: colab(3), planejado: 30,
  });
  const baixa = await criarProjetoComAlocacao(tokenGestor1, 'BAIXA', {
    dataPrestacao: addDays(60), categoriaId, colaboradorId: colab(4), planejado: 10,
  });
  const semPrazo = await criarProjetoComAlocacao(tokenGestor1, 'SEMPRAZO', {
    dataPrestacao: addDays(90), categoriaId, colaboradorId: colab(5), planejado: 5,
  });
  // Remove a prestação pra simular "sem prestação cadastrada" (API exige >=1 na criação)
  await prisma.prestacaoContas.deleteMany({ where: { projetoId: semPrazo.id } });

  const capacidadeTrue = await criarProjetoComAlocacao(tokenGestor1, 'CAPACIDADE-TRUE', {
    dataPrestacao: addDays(60), categoriaId, colaboradorId: colab(6), planejado: 215, // >= 95% de 220
  });
  const capacidadeFalse = await criarProjetoComAlocacao(tokenGestor1, 'CAPACIDADE-FALSE', {
    dataPrestacao: addDays(60), categoriaId, colaboradorId: colab(7), planejado: 10,
  });
  const gestor3Proj = await criarProjetoComAlocacao(tokenGestor3, 'GESTOR3', {
    dataPrestacao: addDays(60), categoriaId, colaboradorId: colab(8), planejado: 8,
  });
  console.log(`Setup ok — ${projetosCriados.length} projetos criados.\n`);

  console.log('── GET /priorizacao como gestor1 ────────────────────');
  const { status, data: dataGestor1 } = await api('GET', `/priorizacao?ano=${ANO}&mes=${MES}`, tokenGestor1);
  check('Status 200', status === 200, { status, dataGestor1 });
  check('Resposta tem itens + itensPausados + totalPausados', Array.isArray(dataGestor1?.itens) && Array.isArray(dataGestor1?.itensPausados), dataGestor1);

  const data = dataGestor1.itens;
  const porCodigo = codigo => data.find(p => p.codigo === codigo);

  console.log('\n── Categoria por faixa de prazo ─────────────────────');
  {
    const av = porCodigo(altaVencida.codigo);
    check('Vencida (-5 dias) → categoria alta', av?.categoria === 'alta', av);
    check('Vencida: "porquê" menciona "vencida"', av?.porque?.includes('vencida'), av?.porque);

    const aa = porCodigo(altaA.codigo);
    check('+2 dias → categoria alta', aa?.categoria === 'alta', aa);

    const ab = porCodigo(altaB.codigo);
    check('+5 dias → categoria alta', ab?.categoria === 'alta', ab);

    const m = porCodigo(media.codigo);
    check('+15 dias → categoria media', m?.categoria === 'media', m);
    check('Media: "porquê" diz "vence em 15 dias"', m?.porque === 'Prestação vence em 15 dias', m?.porque);

    const b = porCodigo(baixa.codigo);
    check('+60 dias → categoria baixa', b?.categoria === 'baixa', b);

    const sp = porCodigo(semPrazo.codigo);
    check('Sem prestação → categoria sem_prazo', sp?.categoria === 'sem_prazo', sp);
    check('Sem prazo: "porquê" certo', sp?.porque === 'Sem prestação de contas cadastrada', sp?.porque);
    check('Sem prazo: proximaPrestacao = null', sp?.proximaPrestacao === null, sp);
  }

  console.log('\n── horasPendentes = planejado - realizado ───────────');
  {
    const aa = porCodigo(altaA.codigo);
    check('ALTA-A: planejado 100, realizado 20 → pendente 80', aa?.horasPendentes === '80', aa);

    const ab = porCodigo(altaB.codigo);
    check('ALTA-B: sem realizado → pendente = planejado inteiro (50)', ab?.horasPendentes === '50', ab);

    const av = porCodigo(altaVencida.codigo);
    check('ALTA-VENCIDA: planejado 200, sem realizado → pendente 200', av?.horasPendentes === '200', av);
  }

  console.log('\n── Ordenação por horas pendentes DENTRO da categoria alta ──');
  {
    const av = porCodigo(altaVencida.codigo); // 200h
    const aa = porCodigo(altaA.codigo);        // 80h
    const ab = porCodigo(altaB.codigo);        // 50h
    check('ALTA-VENCIDA (200h) vem antes de ALTA-A (80h)', av.ordem < aa.ordem, { av: av.ordem, aa: aa.ordem });
    check('ALTA-A (80h) vem antes de ALTA-B (50h)', aa.ordem < ab.ordem, { aa: aa.ordem, ab: ab.ordem });
  }

  console.log('\n── Sinal de capacidade (>= 95% de 220h) ─────────────');
  {
    const ct = porCodigo(capacidadeTrue.codigo);
    check('215h num único colaborador → sinalCapacidade true', ct?.sinalCapacidade === true, ct);

    const cf = porCodigo(capacidadeFalse.codigo);
    check('10h → sinalCapacidade false', cf?.sinalCapacidade === false, cf);
  }

  console.log('\n── Ordem final: alta < media < baixa < sem_prazo ────');
  {
    const aa = porCodigo(altaA.codigo);
    const m  = porCodigo(media.codigo);
    const b  = porCodigo(baixa.codigo);
    const sp = porCodigo(semPrazo.codigo);
    check('alta antes de media', aa.ordem < m.ordem, { alta: aa.ordem, media: m.ordem });
    check('media antes de baixa', m.ordem < b.ordem, { media: m.ordem, baixa: b.ordem });
    check('baixa antes de sem_prazo', b.ordem < sp.ordem, { baixa: b.ordem, sem_prazo: sp.ordem });
  }

  console.log('\n── Escopo por papel ──────────────────────────────────');
  {
    check('gestor1 NÃO vê o projeto do gestor3', !porCodigo(gestor3Proj.codigo), data.map(p => p.codigo));

    const { data: dataAdminRaw } = await api('GET', `/priorizacao?ano=${ANO}&mes=${MES}`, tokenAdmin);
    const dataAdmin = dataAdminRaw.itens;
    const porCodigoAdmin = () => dataAdmin.find(p => p.codigo === gestor3Proj.codigo);
    check('admin VÊ o projeto do gestor3', !!porCodigoAdmin(), dataAdmin.map(p => p.codigo).filter(c => c.includes('PRIORTESTE')));
    check('admin vê MAIS projetos que gestor1 (escopo maior)', dataAdmin.length > data.length, { admin: dataAdmin.length, gestor1: data.length });
  }

  console.log('\n── Permissão: coordenação → 200 (papel de leitura) ──');
  {
    const { status } = await api('GET', `/priorizacao?ano=${ANO}&mes=${MES}`, tokenCoord);
    check('Coordenação → 200 (vê todos, igual admin)', status === 200, status);
  }

  // ── Limpeza ────────────────────────────────────────────────────────────────
  console.log('\n── Limpeza ──────────────────────────────────────────');
  try {
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

  console.log('\n──────────────────────────────────────────────────');
  console.log(`Resultado: ${pass} passou(aram), ${fail} falhou(aram).`);
  if (fail > 0) process.exit(1);
}

main().catch(err => {
  console.error('Erro fatal no teste:', err);
  process.exit(1);
});
