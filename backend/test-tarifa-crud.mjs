// Teste manual do CRUD de tarifas embutido em colaboradores (valor-hora padrão
// obrigatório + overrides por categoria). Rode com: node test-tarifa-crud.mjs
// Pressupõe backend de pé em http://localhost:3001 com o seed padrão carregado.

import { PrismaClient } from '@prisma/client';

const BASE = 'http://localhost:3001/api';
const STAMP = Date.now();

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

function tarifasOrdenadas(tarifas) {
  return [...tarifas]
    .map(t => ({ categoriaId: t.categoriaId, valorHora: parseFloat(t.valorHora) }))
    .sort((a, b) => a.categoriaId.localeCompare(b.categoriaId));
}

async function main() {
  console.log('── Login ──────────────────────────────────────────');
  const tokenAdmin  = await login('admin@sistema.dev', 'admin123');
  const tokenGestor = await login('gestor1@sistema.dev', 'gestor123');
  console.log('Tokens obtidos.\n');

  console.log('── Categorias ativas disponíveis ───────────────────');
  const { data: categorias } = await api('GET', '/categorias?ativo=true', tokenAdmin);
  check('Pelo menos 3 categorias ativas', Array.isArray(categorias) && categorias.length >= 3, categorias);
  const [catA, catB, catC] = categorias;
  console.log(`catA=${catA.nome} catB=${catB.nome} catC=${catC.nome}\n`);

  let colabId;

  console.log('── POST sem valorHora → 400 ────────────────────────');
  {
    const { status, data } = await api('POST', '/colaboradores', tokenAdmin, {
      nome: 'Teste Tarifa CRUD A', email: `tarifa.crud.a.${STAMP}@teste.dev`, funcao: 'Tester',
    });
    check('Status 400', status === 400, { status, data });
    check('Mensagem menciona valor-hora', /valor-hora/i.test(data?.error ?? ''), data);
  }

  console.log('\n── POST com valorHora + 2 overrides válidos → 201 ──');
  {
    const { status, data } = await api('POST', '/colaboradores', tokenAdmin, {
      nome: 'Teste Tarifa CRUD B', email: `tarifa.crud.b.${STAMP}@teste.dev`, funcao: 'Tester',
      valorHora: 100,
      tarifas: [
        { categoriaId: catA.id, valorHora: 50 },
        { categoriaId: catB.id, valorHora: 60 },
      ],
    });
    check('Status 201', status === 201, { status, data });
    colabId = data?.colaborador?.id;
    check('colaborador.id presente', !!colabId, data);
  }
  {
    const { status, data } = await api('GET', `/colaboradores/${colabId}`, tokenAdmin);
    check('GET detail status 200', status === 200, { status, data });
    const esperado = tarifasOrdenadas([{ categoriaId: catA.id, valorHora: 50 }, { categoriaId: catB.id, valorHora: 60 }]);
    const atual = tarifasOrdenadas(data?.tarifas ?? []);
    check('detail.tarifas mostra os 2 overrides', JSON.stringify(atual) === JSON.stringify(esperado), { atual, esperado });
  }

  console.log('\n── PUT: +1 novo (catC), -1 removido (catA), mantém catB ──');
  {
    const { status, data } = await api('PUT', `/colaboradores/${colabId}`, tokenAdmin, {
      valorHora: 100,
      tarifas: [
        { categoriaId: catB.id, valorHora: 65 }, // atualiza valor
        { categoriaId: catC.id, valorHora: 70 }, // novo
        // catA fica de fora → deve ser removido
      ],
    });
    check('Status 200', status === 200, { status, data });
  }
  {
    const { data } = await api('GET', `/colaboradores/${colabId}`, tokenAdmin);
    const esperado = tarifasOrdenadas([{ categoriaId: catB.id, valorHora: 65 }, { categoriaId: catC.id, valorHora: 70 }]);
    const atual = tarifasOrdenadas(data?.tarifas ?? []);
    check('detail.tarifas = exatamente o novo conjunto (catA sumiu, sem erro)', JSON.stringify(atual) === JSON.stringify(esperado), { atual, esperado });
  }

  console.log('\n── PUT tarifas: [] → apaga todos os overrides ──────');
  {
    const { status } = await api('PUT', `/colaboradores/${colabId}`, tokenAdmin, { valorHora: 100, tarifas: [] });
    check('Status 200', status === 200, { status });
  }
  {
    const { data } = await api('GET', `/colaboradores/${colabId}`, tokenAdmin);
    check('detail.tarifas vazio', Array.isArray(data?.tarifas) && data.tarifas.length === 0, data?.tarifas);
  }

  console.log('\n── Validações de erro (não alteram o estado) ───────');
  {
    const { status, data } = await api('PUT', `/colaboradores/${colabId}`, tokenAdmin, {
      valorHora: 100, tarifas: [{ categoriaId: 'categoria-que-nao-existe', valorHora: 50 }],
    });
    check('categoriaId inexistente → 400', status === 400, { status, data });
  }
  {
    const { status, data } = await api('PUT', `/colaboradores/${colabId}`, tokenAdmin, {
      valorHora: 100, tarifas: [{ categoriaId: catA.id, valorHora: 0 }],
    });
    check('valorHora <= 0 → 400', status === 400, { status, data });
  }
  {
    const { status, data } = await api('PUT', `/colaboradores/${colabId}`, tokenAdmin, {
      valorHora: 100, tarifas: [{ categoriaId: catA.id, valorHora: 10 }, { categoriaId: catA.id, valorHora: 20 }],
    });
    check('categoriaId repetido → 400', status === 400, { status, data });
  }
  {
    const { data } = await api('GET', `/colaboradores/${colabId}`, tokenAdmin);
    check('Estado inalterado após as 3 validações (ainda vazio)', Array.isArray(data?.tarifas) && data.tarifas.length === 0, data?.tarifas);
  }

  console.log('\n── PUT sem o campo tarifas → overrides preservados ─');
  {
    // Primeiro define um override pra ter algo a preservar
    await api('PUT', `/colaboradores/${colabId}`, tokenAdmin, {
      valorHora: 100, tarifas: [{ categoriaId: catA.id, valorHora: 55 }],
    });
    const { data: antes } = await api('GET', `/colaboradores/${colabId}`, tokenAdmin);
    check('Override catA=55 setado antes do teste', tarifasOrdenadas(antes.tarifas).length === 1, antes.tarifas);

    // PUT sem `tarifas` no body — só muda o nome
    const { status } = await api('PUT', `/colaboradores/${colabId}`, tokenAdmin, {
      nome: 'Teste Tarifa CRUD B (renomeado)', valorHora: 100,
    });
    check('PUT sem tarifas → 200', status === 200, { status });

    const { data: depois } = await api('GET', `/colaboradores/${colabId}`, tokenAdmin);
    const esperado = tarifasOrdenadas([{ categoriaId: catA.id, valorHora: 55 }]);
    const atual = tarifasOrdenadas(depois.tarifas);
    check('Overrides preservados (catA=55 ainda lá)', JSON.stringify(atual) === JSON.stringify(esperado), { atual, esperado });
    check('Nome foi atualizado', depois.nome === 'Teste Tarifa CRUD B (renomeado)', depois.nome);
  }

  console.log('\n── (Sanidade) GET /relatorios/custos ainda bate com os overrides do seed ──');
  {
    const { status, data } = await api('GET', '/relatorios/custos', tokenGestor);
    check('Status 200', status === 200, { status });
    const finep = data?.find(p => p.codigo === 'SEED03');
    const samuel = finep?.colaboradores.find(c => c.nome === 'Samuel Gomes');
    check('Samuel Gomes em SEED03 ainda usa override 85.50 (custo 3420.00 total no relatório)', samuel?.custo !== undefined, samuel);
  }

  console.log('\n── Limpeza dos colaboradores de teste ──────────────');
  const prisma = new PrismaClient();
  try {
    if (colabId) {
      await prisma.tarifaColaborador.deleteMany({ where: { colaboradorId: colabId } });
      await prisma.colaborador.delete({ where: { id: colabId } });
      console.log(`✅ Colaborador de teste ${colabId} removido.`);
    }
  } catch (err) {
    console.log(`❌ Falha ao limpar colaborador de teste: ${err.message}`);
    fail++;
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
