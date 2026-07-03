/**
 * Grafista AI Studio — API Server
 */

import { env } from './config/env.js';
import { app } from './app.js';
import { getWorkflowCatalog } from './workflows/catalog.js';

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

export default app;
