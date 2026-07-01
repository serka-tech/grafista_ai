import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { store } from '../data/store.js';

export const workflowsRouter: Router = Router();

// ── Workflow Definitions (loaded from JSON definitions) ──

const WORKFLOW_DEFINITIONS = [
  { workflow_id: 'client-onboarding', name: 'Client Onboarding', icon: '🏢', purpose: 'Create client profile, upload brand assets, generate BrandProfile', skills: ['brand-intake', 'approval-gate', 'model-routing'], next: 'style-library-ingestion' },
  { workflow_id: 'style-library-ingestion', name: 'Style Library Ingestion', icon: '📐', purpose: 'Analyze previous designs, create Design DNA', skills: ['style-analysis', 'approval-gate', 'revision-learning', 'model-routing'], next: 'content-generation' },
  { workflow_id: 'content-generation', name: 'Content Generation', icon: '💡', purpose: 'Generate client-specific content ideas', skills: ['content-strategy', 'approval-gate', 'revision-learning', 'model-routing'], next: 'design-brief' },
  { workflow_id: 'design-brief', name: 'Design Brief', icon: '📋', purpose: 'Convert approved content into structured design brief', skills: ['design-brief-generator', 'style-analysis', 'approval-gate', 'model-routing'], next: 'layout-generation' },
  { workflow_id: 'layout-generation', name: 'Layout Generation', icon: '🧩', purpose: 'Create structured layout plan with alternatives', skills: ['layout-generation', 'approval-gate', 'creative-director-qa', 'model-routing'], next: 'visual-generation' },
  { workflow_id: 'visual-generation', name: 'Visual Generation', icon: '🎨', purpose: 'Generate or edit supporting visuals', skills: ['model-routing', 'style-analysis', 'creative-director-qa', 'approval-gate'], next: 'photoshop-production' },
  { workflow_id: 'photoshop-production', name: 'Photoshop Production', icon: '🖌️', purpose: 'Generate editable PSD from LayoutPlan', skills: ['photoshop-automation', 'creative-director-qa', 'approval-gate'], next: 'creative-qa' },
  { workflow_id: 'creative-qa', name: 'Creative QA', icon: '✅', purpose: '9-point quality review before final approval', skills: ['creative-director-qa', 'style-analysis', 'approval-gate', 'revision-learning'], next: null },
  { workflow_id: 'revision-learning', name: 'Revision Learning', icon: '🧠', purpose: 'Learn from approvals, rejections and revision notes', skills: ['revision-learning', 'approval-gate', 'model-routing'], next: null },
  { workflow_id: 'monthly-content-calendar', name: 'Monthly Content Calendar', icon: '📅', purpose: 'Generate monthly content plan', skills: ['content-strategy', 'approval-gate', 'design-brief-generator', 'revision-learning'], next: 'content-generation' },
];

// ── In-Memory Workflow Instances Store ──

interface WorkflowInstance {
  id: string;
  workflowId: string;
  clientId: string;
  status: 'draft' | 'waiting_for_approval' | 'approved' | 'in_progress' | 'qa_failed' | 'completed';
  currentStep: number;
  totalSteps: number;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  stepResults: Record<string, unknown>[];
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}

const workflowInstances: Map<string, WorkflowInstance> = new Map();

// GET /api/workflows — list all workflow definitions
workflowsRouter.get('/', (_req: Request, res: Response) => {
  res.json({ data: WORKFLOW_DEFINITIONS, total: WORKFLOW_DEFINITIONS.length });
});

// GET /api/workflows/:workflowId — get single workflow definition
workflowsRouter.get('/:workflowId', (req: Request, res: Response) => {
  const def = WORKFLOW_DEFINITIONS.find(w => w.workflow_id === req.params.workflowId);
  if (!def) return res.status(404).json({ error: 'Workflow not found' });
  res.json({ data: def });
});

// POST /api/workflows/:workflowId/start — start a new workflow instance
workflowsRouter.post('/:workflowId/start', async (req: Request, res: Response) => {
  const def = WORKFLOW_DEFINITIONS.find(w => w.workflow_id === req.params.workflowId);
  if (!def) return res.status(404).json({ error: 'Workflow not found' });

  const { clientId, inputs } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId is required' });

  const client = await store.clients.getById(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const now = new Date().toISOString();
  const instance: WorkflowInstance = {
    id: uuid(),
    workflowId: req.params.workflowId,
    clientId,
    status: 'in_progress',
    currentStep: 1,
    totalSteps: 7, // default, overridden by actual workflow JSON
    inputs: inputs ?? {},
    outputs: {},
    stepResults: [],
    startedAt: now,
    updatedAt: now,
  };

  workflowInstances.set(instance.id, instance);
  res.status(201).json({ data: instance });
});

// GET /api/workflows/instances — list running workflow instances
workflowsRouter.get('/instances/list', async (req: Request, res: Response) => {
  const clientId = req.query.clientId as string | undefined;
  let instances = Array.from(workflowInstances.values());
  if (clientId) instances = instances.filter(i => i.clientId === clientId);

  const enriched = await Promise.all(instances.map(async (inst) => ({
    ...inst,
    workflowName: WORKFLOW_DEFINITIONS.find(w => w.workflow_id === inst.workflowId)?.name,
    workflowIcon: WORKFLOW_DEFINITIONS.find(w => w.workflow_id === inst.workflowId)?.icon,
    clientName: (await store.clients.getById(inst.clientId))?.name,
  })));

  res.json({ data: enriched, total: enriched.length });
});

// GET /api/workflows/instances/:id — get a specific workflow instance
workflowsRouter.get('/instances/:id', async (req: Request, res: Response) => {
  const instance = workflowInstances.get(req.params.id);
  if (!instance) return res.status(404).json({ error: 'Workflow instance not found' });

  const def = WORKFLOW_DEFINITIONS.find(w => w.workflow_id === instance.workflowId);
  const client = await store.clients.getById(instance.clientId);
  res.json({
    data: {
      ...instance,
      definition: def,
      clientName: client?.name,
    },
  });
});

// POST /api/workflows/instances/:id/advance — advance workflow to next step
workflowsRouter.post('/instances/:id/advance', (req: Request, res: Response) => {
  const instance = workflowInstances.get(req.params.id);
  if (!instance) return res.status(404).json({ error: 'Workflow instance not found' });

  const { stepResult, approval } = req.body;

  // Save step result
  instance.stepResults.push({
    step: instance.currentStep,
    result: stepResult,
    approval,
    timestamp: new Date().toISOString(),
  });

  // Handle approval gate
  if (approval === 'rejected') {
    instance.status = 'waiting_for_approval';
    instance.updatedAt = new Date().toISOString();
    return res.json({ data: instance, message: 'Workflow paused — waiting for revision and re-approval' });
  }

  if (approval === 'approved') {
    instance.status = 'in_progress';
  }

  // Advance step
  instance.currentStep += 1;
  instance.updatedAt = new Date().toISOString();

  if (instance.currentStep > instance.totalSteps) {
    instance.status = 'completed';
    instance.completedAt = new Date().toISOString();
  }

  workflowInstances.set(instance.id, instance);
  res.json({ data: instance });
});

// POST /api/workflows/instances/:id/fail — mark workflow as QA failed
workflowsRouter.post('/instances/:id/fail', (req: Request, res: Response) => {
  const instance = workflowInstances.get(req.params.id);
  if (!instance) return res.status(404).json({ error: 'Workflow instance not found' });

  instance.status = 'qa_failed';
  instance.updatedAt = new Date().toISOString();
  instance.outputs = { ...instance.outputs, failureReason: req.body.reason };

  res.json({ data: instance });
});
