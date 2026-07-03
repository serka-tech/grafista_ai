import { ProviderAdapter, AICapability, AIRequest, AIResponse } from '../types.js';

/**
 * KIE AI Provider Adapter (Phase 2 Step 7 — real implementation)
 *
 * Kie AI is an async job platform for image/video generation: every request is
 * (1) POST /api/v1/jobs/createTask -> { data: { taskId } }, then
 * (2) GET  /api/v1/jobs/recordInfo?taskId=... polled until state is
 *     'success' (resultJson -> { resultUrls: [...] }) or 'failed'/'fail'.
 *
 * Contract with the rest of the codebase mirrors OpenAIAdapter exactly:
 * complete() NEVER throws — every failure path (missing env config, HTTP error,
 * task failure, timeout) resolves to a structured { success: false, error }
 * AIResponse so ModelRouter's retry loop and callers' providerError() handling
 * keep working unchanged. On success, `content` is a JSON string of shape
 * { images: [{ imageUrl, mimeType? }] } — matching @grafista/schemas'
 * VisualGenerationPayloadSchema, which apps/api's visual-generation service
 * validates before touching storage.
 *
 * Env vars (no hard-coded secrets):
 *   KIE_AI_API_KEY            — bearer token (required)
 *   KIE_AI_BASE_URL           — e.g. https://api.kie.ai (required; a trailing
 *                               /api/v1 is tolerated and normalized)
 *   KIE_AI_IMAGE_MODEL        — default image model id (optional)
 *   KIE_AI_TIMEOUT_MS         — overall createTask+poll budget (optional)
 *   KIE_AI_POLL_INTERVAL_MS   — polling interval (optional)
 */

const DEFAULT_IMAGE_MODEL = 'gpt-image-1.5';
/** Per-HTTP-call timeout — one createTask or one recordInfo round-trip. */
const HTTP_TIMEOUT_MS = 30_000;
/** Overall budget for createTask + polling. Kie docs: images typically take ~30-60s. */
const DEFAULT_TASK_TIMEOUT_MS = 180_000;
/** Kie docs ask for a minimum 10s polling interval. */
const DEFAULT_POLL_INTERVAL_MS = 10_000;

interface KieCreateTaskResponse {
  code?: number;
  msg?: string;
  message?: string;
  data?: { taskId?: string };
}

interface KieRecordInfoResponse {
  code?: number;
  msg?: string;
  message?: string;
  data?: {
    state?: string;
    resultJson?: string;
    failMsg?: string;
  };
}

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Kie AI HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Kie AI returned non-JSON response: ${text.slice(0, 500)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export class KieAIAdapter implements ProviderAdapter {
  name = 'kie-ai' as const;
  // Real createTask/recordInfo jobs implementation. Kie AI's jobs API is
  // model-driven and runs both image and video generation models; the routing
  // table relies on kie-ai as primary for video_generation and fallback for
  // image_generation.
  capabilities: AICapability[] = ['image_generation', 'video_generation'];
  private apiKey: string | undefined;
  private baseUrl: string | undefined;

  constructor() {
    this.apiKey = process.env.KIE_AI_API_KEY;
    this.baseUrl = process.env.KIE_AI_BASE_URL;
  }

  isAvailable(): boolean {
    return !!(this.apiKey && this.baseUrl);
  }

  /** Normalizes KIE_AI_BASE_URL to the /api/v1 API root, whether or not the env var already includes it. */
  private apiRoot(): string {
    const trimmed = (this.baseUrl ?? '').replace(/\/+$/, '');
    return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
  }

  private failure(request: AIRequest, start: number, error: string, metadata?: Record<string, unknown>): AIResponse {
    return {
      success: false,
      provider: 'kie-ai',
      model: request.model ?? process.env.KIE_AI_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL,
      content: '',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: Date.now() - start,
      error,
      ...(metadata ? { metadata } : {}),
    };
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const start = Date.now();

    // Graceful structured error when unconfigured — mirrors OpenAIAdapter's
    // "Provider configuration error" path (never a thrown exception).
    if (!this.apiKey || !this.baseUrl) {
      return this.failure(
        request,
        start,
        'Provider configuration error: KIE_AI_API_KEY and/or KIE_AI_BASE_URL is not set'
      );
    }

    const model = request.model ?? process.env.KIE_AI_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL;
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    try {
      // Kie AI image models take one flat text prompt — fold system + user together,
      // the same information the chat-based providers receive as two messages.
      const prompt = [request.systemPrompt, request.userPrompt].filter(Boolean).join('\n\n');
      const aspectRatio =
        typeof request.metadata?.aspectRatio === 'string' ? request.metadata.aspectRatio : undefined;

      const created = await fetchJson<KieCreateTaskResponse>(`${this.apiRoot()}/jobs/createTask`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          input: {
            prompt,
            ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
          },
        }),
      });

      const taskId = created.data?.taskId;
      if (created.code !== 200 || !taskId) {
        return this.failure(
          request,
          start,
          `Kie AI createTask failed (code=${created.code ?? 'n/a'}): ${created.msg ?? created.message ?? 'no taskId returned'}`
        );
      }

      const taskTimeoutMs = positiveIntFromEnv('KIE_AI_TIMEOUT_MS', DEFAULT_TASK_TIMEOUT_MS);
      const pollIntervalMs = positiveIntFromEnv('KIE_AI_POLL_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS);

      while (Date.now() - start < taskTimeoutMs) {
        await sleep(pollIntervalMs);

        const record = await fetchJson<KieRecordInfoResponse>(
          `${this.apiRoot()}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
          { method: 'GET', headers }
        );

        const state = record.data?.state;

        if (state === 'success') {
          let resultUrls: string[] = [];
          try {
            const resultJson = JSON.parse(record.data?.resultJson ?? '{}') as { resultUrls?: string[] };
            resultUrls = Array.isArray(resultJson.resultUrls) ? resultJson.resultUrls : [];
          } catch {
            return this.failure(request, start, `Kie AI task ${taskId} succeeded but resultJson was not valid JSON`, {
              taskId,
            });
          }
          if (resultUrls.length === 0) {
            return this.failure(request, start, `Kie AI task ${taskId} succeeded but returned no resultUrls`, {
              taskId,
            });
          }

          return {
            success: true,
            provider: 'kie-ai',
            model,
            // Same shape VisualGenerationPayloadSchema expects (see @grafista/schemas).
            content: JSON.stringify({ images: resultUrls.map((url) => ({ imageUrl: url })) }),
            // Kie AI bills per task, not per token — usage stays zeroed by design.
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            latencyMs: Date.now() - start,
            metadata: { taskId, resultUrls },
          };
        }

        if (state === 'failed' || state === 'fail') {
          return this.failure(
            request,
            start,
            `Kie AI task ${taskId} failed: ${record.data?.failMsg ?? 'no failure message provided'}`,
            { taskId }
          );
        }
        // 'waiting' / 'processing' / unknown transient states -> keep polling.
      }

      return this.failure(request, start, `Kie AI task did not complete within ${taskTimeoutMs}ms`);
    } catch (err) {
      // Network errors, HTTP errors, aborts — same catch-all shape as OpenAIAdapter.
      return this.failure(request, start, err instanceof Error ? err.message : String(err));
    }
  }
}
