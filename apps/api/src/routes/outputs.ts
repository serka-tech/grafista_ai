import { Router, Request, Response } from 'express';

export const outputsRouter: Router = Router();

// GET /api/outputs — list generated outputs (placeholder for MVP)
outputsRouter.get('/outputs', (_req: Request, res: Response) => {
  // In MVP, no real outputs are generated
  res.json({
    data: [],
    total: 0,
    message: 'No outputs generated yet. Create and approve a design brief to generate outputs.',
  });
});
