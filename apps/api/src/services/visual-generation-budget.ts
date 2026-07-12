/**
 * Grafista AI Studio — Visual Generation Budget Guard (Production go-live M2.1)
 *
 * Enforces a per-client MONTHLY ceiling on paid AI image generation (KIE
 * nano-banana etc.) so a runaway or abusive request can never rack up unbounded
 * provider cost. Wired as the budget gate inside runVisualGeneration(), right
 * after the client-access check and BEFORE any provider call — a client that
 * has hit its ceiling never triggers a paid generation.
 *
 * COUNT-BASED, not cost-sum-based, and deliberately so: the KIE adapter bills
 * per task and returns no per-call estimatedCost (see
 * packages/model-router/src/providers/kie-ai.ts), so summing the analytics
 * `estimatedCost` field would read ~0 for real image spend. Instead we count
 * the client's successfully-generated outputs this calendar month and multiply
 * by a configured per-image cost — a durable, provider-independent proxy for
 * spend that reads from the generated_outputs table (best-effort analytics rows
 * are never the source of truth for money decisions).
 *
 * Every flag reads process.env directly on every call (no caching) — same
 * convention as render-queue-env.ts / storage/factory.ts, so tests can flip a
 * var mid-suite and see it take effect immediately. The guard is OFF unless
 * CLIENT_MONTHLY_BUDGET_USD is set to a positive number: every existing
 * deployment and the whole test suite keep today's behavior with zero config.
 */

import { store } from '../data/store.js';

/**
 * Default per-image cost estimate (USD) used only when KIE_IMAGE_COST_USD is
 * unset. A deliberately conservative placeholder — set KIE_IMAGE_COST_USD to
 * your provider's real per-image price for an accurate ceiling.
 */
const DEFAULT_KIE_IMAGE_COST_USD = 0.05;

/**
 * CLIENT_MONTHLY_BUDGET_USD — monthly per-client ceiling in USD. Returns null
 * (guard DISABLED, unchanged behavior) when unset, empty, non-numeric, or <= 0.
 */
export function getClientMonthlyBudgetUsd(): number | null {
  const raw = (process.env.CLIENT_MONTHLY_BUDGET_USD ?? '').trim();
  if (raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * KIE_IMAGE_COST_USD — assumed cost of one generated image, used for the
 * count-based budget math. Falls back to DEFAULT_KIE_IMAGE_COST_USD when unset
 * or invalid (never zero/negative — that would make the ceiling meaningless).
 */
export function getKieImageCostUsd(): number {
  const raw = Number(process.env.KIE_IMAGE_COST_USD ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_KIE_IMAGE_COST_USD;
}

function budgetError(message: string): Error & { status: number } {
  // 402 Payment Required — see middleware/error-handler.ts STATUS_LABELS.
  return Object.assign(new Error(message), { status: 402 });
}

/**
 * Throws HTTP 402 when the client has already reached its monthly AI-image
 * budget. No-op (returns immediately) when the guard is disabled
 * (CLIENT_MONTHLY_BUDGET_USD unset). Must run BEFORE the provider call so no
 * paid generation happens once the ceiling is hit.
 */
export async function assertWithinClientBudget(clientId: string): Promise<void> {
  const budget = getClientMonthlyBudgetUsd();
  if (budget === null) return; // guard disabled — unchanged behavior

  const costPerImage = getKieImageCostUsd();
  const generatedThisMonth = await store.generatedOutputs.countGeneratedThisMonth(clientId);
  const spent = generatedThisMonth * costPerImage;

  if (spent >= budget) {
    throw budgetError(
      `Monthly AI image budget reached for this client: ${generatedThisMonth} image(s) generated this month ` +
        `≈ $${spent.toFixed(2)} of the $${budget.toFixed(2)} limit. Image generation is paused until next ` +
        `month, or until the limit is raised (CLIENT_MONTHLY_BUDGET_USD).`
    );
  }
}
