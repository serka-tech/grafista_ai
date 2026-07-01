import crypto from 'crypto';
import { env } from '../config/env.js';

export const SESSION_COOKIE_NAME = 'grafista_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Generates a new random opaque session token (sent to the client, never stored raw). */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hashes a session token with AUTH_SECRET as an HMAC key before it is stored in or looked
 * up from PostgreSQL, so a leaked `sessions` table alone cannot be used to forge cookies.
 */
export function hashSessionToken(token: string): string {
  return crypto.createHmac('sha256', env.AUTH_SECRET).update(token).digest('hex');
}
