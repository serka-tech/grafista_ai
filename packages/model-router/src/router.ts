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

// Default task → provider routing table
const DEFAULT_ROUTING: TaskRouting[] = [
  { taskType: 'brand_intake', primaryProvider: 'openai', fallbackProviders: ['claude', 'gemini'], requiredCapabilities: ['text'] },
  { taskType: 'style_analysis', primaryProvider: 'openai', fallbackProviders: ['gemini', 'claude'], requiredCapabilities: ['vision'] },
  // Synthesizes already-extracted per-reference JSON (text) into one client-level DesignDNA —
  // no raw images involved, so this does not require vision capability.
  { taskType: 'design_dna_synthesis', primaryProvider: 'openai', fallbackProviders: ['claude', 'gemini'], requiredCapabilities: ['text'] },
  { taskType: 'tone_extraction', primaryProvider: 'claude', fallbackProviders: ['openai', 'gemini'], requiredCapabilities: ['text'] },
  { taskType: 'content_ideation', primaryProvider: 'openai', fallbackProviders: ['claude', 'gemini'], requiredCapabilities: ['text'] },
  { taskType: 'caption_generation', primaryProvider: 'claude', fallbackProviders: ['openai', 'gemini'], requiredCapabilities: ['text'] },
  { taskType: 'design_brief', primaryProvider: 'openai', fallbackProviders: ['claude', 'gemini'], requiredCapabilities: ['text'] },
  { taskType: 'layout_generation', primaryProvider: 'openai', fallbackProviders: ['claude'], requiredCapabilities: ['text'] },
  { taskType: 'creative_qa', primaryProvider: 'openai', fallbackProviders: ['claude', 'gemini'], requiredCapabilities: ['text', 'vision'] },
  { taskType: 'revision_learning', primaryProvider: 'claude', fallbackProviders: ['openai', 'gemini'], requiredCapabilities: ['text'] },
  { taskType: 'image_generation', primaryProvider: 'openai', fallbackProviders: ['kie-ai'], requiredCapabilities: ['image_generation'] },
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

    this.adapters.set('openai', openai);
    this.adapters.set('gemini', gemini);
    this.adapters.set('claude', claude);
    this.adapters.set('kie-ai', kieAi);
    this.adapters.set('higgsfield', higgsfield);
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
    // If explicit provider requested, try it
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

    // Try primary
    const primary = this.adapters.get(routing.primaryProvider);
    if (primary?.isAvailable()) return primary;

    // Try fallbacks
    for (const fallback of routing.fallbackProviders) {
      const adapter = this.adapters.get(fallback);
      if (adapter?.isAvailable()) return adapter;
    }

    // All unavailable — return primary anyway (its complete() will report why it's unavailable)
    return primary ?? null;
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
