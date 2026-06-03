import prisma from './prisma.js';
import bcrypt from 'bcryptjs';

/*
 * Seed de desenvolvimento — idempotente.
 * Apaga todos os usuários e dados dependentes, depois recria do zero.
 * Pode ser rodado N vezes sem criar duplicatas.
 *
 * Credenciais de teste:
 *   admin@sistema.dev       / admin123    (role: admin)
 *   coord@sistema.dev       / coord123    (role: coordenacao)
 *   gestor1@sistema.dev     / gestor123   (role: gestor)
 *   gestor2@sistema.dev     / gestor123   (role: gestor)
 *   gestor3@sistema.dev     / gestor123   (role: gestor)
 */

const SEED_USERS = [
  { id: 'seed-admin-001',  name: 'Admin',      email: 'admin@sistema.dev',   password: 'admin123',  role: 'admin',       position: 'Administrador'    },
  { id: 'seed-coord-001',  name: 'Coordenação', email: 'coord@sistema.dev',   password: 'coord123',  role: 'coordenacao', position: 'Coordenação'      },
  { id: 'seed-gestor-001', name: 'Gestor 1',   email: 'gestor1@sistema.dev', password: 'gestor123', role: 'gestor',      position: 'Gestor de Projetos' },
  { id: 'seed-gestor-002', name: 'Gestor 2',   email: 'gestor2@sistema.dev', password: 'gestor123', role: 'gestor',      position: 'Gestor de Projetos' },
  { id: 'seed-gestor-003', name: 'Gestor 3',   email: 'gestor3@sistema.dev', password: 'gestor123', role: 'gestor',      position: 'Gestor de Projetos' },
];

export async function initDb() {
  // Delete dependents before users — FK order mais profundo primeiro
  await prisma.microEntrega.deleteMany();
  await prisma.macroEntrega.deleteMany();
  await prisma.projeto.deleteMany();
  await prisma.colaborador.deleteMany();
  await prisma.pushSubscription.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.passwordReset.deleteMany();
  await prisma.user.deleteMany();

  for (const u of SEED_USERS) {
    const passwordHash = bcrypt.hashSync(u.password, 10);
    await prisma.user.create({
      data: { id: u.id, name: u.name, email: u.email, passwordHash, role: u.role, position: u.position },
    });
  }

  console.log('✅ Seed completo: 1 admin, 1 coordenacao, 3 gestores');
  console.log('   admin@sistema.dev / admin123');
  console.log('   coord@sistema.dev / coord123');
  console.log('   gestor1-3@sistema.dev / gestor123');
}

export default prisma;
