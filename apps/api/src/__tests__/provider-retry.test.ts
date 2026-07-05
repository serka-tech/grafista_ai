import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ModelRouter,
  classifyProviderError,
  DEFAULT_RETRY_POLICIES,
  KieAIAdapter,
  type AIRequest,
  type AIResponse,
  type ProviderAdapter,
} from '@grafista/model-router';

/**
 * Phase 3 Step 3 — provider error classification + classified retry policy.
 *
 * Covers, with NO real network traffic and NO real waiting:
 *   1. classifyProviderError: status-code and message-pattern mapping to kinds.
 *   2. ModelRouter.complete retry behavior via an injected stub adapter and an
 *      injected instant delay function (the delays are RECORDED and asserted,
 *      proving exponential backoff math, but never actually slept).
 *   3. KieAIAdapter propagating structural httpStatus on HTTP failures and on
 *      Kie envelope error codes (so a permanent 422 is never retried).
 *
 * The old behavior this replaces: a blind loop that retried EVERY failure
 * (including 401 bad-key) 3 times back-to-back with zero backoff.
 */

// ---------------------------------------------------------------------------
// 1. classifyProviderError
// ---------------------------------------------------------------------------

describe('1. classifyProviderError — status-code driven classification', () => {
  it('classifies 429 as retryable rate_limit', () => {
    expect(classifyProviderError({ error: 'x', httpStatus: 429 })).toMatchObject({ kind: 'rate_limit', retryable: true });
  });

  it('classifies 500/502/503/504 as retryable transient', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(classifyProviderError({ error: 'upstream broke', httpStatus: status })).toMatchObject({
        kind: 'transient',
        retryable: true,
      });
    }
  });

  it('classifies 408 as retryable timeout', () => {
    expect(classifyProviderError({ error: 'x', httpStatus: 408 })).toMatchObject({ kind: 'timeout', retryable: true });
  });

  it('classifies 401/403 as NON-retryable auth_error', () => {
    for (const status of [401, 403]) {
      expect(classifyProviderError({ error: 'bad key', httpStatus: status })).toMatchObject({
        kind: 'auth_error',
        retryable: false,
      });
    }
  });

  it('classifies 400/404/422 as NON-retryable permanent', () => {
    for (const status of [400, 404, 422]) {
      expect(classifyProviderError({ error: 'malformed request', httpStatus: status })).toMatchObject({
        kind: 'permanent',
        retryable: false,
      });
    }
  });

  it('extracts an embedded HTTP status from Kie-style error strings', () => {
    expect(classifyProviderError({ error: 'Kie AI HTTP 502: upstream exploded' })).toMatchObject({
      kind: 'transient',
      retryable: true,
      httpStatus: 502,
    });
    expect(classifyProviderError({ error: 'Kie AI HTTP 429: slow down' })).toMatchObject({
      kind: 'rate_limit',
      httpStatus: 429,
    });
  });
});

describe('2. classifyProviderError — message-pattern classification (no status available)', () => {
  it('missing provider configuration is NON-retryable provider_unavailable', () => {
    for (const message of [
      'Provider configuration error: OPENAI_API_KEY is not set',
      'Provider configuration error: KIE_AI_API_KEY and/or KIE_AI_BASE_URL is not set',
      'No provider available for this request',
    ]) {
      expect(classifyProviderError({ error: message })).toMatchObject({ kind: 'provider_unavailable', retryable: false });
    }
  });

  it('timeouts and aborts are retryable timeout', () => {
    for (const message of [
      'Request timed out',
      'Kie AI task did not complete within 180000ms — timeout',
      'This operation was aborted',
    ]) {
      expect(classifyProviderError({ error: message })).toMatchObject({ kind: 'timeout', retryable: true });
    }
  });

  it('network-level failures are retryable transient', () => {
    for (const message of ['fetch failed', 'read ECONNRESET', 'socket hang up']) {
      expect(classifyProviderError({ error: message })).toMatchObject({ kind: 'transient', retryable: true });
    }
  });

  it('prose rate limiting is retryable rate_limit', () => {
    expect(classifyProviderError({ error: 'Rate limit reached for gpt-4o' })).toMatchObject({
      kind: 'rate_limit',
      retryable: true,
    });
  });

  it('unrecognized errors fall back to unknown with exactly one conservative retry budget', () => {
    const classification = classifyProviderError({ error: 'something entirely novel happened' });
    expect(classification).toMatchObject({ kind: 'unknown', retryable: true });
    expect(DEFAULT_RETRY_POLICIES.unknown.maxRetries).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. ModelRouter classified retry loop (stub adapter + instant recorded delays)
// ---------------------------------------------------------------------------

function response(overrides: Partial<AIResponse>): AIResponse {
  return {
    success: false,
    provider: 'openai',
    model: 'stub-model',
    content: '',
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    latencyMs: 1,
    ...overrides,
  };
}

const SUCCESS = response({ success: true, content: '{"ok":true}' });

/** Adapter that replays a scripted response sequence and counts calls (last script entry repeats). */
function scriptedAdapter(script: Array<AIResponse | Error>): ProviderAdapter & { calls: number } {
  const adapter = {
    name: 'openai' as const,
    capabilities: ['text' as const],
    calls: 0,
    isAvailable: () => true,
    complete: async (): Promise<AIResponse> => {
      const entry = script[Math.min(adapter.calls, script.length - 1)];
      adapter.calls += 1;
      if (entry instanceof Error) throw entry;
      return entry;
    },
  };
  return adapter;
}

const REQUEST: AIRequest = {
  taskType: 'caption_generation',
  provider: 'openai',
  systemPrompt: 'system',
  userPrompt: 'user',
  outputFormat: 'json',
};

describe('3. ModelRouter.complete — classified retry with exponential backoff', () => {
  let recordedDelays: number[];
  const delayFn = async (ms: number) => {
    recordedDelays.push(ms);
  };
  const savedBaseDelay = process.env.AI_RETRY_BASE_DELAY_MS;

  function routerWith(adapter: ProviderAdapter) {
    return new ModelRouter(undefined, { adapters: { openai: adapter }, delayFn });
  }

  beforeEach(() => {
    recordedDelays = [];
    // The delay assertions below verify the DEFAULT policy math — make sure no
    // ambient env override changes the computed values.
    delete process.env.AI_RETRY_BASE_DELAY_MS;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (savedBaseDelay === undefined) delete process.env.AI_RETRY_BASE_DELAY_MS;
    else process.env.AI_RETRY_BASE_DELAY_MS = savedBaseDelay;
    vi.restoreAllMocks();
  });

  it('transient 500 twice then success -> succeeds on attempt 3 with exponential backoff [250, 500]', async () => {
    const adapter = scriptedAdapter([
      response({ error: 'server exploded', httpStatus: 500 }),
      response({ error: 'server exploded', httpStatus: 500 }),
      SUCCESS,
    ]);
    const result = await routerWith(adapter).complete(REQUEST);

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
    expect(adapter.calls).toBe(3);
    expect(recordedDelays).toEqual([250, 500]);
  });

  it('persistent transient 502 -> exhausts 3 attempts, errorKind=transient, "All 3 attempts failed" message', async () => {
    const adapter = scriptedAdapter([response({ error: 'bad gateway', httpStatus: 502 })]);
    const result = await routerWith(adapter).complete(REQUEST);

    expect(result.success).toBe(false);
    expect(adapter.calls).toBe(3);
    expect(result.errorKind).toBe('transient');
    expect(result.attempts).toBe(3);
    expect(result.error).toBe('All 3 attempts failed: bad gateway');
  });

  it('rate limit 429 -> retried with the longer rate-limit backoff [1000, 2000]', async () => {
    const adapter = scriptedAdapter([response({ error: 'Too many requests', httpStatus: 429 })]);
    const result = await routerWith(adapter).complete(REQUEST);

    expect(result.success).toBe(false);
    expect(adapter.calls).toBe(3);
    expect(result.errorKind).toBe('rate_limit');
    expect(recordedDelays).toEqual([1000, 2000]);
  });

  it('timeout -> exactly one retry', async () => {
    const adapter = scriptedAdapter([response({ error: 'Request timed out' })]);
    const result = await routerWith(adapter).complete(REQUEST);

    expect(result.success).toBe(false);
    expect(adapter.calls).toBe(2);
    expect(result.errorKind).toBe('timeout');
  });

  it('auth 401 -> NO retry, single attempt, original message untouched', async () => {
    const adapter = scriptedAdapter([response({ error: 'Incorrect API key provided', httpStatus: 401 })]);
    const result = await routerWith(adapter).complete(REQUEST);

    expect(result.success).toBe(false);
    expect(adapter.calls).toBe(1);
    expect(result.errorKind).toBe('auth_error');
    expect(result.error).toBe('Incorrect API key provided');
    expect(recordedDelays).toEqual([]);
  });

  it('permanent 400 -> NO retry', async () => {
    const adapter = scriptedAdapter([response({ error: 'malformed request body', httpStatus: 400 })]);
    const result = await routerWith(adapter).complete(REQUEST);

    expect(result.success).toBe(false);
    expect(adapter.calls).toBe(1);
    expect(result.errorKind).toBe('permanent');
  });

  it('missing provider env -> NO retry (provider_unavailable)', async () => {
    const adapter = scriptedAdapter([response({ error: 'Provider configuration error: OPENAI_API_KEY is not set' })]);
    const result = await routerWith(adapter).complete(REQUEST);

    expect(result.success).toBe(false);
    expect(adapter.calls).toBe(1);
    expect(result.errorKind).toBe('provider_unavailable');
    expect(recordedDelays).toEqual([]);
  });

  it('a THROWING adapter is converted to a structured failure and classified (network error -> retried)', async () => {
    const adapter = scriptedAdapter([new Error('read ECONNRESET'), SUCCESS]);
    const result = await routerWith(adapter).complete(REQUEST);

    expect(result.success).toBe(true);
    expect(adapter.calls).toBe(2);
  });

  it('AI_RETRY_BASE_DELAY_MS=0 disables waiting entirely (env override honored)', async () => {
    process.env.AI_RETRY_BASE_DELAY_MS = '0';
    const adapter = scriptedAdapter([response({ error: 'bad gateway', httpStatus: 502 })]);
    await routerWith(adapter).complete(REQUEST);

    expect(adapter.calls).toBe(3);
    expect(recordedDelays).toEqual([0, 0]);
  });
});

// ---------------------------------------------------------------------------
// 4. KieAIAdapter — structural httpStatus propagation (stubbed fetch, fake creds)
// ---------------------------------------------------------------------------

describe('4. KieAIAdapter carries httpStatus structurally on failures', () => {
  const ENV_KEYS = ['KIE_AI_API_KEY', 'KIE_AI_BASE_URL', 'KIE_AI_POLL_INTERVAL_MS', 'KIE_AI_TIMEOUT_MS'] as const;
  const savedEnv: Record<string, string | undefined> = {};
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.KIE_AI_API_KEY = 'test-kie-key-not-real';
    process.env.KIE_AI_BASE_URL = 'https://kie.invalid';
    process.env.KIE_AI_POLL_INTERVAL_MS = '1';
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

  async function complete(): Promise<AIResponse> {
    const adapter = new KieAIAdapter();
    return adapter.complete({
      taskType: 'image_generation',
      systemPrompt: '',
      userPrompt: 'connectivity test',
      outputFormat: 'json',
    });
  }

  it('HTTP 429 from createTask -> httpStatus 429 -> classifies as rate_limit', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 429,
      text: async () => 'slow down',
    })) as unknown as typeof fetch;

    const result = await complete();
    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(429);
    expect(classifyProviderError({ error: result.error, httpStatus: result.httpStatus })).toMatchObject({
      kind: 'rate_limit',
      retryable: true,
    });
  });

  it('HTTP 500 from createTask -> httpStatus 500 -> classifies as transient', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 500,
      text: async () => 'boom',
    })) as unknown as typeof fetch;

    const result = await complete();
    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(500);
    expect(classifyProviderError({ error: result.error, httpStatus: result.httpStatus }).kind).toBe('transient');
  });

  it('Kie envelope code 422 (model not supported) -> httpStatus 422 -> NON-retryable permanent', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ code: 422, msg: 'model not supported' }),
    })) as unknown as typeof fetch;

    const result = await complete();
    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(422);
    expect(classifyProviderError({ error: result.error, httpStatus: result.httpStatus })).toMatchObject({
      kind: 'permanent',
      retryable: false,
    });
  });

  it('missing KIE config -> provider_unavailable without any fetch call', async () => {
    delete process.env.KIE_AI_API_KEY;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await complete();
    expect(result.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(classifyProviderError({ error: result.error }).kind).toBe('provider_unavailable');
  });
});
