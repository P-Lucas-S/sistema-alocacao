import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-in-prod';

// ── Fonte única dos papéis válidos ─────────────────────────────────────────
// `role` no banco é String (VARCHAR), não enum — esta é a referência única
// em código. Adicionar um papel novo aqui é o único lugar que precisa mudar
// pra que requireRole(...) aceite esse valor (passar um papel fora desta
// lista em requireRole(...) vira erro de compilação, não erro em runtime).
export const PAPEIS = ['admin', 'chefe', 'gestor', 'coordenacao', 'diretor'] as const;
export type Papel = typeof PAPEIS[number];

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; role: string };
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export const requireRole = (...roles: Papel[]) =>
  (req: AuthRequest, res: Response, next: NextFunction) => {
    // req.user.role vem do JWT como string solta (pode não ser um Papel válido,
    // ex.: token antigo) — comparação em runtime continua por string, sem
    // assumir que o valor decodificado já é um Papel.
    if (!(roles as readonly string[]).includes(req.user?.role ?? '')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
