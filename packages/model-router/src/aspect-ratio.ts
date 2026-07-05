/**
 * Aspect ratio normalization for image-generation providers (Phase 2 Step 13 hotfix A).
 *
 * WHY: layout plans carry pixel canvases (1080x1080, 1080x1920, ...) and the
 * visual-generation service forwarded them verbatim as "1080:1080". Kie AI's
 * jobs API validates `aspect_ratio` against a fixed list of normalized ratios
 * and rejects raw pixel pairs with HTTP 500
 * ("This aspect_ratio is not within the range of allowed options"), so every
 * real image generation for a standard preset failed (manual demo pass,
 * blocker B2). This module reduces any width/height pair or "W:H" string to
 * the canonical ratio before it reaches the provider.
 *
 * SUPPORTED LIST: Kie's jobs API is model-driven and each model has its own
 * accepted set. The list below is the set accepted by the Gemini-image family
 * (`nano-banana-2` — the model verified working in the Step 12 smoke and the
 * Step 13 manual pass): 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9.
 * A gcd-exact ratio outside this list (e.g. 1200:628 -> 300:157) is SNAPPED to
 * the nearest supported ratio by minimal |ln(target) - ln(candidate)| distance
 * (log distance treats "twice as wide" and "twice as tall" symmetrically);
 * the snap is reported via `snapped: true` so callers can log a warning.
 *
 * FAILURE CONTRACT: normalizeAspectRatio NEVER throws. Unusable input
 * (0, negative, NaN, unparseable string) returns a structured
 * `{ ok: false, reason }` result — callers degrade gracefully (the Kie adapter
 * omits `aspect_ratio` and lets the model use its default) instead of turning
 * a bad ratio into a crashed request.
 */

/** Ratios accepted by Kie's Gemini-image models (see module doc for why this list). */
export const KIE_SUPPORTED_ASPECT_RATIOS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
] as const;

export type KieSupportedAspectRatio = (typeof KIE_SUPPORTED_ASPECT_RATIOS)[number];

export interface AspectRatioNormalized {
  ok: true;
  /** Provider-safe ratio, always a member of KIE_SUPPORTED_ASPECT_RATIOS. */
  ratio: KieSupportedAspectRatio;
  /** gcd-reduced exact ratio (e.g. "300:157") — differs from `ratio` when snapped. */
  exactRatio: string;
  /** True when exactRatio was not directly supported and was rounded to the nearest supported ratio. */
  snapped: boolean;
  /** The input as received, for traceability logs. */
  original: string;
}

export interface AspectRatioInvalid {
  ok: false;
  original: string;
  reason: string;
}

export type AspectRatioResult = AspectRatioNormalized | AspectRatioInvalid;

function gcd(a: number, b: number): number {
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

/** Maps each supported ratio's gcd-reduced form to its canonical label (e.g. "7:3" -> "21:9"),
 * so exact matches are recognized even when the provider's label is not itself reduced. */
const REDUCED_TO_SUPPORTED: ReadonlyMap<string, KieSupportedAspectRatio> = new Map(
  KIE_SUPPORTED_ASPECT_RATIOS.map((ratio) => {
    const [w, h] = ratio.split(':').map(Number);
    const divisor = gcd(w, h);
    return [`${w / divisor}:${h / divisor}`, ratio];
  })
);

/** Accepts "1080:1080", "1080x1080" (and unicode ×) with optional whitespace/decimals. */
function parseSpec(spec: string): { width: number; height: number } | undefined {
  const match = spec.trim().match(/^(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)$/i);
  if (!match) return undefined;
  return { width: Number(match[1]), height: Number(match[2]) };
}

/**
 * Normalizes a width/height pair or a "W:H" / "WxH" string to a Kie-supported
 * aspect ratio. normalizeAspectRatio(1080, 1080) -> ratio "1:1",
 * (1080, 1920) -> "9:16", (1920, 1080) -> "16:9", ("1080:1080") -> "1:1".
 * Never throws — see module doc for the failure contract.
 */
export function normalizeAspectRatio(widthOrSpec: number | string, height?: number): AspectRatioResult {
  let width: number;
  let h: number;
  let original: string;

  if (typeof widthOrSpec === 'string') {
    original = widthOrSpec;
    const parsed = parseSpec(widthOrSpec);
    if (!parsed) {
      return { ok: false, original, reason: 'unparseable aspect ratio string (expected "width:height")' };
    }
    ({ width, height: h } = parsed);
  } else {
    width = widthOrSpec;
    h = height as number;
    original = `${widthOrSpec}:${height}`;
  }

  if (!Number.isFinite(width) || !Number.isFinite(h) || width <= 0 || h <= 0) {
    return { ok: false, original, reason: 'width and height must be finite positive numbers' };
  }

  // Tolerate fractional dimensions (e.g. scaled canvases) by rounding to pixels.
  const w = Math.round(width);
  const hh = Math.round(h);
  if (w === 0 || hh === 0) {
    return { ok: false, original, reason: 'width and height round to zero pixels' };
  }

  const divisor = gcd(w, hh);
  const exactRatio = `${w / divisor}:${hh / divisor}`;

  const exactMatch = REDUCED_TO_SUPPORTED.get(exactRatio);
  if (exactMatch) {
    return { ok: true, ratio: exactMatch, exactRatio, snapped: false, original };
  }

  // Snap to the nearest supported ratio by log distance (orientation-symmetric).
  const target = Math.log(w / hh);
  let best: KieSupportedAspectRatio = KIE_SUPPORTED_ASPECT_RATIOS[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of KIE_SUPPORTED_ASPECT_RATIOS) {
    const [cw, ch] = candidate.split(':').map(Number);
    const distance = Math.abs(target - Math.log(cw / ch));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return { ok: true, ratio: best, exactRatio, snapped: true, original };
}
