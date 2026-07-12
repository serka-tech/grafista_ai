import { Request, Response, NextFunction } from 'express';

/**
 * Grafista AI Studio — In-Memory Rate Limiting (Production go-live M2.2)
 *
 * Dependency-free fixed-window limiter — a deliberate substitute for
 * express-rate-limit that needs no new package and is functionally equivalent
 * for a single-instance deploy (express-rate-limit's default store is also
 * in-process memory). If the app is ever scaled to multiple instances, swap the
 * in-memory Map for a shared store (Redis) — the middleware surface stays the same.
 *
 * ON by default; only the literal RATE_LIMIT_ENABLED='false' disables it. The
 * enabled check reads process.env on every request (same convention as
 * render-queue-env.ts / storage/factory.ts), so the test suite sets
 * RATE_LIMIT_ENABLED=false globally and a single test can flip it back on for
 * its own assertions. Window size / max are read at import time (config, not
 * per-request state), which is all the app needs.
 */

interface WindowState {
  count: number;
  windowStart: number;
}

/** Every limiter's store, so tests can reset all window state between assertions. */
const stores: Map<string, WindowState>[] = [];

/** Test hook — clears every limiter's window state. */
export function resetRateLimitStores(): void {
  for (const store of stores) store.clear();
}

/** RATE_LIMIT_ENABLED — default ON; only the literal 'false' disables it (tests set this). */
export function isRateLimitEnabled(): boolean {
  return (process.env.RATE_LIMIT_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
}

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/**
 * Client IP used for keying. Relies on Express's `req.ip`, which resolves to the
 * REAL client IP from the proxy's appended X-Forwarded-For hop ONLY when
 * `app.set('trust proxy', …)` matches the deployment topology (see app.ts /
 * TRUST_PROXY). We deliberately do NOT hand-parse X-Forwarded-For: its leftmost
 * hop is client-controlled, so parsing it ourselves would let an attacker rotate
 * a spoofed header to evade the limiter (and flood the store with fake IPs).
 * Falls back to the socket address for direct/local connections.
 */
function clientIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/** Opportunistic purge of expired windows so the store can't grow unbounded from one-off IPs. */
function purgeExpired(store: Map<string, WindowState>, now: number, windowMs: number): void {
  for (const [key, state] of store) {
    if (now - state.windowStart >= windowMs) store.delete(key);
  }
}

function createLimiter(opts: { windowMs: number; max: number; keyFn: (req: Request) => string }) {
  const store = new Map<string, WindowState>();
  stores.push(store);

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    if (!isRateLimitEnabled()) return next();

    const now = Date.now();
    if (store.size > 5000) purgeExpired(store, now, opts.windowMs);

    const key = opts.keyFn(req);
    const state = store.get(key);

    if (!state || now - state.windowStart >= opts.windowMs) {
      store.set(key, { count: 1, windowStart: now });
      return next();
    }

    state.count += 1;
    if (state.count > opts.max) {
      const retryAfterSec = Math.max(Math.ceil((state.windowStart + opts.windowMs - now) / 1000), 1);
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please slow down and try again shortly.',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    next();
  };
}

/** General API limiter — generous per-IP budget; blunts runaway/DoS bursts without touching normal use. */
export const generalLimiter = createLimiter({
  windowMs: envInt('RATE_LIMIT_WINDOW_MS', 60_000),
  max: envInt('RATE_LIMIT_MAX', 300),
  keyFn: (req) => `general:${clientIp(req)}`,
});

/** Strict login limiter — small per-(IP+email) budget to blunt credential stuffing / brute force. */
export const loginLimiter = createLimiter({
  windowMs: envInt('AUTH_RATE_LIMIT_WINDOW_MS', 60_000),
  max: envInt('AUTH_RATE_LIMIT_MAX', 10),
  keyFn: (req) => {
    const email =
      req.body && typeof (req.body as { email?: unknown }).email === 'string'
        ? (req.body as { email: string }).email.toLowerCase()
        : 'unknown';
    return `login:${clientIp(req)}:${email}`;
  },
});
