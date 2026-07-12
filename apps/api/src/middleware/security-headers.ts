import { Request, Response, NextFunction } from 'express';

/**
 * Grafista AI Studio — Security Response Headers (Production go-live M2.2)
 *
 * Dependency-free equivalent of the helmet defaults that matter for a JSON API:
 * sets the standard hardening headers on every response. Kept dependency-free
 * deliberately — no new package to install/audit for a single-tenant deploy;
 * swap in `helmet` later if the API grows a richer HTML surface. Pairs with
 * `app.disable('x-powered-by')` in app.ts (removes Express's version banner).
 *
 * HSTS is emitted only in production (NODE_ENV=production), where traffic is
 * HTTPS; browsers ignore it over plain http anyway, but gating it keeps local
 * dev output clean. No Content-Security-Policy is set here on purpose: this
 * process serves JSON + file-download redirects/streams, not HTML documents, so
 * a document CSP would add risk (breaking image streams) without protecting a
 * document that never exists — the Next.js dashboard sets its own CSP.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
}
