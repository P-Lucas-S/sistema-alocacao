// Teste da área de atuação obrigatória em colaborador (Spec área de atuação,
// passo B). Rode com: node test-colaborador-area.mjs
// Pressupõe backend de pé em http://localhost:3001 com o seed padrão carregado.

import { PrismaClient } from '@prisma/client';

const BASE = 'http://localhost:3001/api';
const STAMP = Date.now();
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

async function main() {
  console.log('── Login ──────────────────────────────────────────');
  const tokenGestor = await login('gestor1@sistema.dev', 'gestor123');
  console.log('Token obtido para gestor.\n');

  const { data: areas } = await api('GET', '/areas-atuacao?ativo=true', tokenGestor);
  const areaDevId    = areas.find(a => a.nome === 'Desenvolvimento')?.id;
  const areaDesignId = areas.find(a => a.nome === 'Design')?.id;
  check('Áreas do seed disponíveis (Desenvolvimento + Design)', !!areaDevId && !!areaDesignId, areas.map(a => a.nome));

  const { data: categorias } = await api('GET', '/categorias?ativo=true', tokenGestor);
  const categoriaId = categorias[0].id;

  let colabIdsCriados = [];
  let areaTesteId; // área desativada, sem colaborador apontando — limpa direto no fim

  console.log('\n── GET /colaboradores — seed traz areaAtuacao preenchida ──');
  {
    const { status, data } = await api('GET', '/colaboradores', tokenGestor);
    check('Status 200', status === 200, { status });
    const semArea = data.filter(c => c.areaAtuacao == null);
    check('Nenhum colaborador do seed sem área', semArea.length === 0, semArea.map(c => c.nome));
    const algum = data.find(c => c.nome === 'Caio Henrique');
    check('Exemplo (Caio Henrique) tem areaAtuacao {id,nome}', algum?.areaAtuacao?.nome === 'Desenvolvimento', algum);
  }

  console.log('\n── POST sem areaAtuacaoId → 400 (obrigatória) ──────');
  {
    const { status, data } = await api('POST', '/colaboradores', tokenGestor, {
      nome: `Teste Sem Area ${STAMP}`, email: `sem.area.${STAMP}@equipe.dev`, valorHora: 100,
    });
    check('Status 400', status === 400, { status, data });
  }

  console.log('\n── POST com areaAtuacaoId inexistente → 400 ────────');
  {
    const { status, data } = await api('POST', '/colaboradores', tokenGestor, {
      nome: `Teste Area Inexistente ${STAMP}`, email: `area.inexistente.${STAMP}@equipe.dev`,
      valorHora: 100, areaAtuacaoId: 'area-nao-existe-xyz',
    });
    check('Status 400', status === 400, { status, data });
  }

  console.log('\n── POST com área INATIVA → 400 ─────────────────────');
  {
    const { status, data } = await api('POST', '/areas-atuacao', tokenGestor, { nome: `Area Teste Inativa ${STAMP}` });
    check('Área de teste criada (201)', status === 201, { status, data });
    areaTesteId = data?.area?.id;

    const desat = await api('PATCH', `/areas-atuacao/${areaTesteId}`, tokenGestor, { ativo: false });
    check('Área de teste desativada (200)', desat.status === 200 && desat.data?.ativo === false, desat);

    const tentativa = await api('POST', '/colaboradores', tokenGestor, {
      nome: `Teste Area Inativa ${STAMP}`, email: `area.inativa.${STAMP}@equipe.dev`,
      valorHora: 100, areaAtuacaoId: areaTesteId,
    });
    check('Status 400 (área inativa)', tentativa.status === 400, tentativa);
  }

  console.log('\n── POST com areaAtuacaoId válido → cria, GET :id mostra a área ──');
  let colabId;
  {
    const { status, data } = await api('POST', '/colaboradores', tokenGestor, {
      nome: `Teste Com Area ${STAMP}`, email: `com.area.${STAMP}@equipe.dev`,
      valorHora: 100, areaAtuacaoId: areaDevId,
      tarifas: [{ categoriaId, valorHora: 130 }],
    });
    check('Status 201', status === 201, { status, data });
    colabId = data?.colaborador?.id;
    if (colabId) colabIdsCriados.push(colabId);

    const detalhe = await api('GET', `/colaboradores/${colabId}`, tokenGestor);
    check('GET :id mostra areaAtuacao = Desenvolvimento', detalhe.data?.areaAtuacao?.nome === 'Desenvolvimento', detalhe.data);
    check('GET :id mostra a tarifa criada', detalhe.data?.tarifas?.length === 1, detalhe.data);
  }

  console.log('\n── PUT só o nome (sem areaAtuacaoId) → área e tarifas PRESERVADAS ──');
  {
    const { status, data } = await api('PUT', `/colaboradores/${colabId}`, tokenGestor, {
      nome: `Teste Com Area Renomeado ${STAMP}`, valorHora: 100,
    });
    check('Status 200', status === 200, { status, data });
    check('Nome atualizado', data?.nome === `Teste Com Area Renomeado ${STAMP}`, data);

    const detalhe = await api('GET', `/colaboradores/${colabId}`, tokenGestor);
    check('Área PRESERVADA (ainda Desenvolvimento)', detalhe.data?.areaAtuacao?.nome === 'Desenvolvimento', detalhe.data);
    check('Tarifa PRESERVADA (não apagou)', detalhe.data?.tarifas?.length === 1, detalhe.data);
  }

  console.log('\n── PUT trocando areaAtuacaoId → área muda, tarifa intacta ──');
  {
    const { status, data } = await api('PUT', `/colaboradores/${colabId}`, tokenGestor, {
      valorHora: 100, areaAtuacaoId: areaDesignId,
    });
    check('Status 200', status === 200, { status, data });

    const detalhe = await api('GET', `/colaboradores/${colabId}`, tokenGestor);
    check('Área mudou pra Design', detalhe.data?.areaAtuacao?.nome === 'Design', detalhe.data);
    check('Tarifa ainda intacta', detalhe.data?.tarifas?.length === 1, detalhe.data);
  }

  console.log('\n── PUT com areaAtuacaoId inexistente → 400, nada muda ──');
  {
    const { status, data } = await api('PUT', `/colaboradores/${colabId}`, tokenGestor, {
      valorHora: 100, areaAtuacaoId: 'area-nao-existe-xyz',
    });
    check('Status 400', status === 400, { status, data });

    const detalhe = await api('GET', `/colaboradores/${colabId}`, tokenGestor);
    check('Área AINDA é Design (nada foi alterado)', detalhe.data?.areaAtuacao?.nome === 'Design', detalhe.data);
  }

  // ── Limpeza (via Prisma) ────────────────────────────────────────────────────
  console.log('\n── Limpeza ──────────────────────────────────────────');
  try {
    if (colabIdsCriados.length) {
      await prisma.tarifaColaborador.deleteMany({ where: { colaboradorId: { in: colabIdsCriados } } });
      await prisma.alocacao.deleteMany({ where: { colaboradorId: { in: colabIdsCriados } } });
      await prisma.colaborador.deleteMany({ where: { id: { in: colabIdsCriados } } });
    }
    if (areaTesteId) {
      await prisma.areaAtuacao.deleteMany({ where: { id: areaTesteId } });
    }
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
