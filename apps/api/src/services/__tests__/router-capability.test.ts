import { describe, expect, it, vi } from 'vitest';
import { ModelRouter, GeminiAdapter } from '@grafista/model-router';
import type { AICapability, AIProvider, AIRequest, AIResponse, ProviderAdapter, TaskRouting } from '@grafista/model-router';

interface StubAdapter extends ProviderAdapter {
  calls: AIRequest[];
}

function stub(name: AIProvider, capabilities: AICapability[], available = true): StubAdapter {
  const calls: AIRequest[] = [];
  return {
    name,
    capabilities,
    calls,
    isAvailable: () => available,
    complete: async (request: AIRequest): Promise<AIResponse> => {
      calls.push(request);
      return {
        success: true,
        provider: name,
        model: request.model ?? `${name}-stub`,
        content: '{}',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        latencyMs: 0,
      };
    },
  };
}

/** All the adapters a test cares about, wired into a router via the test seam. */
function makeRouter(overrides?: Partial<Record<AIProvider, StubAdapter>>, customRouting?: TaskRouting[]) {
  const adapters = {
    // openai can do vision AND image generation in these tests
    openai: stub('openai', ['text', 'vision', 'image_generation']),
    claude: stub('claude', ['text']),
    'kie-ai': stub('kie-ai', ['image_generation']),
    ...overrides,
  };
  const router = new ModelRouter(customRouting, { adapters, delayFn: async () => {} });
  return { router, adapters };
}

const baseReq = (patch: Partial<AIRequest>): AIRequest => ({
  taskType: 'style_analysis',
  systemPrompt: 's',
  userPrompt: 'u',
  outputFormat: 'json',
  ...patch,
});

describe('router capability enforcement on the explicit-provider path', () => {
  it('(a) reroutes explicit text-only claude on a vision task to a vision provider that actually receives the image', async () => {
    const { router, adapters } = makeRouter();
    const dataUri = 'data:image/png;base64,QUJD';
    const res = await router.complete(baseReq({ provider: 'claude', taskType: 'style_analysis', images: [dataUri] }));
    expect(res.provider).toBe('openai');
    expect(adapters.claude.calls).toHaveLength(0);
    expect(adapters.openai.calls).toHaveLength(1);
    // The whole point: image bytes reach the SELECTED adapter, not just a capability array.
    expect(adapters.openai.calls[0].images).toEqual([dataUri]);
  });

  it('(b) honors an explicit openai for image_generation', async () => {
    const { router, adapters } = makeRouter();
    const res = await router.complete(baseReq({ provider: 'openai', taskType: 'image_generation' }));
    expect(res.provider).toBe('openai');
    expect(adapters.openai.calls).toHaveLength(1);
    expect(adapters['kie-ai'].calls).toHaveLength(0);
  });

  it('(c) honors an explicit kie-ai for image_generation', async () => {
    const { router, adapters } = makeRouter();
    const res = await router.complete(baseReq({ provider: 'kie-ai', taskType: 'image_generation' }));
    expect(res.provider).toBe('kie-ai');
    expect(adapters['kie-ai'].calls).toHaveLength(1);
    expect(adapters.openai.calls).toHaveLength(0);
  });

  it('(d) honors an explicit provider when the task has no required capabilities', async () => {
    const customRouting: TaskRouting[] = [
      { taskType: 'brand_intake', primaryProvider: 'openai', fallbackProviders: [], requiredCapabilities: [] },
    ];
    const { router, adapters } = makeRouter(undefined, customRouting);
    const res = await router.complete(baseReq({ provider: 'claude', taskType: 'brand_intake' }));
    expect(res.provider).toBe('claude');
    expect(adapters.claude.calls).toHaveLength(1);
  });

  it('(e) honors an explicit claude for creative_qa (now a text-only task, not rerouted)', async () => {
    const { router, adapters } = makeRouter();
    const res = await router.complete(baseReq({ provider: 'claude', taskType: 'creative_qa' }));
    expect(res.provider).toBe('claude');
    expect(adapters.claude.calls).toHaveLength(1);
    expect(adapters.openai.calls).toHaveLength(0);
  });

  it('(f) never selects the unavailable gemini placeholder for a vision task', async () => {
    // Real GeminiAdapter.isAvailable() now returns false; model an equally-unavailable stub
    // to prove it is skipped and the vision-capable openai is chosen instead.
    const gemini = stub('gemini', ['text', 'vision'], false);
    const { router, adapters } = makeRouter({ gemini });
    const res = await router.complete(baseReq({ provider: 'gemini', taskType: 'style_analysis', images: ['data:image/png;base64,QQ=='] }));
    expect(res.provider).toBe('openai');
    expect(gemini.calls).toHaveLength(0);
    expect(adapters.openai.calls).toHaveLength(1);
  });

  it('(g) clears a provider-specific model when the explicit provider is swapped out (capability mismatch)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { router, adapters } = makeRouter();
    const req = baseReq({ provider: 'claude', taskType: 'style_analysis', model: 'claude-3-opus', images: ['data:image/png;base64,QQ=='] });
    await router.complete(req);
    expect(adapters.openai.calls[0].model).toBeUndefined();
    // The caller's own request object must NOT be mutated (dispatch copy only).
    expect(req.model).toBe('claude-3-opus');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('(h) clears the model when the explicit provider is UNAVAILABLE (not just capability mismatch)', async () => {
    // Regression: an unavailable explicit provider (e.g. gemini, now always unavailable)
    // used to leak its model into the substituted adapter and doom the call.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const claudeDown = stub('claude', ['text'], false);
    const { router, adapters } = makeRouter({ claude: claudeDown });
    await router.complete(baseReq({ provider: 'claude', taskType: 'style_analysis', model: 'claude-3-opus', images: ['data:image/png;base64,QQ=='] }));
    expect(claudeDown.calls).toHaveLength(0);
    expect(adapters.openai.calls).toHaveLength(1);
    expect(adapters.openai.calls[0].model).toBeUndefined();
    warn.mockRestore();
  });

  it('(i) the real GeminiAdapter placeholder is never available, so it is never selected', async () => {
    expect(new GeminiAdapter().isAvailable()).toBe(false);
    // No gemini override → the real (unavailable) adapter is in play; explicit gemini
    // on a vision task must route to the available vision-capable openai.
    const { router, adapters } = makeRouter();
    const res = await router.complete(baseReq({ provider: 'gemini', taskType: 'style_analysis', images: ['data:image/png;base64,QQ=='] }));
    expect(res.provider).toBe('openai');
    expect(adapters.openai.calls).toHaveLength(1);
  });
});
