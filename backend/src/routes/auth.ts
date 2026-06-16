import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../prisma.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { sendPasswordResetEmail } from '../services/emailService.js';
const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-in-prod';
const generateId = () => Math.random().toString(36).substring(2, 15);

router.post('/register', (_req, res) => {
  res.status(403).json({ error: 'Registro desabilitado' });
});

router.post('/login', async (req, res) => {
  try {
    const { email, password, rememberMe = false } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const expiresIn = rememberMe ? '30d' : '1d';
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn });

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        position: user.position,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user?.id },
      select: { id: true, name: true, email: true, role: true, position: true, avatarUrl: true },
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── Forgot Password ─── */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Return success even if user not found (security best practice)
      return res.json({ message: 'Se o email existir, um token de reset será gerado.' });
    }

    // Invalidate previous tokens for this user
    await prisma.passwordReset.updateMany({
      where: { userId: user.id, used: false },
      data: { used: true },
    });

    // Generate a 6-digit reset code (easier to type)
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const tokenHash = crypto.createHash('sha256').update(resetCode).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await prisma.passwordReset.create({
      data: {
        id: generateId(),
        userId: user.id,
        token: tokenHash,
        expiresAt,
      },
    });

    // In production, send resetCode via email (SMTP/Resend/SendGrid)
    // For local development, the code is printed in the server console
    console.log(`[DEV] Password reset code for ${email}: ${resetCode}`);
    await sendPasswordResetEmail(email, resetCode);

    res.json({
      message: 'Token de redefinição gerado com sucesso.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── Reset Password ─── */
router.post('/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Email, código e nova senha são obrigatórios.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }

    const tokenHash = crypto.createHash('sha256').update(code).digest('hex');

    const resetRecord = await prisma.passwordReset.findFirst({
      where: {
        userId: user.id,
        token: tokenHash,
        used: false,
        expiresAt: { gte: new Date() },
      },
    });

    if (!resetRecord) {
      return res.status(400).json({ error: 'Código inválido ou expirado.' });
    }

    // Update password
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    // Mark token as used
    await prisma.passwordReset.update({
      where: { id: resetRecord.id },
      data: { used: true },
    });

    res.json({ message: 'Senha redefinida com sucesso!' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
