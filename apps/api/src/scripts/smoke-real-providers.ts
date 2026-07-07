/**
 * Grafista AI Studio — Real Provider Smoke Check (Phase 2 Step 12)
 *
 * Small, controlled connectivity checks against the REAL providers the MVP
 * demo chain depends on. This is a readiness probe, not a test suite — the
 * behavioral coverage lives in vitest (fake providers). Each section prints
 * PASS / SKIP / FAIL and never logs secrets, env values, or full provider
 * responses.
 *
 * Usage (from apps/api, with .env loaded into the shell):
 *   pnpm run smoke:providers                 # all sections
 *   pnpm run smoke:providers -- storage      # one section
 *   pnpm run smoke:providers -- openai kie   # a subset
 *
 * Sections: storage, openai, kie, render
 *
 * Cost note: `openai` sends one tiny chat completion (a few tokens);
 * `kie` generates exactly ONE image with the default model. Everything else
 * is free/local.
 */

import fs from 'node:fs';
import path from 'node:path';
import { OpenAIAdapter, KieAIAdapter, classifyProviderError, type AIResponse } from '@grafista/model-router';
import { LocalStorageProvider, LOCAL_UPLOAD_DIR } from '../storage/local-provider.js';
import { getStorageProvider } from '../storage/factory.js';
import type { StorageProvider } from '../storage/types.js';
import { getRendererAdapter, resolveActiveRendererProviderName } from '../render/adapters/factory.js';

type Outcome = 'PASS' | 'SKIP' | 'FAIL';
const results: Array<{ section: string; outcome: Outcome; detail: string }> = [];

function record(section: string, outcome: Outcome, detail: string): void {
  results.push({ section, outcome, detail });
  console.log(`[smoke] ${section.padEnd(8)} ${outcome.padEnd(5)} ${detail}`);
}

/**
 * Phase 3 Step 3 — short classification report for provider failures: kind +
 * retryable + httpStatus (when known) so a failing smoke immediately tells you
 * whether it's config (no retry will help) or transient (try again). Only the
 * adapter's own error message is echoed — never env values or secrets.
 */
function describeProviderFailure(response: AIResponse): string {
  const classification = classifyProviderError({ error: response.error, httpStatus: response.httpStatus });
  const statusNote = classification.httpStatus !== undefined ? ` httpStatus=${classification.httpStatus}` : '';
  return `provider error [kind=${classification.kind} retryable=${classification.retryable}${statusNote}]: ${response.error ?? 'unknown'}`;
}

async function smokeStorage(): Promise<void> {
  // Tests the ACTUALLY-configured provider (STORAGE_PROVIDER via the app's own
  // factory), not a hardcoded local one — so on staging/production where
  // STORAGE_PROVIDER=s3, this is a REAL S3/R2 put+get+delete roundtrip that
  // exercises live credentials/bucket connectivity (Production Step 17: the
  // previous version hardcoded LocalStorageProvider and never touched S3/R2,
  // which meant the "storage" gate was never actually verified against a
  // managed bucket). Uses a unique, throwaway key under a `_smoke/` prefix and
  // always deletes it; never logs secrets or env values.
  const key = `_smoke/storage-roundtrip-${Date.now()}.txt`;
  const body = Buffer.from('grafista storage smoke roundtrip');
  let provider: StorageProvider | undefined;
  let putOk = false;
  try {
    // Inside the try so a config failure (e.g. STORAGE_PROVIDER=s3 with a
    // missing S3_* env var) surfaces as a clear FAIL, not an uncaught throw.
    provider = getStorageProvider();
    const ref = await provider.putObject({ key, body, contentType: 'text/plain' });
    putOk = true;
    const readBack = await provider.getObjectBuffer({ key });
    if (!readBack.equals(body)) {
      record('storage', 'FAIL', `${provider.name} roundtrip read bytes did not match written bytes (bucket=${ref.bucket})`);
      return;
    }
    await provider.deleteObject({ key });
    record('storage', 'PASS', `${provider.name} put/get/delete roundtrip ok (bucket=${ref.bucket})`);
  } catch (err) {
    // Best-effort cleanup if we wrote but failed afterward — never mask the
    // original error, and never leave the probe object behind.
    if (putOk && provider) {
      await provider.deleteObject({ key }).catch(() => undefined);
    }
    record('storage', 'FAIL', `${provider?.name ?? 'storage'} roundtrip threw: ${(err as Error).message}`);
  }
}

async function smokeOpenAI(): Promise<void> {
  const adapter = new OpenAIAdapter();
  if (!adapter.isAvailable()) {
    record('openai', 'SKIP', 'OPENAI_API_KEY missing');
    return;
  }
  const response = await adapter.complete({
    taskType: 'creative_qa',
    systemPrompt: 'You are a connectivity check. Answer with a single word.',
    userPrompt: 'Reply with exactly: OK',
    outputFormat: 'text',
    maxTokens: 8,
    temperature: 0,
  });
  if (!response.success) {
    record('openai', 'FAIL', describeProviderFailure(response));
    return;
  }
  record(
    'openai',
    'PASS',
    `model=${response.model} latencyMs=${response.latencyMs} tokens=${response.usage.totalTokens} contentChars=${response.content.length}`
  );
}

async function smokeKie(): Promise<void> {
  const adapter = new KieAIAdapter();
  if (!adapter.isAvailable()) {
    record('kie', 'SKIP', 'KIE_AI_API_KEY and/or KIE_AI_BASE_URL missing');
    return;
  }
  const response = await adapter.complete({
    taskType: 'image_generation',
    systemPrompt: '',
    userPrompt: 'A plain solid light blue square, flat color, no details. Connectivity test image.',
    outputFormat: 'json',
    // Raw pixel ratio on purpose: the exact input that broke the manual demo pass
    // (blocker B2). The adapter must normalize this to '1:1' before hitting Kie —
    // this smoke proves the Step 13 hotfix A normalization live.
    metadata: { aspectRatio: '1080:1080' },
  });
  if (!response.success) {
    record('kie', 'FAIL', describeProviderFailure(response));
    return;
  }

  // Success content contract: { images: [{ imageUrl, mimeType? }] } — same
  // payload the visual-generation service validates before touching storage.
  let imageUrl: string | undefined;
  try {
    const parsed = JSON.parse(response.content) as { images?: Array<{ imageUrl?: string }> };
    imageUrl = parsed.images?.[0]?.imageUrl;
  } catch {
    record('kie', 'FAIL', 'success response content was not valid JSON');
    return;
  }
  if (!imageUrl) {
    record('kie', 'FAIL', 'success response had no images[0].imageUrl');
    return;
  }

  // Pull the generated bytes and push them through the real storage provider —
  // the same store-after-generate step the demo chain performs.
  const download = await fetch(imageUrl);
  if (!download.ok) {
    record('kie', 'FAIL', `generated image URL not downloadable (HTTP ${download.status})`);
    return;
  }
  const bytes = Buffer.from(await download.arrayBuffer());
  const storage = new LocalStorageProvider();
  const key = 'smoke/step12-kie-image.png';
  await storage.putObject({ key, body: bytes, contentType: 'image/png' });
  const stored = await storage.getObjectBuffer({ key });
  await fs.promises.unlink(path.join(LOCAL_UPLOAD_DIR, key)).catch(() => undefined);
  record(
    'kie',
    'PASS',
    `model=${response.model} latencyMs=${response.latencyMs} imageBytes=${bytes.length} storedBytes=${stored.length}`
  );
}

async function smokeRender(): Promise<void> {
  const providerName = resolveActiveRendererProviderName();
  try {
    const adapter = getRendererAdapter();
    const output = await adapter.render({
      html: '<!doctype html><html><body style="margin:0;width:320px;height:200px;background:#1e90ff"><h1 style="color:#fff;font-family:sans-serif">Smoke</h1></body></html>',
      width: 320,
      height: 200,
      format: 'png',
    });
    if (!output.buffer || output.buffer.length === 0) {
      record('render', 'FAIL', `${providerName} render returned an empty buffer`);
      return;
    }
    record('render', 'PASS', `provider=${providerName} mime=${output.mimeType} bytes=${output.buffer.length}`);
  } catch (err) {
    const message = (err as Error).message;
    const hint = /playwright|chromium|browser/i.test(message)
      ? ' — if Chromium is missing run: npx playwright install chromium'
      : '';
    record('render', 'FAIL', `${providerName} render threw: ${message}${hint}`);
  }
}

const SECTIONS: Record<string, () => Promise<void>> = {
  storage: smokeStorage,
  openai: smokeOpenAI,
  kie: smokeKie,
  render: smokeRender,
};

async function main(): Promise<void> {
  const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const unknown = requested.filter((name) => !SECTIONS[name]);
  if (unknown.length > 0) {
    console.error(`[smoke] unknown section(s): ${unknown.join(', ')} — valid: ${Object.keys(SECTIONS).join(', ')}`);
    process.exit(2);
  }
  const names = requested.length > 0 ? requested : Object.keys(SECTIONS);
  for (const name of names) {
    await SECTIONS[name]();
  }
  const failed = results.filter((r) => r.outcome === 'FAIL');
  console.log(
    `[smoke] done — ${results.filter((r) => r.outcome === 'PASS').length} pass, ` +
      `${results.filter((r) => r.outcome === 'SKIP').length} skip, ${failed.length} fail`
  );
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[smoke] FATAL', (err as Error).message);
  process.exit(1);
});
