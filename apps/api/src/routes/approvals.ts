import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { store } from '../data/store.js';

export const approvalsRouter: Router = Router();

// GET /api/approvals — list pending approvals
approvalsRouter.get('/approvals', (_req: Request, res: Response) => {
  // Find all content ideas pending approval
  const pendingIdeas = Array.from(store.contentIdeas.values())
    .filter((i) => i.status === 'pending_approval')
    .map((idea) => ({
      entityType: 'content_idea',
      entityId: idea.id,
      clientId: idea.clientId,
      clientName: store.clients.get(idea.clientId)?.name,
      title: idea.title,
      status: 'pending',
      createdAt: idea.createdAt,
    }));

  res.json({ data: pendingIdeas, total: pendingIdeas.length });
});

// POST /api/content-ideas/:id/approve
approvalsRouter.post('/content-ideas/:id/approve', (req: Request, res: Response) => {
  const idea = store.contentIdeas.get(req.params.id);
  if (!idea) return res.status(404).json({ error: 'Content idea not found' });

  const now = new Date().toISOString();
  const approval = {
    id: uuid(),
    entityType: 'content_idea',
    entityId: idea.id,
    clientId: idea.clientId,
    status: 'approved',
    reviewerRole: req.body.reviewerRole ?? 'creative_director',
    reviewerName: req.body.reviewerName,
    notes: req.body.notes,
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  store.approvals.set(approval.id, approval);
  idea.status = 'approved';
  idea.approvalId = approval.id;
  idea.updatedAt = now;

  res.json({ data: { approval, idea } });
});

// POST /api/content-ideas/:id/reject
approvalsRouter.post('/content-ideas/:id/reject', (req: Request, res: Response) => {
  const idea = store.contentIdeas.get(req.params.id);
  if (!idea) return res.status(404).json({ error: 'Content idea not found' });

  const now = new Date().toISOString();
  idea.status = req.body.revisionNotes ? 'revision_requested' : 'rejected';
  idea.updatedAt = now;

  const approval = {
    id: uuid(),
    entityType: 'content_idea',
    entityId: idea.id,
    clientId: idea.clientId,
    status: idea.status === 'revision_requested' ? 'revision_requested' : 'rejected',
    reviewerRole: req.body.reviewerRole ?? 'creative_director',
    notes: req.body.notes,
    revisionNotes: req.body.revisionNotes,
    rejectedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  store.approvals.set(approval.id, approval);

  res.json({ data: { approval, idea } });
});
