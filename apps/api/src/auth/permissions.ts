/**
 * Grafista AI Studio — Permission Catalog
 *
 * This is a type-safety aid only. The source of truth for what each role can
 * do is the `roles` / `permissions` / `role_permissions` tables in
 * PostgreSQL (seeded by database/migrations/003_auth.sql) — requirePermission
 * checks a user's permissions as loaded fresh from the database on every
 * request, not this list.
 */

export const PERMISSIONS = [
  'clients:create',
  'clients:read',
  'clients:update',
  'clients:delete',
  'brand_assets:upload',
  'design_references:upload',
  'content_ideas:create',
  'content_ideas:approve',
  'design_briefs:create',
  'design_briefs:approve',
  'layout_plans:create',
  'creative_qa:run',
  'outputs:final_approve',
  'settings:manage',
  'design_dna:run',
  'design_dna:read',
  'design_dna:approve',
  'design_dna:revise',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ['OWNER', 'CREATIVE_DIRECTOR', 'DESIGNER', 'CONTENT_MANAGER'] as const;
export type Role = (typeof ROLES)[number];
