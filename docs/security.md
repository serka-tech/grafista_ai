# Grafista AI Studio — Security

## API Key Management

### Current (MVP)
- All API keys stored in `.env` file (gitignored)
- `.env.example` lists required variables without values
- Keys read via `process.env` at runtime
- No keys hardcoded in source code

### Production (Phase 2+)
- [ ] Migrate to secrets manager (Railway secrets / AWS Secrets Manager)
- [ ] Rotate keys on schedule
- [ ] Per-environment key isolation (dev/staging/prod)
- [ ] Key usage audit logging

## Client Asset Privacy

### Design Principles
- Client data is isolated by `client_id` in all database queries
- No cross-client data leakage in API responses
- Uploaded files stored per-client in separate storage paths
- File URLs are not guessable (UUID-based paths)

### Production Recommendations
- [ ] S3 bucket policies per client
- [ ] Signed URLs for file access (expiring)
- [ ] Data retention policies
- [ ] Client data export/deletion capability (GDPR)

## Role-Based Access Control (RBAC)

### Planned Roles

| Role | Permissions |
|------|------------|
| `creative_director` | Full access: create/edit/approve/delete all |
| `designer` | View clients, assets, DNA, briefs; cannot approve |
| `content_manager` | Create/edit content ideas, view briefs |
| `client` | View own brand, approve/reject content (Phase 3) |

### Implementation Plan
- [ ] NextAuth with role claims
- [ ] Middleware-level permission checks
- [ ] UI-level element visibility by role
- [ ] Audit log per action

## Audit Logs

### Tracked Actions
- Client create/update/delete
- Brand asset upload/delete
- Design reference upload/delete
- Content idea generation
- Approval/rejection actions
- Design brief creation
- AI model calls (provider, task, tokens, cost)

### Schema
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  user_role VARCHAR(30),
  user_name VARCHAR(200),
  action VARCHAR(100),
  entity_type VARCHAR(50),
  entity_id UUID,
  details JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ
);
```

## Upload Validation

### Current Rules
- Max file size: 50MB (configurable via `UPLOAD_MAX_SIZE_MB`)
- Allowed types: PNG, JPEG, WebP, SVG, PDF, PSD
- File type validated by MIME type header
- Files renamed with UUID on upload

### Production Recommendations
- [ ] Virus scanning on upload
- [ ] Image dimension validation
- [ ] EXIF metadata stripping
- [ ] Content-type verification (not just MIME header)
- [ ] Rate limiting on upload endpoints

## Prompt Injection Protection

### Current Safeguards
- System prompts define strict role boundaries
- Output format enforced (JSON schema validation)
- User inputs are inserted as template variables, not raw concatenation
- Brand data sanitized before prompt inclusion

### Production Recommendations
- [ ] Input sanitization layer
- [ ] Output validation against expected schemas
- [ ] Prompt logging for audit
- [ ] Content filtering on AI outputs
- [ ] Rate limiting on AI generation endpoints

## Model Cost Tracking

### Implementation
- `AIResponse.usage` tracks tokens per request
- `estimatedCost` calculated from provider pricing
- Logged per client/task for billing

### Budget Controls (Phase 3)
- [ ] Per-client monthly budget limits
- [ ] Alert on high-cost operations
- [ ] Cost dashboard with breakdowns
- [ ] Automatic downgrade to cheaper models when budget low
