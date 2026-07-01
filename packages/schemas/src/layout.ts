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

export const LayoutPlanSchema = z.object({
  id: z.string().uuid(),
  designBriefId: z.string().uuid(),
  clientId: z.string().uuid(),

  canvas: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    backgroundColor: z.string().default('#FFFFFF'),
    dpi: z.number().int().positive().default(72),
  }),

  layers: z.array(LayerSchema),

  exportSettings: z.object({
    formats: z.array(z.enum(['png', 'jpg', 'webp', 'pdf', 'psd', 'svg'])).default(['png']),
    quality: z.number().int().min(1).max(100).default(90),
    scaleFactor: z.number().positive().default(1),
  }),

  designNotes: z.string().max(2000).optional(),
  version: z.number().int().positive().default(1),
  createdAt: z.string().datetime(),
});
export type LayoutPlan = z.infer<typeof LayoutPlanSchema>;
