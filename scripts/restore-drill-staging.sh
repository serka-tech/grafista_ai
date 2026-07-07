#!/usr/bin/env bash
# Grafista AI Studio — Staging Restore Drill (Production Step 10)
#
# Exercises the procedure documented in docs/backup-restore-runbook.md §7
# end-to-end against the DISPOSABLE staging Docker Compose stack
# (docker-compose.staging.yml) — never against production. This does NOT
# prove a real production restore works (no managed Postgres/S3 is wired up
# yet, see docs/backup-restore-runbook.md §2) — it proves the RESTORE
# MECHANICS themselves (pg_dump/pg_restore, and a manual copy-based artifact
# restore standing in for the still-missing automated object-storage
# backup, see §1d/§3b of that same doc) actually work end-to-end, with a
# byte-for-byte checksum as the pass/fail signal, not just "the command
# exited 0".
#
# What this does NOT test (out of scope, unchanged by this script):
#   - Managed Postgres/S3 PITR or snapshot mechanisms (no provider chosen
#     yet — docs/backup-restore-runbook.md §2).
#   - `s3`-mode storage restore (this staging skeleton only ever runs
#     STORAGE_PROVIDER=local — see docker-compose.staging.yml's own
#     comment on why no MinIO/S3 service exists here).
#   - Multi-worker horizontal scale (unrelated, separate open risk).
#
# All test data created below (client, brand_assets row, artifact bytes) is
# synthetic, created and destroyed by this script — never real customer
# data, never a real secret (the Postgres credentials are the same
# disposable, non-production ones already committed in
# docker-compose.staging.yml).
#
# Safety model (this script performs DESTRUCTIVE operations — full volume
# removal — against whatever `docker-compose.staging.yml` points at, so it
# refuses to run unless several guards pass):
#   - Refuses if NODE_ENV=production in the CALLING shell.
#   - Refuses if a DATABASE_URL is exported in the calling shell and does
#     not look like this compose network's own Postgres (this script never
#     actually reads DATABASE_URL itself — every DB command runs via
#     `docker compose exec` into the disposable staging containers — this
#     check exists only to catch an operator who might otherwise assume
#     this script respects a production DATABASE_URL and be surprised that
#     it does not).
#   - Hardcoded to docker-compose.staging.yml (not parameterized/overridable
#     by design — a script this destructive should not accept a compose
#     file path as input).
#   - Verifies the compose file actually looks like the known disposable
#     staging skeleton (checks for its committed non-production marker
#     credential) before touching it.
#
# Re-runnable: starts with a defensive `down -v` of any leftover stack from
# a previous run, and always tears the stack + volume down again on exit
# (success or failure) via `trap`, mirroring scripts/ci-staging.sh's own
# pattern. Every run uses a fresh timestamp-suffixed client slug, so two
# runs never collide even if a previous run's cleanup somehow failed.

set -uo pipefail

COMPOSE_FILE="docker-compose.staging.yml"

# ── Safety guards (must pass BEFORE any destructive command runs) ─────────

if [ "${NODE_ENV:-}" = "production" ]; then
  echo "[restore-drill] REFUSING to run: NODE_ENV=production in this shell. This script performs destructive resets (docker compose down -v) and must never run against anything that could be production." >&2
  exit 1
fi

if [ -n "${DATABASE_URL:-}" ] && ! printf '%s' "$DATABASE_URL" | grep -qE '(localhost|127\.0\.0\.1|@postgres[:/])'; then
  echo "[restore-drill] REFUSING to run: DATABASE_URL is exported in this shell and does not look like the local staging compose network (expected a 'postgres' or 'localhost' host). This script does not read DATABASE_URL — all DB access goes through 'docker compose exec' into the disposable staging containers — but a DATABASE_URL pointing somewhere unexpected is a sign this shell's environment is not what you think it is. Unset it or verify it, then re-run." >&2
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[restore-drill] REFUSING to run: $COMPOSE_FILE not found in the current directory. Run this from the repo root." >&2
  exit 1
fi

if ! grep -q "grafista_staging_local_only" "$COMPOSE_FILE"; then
  echo "[restore-drill] REFUSING to run: $COMPOSE_FILE does not contain the expected disposable staging marker credential. Refusing to run a destructive drill against a compose file that doesn't look like the known staging skeleton." >&2
  exit 1
fi

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

log() {
  echo "[restore-drill] [$1] $2"
}

DRILL_TS="$(date +%Y%m%d%H%M%S)"
DRILL_DIR="/tmp/grafista-restore-drill-${DRILL_TS}"
DB_DUMP_FILE="${DRILL_DIR}/postgres.dump"
ARTIFACT_BACKUP_FILE="${DRILL_DIR}/brand-asset-drill-test.txt"
DRILL_CLIENT_SLUG="restore-drill-${DRILL_TS}"
ARTIFACT_CONTENT="grafista restore drill synthetic artifact — ${DRILL_TS} — not real customer data, safe to delete"

mkdir -p "$DRILL_DIR"

cleanup() {
  local exit_code=$?
  if [ "$exit_code" -ne 0 ]; then
    log cleanup "FAILURE DETECTED (exit code $exit_code) — dumping container logs before teardown for diagnosis"
    docker compose -f "$COMPOSE_FILE" logs --no-color 2>&1 | tail -200 || true
  fi
  log cleanup "tearing down staging stack + volume (runs on success AND failure, mirrors scripts/ci-staging.sh)"
  docker compose -f "$COMPOSE_FILE" down -v || true
  log cleanup "removing host-side drill scratch dir ${DRILL_DIR}"
  rm -rf "$DRILL_DIR"
  if [ "$exit_code" -eq 0 ]; then
    log cleanup "DRILL PASSED (exit code 0)"
  else
    log cleanup "DRILL FAILED (exit code ${exit_code}) — see the [stage] tags above for where"
  fi
}
trap cleanup EXIT

set -e

# ── setup ──────────────────────────────────────────────────────────────────

log setup "defensive reset — tearing down any leftover stack/volume from a previous run"
docker compose -f "$COMPOSE_FILE" down -v || true

log setup "pnpm run build (host) — populates packages/*/dist for the Docker build (see apps/api/Dockerfile's own comment on why this is required)"
pnpm run build

log setup "bringing up the staging stack"
pnpm run staging:up

log setup "waiting for postgres + api healthchecks"
attempt=0
while :; do
  container_ids=$(docker compose -f "$COMPOSE_FILE" ps -a -q)
  total=0
  healthy=0
  exited=0
  for id in $container_ids; do
    total=$((total + 1))
    run_status=$(docker inspect -f '{{.State.Status}}' "$id")
    if [ "$run_status" = "exited" ]; then
      exited=$((exited + 1))
      continue
    fi
    health_status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}healthy{{end}}' "$id")
    if [ "$health_status" = "healthy" ]; then
      healthy=$((healthy + 1))
    fi
  done
  if [ "$exited" -gt 0 ]; then
    echo "[restore-drill] [setup] FAIL: $exited container(s) exited unexpectedly before becoming healthy" >&2
    docker compose -f "$COMPOSE_FILE" ps -a
    exit 1
  fi
  if [ "$total" -gt 0 ] && [ "$healthy" -eq "$total" ]; then
    log setup "all $total service(s) healthy"
    break
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "[restore-drill] [setup] FAIL: services did not become healthy within timeout" >&2
    docker compose -f "$COMPOSE_FILE" ps -a
    exit 1
  fi
  sleep 2
done

log setup "running database migrations (fresh instance, 001 through the latest)"
docker compose -f "$COMPOSE_FILE" exec -T api pnpm --filter @grafista/api run db:migrate

# ── seed ───────────────────────────────────────────────────────────────────

log seed "seeding roles/permissions + sample client (pnpm db:seed)"
docker compose -f "$COMPOSE_FILE" exec -T api pnpm --filter @grafista/api run db:seed

log seed "creating a synthetic drill client (NOT real customer data — slug: ${DRILL_CLIENT_SLUG})"
# Wrapped in a CTE so the outer statement is a SELECT, not a bare
# INSERT ... RETURNING — psql -t/-A suppress column headers/alignment but
# NOT the "INSERT 0 1" command-completion tag, which would otherwise get
# concatenated onto the returned UUID once whitespace is stripped below.
DRILL_CLIENT_ID=$(docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U grafista -d grafista -t -A -c "
  WITH ins AS (
    INSERT INTO clients (name, slug, industry, notes)
    VALUES ('Restore Drill Client', '${DRILL_CLIENT_SLUG}', 'internal-test', 'Synthetic client created by scripts/restore-drill-staging.sh — safe to delete, never real customer data.')
    RETURNING id
  )
  SELECT id FROM ins;
")
DRILL_CLIENT_ID=$(printf '%s' "$DRILL_CLIENT_ID" | tr -d '[:space:]')
log seed "drill client id: ${DRILL_CLIENT_ID}"

DRILL_STORAGE_KEY="brand-assets/${DRILL_CLIENT_ID}/drill-test.txt"

log seed "inserting the brand_assets metadata row (storage_provider=local, mirrors what apps/api/src/storage/file-service.ts's storeUploadedFile() would write)"
docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U grafista -d grafista -c "
  INSERT INTO brand_assets (client_id, type, name, mime_type, storage_provider, storage_key, original_filename)
  VALUES ('${DRILL_CLIENT_ID}', 'other', 'Restore Drill Artifact', 'text/plain', 'local', '${DRILL_STORAGE_KEY}', 'drill-test.txt');
"

log seed "writing synthetic artifact bytes into the api container's local storage path (STORAGE_PROVIDER=local -> apps/api/uploads/)"
printf '%s' "$ARTIFACT_CONTENT" > "${DRILL_DIR}/original-artifact.txt"
ORIGINAL_CHECKSUM=$(sha256_of < "${DRILL_DIR}/original-artifact.txt")
docker compose -f "$COMPOSE_FILE" exec -T api sh -c "mkdir -p /repo/apps/api/uploads/brand-assets/${DRILL_CLIENT_ID} && cat > /repo/apps/api/uploads/${DRILL_STORAGE_KEY}" < "${DRILL_DIR}/original-artifact.txt"
log seed "original artifact sha256: ${ORIGINAL_CHECKSUM}"

# ── backup ─────────────────────────────────────────────────────────────────

log backup "pg_dump (custom format, run INSIDE the postgres container — no host-side pg client tools required)"
docker compose -f "$COMPOSE_FILE" exec -T postgres pg_dump -U grafista -Fc grafista > "$DB_DUMP_FILE"
log backup "postgres dump size: $(wc -c < "$DB_DUMP_FILE" | tr -d '[:space:]') bytes"

log backup "copying the artifact bytes out of the api container to a host-side backup file — this IS the manual workaround docs/backup-restore-runbook.md §1d/§3b describes for STORAGE_PROVIDER=local, which today has NO automated backup mechanism"
docker compose -f "$COMPOSE_FILE" exec -T api sh -c "cat /repo/apps/api/uploads/${DRILL_STORAGE_KEY}" > "$ARTIFACT_BACKUP_FILE"
BACKUP_CHECKSUM=$(sha256_of < "$ARTIFACT_BACKUP_FILE")
if [ "$BACKUP_CHECKSUM" != "$ORIGINAL_CHECKSUM" ]; then
  echo "[restore-drill] [backup] FAIL: backup copy checksum ($BACKUP_CHECKSUM) does not match the original ($ORIGINAL_CHECKSUM)" >&2
  exit 1
fi
log backup "backup artifact checksum verified: ${BACKUP_CHECKSUM}"

# ── reset ──────────────────────────────────────────────────────────────────

log reset "tearing down the stack AND removing the postgres volume — simulates real data loss (disk failure, accidental deletion, bad migration)"
docker compose -f "$COMPOSE_FILE" down -v

log reset "bringing the stack back up from scratch (fresh empty postgres, fresh api container filesystem)"
pnpm run staging:up

log reset "waiting for postgres + api healthchecks (fresh instance)"
attempt=0
while :; do
  container_ids=$(docker compose -f "$COMPOSE_FILE" ps -a -q)
  total=0
  healthy=0
  exited=0
  for id in $container_ids; do
    total=$((total + 1))
    run_status=$(docker inspect -f '{{.State.Status}}' "$id")
    if [ "$run_status" = "exited" ]; then
      exited=$((exited + 1))
      continue
    fi
    health_status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}healthy{{end}}' "$id")
    if [ "$health_status" = "healthy" ]; then
      healthy=$((healthy + 1))
    fi
  done
  if [ "$exited" -gt 0 ]; then
    echo "[restore-drill] [reset] FAIL: $exited container(s) exited unexpectedly after reset" >&2
    docker compose -f "$COMPOSE_FILE" ps -a
    exit 1
  fi
  if [ "$total" -gt 0 ] && [ "$healthy" -eq "$total" ]; then
    log reset "all $total service(s) healthy again after reset"
    break
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "[restore-drill] [reset] FAIL: services did not become healthy within timeout after reset" >&2
    exit 1
  fi
  sleep 2
done

log reset "confirming the reset actually destroyed data (fresh postgres should have zero tables in the public schema)"
TABLE_COUNT_AFTER_RESET=$(docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U grafista -d grafista -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
TABLE_COUNT_AFTER_RESET=$(printf '%s' "$TABLE_COUNT_AFTER_RESET" | tr -d '[:space:]')
log reset "public table count after reset: ${TABLE_COUNT_AFTER_RESET} (expected 0)"
if [ "$TABLE_COUNT_AFTER_RESET" != "0" ]; then
  echo "[restore-drill] [reset] WARNING: expected an empty database after volume removal, found ${TABLE_COUNT_AFTER_RESET} tables — the reset may not have fully simulated data loss (continuing anyway, but this weakens what the drill proves)" >&2
fi

# ── restore ────────────────────────────────────────────────────────────────

log restore "restoring postgres from the dump taken in the backup stage"
docker compose -f "$COMPOSE_FILE" exec -T postgres pg_restore --clean --if-exists --no-owner -U grafista -d grafista < "$DB_DUMP_FILE"

log restore "restoring the artifact bytes from the manual backup copy"
docker compose -f "$COMPOSE_FILE" exec -T api sh -c "mkdir -p /repo/apps/api/uploads/brand-assets/${DRILL_CLIENT_ID} && cat > /repo/apps/api/uploads/${DRILL_STORAGE_KEY}" < "$ARTIFACT_BACKUP_FILE"

# ── verify ─────────────────────────────────────────────────────────────────

log verify "checking schema_migrations (restored) vs database/migrations/*.sql on disk"
EXPECTED_MIGRATIONS=$(ls database/migrations/*.sql | xargs -n1 basename | sort)
ACTUAL_MIGRATIONS=$(docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U grafista -d grafista -t -A -c "SELECT filename FROM schema_migrations ORDER BY filename;" | tr -d '\r' | sed '/^$/d' | sort)
if [ "$EXPECTED_MIGRATIONS" != "$ACTUAL_MIGRATIONS" ]; then
  log verify "schema_migrations does not yet match disk — running db:migrate to reconcile (expected if the dump predates a newer migration file)"
  docker compose -f "$COMPOSE_FILE" exec -T api pnpm --filter @grafista/api run db:migrate
  ACTUAL_MIGRATIONS=$(docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U grafista -d grafista -t -A -c "SELECT filename FROM schema_migrations ORDER BY filename;" | tr -d '\r' | sed '/^$/d' | sort)
fi
if [ "$EXPECTED_MIGRATIONS" = "$ACTUAL_MIGRATIONS" ]; then
  log verify "PASS — schema_migrations matches database/migrations/*.sql exactly"
else
  echo "[restore-drill] [verify] FAIL: schema_migrations still does not match disk after db:migrate" >&2
  diff <(printf '%s\n' "$EXPECTED_MIGRATIONS") <(printf '%s\n' "$ACTUAL_MIGRATIONS") || true
  exit 1
fi

log verify "checking the restored brand_assets row is present"
RESTORED_ROW_COUNT=$(docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U grafista -d grafista -t -A -c "SELECT count(*) FROM brand_assets WHERE storage_key = '${DRILL_STORAGE_KEY}';")
RESTORED_ROW_COUNT=$(printf '%s' "$RESTORED_ROW_COUNT" | tr -d '[:space:]')
if [ "$RESTORED_ROW_COUNT" != "1" ]; then
  echo "[restore-drill] [verify] FAIL: expected exactly 1 restored brand_assets row, found ${RESTORED_ROW_COUNT}" >&2
  exit 1
fi
log verify "PASS — restored brand_assets row present (1 row, storage_key matches)"

log verify "checking the restored artifact bytes match the original checksum (this is the actual proof, not just 'the command exited 0')"
RESTORED_CHECKSUM=$(docker compose -f "$COMPOSE_FILE" exec -T api sh -c "cat /repo/apps/api/uploads/${DRILL_STORAGE_KEY}" | sha256_of)
if [ "$RESTORED_CHECKSUM" != "$ORIGINAL_CHECKSUM" ]; then
  echo "[restore-drill] [verify] FAIL: restored artifact checksum (${RESTORED_CHECKSUM}) does not match original (${ORIGINAL_CHECKSUM})" >&2
  exit 1
fi
log verify "PASS — restored artifact checksum matches original (${RESTORED_CHECKSUM})"

log verify "GET /api/health"
curl -sf http://localhost:4000/api/health > /dev/null
log verify "PASS — /api/health OK"

log verify "GET /api/health/ready (see docs/deployment-runbook.md §8 — a 'degraded' sub-check is not automatically a failure, inspect the JSON below by hand)"
curl -s http://localhost:4000/api/health/ready | tee "${DRILL_DIR}/health-ready.json"
echo

log verify "running smoke:staging against the restored instance"
pnpm --filter @grafista/api run smoke:staging

log verify "deleting the synthetic drill client (cascades to its brand_assets row via ON DELETE CASCADE) — leaves the restored DB otherwise untouched"
docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U grafista -d grafista -c "DELETE FROM clients WHERE id = '${DRILL_CLIENT_ID}';"

log verify "ALL CHECKS PASSED"
