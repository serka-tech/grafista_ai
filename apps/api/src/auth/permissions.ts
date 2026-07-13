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
  'layout_plans:read',
  'layout_plans:approve',
  'layout_plans:reject',
  'creative_qa:read',
  'creative_qa:approve',
  'creative_qa:reject',
  'workflows:read',
  'workflows:start',
  'workflows:advance',
  'workflows:approve',
  'workflows:cancel',
  'visual_generation:run',
  'visual_generation:read',
  'visual_generation:approve',
  'visual_generation:reject',
  'production_jobs:create',
  'production_jobs:read',
  'production_jobs:approve',
  'production_jobs:reject',
  'render_jobs:create',
  'render_jobs:read',
  'render_jobs:cancel',
  'export_artifacts:read',
  'analytics:read',
  'revisions:read',
  'org:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ['OWNER', 'CREATIVE_DIRECTOR', 'DESIGNER', 'CONTENT_MANAGER'] as const;
export type Role = (typeof ROLES)[number];
