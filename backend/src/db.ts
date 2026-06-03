import prisma from './prisma.js';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';

/*
 * Seed de desenvolvimento — idempotente.
 * Apaga tudo e recria do zero. Pode ser rodado N vezes sem erro.
 *
 * ── Usuários ──────────────────────────────────────────────────────────────
 *   admin@sistema.dev       / admin123    (role: admin)
 *   coord@sistema.dev       / coord123    (role: coordenacao)
 *   gestor1@sistema.dev     / gestor123   (role: gestor)  — 4 projetos
 *   gestor2@sistema.dev     / gestor123   (role: gestor)  — 3 projetos
 *   gestor3@sistema.dev     / gestor123   (role: gestor)  — 3 projetos
 *
 * ── Cenário de alocação ────────────────────────────────────────────────────
 *   30 colaboradores · 10 projetos · alocações em Jun/Jul/Ago de 2026
 *
 *   Casos especiais (verificáveis no grid):
 *     • Colaboradores com dois gestores no mesmo mês (barra bicolor):
 *         Daniela Rocha (Jun) G1=120+G2=80=200h
 *         Enzo Carvalho (Jun) G1=140+G2=80=220h  ← teto cheio
 *         Fabiana Costa (Jun) G1=80+G3=60=140h
 *         Leonardo Alves (Jul) G1=80+G2=60=140h
 *         Marina Souza  (Jul) G1=100+G3=80=180h
 *         Nicolas Barbosa (Jul) G2=70+G3=50=120h
 *         Ulisses Ribeiro (Ago) G1=80+G3=60=140h
 *         Brenda Vieira (Ago) G1=130+G2=70=200h
 *     • Perto do teto (~200h): Daniela, Brenda
 *     • Exatamente no teto (220h): Enzo Carvalho em junho
 *     • Com folga (<= 120h): demais colaboradores
 */

// ── IDs fixos (garante que re-seed não cria duplicatas) ────────────────────
const G1 = 'seed-gestor-001';
const G2 = 'seed-gestor-002';
const G3 = 'seed-gestor-003';

const SEED_USERS = [
  { id: 'seed-admin-001',  name: 'Admin',       email: 'admin@sistema.dev',   password: 'admin123',  role: 'admin',       position: 'Administrador'      },
  { id: 'seed-coord-001',  name: 'Coordenação', email: 'coord@sistema.dev',   password: 'coord123',  role: 'coordenacao', position: 'Coordenação'        },
  { id: G1,                name: 'Gestor 1',    email: 'gestor1@sistema.dev', password: 'gestor123', role: 'gestor',      position: 'Gestor de Projetos' },
  { id: G2,                name: 'Gestor 2',    email: 'gestor2@sistema.dev', password: 'gestor123', role: 'gestor',      position: 'Gestor de Projetos' },
  { id: G3,                name: 'Gestor 3',    email: 'gestor3@sistema.dev', password: 'gestor123', role: 'gestor',      position: 'Gestor de Projetos' },
];

// ── Colaboradores ──────────────────────────────────────────────────────────
// Nomes bem distintos entre si para não acionar a verificação de similaridade.
const COLABORADORES = [
  { id: 'sc-01', nome: 'Adriana Lima',        email: 'adriana.lima@equipe.dev',       funcao: 'Designer'          },
  { id: 'sc-02', nome: 'Beatriz Cardoso',     email: 'beatriz.cardoso@equipe.dev',    funcao: 'Redatora'          },
  { id: 'sc-03', nome: 'Caio Henrique',       email: 'caio.henrique@equipe.dev',      funcao: 'Desenvolvedor'     },
  { id: 'sc-04', nome: 'Daniela Rocha',       email: 'daniela.rocha@equipe.dev',      funcao: 'Motion Designer'   },
  { id: 'sc-05', nome: 'Enzo Carvalho',       email: 'enzo.carvalho@equipe.dev',      funcao: 'Designer'          },
  { id: 'sc-06', nome: 'Fabiana Costa',       email: 'fabiana.costa@equipe.dev',      funcao: 'Redatora'          },
  { id: 'sc-07', nome: 'Gustavo Pires',       email: 'gustavo.pires@equipe.dev',      funcao: 'Desenvolvedor'     },
  { id: 'sc-08', nome: 'Heloisa Borges',      email: 'heloisa.borges@equipe.dev',     funcao: 'Social Media'      },
  { id: 'sc-09', nome: 'Ivan Monteiro',       email: 'ivan.monteiro@equipe.dev',      funcao: 'Editor de Vídeo'   },
  { id: 'sc-10', nome: 'Juliana Ferreira',    email: 'juliana.ferreira@equipe.dev',   funcao: 'Designer'          },
  { id: 'sc-11', nome: 'Leonardo Alves',      email: 'leonardo.alves@equipe.dev',     funcao: 'Desenvolvedor'     },
  { id: 'sc-12', nome: 'Marina Souza',        email: 'marina.souza@equipe.dev',       funcao: 'Redatora'          },
  { id: 'sc-13', nome: 'Nicolas Barbosa',     email: 'nicolas.barbosa@equipe.dev',    funcao: 'Motion Designer'   },
  { id: 'sc-14', nome: 'Olivia Teixeira',     email: 'olivia.teixeira@equipe.dev',    funcao: 'Designer'          },
  { id: 'sc-15', nome: 'Paulo Nunes',         email: 'paulo.nunes@equipe.dev',        funcao: 'Desenvolvedor'     },
  { id: 'sc-16', nome: 'Renata Pinto',        email: 'renata.pinto@equipe.dev',       funcao: 'Redatora'          },
  { id: 'sc-17', nome: 'Samuel Gomes',        email: 'samuel.gomes@equipe.dev',       funcao: 'Editor de Vídeo'   },
  { id: 'sc-18', nome: 'Tamires Campos',      email: 'tamires.campos@equipe.dev',     funcao: 'Designer'          },
  { id: 'sc-19', nome: 'Ulisses Ribeiro',     email: 'ulisses.ribeiro@equipe.dev',    funcao: 'Desenvolvedor'     },
  { id: 'sc-20', nome: 'Vanessa Torres',      email: 'vanessa.torres@equipe.dev',     funcao: 'Motion Designer'   },
  { id: 'sc-21', nome: 'Wagner Cunha',        email: 'wagner.cunha@equipe.dev',       funcao: 'Redator'           },
  { id: 'sc-22', nome: 'Xiomara Fonseca',     email: 'xiomara.fonseca@equipe.dev',    funcao: 'Social Media'      },
  { id: 'sc-23', nome: 'Yago Cavalcanti',     email: 'yago.cavalcanti@equipe.dev',    funcao: 'Designer'          },
  { id: 'sc-24', nome: 'Zara Martins',        email: 'zara.martins@equipe.dev',       funcao: 'Redatora'          },
  { id: 'sc-25', nome: 'Abel Cruz',           email: 'abel.cruz@equipe.dev',          funcao: 'Desenvolvedor'     },
  { id: 'sc-26', nome: 'Brenda Vieira',       email: 'brenda.vieira@equipe.dev',      funcao: 'Motion Designer'   },
  { id: 'sc-27', nome: 'Celso Rodrigues',     email: 'celso.rodrigues@equipe.dev',    funcao: 'Editor de Vídeo'   },
  { id: 'sc-28', nome: 'Debora Andrade',      email: 'debora.andrade@equipe.dev',     funcao: 'Designer'          },
  { id: 'sc-29', nome: 'Emerson Lopes',       email: 'emerson.lopes@equipe.dev',      funcao: 'Desenvolvedor'     },
  { id: 'sc-30', nome: 'Flora Nascimento',    email: 'flora.nascimento@equipe.dev',   funcao: 'Redatora'          },
];

// ── Projetos (com macros e micro Geral por macro) ───────────────────────────
// macros: array de nomes → cada um vira uma MacroEntrega com MicroEntrega 'Geral'
const PROJETOS = [
  // gestor1 — 4 projetos
  { id: 'sp-01', codigo: 'SEED01', nome: 'Campanha Verão',      gestorId: G1, macros: ['Design', 'Conteúdo'], dataPC: '2026-12-31' },
  { id: 'sp-02', codigo: 'SEED02', nome: 'Rebranding Digital',  gestorId: G1, macros: ['Visual'],             dataPC: '2026-11-30' },
  { id: 'sp-03', codigo: 'SEED03', nome: 'Projeto Social',      gestorId: G1, macros: ['Produção'],           dataPC: '2026-09-30' },
  { id: 'sp-04', codigo: 'SEED04', nome: 'Lançamento Produto',  gestorId: G1, macros: ['Mídia Paga'],         dataPC: '2026-10-31' },
  // gestor2 — 3 projetos
  { id: 'sp-05', codigo: 'SEED05', nome: 'Newsletter Mensal',   gestorId: G2, macros: ['Copywriting'],        dataPC: '2026-12-31' },
  { id: 'sp-06', codigo: 'SEED06', nome: 'Blog Corporativo',    gestorId: G2, macros: ['SEO', 'Design'],      dataPC: '2026-11-15' },
  { id: 'sp-07', codigo: 'SEED07', nome: 'Redes Sociais B2B',   gestorId: G2, macros: ['Estratégia'],         dataPC: '2026-10-31' },
  // gestor3 — 3 projetos
  { id: 'sp-08', codigo: 'SEED08', nome: 'Identidade Visual',   gestorId: G3, macros: ['Branding', 'Aplicações'], dataPC: '2026-09-30' },
  { id: 'sp-09', codigo: 'SEED09', nome: 'Site Institucional',  gestorId: G3, macros: ['Frontend'],           dataPC: '2026-12-31' },
  { id: 'sp-10', codigo: 'SEED10', nome: 'Vídeo Institucional', gestorId: G3, macros: ['Roteiro', 'Edição'],  dataPC: '2026-11-30' },
];

// ── Alocações ─────────────────────────────────────────────────────────────
// [colabId, projId, macroIndex, ano, mes, horas, gestorId]
// macroIndex: 0 = primeira macro do projeto, 1 = segunda macro
// Meses: 6=Junho, 7=Julho, 8=Agosto de 2026
// TODOS os totais validados antes de inserir (nenhum colaborador > 220h/mês)
type AlocSeed = [string, string, number, number, number, number, string];

const ALOCACOES: AlocSeed[] = [
  // ── JUNHO 2026 ─────────────────────────────────────────────────────────
  // Adriana Lima: 80h (G1) — margem 140h
  ['sc-01', 'sp-01', 0, 2026, 6, 80,  G1],
  // Beatriz Cardoso: 60h (G1) — margem 160h
  ['sc-02', 'sp-04', 0, 2026, 6, 60,  G1],
  // Caio Henrique: 100h (G1) — margem 120h
  ['sc-03', 'sp-01', 1, 2026, 6, 100, G1],  // macro Conteúdo
  // Daniela Rocha: G1=120 + G2=80 = 200h  ← PERTO DO TETO
  ['sc-04', 'sp-01', 0, 2026, 6, 120, G1],
  ['sc-04', 'sp-05', 0, 2026, 6, 80,  G2],
  // Enzo Carvalho: G1=140 + G2=80 = 220h  ← EXATAMENTE NO TETO
  ['sc-05', 'sp-02', 0, 2026, 6, 140, G1],
  ['sc-05', 'sp-07', 0, 2026, 6, 80,  G2],
  // Fabiana Costa: G1=80 + G3=60 = 140h  ← CROSS-GESTOR
  ['sc-06', 'sp-03', 0, 2026, 6, 80,  G1],
  ['sc-06', 'sp-08', 0, 2026, 6, 60,  G3],
  // Gustavo Pires: 80h (G2) — margem 140h
  ['sc-07', 'sp-06', 0, 2026, 6, 80,  G2],  // macro SEO
  // Heloisa Borges: 40h (G2) — margem 180h
  ['sc-08', 'sp-05', 0, 2026, 6, 40,  G2],
  // Ivan Monteiro: 120h (G3) — margem 100h
  ['sc-09', 'sp-09', 0, 2026, 6, 120, G3],
  // Juliana Ferreira: 70h (G3) — margem 150h
  ['sc-10', 'sp-10', 0, 2026, 6, 70,  G3],  // macro Roteiro

  // ── JULHO 2026 ─────────────────────────────────────────────────────────
  // Adriana Lima reaparece em julho (cross-mês): 60h (G1)
  ['sc-01', 'sp-02', 0, 2026, 7, 60,  G1],
  // Leonardo Alves: G1=80 + G2=60 = 140h  ← CROSS-GESTOR
  ['sc-11', 'sp-01', 0, 2026, 7, 80,  G1],
  ['sc-11', 'sp-06', 0, 2026, 7, 60,  G2],  // macro SEO
  // Marina Souza: G1=100 + G3=80 = 180h  ← CROSS-GESTOR, perto do teto
  ['sc-12', 'sp-02', 0, 2026, 7, 100, G1],
  ['sc-12', 'sp-08', 0, 2026, 7, 80,  G3],  // macro Branding
  // Nicolas Barbosa: G2=70 + G3=50 = 120h  ← CROSS-GESTOR (2 gestores sem G1)
  ['sc-13', 'sp-07', 0, 2026, 7, 70,  G2],
  ['sc-13', 'sp-09', 0, 2026, 7, 50,  G3],
  // Olivia Teixeira: 120h (G1) — margem 100h
  ['sc-14', 'sp-04', 0, 2026, 7, 120, G1],
  // Paulo Nunes: 80h (G2) — margem 140h
  ['sc-15', 'sp-05', 0, 2026, 7, 80,  G2],
  // Renata Pinto: 60h (G3) — margem 160h
  ['sc-16', 'sp-10', 0, 2026, 7, 60,  G3],  // macro Roteiro
  // Samuel Gomes: 40h (G1) — margem 180h
  ['sc-17', 'sp-03', 0, 2026, 7, 40,  G1],
  // Tamires Campos: 100h (G2) — margem 120h
  ['sc-18', 'sp-06', 1, 2026, 7, 100, G2],  // macro Design (índice 1)

  // ── AGOSTO 2026 ────────────────────────────────────────────────────────
  // Ulisses Ribeiro: G1=80 + G3=60 = 140h  ← CROSS-GESTOR
  ['sc-19', 'sp-01', 0, 2026, 8, 80,  G1],
  ['sc-19', 'sp-08', 1, 2026, 8, 60,  G3],  // macro Aplicações
  // Vanessa Torres: 100h (G1) — margem 120h
  ['sc-20', 'sp-02', 0, 2026, 8, 100, G1],
  // Wagner Cunha: 80h (G2) — margem 140h
  ['sc-21', 'sp-07', 0, 2026, 8, 80,  G2],
  // Xiomara Fonseca: 40h (G3) — margem 180h
  ['sc-22', 'sp-09', 0, 2026, 8, 40,  G3],
  // Yago Cavalcanti: 60h (G1) — margem 160h
  ['sc-23', 'sp-03', 0, 2026, 8, 60,  G1],
  // Zara Martins: 80h (G2) — margem 140h
  ['sc-24', 'sp-05', 0, 2026, 8, 80,  G2],
  // Abel Cruz: 120h (G3) — margem 100h
  ['sc-25', 'sp-10', 1, 2026, 8, 120, G3],  // macro Edição
  // Brenda Vieira: G1=130 + G2=70 = 200h  ← PERTO DO TETO + CROSS-GESTOR
  ['sc-26', 'sp-04', 0, 2026, 8, 130, G1],
  ['sc-26', 'sp-06', 0, 2026, 8, 70,  G2],  // macro SEO
  // Celso Rodrigues: 90h (G3) — margem 130h
  ['sc-27', 'sp-08', 0, 2026, 8, 90,  G3],  // macro Branding
  // Debora Andrade: 70h (G1) — margem 150h
  ['sc-28', 'sp-01', 1, 2026, 8, 70,  G1],  // macro Conteúdo
  // Emerson Lopes: 80h (G3) — margem 140h
  ['sc-29', 'sp-10', 0, 2026, 8, 80,  G3],  // macro Roteiro
  // Flora Nascimento: 60h (G2) — margem 160h
  ['sc-30', 'sp-07', 0, 2026, 8, 60,  G2],
  // Gustavo reaparece em agosto (G2): 80h
  ['sc-07', 'sp-06', 1, 2026, 8, 80,  G2],  // macro Design
];

export async function initDb() {
  // ── Limpeza (ordem respeitando todas as FKs) ───────────────────────────
  await prisma.alocacao.deleteMany();
  await prisma.microEntrega.deleteMany();
  await prisma.macroEntrega.deleteMany();
  await prisma.prestacaoContas.deleteMany();
  await prisma.projeto.deleteMany();
  await prisma.colaborador.deleteMany();
  await prisma.pushSubscription.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.passwordReset.deleteMany();
  await prisma.user.deleteMany();

  // ── Usuários ───────────────────────────────────────────────────────────
  for (const u of SEED_USERS) {
    const passwordHash = bcrypt.hashSync(u.password, 10);
    await prisma.user.create({
      data: { id: u.id, name: u.name, email: u.email, passwordHash, role: u.role, position: u.position },
    });
  }

  // ── Colaboradores ──────────────────────────────────────────────────────
  for (const c of COLABORADORES) {
    await prisma.colaborador.create({
      data: { id: c.id, nome: c.nome, email: c.email, funcao: c.funcao, createdById: G1 },
    });
  }

  // ── Projetos + Macros (cada macro ganha micro "Geral") ─────────────────
  // macroMicroMap[projId][macroIndex] = { macroId, microId }
  const macroMicroMap: Record<string, { macroId: string; microId: string }[]> = {};

  for (const p of PROJETOS) {
    await prisma.projeto.create({
      data: { id: p.id, codigo: p.codigo, nome: p.nome, gestorId: p.gestorId, status: 'ativo' },
    });
    await prisma.prestacaoContas.create({
      data: { id: `spc-${p.id}`, projetoId: p.id, data: new Date(p.dataPC) },
    });

    macroMicroMap[p.id] = [];
    for (let mi = 0; mi < p.macros.length; mi++) {
      const macroId = `sm-${p.id}-${mi}`;
      const microId = `smi-${p.id}-${mi}`;
      await prisma.macroEntrega.create({
        data: { id: macroId, projetoId: p.id, nome: p.macros[mi], status: 'ativa' },
      });
      await prisma.microEntrega.create({
        data: { id: microId, macroEntregaId: macroId, nome: 'Geral', status: 'pendente' },
      });
      macroMicroMap[p.id].push({ macroId, microId });
    }
  }

  // ── Alocações ──────────────────────────────────────────────────────────
  for (let i = 0; i < ALOCACOES.length; i++) {
    const [colabId, projId, macroIdx, ano, mes, horas, gestorId] = ALOCACOES[i];
    const { macroId, microId } = macroMicroMap[projId][macroIdx];
    await prisma.alocacao.create({
      data: {
        id: `sa-${String(i + 1).padStart(3, '0')}`,
        colaboradorId: colabId,
        projetoId: projId,
        macroEntregaId: macroId,
        microEntregaId: microId,
        ano, mes,
        horasPlanejadas: new Prisma.Decimal(horas),
        createdById: gestorId,
        updatedById: gestorId,
      },
    });
  }

  // ── Relatório ──────────────────────────────────────────────────────────
  const totalColabs  = COLABORADORES.length;
  const totalProjs   = PROJETOS.length;
  const totalAlocs   = ALOCACOES.length;
  const g1Projs = PROJETOS.filter(p => p.gestorId === G1).length;
  const g2Projs = PROJETOS.filter(p => p.gestorId === G2).length;
  const g3Projs = PROJETOS.filter(p => p.gestorId === G3).length;

  console.log(`✅ Seed completo`);
  console.log(`   Usuários: 1 admin · 1 coordenação · 3 gestores`);
  console.log(`   Colaboradores: ${totalColabs}`);
  console.log(`   Projetos: ${totalProjs} (G1=${g1Projs} · G2=${g2Projs} · G3=${g3Projs})`);
  console.log(`   Alocações: ${totalAlocs} entradas em Jun/Jul/Ago 2026`);
  console.log(`   Casos especiais:`);
  console.log(`     → Daniela Rocha    Jun: G1=120+G2=80 = 200h (perto do teto)`);
  console.log(`     → Enzo Carvalho    Jun: G1=140+G2=80 = 220h (teto cheio ✦)`);
  console.log(`     → Brenda Vieira    Ago: G1=130+G2=70 = 200h (perto do teto)`);
  console.log(`     → Cross-gestor: Fabiana(Jun) Leonardo(Jul) Marina(Jul) Nicolas(Jul) Ulisses(Ago)`);
}

export default prisma;
