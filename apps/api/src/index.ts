/**
 * Grafista AI Studio — API Server
 */

import { env } from './config/env.js';
import { app } from './app.js';

const PORT = env.API_PORT;

app.listen(PORT, () => {
  console.log(`\n🎨 Grafista AI Studio API running on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health\n`);
});

export default app;
