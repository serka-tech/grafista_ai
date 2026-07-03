/**
 * Grafista AI Studio — Design Brief Creation Service (Phase 2 Step 6)
 *
 * Extracted 1:1 from the routes/design-briefs.ts POST handler so the
 * workflow engine can derive a brief without going through HTTP — the route
 * now delegates here and keeps its exact response contract (the 403 body
 * carries currentStatus + a how-to message; the route rebuilds it from the
 * currentStatus field attached to the thrown error). Pure derivation, no AI
 * call — same dimension map, same content/visual/brand element mapping.
 */

import { v4 as uuid } from 'uuid';
import { store } from '../data/store.js';
import type { DesignBrief } from '../db/repositories/design-briefs.js';

/** Platform dimension mapping (unchanged from the original route). */
const DIMENSION_MAP: Record<string, { width: number; height: number }> = {
  instagram_post: { width: 1080, height: 1080 },
  instagram_story: { width: 1080, height: 1920 },
  instagram_reel: { width: 1080, height: 1920 },
  instagram_carousel: { width: 1080, height: 1080 },
  facebook_post: { width: 1200, height: 630 },
  twitter_post: { width: 1200, height: 675 },
  linkedin_post: { width: 1200, height: 627 },
  youtube_thumbnail: { width: 1280, height: 720 },
};

/**
 * Derives and persists a DesignBrief from an APPROVED content idea. Throws
 * error-with-status: 400 missing id, 404 unknown idea, 403 (with a
 * `currentStatus` field) when the idea is not approved — the approval gate.
 */
export async function createDesignBriefFromContentIdea(contentIdeaId: string): Promise<DesignBrief> {
  if (!contentIdeaId) {
    throw Object.assign(new Error('contentIdeaId is required'), { status: 400 });
  }

  const idea = await store.contentIdeas.getById(contentIdeaId);
  if (!idea) {
    throw Object.assign(new Error('Content idea not found'), { status: 404 });
  }

  // ── APPROVAL GATE ──
  if (idea.status !== 'approved') {
    throw Object.assign(new Error('Content idea must be approved before creating a design brief'), {
      status: 403,
      currentStatus: idea.status,
    });
  }

  const dims = DIMENSION_MAP[idea.platform] ?? { width: 1080, height: 1080 };

  return store.designBriefs.create({
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
}
