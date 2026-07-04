import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { FakeAIAdapter, type AIRequest, type AITaskType } from '@grafista/model-router';
import {
  StyleAnalysisSchema,
  DesignDNAContentSchema,
  LayoutPlanContentSchema,
  CreativeQAReportContentSchema,
  VisualGenerationPayloadSchema,
} from '@grafista/schemas';

/**
 * Pure-logic unit tests for the offline-demo FakeAIAdapter — no DB/HTTP (same
 * placement rationale as src/render/__tests__: outside src/__tests__/, whose
 * files all exercise the embedded-Postgres app stack). Lives in apps/api
 * because @grafista/model-router has no vitest infrastructure of its own (no
 * test script — see packages/model-router/package.json) and this suite is
 * where the fake provider's consumers live.
 *
 * The load-bearing assertions parse each canned payload against the REAL zod
 * schema the consuming service validates with, mirroring exactly how that
 * service prepares the payload first (e.g. design-dna-analysis.ts attaches
 * server-controlled fields to style_analysis output before validating).
 */

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function demoRequest(taskType: AITaskType): AIRequest {
  return {
    taskType,
    systemPrompt: 'system prompt',
    userPrompt: 'user prompt',
    outputFormat: 'json',
  };
}

const ORIGINAL_AI_DEFAULT_PROVIDER = process.env.AI_DEFAULT_PROVIDER;

afterEach(() => {
  // Never leak the demo switch into other test files in this worker — the suite
  // runs with AI_DEFAULT_PROVIDER=openai (see vitest.config.ts).
  if (ORIGINAL_AI_DEFAULT_PROVIDER === undefined) {
    delete process.env.AI_DEFAULT_PROVIDER;
  } else {
    process.env.AI_DEFAULT_PROVIDER = ORIGINAL_AI_DEFAULT_PROVIDER;
  }
});

describe('FakeAIAdapter.isAvailable', () => {
  it('is false when AI_DEFAULT_PROVIDER is unset', () => {
    delete process.env.AI_DEFAULT_PROVIDER;
    expect(new FakeAIAdapter().isAvailable()).toBe(false);
  });

  it('is false under the production providers (openai/claude)', () => {
    const adapter = new FakeAIAdapter();
    process.env.AI_DEFAULT_PROVIDER = 'openai';
    expect(adapter.isAvailable()).toBe(false);
    process.env.AI_DEFAULT_PROVIDER = 'claude';
    expect(adapter.isAvailable()).toBe(false);
  });

  it('is true only when AI_DEFAULT_PROVIDER=fake, read at call time (not construction time)', () => {
    process.env.AI_DEFAULT_PROVIDER = 'openai';
    const adapter = new FakeAIAdapter(); // constructed while disabled
    expect(adapter.isAvailable()).toBe(false);
    process.env.AI_DEFAULT_PROVIDER = 'fake';
    expect(adapter.isAvailable()).toBe(true);
  });
});

describe('FakeAIAdapter.complete when disabled', () => {
  it('resolves to a structured failure (never throws), like the real adapters', async () => {
    process.env.AI_DEFAULT_PROVIDER = 'openai';
    const response = await new FakeAIAdapter().complete(demoRequest('content_ideation'));
    expect(response.success).toBe(false);
    expect(response.provider).toBe('fake');
    expect(response.content).toBe('');
    expect(response.error).toContain('AI_DEFAULT_PROVIDER=fake');
  });
});

describe('FakeAIAdapter canned responses (enabled)', () => {
  beforeEach(() => {
    process.env.AI_DEFAULT_PROVIDER = 'fake';
  });

  async function completeOk(taskType: AITaskType) {
    const response = await new FakeAIAdapter().complete(demoRequest(taskType));
    expect(response.success).toBe(true);
    expect(response.provider).toBe('fake');
    expect(response.model).toBeTruthy();
    expect(response.usage.totalTokens).toBeGreaterThan(0);
    return response;
  }

  it('style_analysis parses against StyleAnalysisSchema once server fields are attached', async () => {
    const response = await completeOk('style_analysis');
    // design-dna-analysis.ts:137-143 — the service attaches these server-controlled
    // fields to the model payload before validating; mirror that exactly.
    const candidate = {
      ...JSON.parse(response.content),
      id: 'c0ffee00-0000-4000-8000-000000000001',
      designReferenceId: 'c0ffee00-0000-4000-8000-000000000002',
      analyzedAt: '2026-01-01T00:00:00.000Z',
    };
    const parsed = StyleAnalysisSchema.parse(candidate);
    expect(parsed.confidence).toBeGreaterThan(0);
  });

  it('design_dna_synthesis parses against DesignDNAContentSchema', async () => {
    const response = await completeOk('design_dna_synthesis');
    const parsed = DesignDNAContentSchema.parse(JSON.parse(response.content));
    expect(parsed.brandPersonality.length).toBeGreaterThan(0);
  });

  it('content_ideation returns the lenient array shape content-ideation.ts consumes', async () => {
    const response = await completeOk('content_ideation');
    const ideas = JSON.parse(response.content) as unknown;
    expect(Array.isArray(ideas)).toBe(true);
    const list = ideas as Array<Record<string, unknown>>;
    expect(list.length).toBeGreaterThanOrEqual(1);
    for (const idea of list) {
      expect(typeof idea.title).toBe('string');
      expect(typeof idea.description).toBe('string');
      expect(typeof idea.format).toBe('string');
      expect(Array.isArray(idea.hashtags)).toBe(true);
    }
  });

  it('layout_generation returns 2-3 alternatives, each parsing against LayoutPlanContentSchema', async () => {
    const response = await completeOk('layout_generation');
    const alternatives = JSON.parse(response.content) as unknown[];
    expect(Array.isArray(alternatives)).toBe(true);
    expect(alternatives.length).toBeGreaterThanOrEqual(2);
    expect(alternatives.length).toBeLessThanOrEqual(3);
    for (const alternative of alternatives) {
      const parsed = LayoutPlanContentSchema.parse(alternative);
      expect(parsed.canvas.width).toBe(1080);
    }
  });

  it('creative_qa parses against CreativeQAReportContentSchema with a PASSING verdict', async () => {
    const response = await completeOk('creative_qa');
    const parsed = CreativeQAReportContentSchema.parse(JSON.parse(response.content));
    // Must clear creative-qa.ts's gate without human override:
    // passed = overallScore >= DEFAULT_PASS_THRESHOLD (75) and
    // canProceedToProduction additionally needs zero high-priority fixes.
    expect(parsed.overallScore).toBeGreaterThanOrEqual(75);
    expect(parsed.overallStatus).toBe('passed');
    expect(parsed.highPriorityFixes).toEqual([]);
  });

  it('image_generation parses against VisualGenerationPayloadSchema and decodes to real PNG bytes', async () => {
    const response = await completeOk('image_generation');
    const parsed = VisualGenerationPayloadSchema.parse(JSON.parse(response.content));
    expect(parsed.images.length).toBeGreaterThanOrEqual(1);
    for (const image of parsed.images) {
      expect(image.imageBase64).toBeTruthy();
      const bytes = Buffer.from(image.imageBase64!, 'base64');
      expect(bytes.length).toBeGreaterThan(PNG_MAGIC.length);
      expect(bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)).toBe(true);
    }
  });

  it('is deterministic: repeated calls return byte-identical content for every canned task', async () => {
    const taskTypes: AITaskType[] = [
      'style_analysis',
      'design_dna_synthesis',
      'content_ideation',
      'layout_generation',
      'creative_qa',
      'image_generation',
    ];
    for (const taskType of taskTypes) {
      const first = await completeOk(taskType);
      const second = await completeOk(taskType);
      expect(second.content).toBe(first.content);
      expect(second.latencyMs).toBe(first.latencyMs);
      expect(second.usage).toEqual(first.usage);
    }
  });

  it('returns a structured failure for a task type with no canned response', async () => {
    const response = await new FakeAIAdapter().complete(demoRequest('video_generation'));
    expect(response.success).toBe(false);
    expect(response.error).toContain('no canned response');
    expect(response.error).toContain('video_generation');
  });
});
