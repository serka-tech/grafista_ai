/**
 * Grafista AI Studio — Model Router
 *
 * Provider-agnostic AI router that maps tasks to the best available provider.
 * Supports fallback chains and automatic provider selection.
 */

import { AIProvider, AIRequest, AIResponse, AITaskType, ProviderAdapter, TaskRouting } from './types.js';
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
  { taskType: 'creative_qa', primaryProvider: 'fake', fallbackProviders: ['openai', 'claude', 'gemini'], requiredCapabilities: ['text', 'vision'] },
  { taskType: 'revision_learning', primaryProvider: 'fake', fallbackProviders: ['claude', 'openai', 'gemini'], requiredCapabilities: ['text'] },
  { taskType: 'image_generation', primaryProvider: 'fake', fallbackProviders: ['openai', 'kie-ai'], requiredCapabilities: ['image_generation'] },
  { taskType: 'video_generation', primaryProvider: 'kie-ai', fallbackProviders: ['higgsfield'], requiredCapabilities: ['video_generation'] },
];

export class ModelRouter {
  private adapters: Map<AIProvider, ProviderAdapter> = new Map();
  private routing: TaskRouting[];

  constructor(customRouting?: TaskRouting[]) {
    this.routing = customRouting ?? DEFAULT_ROUTING;

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
    // If explicit provider requested, try it. This is a deliberate user override,
    // so only availability is checked here — no capability filtering — to keep
    // the pre-existing override behavior intact.
    if (request.provider) {
      const adapter = this.adapters.get(request.provider);
      if (adapter?.isAvailable()) return adapter;
    }

    // Use routing table
    const routing = this.getRouting(request.taskType);
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

    const maxRetries = 3;
    let lastError: string | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await adapter.complete(request);
        if (response.success) return response;
        lastError = response.error;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    return {
      success: false,
      provider: adapter.name,
      model: 'none',
      content: '',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: 0,
      error: `All ${maxRetries} attempts failed: ${lastError}`,
    };
  }
}
