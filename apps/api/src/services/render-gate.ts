/**
 * Grafista AI Studio — Template Render Engine Gate (Phase 2 Step 9A)
 *
 * Mirrors production-gate.ts's style: a render can only ever be requested for
 * a production job whose package has actually been built (status
 * 'package_ready' or 'approved' — both mean the package bytes/manifest are in
 * place; 'approved' additionally means a human signed off, but that human
 * review step is not required to render). Anything else — 'pending'/
 * 'packaging' (not built yet), 'failed'/'cancelled'/'rejected' (never will
 * be, or explicitly should not be) — is a 409.
 */

import { store } from '../data/store.js';
import type { ProductionJob } from '@grafista/schemas';

const RENDER_READY_STATUSES = new Set<ProductionJob['status']>(['package_ready', 'approved']);

/**
 * Gate for renderProductionJob() — must stay its first data-fetching step
 * (after the domain-level permission guard). Throws a structured 404 when the
 * production job does not exist, and a structured 409 unless its status is
 * 'package_ready' or 'approved', or its package snapshot/storage coordinates
 * are missing (defensive — a package_ready/approved row should always have
 * both, per production-package-builder.ts). Returns the fetched production
 * job on success so the caller does not need a second fetch.
 */
export async function assertProductionJobReadyForRender(productionJobId: string): Promise<ProductionJob> {
  const productionJob = await store.productionJobs.getById(productionJobId);

  if (!productionJob) {
    throw Object.assign(new Error(`Production job ${productionJobId} not found`), { status: 404 });
  }

  if (!RENDER_READY_STATUSES.has(productionJob.status)) {
    throw Object.assign(
      new Error(
        `Production job ${productionJobId} is not ready for render — its status is ` +
          `'${productionJob.status}', but only a 'package_ready' or 'approved' job (package already built) can be rendered`
      ),
      { status: 409 }
    );
  }

  // Defensive last check — a package_ready/approved row should always carry
  // both fields per the production package builder, but a render must never
  // proceed against a job that claims readiness without an actual package.
  if (!productionJob.packageManifestSnapshot || !productionJob.packageStorageKey) {
    throw Object.assign(
      new Error(
        `Production job ${productionJobId} is missing its package manifest/storage key — cannot be rendered`
      ),
      { status: 409 }
    );
  }

  return productionJob;
}
