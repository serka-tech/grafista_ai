/**
 * Grafista AI Studio — Client Access Guard (Phase 3 Step 4: client isolation
 * hardening)
 *
 * Route-level `requirePermission()` (see middleware.ts) only checks a GLOBAL
 * permission bit — it never checks whether the specific client/record the
 * caller is touching is one they're actually scoped to. This module adds
 * that second, orthogonal check, meant to be called from the SERVICE layer
 * (not just routes) right after a record's owning clientId is known — e.g.
 * immediately after `store.productionJobs.getById(id)` resolves a row with a
 * `.clientId`, before any further work happens on it.
 *
 * Membership model (see client_members table, 021_client_members.sql):
 *   - A user with ZERO client_members rows is UNRESTRICTED — this preserves
 *     today's pre-existing behavior for every current/seeded user exactly
 *     as-is (nobody gets a row by default), so this hardening step cannot
 *     silently lock anyone out of data they could already reach.
 *   - A user with ONE OR MORE rows is restricted to exactly those clients.
 *
 * Error semantics: a resource that exists but belongs to a client the caller
 * isn't scoped to is treated EXACTLY like a resource that doesn't exist at
 * all — a plain 404 with a generic message, reusing this codebase's existing
 * "<Resource> not found" shape (see routes/production-jobs.ts,
 * routes/render-jobs.ts). This avoids leaking WHETHER a given id belongs to
 * some other client (a 403-with-detail would confirm existence to an
 * unauthorized caller); it also means callers don't need a separate branch —
 * "not found" and "not yours" are deliberately indistinguishable from the
 * outside.
 */

import { clientMembersRepo } from '../db/repositories/client-members.js';

/** Thrown by assertClientAccessible(); carries `.status = 404` for the central errorHandler. */
export class ClientAccessDeniedError extends Error {
  status = 404;
  constructor(message = 'Resource not found') {
    super(message);
    this.name = 'ClientAccessDeniedError';
  }
}

/**
 * Throws ClientAccessDeniedError (404) if `userId` is membership-restricted
 * and `clientId` is not one of their assigned clients. A no-op (never
 * throws) when the user has no membership rows at all (unrestricted) or
 * when `clientId` is nullish (nothing to scope on — the caller's own
 * not-found check for the parent record already applies).
 *
 * Takes a bare `userId` (not the full UserWithAccess) deliberately — every
 * existing route/service already threads a plain `requestedBy: string`
 * (`req.user!.id`) through to services (see layout-generation.ts,
 * production-package-builder.ts, render-engine.ts), so this slots in
 * without adding a new parameter shape anywhere.
 */
export async function assertClientAccessible(userId: string, clientId: string | null | undefined): Promise<void> {
  if (!clientId) return;
  const restrictedTo = await clientMembersRepo.listClientIdsForUser(userId);
  if (restrictedTo.length === 0) return; // unrestricted — no membership rows defined for this user
  if (!restrictedTo.includes(clientId)) {
    throw new ClientAccessDeniedError();
  }
}
