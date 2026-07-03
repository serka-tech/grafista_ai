import { Router, Request, Response } from 'express';
import { store } from '../data/store.js';
import {
  runContentIdeation,
  ContentIdeationRequestSchema,
  type AiErrorKind,
} from '../services/content-ideation.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';

export const contentIdeasRouter: Router = Router();

const BodySchema = ContentIdeationRequestSchema;

// GET /api/clients/:clientId/content-ideas
contentIdeasRouter.get(
  '/:clientId/content-ideas',
  requireAuth,
  requirePermission('clients:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const ideas = await store.contentIdeas.listByClient(req.params.clientId, status);
    res.json({ data: ideas, total: ideas.length });
  })
);

// POST /api/clients/:clientId/content-ideas — generate ideas via a real AI provider call
// (logic extracted into services/content-ideation.ts for the workflow engine; the
// response contract here — including the bespoke 502 bodies — is unchanged).
contentIdeasRouter.post(
  '/:clientId/content-ideas',
  requireAuth,
  requirePermission('content_ideas:create'),
  asyncHandler(async (req: Request, res: Response) => {
  const client = await store.clients.getById(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const parsedBody = BodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: 'Invalid request body', issues: parsedBody.error.issues });
  }

  try {
    const result = await runContentIdeation(client.id, req.user!.id, parsedBody.data);
    return res.status(201).json({ data: result.ideas, total: result.ideas.length, provider: result.provider, model: result.model });
  } catch (err) {
    const aiErr = err as Error & { aiErrorKind?: AiErrorKind; aiProvider?: string };
    if (aiErr.aiErrorKind === 'provider') {
      return res.status(502).json({
        error: 'AI provider error',
        provider: aiErr.aiProvider,
        message: aiErr.message,
      });
    }
    if (aiErr.aiErrorKind === 'parsing') {
      return res.status(502).json({
        error: 'AI response parsing error',
        provider: aiErr.aiProvider,
        message: aiErr.message,
      });
    }
    throw err;
  }
  })
);
