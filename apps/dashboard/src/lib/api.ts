const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// Carries the HTTP status code alongside the message so callers can branch on
// specific statuses (e.g. 409 conflict vs 502 provider failure) without
// re-parsing the response themselves. Existing callers that only read
// `err.message` keep working unchanged since ApiError extends Error.
export class ApiError extends Error {
  status: number;
  requiredPermission?: string;
  constructor(message: string, status: number, requiredPermission?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.requiredPermission = requiredPermission;
  }
}

/**
 * Resolves an API-relative protected file path (e.g. `/api/visual-outputs/:id/file`)
 * to an absolute URL on the API origin, so <img src> / download links work when the
 * dashboard and API run on different origins. Absolute URLs pass through unchanged.
 */
export function resolveApiFileUrl(path: string): string {
  return path.startsWith('/') ? `${API_BASE}${path}` : path;
}

function redirectToLoginOn401(status: number) {
  if (status === 401 && typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    redirectToLoginOn401(res.status);
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(error.error ?? error.message ?? 'API Error', res.status, error.requiredPermission);
  }
  return res.json();
}

async function uploadAPI<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', body: formData, credentials: 'include' });
  if (!res.ok) {
    redirectToLoginOn401(res.status);
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(error.error ?? error.message ?? 'Upload failed', res.status, error.requiredPermission);
  }
  return res.json();
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    fetchAPI<{ data: { user: any } }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => fetchAPI<{ data: { loggedOut: boolean } }>('/api/auth/logout', { method: 'POST' }),
  getCurrentUser: () => fetchAPI<{ data: { user: any } }>('/api/auth/me'),

  // Clients
  getClients: () => fetchAPI<{ data: any[]; total: number }>('/api/clients'),
  getClient: (id: string) => fetchAPI<{ data: any }>(`/api/clients/${id}`),
  createClient: (data: any) => fetchAPI<{ data: any }>('/api/clients', { method: 'POST', body: JSON.stringify(data) }),

  // Brand Assets
  getBrandAssets: (clientId: string) => fetchAPI<{ data: any[] }>(`/api/clients/${clientId}/brand-assets`),
  uploadBrandAsset: (clientId: string, formData: FormData) =>
    uploadAPI<{ data: any }>(`/api/clients/${clientId}/brand-assets`, formData),

  // Design References
  getDesignReferences: (clientId: string) => fetchAPI<{ data: any[] }>(`/api/clients/${clientId}/design-references`),
  uploadDesignReference: (clientId: string, formData: FormData) =>
    uploadAPI<{ data: any }>(`/api/clients/${clientId}/design-references`, formData),

  // Design DNA
  getDesignDNA: (clientId: string) => fetchAPI<{ data: any }>(`/api/clients/${clientId}/design-dna`),
  analyzeDesignDNA: (clientId: string) => fetchAPI<any>(`/api/clients/${clientId}/design-dna/analyze`, { method: 'POST' }),
  getDesignDnaReferences: (clientId: string) =>
    fetchAPI<{ data: any[]; total: number }>(`/api/clients/${clientId}/design-dna/references`),
  approveDesignDna: (clientId: string) =>
    fetchAPI<{ data: any }>(`/api/clients/${clientId}/design-dna/approve`, { method: 'POST' }),
  reviseDesignDna: (clientId: string, notes?: string) =>
    fetchAPI<{ data: any }>(`/api/clients/${clientId}/design-dna/revise`, { method: 'POST', body: JSON.stringify({ notes }) }),

  // Content Ideas
  getContentIdeas: (clientId: string, status?: string) =>
    fetchAPI<{ data: any[] }>(`/api/clients/${clientId}/content-ideas${status ? `?status=${status}` : ''}`),
  generateContentIdeas: (clientId: string, data: any) =>
    fetchAPI<{ data: any[] }>(`/api/clients/${clientId}/content-ideas`, { method: 'POST', body: JSON.stringify(data) }),

  // Approvals
  getApprovals: () => fetchAPI<{ data: any[] }>('/api/approvals'),
  approveIdea: (id: string, data?: any) => fetchAPI<any>(`/api/content-ideas/${id}/approve`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
  rejectIdea: (id: string, data?: any) => fetchAPI<any>(`/api/content-ideas/${id}/reject`, { method: 'POST', body: JSON.stringify(data ?? {}) }),

  // Design Briefs
  createDesignBrief: (contentIdeaId: string) =>
    fetchAPI<{ data: any }>('/api/design-briefs', { method: 'POST', body: JSON.stringify({ contentIdeaId }) }),
  getDesignBrief: (id: string) => fetchAPI<{ data: any }>(`/api/design-briefs/${id}`),
  getDesignBriefs: () => fetchAPI<{ data: any[] }>('/api/design-briefs'),
  approveDesignBrief: (id: string) =>
    fetchAPI<{ data: any }>(`/api/design-briefs/${id}/approve`, { method: 'POST' }),
  rejectDesignBrief: (id: string, revisionNotes?: string) =>
    fetchAPI<{ data: any }>(`/api/design-briefs/${id}/reject`, { method: 'POST', body: JSON.stringify({ revisionNotes }) }),

  // Layout Plans
  generateLayoutPlans: (designBriefId: string) =>
    fetchAPI<{ data: any[] }>(`/api/design-briefs/${designBriefId}/layout-plans`, { method: 'POST' }),
  getLayoutPlansForBrief: (designBriefId: string) =>
    fetchAPI<{ data: any[]; total: number }>(`/api/design-briefs/${designBriefId}/layout-plans`),
  getLayoutPlansForClient: (clientId: string) =>
    fetchAPI<{ data: any[]; total: number }>(`/api/clients/${clientId}/layout-plans`),
  getLayoutPlan: (id: string) => fetchAPI<{ data: any }>(`/api/layout-plans/${id}`),
  approveLayoutPlan: (id: string) =>
    fetchAPI<{ data: any }>(`/api/layout-plans/${id}/approve`, { method: 'POST' }),
  rejectLayoutPlan: (id: string, notes?: string) =>
    fetchAPI<{ data: any }>(`/api/layout-plans/${id}/reject`, { method: 'POST', body: JSON.stringify({ notes }) }),

  // Creative QA (Phase 2 Step 5B)
  runCreativeQa: (layoutPlanId: string) =>
    fetchAPI<{ data: any }>(`/api/layout-plans/${layoutPlanId}/creative-qa`, { method: 'POST' }),
  getCreativeQaForLayoutPlan: (layoutPlanId: string) =>
    fetchAPI<{ data: any[]; total: number }>(`/api/layout-plans/${layoutPlanId}/creative-qa`),
  getCreativeQaForDesignBrief: (designBriefId: string) =>
    fetchAPI<{ data: any[]; total: number }>(`/api/design-briefs/${designBriefId}/creative-qa`),
  getCreativeQaForClient: (clientId: string) =>
    fetchAPI<{ data: any[]; total: number }>(`/api/clients/${clientId}/creative-qa`),
  getCreativeQaReport: (id: string) => fetchAPI<{ data: any }>(`/api/creative-qa/${id}`),
  approveCreativeQa: (id: string) =>
    fetchAPI<{ data: any }>(`/api/creative-qa/${id}/approve`, { method: 'POST' }),
  rejectCreativeQa: (id: string, notes?: string) =>
    fetchAPI<{ data: any }>(`/api/creative-qa/${id}/reject`, { method: 'POST', body: JSON.stringify({ notes }) }),

  // Visual Generation (Phase 2 Step 7)
  runVisualGeneration: (layoutPlanId: string) =>
    fetchAPI<{ data: any[]; total: number }>(`/api/layout-plans/${layoutPlanId}/visual-generation`, { method: 'POST' }),
  listVisualOutputs: (layoutPlanId: string) =>
    fetchAPI<{ data: any[]; total: number }>(`/api/layout-plans/${layoutPlanId}/visual-generation`),
  getVisualOutput: (id: string) => fetchAPI<{ data: any }>(`/api/visual-outputs/${id}`),
  approveVisualOutput: (id: string) =>
    fetchAPI<{ data: any }>(`/api/visual-outputs/${id}/approve`, { method: 'POST' }),
  rejectVisualOutput: (id: string, notes?: string) =>
    fetchAPI<{ data: any }>(`/api/visual-outputs/${id}/reject`, { method: 'POST', body: JSON.stringify({ notes }) }),

  // Production Jobs (Phase 2 Step 8A)
  createProductionJob: (generatedOutputId: string) =>
    fetchAPI<{ data: any }>(`/api/generated-outputs/${generatedOutputId}/production-jobs`, { method: 'POST' }),
  listProductionJobs: (generatedOutputId: string) =>
    fetchAPI<{ data: any[]; total: number }>(`/api/generated-outputs/${generatedOutputId}/production-jobs`),
  getProductionJob: (id: string) => fetchAPI<{ data: any }>(`/api/production-jobs/${id}`),
  approveProductionJob: (id: string) =>
    fetchAPI<{ data: any }>(`/api/production-jobs/${id}/approve`, { method: 'POST' }),
  rejectProductionJob: (id: string, reason?: string) =>
    fetchAPI<{ data: any }>(`/api/production-jobs/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),

  // Outputs
  getOutputs: () => fetchAPI<{ data: any[] }>('/api/outputs'),

  // Settings
  getProviders: () => fetchAPI<{ data: any[] }>('/api/settings/providers'),

  // Health
  health: () => fetchAPI<any>('/api/health'),

  // Workflows (Phase 2 Step 6 — kalıcı workflow çalıştırmaları)
  getWorkflows: () => fetchAPI<{ data: any[]; total: number }>('/api/workflows'),
  getWorkflow: (id: string) => fetchAPI<{ data: any }>(`/api/workflows/${id}`),
  startWorkflow: (workflowId: string, clientId: string, input?: Record<string, unknown>) =>
    fetchAPI<{ data: any }>(`/api/workflows/${workflowId}/start`, { method: 'POST', body: JSON.stringify({ clientId, input }) }),
  getWorkflowRuns: (params?: { clientId?: string; workflowId?: string; status?: string }) => {
    const query = new URLSearchParams();
    if (params?.clientId) query.set('clientId', params.clientId);
    if (params?.workflowId) query.set('workflowId', params.workflowId);
    if (params?.status) query.set('status', params.status);
    const qs = query.toString();
    return fetchAPI<{ data: any[]; total: number }>(`/api/workflow-runs${qs ? `?${qs}` : ''}`);
  },
  getWorkflowRun: (id: string) => fetchAPI<{ data: any }>(`/api/workflow-runs/${id}`),
  getWorkflowRunSteps: (id: string) => fetchAPI<{ data: any[]; total: number }>(`/api/workflow-runs/${id}/steps`),
  advanceWorkflowRun: (id: string, input?: Record<string, unknown>) =>
    fetchAPI<{ data: any }>(`/api/workflow-runs/${id}/advance`, { method: 'POST', body: JSON.stringify({ input }) }),
  approveWorkflowStep: (id: string, body?: { contentIdeaId?: string; layoutPlanId?: string; notes?: string }) =>
    fetchAPI<{ data: any }>(`/api/workflow-runs/${id}/approve-step`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  rejectWorkflowStep: (id: string, body?: { contentIdeaId?: string; layoutPlanId?: string; notes?: string }) =>
    fetchAPI<{ data: any }>(`/api/workflow-runs/${id}/reject-step`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  cancelWorkflowRun: (id: string) =>
    fetchAPI<{ data: any }>(`/api/workflow-runs/${id}/cancel`, { method: 'POST' }),
};
