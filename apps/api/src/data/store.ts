/**
 * Grafista AI Studio — Data Access Composition
 *
 * Phase 2 Step 1: clients, brand_assets, design_references, content_ideas,
 * approvals, and design_briefs are backed by real PostgreSQL (see
 * ../db/repositories/*). Phase 2 Step 4 moves Design DNA (and its
 * per-reference style analyses) onto real PostgreSQL too, backed by real AI
 * vision analysis (see ../services/design-dna-analysis.ts) — the previous
 * in-memory mock (../db/design-dna-store.ts) is fully retired.
 *
 * All repositories are async; every call site must be awaited.
 */

import { clientsRepo } from '../db/repositories/clients.js';
import { brandAssetsRepo } from '../db/repositories/brand-assets.js';
import { designReferencesRepo } from '../db/repositories/design-references.js';
import { contentIdeasRepo } from '../db/repositories/content-ideas.js';
import { approvalsRepo } from '../db/repositories/approvals.js';
import { designBriefsRepo } from '../db/repositories/design-briefs.js';
import { designAnalysisRepo, designDnaRepo } from '../db/repositories/design-dna.js';
import { layoutPlansRepo } from '../db/repositories/layout-plans.js';
import { creativeQaReportsRepo } from '../db/repositories/creative-qa.js';
import { generatedOutputsRepo } from '../db/repositories/generated-outputs.js';
import { productionJobsRepo } from '../db/repositories/production-jobs.js';
import { renderJobsRepo } from '../db/repositories/render-jobs.js';
import { exportArtifactsRepo } from '../db/repositories/export-artifacts.js';
import { analyticsEventsRepo } from '../db/repositories/analytics-events.js';
import { workflowRunsRepo } from '../db/repositories/workflow-runs.js';
import { workflowStepsRepo } from '../db/repositories/workflow-steps.js';
import { workflowStepOutputsRepo } from '../db/repositories/workflow-step-outputs.js';
import { workflowApprovalsRepo } from '../db/repositories/workflow-approvals.js';

export const store = {
  clients: clientsRepo,
  brandAssets: brandAssetsRepo,
  designReferences: designReferencesRepo,
  contentIdeas: contentIdeasRepo,
  approvals: approvalsRepo,
  designBriefs: designBriefsRepo,
  designAnalysis: designAnalysisRepo,
  designDna: designDnaRepo,
  layoutPlans: layoutPlansRepo,
  creativeQaReports: creativeQaReportsRepo,
  generatedOutputs: generatedOutputsRepo,
  productionJobs: productionJobsRepo,
  renderJobs: renderJobsRepo,
  exportArtifacts: exportArtifactsRepo,
  analyticsEvents: analyticsEventsRepo,
  workflowRuns: workflowRunsRepo,
  workflowSteps: workflowStepsRepo,
  workflowStepOutputs: workflowStepOutputsRepo,
  workflowApprovals: workflowApprovalsRepo,
};
