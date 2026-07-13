import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { store } from '../data/store.js';
import { usersRepo } from '../db/repositories/users.js';
import { invitesRepo } from '../db/repositories/invites.js';
import { clientMembersRepo } from '../db/repositories/client-members.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { generateSessionToken, hashSessionToken } from '../auth/session-token.js';
import { ROLES } from '../auth/permissions.js';

/**
 * Packaging Phase A — organization (team) management. EVERY route here:
 *   - requires the org:manage permission (OWNER-only, 028 migration), and
 *   - operates strictly on req.user.organizationId — the caller never supplies
 *     an org id, so cross-org escalation is impossible.
 *
 * There is deliberately NO public signup: the only way to add a user is an
 * invite (POST /invites) accepted via POST /api/auth/accept-invite. Invite
 * emails are Phase B — this endpoint RETURNS the accept link for the OWNER to
 * share manually.
 */
export const orgRouter: Router = Router();

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Router-level gate: auth + org:manage on every route below.
orgRouter.use(requireAuth, requirePermission('org:manage'));

const RoleSchema = z.enum(ROLES);
const InviteSchema = z.object({ email: z.string().email(), role: RoleSchema });
const SetRoleSchema = z.object({ role: RoleSchema });
const SetStatusSchema = z.object({ status: z.enum(['active', 'disabled']) });
const AssignClientSchema = z.object({ clientId: z.string().uuid() });

/**
 * Loads a target user and confirms it belongs to the caller's org. Returns the
 * user, or null after having already sent a 404 (indistinguishable from
 * "not found", leaking nothing about other orgs' users).
 */
async function loadSameOrgUser(req: Request, res: Response, targetId: string) {
  const target = await usersRepo.getById(targetId);
  if (!target || target.organizationId !== req.user!.organizationId) {
    res.status(404).json({ error: 'User not found' });
    return null;
  }
  return target;
}

// GET /api/org/users — team roster (users of the caller's org + their roles)
orgRouter.get(
  '/users',
  asyncHandler(async (req: Request, res: Response) => {
    const users = await usersRepo.listByOrg(req.user!.organizationId);
    res.json({ data: users, total: users.length });
  })
);

// GET /api/org/invites — pending (unaccepted, unexpired) invites for the org
orgRouter.get(
  '/invites',
  asyncHandler(async (req: Request, res: Response) => {
    const invites = await invitesRepo.listPendingByOrg(req.user!.organizationId);
    res.json({ data: invites, total: invites.length });
  })
);

// POST /api/org/invites { email, role } — create an invite; returns the accept link
orgRouter.post(
  '/invites',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = InviteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body', issues: parsed.error.issues });
    }
    const { email, role } = parsed.data;

    // Email is globally unique — an existing user cannot be re-invited.
    const existing = await usersRepo.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Bu e-posta ile bir kullanıcı zaten kayıtlı.' });
    }

    const token = generateSessionToken();
    const invite = await invitesRepo.create({
      id: uuid(),
      organizationId: req.user!.organizationId,
      email,
      role,
      tokenHash: hashSessionToken(token),
      invitedBy: req.user!.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });

    // The dashboard prepends its own origin to acceptPath (the API does not know
    // the public dashboard URL). The raw token is returned ONCE, here only.
    res.status(201).json({
      data: {
        invite,
        token,
        acceptPath: `/accept-invite?token=${encodeURIComponent(token)}`,
      },
    });
  })
);

// POST /api/org/users/:id/roles { role } — replace the target user's role
orgRouter.post(
  '/users/:id/roles',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = SetRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body', issues: parsed.error.issues });
    }
    if (req.params.id === req.user!.id) {
      return res.status(400).json({ error: 'Kendi rolünüzü buradan değiştiremezsiniz (kilitlenmeyi önlemek için).' });
    }
    const target = await loadSameOrgUser(req, res, req.params.id);
    if (!target) return;

    await usersRepo.replaceRole(target.id, parsed.data.role);
    res.json({ data: { id: target.id, role: parsed.data.role } });
  })
);

// PATCH /api/org/users/:id { status } — enable/disable a user
orgRouter.patch(
  '/users/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = SetStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body', issues: parsed.error.issues });
    }
    if (req.params.id === req.user!.id) {
      return res.status(400).json({ error: 'Kendi hesabınızı buradan devre dışı bırakamazsınız.' });
    }
    const target = await loadSameOrgUser(req, res, req.params.id);
    if (!target) return;

    const updated = await usersRepo.updateStatus(target.id, parsed.data.status);
    res.json({ data: { id: updated!.id, status: updated!.status } });
  })
);

// GET /api/org/users/:id/clients — client ids the user is scoped to (empty = all)
orgRouter.get(
  '/users/:id/clients',
  asyncHandler(async (req: Request, res: Response) => {
    const target = await loadSameOrgUser(req, res, req.params.id);
    if (!target) return;
    const clientIds = await clientMembersRepo.listClientIdsForUser(target.id);
    res.json({ data: clientIds, total: clientIds.length });
  })
);

// POST /api/org/users/:id/clients { clientId } — scope a user to a client
orgRouter.post(
  '/users/:id/clients',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = AssignClientSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body', issues: parsed.error.issues });
    }
    const target = await loadSameOrgUser(req, res, req.params.id);
    if (!target) return;

    const client = await store.clients.getById(parsed.data.clientId);
    if (!client || client.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Client not found' });
    }

    await clientMembersRepo.addMember(target.id, client.id);
    res.status(201).json({ data: { userId: target.id, clientId: client.id } });
  })
);

// DELETE /api/org/users/:id/clients/:clientId — un-scope a user from a client
orgRouter.delete(
  '/users/:id/clients/:clientId',
  asyncHandler(async (req: Request, res: Response) => {
    const target = await loadSameOrgUser(req, res, req.params.id);
    if (!target) return;
    await clientMembersRepo.removeMember(target.id, req.params.clientId);
    res.json({ data: { userId: target.id, clientId: req.params.clientId, removed: true } });
  })
);
