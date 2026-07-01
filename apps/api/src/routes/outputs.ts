import { Router, Request, Response } from 'express';
import { requireAuth, requirePermission } from '../auth/middleware.js';

export const outputsRouter: Router = Router();

// GET /api/outputs — list generated outputs (placeholder for MVP)
outputsRouter.get('/outputs', requireAuth, (_req: Request, res: Response) => {
  // In MVP, no real outputs are generated
  res.json({
    data: [],
    total: 0,
    message: 'No outputs generated yet. Create and approve a design brief to generate outputs.',
  });
});

// POST /api/outputs/:id/final-approve — permission-gated stub.
// Output generation (layout/visual/photoshop production) is out of scope for this phase,
// so there is no real GeneratedOutput entity to approve yet. This route exists solely to
// enforce and prove the outputs:final_approve permission ahead of that feature landing.
outputsRouter.post('/outputs/:id/final-approve', requireAuth, requirePermission('outputs:final_approve'), (_req: Request, res: Response) => {
  res.json({
    message: 'Permission check passed. Output final-approval is not implemented yet — output generation is out of scope for this phase.',
    status: 'not_implemented',
  });
});
