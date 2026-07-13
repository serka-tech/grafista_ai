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
import { orgRouter } from './routes/org.js';
import { clientsRouter } from './routes/clients.js';
import { brandAssetsRouter } from './routes/brand-assets.js';
import { designReferencesRouter } from './routes/design-references.js';
import { designDnaRouter } from './routes/design-dna.js';
import { contentIdeasRouter } from './routes/content-ideas.js';
import { approvalsRouter } from './routes/approvals.js';
import { designBriefsRouter } from './routes/design-briefs.js';
import { layoutPlansRouter, clientLayoutPlansRouter } from './routes/layout-plans.js';
import { creativeQaRouter, clientCreativeQaRouter } from './routes/creative-qa.js';
import { visualGenerationRouter } from './routes/visual-generation.js';
import { productionJobsRouter } from './routes/production-jobs.js';
import { renderJobsRouter } from './routes/render-jobs.js';
import { listingCardsRouter } from './routes/listing-cards.js';
import { outputsRouter } from './routes/outputs.js';
import { settingsRouter } from './routes/settings.js';
import { workflowsRouter } from './routes/workflows.js';
import { workflowRunsRouter } from './routes/workflow-runs.js';
import { analyticsRouter } from './routes/analytics.js';
import { revisionsRouter } from './routes/revisions.js';
import { healthRouter } from './routes/health.js';
import { errorHandler } from './middleware/error-handler.js';
import { installDebugRoutesMiddleware } from './middleware/debug-routes.js';
import { securityHeaders } from './middleware/security-headers.js';
import { generalLimiter } from './middleware/rate-limit.js';

export const app: Express = express();

// Never advertise the framework/version (Production go-live M2.2 — helmet does this too).
app.disable('x-powered-by');

// Behind a reverse proxy (Render), TRUST_PROXY must describe the proxy topology so
// req.ip resolves to the REAL client IP (used by the rate limiter) instead of the
// proxy's — and so a spoofed X-Forwarded-For leftmost hop can't be used to evade
// limits. Set TRUST_PROXY=1 on Render (one proxy hop). Unset (default) trusts
// nothing, which is correct for direct/local connections. Accepts a numeric hop
// count or any Express trust-proxy value (e.g. a subnet).
const trustProxy = process.env.TRUST_PROXY?.trim();
if (trustProxy) {
  app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
}

// Opt-in diagnostic logging for the intermittent bare-405 flake (Production Step 5).
// No-op unless CI_DEBUG_ROUTES=1 is set — see middleware/debug-routes.ts doc comment.
// Mounted first, before cors/cookie-parser/json, so it reflects the raw incoming request.
installDebugRoutesMiddleware(app);

// Security response headers on every response, before anything else runs
// (Production go-live M2.2 — see middleware/security-headers.ts).
app.use(securityHeaders);

// Middleware
app.use(cors({ origin: process.env.API_CORS_ORIGIN ?? 'http://localhost:3000', credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
// NOTE: uploaded files are intentionally NOT served via express.static — that would expose
// brand assets/design references to anyone with the URL, no auth check. Files are only
// reachable through the authenticated, permission-checked `/file` routes in
// brand-assets.ts / design-references.ts (see storage/file-service.ts).

// Health / readiness — GET /api/health is UNCHANGED (relocated verbatim into
// health.ts for file organization); GET /api/health/ready is new (Production
// Readiness Step — see health.ts's own doc comment).
app.use('/api', healthRouter);
// Root aliases: GET /health and GET /health/ready, byte-identical public probes
// at the root path. Some deployment platforms probe /health rather than
// /api/health; mounting the same router at root (in addition to /api above)
// serves both without duplicating the handler. No auth. Non-health paths just
// fall through this mount (the router only matches /health and /health/ready).
app.use(healthRouter);

// General rate limiter on the API surface (Production go-live M2.2). Mounted
// AFTER the health/readiness probes above so they are never throttled, and
// BEFORE the routers below so every business route is covered. No-op unless
// RATE_LIMIT_ENABLED !== 'false' (the login route adds a stricter limiter).
app.use('/api', generalLimiter);

// Routes
app.use('/api', authRouter);
app.use('/api/org', orgRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/clients', brandAssetsRouter);
app.use('/api/clients', designReferencesRouter);
app.use('/api/clients', designDnaRouter);
app.use('/api/clients', contentIdeasRouter);
app.use('/api', approvalsRouter);
app.use('/api', designBriefsRouter);
app.use('/api', layoutPlansRouter);
app.use('/api/clients', clientLayoutPlansRouter);
app.use('/api', creativeQaRouter);
app.use('/api/clients', clientCreativeQaRouter);
app.use('/api', visualGenerationRouter);
app.use('/api', productionJobsRouter);
app.use('/api', renderJobsRouter);
app.use('/api/clients', listingCardsRouter);
app.use('/api', outputsRouter);
app.use('/api', settingsRouter);
app.use('/api/workflows', workflowsRouter);
app.use('/api/workflow-runs', workflowRunsRouter);
app.use('/api/clients', analyticsRouter);
app.use('/api/clients', revisionsRouter);

// Error handler
app.use(errorHandler);
