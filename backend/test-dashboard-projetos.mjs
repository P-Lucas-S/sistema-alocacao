// Teste do endpoint GET /api/dashboards/projetos (fase D1).
// Rode com: node test-dashboard-projetos.mjs
// Pressupõe backend de pé em http://localhost:3001 com o seed padrão carregado.
//
// Usa um mês ISOLADO (2031/02, diferente do 2030/01 usado por
// test-priorizacao.mjs) pra controlar tamanhoEquipe/custoPlanejado com
// precisão, sem depender de alocações reais do seed.

import { PrismaClient } from '@prisma/client';

const BASE = 'http://localhost:3001/api';
const STAMP = Date.now();
const ANO = 2031, MES = 2;
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

const projetosCriados = [];
const colaboradoresCriados = [];

async function criarColaborador(token, sufixo, { valorHora, profissaoId, tarifas }) {
  const { status, data } = await api('POST', '/colaboradores', token, {
    nome: `Dash Teste ${sufixo} ${STAMP}`,
    email: `dash.teste.${sufixo}.${STAMP}@teste.dev`.toLowerCase(),
    valorHora, profissaoId, tarifas, confirmarSimilar: true,
  });
  if (status !== 201) throw new Error(`Falha ao criar colaborador ${sufixo}: ${JSON.stringify(data)}`);
  colaboradoresCriados.push(data.colaborador.id);
  return data.colaborador.id;
}

async function criarProjeto(token, sufixo, { categoriaId, dataPrestacao }) {
  const codigo = `DASHTESTE-${sufixo}-${STAMP}`;
  const { status, data } = await api('POST', '/projetos', token, {
    codigo, nome: `Dashboard Teste ${sufixo}`,
    prestacoesContas: [dataPrestacao], categoriaId,
  });
  if (status !== 201) throw new Error(`Falha ao criar projeto ${codigo}: ${JSON.stringify(data)}`);
  projetosCriados.push(data.id);

  const macroRes = await api('POST', `/projetos/${data.id}/macros`, token, { nome: 'Macro' });
  const macroId = macroRes.data.id;
  const microId = macroRes.data.microEntregas.find(m => m.nome === 'Geral').id;

  return { id: data.id, codigo, macroId, microId };
}

async function alocar(token, { colaboradorId, projeto, horas }) {
  const { status, data } = await api('POST', '/alocacoes', token, {
    colaboradorId, projetoId: projeto.id, macroEntregaId: projeto.macroId, microEntregaId: projeto.microId,
    ano: ANO, mes: MES, horasPlanejadas: horas,
  });
  if (status !== 201) throw new Error(`Falha ao alocar: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  console.log('── Login ──────────────────────────────────────────');
  const tokenGestor1 = await login('gestor1@sistema.dev', 'gestor123');
  const tokenGestor3 = await login('gestor3@sistema.dev', 'gestor123');
  const tokenAdmin   = await login('admin@sistema.dev', 'admin123');
  console.log('Tokens obtidos.\n');

  const { data: categorias } = await api('GET', '/categorias?ativo=true', tokenAdmin);
  const categoriaId = categorias[0].id;
  const { data: profissoes } = await api('GET', '/profissoes?ativo=true', tokenAdmin);
  const profissaoId = profissoes[0].id;

  console.log('── Setup: colaboradores de teste ──────────────────');
  // colabA: padrão 100/h, sem override.
  const colabA = await criarColaborador(tokenAdmin, 'A', { valorHora: 100, profissaoId });
  // colabB: padrão 80/h, MAS com override de 150/h pra esta categoria —
  // prova que o dashboard resolve a tarifa de EXCEÇÃO, não a padrão.
  const colabB = await criarColaborador(tokenAdmin, 'B', { valorHora: 80, profissaoId, tarifas: [{ categoriaId, valorHora: 150 }] });
  // colabC: padrão 50/h, sem override.
  const colabC = await criarColaborador(tokenAdmin, 'C', { valorHora: 50, profissaoId });
  console.log(`Colaboradores criados: ${colaboradoresCriados.length}\n`);

  console.log('── Setup: projetos de teste (mês isolado 2031/02) ──');
  const projEquipe = await criarProjeto(tokenGestor1, 'EQUIPE', { categoriaId, dataPrestacao: addDays(10) });
  await alocar(tokenGestor1, { colaboradorId: colabA, projeto: projEquipe, horas: 50 });
  await alocar(tokenGestor1, { colaboradorId: colabB, projeto: projEquipe, horas: 30 });
  await alocar(tokenGestor1, { colaboradorId: colabC, projeto: projEquipe, horas: 20 });
  // custo esperado: 50x100 (padrão) + 30x150 (override) + 20x50 (padrão) = 5000+4500+1000 = 10500.00
  // equipe esperada: 3

  const projSolo = await criarProjeto(tokenGestor1, 'SOLO', { categoriaId, dataPrestacao: addDays(20) });
  await alocar(tokenGestor1, { colaboradorId: colabA, projeto: projSolo, horas: 10 });
  // custo esperado: 10x100 = 1000.00; equipe esperada: 1

  const projGestor3 = await criarProjeto(tokenGestor3, 'GESTOR3', { categoriaId, dataPrestacao: addDays(20) });
  await alocar(tokenGestor3, { colaboradorId: colabA, projeto: projGestor3, horas: 5 });
  console.log(`Setup ok — ${projetosCriados.length} projetos criados.\n`);

  console.log('── GET /dashboards/projetos como gestor1 ────────────');
  const { status, data: raw } = await api('GET', `/dashboards/projetos?ano=${ANO}&mes=${MES}`, tokenGestor1);
  check('Status 200', status === 200, { status, raw });
  check('Shape: tem itens + pausados + totalPausados', Array.isArray(raw?.itens) && Array.isArray(raw?.pausados) && typeof raw?.totalPausados === 'number', raw);

  const data = raw.itens;
  const porCodigo = codigo => data.find(p => p.codigo === codigo);

  console.log('\n── Campos do P1 preservados ──────────────────────────');
  {
    const eq = porCodigo(projEquipe.codigo);
    check('Tem projetoId/codigo/nome', !!(eq?.projetoId && eq?.codigo && eq?.nome), eq);
    check('Tem categoria (string)', typeof eq?.categoria === 'string', eq);
    check('Tem proximaPrestacao', 'proximaPrestacao' in (eq ?? {}), eq);
    check('Tem diasAteVencimento', 'diasAteVencimento' in (eq ?? {}), eq);
    check('Tem horasPendentes (string)', typeof eq?.horasPendentes === 'string', eq);
    check('Tem porque (string)', typeof eq?.porque === 'string', eq);
    check('Tem sinalCapacidade (boolean)', typeof eq?.sinalCapacidade === 'boolean', eq);
    check('Tem ordem (number)', typeof eq?.ordem === 'number', eq);
  }

  console.log('\n── tamanhoEquipe (zero query nova — .size do colabsPorProjeto) ──');
  {
    const eq = porCodigo(projEquipe.codigo);
    check('Projeto com 3 colaboradores → tamanhoEquipe 3', eq?.tamanhoEquipe === 3, eq);
    const solo = porCodigo(projSolo.codigo);
    check('Projeto com 1 colaborador → tamanhoEquipe 1', solo?.tamanhoEquipe === 1, solo);
  }

  console.log('\n── custoPlanejado (reusa lib/tarifa.ts — inclui override) ──');
  {
    const eq = porCodigo(projEquipe.codigo);
    check(
      'EQUIPE: custoPlanejado = 10500.00 (50x100 padrão + 30x150 override + 20x50 padrão)',
      eq?.custoPlanejado === '10500.00',
      eq,
    );
    const solo = porCodigo(projSolo.codigo);
    check('SOLO: custoPlanejado = 1000.00 (10x100 padrão, sem override)', solo?.custoPlanejado === '1000.00', solo);
  }

  console.log('\n── Ordem preservada — igual à do /priorizacao ───────');
  {
    const { data: priorizaRaw } = await api('GET', `/priorizacao?ano=${ANO}&mes=${MES}`, tokenGestor1);
    const prioriza             = priorizaRaw.itens;
    const ordemDashboard   = data.filter(p => p.codigo.startsWith('DASHTESTE')).map(p => p.codigo);
    const ordemPriorizacao = prioriza.filter(p => p.codigo.startsWith('DASHTESTE')).map(p => p.codigo);
    check(
      'Mesma ordem relativa entre dashboard e /priorizacao',
      JSON.stringify(ordemDashboard) === JSON.stringify(ordemPriorizacao),
      { dashboard: ordemDashboard, priorizacao: ordemPriorizacao },
    );
  }

  console.log('\n── Escopo por papel (preservado do calcularPriorizacao) ──');
  {
    check('gestor1 NÃO vê o projeto do gestor3', !porCodigo(projGestor3.codigo), data.map(p => p.codigo));

    const { data: rawAdmin } = await api('GET', `/dashboards/projetos?ano=${ANO}&mes=${MES}`, tokenAdmin);
    const dataAdmin = rawAdmin.itens;
    const temGestor3 = dataAdmin.some(p => p.codigo === projGestor3.codigo);
    check('admin VÊ o projeto do gestor3', temGestor3, dataAdmin.map(p => p.codigo).filter(c => c.includes('DASHTESTE')));
    const dashtesteAdmin   = dataAdmin.filter(p => p.codigo.includes('DASHTESTE')).length;
    const dashtesteGestor1 = data.filter(p => p.codigo.includes('DASHTESTE')).length;
    check('admin vê MAIS projetos DASHTESTE que gestor1 (inclui o do gestor3)', dashtesteAdmin > dashtesteGestor1, {
      admin: dashtesteAdmin, gestor1: dashtesteGestor1,
    });
  }

  // ── headcountAlocado = UNION (mês 2031/03, isolado) ───────────────────────
  // colabHC: 120h proj1 + 90h proj2 = 210h ≥ 209h (95% × 220) → sobrecarregado
  // colabLeve: 20h proj1 → não sobrecarregado
  // tamanhoEquipe: proj1=2, proj2=1 → soma=3 (colabHC conta 2×)
  // headcountAlocado deve = 2 (union), emSobrecarga deve = 1
  const ANO_HC = 2031, MES_HC = 3;
  console.log('\n── headcountAlocado = UNION dos colabs (não soma) ───────');
  {
    const colabHC   = await criarColaborador(tokenAdmin, 'HC',   { valorHora: 50, profissaoId });
    const colabLeve = await criarColaborador(tokenAdmin, 'LEVE', { valorHora: 50, profissaoId });
    const projHC1   = await criarProjeto(tokenGestor1, 'HC1', { categoriaId, dataPrestacao: addDays(20) });
    const projHC2   = await criarProjeto(tokenGestor1, 'HC2', { categoriaId, dataPrestacao: addDays(30) });

    await api('POST', '/alocacoes', tokenGestor1, {
      colaboradorId: colabHC, projetoId: projHC1.id, macroEntregaId: projHC1.macroId,
      microEntregaId: projHC1.microId, ano: ANO_HC, mes: MES_HC, horasPlanejadas: 120,
    });
    await api('POST', '/alocacoes', tokenGestor1, {
      colaboradorId: colabHC, projetoId: projHC2.id, macroEntregaId: projHC2.macroId,
      microEntregaId: projHC2.microId, ano: ANO_HC, mes: MES_HC, horasPlanejadas: 90,
    });
    await api('POST', '/alocacoes', tokenGestor1, {
      colaboradorId: colabLeve, projetoId: projHC1.id, macroEntregaId: projHC1.macroId,
      microEntregaId: projHC1.microId, ano: ANO_HC, mes: MES_HC, horasPlanejadas: 20,
    });

    const { data: hcRaw } = await api('GET', `/dashboards/projetos?ano=${ANO_HC}&mes=${MES_HC}`, tokenGestor1);
    const hcItens = hcRaw?.itens ?? [];
    const hc1 = hcItens.find(p => p.codigo === projHC1.codigo);
    const hc2 = hcItens.find(p => p.codigo === projHC2.codigo);

    const somaEquipes = (hc1?.tamanhoEquipe ?? 0) + (hc2?.tamanhoEquipe ?? 0);
    check('projHC1: tamanhoEquipe=2', hc1?.tamanhoEquipe === 2, hc1?.tamanhoEquipe);
    check('projHC2: tamanhoEquipe=1', hc2?.tamanhoEquipe === 1, hc2?.tamanhoEquipe);
    check('Soma tamanhoEquipe = 3 (inflada, colabHC contado 2x)', somaEquipes === 3, somaEquipes);
    check(
      'headcountAlocado = 2 (union, não 3; colabHC conta 1x apesar de 2 projetos)',
      hcRaw?.headcountAlocado === 2,
      { headcountAlocado: hcRaw?.headcountAlocado, somaInflada: somaEquipes },
    );
    check(
      'emSobrecarga = 1 (só colabHC com 210h ≥ 209h; colabLeve com 20h não conta)',
      hcRaw?.emSobrecarga === 1,
      { emSobrecarga: hcRaw?.emSobrecarga },
    );
    check('headcountAlocado é number no response', typeof hcRaw?.headcountAlocado === 'number', hcRaw?.headcountAlocado);
    check('emSobrecarga é number no response',     typeof hcRaw?.emSobrecarga     === 'number', hcRaw?.emSobrecarga);
  }

  // ── Limpeza ────────────────────────────────────────────────────────────────
  console.log('\n── Limpeza ──────────────────────────────────────────');
  try {
    await prisma.alocacao.deleteMany({ where: { projetoId: { in: projetosCriados } } });
    await prisma.microEntrega.deleteMany({ where: { macroEntrega: { projetoId: { in: projetosCriados } } } });
    await prisma.macroEntrega.deleteMany({ where: { projetoId: { in: projetosCriados } } });
    await prisma.prestacaoContas.deleteMany({ where: { projetoId: { in: projetosCriados } } });
    await prisma.projeto.deleteMany({ where: { id: { in: projetosCriados } } });
    await prisma.tarifaColaborador.deleteMany({ where: { colaboradorId: { in: colaboradoresCriados } } });
    await prisma.colaborador.deleteMany({ where: { id: { in: colaboradoresCriados } } });
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
