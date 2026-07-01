import type { Request, Response, NextFunction } from 'express';
import { sessionsRepo } from '../db/repositories/sessions.js';
import { usersRepo, type UserWithAccess } from '../db/repositories/users.js';
import { hashSessionToken, SESSION_COOKIE_NAME } from './session-token.js';
import type { Permission, Role } from './permissions.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserWithAccess;
    }
  }
}

/**
 * Loads the session from PostgreSQL and attaches the user (with roles/permissions) to req.user. 401s otherwise.
 *
 * Wrapped in an internal try/catch (rather than relying on every route to apply `asyncHandler`)
 * because this middleware itself performs `await pool.query(...)` calls that can reject on a DB
 * hiccup — Express 4 does not auto-forward rejected promises from async middleware to the error
 * handler, so without this the whole process would crash.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const session = await sessionsRepo.findValidByTokenHash(hashSessionToken(token));
    if (!session) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }

    const user = await usersRepo.getWithAccess(session.userId);
    if (!user || user.status !== 'active') {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Must run after requireAuth. 403s if the authenticated user lacks the given permission. */
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!req.user.permissions.includes(permission)) {
      res.status(403).json({ error: 'Forbidden — missing permission', requiredPermission: permission });
      return;
    }
    next();
  };
}

/** Must run after requireAuth. 403s if the authenticated user does not hold one of the given roles. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!roles.some((role) => req.user!.roles.includes(role))) {
      res.status(403).json({ error: 'Forbidden — missing role', requiredRole: roles });
      return;
    }
    next();
  };
}
