import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { store } from '../data/store.js';
import { ModelRouter } from '@grafista/model-router';
import { createPromptBuilder, contentIdeationTemplate } from '@grafista/prompt-engine';
import { GenerateContentRequestSchema } from '@grafista/schemas';
import { env } from '../config/env.js';

export const contentIdeasRouter: Router = Router();

const modelRouter = new ModelRouter();
const BodySchema = GenerateContentRequestSchema.omit({ clientId: true });

// GET /api/clients/:clientId/content-ideas
contentIdeasRouter.get('/:clientId/content-ideas', (req: Request, res: Response) => {
  const ideas = Array.from(store.contentIdeas.values()).filter((i) => i.clientId === req.params.clientId);
  const status = req.query.status as string | undefined;
  const filtered = status ? ideas.filter((i) => i.status === status) : ideas;
  res.json({ data: filtered, total: filtered.length });
});

// POST /api/clients/:clientId/content-ideas — generate ideas via a real AI provider call
contentIdeasRouter.post('/:clientId/content-ideas', async (req: Request, res: Response) => {
  const client = store.clients.get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const parsedBody = BodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: 'Invalid request body', issues: parsedBody.error.issues });
  }
  const { platform, format, topic, optionCount, campaignName, mood, additionalNotes } = parsedBody.data;

  const designDNA = Array.from(store.designDNA.values()).find((d) => d.clientId === client.id);
  const previousApproved = Array.from(store.contentIdeas.values())
    .filter((i) => i.clientId === client.id && i.status === 'approved')
    .map((i) => `- ${i.title}: ${i.description}`)
    .join('\n');

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
    return res.status(502).json({
      error: 'AI provider error',
      provider: aiResponse.provider,
      message: aiResponse.error ?? 'Unknown provider error',
    });
  }

  let rawIdeas: Array<Record<string, unknown>>;
  try {
    rawIdeas = parseIdeasFromModelOutput(aiResponse.content);
  } catch (err) {
    return res.status(502).json({
      error: 'AI response parsing error',
      provider: aiResponse.provider,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const now = new Date().toISOString();
  const ideas = rawIdeas.slice(0, optionCount).map((raw, i) => {
    const idea = {
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
      createdAt: now,
      updatedAt: now,
    };
    store.contentIdeas.set(idea.id, idea);
    return idea;
  });

  res.status(201).json({ data: ideas, total: ideas.length, provider: aiResponse.provider, model: aiResponse.model });
});

/** Parses the model's JSON output into an array of raw idea objects, tolerating markdown code fences. */
function parseIdeasFromModelOutput(content: string): Array<Record<string, unknown>> {
  const cleaned = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(cleaned);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.ideas)) return parsed.ideas;
  if (parsed && Array.isArray(parsed.options)) return parsed.options;
  throw new Error('Model did not return a JSON array of content ideas');
}
