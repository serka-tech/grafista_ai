import { ProviderAdapter, AICapability, AIRequest, AIResponse } from '../types.js';

/**
 * Gemini Provider Adapter — typed placeholder, not active in Phase 1.
 * `complete()` always errors since no real Gemini API call is implemented yet
 * (Phase 2), so `isAvailable()` returns false: an unimplemented adapter must
 * never be selected by the router (even if GEMINI_API_KEY happens to be set),
 * or a capability-based reroute could pick it and fire a doomed, always-failing
 * call. When real Gemini support lands, restore the key-based availability check.
 */
export class GeminiAdapter implements ProviderAdapter {
  name = 'gemini' as const;
  // Slated for text + vision chat (Gemini multimodal) once implemented.
  capabilities: AICapability[] = ['text', 'vision'];

  isAvailable(): boolean {
    // Placeholder is not operational — never selectable until complete() is real.
    return false;
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
