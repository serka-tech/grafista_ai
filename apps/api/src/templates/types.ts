/**
 * The contract every design template implements.
 *
 * A template is a pure function: brand kit + copy + an optional background
 * image in, a complete HTML document out. Nothing here is produced by a model.
 * The AI's only contribution is the background pixels, and even those sit
 * underneath a blur, a scrim, and every text layer — so a model that renders
 * garbled letters into its image cannot corrupt the words the viewer reads.
 *
 * This is the deliberate inverse of the old pipeline, where an LLM emitted a
 * layer tree and the renderer tried to draw whatever it got.
 */

/** Layout personality, derived from the canvas aspect ratio rather than passed in. */
export type LayoutMode = 'square' | 'portrait' | 'landscape';

export interface TemplateSize {
  width: number;
  height: number;
}

/**
 * Five roles, always present. Callers resolve these from the client's palette
 * and fall back to defaults, so a template never has to handle a missing slot.
 * Every value is a `#rrggbb` string — validated before it reaches CSS.
 */
export interface BrandPalette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
}

export interface TemplateBrand {
  /** The real logo file as a data URI. Absent means the footer carries the name instead. */
  logoDataUri?: string;
  /** Brand name, used when there is no logo and as the footer line. */
  name: string;
  palette: BrandPalette;
  headingFont: string;
  bodyFont: string;
}

export interface TemplateCopy {
  /** The one line the viewer reads first. Kept short by the plan schema. */
  headline: string;
  subline?: string;
  /** Short pill text: "Yeni", "%20 indirim", "Bugün". */
  badge?: string;
  cta?: string;
  /** Attribution line for quote cards. */
  attribution?: string;
}

export type BackgroundKind = 'ai-image' | 'brand-gradient' | 'solid';

export interface TemplateBackground {
  kind: BackgroundKind;
  /** Required when kind is 'ai-image'. */
  dataUri?: string;
  /**
   * Softens the background so any lettering the image model hallucinated stops
   * reading as text. Raised by the QA pass when edge density says otherwise.
   */
  blurPx?: number;
}

/**
 * Platform chrome overlays the canvas edges on stories: the profile row at the
 * top, the caption and action rail at the bottom. Expressed as a fraction of
 * canvas height so it scales with the size.
 */
export interface SafeArea {
  top: number;
  bottom: number;
}

export interface TemplateInput {
  size: TemplateSize;
  brand: TemplateBrand;
  copy: TemplateCopy;
  background: TemplateBackground;
  safeArea: SafeArea;
  /**
   * Added to the scrim opacity the template computes. The render pass measures
   * real contrast on the produced PNG and re-renders with this raised when the
   * text would be hard to read. Range 0 to 1; defaults to 0.
   */
  scrimBoost?: number;
  /** Carousel only: which card of how many. */
  card?: {
    index: number;
    total: number;
  };
}

/**
 * Region of the canvas occupied by text, in percentages of width and height.
 * The pixel QA pass samples exactly these rectangles to compute the contrast
 * the viewer actually experiences, instead of trusting the palette maths.
 */
export interface TextRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * The colour the text in this region is actually drawn in. A card mixes them
   * — a light headline over the photo, dark text inside an accent pill — and
   * measuring every region against one colour reports the pill as unreadable
   * when it is fine. Omitted means "use the design's primary text colour".
   */
  textColor?: string;
}

export interface TemplateOutput {
  html: string;
  /**
   * False for templates that draw their own background from brand colours.
   * Those cost no image generation call at all, which is why a plan mixes them
   * in rather than paying for a photo behind every quote.
   */
  needsBackgroundImage: boolean;
  textRects: TextRect[];
}

export type TemplateFn = (input: TemplateInput) => TemplateOutput;

export interface TemplateDefinition {
  id: string;
  label: string;
  /** Sizes this template lays out well at. */
  supports: readonly LayoutMode[];
  needsBackgroundImage: boolean;
  render: TemplateFn;
}

export function layoutModeFor(size: TemplateSize): LayoutMode {
  const ratio = size.width / size.height;
  if (ratio < 0.85) return 'portrait';
  if (ratio > 1.2) return 'landscape';
  return 'square';
}
