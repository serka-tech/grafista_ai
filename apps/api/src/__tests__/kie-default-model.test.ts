import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KieAIAdapter, KIE_DEFAULT_IMAGE_MODEL } from '@grafista/model-router';

/**
 * Phase 2 Step 13 hotfix B — KIE default image model.
 *
 * Regression coverage for the Step 12 finding: the adapter's previous
 * built-in default image model (gpt-image-1.5) is no longer accepted by Kie
 * (HTTP 422 "model not supported"), so any environment without a manual
 * KIE_AI_IMAGE_MODEL override in .env broke on real image generation. The
 * fix makes nano-banana-2 the built-in fallback (KIE_DEFAULT_IMAGE_MODEL,
 * single source of truth in packages/model-router/src/providers/kie-ai.ts)
 * while keeping the resolution order unchanged:
 *   request.model  >  KIE_AI_IMAGE_MODEL env  >  KIE_DEFAULT_IMAGE_MODEL.
 *
 * Same test pattern as kie-aspect-ratio.test.ts: stub global fetch, drive
 * KieAIAdapter.complete(), and assert on the ACTUAL createTask request body.
 * Fake credentials only; no request ever leaves the process.
 */

const RETIRED_DEFAULT_MODEL = 'gpt-image-1.5'; // rejected by Kie with 422 — must never be the fallback again

describe('KieAIAdapter default image model (hotfix B)', () => {
  const ENV_KEYS = [
    'KIE_AI_API_KEY',
    'KIE_AI_BASE_URL',
    'KIE_AI_IMAGE_MODEL',
    'KIE_AI_POLL_INTERVAL_MS',
    'KIE_AI_TIMEOUT_MS',
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};
  const realFetch = globalThis.fetch;

  let fetchMock: ReturnType<typeof vi.fn>;

  function jsonResponse(payload: unknown) {
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  }

  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.KIE_AI_API_KEY = 'test-kie-key-not-real';
    process.env.KIE_AI_BASE_URL = 'https://kie.invalid';
    process.env.KIE_AI_POLL_INTERVAL_MS = '1'; // keep the poll loop fast in tests
    delete process.env.KIE_AI_IMAGE_MODEL; // each test sets it explicitly if needed

    fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/jobs/createTask')) {
        return jsonResponse({ code: 200, data: { taskId: 'task-test-model' } });
      }
      return jsonResponse({
        code: 200,
        data: { state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://kie.invalid/out.png'] }) },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    vi.restoreAllMocks();
  });

  async function complete(requestModel?: string) {
    const adapter = new KieAIAdapter();
    return adapter.complete({
      taskType: 'image_generation',
      systemPrompt: 'system',
      userPrompt: 'user',
      outputFormat: 'json',
      ...(requestModel !== undefined ? { model: requestModel } : {}),
    });
  }

  function sentCreateTaskBody(): { model: string; input: { prompt: string } } {
    const createTaskCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/jobs/createTask'));
    expect(createTaskCall).toBeDefined();
    return JSON.parse((createTaskCall![1] as RequestInit).body as string);
  }

  it('the exported default is nano-banana-2 — and no longer the Kie-rejected gpt-image-1.5', () => {
    expect(KIE_DEFAULT_IMAGE_MODEL).toBe('nano-banana-2');
    expect(KIE_DEFAULT_IMAGE_MODEL).not.toBe(RETIRED_DEFAULT_MODEL);
  });

  it('KIE_AI_IMAGE_MODEL unset -> createTask body carries the built-in default (nano-banana-2)', async () => {
    const response = await complete();
    expect(response.success).toBe(true);
    expect(sentCreateTaskBody().model).toBe(KIE_DEFAULT_IMAGE_MODEL);
    expect(sentCreateTaskBody().model).toBe('nano-banana-2');
    expect(response.model).toBe('nano-banana-2');
  });

  it('KIE_AI_IMAGE_MODEL set -> env override wins over the built-in default (override behavior preserved)', async () => {
    process.env.KIE_AI_IMAGE_MODEL = 'some-future-kie-model';
    const response = await complete();
    expect(response.success).toBe(true);
    expect(sentCreateTaskBody().model).toBe('some-future-kie-model');
    expect(response.model).toBe('some-future-kie-model');
  });

  it('request.model wins over both the env override and the default', async () => {
    process.env.KIE_AI_IMAGE_MODEL = 'env-model';
    const response = await complete('request-model');
    expect(response.success).toBe(true);
    expect(sentCreateTaskBody().model).toBe('request-model');
    expect(response.model).toBe('request-model');
  });

  it('the retired default never reaches the wire when nothing is configured', async () => {
    const response = await complete();
    expect(response.success).toBe(true);
    const allBodies = fetchMock.mock.calls
      .map(([, init]) => String((init as RequestInit | undefined)?.body ?? ''))
      .join('\n');
    expect(allBodies).not.toContain(RETIRED_DEFAULT_MODEL);
  });

  it('unconfigured adapter (no API key) still reports the default model in its structured failure', async () => {
    delete process.env.KIE_AI_API_KEY;
    const response = await complete();
    expect(response.success).toBe(false);
    expect(response.model).toBe('nano-banana-2');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
