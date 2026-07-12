import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Request, Response } from 'express';
import { app } from '../app.js';
import { startTestServer } from '../test/http-test-server.js';
import { loginLimiter, resetRateLimitStores } from '../middleware/rate-limit.js';

/**
 * Production go-live M2.2 — security headers + rate limiting.
 *
 * Headers and the "disabled by default" behavior are asserted through the real
 * app. The 429 path is exercised as a SYNCHRONOUS unit test against the limiter
 * middleware directly: it flips RATE_LIMIT_ENABLED only inside a synchronous
 * loop (no awaits), so it can never bleed the enabled flag into a concurrently
 * running test file (the suite keeps the flag 'false' globally).
 */

const testServer = startTestServer(app);
afterAll(() => testServer.close());

afterEach(() => {
  process.env.RATE_LIMIT_ENABLED = 'false';
  resetRateLimitStores();
});

describe('1. Security headers', () => {
  it('sets hardening headers and hides x-powered-by on a normal response', async () => {
    const res = await request(testServer.server).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('2. Rate limiting is disabled by default in the suite', () => {
  it('does not throttle repeated logins (proves the limiter is wired but passes through)', async () => {
    for (let i = 0; i < 20; i++) {
      const res = await request(testServer.server)
        .post('/api/auth/login')
        .send({ email: 'nobody@test.local', password: 'wrong-pass' });
      // Invalid creds -> 401 every time; never 429 while disabled.
      expect(res.status).toBe(401);
    }
  });
});

/** Minimal Express req/res/next doubles for a synchronous middleware unit test. */
function harness(email: string) {
  const req = {
    headers: {},
    ip: '10.0.0.1',
    socket: { remoteAddress: '10.0.0.1' },
    body: { email },
  } as unknown as Request;

  const state = { status: 0, nextCalled: false };
  const res = {
    setHeader() {
      return res;
    },
    status(code: number) {
      state.status = code;
      return res;
    },
    json() {
      return res;
    },
  } as unknown as Response;
  const next = () => {
    state.nextCalled = true;
  };
  return { req, res, next, state };
}

describe('3. Login limiter allows up to the max, then 429 (synchronous unit)', () => {
  it('passes exactly AUTH_RATE_LIMIT_MAX (default 10) requests, then blocks', () => {
    const prev = process.env.RATE_LIMIT_ENABLED;
    process.env.RATE_LIMIT_ENABLED = 'true';
    resetRateLimitStores();
    try {
      let passed = 0;
      let blocked = 0;
      for (let i = 0; i < 15; i++) {
        const h = harness('brute@test.local');
        loginLimiter(h.req, h.res, h.next);
        if (h.state.status === 429) blocked++;
        else if (h.state.nextCalled) passed++;
      }
      expect(passed).toBe(10);
      expect(blocked).toBe(5);
    } finally {
      process.env.RATE_LIMIT_ENABLED = prev ?? 'false';
      resetRateLimitStores();
    }
  });

  it('is a no-op when disabled (default): every call passes through', () => {
    resetRateLimitStores();
    for (let i = 0; i < 40; i++) {
      const h = harness('x@test.local');
      loginLimiter(h.req, h.res, h.next);
      expect(h.state.nextCalled).toBe(true);
      expect(h.state.status).toBe(0);
    }
  });
});
