import OpenAI from 'openai';
import { ProviderAdapter, AICapability, AIRequest, AIResponse } from '../types.js';

/** Default OpenAI model for text-only completions (unchanged behavior). */
const DEFAULT_TEXT_MODEL = 'gpt-4o';

/**
 * Default OpenAI model used when `request.images` is present. Overridable via
 * OPENAI_VISION_MODEL — mirrors how DEFAULT_VISION_PROVIDER (see .env.example)
 * already picks the *provider* for vision tasks; this picks the *model* once
 * OpenAI is that provider. gpt-4o is vision-capable, so this defaults to the
 * same model as text completions unless overridden.
 */
function resolveVisionModel(requested?: string): string {
  return requested ?? process.env.OPENAI_VISION_MODEL ?? DEFAULT_TEXT_MODEL;
}

/**
 * OpenAI Provider Adapter
 * Supports: text completion, vision analysis (chat completions only).
 * Does NOT implement the OpenAI Images API — complete() always calls
 * chat.completions.create, so this adapter cannot generate images.
 */
export class OpenAIAdapter implements ProviderAdapter {
  name = 'openai' as const;
  // complete() only ever calls chat.completions.create (text + image *inputs*),
  // never the Images API — so no image_generation capability here.
  capabilities: AICapability[] = ['text', 'vision'];
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

    const hasImages = Array.isArray(request.images) && request.images.length > 0;

    if (!this.client) {
      return {
        success: false,
        provider: 'openai',
        model: request.model ?? (hasImages ? resolveVisionModel() : DEFAULT_TEXT_MODEL),
        content: '',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        latencyMs: Date.now() - start,
        error: 'Provider configuration error: OPENAI_API_KEY is not set',
      };
    }

    try {
      const model = hasImages ? resolveVisionModel(request.model) : request.model ?? DEFAULT_TEXT_MODEL;

      // Multi-modal user content: when images are present, build a content-part array
      // (OpenAI chat completions format) mixing the text prompt with each image as a
      // data URI or URL — otherwise keep the plain-string content used previously.
      const userContent: string | OpenAI.Chat.Completions.ChatCompletionContentPart[] = hasImages
        ? [
            { type: 'text', text: request.userPrompt },
            ...request.images!.map(
              (image): OpenAI.Chat.Completions.ChatCompletionContentPartImage => ({
                type: 'image_url',
                image_url: { url: image },
              })
            ),
          ]
        : request.userPrompt;

      const response = await this.client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: userContent },
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
        model: request.model ?? (hasImages ? resolveVisionModel() : DEFAULT_TEXT_MODEL),
        content: '',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
