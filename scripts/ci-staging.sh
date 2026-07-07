#!/usr/bin/env bash
# Production Step 3 — CI "staging-smoke" profile. Diagnostics hardened in
# Production Step 8 (see docs/ci-stable-profile.md, "Production Step 8"):
# the health-check loop below used to query `docker compose ps -q`, which
# only lists RUNNING containers — a container that crashed and exited
# between polls simply vanished from the count instead of being flagged,
# so a crashed `api` container could be silently miscounted as "not part of
# the total" while `postgres` alone satisfied the (now smaller) total,
# falsely reporting "all N healthy" right before the next step failed with
# a confusing "service is not running". Fixed by querying `ps -a -q` (all
# containers, including exited ones) and explicitly failing fast the moment
# any container's state is `exited`, rather than either waiting out the
# full timeout or silently under-counting it.
#
# Builds workspace packages on the HOST first, then brings the Docker
# Compose staging stack up, migrates, runs the HTTP smoke script, and ALWAYS
# tears the stack down again on exit — success or failure — via `trap`, so a
# CI runner never leaks a container/volume across job attempts. That same
# `trap` now also dumps every service's `docker compose logs` before tearing
# down, but ONLY on a non-zero exit — this is diagnostics-only (no behavior
# change on success), added because a real remote-runner failure with no
# prior instrumentation left nothing but "Process completed with exit code
# 1" in the CI console, and the crashed container's own stdout/stderr (the
# only place its actual error would appear) was lost the moment
# `staging:down` removed it.
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
  local exit_code=$?
  if [ "$exit_code" -ne 0 ]; then
    echo "[ci-staging] FAILURE DETECTED (exit code $exit_code) — dumping container logs before teardown for diagnosis"
    docker compose -f "$COMPOSE_FILE" logs --no-color || true
  fi
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
    echo "[ci-staging] FAIL: $exited container(s) exited unexpectedly before becoming healthy"
    docker compose -f "$COMPOSE_FILE" ps -a
    exit 1
  fi
  if [ "$total" -gt 0 ] && [ "$healthy" -eq "$total" ]; then
    echo "[ci-staging] all $total service(s) healthy"
    break
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge "$MAX_HEALTH_ATTEMPTS" ]; then
    echo "[ci-staging] FAIL: services did not become healthy within $((MAX_HEALTH_ATTEMPTS * HEALTH_POLL_INTERVAL_S))s"
    docker compose -f "$COMPOSE_FILE" ps -a
    exit 1
  fi
  sleep "$HEALTH_POLL_INTERVAL_S"
done

echo "[ci-staging] running database migrations inside the api container"
docker compose -f "$COMPOSE_FILE" exec -T api pnpm --filter @grafista/api run db:migrate

echo "[ci-staging] running smoke:staging (HTTP, from host)"
pnpm --filter @grafista/api run smoke:staging
