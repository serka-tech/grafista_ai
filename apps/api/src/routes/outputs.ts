import { Router, Request, Response } from 'express';
import { requireAuth, requirePermission } from '../auth/middleware.js';

export const outputsRouter: Router = Router();

// GET /api/outputs — cross-client aggregate listing (still a stub; same response
// shape as before, only the copy changed). Real generated outputs DO exist since
// Phase 2 Step 7 — they just live under their layout plans, not here.
outputsRouter.get('/outputs', requireAuth, (_req: Request, res: Response) => {
  res.json({
    data: [],
    total: 0,
    message:
      "Generated visuals live under their layout plans — open a design brief's layout plans page in the dashboard, " +
      'or GET /api/layout-plans/:layoutPlanId/visual-generation. This aggregate endpoint is not implemented yet.',
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
