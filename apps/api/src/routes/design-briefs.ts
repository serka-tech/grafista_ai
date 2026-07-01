import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { store } from '../data/store.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';

export const designBriefsRouter: Router = Router();

// POST /api/design-briefs — create (requires approved content idea)
designBriefsRouter.post('/design-briefs', requireAuth, requirePermission('design_briefs:create'), asyncHandler(async (req: Request, res: Response) => {
  const { contentIdeaId } = req.body;
  if (!contentIdeaId) return res.status(400).json({ error: 'contentIdeaId is required' });

  const idea = await store.contentIdeas.getById(contentIdeaId);
  if (!idea) return res.status(404).json({ error: 'Content idea not found' });

  // ── APPROVAL GATE ──
  if (idea.status !== 'approved') {
    return res.status(403).json({
      error: 'Content idea must be approved before creating a design brief',
      currentStatus: idea.status,
      message: 'Approve this content idea first via POST /api/content-ideas/:id/approve',
    });
  }

  // Platform dimension mapping
  const dimensionMap: Record<string, { width: number; height: number }> = {
    instagram_post: { width: 1080, height: 1080 },
    instagram_story: { width: 1080, height: 1920 },
    instagram_reel: { width: 1080, height: 1920 },
    instagram_carousel: { width: 1080, height: 1080 },
    facebook_post: { width: 1200, height: 630 },
    twitter_post: { width: 1200, height: 675 },
    linkedin_post: { width: 1200, height: 627 },
    youtube_thumbnail: { width: 1280, height: 720 },
  };

  const dims = dimensionMap[idea.platform] ?? { width: 1080, height: 1080 };

  const brief = await store.designBriefs.create({
    id: uuid(),
    clientId: idea.clientId,
    contentIdeaId: idea.id,
    approvalId: idea.approvalId!,
    title: `Brief: ${idea.title}`,
    objective: idea.description,
    platform: idea.platform,
    format: idea.format,
    dimensions: { ...dims, unit: 'px' },
    contentElements: {
      headline: idea.hook ?? idea.title,
      caption: idea.caption,
      callToAction: idea.callToAction,
      hashtags: idea.hashtags,
    },
    visualDirection: {
      mood: idea.toneOfVoice ?? 'professional',
      imageDirection: idea.visualDirection,
    },
    brandConstraints: {
      requiredElements: ['logo'],
    },
    aiImagePrompts: idea.aiImagePrompt ? [{ label: 'Main Image', prompt: idea.aiImagePrompt }] : [],
  });

  res.status(201).json({ data: brief });
}));

// GET /api/design-briefs/:id
designBriefsRouter.get('/design-briefs/:id', requireAuth, requirePermission('clients:read'), asyncHandler(async (req: Request, res: Response) => {
  const brief = await store.designBriefs.getById(req.params.id);
  if (!brief) return res.status(404).json({ error: 'Design brief not found' });

  const idea = await store.contentIdeas.getById(brief.contentIdeaId);
  const client = await store.clients.getById(brief.clientId);

  res.json({ data: { ...brief, contentIdea: idea, client } });
}));

// GET /api/design-briefs — list all
designBriefsRouter.get('/design-briefs', requireAuth, requirePermission('clients:read'), asyncHandler(async (_req: Request, res: Response) => {
  const briefs = await store.designBriefs.list();
  res.json({ data: briefs, total: briefs.length });
}));
