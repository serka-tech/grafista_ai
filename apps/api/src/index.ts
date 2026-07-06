/**
 * Grafista AI Studio — API Server
 */

import { env } from './config/env.js';
import { app } from './app.js';
import { getWorkflowCatalog } from './workflows/catalog.js';
import { startRenderWorkerLoop } from './services/render-worker.js';

// Fail fast: a broken workflow definition / skill file / step binding must stop
// the deploy at startup, not surface as 500s at request time.
try {
  getWorkflowCatalog();
} catch (err) {
  console.error('[Workflow Catalog Error]', err instanceof Error ? err.message : err);
  process.exit(1);
}

const PORT = env.API_PORT;

app.listen(PORT, () => {
  console.log(`\n🎨 Grafista AI Studio API running on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health\n`);
});

// Phase 3 Step 5A — render queue worker (in-process polling loop). No-op
// unless RENDER_QUEUE_ENABLED=true (see services/render-queue-env.ts).
// Deliberately started here (the real server entry point), NOT in app.ts
// (which the Vitest suite imports directly) — the test suite never sets
// this flag, so it never gets a background timer touching the test DB.
startRenderWorkerLoop();

export default app;
