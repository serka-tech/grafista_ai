import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { normalizeAspectRatio, KIE_SUPPORTED_ASPECT_RATIOS, KieAIAdapter } from '@grafista/model-router';

/**
 * Phase 2 Step 13 hotfix A — KIE aspect ratio normalization.
 *
 * Regression coverage for manual-demo-pass blocker B2: the visual-generation
 * service passes the layout plan's raw pixel canvas as metadata.aspectRatio
 * (e.g. "1080:1080"); Kie's jobs API only accepts normalized ratios ("1:1")
 * and rejects raw pixel pairs with HTTP 500, so every real image generation
 * failed. The fix normalizes at the KieAIAdapter boundary via
 * normalizeAspectRatio (packages/model-router/src/aspect-ratio.ts).
 *
 * Two layers are tested here, with NO real network traffic:
 *   1. normalizeAspectRatio unit behavior (gcd reduction, nearest-supported
 *      snapping by log distance, graceful structured errors — never throws).
 *   2. KieAIAdapter request-body behavior with a stubbed global fetch: the
 *      createTask body must carry the NORMALIZED aspect_ratio (or omit it for
 *      unusable input), and the adapter must never crash on bad ratios.
 *
 * The mocked-ModelRouter visual generation flow (raw "1080:1080" metadata from
 * the service) stays covered in visual-generation.test.ts — untouched by this
 * hotfix because normalization happens inside the provider adapter.
 */

describe('1. normalizeAspectRatio — gcd reduction of supported ratios', () => {
  it('reduces pixel pairs to canonical ratios', () => {
    expect(normalizeAspectRatio(1080, 1080)).toMatchObject({ ok: true, ratio: '1:1', snapped: false });
    expect(normalizeAspectRatio(1080, 1920)).toMatchObject({ ok: true, ratio: '9:16', snapped: false });
    expect(normalizeAspectRatio(1920, 1080)).toMatchObject({ ok: true, ratio: '16:9', snapped: false });
    expect(normalizeAspectRatio(1080, 1350)).toMatchObject({ ok: true, ratio: '4:5', snapped: false });
    expect(normalizeAspectRatio(1200, 900)).toMatchObject({ ok: true, ratio: '4:3', snapped: false });
  });

  it('accepts "width:height" strings (the exact shape the service sends)', () => {
    expect(normalizeAspectRatio('1080:1080')).toMatchObject({ ok: true, ratio: '1:1', snapped: false });
    expect(normalizeAspectRatio('1080:1920')).toMatchObject({ ok: true, ratio: '9:16', snapped: false });
    expect(normalizeAspectRatio('1920:1080')).toMatchObject({ ok: true, ratio: '16:9', snapped: false });
  });

  it('accepts "widthxheight" preset-style strings and whitespace', () => {
    expect(normalizeAspectRatio('1080x1080')).toMatchObject({ ok: true, ratio: '1:1' });
    expect(normalizeAspectRatio(' 1920 : 1080 ')).toMatchObject({ ok: true, ratio: '16:9' });
  });

  it('passes through already-normalized supported ratios unchanged', () => {
    for (const ratio of KIE_SUPPORTED_ASPECT_RATIOS) {
      expect(normalizeAspectRatio(ratio)).toMatchObject({ ok: true, ratio, snapped: false });
    }
  });
});

describe('2. normalizeAspectRatio — snapping unsupported exact ratios', () => {
  it('snaps a custom ad-banner ratio (1200:628 ≈ 1.91) to the nearest supported ratio (16:9)', () => {
    const result = normalizeAspectRatio('1200:628');
    expect(result).toMatchObject({ ok: true, ratio: '16:9', snapped: true, exactRatio: '300:157' });
  });

  it('snaps ultra-wide ratios toward 21:9 and near-square ratios toward 1:1', () => {
    expect(normalizeAspectRatio(2560, 1080)).toMatchObject({ ok: true, ratio: '21:9', snapped: true });
    expect(normalizeAspectRatio(1000, 1020)).toMatchObject({ ok: true, ratio: '1:1', snapped: true });
  });

  it('always returns a member of the supported list, portrait or landscape', () => {
    const samples: Array<[number, number]> = [
      [1080, 566],
      [566, 1080],
      [123, 457],
      [3000, 100],
      [100, 3000],
    ];
    for (const [w, h] of samples) {
      const result = normalizeAspectRatio(w, h);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(KIE_SUPPORTED_ASPECT_RATIOS).toContain(result.ratio);
        expect(result.snapped).toBe(true);
      }
    }
  });
});

describe('3. normalizeAspectRatio — graceful structured errors (never throws)', () => {
  it('rejects zero, negative, and non-finite dimensions with ok:false', () => {
    for (const [w, h] of [
      [0, 1080],
      [1080, 0],
      [-1080, 1080],
      [1080, -1],
      [NaN, 1080],
      [1080, Infinity],
    ] as Array<[number, number]>) {
      const result = normalizeAspectRatio(w, h);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBeTruthy();
    }
  });

  it('rejects unparseable strings with ok:false', () => {
    for (const bad of ['', 'square', '1080', '1080:', ':1080', '1080:19:20', 'a:b', '0:0', '-2:3']) {
      const result = normalizeAspectRatio(bad);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects sub-pixel dimensions that round to zero', () => {
    expect(normalizeAspectRatio(0.2, 1080).ok).toBe(false);
  });
});

/**
 * Adapter-level regression: stub global fetch, drive KieAIAdapter.complete(),
 * and assert on the ACTUAL createTask request body — the exact JSON Kie would
 * receive. Fake credentials only; no request ever leaves the process.
 */
describe('4. KieAIAdapter sends the normalized aspect_ratio to Kie', () => {
  const ENV_KEYS = ['KIE_AI_API_KEY', 'KIE_AI_BASE_URL', 'KIE_AI_POLL_INTERVAL_MS', 'KIE_AI_TIMEOUT_MS'] as const;
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

    fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/jobs/createTask')) {
        return jsonResponse({ code: 200, data: { taskId: 'task-test-1' } });
      }
      return jsonResponse({
        code: 200,
        data: { state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://kie.invalid/out.png'] }) },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    vi.restoreAllMocks();
  });

  async function completeWithAspectRatio(aspectRatio?: unknown) {
    const adapter = new KieAIAdapter();
    return adapter.complete({
      taskType: 'image_generation',
      systemPrompt: 'system',
      userPrompt: 'user',
      outputFormat: 'json',
      ...(aspectRatio !== undefined ? { metadata: { aspectRatio } } : {}),
    });
  }

  function sentCreateTaskBody(): { model: string; input: { prompt: string; aspect_ratio?: string } } {
    const createTaskCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/jobs/createTask'));
    expect(createTaskCall).toBeDefined();
    return JSON.parse((createTaskCall![1] as RequestInit).body as string);
  }

  it('raw pixel "1080:1080" (the blocker B2 input) goes out as "1:1"', async () => {
    const response = await completeWithAspectRatio('1080:1080');
    expect(response.success).toBe(true);
    expect(sentCreateTaskBody().input.aspect_ratio).toBe('1:1');
  });

  it('"1080:1920" goes out as "9:16"', async () => {
    const response = await completeWithAspectRatio('1080:1920');
    expect(response.success).toBe(true);
    expect(sentCreateTaskBody().input.aspect_ratio).toBe('9:16');
  });

  it('"1920:1080" goes out as "16:9"', async () => {
    const response = await completeWithAspectRatio('1920:1080');
    expect(response.success).toBe(true);
    expect(sentCreateTaskBody().input.aspect_ratio).toBe('16:9');
  });

  it('already-normalized "1:1" passes through unchanged, without a normalization warning', async () => {
    const response = await completeWithAspectRatio('1:1');
    expect(response.success).toBe(true);
    expect(sentCreateTaskBody().input.aspect_ratio).toBe('1:1');
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('unsupported custom "1200:628" is snapped to "16:9" with a traceability warning (original + normalized, no secrets)', async () => {
    const response = await completeWithAspectRatio('1200:628');
    expect(response.success).toBe(true);
    expect(sentCreateTaskBody().input.aspect_ratio).toBe('16:9');

    const warning = vi.mocked(console.warn).mock.calls.map((args) => args.join(' ')).join('\n');
    expect(warning).toContain('originalAspectRatio=1200:628');
    expect(warning).toContain('normalizedAspectRatio=16:9');
    expect(warning).not.toContain('test-kie-key-not-real');
  });

  it('invalid aspect ratio ("garbage") degrades gracefully: aspect_ratio omitted, request still succeeds', async () => {
    const response = await completeWithAspectRatio('garbage');
    expect(response.success).toBe(true);
    expect(sentCreateTaskBody().input.aspect_ratio).toBeUndefined();
    const warning = vi.mocked(console.warn).mock.calls.map((args) => args.join(' ')).join('\n');
    expect(warning).toContain('unusable aspect ratio');
  });

  it('"0:0" degrades gracefully too — no crash, aspect_ratio omitted', async () => {
    const response = await completeWithAspectRatio('0:0');
    expect(response.success).toBe(true);
    expect(sentCreateTaskBody().input.aspect_ratio).toBeUndefined();
  });

  it('no metadata.aspectRatio at all keeps the previous behavior (aspect_ratio omitted)', async () => {
    const response = await completeWithAspectRatio(undefined);
    expect(response.success).toBe(true);
    expect(sentCreateTaskBody().input.aspect_ratio).toBeUndefined();
  });
});
