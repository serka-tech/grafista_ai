/**
 * Grafista AI Studio — Express App (no listener)
 *
 * Split from index.ts so tests can import the configured app without
 * binding a real port.
 */

import express, { type Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { authRouter } from './routes/auth.js';
import { clientsRouter } from './routes/clients.js';
import { brandAssetsRouter } from './routes/brand-assets.js';
import { designReferencesRouter } from './routes/design-references.js';
import { designDnaRouter } from './routes/design-dna.js';
import { contentIdeasRouter } from './routes/content-ideas.js';
import { approvalsRouter } from './routes/approvals.js';
import { designBriefsRouter } from './routes/design-briefs.js';
import { outputsRouter } from './routes/outputs.js';
import { settingsRouter } from './routes/settings.js';
import { workflowsRouter } from './routes/workflows.js';
import { errorHandler } from './middleware/error-handler.js';

export const app: Express = express();

// Middleware
app.use(cors({ origin: process.env.API_CORS_ORIGIN ?? 'http://localhost:3000', credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
// NOTE: uploaded files are intentionally NOT served via express.static — that would expose
// brand assets/design references to anyone with the URL, no auth check. Files are only
// reachable through the authenticated, permission-checked `/file` routes in
// brand-assets.ts / design-references.ts (see storage/file-service.ts).

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'grafista-ai-studio-api',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  });
});

// Routes
app.use('/api', authRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/clients', brandAssetsRouter);
app.use('/api/clients', designReferencesRouter);
app.use('/api/clients', designDnaRouter);
app.use('/api/clients', contentIdeasRouter);
app.use('/api', approvalsRouter);
app.use('/api', designBriefsRouter);
app.use('/api', outputsRouter);
app.use('/api', settingsRouter);
app.use('/api/workflows', workflowsRouter);

// Error handler
app.use(errorHandler);
