import { ProviderAdapter, AICapability, AIRequest, AIResponse } from '../types.js';

/**
 * Higgsfield Provider Adapter (Placeholder)
 * Future integration for AI video generation
 */
export class HiggsFieldAdapter implements ProviderAdapter {
  name = 'higgsfield' as const;
  // Placeholder slated for video generation only — matches the routing table,
  // where higgsfield appears solely as a video_generation fallback. complete()
  // returns its structured placeholder error without any network call.
  capabilities: AICapability[] = ['video_generation'];
  private apiKey: string | undefined;
  private baseUrl: string | undefined;

  constructor() {
    this.apiKey = process.env.HIGGSFIELD_API_KEY;
    this.baseUrl = process.env.HIGGSFIELD_BASE_URL;
  }

  isAvailable(): boolean {
    return !!(this.apiKey && this.baseUrl);
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const start = Date.now();
    return {
      success: false,
      provider: 'higgsfield',
      model: request.model ?? 'higgsfield-v1',
      content: '',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: Date.now() - start,
      error: 'Higgsfield is not active in Phase 1 — this is a typed placeholder pending Phase 2 implementation.',
      metadata: { isPlaceholder: true },
    };
  }
}
