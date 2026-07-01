-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Authentication & Role-Based Authorization
-- ═══════════════════════════════════════════════════════════

-- ─── Roles ───────────────────────────────────────────────
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Permissions ─────────────────────────────────────────
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key VARCHAR(100) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Role ↔ Permission ───────────────────────────────────
CREATE TABLE role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ─── Users ───────────────────────────────────────────────
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(320) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name VARCHAR(200),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- ─── User ↔ Role ─────────────────────────────────────────
CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX idx_user_roles_user ON user_roles(user_id);

-- ─── Sessions (DB-backed — survives API restart, revocable) ──
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Seed the fixed role/permission catalog (reference data, not sample data) ──

INSERT INTO roles (name) VALUES
  ('OWNER'), ('CREATIVE_DIRECTOR'), ('DESIGNER'), ('CONTENT_MANAGER');

INSERT INTO permissions (key) VALUES
  ('clients:create'), ('clients:read'), ('clients:update'), ('clients:delete'),
  ('brand_assets:upload'), ('design_references:upload'),
  ('content_ideas:create'), ('content_ideas:approve'),
  ('design_briefs:create'), ('design_briefs:approve'),
  ('layout_plans:create'), ('creative_qa:run'),
  ('outputs:final_approve'), ('settings:manage');

-- OWNER: all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'OWNER';

-- CREATIVE_DIRECTOR
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'CREATIVE_DIRECTOR' AND p.key IN (
  'clients:read', 'brand_assets:upload', 'design_references:upload',
  'content_ideas:create', 'content_ideas:approve',
  'design_briefs:create', 'design_briefs:approve',
  'layout_plans:create', 'creative_qa:run', 'outputs:final_approve'
);

-- DESIGNER
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'DESIGNER' AND p.key IN (
  'clients:read', 'brand_assets:upload', 'design_references:upload',
  'design_briefs:create', 'layout_plans:create', 'creative_qa:run'
);

-- CONTENT_MANAGER
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'CONTENT_MANAGER' AND p.key IN (
  'clients:read', 'content_ideas:create', 'content_ideas:approve'
);
