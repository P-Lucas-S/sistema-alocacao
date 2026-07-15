import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import path from 'path';
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}
import { initDb } from './db.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import profileRoutes from './routes/profile.js';
import notificationRoutes from './routes/notifications.js';
import colaboradoresRoutes from './routes/colaboradores.js';
import projetosRoutes from './routes/projetos.js';
import macrosRoutes from './routes/macros.js';
import alocacoesRoutes from './routes/alocacoes.js';
import fechamentosRoutes from './routes/fechamentos.js';
import remanejamentoRoutes from './routes/remanejamento.js';
import relatoriosRoutes from './routes/relatorios.js';
import categoriasRoutes from './routes/categorias.js';
import profissoesRoutes from './routes/profissoes.js';
import priorizacaoRoutes from './routes/priorizacao.js';
import dashboardsRoutes from './routes/dashboards.js';
import sugestaoEquipeRoutes from './routes/sugestaoEquipe.js';

const BOOT_TIME = new Date();

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
}));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/colaboradores', colaboradoresRoutes);
app.use('/api/projetos', projetosRoutes);
app.use('/api/projetos/:projetoId/macros', macrosRoutes);
app.use('/api/alocacoes', alocacoesRoutes);
app.use('/api/fechamentos', fechamentosRoutes);
app.use('/api/remanejamento', remanejamentoRoutes);
app.use('/api/relatorios', relatoriosRoutes);
app.use('/api/categorias', categoriasRoutes);
app.use('/api/profissoes', profissoesRoutes);
app.use('/api/priorizacao', priorizacaoRoutes);
app.use('/api/dashboards', dashboardsRoutes);
app.use('/api/projetos/:id/sugestao-equipe', sugestaoEquipeRoutes);

app.get('/api/health', (_req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - BOOT_TIME.getTime()) / 1000);
  res.json({
    status: 'ok',
    ambiente: process.env.NODE_ENV,
    bootTime: BOOT_TIME.toISOString(),
    uptimeSeconds,
    uptimeHuman: formatUptime(uptimeSeconds),
    pid: process.pid,
    port: Number(PORT),
  });
});

if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  initDb().then(() => {
    app.listen(Number(PORT), '0.0.0.0', () => {
      console.log(`Backend running on http://localhost:${PORT}`);
    });
  });
}

export default app;
