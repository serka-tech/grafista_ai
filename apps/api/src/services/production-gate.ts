/**
 * Grafista AI Studio — Visual Production Pipeline Gate (Phase 2 Step 5B, Part G)
 *
 * PLACEHOLDER FOR A FUTURE PHASE — visual generation / Photoshop production do not exist
 * yet in this codebase. Nothing calls this function today. It is added now, tested, and
 * ready to import so that whichever future phase implements visual generation /
 * Photoshop production can simply call `assertReadyForVisualProduction(layoutPlanId)` as
 * its first line and get a correct, already-tested 409 gate for free — it should not need
 * to re-derive "has this layout plan cleared Creative QA?" logic from scratch.
 *
 * Gate rule: at least one Creative QA report for the given layout plan must be in status
 * 'approved' or 'passed'. 'approved' is a human's explicit sign-off (via POST
 * /api/creative-qa/:id/approve); 'passed' is the AI's own verdict at generation time
 * (overallScore >= passThreshold) which a human has not yet overridden either way. Both
 * are treated as "cleared for production" — 'failed', 'rejected', 'needs_revision', and
 * 'generated' (a defensive-only status not currently reachable in practice) are not.
 */

import { store } from '../data/store.js';

const CLEARED_STATUSES = new Set(['approved', 'passed']);

/**
 * Throws a structured 409 error unless at least one Creative QA report for this layout
 * plan is 'approved' or 'passed'. Resolves (void) when the gate is clear.
 */
export async function assertReadyForVisualProduction(layoutPlanId: string): Promise<void> {
  const reports = await store.creativeQaReports.listByLayoutPlan(layoutPlanId);
  const hasClearedReport = reports.some((report) => CLEARED_STATUSES.has(report.status));

  if (!hasClearedReport) {
    throw Object.assign(
      new Error(
        `Layout plan ${layoutPlanId} is not ready for visual production — no Creative QA report is in ` +
          `'approved' or 'passed' status yet`
      ),
      { status: 409 }
    );
  }
}

// ─── Production-job gate (Phase 2 Step 8A) ───────────────────────────────────

/** Only a generated output whose FILE actually exists in storage may enter production —
 * 'pending' (bytes not persisted yet) and 'failed' (no bytes at all) are both rejected. */
const PRODUCTION_READY_OUTPUT_STATUSES = new Set(['generated']);

/**
 * Whether a human approval (approval_status = 'approved') is ALSO required before an
 * output may enter production. Deliberately OFF for the MVP: the business rule from the
 * task only demands the file exist (status 'generated'); requiring human approval too is
 * a plausible future tightening, so it lives here as a single flip-of-a-constant rather
 * than a baked-in assumption spread across call sites.
 */
const REQUIRE_APPROVED_OUTPUT_FOR_PRODUCTION = false;

/**
 * Gate for buildProductionPackage() — must stay its first await, mirroring how
 * assertReadyForVisualProduction() gates runVisualGeneration(). Throws a structured 404
 * when the generated output does not exist, and a structured 409 unless its production
 * (file) status is 'generated'. Resolves (void) when the gate is clear.
 */
export async function assertGeneratedOutputReadyForProduction(generatedOutputId: string): Promise<void> {
  const output = await store.generatedOutputs.getById(generatedOutputId);

  if (!output) {
    throw Object.assign(new Error(`Generated output ${generatedOutputId} not found`), { status: 404 });
  }

  if (!PRODUCTION_READY_OUTPUT_STATUSES.has(output.status)) {
    throw Object.assign(
      new Error(
        `Generated output ${generatedOutputId} is not ready for production — its status is ` +
          `'${output.status}', but only a 'generated' output (file safely in storage) can be sent to production`
      ),
      { status: 409 }
    );
  }

  if (REQUIRE_APPROVED_OUTPUT_FOR_PRODUCTION && output.approvalStatus !== 'approved') {
    throw Object.assign(
      new Error(
        `Generated output ${generatedOutputId} is not ready for production — human approval is required ` +
          `but its approval status is '${output.approvalStatus}'`
      ),
      { status: 409 }
    );
  }
}
