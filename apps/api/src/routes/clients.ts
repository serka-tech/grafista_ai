import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { store } from '../data/store.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';

export const clientsRouter: Router = Router();

// GET /api/clients — list all
clientsRouter.get('/', requireAuth, requirePermission('clients:read'), async (_req: Request, res: Response) => {
  const clients = await store.clients.listWithCounts();
  const withDna = clients.map((c) => ({ ...c, hasDNA: store.designDNA.hasForClient(c.id) }));
  res.json({ data: withDna, total: withDna.length });
});

// GET /api/clients/:id — get by id
clientsRouter.get('/:id', requireAuth, requirePermission('clients:read'), async (req: Request, res: Response) => {
  const client = await store.clients.getById(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json({ data: client });
});

// POST /api/clients — create
clientsRouter.post('/', requireAuth, requirePermission('clients:create'), async (req: Request, res: Response) => {
  const { name, industry, website, contactName, contactEmail, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const client = await store.clients.create({
    id: uuid(),
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    industry,
    website,
    contactName,
    contactEmail,
    notes,
  });
  res.status(201).json({ data: client });
});

// PUT /api/clients/:id — update
clientsRouter.put('/:id', requireAuth, requirePermission('clients:update'), async (req: Request, res: Response) => {
  const client = await store.clients.getById(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const updated = await store.clients.update(req.params.id, req.body);
  res.json({ data: updated });
});
