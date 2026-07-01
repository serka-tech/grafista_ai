import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { store } from '../data/store.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';

export const approvalsRouter: Router = Router();

// GET /api/approvals — list pending approvals
approvalsRouter.get(
  '/approvals',
  requireAuth,
  requirePermission('content_ideas:approve'),
  async (_req: Request, res: Response) => {
    const pendingIdeas = await store.approvals.listPendingContentIdeas();
    res.json({ data: pendingIdeas, total: pendingIdeas.length });
  }
);

// POST /api/content-ideas/:id/approve
approvalsRouter.post(
  '/content-ideas/:id/approve',
  requireAuth,
  requirePermission('content_ideas:approve'),
  async (req: Request, res: Response) => {
    const idea = await store.contentIdeas.getById(req.params.id);
    if (!idea) return res.status(404).json({ error: 'Content idea not found' });

    const approval = await store.approvals.create({
      id: uuid(),
      entityType: 'content_idea',
      entityId: idea.id,
      clientId: idea.clientId,
      status: 'approved',
      reviewerRole: req.body.reviewerRole ?? 'creative_director',
      reviewerName: req.body.reviewerName,
      notes: req.body.notes,
      approvedAt: new Date(),
    });
    const updatedIdea = await store.contentIdeas.setApprovalOutcome(idea.id, 'approved', approval.id);

    res.json({ data: { approval, idea: updatedIdea } });
  }
);

// POST /api/content-ideas/:id/reject
approvalsRouter.post(
  '/content-ideas/:id/reject',
  requireAuth,
  requirePermission('content_ideas:approve'),
  async (req: Request, res: Response) => {
    const idea = await store.contentIdeas.getById(req.params.id);
    if (!idea) return res.status(404).json({ error: 'Content idea not found' });

    const newStatus = req.body.revisionNotes ? 'revision_requested' : 'rejected';

    const approval = await store.approvals.create({
      id: uuid(),
      entityType: 'content_idea',
      entityId: idea.id,
      clientId: idea.clientId,
      status: newStatus,
      reviewerRole: req.body.reviewerRole ?? 'creative_director',
      notes: req.body.notes,
      revisionNotes: req.body.revisionNotes,
      rejectedAt: new Date(),
    });
    const updatedIdea = await store.contentIdeas.setApprovalOutcome(idea.id, newStatus, idea.approvalId ?? null);

    res.json({ data: { approval, idea: updatedIdea } });
  }
);
