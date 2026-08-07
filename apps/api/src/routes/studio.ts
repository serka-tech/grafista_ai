import { Router, Request, Response } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { listSectors } from '../sectors/catalog.js';

export const studioRouter: Router = Router();

/**
 * GET /api/sectors — the sector picker's data source.
 *
 * Returns a curated view rather than the raw definitions. `backgroundStyle`
 * and `forbidden` shape the prompts we send to the model and have no place in
 * a client payload; `hashtags` and `bestPostingTimes` are applied server-side
 * when the plan is generated. What the setup screen needs is the answer to
 * "if I pick this, what will it write about?", which is the pillar list and
 * its sample topics.
 */
studioRouter.get('/sectors', requireAuth, (_req: Request, res: Response) => {
  const sectors = listSectors().map((sector) => ({
    key: sector.key,
    label: sector.label,
    tone: sector.tone.primary,
    postsPerWeek: sector.cadence.postsPerWeek,
    pillars: sector.contentPillars.map((pillar) => ({
      key: pillar.key,
      label: pillar.label,
      weight: pillar.weight,
      sampleTopics: pillar.sampleTopics,
    })),
  }));

  res.json({ data: sectors });
});
