import OpenAI from 'openai';
import { ProviderAdapter, AICapability, AIRequest, AIResponse } from '../types.js';

/** Default OpenAI model for text-only completions (unchanged behavior). */
const DEFAULT_TEXT_MODEL = 'gpt-4o';

/** Default OpenAI image-generation model. Overridable via OPENAI_IMAGE_MODEL. */
const DEFAULT_IMAGE_MODEL = 'gpt-image-1';

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

/** Picks the image-generation model — mirrors KIE_AI_IMAGE_MODEL resolution. */
function resolveImageModel(requested?: string): string {
  return requested ?? process.env.OPENAI_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL;
}

/**
 * Map a caller-supplied aspect ratio (raw pixels like "1080:1080" or a
 * normalized ratio like "1:1") to the nearest size gpt-image-1 accepts. The
 * model only takes 1024x1024 (square), 1536x1024 (landscape) or 1024x1536
 * (portrait) — arbitrary pixel dimensions (e.g. 1080x1080) are rejected with a
 * 400. Unusable/absent input degrades to square, never a crash.
 */
type OpenAIImageSize = '1024x1024' | '1536x1024' | '1024x1536';
function resolveImageSize(aspectRatio?: unknown): OpenAIImageSize {
  if (typeof aspectRatio !== 'string') return '1024x1024';
  const match = aspectRatio.match(/^(\d+)\s*[:x]\s*(\d+)$/i);
  if (!match) return '1024x1024';
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!w || !h) return '1024x1024';
  const ratio = w / h;
  if (ratio > 1.2) return '1536x1024'; // landscape
  if (ratio < 0.83) return '1024x1536'; // portrait
  return '1024x1024'; // square-ish (covers 1:1 / 1080:1080)
}

/**
 * OpenAI Provider Adapter
 * Supports: text completion, vision analysis (chat completions) AND image
 * generation (Images API, gpt-image-1). complete() branches on
 * request.taskType === 'image_generation' to call this.client.images.generate;
 * every other task keeps the chat.completions.create path unchanged.
 */
export class OpenAIAdapter implements ProviderAdapter {
  name = 'openai' as const;
  // text + vision via chat.completions; image_generation via the Images API
  // (gpt-image-1) — see the image_generation branch in complete().
  capabilities: AICapability[] = ['text', 'vision', 'image_generation'];
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

    // Image-generation branch — OpenAI Images API (gpt-image-1). Kept entirely
    // separate from the chat-completions path below. Returns the same
    // { images: [{ imageBase64, mimeType, width, height }] } JSON content shape
    // the KIE adapter produces and VisualGenerationPayloadSchema expects, so
    // visual-generation.ts consumes it with no provider-specific handling.
    if (request.taskType === 'image_generation') {
      const model = resolveImageModel(request.model);
      try {
        const size = resolveImageSize(request.metadata?.aspectRatio);
        // gpt-image-1 takes one flat prompt — fold system + user together, the
        // same information chat providers get as two messages.
        const prompt = [request.systemPrompt, request.userPrompt].filter(Boolean).join('\n\n');
        // gpt-image-1 always returns base64 (no response_format param); n:1 keeps
        // it aligned with the single-image payload the schema requires.
        const result = await this.client.images.generate({ model, prompt, size, n: 1 });
        const b64 = result.data?.[0]?.b64_json;
        if (!b64) {
          return {
            success: false,
            provider: 'openai',
            model,
            content: '',
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            latencyMs: Date.now() - start,
            error: 'OpenAI image generation returned no image data',
          };
        }
        const [wStr, hStr] = size.split('x');
        return {
          success: true,
          provider: 'openai',
          model,
          content: JSON.stringify({
            images: [{ imageBase64: b64, mimeType: 'image/png', width: Number(wStr), height: Number(hStr) }],
          }),
          // Images API bills per image, not per token — usage stays zeroed like KIE.
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          latencyMs: Date.now() - start,
          metadata: { size },
        };
      } catch (err) {
        const status = (err as { status?: unknown })?.status;
        const httpStatus = typeof status === 'number' ? status : undefined;
        return {
          success: false,
          provider: 'openai',
          model,
          content: '',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          latencyMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
          ...(httpStatus !== undefined ? { httpStatus } : {}),
        };
      }
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
      // OpenAI SDK APIError carries the upstream HTTP status structurally —
      // surface it so the router's retry policy can classify (429 vs 401 vs
      // 5xx) instead of parsing it back out of the message string.
      const status = (err as { status?: unknown })?.status;
      const httpStatus = typeof status === 'number' ? status : undefined;
      return {
        success: false,
        provider: 'openai',
        model: request.model ?? (hasImages ? resolveVisionModel() : DEFAULT_TEXT_MODEL),
        content: '',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
        ...(httpStatus !== undefined ? { httpStatus } : {}),
      };
    }
  }
}
