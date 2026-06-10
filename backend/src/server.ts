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

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', ambiente: process.env.NODE_ENV });
});

if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  initDb().then(() => {
    app.listen(Number(PORT), '0.0.0.0', () => {
      console.log(`Backend running on http://localhost:${PORT}`);
    });
  });
}

export default app;
