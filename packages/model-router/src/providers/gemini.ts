import { ProviderAdapter, AIRequest, AIResponse } from '../types.js';

/**
 * Gemini Provider Adapter — typed placeholder, not active in Phase 1.
 * `isAvailable()` reports whether GEMINI_API_KEY is configured; `complete()`
 * always errors since no real Gemini API call is implemented yet (Phase 2).
 */
export class GeminiAdapter implements ProviderAdapter {
  name = 'gemini' as const;
  private apiKey: string | undefined;

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const start = Date.now();
    return {
      success: false,
      provider: 'gemini',
      model: request.model ?? 'gemini-2.0-flash',
      content: '',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: Date.now() - start,
      error: 'Gemini is not active in Phase 1 — this is a typed placeholder pending Phase 2 implementation.',
      metadata: { isPlaceholder: true },
    };
  }
}
