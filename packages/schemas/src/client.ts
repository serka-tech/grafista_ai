import { z } from 'zod';

// ─── Client Schema ───────────────────────────────────────
export const ClientStatusEnum = z.enum(['active', 'paused', 'archived']);
export type ClientStatus = z.infer<typeof ClientStatusEnum>;

export const ClientSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100),
  industry: z.string().max(100).optional(),
  website: z.string().url().optional(),
  contactName: z.string().max(200).optional(),
  contactEmail: z.string().email().optional(),
  status: ClientStatusEnum.default('active'),
  notes: z.string().max(5000).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Client = z.infer<typeof ClientSchema>;

export const ClientSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  industry: z.string().optional(),
  status: ClientStatusEnum,
  brandAssetsCount: z.number().int().nonnegative(),
  designReferencesCount: z.number().int().nonnegative(),
  hasDNA: z.boolean(),
  lastActivity: z.string().datetime().optional(),
});
export type ClientSummary = z.infer<typeof ClientSummarySchema>;

export const CreateClientSchema = z.object({
  name: z.string().min(1).max(200),
  industry: z.string().max(100).optional(),
  website: z.string().url().optional(),
  contactName: z.string().max(200).optional(),
  contactEmail: z.string().email().optional(),
  notes: z.string().max(5000).optional(),
});
export type CreateClient = z.infer<typeof CreateClientSchema>;
