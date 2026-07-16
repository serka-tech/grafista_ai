/**
 * Grafista AI Studio — Model Router
 *
 * Provider-agnostic AI router that maps tasks to the best available provider.
 * Supports fallback chains and automatic provider selection.
 */

import { AIProvider, AIRequest, AIResponse, AITaskType, ProviderAdapter, TaskRouting } from './types.js';
import { DelayFn, executeWithClassifiedRetry } from './provider-errors.js';
import { OpenAIAdapter } from './providers/openai.js';
import { GeminiAdapter } from './providers/gemini.js';
import { ClaudeAdapter } from './providers/claude.js';
import { KieAIAdapter } from './providers/kie-ai.js';
import { HiggsFieldAdapter } from './providers/higgsfield.js';
import { FakeAIAdapter } from './providers/fake.js';

// Default task → provider routing table.
//
// 'fake' is listed FIRST on every task it supports (all but video_generation) so
// the offline demo mode (AI_DEFAULT_PROVIDER=fake, see providers/fake.ts) also
// covers tasks that pass no explicit provider — today that's image_generation.
// This is safe for production: FakeAIAdapter.isAvailable() is false unless
// explicitly enabled, and selectProvider() only picks an AVAILABLE adapter
// (`candidates.find((adapter) => adapter.isAvailable())` below), so a disabled
// fake is skipped and the pre-existing real-provider order is unchanged.
const DEFAULT_ROUTING: TaskRouting[] = [
  { taskType: 'brand_intake', primaryProvider: 'fake', fallbackProviders: ['openai', 'claude', 'gemini'], requiredCapabilities: ['text'] },
  { taskType: 'style_analysis', primaryProvider: 'fake', fallbackProviders: ['openai', 'gemini', 'claude'], requiredCapabilities: ['vision'] },
  // Synthesizes already-extracted per-reference JSON (text) into one client-level DesignDNA —
  // no raw images involved, so this does not require vision capability.
  { taskType: 'design_dna_synthesis', primaryProvider: 'fake', fallbackProviders: ['openai', 'claude', 'gemini'], requiredCapabilities: ['text'] },
  { taskType: 'tone_extraction', primaryProvider: 'fake', fallbackProviders: ['claude', 'openai', 'gemini'], requiredCapabilities: ['text'] },
  { taskType: 'content_ideation', primaryProvider: 'fake', fallbackProviders: ['openai', 'claude', 'gemini'], requiredCapabilities: ['text'] },
  { taskType: 'caption_generation', primaryProvider: 'fake', fallbackProviders: ['claude', 'openai', 'gemini'], requiredCapabilities: ['text'] },
  { taskType: 'design_brief', primaryProvider: 'fake', fallbackProviders: ['openai', 'claude', 'gemini'], requiredCapabilities: ['text'] },
  { taskType: 'layout_generation', primaryProvider: 'fake', fallbackProviders: ['openai', 'claude'], requiredCapabilities: ['text'] },
  // Creative QA is a text-only structural review today — it sends NO rendered image
  // (see apps/api creative-qa.ts). It must require only 'text', otherwise capability
  // enforcement would needlessly reroute a text-only default provider away. When a
  // render-image QA phase lands, re-add 'vision' AND attach the image together.
  { taskType: 'creative_qa', primaryProvider: 'fake', fallbackProviders: ['openai', 'claude', 'gemini'], requiredCapabilities: ['text'] },
  { taskType: 'revision_learning', primaryProvider: 'fake', fallbackProviders: ['claude', 'openai', 'gemini'], requiredCapabilities: ['text'] },
  { taskType: 'image_generation', primaryProvider: 'fake', fallbackProviders: ['openai', 'kie-ai'], requiredCapabilities: ['image_generation'] },
  { taskType: 'video_generation', primaryProvider: 'kie-ai', fallbackProviders: ['higgsfield'], requiredCapabilities: ['video_generation'] },
];

export interface ModelRouterOptions {
  /** Test seam: replace individual adapters with stubs (additive — unspecified providers keep their real adapter). */
  adapters?: Partial<Record<AIProvider, ProviderAdapter>>;
  /** Test seam: injectable retry backoff delay so tests never actually sleep. */
  delayFn?: DelayFn;
}

export class ModelRouter {
  private adapters: Map<AIProvider, ProviderAdapter> = new Map();
  private routing: TaskRouting[];
  private delayFn: DelayFn | undefined;

  constructor(customRouting?: TaskRouting[], options?: ModelRouterOptions) {
    this.routing = customRouting ?? DEFAULT_ROUTING;
    this.delayFn = options?.delayFn;

    // Initialize all adapters
    const openai = new OpenAIAdapter();
    const gemini = new GeminiAdapter();
    const claude = new ClaudeAdapter();
    const kieAi = new KieAIAdapter();
    const higgsfield = new HiggsFieldAdapter();
    const fake = new FakeAIAdapter();

    this.adapters.set('openai', openai);
    this.adapters.set('gemini', gemini);
    this.adapters.set('claude', claude);
    this.adapters.set('kie-ai', kieAi);
    this.adapters.set('higgsfield', higgsfield);
    this.adapters.set('fake', fake);

    if (options?.adapters) {
      for (const [name, adapter] of Object.entries(options.adapters)) {
        if (adapter) this.adapters.set(name as AIProvider, adapter);
      }
    }
  }

  /**
   * Get the status of all providers
   */
  getProviderStatus(): Record<AIProvider, boolean> {
    const status: Partial<Record<AIProvider, boolean>> = {};
    for (const [name, adapter] of this.adapters) {
      status[name] = adapter.isAvailable();
    }
    return status as Record<AIProvider, boolean>;
  }

  /**
   * Get routing config for a task
   */
  getRouting(taskType: AITaskType): TaskRouting | undefined {
    return this.routing.find((r) => r.taskType === taskType);
  }

  /**
   * Select the best available provider for a task
   */
  private selectProvider(request: AIRequest): ProviderAdapter | null {
    const routingForTask = this.getRouting(request.taskType);
    const requiredForTask = routingForTask?.requiredCapabilities ?? [];

    // If an explicit provider is requested, honor it ONLY when it is available AND
    // actually implements the task's required capabilities. A text-only provider
    // (e.g. claude) explicitly requested for a vision task must NOT silently run
    // blind — we fall through to capability-filtered routing so a vision-capable
    // provider is chosen instead. An empty requiredCapabilities list keeps the
    // pre-existing override behavior (explicit provider honored on availability alone,
    // e.g. the image_generation openai/kie buttons).
    if (request.provider) {
      const adapter = this.adapters.get(request.provider);
      if (adapter?.isAvailable() && requiredForTask.every((cap) => adapter.capabilities.includes(cap))) {
        return adapter;
      }
      // Otherwise (unavailable OR missing a required capability) fall through to
      // capability-filtered routing below. complete() detects the substitution
      // (selected adapter !== requested provider), logs it, and clears any
      // provider-specific model so it can't leak into the different adapter.
    }

    // Use routing table
    const routing = routingForTask;
    if (!routing) {
      // Fallback: try openai → claude → gemini
      for (const name of ['openai', 'claude', 'gemini'] as AIProvider[]) {
        const adapter = this.adapters.get(name);
        if (adapter?.isAvailable()) return adapter;
      }
      // Last resort: return any adapter (its complete() will report why it's unavailable)
      return this.adapters.get('openai') ?? null;
    }

    // Only adapters that actually implement the task's required capabilities are
    // selectable — an "available" provider that can't do the job (e.g. openai for
    // image_generation) must never be picked, or we'd fire a doomed real API call.
    // An empty/missing requiredCapabilities list means every adapter qualifies.
    const required = routing.requiredCapabilities ?? [];
    const candidates = [routing.primaryProvider, ...routing.fallbackProviders]
      .map((name) => this.adapters.get(name))
      .filter(
        (adapter): adapter is ProviderAdapter =>
          !!adapter && required.every((cap) => adapter.capabilities.includes(cap))
      );

    // First capable AND available adapter wins (primary → fallbacks order).
    const available = candidates.find((adapter) => adapter.isAvailable());
    if (available) return available;

    // No capable adapter is available — return the first capable one anyway: its
    // complete() reports the missing configuration as a structured error without
    // any network call (its client is never constructed without the API key).
    // If NO adapter in the chain has the required capabilities, there is genuinely
    // no provider for this task — complete() then returns a clean
    // "No provider available" error instead of firing a doomed real API call.
    return candidates[0] ?? null;
  }

  /**
   * Route and execute an AI request
   */
  async complete(request: AIRequest): Promise<AIResponse> {
    const adapter = this.selectProvider(request);
    if (!adapter) {
      return {
        success: false,
        provider: request.provider ?? 'openai',
        model: 'none',
        content: '',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        latencyMs: 0,
        error: 'No provider available for this request',
      };
    }

    // When an explicitly-requested provider was NOT the one selected (unavailable,
    // unknown, or missing a required capability), dispatch a COPY with any
    // provider-specific model cleared — a model string is only valid for its own
    // provider and must never leak into a different adapter. The caller's request
    // object is left untouched (no hidden mutation for retries/logging/reuse).
    let dispatch = request;
    if (request.provider && adapter.name !== request.provider) {
      const requested = this.adapters.get(request.provider);
      const reason = !requested
        ? 'unknown_provider'
        : !requested.isAvailable()
          ? 'provider_unavailable'
          : 'capability_mismatch';
      console.warn(
        `[model-router] task "${request.taskType}": requested provider "${request.provider}" not used ` +
          `(reason=${reason}) — routed to "${adapter.name}".`
      );
      if (request.model !== undefined) dispatch = { ...request, model: undefined };
    }

    // Phase 3 Step 3: classified retry replaces the previous blind 3-attempt
    // loop (which retried even 401s, back-to-back, with no backoff). Only
    // transient / rate-limit / timeout / unknown failures are retried, with
    // per-kind limits and exponential backoff — auth, permanent and
    // provider-configuration failures fail fast on the first attempt.
    return executeWithClassifiedRetry(() => adapter.complete(dispatch), {
      delayFn: this.delayFn,
      buildFailure: (error) => ({
        success: false,
        provider: adapter.name,
        model: 'none',
        content: '',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        latencyMs: 0,
        error,
      }),
      onAttemptFailure: ({ attempt, kind, willRetry, delayMs, error }) => {
        // Secret-free observability: provider name, classification, retry plan
        // and the adapter's own error message (adapters never embed secrets).
        console.warn(
          `[model-router] provider=${adapter.name} taskType=${request.taskType} attempt=${attempt} failed ` +
            `(kind=${kind} willRetry=${willRetry}${willRetry ? ` delayMs=${delayMs}` : ''}) — ${error}`
        );
      },
    });
  }
}
