/**
 * Grafista AI Studio — Content Ideation Service (Phase 2 Step 6)
 *
 * Extracted 1:1 from the routes/content-ideas.ts POST handler so the
 * workflow engine can generate ideas without going through HTTP — the route
 * now delegates here and keeps its exact response contract (including the
 * bespoke 502 bodies, reconstructed from the aiErrorKind/aiProvider fields
 * attached to thrown errors). Behavior is deliberately unchanged: same
 * prompt building, same wrapper tolerance, same optionCount cap, ideas
 * persisted as 'pending_approval'.
 */

import { v4 as uuid } from 'uuid';
import { ModelRouter } from '@grafista/model-router';
import { createPromptBuilder, contentIdeationTemplate } from '@grafista/prompt-engine';
import { GenerateContentRequestSchema } from '@grafista/schemas';
import { z } from 'zod';
import { store } from '../data/store.js';
import { env } from '../config/env.js';
import type { ContentIdea } from '../db/repositories/content-ideas.js';

const modelRouter = new ModelRouter();

/** Same request shape the route validates (GenerateContentRequestSchema minus clientId). */
export const ContentIdeationRequestSchema = GenerateContentRequestSchema.omit({ clientId: true });
export type ContentIdeationRequest = z.infer<typeof ContentIdeationRequestSchema>;

export interface ContentIdeationResult {
  ideas: ContentIdea[];
  provider: string;
  model: string;
}

export type AiErrorKind = 'provider' | 'parsing';

/** 502 with enough context for the route to rebuild its exact legacy response body. */
function aiError(kind: AiErrorKind, provider: string, message: string): Error & { status: number; aiErrorKind: AiErrorKind; aiProvider: string } {
  return Object.assign(new Error(message), { status: 502, aiErrorKind: kind, aiProvider: provider });
}

/** Parses the model's JSON output into an array of raw idea objects, tolerating markdown code fences. */
function parseIdeasFromModelOutput(content: string): Array<Record<string, unknown>> {
  const cleaned = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(cleaned);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.ideas)) return parsed.ideas;
  if (parsed && Array.isArray(parsed.options)) return parsed.options;
  throw new Error('Model did not return a JSON array of content ideas');
}

/** Generates content ideas via one real AI call and persists them as 'pending_approval'. */
export async function runContentIdeation(
  clientId: string,
  requestedBy: string,
  request: ContentIdeationRequest
): Promise<ContentIdeationResult> {
  console.log(`[content-ideation] run requested — clientId=${clientId} requestedBy=${requestedBy}`);

  const client = await store.clients.getById(clientId);
  if (!client) {
    throw Object.assign(new Error('Client not found'), { status: 404 });
  }

  const { platform, format, topic, optionCount, campaignName, mood, additionalNotes } = request;

  const designDNA = await store.designDna.getApprovedByClientId(client.id);
  const approvedIdeas = await store.contentIdeas.listApprovedByClient(client.id);
  const previousApproved = approvedIdeas.map((i) => `- ${i.title}: ${i.description}`).join('\n');

  const prompt = createPromptBuilder(contentIdeationTemplate)
    .setVariables({
      clientName: client.name,
      platform,
      optionCount: String(optionCount),
      format: format ?? 'single_image',
      topic: topic ?? '',
      mood: mood ?? '',
      additionalNotes: additionalNotes ?? '',
      designDNA: designDNA ? JSON.stringify(designDNA, null, 2) : 'No Design DNA generated yet.',
      brandProfile: `Industry: ${client.industry ?? 'unknown'}. Notes: ${client.notes ?? 'none'}.`,
      previousContent: previousApproved || 'None yet.',
      revisionMemory: 'None yet.',
    })
    .build();

  const aiResponse = await modelRouter.complete({
    taskType: 'content_ideation',
    provider: env.AI_DEFAULT_PROVIDER,
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    outputFormat: 'json',
    maxTokens: prompt.metadata.maxTokens,
    temperature: prompt.metadata.temperature,
  });

  if (!aiResponse.success) {
    throw aiError('provider', aiResponse.provider, aiResponse.error ?? 'Unknown provider error');
  }

  let rawIdeas: Array<Record<string, unknown>>;
  try {
    rawIdeas = parseIdeasFromModelOutput(aiResponse.content);
  } catch (err) {
    throw aiError('parsing', aiResponse.provider, err instanceof Error ? err.message : String(err));
  }

  const ideas: ContentIdea[] = [];
  for (const [i, raw] of rawIdeas.slice(0, optionCount).entries()) {
    const idea = await store.contentIdeas.create({
      id: uuid(),
      clientId: client.id,
      campaignName,
      title: typeof raw.title === 'string' ? raw.title : `${topic || 'Content'} — Option ${i + 1}`,
      description: typeof raw.description === 'string' ? raw.description : '',
      platform,
      format: (typeof raw.format === 'string' ? raw.format : format) ?? 'single_image',
      hook: typeof raw.hook === 'string' ? raw.hook : undefined,
      caption: typeof raw.caption === 'string' ? raw.caption : undefined,
      hashtags: Array.isArray(raw.hashtags) ? raw.hashtags.filter((h): h is string => typeof h === 'string') : [],
      callToAction: typeof raw.callToAction === 'string' ? raw.callToAction : undefined,
      toneOfVoice: typeof raw.toneOfVoice === 'string' ? raw.toneOfVoice : undefined,
      visualDirection: typeof raw.visualDirection === 'string' ? raw.visualDirection : undefined,
      status: 'pending_approval',
      generatedBy: 'ai',
    });
    ideas.push(idea);
  }

  return { ideas, provider: aiResponse.provider, model: aiResponse.model };
}
