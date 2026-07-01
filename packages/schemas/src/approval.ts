import { z } from 'zod';

// ─── Approval System ─────────────────────────────────────
export const ApprovalStatusEnum = z.enum([
  'pending',
  'approved',
  'rejected',
  'revision_requested',
  'auto_approved',
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusEnum>;

export const ApprovalEntityTypeEnum = z.enum([
  'content_idea',
  'design_brief',
  'generated_output',
  'final_delivery',
]);
export type ApprovalEntityType = z.infer<typeof ApprovalEntityTypeEnum>;

export const ApprovalRecordSchema = z.object({
  id: z.string().uuid(),
  entityType: ApprovalEntityTypeEnum,
  entityId: z.string().uuid(),
  clientId: z.string().uuid(),
  status: ApprovalStatusEnum,
  reviewerRole: z.enum(['creative_director', 'designer', 'content_manager', 'client']).optional(),
  reviewerName: z.string().max(200).optional(),
  notes: z.string().max(3000).optional(),
  revisionNotes: z.string().max(3000).optional(),
  approvedAt: z.string().datetime().optional(),
  rejectedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;

export const CreateApprovalSchema = z.object({
  entityType: ApprovalEntityTypeEnum,
  entityId: z.string().uuid(),
  clientId: z.string().uuid(),
  status: ApprovalStatusEnum,
  reviewerRole: z.enum(['creative_director', 'designer', 'content_manager', 'client']).optional(),
  reviewerName: z.string().max(200).optional(),
  notes: z.string().max(3000).optional(),
  revisionNotes: z.string().max(3000).optional(),
});
export type CreateApproval = z.infer<typeof CreateApprovalSchema>;
