import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { usersRepo } from '../db/repositories/users.js';
import { sessionsRepo } from '../db/repositories/sessions.js';
import { invitesRepo } from '../db/repositories/invites.js';
import { verifyPassword, hashPassword } from '../auth/password.js';
import { generateSessionToken, hashSessionToken, SESSION_COOKIE_NAME, SESSION_TTL_MS } from '../auth/session-token.js';
import { requireAuth } from '../auth/middleware.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { loginLimiter } from '../middleware/rate-limit.js';

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

// POST /api/auth/login — stricter per-(IP+email) limiter in front (go-live M2.2).
authRouter.post('/auth/login', loginLimiter, asyncHandler(async (req: Request, res: Response) => {
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
}));

const AcceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
  name: z.string().trim().min(1).optional(),
});

// POST /api/auth/accept-invite — the ONLY user-creation path (no public signup).
// Validates a one-time invite token, creates the user in the inviter's org with
// the invited role, consumes the invite, and logs the new user in.
authRouter.post('/auth/accept-invite', loginLimiter, asyncHandler(async (req: Request, res: Response) => {
  const parsed = AcceptInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body', issues: parsed.error.issues });
  }
  const { token, password, name } = parsed.data;

  const invite = await invitesRepo.findValidByTokenHash(hashSessionToken(token));
  if (!invite) {
    return res.status(400).json({ error: 'Davet geçersiz veya süresi dolmuş.' });
  }

  // Email is globally unique — guards a double-accept race and a since-created user.
  const existing = await usersRepo.findByEmail(invite.email);
  if (existing) {
    await invitesRepo.markAccepted(invite.id);
    return res.status(409).json({ error: 'Bu e-posta ile bir kullanıcı zaten kayıtlı.' });
  }

  const passwordHash = await hashPassword(password);
  const user = await usersRepo.create({
    id: uuid(),
    email: invite.email,
    passwordHash,
    name: name ?? undefined,
    organizationId: invite.organizationId,
  });
  await usersRepo.assignRole(user.id, invite.role);
  await invitesRepo.markAccepted(invite.id);

  const sessionToken = generateSessionToken();
  await sessionsRepo.create({
    id: uuid(),
    userId: user.id,
    tokenHash: hashSessionToken(sessionToken),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  res.cookie(SESSION_COOKIE_NAME, sessionToken, cookieOptions());

  const access = await usersRepo.getWithAccess(user.id);
  res.status(201).json({ data: { user: access } });
}));

// POST /api/auth/logout
authRouter.post('/auth/logout', asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  if (token) {
    await sessionsRepo.revokeByTokenHash(hashSessionToken(token));
  }
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  res.json({ data: { loggedOut: true } });
}));

// GET /api/auth/me
authRouter.get('/auth/me', requireAuth, (req: Request, res: Response) => {
  res.json({ data: { user: req.user } });
});
