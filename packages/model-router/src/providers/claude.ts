import Anthropic from '@anthropic-ai/sdk';
import { ProviderAdapter, AICapability, AIRequest, AIResponse } from '../types.js';

const DEFAULT_MODEL = 'claude-opus-4-8';

export class ClaudeAdapter implements ProviderAdapter {
  name = 'claude' as const;
  // complete() sends text-only messages (request.images is ignored — no image
  // content blocks are built), so this adapter is text-only today.
  capabilities: AICapability[] = ['text'];
  private apiKey: string | undefined;
  private client: Anthropic | undefined;

  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY;
    if (this.apiKey) {
      this.client = new Anthropic({ apiKey: this.apiKey });
    }
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const start = Date.now();

    if (!this.client) {
      return {
        success: false,
        provider: 'claude',
        model: request.model ?? DEFAULT_MODEL,
        content: '',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        latencyMs: Date.now() - start,
        error: 'Provider configuration error: ANTHROPIC_API_KEY is not set',
      };
    }

    try {
      const model = request.model ?? DEFAULT_MODEL;
      const response = await this.client.messages.create({
        model,
        max_tokens: request.maxTokens ?? 4096,
        system: request.systemPrompt,
        messages: [{ role: 'user', content: request.userPrompt }],
      });

      const textBlock = response.content.find((block) => block.type === 'text');
      const content = textBlock && textBlock.type === 'text' ? textBlock.text : '';

      return {
        success: true,
        provider: 'claude',
        model: response.model,
        content,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        },
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      // Anthropic SDK APIError carries the upstream HTTP status structurally —
      // same propagation as OpenAIAdapter so the router's retry policy can
      // classify without string parsing.
      const status = (err as { status?: unknown })?.status;
      const httpStatus = typeof status === 'number' ? status : undefined;
      return {
        success: false,
        provider: 'claude',
        model: request.model ?? DEFAULT_MODEL,
        content: '',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
        ...(httpStatus !== undefined ? { httpStatus } : {}),
      };
    }
  }
}
