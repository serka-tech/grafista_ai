const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

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
    throw new Error(error.error ?? error.message ?? 'API Error');
  }
  return res.json();
}

async function uploadAPI<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', body: formData, credentials: 'include' });
  if (!res.ok) {
    redirectToLoginOn401(res.status);
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error ?? error.message ?? 'Upload failed');
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

  // Outputs
  getOutputs: () => fetchAPI<{ data: any[] }>('/api/outputs'),

  // Settings
  getProviders: () => fetchAPI<{ data: any[] }>('/api/settings/providers'),

  // Health
  health: () => fetchAPI<any>('/api/health'),

  // Workflows
  getWorkflows: () => fetchAPI<{ data: any[] }>('/api/workflows'),
  getWorkflow: (id: string) => fetchAPI<{ data: any }>(`/api/workflows/${id}`),
  startWorkflow: (workflowId: string, clientId: string, inputs?: any) =>
    fetchAPI<{ data: any }>(`/api/workflows/${workflowId}/start`, { method: 'POST', body: JSON.stringify({ clientId, inputs }) }),
  getWorkflowInstances: (clientId?: string) =>
    fetchAPI<{ data: any[] }>(`/api/workflows/instances/list${clientId ? `?clientId=${clientId}` : ''}`),
  getWorkflowInstance: (id: string) => fetchAPI<{ data: any }>(`/api/workflows/instances/${id}`),
  advanceWorkflow: (id: string, data: any) =>
    fetchAPI<{ data: any }>(`/api/workflows/instances/${id}/advance`, { method: 'POST', body: JSON.stringify(data) }),
  failWorkflow: (id: string, reason: string) =>
    fetchAPI<{ data: any }>(`/api/workflows/instances/${id}/fail`, { method: 'POST', body: JSON.stringify({ reason }) }),
};
