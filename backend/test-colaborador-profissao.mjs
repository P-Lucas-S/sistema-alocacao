// Teste da profissão obrigatória em colaborador (substitui a antiga função-string).
// Rode com: node test-colaborador-profissao.mjs
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

  const { data: profissoes } = await api('GET', '/profissoes?ativo=true', tokenGestor);
  const profDevId    = profissoes.find(p => p.nome === 'Desenvolvedor(a) de Software')?.id;
  const profDesignId = profissoes.find(p => p.nome === 'Designer Gráfico')?.id;
  check('Profissões do seed disponíveis (Dev + Designer Gráfico)', !!profDevId && !!profDesignId, profissoes.map(p => p.nome));

  const { data: categorias } = await api('GET', '/categorias?ativo=true', tokenGestor);
  const categoriaId = categorias[0].id;

  let colabIdsCriados = [];
  let profissaoTesteId; // profissão desativada, sem colaborador apontando — limpa direto no fim

  console.log('\n── GET /colaboradores — seed traz profissao preenchida, sem funcao ──');
  {
    const { status, data } = await api('GET', '/colaboradores', tokenGestor);
    check('Status 200', status === 200, { status });
    const semProfissao = data.filter(c => c.profissao == null);
    check('Nenhum colaborador do seed sem profissão', semProfissao.length === 0, semProfissao.map(c => c.nome));
    const algum = data.find(c => c.nome === 'Caio Henrique');
    check('Exemplo (Caio Henrique) tem profissao {id,nome}', algum?.profissao?.nome === 'Desenvolvedor(a) de Software', algum);
    check('Campo funcao não existe mais na resposta', algum && !('funcao' in algum), algum);
  }

  console.log('\n── POST sem profissaoId → 400 (obrigatória) ────────');
  {
    const { status, data } = await api('POST', '/colaboradores', tokenGestor, {
      nome: `Teste Sem Profissao ${STAMP}`, email: `sem.profissao.${STAMP}@equipe.dev`, valorHora: 100,
    });
    check('Status 400', status === 400, { status, data });
  }

  console.log('\n── POST com profissaoId inexistente → 400 ──────────');
  {
    const { status, data } = await api('POST', '/colaboradores', tokenGestor, {
      nome: `Teste Profissao Inexistente ${STAMP}`, email: `profissao.inexistente.${STAMP}@equipe.dev`,
      valorHora: 100, profissaoId: 'prof-nao-existe-xyz',
    });
    check('Status 400', status === 400, { status, data });
  }

  console.log('\n── POST com profissão INATIVA → 400 ────────────────');
  {
    const { status, data } = await api('POST', '/profissoes', tokenGestor, { nome: `Profissao Teste Inativa ${STAMP}` });
    check('Profissão de teste criada (201)', status === 201, { status, data });
    profissaoTesteId = data?.profissao?.id;

    const desat = await api('PATCH', `/profissoes/${profissaoTesteId}`, tokenGestor, { ativo: false });
    check('Profissão de teste desativada (200)', desat.status === 200 && desat.data?.ativo === false, desat);

    const tentativa = await api('POST', '/colaboradores', tokenGestor, {
      nome: `Teste Profissao Inativa ${STAMP}`, email: `profissao.inativa.${STAMP}@equipe.dev`,
      valorHora: 100, profissaoId: profissaoTesteId,
    });
    check('Status 400 (profissão inativa)', tentativa.status === 400, tentativa);
  }

  console.log('\n── POST com profissaoId válido → cria, GET :id mostra a profissão ──');
  let colabId;
  {
    const { status, data } = await api('POST', '/colaboradores', tokenGestor, {
      nome: `Teste Com Profissao ${STAMP}`, email: `com.profissao.${STAMP}@equipe.dev`,
      valorHora: 100, profissaoId: profDevId,
      tarifas: [{ categoriaId, valorHora: 130 }],
    });
    check('Status 201', status === 201, { status, data });
    colabId = data?.colaborador?.id;
    if (colabId) colabIdsCriados.push(colabId);

    const detalhe = await api('GET', `/colaboradores/${colabId}`, tokenGestor);
    check('GET :id mostra profissao = Desenvolvedor(a) de Software', detalhe.data?.profissao?.nome === 'Desenvolvedor(a) de Software', detalhe.data);
    check('GET :id mostra a tarifa criada', detalhe.data?.tarifas?.length === 1, detalhe.data);
  }

  console.log('\n── PUT só o nome (sem profissaoId) → profissão e tarifas PRESERVADAS ──');
  {
    const { status, data } = await api('PUT', `/colaboradores/${colabId}`, tokenGestor, {
      nome: `Teste Com Profissao Renomeado ${STAMP}`, valorHora: 100,
    });
    check('Status 200', status === 200, { status, data });
    check('Nome atualizado', data?.nome === `Teste Com Profissao Renomeado ${STAMP}`, data);

    const detalhe = await api('GET', `/colaboradores/${colabId}`, tokenGestor);
    check('Profissão PRESERVADA (ainda Desenvolvedor(a) de Software)', detalhe.data?.profissao?.nome === 'Desenvolvedor(a) de Software', detalhe.data);
    check('Tarifa PRESERVADA (não apagou)', detalhe.data?.tarifas?.length === 1, detalhe.data);
  }

  console.log('\n── PUT trocando profissaoId → profissão muda, tarifa intacta ──');
  {
    const { status, data } = await api('PUT', `/colaboradores/${colabId}`, tokenGestor, {
      valorHora: 100, profissaoId: profDesignId,
    });
    check('Status 200', status === 200, { status, data });

    const detalhe = await api('GET', `/colaboradores/${colabId}`, tokenGestor);
    check('Profissão mudou pra Designer Gráfico', detalhe.data?.profissao?.nome === 'Designer Gráfico', detalhe.data);
    check('Tarifa ainda intacta', detalhe.data?.tarifas?.length === 1, detalhe.data);
  }

  console.log('\n── PUT com profissaoId inexistente → 400, nada muda ──');
  {
    const { status, data } = await api('PUT', `/colaboradores/${colabId}`, tokenGestor, {
      valorHora: 100, profissaoId: 'prof-nao-existe-xyz',
    });
    check('Status 400', status === 400, { status, data });

    const detalhe = await api('GET', `/colaboradores/${colabId}`, tokenGestor);
    check('Profissão AINDA é Designer Gráfico (nada foi alterado)', detalhe.data?.profissao?.nome === 'Designer Gráfico', detalhe.data);
  }

  console.log('\n── GET /api/relatorios/custos ainda funciona ───────');
  {
    const { status, data } = await api('GET', '/relatorios/custos', tokenGestor);
    check('Status 200', status === 200, { status, data });
    const algumColab = data.flatMap(p => p.colaboradores)[0];
    check('Traz o campo "profissao" (não "funcao")', algumColab && 'profissao' in algumColab && !('funcao' in algumColab), algumColab);
  }

  // ── Limpeza (via Prisma) ────────────────────────────────────────────────────
  console.log('\n── Limpeza ──────────────────────────────────────────');
  try {
    if (colabIdsCriados.length) {
      await prisma.tarifaColaborador.deleteMany({ where: { colaboradorId: { in: colabIdsCriados } } });
      await prisma.alocacao.deleteMany({ where: { colaboradorId: { in: colabIdsCriados } } });
      await prisma.colaborador.deleteMany({ where: { id: { in: colabIdsCriados } } });
    }
    if (profissaoTesteId) {
      await prisma.profissao.deleteMany({ where: { id: profissaoTesteId } });
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
