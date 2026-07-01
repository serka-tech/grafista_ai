import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { usersRepo } from '../db/repositories/users.js';
import { sessionsRepo } from '../db/repositories/sessions.js';
import { verifyPassword } from '../auth/password.js';
import { generateSessionToken, hashSessionToken, SESSION_COOKIE_NAME, SESSION_TTL_MS } from '../auth/session-token.js';
import { requireAuth } from '../auth/middleware.js';
import { env } from '../config/env.js';

export const authRouter: Router = Router();

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax' as const,
    maxAge: SESSION_TTL_MS,
    path: '/',
  };
}

// POST /api/auth/login
authRouter.post('/auth/login', async (req: Request, res: Response) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body', issues: parsed.error.issues });
  }
  const { email, password } = parsed.data;

  const user = await usersRepo.findByEmail(email);
  if (!user || user.status !== 'active') {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const validPassword = await verifyPassword(password, user.passwordHash);
  if (!validPassword) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = generateSessionToken();
  await sessionsRepo.create({
    id: uuid(),
    userId: user.id,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });

  res.cookie(SESSION_COOKIE_NAME, token, cookieOptions());

  const access = await usersRepo.getWithAccess(user.id);
  res.json({ data: { user: access } });
});

// POST /api/auth/logout
authRouter.post('/auth/logout', async (req: Request, res: Response) => {
  const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  if (token) {
    await sessionsRepo.revokeByTokenHash(hashSessionToken(token));
  }
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  res.json({ data: { loggedOut: true } });
});

// GET /api/auth/me
authRouter.get('/auth/me', requireAuth, (req: Request, res: Response) => {
  res.json({ data: { user: req.user } });
});
