// Client-side API base is ALWAYS same-origin ('') — the browser calls the
// dashboard's OWN origin at `/api/...`, and Next.js proxies those to the real
// API (next.config.js, destination driven by the SERVER-side API_PROXY_TARGET).
// This backend-for-frontend proxy pattern (Production Step 19) avoids the
// split-origin trap: the browser talks only to the dashboard origin, so
// grafista_session is a first-party cookie there, SameSite=lax works, the
// dashboard middleware can read it, and the API needs no CORS/cookie changes.
//
// We deliberately DO NOT read NEXT_PUBLIC_API_URL here. Baking an absolute API
// origin into the browser bundle makes the client call the API cross-origin —
// which the split-origin CORS setup (the API allows only its own configured
// origin, not the dashboard's) rejects at the browser as "Failed to fetch".
// That was the real staging login bug: NEXT_PUBLIC_API_URL was set on the
// deployed dashboard, so the browser POSTed to the API origin directly and the
// preflight/credentialed request was blocked. Hardcoding '' makes it impossible
// for the browser to ever call the API cross-origin, regardless of deploy env.
// A genuinely direct (non-proxied) setup should point API_PROXY_TARGET at the
// API, not bake an origin into this client base. See docs/deployment-runbook.md §28.
const API_BASE = '';

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
 * Phase 3 Step 3 (Kapsam 5) — maps a 502 AI-provider failure to a short,
 * actionable Turkish message instead of surfacing raw English provider text.
 * Non-502 errors keep their own message (409 gates, 403 permissions etc. are
 * already meaningful). Purely presentational: the backend error shape and
 * status codes are untouched, and the raw text stays available on the error
 * object for anyone who needs the technical detail.
 */
export function friendlyAiErrorMessage(
  err: unknown,
  fallback: string,
  overrides?: { schema?: string }
): string {
  const e = err as { status?: number; message?: string } | null | undefined;
  const raw = e?.message ?? '';
  if (e?.status !== 502) return raw || fallback;

  const lower = raw.toLowerCase();
  if (/kie_ai_api_key|kie_ai_base_url/.test(lower)) {
    return 'Görsel sağlayıcı yapılandırılmamış.';
  }
  if (/provider configuration error|is not set|no provider available/.test(lower)) {
    return 'API anahtarı eksik veya geçersiz.';
  }
  if (/incorrect api key|invalid api key|unauthorized|authentication/.test(lower)) {
    return 'API anahtarı eksik veya geçersiz.';
  }
  if (/schema validation|not valid json/.test(lower)) {
    return overrides?.schema ?? 'AI yanıtı beklenen formatta dönmedi, tekrar denenebilir.';
  }
  if (/rate limit|too many requests|quota/.test(lower)) {
    return 'AI sağlayıcı şu an yoğun. Kısa bir süre sonra tekrar deneyin.';
  }
  return 'Provider geçici olarak yanıt vermedi. Tekrar deneyebilirsiniz.';
}

/**
 * Normalizes an API-relative protected file path (e.g. `/api/visual-outputs/:id/file`)
 * for use in <img src> / download links. With the same-origin proxy (API_BASE=''),
 * relative paths stay same-origin and Next.js proxies them to the API; already-absolute
 * URLs pass through unchanged.
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
    // Two backend shapes: central error handler → { error: <generic label>, message: <detail> }; route-level → { error: <detail> } (no message) — so prefer `message`.
    throw new ApiError(error.message ?? error.error ?? 'API Error', res.status, error.requiredPermission);
  }
  return res.json();
}

async function uploadAPI<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', body: formData, credentials: 'include' });
  if (!res.ok) {
    redirectToLoginOn401(res.status);
    const error = await res.json().catch(() => ({ error: res.statusText }));
    // Same two response shapes as fetchAPI above — prefer the detailed `message` when present.
    throw new ApiError(error.message ?? error.error ?? 'Upload failed', res.status, error.requiredPermission);
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

  // Listing Cards (go-live M6, direct-photo) — upload a property photo + listing
  // details -> a production-ready 'uploaded' generated_output (composited into the
  // curated real-estate template's hero slot by the existing render pipeline).
  createListingCard: (clientId: string, formData: FormData) =>
    uploadAPI<{ data: any }>(`/api/clients/${clientId}/listing-cards`, formData),

  // Analytics (Phase 3 Step 6A)
  getClientAnalyticsSummary: (clientId: string) => fetchAPI<{ data: any }>(`/api/clients/${clientId}/analytics/summary`),

  // Revision History (Phase 3 Step 6B)
  getClientRecentRevisions: (clientId: string) => fetchAPI<{ data: any[] }>(`/api/clients/${clientId}/revisions/recent`),

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

  // Render Jobs / Export Artifacts (Phase 2 Step 9A)
  createRenderJob: (productionJobId: string, preset: string, exportFormat: string) =>
    fetchAPI<{ data: any }>(`/api/production-jobs/${productionJobId}/render`, {
      method: 'POST',
      body: JSON.stringify({ preset, exportFormat }),
    }),
  getRenderJob: (id: string) => fetchAPI<{ data: any }>(`/api/render-jobs/${id}`),
  listRenderJobArtifacts: (renderJobId: string) =>
    fetchAPI<{ data: any[]; total: number }>(`/api/render-jobs/${renderJobId}/artifacts`),
  listRenderJobsForProductionJob: (productionJobId: string) =>
    fetchAPI<{ data: any[]; total: number }>(`/api/production-jobs/${productionJobId}/render-jobs`),
  // Phase 3 Step 5A — render queue/worker. Cancels a non-terminal render job
  // (pending/queued -> cancelled immediately; rendering -> cancellation
  // requested, finalized by the worker on its next observation).
  cancelRenderJob: (renderJobId: string) =>
    fetchAPI<{ data: any }>(`/api/render-jobs/${renderJobId}/cancel`, { method: 'POST' }),

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

  // Org / Team (Packaging Phase A) — all require the org:manage permission (OWNER).
  getOrgUsers: () => fetchAPI<{ data: any[]; total: number }>('/api/org/users'),
  getOrgInvites: () => fetchAPI<{ data: any[]; total: number }>('/api/org/invites'),
  inviteOrgUser: (email: string, role: string) =>
    fetchAPI<{ data: { invite: any; token: string; acceptPath: string } }>('/api/org/invites', {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),
  setOrgUserRole: (userId: string, role: string) =>
    fetchAPI<{ data: any }>(`/api/org/users/${userId}/roles`, { method: 'POST', body: JSON.stringify({ role }) }),
  setOrgUserStatus: (userId: string, status: 'active' | 'disabled') =>
    fetchAPI<{ data: any }>(`/api/org/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  getOrgUserClients: (userId: string) =>
    fetchAPI<{ data: string[]; total: number }>(`/api/org/users/${userId}/clients`),
  assignOrgUserClient: (userId: string, clientId: string) =>
    fetchAPI<{ data: any }>(`/api/org/users/${userId}/clients`, { method: 'POST', body: JSON.stringify({ clientId }) }),
  removeOrgUserClient: (userId: string, clientId: string) =>
    fetchAPI<{ data: any }>(`/api/org/users/${userId}/clients/${clientId}`, { method: 'DELETE' }),

  // Accept an invite (the only user-creation path). Public — used by /accept-invite.
  acceptInvite: (token: string, password: string, name?: string) =>
    fetchAPI<{ data: { user: any } }>('/api/auth/accept-invite', {
      method: 'POST',
      body: JSON.stringify({ token, password, name }),
    }),
};

// ─── Render job polling (Phase 3 Step 5A) ──────────────────
// Backend render jobs can now be non-terminal (queued/rendering) when the
// server-side render queue is enabled — see docs/render-queue-worker-plan.md
// §8. A rendered/failed/cancelled job never changes again, so polling stops
// there; queued/rendering jobs are polled again after `intervalMs`.
export const TERMINAL_RENDER_JOB_STATUSES = new Set(['rendered', 'failed', 'cancelled']);

/**
 * Starts polling GET /render-jobs/:id every `intervalMs` (default 2500ms)
 * until the job reaches a terminal status, calling `onUpdate` with every
 * fetched job (including the terminal one). Returns a `stop()` function —
 * callers MUST call it on unmount/cleanup (e.g. from a `useEffect` cleanup)
 * to avoid polling after the component using it is gone. A transient fetch
 * failure is swallowed and retried on the next tick rather than stopping the
 * poll outright — mirrors this file's other "don't let one transient failure
 * break the UI" idioms.
 */
export function pollRenderJob(
  renderJobId: string,
  onUpdate: (job: any) => void,
  options?: { intervalMs?: number }
): () => void {
  const intervalMs = options?.intervalMs ?? 2500;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const res = await api.getRenderJob(renderJobId);
      if (stopped) return;
      onUpdate(res.data);
      if (TERMINAL_RENDER_JOB_STATUSES.has(res.data?.status)) {
        stopped = true;
        return;
      }
    } catch {
      // Transient poll failure — keep trying until stop() is called or the
      // job eventually resolves.
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };

  timer = setTimeout(tick, intervalMs);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
