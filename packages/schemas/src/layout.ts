import { z } from 'zod';

// ─── Layout Plan ─────────────────────────────────────────
export const LayerTypeEnum = z.enum([
  'background',
  'image',
  'text',
  'shape',
  'logo',
  'icon',
  'overlay',
  'gradient',
  'border',
  'group',
]);
export type LayerType = z.infer<typeof LayerTypeEnum>;

export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number().default(0),
  anchor: z.enum([
    'top-left', 'top-center', 'top-right',
    'center-left', 'center', 'center-right',
    'bottom-left', 'bottom-center', 'bottom-right',
  ]).default('top-left'),
});
export type Position = z.infer<typeof PositionSchema>;

export const TextPropertiesSchema = z.object({
  content: z.string().max(2000),
  fontFamily: z.string().max(100),
  fontSize: z.number().positive(),
  fontWeight: z.string().max(50).default('regular'),
  color: z.string(),
  alignment: z.enum(['left', 'center', 'right', 'justify']).default('left'),
  lineHeight: z.number().positive().optional(),
  letterSpacing: z.number().optional(),
  textTransform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']).optional(),
  maxLines: z.number().int().positive().optional(),
});
export type TextProperties = z.infer<typeof TextPropertiesSchema>;

export const ImagePropertiesSchema = z.object({
  sourceType: z.enum(['uploaded', 'ai_generated', 'stock', 'placeholder']),
  sourceUrl: z.string().max(1000).optional(),
  aiPrompt: z.string().max(2000).optional(),
  fit: z.enum(['cover', 'contain', 'fill', 'none']).default('cover'),
  opacity: z.number().min(0).max(1).default(1),
  borderRadius: z.number().nonnegative().default(0),
  filter: z.string().max(200).optional(),
});
export type ImageProperties = z.infer<typeof ImagePropertiesSchema>;

export const ShapePropertiesSchema = z.object({
  shapeType: z.enum(['rectangle', 'circle', 'ellipse', 'rounded-rect', 'line', 'polygon']),
  fillColor: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().nonnegative().default(0),
  opacity: z.number().min(0).max(1).default(1),
  borderRadius: z.number().nonnegative().default(0),
});
export type ShapeProperties = z.infer<typeof ShapePropertiesSchema>;

export const LayerSchema = z.object({
  id: z.string(),
  name: z.string().max(100),
  type: LayerTypeEnum,
  position: PositionSchema,
  zIndex: z.number().int().nonnegative(),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  opacity: z.number().min(0).max(1).default(1),
  blendMode: z.string().max(50).default('normal'),
  textProperties: TextPropertiesSchema.optional(),
  imageProperties: ImagePropertiesSchema.optional(),
  shapeProperties: ShapePropertiesSchema.optional(),
  children: z.array(z.lazy((): z.ZodType => LayerSchema)).optional(),
});
export type Layer = z.infer<typeof LayerSchema>;

/** A grid system description — how the canvas is subdivided, not a rendered layer. */
export const GridStructureSchema = z.object({
  columns: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
  gutter: z.number().nonnegative().optional(),
  description: z.string().max(500).optional(),
});
export type GridStructure = z.infer<typeof GridStructureSchema>;

/** An area to keep clear of critical content (e.g. platform UI overlays on a Story/Reel). */
export const SafeZoneSchema = z.object({
  label: z.string().max(100),
  position: PositionSchema,
  reason: z.string().max(300).optional(),
});
export type SafeZone = z.infer<typeof SafeZoneSchema>;

/** A convenience pointer to where a specific named element sits, optionally referencing
 * the corresponding entry in `layers[]` by id (e.g. a `type: 'text'` layer for headline,
 * `type: 'logo'` for logoPlacement). */
export const PlacementSchema = z.object({
  layerId: z.string().max(100).optional(),
  position: PositionSchema,
});
export type Placement = z.infer<typeof PlacementSchema>;

export const LayoutPlanStatusEnum = z.enum(['generated', 'approved', 'rejected', 'needs_revision']);
export type LayoutPlanStatus = z.infer<typeof LayoutPlanStatusEnum>;

export const LayoutPlanSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  designBriefId: z.string().uuid(),
  // Denormalized convenience copied from the design brief (which already links to it).
  contentIdeaId: z.string().uuid().optional(),
  // NULL when no approved DesignDNA existed for the client at generation time.
  designDnaId: z.string().uuid().optional(),
  status: LayoutPlanStatusEnum.default('generated'),
  // One generation call produces 2-3 alternatives; this orders/distinguishes them.
  alternativeIndex: z.number().int().positive().default(1),

  format: z.string().max(50),

  canvas: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    backgroundColor: z.string().default('#FFFFFF'),
    dpi: z.number().int().positive().default(72),
  }),

  layers: z.array(LayerSchema),

  gridStructure: GridStructureSchema.optional(),
  safeZones: z.array(SafeZoneSchema).default([]),

  headlinePlacement: PlacementSchema.optional(),
  subtitlePlacement: PlacementSchema.optional(),
  logoPlacement: PlacementSchema.optional(),
  ctaArea: PlacementSchema.optional(),

  colorUsageNotes: z.string().max(1000).optional(),
  typographyNotes: z.string().max(1000).optional(),

  exportSettings: z.object({
    formats: z.array(z.enum(['png', 'jpg', 'webp', 'pdf', 'psd', 'svg'])).default(['png']),
    quality: z.number().int().min(1).max(100).default(90),
    scaleFactor: z.number().positive().default(1),
  }),

  // Design reference ids this alternative drew from, if any (may legitimately be empty).
  referenceDesignIds: z.array(z.string().uuid()).default([]),
  // Specific DesignDNA rule strings this alternative followed — only populated when
  // approved DesignDNA was actually available as prompt context.
  designDnaRulesUsed: z.array(z.string().max(500)).default([]),
  designerNotes: z.string().max(2000).optional(),

  // Server-attached, never invented by the model.
  provider: z.string().max(50).optional(),
  model: z.string().max(100).optional(),
  createdBy: z.string().uuid().optional(),
  approvedBy: z.string().uuid().optional(),
  approvedAt: z.string().datetime().optional(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LayoutPlan = z.infer<typeof LayoutPlanSchema>;

/** Subset the AI layout generation call is expected to produce for EACH alternative —
 * server-controlled fields (id, clientId, designBriefId, contentIdeaId, designDnaId,
 * status, alternativeIndex, provider, model, createdBy, approvedBy, approvedAt,
 * timestamps) are attached by the service after parsing, never invented by the model. */
export const LayoutPlanContentSchema = LayoutPlanSchema.omit({
  id: true,
  clientId: true,
  designBriefId: true,
  contentIdeaId: true,
  designDnaId: true,
  status: true,
  alternativeIndex: true,
  provider: true,
  model: true,
  createdBy: true,
  approvedBy: true,
  approvedAt: true,
  createdAt: true,
  updatedAt: true,
});
export type LayoutPlanContent = z.infer<typeof LayoutPlanContentSchema>;
