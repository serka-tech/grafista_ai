import { ProviderAdapter, AIRequest, AIResponse } from '../types.js';

/**
 * KIE AI Provider Adapter (Placeholder)
 * Future integration for AI video/image generation
 */
export class KieAIAdapter implements ProviderAdapter {
  name = 'kie-ai' as const;
  private apiKey: string | undefined;
  private baseUrl: string | undefined;

  constructor() {
    this.apiKey = process.env.KIE_AI_API_KEY;
    this.baseUrl = process.env.KIE_AI_BASE_URL;
  }

  isAvailable(): boolean {
    return !!(this.apiKey && this.baseUrl);
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const start = Date.now();
    return {
      success: false,
      provider: 'kie-ai',
      model: request.model ?? 'kie-ai-v1',
      content: '',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: Date.now() - start,
      error: 'KIE AI is not active in Phase 1 — this is a typed placeholder pending Phase 2 implementation.',
      metadata: { isPlaceholder: true },
    };
  }
}
