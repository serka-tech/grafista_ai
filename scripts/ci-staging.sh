#!/usr/bin/env bash
# Production Step 3 — CI "staging-smoke" profile.
#
# Builds workspace packages on the HOST first, then brings the Docker
# Compose staging stack up, migrates, runs the HTTP smoke script, and ALWAYS
# tears the stack down again on exit — success or failure — via `trap`, so a
# CI runner never leaks a container/volume across job attempts.
#
# Host-build-before-Docker-build is not optional here: Production Step 2C
# found that a bare `docker compose build` alone is not reliably
# reproducible on a fresh checkout — packages/schemas, packages/model-router
# and packages/prompt-engine must already have a host-built dist/ before the
# Docker build runs (see docs/staging-compose.md, "Production Step 2B"/"2C").
set -uo pipefail

COMPOSE_FILE="docker-compose.staging.yml"
MAX_HEALTH_ATTEMPTS=30
HEALTH_POLL_INTERVAL_S=2

cleanup() {
  echo "[ci-staging] tearing down staging stack (runs on success AND failure)"
  pnpm run staging:down
}
trap cleanup EXIT

set -e

echo "[ci-staging] pnpm run build (host) — populates packages/*/dist for the Docker build"
pnpm run build

echo "[ci-staging] pnpm run staging:up"
pnpm run staging:up

echo "[ci-staging] waiting for postgres + api healthchecks"
attempt=0
while :; do
  container_ids=$(docker compose -f "$COMPOSE_FILE" ps -q)
  total=0
  healthy=0
  for id in $container_ids; do
    total=$((total + 1))
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}healthy{{end}}' "$id")
    if [ "$status" = "healthy" ]; then
      healthy=$((healthy + 1))
    fi
  done
  if [ "$total" -gt 0 ] && [ "$healthy" -eq "$total" ]; then
    echo "[ci-staging] all $total service(s) healthy"
    break
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge "$MAX_HEALTH_ATTEMPTS" ]; then
    echo "[ci-staging] FAIL: services did not become healthy within $((MAX_HEALTH_ATTEMPTS * HEALTH_POLL_INTERVAL_S))s"
    docker compose -f "$COMPOSE_FILE" ps
    exit 1
  fi
  sleep "$HEALTH_POLL_INTERVAL_S"
done

echo "[ci-staging] running database migrations inside the api container"
docker compose -f "$COMPOSE_FILE" exec -T api pnpm --filter @grafista/api run db:migrate

echo "[ci-staging] running smoke:staging (HTTP, from host)"
pnpm --filter @grafista/api run smoke:staging
