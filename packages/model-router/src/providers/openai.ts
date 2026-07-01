import OpenAI from 'openai';
import { ProviderAdapter, AIRequest, AIResponse } from '../types.js';

/**
 * OpenAI Provider Adapter
 * Supports: text completion, vision analysis, image generation
 */
export class OpenAIAdapter implements ProviderAdapter {
  name = 'openai' as const;
  private apiKey: string | undefined;
  private client: OpenAI | undefined;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    if (this.apiKey) {
      this.client = new OpenAI({ apiKey: this.apiKey });
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
        provider: 'openai',
        model: request.model ?? 'gpt-4o',
        content: '',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        latencyMs: Date.now() - start,
        error: 'Provider configuration error: OPENAI_API_KEY is not set',
      };
    }

    try {
      const model = request.model ?? 'gpt-4o';
      const response = await this.client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
        max_tokens: request.maxTokens,
        temperature: request.temperature,
      });

      const choice = response.choices[0];
      const content = choice?.message?.content ?? '';

      return {
        success: true,
        provider: 'openai',
        model: response.model,
        content,
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        provider: 'openai',
        model: request.model ?? 'gpt-4o',
        content: '',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
