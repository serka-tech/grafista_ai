/**
 * Grafista AI Studio — Brand Palette Extraction Service
 *
 * Reads the distinct swatch colors out of an uploaded color_palette ("kartela")
 * image so the brand's real palette (with roles) can reach the visual pipeline.
 * Before this, an uploaded palette image was stored but never analyzed, and the
 * design collapsed to a single flat color.
 *
 * Best-effort by design: any failure (no bytes, non-image, provider/JSON/schema
 * error) returns an empty palette. The caller keeps the saved asset and the user
 * fills the palette in manually on the dashboard — extraction never throws into
 * the upload path. Mirrors the vision-call pattern in design-dna-analysis.ts.
 */

import { ModelRouter } from '@grafista/model-router';
import { createPromptBuilder, paletteExtractionTemplate } from '@grafista/prompt-engine';
import { BrandPaletteSchema, type BrandPalette } from '@grafista/schemas';
import { env } from '../config/env.js';
import { getObjectBuffer } from '../storage/file-service.js';
import { callAiForJson, type ValidateResult } from './ai-call-helper.js';
import type { BrandAsset } from '../db/repositories/brand-assets.js';

const modelRouter = new ModelRouter();

/** Accepts a bare array or a {colors|palette:[...]} wrapper, then zod-validates. */
function validatePalette(raw: unknown): ValidateResult<BrandPalette> {
  const arr = Array.isArray(raw)
    ? raw
    : (raw as { colors?: unknown; palette?: unknown } | null)?.colors ??
      (raw as { colors?: unknown; palette?: unknown } | null)?.palette ??
      [];
  const parsed = BrandPaletteSchema.safeParse(arr);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: parsed.error.message };
}

export async function extractPaletteFromAsset(asset: BrandAsset, clientName: string): Promise<BrandPalette> {
  if (!asset.storageKey || !asset.storageProvider || !asset.storageBucket) return [];
  if (!(asset.mimeType ?? '').startsWith('image/')) return [];

  try {
    const buffer = await getObjectBuffer({
      storageProvider: asset.storageProvider,
      storageKey: asset.storageKey,
      storageBucket: asset.storageBucket,
    });
    const dataUri = `data:${asset.mimeType};base64,${buffer.toString('base64')}`;

    const prompt = createPromptBuilder(paletteExtractionTemplate).setVariables({ clientName }).build();

    const outcome = await callAiForJson<BrandPalette>({
      router: modelRouter,
      request: {
        // Reuse the vision-capable route already wired for reference analysis —
        // no model-router change; provider follows the same env as Design DNA.
        taskType: 'style_analysis',
        provider: env.AI_DEFAULT_PROVIDER,
        images: [dataUri],
        systemPrompt: prompt.system,
        userPrompt: prompt.user,
        outputFormat: 'json',
        maxTokens: prompt.metadata.maxTokens,
        temperature: prompt.metadata.temperature,
      },
      context: `palette_extraction, asset ${asset.id}`,
      logPrefix: 'palette-extraction',
      validate: validatePalette,
    });

    if (!outcome.ok) {
      console.warn(`[palette-extraction] extraction failed for asset ${asset.id} — stage=${outcome.stage}`);
      return [];
    }
    console.log(`[palette-extraction] asset ${asset.id} — extracted ${outcome.data.length} colors`);
    return outcome.data;
  } catch (err) {
    console.warn(`[palette-extraction] error for asset ${asset.id}:`, err instanceof Error ? err.message : err);
    return [];
  }
}
