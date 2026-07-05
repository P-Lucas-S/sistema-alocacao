// test-posse-alocacao.mjs — matriz de ownership F0 (Posse na Escrita de Alocação)
// Rode com: node test-posse-alocacao.mjs
// Pressupõe backend em http://localhost:3001 com seed padrão.
//
// Matriz testada nas 3 rotas de escrita (POST, PATCH realizado, DELETE):
//   gestor1 → projeto do gestor3      → 403
//   gestor1 → próprio projeto         → sucesso
//   chefe   → projeto alheio          → sucesso
//   admin   → projeto alheio          → sucesso

import { PrismaClient } from '@prisma/client';

const API   = 'http://localhost:3001/api';
const prisma = new PrismaClient();
const ANO   = 2031;
const MES   = 1; // mês isolado — sem nenhuma alocação do seed

let pass = 0;
let fail = 0;

function check(label, condition, extra) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    pass++;
  } else {
    console.log(`  ❌ ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`);
    fail++;
  }
}

async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Login falhou para ${email}: ${JSON.stringify(data)}`);
  return data.token;
}

async function api(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { }
  return { status: res.status, data };
}

const projetosCriados = [];
async function main() {
  // ── Login ──────────────────────────────────────────────────────────────────
  console.log('── Login ──────────────────────────────────────────────────────────');
  const tokG1    = await login('gestor1@sistema.dev', 'gestor123');
  const tokG3    = await login('gestor3@sistema.dev', 'gestor123');
  const tokChefe = await login('chefe@sistema.dev',   'chefe123');
  const tokAdmin = await login('admin@sistema.dev',   'admin123');
  console.log('Tokens obtidos.\n');

  // ── Categoria e colaborador do seed ───────────────────────────────────────
  const { data: cats }   = await api('GET', '/categorias?ativo=true', tokG1);
  const categoriaId = cats[0].id;
  // Usa o primeiro colaborador ativo do seed — mês 2031/01 é isolado, sem alocações
  const { data: colabs } = await api('GET', '/colaboradores?ativo=true', tokG1);
  const colabId = colabs[0].id;

  // ── Projeto do gestor3 ─────────────────────────────────────────────────────
  const suffix = Date.now();
  const pG3 = (await api('POST', '/projetos', tokG3, {
    codigo: `POSSE-G3-${suffix}`,
    nome: `Posse Teste G3 ${suffix}`,
    prestacoesContas: ['2032-01-31'],
    categoriaId,
  })).data;
  projetosCriados.push(pG3.id);

  const macG3 = (await api('POST', `/projetos/${pG3.id}/macros`, tokG3, { nome: 'Macro G3' })).data;
  const macroG3Id = macG3.id;
  const microG3Id = macG3.microEntregas.find(m => m.nome === 'Geral').id;

  // ── Projeto do gestor1 ─────────────────────────────────────────────────────
  const pG1 = (await api('POST', '/projetos', tokG1, {
    codigo: `POSSE-G1-${suffix}`,
    nome: `Posse Teste G1 ${suffix}`,
    prestacoesContas: ['2032-01-31'],
    categoriaId,
  })).data;
  projetosCriados.push(pG1.id);

  const macG1 = (await api('POST', `/projetos/${pG1.id}/macros`, tokG1, { nome: 'Macro G1' })).data;
  const macroG1Id = macG1.id;
  const microG1Id = macG1.microEntregas.find(m => m.nome === 'Geral').id;

  // ── Alocações base (criadas pelo dono — deve passar) ─────────────────────
  const alocG3 = (await api('POST', '/alocacoes', tokG3, {
    colaboradorId: colabId, projetoId: pG3.id,
    macroEntregaId: macroG3Id, microEntregaId: microG3Id,
    ano: ANO, mes: MES, horasPlanejadas: 10,
  })).data;
  if (!alocG3.alocacao) throw new Error(`Alocação G3 falhou: ${JSON.stringify(alocG3)}`);
  const alocG3Id = alocG3.alocacao.id;

  const alocG1 = (await api('POST', '/alocacoes', tokG1, {
    colaboradorId: colabId, projetoId: pG1.id,
    macroEntregaId: macroG1Id, microEntregaId: microG1Id,
    ano: ANO, mes: MES, horasPlanejadas: 10,
  })).data;
  if (!alocG1.alocacao) throw new Error(`Alocação G1 falhou: ${JSON.stringify(alocG1)}`);
  const alocG1Id = alocG1.alocacao.id;

  console.log(`Setup ok — 2 projetos (G1, G3), 1 colab, 2 alocações em ${ANO}/${MES}.\n`);

  // ════════════════════════════════════════════════════════════════════════════
  // POST /alocacoes
  // ════════════════════════════════════════════════════════════════════════════
  console.log('── POST /alocacoes ────────────────────────────────────────────────');

  // gestor1 → projeto do gestor3 → 403
  const rP1 = await api('POST', '/alocacoes', tokG1, {
    colaboradorId: colabId, projetoId: pG3.id,
    macroEntregaId: macroG3Id, microEntregaId: microG3Id,
    ano: ANO, mes: MES, horasPlanejadas: 5,
  });
  check('POST: gestor1 → projeto do gestor3 → 403', rP1.status === 403, rP1.data);

  // gestor1 → próprio projeto → 201 (upsert — atualiza de 10h para 15h)
  const rP2 = await api('POST', '/alocacoes', tokG1, {
    colaboradorId: colabId, projetoId: pG1.id,
    macroEntregaId: macroG1Id, microEntregaId: microG1Id,
    ano: ANO, mes: MES, horasPlanejadas: 15,
  });
  check('POST: gestor1 → próprio projeto → 201', rP2.status === 201, rP2.data);

  // chefe → projeto do gestor3 → 201
  const rP3 = await api('POST', '/alocacoes', tokChefe, {
    colaboradorId: colabId, projetoId: pG3.id,
    macroEntregaId: macroG3Id, microEntregaId: microG3Id,
    ano: ANO, mes: MES, horasPlanejadas: 20,
  });
  check('POST: chefe → projeto alheio → 201', rP3.status === 201, rP3.data);

  // admin → projeto do gestor3 → 201
  const rP4 = await api('POST', '/alocacoes', tokAdmin, {
    colaboradorId: colabId, projetoId: pG3.id,
    macroEntregaId: macroG3Id, microEntregaId: microG3Id,
    ano: ANO, mes: MES, horasPlanejadas: 25,
  });
  check('POST: admin → projeto alheio → 201', rP4.status === 201, rP4.data);

  // ════════════════════════════════════════════════════════════════════════════
  // PATCH /alocacoes/:id/realizado
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n── PATCH /alocacoes/:id/realizado ────────────────────────────────');

  // gestor1 → alocação do projeto do gestor3 → 403
  const rR1 = await api('PATCH', `/alocacoes/${alocG3Id}/realizado`, tokG1, { horasRealizadas: 5 });
  check('PATCH realizado: gestor1 → projeto do gestor3 → 403', rR1.status === 403, rR1.data);

  // gestor1 → própria alocação → 200
  const rR2 = await api('PATCH', `/alocacoes/${alocG1Id}/realizado`, tokG1, { horasRealizadas: 8 });
  check('PATCH realizado: gestor1 → própria alocação → 200', rR2.status === 200, rR2.data);

  // chefe → alocação do projeto do gestor3 → 200
  const rR3 = await api('PATCH', `/alocacoes/${alocG3Id}/realizado`, tokChefe, { horasRealizadas: 10 });
  check('PATCH realizado: chefe → projeto alheio → 200', rR3.status === 200, rR3.data);

  // admin → alocação do projeto do gestor3 → 200
  const rR4 = await api('PATCH', `/alocacoes/${alocG3Id}/realizado`, tokAdmin, { horasRealizadas: 12 });
  check('PATCH realizado: admin → projeto alheio → 200', rR4.status === 200, rR4.data);

  // ════════════════════════════════════════════════════════════════════════════
  // DELETE /alocacoes/:id
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n── DELETE /alocacoes/:id ──────────────────────────────────────────');

  // gestor1 → alocação do projeto do gestor3 → 403 (alocG3 ainda existe)
  const rD1 = await api('DELETE', `/alocacoes/${alocG3Id}`, tokG1);
  check('DELETE: gestor1 → projeto do gestor3 → 403', rD1.status === 403, rD1.data);

  // gestor1 → própria alocação → 200
  const rD2 = await api('DELETE', `/alocacoes/${alocG1Id}`, tokG1);
  check('DELETE: gestor1 → própria alocação → 200', rD2.status === 200, rD2.data);

  // chefe → alocação do projeto do gestor3 → 200 (alocG3 ainda existe após gestor1 falhar)
  const rD3 = await api('DELETE', `/alocacoes/${alocG3Id}`, tokChefe);
  check('DELETE: chefe → projeto alheio → 200', rD3.status === 200, rD3.data);

  // admin: recria uma alocação no projeto do gestor3 e deleta
  const alocAdm = (await api('POST', '/alocacoes', tokAdmin, {
    colaboradorId: colabId, projetoId: pG3.id,
    macroEntregaId: macroG3Id, microEntregaId: microG3Id,
    ano: ANO, mes: MES, horasPlanejadas: 5,
  })).data;
  if (alocAdm.alocacao) {
    const rD4 = await api('DELETE', `/alocacoes/${alocAdm.alocacao.id}`, tokAdmin);
    check('DELETE: admin → projeto alheio → 200', rD4.status === 200, rD4.data);
  } else {
    check('DELETE: admin → projeto alheio → 200', false, `Pre-criação falhou: ${JSON.stringify(alocAdm)}`);
  }

  // ── Resumo ────────────────────────────────────────────────────────────────
  console.log(`\n── Resultado: ${pass} ✅  ${fail} ❌  de ${pass + fail} testes`);

  // ── Limpeza ───────────────────────────────────────────────────────────────
  console.log('\n── Limpeza ──────────────────────────────────────────────────────');
  try {
    // Ordem FK-safe: logs → alocações restantes → micros → macros → prestações → projeto
    await prisma.alocacaoLog.deleteMany({ where: { projetoId: { in: projetosCriados } } });
    await prisma.alocacao.deleteMany({ where: { projetoId: { in: projetosCriados } } });
    await prisma.microEntrega.deleteMany({ where: { macroEntrega: { projetoId: { in: projetosCriados } } } });
    await prisma.macroEntrega.deleteMany({ where: { projetoId: { in: projetosCriados } } });
    await prisma.prestacaoContas.deleteMany({ where: { projetoId: { in: projetosCriados } } });
    await prisma.projeto.deleteMany({ where: { id: { in: projetosCriados } } });
    console.log('Limpeza concluída.');
  } catch (err) {
    console.log(`Falha na limpeza (não impede resultado): ${err.message}`);
  } finally {
    await prisma.$disconnect();
  }

  if (fail > 0) process.exit(1);
}

main().catch(async err => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
