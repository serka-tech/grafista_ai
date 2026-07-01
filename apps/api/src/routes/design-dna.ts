import { Router, Request, Response } from 'express';
import { store } from '../data/store.js';

export const designDnaRouter: Router = Router();

// GET /api/clients/:clientId/design-dna
designDnaRouter.get('/:clientId/design-dna', (req: Request, res: Response) => {
  const dna = store.designDNA.findByClientId(req.params.clientId);
  if (!dna) return res.status(404).json({ error: 'Design DNA not found. Run analysis first.' });
  res.json({ data: dna });
});

// POST /api/clients/:clientId/design-dna/analyze — trigger analysis
designDnaRouter.post('/:clientId/design-dna/analyze', async (req: Request, res: Response) => {
  const client = await store.clients.getById(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  // In MVP, return mock analysis result
  const existing = store.designDNA.findByClientId(req.params.clientId);
  if (existing) {
    return res.json({
      data: existing,
      message: 'Design DNA already exists. In production, this would re-analyze references.',
    });
  }

  res.json({
    message: 'Analysis queued. In production, the ingestion worker would process uploaded design references and generate Design DNA.',
    status: 'mock_queued',
  });
});
