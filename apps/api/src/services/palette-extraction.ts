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

export type PaletteExtractionOutcome =
  | { palette: BrandPalette; status: 'ok' }
  | { palette: BrandPalette; status: 'empty' }
  | { palette: BrandPalette; status: 'failed'; stage: string };

const RASTER_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export async function extractPaletteFromAsset(
  asset: BrandAsset,
  clientName: string
): Promise<PaletteExtractionOutcome> {
  if (!asset.storageKey || !asset.storageProvider || !asset.storageBucket) return { palette: [], status: 'empty' };
  if (!asset.mimeType || !RASTER_MIME_TYPES.has(asset.mimeType)) return { palette: [], status: 'empty' };

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
        // style_analysis requires vision in the router. Do not supply an explicit
        // provider: overrides bypass capability filtering.
        taskType: 'style_analysis',
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
      return { palette: [], status: 'failed', stage: outcome.stage };
    }
    console.log(`[palette-extraction] asset ${asset.id} — extracted ${outcome.data.length} colors`);
    return outcome.data.length > 0
      ? { palette: outcome.data, status: 'ok' }
      : { palette: [], status: 'empty' };
  } catch (err) {
    console.warn(`[palette-extraction] error for asset ${asset.id}:`, err instanceof Error ? err.message : err);
    return { palette: [], status: 'failed', stage: 'storage' };
  }
}
