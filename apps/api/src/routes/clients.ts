import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { store } from '../data/store.js';

export const clientsRouter: Router = Router();

// GET /api/clients — list all
clientsRouter.get('/', (_req: Request, res: Response) => {
  const clients = Array.from(store.clients.values()).map((c) => ({
    ...c,
    brandAssetsCount: Array.from(store.brandAssets.values()).filter((a) => a.clientId === c.id).length,
    designReferencesCount: Array.from(store.designReferences.values()).filter((r) => r.clientId === c.id).length,
    hasDNA: Array.from(store.designDNA.values()).some((d) => d.clientId === c.id),
  }));
  res.json({ data: clients, total: clients.length });
});

// GET /api/clients/:id — get by id
clientsRouter.get('/:id', (req: Request, res: Response) => {
  const client = store.clients.get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json({ data: client });
});

// POST /api/clients — create
clientsRouter.post('/', (req: Request, res: Response) => {
  const { name, industry, website, contactName, contactEmail, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const now = new Date().toISOString();
  const client = {
    id: uuid(),
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    industry,
    website,
    contactName,
    contactEmail,
    status: 'active' as const,
    notes,
    createdAt: now,
    updatedAt: now,
  };
  store.clients.set(client.id, client);
  res.status(201).json({ data: client });
});

// PUT /api/clients/:id — update
clientsRouter.put('/:id', (req: Request, res: Response) => {
  const client = store.clients.get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const updated = { ...client, ...req.body, updatedAt: new Date().toISOString() };
  store.clients.set(client.id, updated);
  res.json({ data: updated });
});
