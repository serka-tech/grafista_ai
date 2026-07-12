/**
 * Grafista AI Studio — Curated Real-Estate Listing Template (go-live M6)
 *
 * Produces a deterministic LayoutPlanContent for a property-listing card: a
 * full-width HERO IMAGE SLOT (the customer's uploaded photo is composited here
 * by the existing render pipeline — planVisualComposition picks the single image
 * slot as the primary), a solid info panel below it, and text layers for price,
 * title, address and agency name. No AI call — the slots are fixed so a
 * real-estate customer reliably gets a proper listing card every time.
 *
 * MVP: agency name is TEXT (agency LOGO as an image is a documented fast-follow —
 * it needs multi-image compositing; see docs/direct-photo-listing-plan.md).
 *
 * The canvas matches a real render preset (instagram_post 1080×1080 /
 * instagram_story 1080×1920) so the render step's preset dimensions line up with
 * these layer coordinates (render-engine.ts renders against the PRESET canvas).
 */

import type { Layer, LayoutPlanContent } from '@grafista/schemas';

export type ListingPreset = 'instagram_post' | 'instagram_story';

export interface ListingFields {
  title: string;
  price: string;
  address: string;
  agencyName: string;
}

/** A layer box in canvas-relative top-left coordinates (rotation/anchor are filled by layer()). */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const CANVAS: Record<ListingPreset, { width: number; height: number }> = {
  instagram_post: { width: 1080, height: 1080 },
  instagram_story: { width: 1080, height: 1920 },
};

const COLORS = {
  panel: '#0f172a', // slate-900
  price: '#ffffff',
  title: '#e2e8f0', // slate-200
  address: '#94a3b8', // slate-400
  agency: '#38bdf8', // sky-400 accent
};

/** Builds a Layer, filling every non-varying field (position anchor/rotation, visibility, opacity). */
function layer(input: {
  id: string;
  name: string;
  type: Layer['type'];
  box: Box;
  zIndex: number;
  shapeProperties?: Layer['shapeProperties'];
  imageProperties?: Layer['imageProperties'];
  textProperties?: Layer['textProperties'];
}): Layer {
  return {
    id: input.id,
    name: input.name,
    type: input.type,
    position: { ...input.box, rotation: 0, anchor: 'top-left' },
    zIndex: input.zIndex,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    ...(input.shapeProperties ? { shapeProperties: input.shapeProperties } : {}),
    ...(input.imageProperties ? { imageProperties: input.imageProperties } : {}),
    ...(input.textProperties ? { textProperties: input.textProperties } : {}),
  };
}

function textLayer(
  id: string,
  name: string,
  content: string,
  box: Box,
  style: { fontSize: number; fontFamily: string; fontWeight: string; color: string },
  zIndex: number
): Layer {
  return layer({
    id,
    name,
    type: 'text',
    box,
    zIndex,
    textProperties: {
      content,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      color: style.color,
      alignment: 'left',
    },
  });
}

/**
 * Builds a real-estate listing LayoutPlanContent for the given preset, with the
 * provided listing text baked into the text layers and one empty (injectable)
 * hero image slot for the uploaded photo.
 */
export function buildRealEstateListingLayout(preset: ListingPreset, fields: ListingFields): LayoutPlanContent {
  const { width: W, height: H } = CANVAS[preset];
  const heroH = Math.round(H * 0.62);
  const M = 60; // side margin
  const textW = W - 2 * M;

  // Text stack inside the info panel (both presets are 1080 wide → W-based sizes are consistent).
  const priceSize = 76;
  const titleSize = 42;
  const addressSize = 34;
  const agencySize = 30;

  let y = heroH + 44;
  const priceBox: Box = { x: M, y, width: textW, height: priceSize + 10 };
  y += priceSize + 24;
  const titleBox: Box = { x: M, y, width: textW, height: titleSize + 8 };
  y += titleSize + 20;
  const addressBox: Box = { x: M, y, width: textW, height: addressSize + 8 };
  y += addressSize + 26;
  const agencyBox: Box = { x: M, y, width: textW, height: agencySize + 8 };

  const layers: Layer[] = [
    layer({
      id: 'bg',
      name: 'Background',
      type: 'background',
      box: { x: 0, y: 0, width: W, height: H },
      zIndex: 0,
      shapeProperties: { shapeType: 'rectangle', fillColor: COLORS.panel, strokeWidth: 0, opacity: 1, borderRadius: 0 },
    }),
    // HERO IMAGE SLOT — the uploaded photo is composited here (sourceType 'placeholder',
    // no sourceUrl → the render pipeline's planVisualComposition injects the photo).
    layer({
      id: 'hero-photo',
      name: 'Property photo',
      type: 'image',
      box: { x: 0, y: 0, width: W, height: heroH },
      zIndex: 5,
      imageProperties: { sourceType: 'placeholder', fit: 'cover', opacity: 1, borderRadius: 0 },
    }),
    // Solid info panel below the photo (text legibility).
    layer({
      id: 'info-panel',
      name: 'Info panel',
      type: 'shape',
      box: { x: 0, y: heroH, width: W, height: H - heroH },
      zIndex: 10,
      shapeProperties: { shapeType: 'rectangle', fillColor: COLORS.panel, strokeWidth: 0, opacity: 1, borderRadius: 0 },
    }),
    textLayer('price', 'Price', fields.price, priceBox, { fontSize: priceSize, fontFamily: 'Montserrat', fontWeight: '700', color: COLORS.price }, 20),
    textLayer('title', 'Title', fields.title, titleBox, { fontSize: titleSize, fontFamily: 'Montserrat', fontWeight: '600', color: COLORS.title }, 21),
    textLayer('address', 'Address', fields.address, addressBox, { fontSize: addressSize, fontFamily: 'Inter', fontWeight: '400', color: COLORS.address }, 22),
    textLayer('agency', 'Agency', fields.agencyName, agencyBox, { fontSize: agencySize, fontFamily: 'Inter', fontWeight: '600', color: COLORS.agency }, 23),
  ];

  const content: LayoutPlanContent = {
    format: preset,
    canvas: { width: W, height: H, backgroundColor: COLORS.panel, dpi: 72 },
    layers,
    safeZones: [],
    colorUsageNotes: 'Dark info panel with white price, light title, muted address, accent agency line.',
    typographyNotes: 'Montserrat for price/title, Inter for address/agency.',
    exportSettings: { formats: ['png'], quality: 90, scaleFactor: 1 },
    referenceDesignIds: [],
    designDnaRulesUsed: [],
    designerNotes: 'Curated real-estate listing template (M6). Hero slot receives the uploaded property photo.',
  };

  return content;
}
