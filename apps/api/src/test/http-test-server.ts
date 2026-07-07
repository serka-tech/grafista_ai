/**
 * Grafista AI Studio — shared supertest server lifecycle helper (Production Step 6)
 *
 * Every `supertest` call site in this suite used to call `request(app)` /
 * `request.agent(app)` directly against the bare Express `app` function.
 * supertest's own `Test` constructor (see `supertest/lib/test.js`) treats a
 * plain function specially: it wraps it in `http.createServer(app)`, then
 * `serverAddress()` calls `app.listen(0)` (a fresh OS-assigned ephemeral port)
 * for THAT SINGLE CALL, and `end()` closes that server again once the
 * response is received. That happens on every individual `.get()`/`.post()`/
 * etc. invocation — including repeated calls through the same
 * `request.agent(app)` instance, since each method call constructs its own
 * `Test`. Across a full `test:ci` run (433 tests, ~66 call sites) this
 * amounted to roughly two thousand ephemeral bind/close cycles per run.
 *
 * Production Step 5 root-caused an intermittent bare 405/403/404/"socket
 * hang up" flake to exactly this: an unrelated local process on the
 * developer machine also binding ports in the same OS ephemeral range
 * occasionally intercepted one of these short-lived listeners (see
 * docs/ci-stable-profile.md, "Production Step 5"). The fix recorded there as
 * the concrete next step: give supertest an ALREADY-LISTENING server instead
 * of the bare `app` function, so it never has anywhere to call `.listen(0)`.
 *
 * `supertest`'s `Test.serverAddress()` only calls `app.listen(0)` when
 * `app.address()` is still null — pass it a server that's already bound and
 * it reuses that one address for every request, no new bind/close per call.
 * Passing an `http.Server` also skips the `end()` auto-close path entirely
 * (that path only fires for the server supertest itself created), so the one
 * real listener this helper opens stays up for the whole file and must be
 * closed exactly once, in `afterAll`.
 *
 * Usage (module scope, not inside a `describe`/`it`, so `request.agent(...)`
 * assignments declared at describe-body-eval time — a pattern already used
 * throughout this suite — see a valid, already-listening server):
 *
 *   import { app } from '../app.js';
 *   import { startTestServer } from '../test/http-test-server.js';
 *
 *   const testServer = startTestServer(app);
 *   afterAll(() => testServer.close());
 *
 *   // then, anywhere a call site used to say `request(app)` / `request.agent(app)`:
 *   const res = await request(testServer.server).get('/api/clients');
 *   const owner = request.agent(testServer.server);
 */
import type { Express } from 'express';
import type { Server } from 'http';

export interface TestServerHandle {
  /** Already-listening server — pass this (not the bare `app`) into `request()`/`request.agent()`. */
  server: Server;
  /** Closes the listener. Call exactly once, from `afterAll`. */
  close(): Promise<void>;
}

export function startTestServer(app: Express): TestServerHandle {
  const server = app.listen(0);
  return {
    server,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
