/**
 * Grafista AI Studio — Data Access Composition
 *
 * Phase 2 Step 1: clients, brand_assets, design_references, content_ideas,
 * approvals, and design_briefs are now backed by real PostgreSQL (see
 * ../db/repositories/*). Design DNA remains an intentional, explicitly
 * out-of-scope in-memory store (see ../db/design-dna-store.ts) — vision
 * analysis and its persistence are not part of this migration step.
 *
 * All repositories are async; every call site must be awaited.
 */

import { clientsRepo } from '../db/repositories/clients.js';
import { brandAssetsRepo } from '../db/repositories/brand-assets.js';
import { designReferencesRepo } from '../db/repositories/design-references.js';
import { contentIdeasRepo } from '../db/repositories/content-ideas.js';
import { approvalsRepo } from '../db/repositories/approvals.js';
import { designBriefsRepo } from '../db/repositories/design-briefs.js';
import { designDnaStore } from '../db/design-dna-store.js';

export const store = {
  clients: clientsRepo,
  brandAssets: brandAssetsRepo,
  designReferences: designReferencesRepo,
  contentIdeas: contentIdeasRepo,
  approvals: approvalsRepo,
  designBriefs: designBriefsRepo,
  designDNA: designDnaStore,
};
