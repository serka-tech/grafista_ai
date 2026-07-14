import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAIAdapter } from '@grafista/model-router';
import type { AIRequest } from '@grafista/model-router';

/**
 * OpenAI image generation (gpt-image-1) adapter coverage.
 *
 * OpenAIAdapter uses the official `openai` SDK, which issues its HTTP calls
 * through the global fetch. Mocking the `openai` module doesn't work here
 * because the adapter is imported from the compiled @grafista/model-router
 * dist — so, exactly like the KIE tests, we stub global fetch and assert on the
 * ACTUAL /images/generations request body. Fake API key only; nothing leaves
 * the process. httpStatus tests use 400/401 (never retried by the SDK) to keep
 * a single fetch call per test.
 */

describe('OpenAIAdapter image generation (gpt-image-1)', () => {
  const ENV_KEYS = ['OPENAI_API_KEY', 'OPENAI_IMAGE_MODEL'] as const;
  const saved: Record<string, string | undefined> = {};
  const realFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  function okImage(b64: unknown = 'QUJDREVG'): Response {
    return new Response(JSON.stringify({ created: 1, data: [{ b64_json: b64 }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  function errorResponse(status: number): Response {
    return new Response(JSON.stringify({ error: { message: 'boom', type: 'invalid_request_error' } }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.OPENAI_API_KEY = 'sk-test-not-real';
    delete process.env.OPENAI_IMAGE_MODEL;
    fetchMock = vi.fn(async () => okImage());
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
  });

  function imageRequest(overrides: Partial<AIRequest> = {}): AIRequest {
    return {
      taskType: 'image_generation',
      systemPrompt: 'sys prompt',
      userPrompt: 'user prompt',
      outputFormat: 'json',
      ...overrides,
    };
  }

  function sentBody(): { model: string; prompt: string; size: string; n?: number } {
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/images/generations'));
    expect(call).toBeDefined();
    return JSON.parse((call![1] as RequestInit).body as string);
  }

  it('now advertises the image_generation capability', () => {
    expect(new OpenAIAdapter().capabilities).toContain('image_generation');
  });

  it('calls the Images API and returns schema-shaped base64 content', async () => {
    const res = await new OpenAIAdapter().complete(imageRequest());

    expect(res.success).toBe(true);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/images/generations');

    const body = sentBody();
    expect(body.model).toBe('gpt-image-1');
    expect(body.prompt).toContain('sys prompt');
    expect(body.prompt).toContain('user prompt');
    expect(body.size).toBe('1024x1024');

    const parsed = JSON.parse(res.content) as { images: Array<{ imageBase64: string; mimeType: string }> };
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0].imageBase64).toBe('QUJDREVG');
    expect(parsed.images[0].mimeType).toBe('image/png');
    expect(res.provider).toBe('openai');
  });

  it('maps aspect ratios to the sizes gpt-image-1 actually accepts', async () => {
    await new OpenAIAdapter().complete(imageRequest({ metadata: { aspectRatio: '1080:1080' } }));
    expect(sentBody().size).toBe('1024x1024');

    fetchMock.mockClear();
    await new OpenAIAdapter().complete(imageRequest({ metadata: { aspectRatio: '1080:1920' } }));
    expect(sentBody().size).toBe('1024x1536');

    fetchMock.mockClear();
    await new OpenAIAdapter().complete(imageRequest({ metadata: { aspectRatio: '1920:1080' } }));
    expect(sentBody().size).toBe('1536x1024');
  });

  it('OPENAI_IMAGE_MODEL env overrides the built-in default', async () => {
    process.env.OPENAI_IMAGE_MODEL = 'gpt-image-future';
    const res = await new OpenAIAdapter().complete(imageRequest());
    expect(sentBody().model).toBe('gpt-image-future');
    expect(res.model).toBe('gpt-image-future');
  });

  it('surfaces the upstream HTTP status on failure (for the retry policy)', async () => {
    fetchMock.mockImplementation(async () => errorResponse(400));
    const res = await new OpenAIAdapter().complete(imageRequest());
    expect(res.success).toBe(false);
    expect(res.httpStatus).toBe(400);
  });

  it('an empty image response is a structured failure, not a throw', async () => {
    // Body with data[0] but NO b64_json — written inline (not okImage(undefined),
    // which would trigger okImage's default arg and send a real base64 back).
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ created: 1, data: [{}] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );
    const res = await new OpenAIAdapter().complete(imageRequest());
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no image data/i);
  });

  it('unconfigured adapter (no API key) fails structurally without calling the API', async () => {
    delete process.env.OPENAI_API_KEY;
    const res = await new OpenAIAdapter().complete(imageRequest());
    expect(res.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
