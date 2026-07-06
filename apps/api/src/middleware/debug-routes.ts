/**
 * Grafista AI Studio — CI_DEBUG_ROUTES diagnostic middleware (Production Step 5)
 *
 * Opt-in, env-gated request/response logger used to chase an intermittent
 * bare `405 Method Not Allowed` seen a couple of times during `test:ci` runs
 * (see docs/ci-stable-profile.md, "Production Step 5" section, for the full
 * investigation). It is a NO-OP unless `CI_DEBUG_ROUTES=1` is set — never
 * default-on, never noisy in normal `pnpm test` / `pnpm run test:ci` runs.
 *
 * What it does when enabled:
 *  - Logs one line per incoming request (timestamp, method, url) as early as
 *    possible in the middleware chain (mounted before cors/cookie-parser/json
 *    in app.ts) so the log reflects what actually arrived at Express, before
 *    any body/cookie parsing could throw.
 *  - Logs one line per finished response (`res.on('finish')`) with method,
 *    url, final status, the Express-matched route path (`req.route?.path`,
 *    only populated once a router layer matches) and the response
 *    Content-Type.
 *  - Specifically when the final status is 405, additionally captures a
 *    stack trace at the exact moment something calls `res.status(405)`,
 *    `res.sendStatus(405)` or `res.writeHead(405, ...)` — the three ways
 *    Express/Node code can set that status — so the log tells you definitely
 *    whether app code, an Express/router internal, or something below it set
 *    the code, and from where.
 *
 * Usage: `CI_DEBUG_ROUTES=1 pnpm run test:ci` (or against any single test
 * file: `CI_DEBUG_ROUTES=1 pnpm --filter @grafista/api exec vitest run
 * src/__tests__/design-dna.test.ts --maxWorkers=1`).
 *
 * Output goes to both `console.error` (so it shows up inline under Vitest's
 * default reporter for failing tests) AND, if `CI_DEBUG_ROUTES_LOG_FILE` is
 * set, appended synchronously to that file path (recommended for real
 * investigations): `CI_DEBUG_ROUTES=1 CI_DEBUG_ROUTES_LOG_FILE=/tmp/routes.log
 * pnpm run test:ci`. The file sink exists because Vitest's reporter
 * buffers/attributes console output per-test and can reorder or drop lines
 * relative to real execution order (observed during this investigation) —
 * the file gives an authoritative, real-order record independent of the
 * reporter, across every test file in the run (not just ones the reporter
 * decided to print).
 *
 * How this tool actually cracked the case (Production Step 5): the smoking
 * gun was NOT a 405 stack trace — it was the ABSENCE of any log line at all.
 * Because this middleware is mounted first, every request that truly reaches
 * Express produces a matched `-->`/`<--` pair; grepping the log for the
 * failing request's method+path and finding zero matches proves the response
 * the test client received never touched this app's request pipeline. That
 * is exactly what happened: cross-reference the failing assertion's status
 * against the log's accounting of every request of that type in the run (see
 * docs/ci-stable-profile.md's Production Step 5 section for the full
 * methodology and the confirmed root cause it led to).
 */
import type { Express, Request, Response, NextFunction } from 'express';
import fs from 'fs';

const ENABLED = process.env.CI_DEBUG_ROUTES === '1';
const LOG_FILE = process.env.CI_DEBUG_ROUTES_LOG_FILE;

function log(line: string): void {
  const formatted = `[CI_DEBUG_ROUTES] [pid=${process.pid}] ${line}`;
  // eslint-disable-next-line no-console
  console.error(formatted);
  if (LOG_FILE) {
    try {
      fs.appendFileSync(LOG_FILE, formatted + '\n');
    } catch {
      // Best-effort diagnostics only — never let the debug sink itself break a test run.
    }
  }
}

/** Wraps res.status/sendStatus/writeHead so a 405 also logs a stack trace. */
function instrument405Capture(req: Request, res: Response): void {
  const label = `${req.method} ${req.originalUrl}`;

  const origStatus = res.status.bind(res);
  res.status = ((code: number) => {
    if (code === 405) {
      log(`405 set via res.status(405) for ${label}\n${new Error('stack').stack}`);
    }
    return origStatus(code);
  }) as Response['status'];

  const origSendStatus = res.sendStatus.bind(res);
  res.sendStatus = ((code: number) => {
    if (code === 405) {
      log(`405 set via res.sendStatus(405) for ${label}\n${new Error('stack').stack}`);
    }
    return origSendStatus(code);
  }) as Response['sendStatus'];

  const origWriteHead = res.writeHead.bind(res);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res.writeHead = ((statusCode: number, ...rest: any[]) => {
    if (statusCode === 405) {
      log(`405 set via res.writeHead(405, ...) for ${label}\n${new Error('stack').stack}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (origWriteHead as any)(statusCode, ...rest);
  }) as Response['writeHead'];
}

export function installDebugRoutesMiddleware(app: Express): void {
  if (!ENABLED) return;

  log('CI_DEBUG_ROUTES=1 — request/response diagnostic logging is ON');

  app.use((req: Request, res: Response, next: NextFunction) => {
    const startedAt = new Date().toISOString();
    const remote = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
    const local = `${req.socket.localAddress}:${req.socket.localPort}`;
    log(`--> ${startedAt} ${req.method} ${req.originalUrl} socket=${remote}->${local}`);

    instrument405Capture(req, res);

    let finished = false;

    res.on('finish', () => {
      finished = true;
      const routePath = req.route?.path ?? '(no matched route)';
      const contentType = res.getHeader('content-type') ?? '(none)';
      log(
        `<-- ${req.method} ${req.originalUrl} status=${res.statusCode} route=${String(routePath)} content-type=${String(contentType)} socket=${remote}->${local}`
      );
    });

    // 'close' without a prior 'finish' means the connection was torn down
    // (client aborted, socket reset, etc.) before a response was fully sent
    // — directly relevant to the "socket hang up" failures seen alongside
    // the 405s, since both point at connection-level, not app-level, issues.
    res.on('close', () => {
      if (!finished) {
        log(`xx  ${req.method} ${req.originalUrl} CONNECTION CLOSED WITHOUT FINISH socket=${remote}->${local}`);
      }
    });

    req.socket.on('error', (err) => {
      log(`xx  ${req.method} ${req.originalUrl} SOCKET ERROR: ${String(err)} socket=${remote}->${local}`);
    });

    next();
  });
}
