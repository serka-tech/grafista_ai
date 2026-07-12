/**
 * Grafista AI Studio — Listing Card Service (go-live M6, direct-photo)
 *
 * Turns an uploaded property photo + listing details into a production-ready
 * `generated_output` (generationMethod 'uploaded'), so the ENTIRE existing
 * downstream (production package → render → composite the photo into the hero
 * slot → export) works UNCHANGED. See docs/direct-photo-listing-plan.md.
 *
 * Because the schema chain is NOT NULL all the way
 * (generated_output → design_brief → content_idea + approval, and
 * layout_plan → design_brief), this service auto-provisions a minimal approved
 * chain and inserts a curated real-estate layout (real-estate-template.ts) that
 * carries the hero image slot. No AI call happens; the budget guard (M2.1)
 * naturally does not apply.
 */

import { v4 as uuid } from 'uuid';
import type { GeneratedOutput } from '@grafista/schemas';
import { store } from '../data/store.js';
import { getStorageProvider } from '../storage/factory.js';
import { assertClientAccessible } from '../auth/client-access.js';
import { createDesignBriefFromContentIdea } from './design-brief-creation.js';
import { buildRealEstateListingLayout, type ListingFields, type ListingPreset } from './real-estate-template.js';

function notFound(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 404 });
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

function extensionForMime(mimeType: string): string {
  return MIME_EXTENSIONS[mimeType] ?? 'png';
}

export interface ListingCardInput {
  clientId: string;
  preset: ListingPreset;
  fields: ListingFields;
  file: { buffer: Buffer; mimetype: string; originalname?: string };
  requestedBy: string;
}

/**
 * Creates a listing card's `generated_output` from an uploaded photo. Returns the
 * output (status 'generated'), ready to be sent to production + render via the
 * existing endpoints — exactly like an AI-generated visual output.
 */
export async function createListingCard(input: ListingCardInput): Promise<GeneratedOutput> {
  const { clientId, preset, fields, file, requestedBy } = input;

  // Client isolation — same guard as every other client-scoped write.
  await assertClientAccessible(requestedBy, clientId);
  const client = await store.clients.getById(clientId);
  if (!client) throw notFound('Client not found');

  // Store the photo FIRST (the only external, failure-prone op) into the same
  // key space AI visuals use, so the downstream file route/composition are identical.
  const ext = extensionForMime(file.mimetype);
  const stored = await getStorageProvider().putObject({
    key: `generated-outputs/${clientId}/${uuid()}.${ext}`,
    body: file.buffer,
    contentType: file.mimetype,
  });

  // Auto-provision the minimal approved chain the NOT-NULL FKs require.
  const ideaId = uuid();
  await store.contentIdeas.create({
    id: ideaId,
    clientId,
    title: fields.title || 'İlan',
    description: `${fields.title} — ${fields.address}`.trim(),
    platform: preset, // instagram_post / instagram_story — valid DIMENSION_MAP keys
    format: 'single_image',
    hashtags: [],
    status: 'pending_approval',
    generatedBy: 'manual', // content_ideas.generated_by CHECK IN ('ai','manual')
  });

  const approvalId = uuid();
  await store.approvals.create({
    id: approvalId,
    entityType: 'content_idea',
    entityId: ideaId,
    clientId,
    status: 'approved',
    reviewerName: 'Listing Card (auto)',
    approvedAt: new Date(),
  });
  await store.contentIdeas.setApprovalOutcome(ideaId, 'approved', approvalId);

  // Reuse the exact brief-derivation mapping the normal flow uses.
  const brief = await createDesignBriefFromContentIdea(ideaId);

  // Curated real-estate layout (approved) — carries the hero image slot + text.
  const layoutContent = buildRealEstateListingLayout(preset, fields);
  const layout = await store.layoutPlans.create({
    id: uuid(),
    clientId,
    designBriefId: brief.id,
    contentIdeaId: ideaId,
    alternativeIndex: 1,
    status: 'approved',
    content: layoutContent,
    provider: 'template',
    model: 'real-estate-listing-v1',
    createdBy: requestedBy,
  });

  // The uploaded photo as a 'generated' output — the composited "selected visual".
  const outputId = uuid();
  const output = await store.generatedOutputs.create({
    id: outputId,
    clientId,
    designBriefId: brief.id,
    layoutPlanId: layout.id,
    type: 'preview_image',
    name: `İlan fotoğrafı — ${fields.title || 'İlan'}`,
    status: 'generated',
    generationMethod: 'uploaded',
    fileUrl: `/api/visual-outputs/${outputId}/file`,
    mimeType: file.mimetype,
    fileSizeBytes: file.buffer.length,
    storageProvider: stored.provider,
    storageBucket: stored.bucket,
    storageKey: stored.key,
    // dimensions intentionally omitted — we don't parse the photo; leaving it unset
    // skips the (info-only) aspect-mismatch warning against the slot.
    createdBy: requestedBy,
  });

  console.log(
    `[listing-card] created — clientId=${clientId} preset=${preset} outputId=${output.id} layoutId=${layout.id}`
  );

  return output;
}
