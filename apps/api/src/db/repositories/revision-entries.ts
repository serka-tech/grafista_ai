/**
 * Grafista AI Studio — Revision Entries Repository (Phase 3 Step 6B)
 *
 * Append-only audit trail of approve/reject/needs_revision decisions on the
 * three entities that have a real needs_revision round-trip today
 * (design_dna, layout_plans, creative_qa_reports). `record()` is the "hard"
 * primitive (plain INSERT, throws on failure); `recordBestEffort()` wraps it
 * in try/catch so a revision-recording failure can never break the primary
 * approve/reject/revise HTTP response — same discipline as
 * analyticsEventsRepo (see ../repositories/analytics-events.ts and
 * docs/revision-history-plan.md §12, which leaves best-effort vs hard-fail
 * as an implementation-time call: best-effort was chosen here as the safer
 * default, matching Step 6A's established pattern).
 *
 * Sanitization: reuses analyticsEventsRepo's isDenylistedKey()/
 * assertMetadataSafe() as-is (no second denylist is invented) against
 * beforeSnapshot, afterSnapshot, AND metadata — not just metadata. See
 * docs/revision-history-plan.md §7.
 */

import { pool } from '../pool.js';
import type { RevisionEntry, RevisionEntityType, RevisionType } from '@grafista/schemas';
import { isDenylistedKey, assertMetadataSafe } from './analytics-events.js';

const REASON_MAX_LENGTH = 2000;

function assertSnapshotSafe(label: string, snapshot: Record<string, unknown> | null | undefined): void {
  if (!snapshot) return;
  for (const key of Object.keys(snapshot)) {
    if (isDenylistedKey(key)) {
      throw new Error(`revision_entries.${label} contains a denylisted key: "${key}"`);
    }
  }
}

/** Safe, deterministic truncation — a long reason is capped, never rejected
 * (see docs/revision-history-plan.md §7 — same order of magnitude as
 * production_jobs.rejection_reason's existing 2000-char cap). */
function truncateReason(reason: string | null | undefined): string | null {
  if (reason == null) return null;
  return reason.length > REASON_MAX_LENGTH ? reason.slice(0, REASON_MAX_LENGTH) : reason;
}

function mapRow(row: Record<string, unknown>): RevisionEntry {
  return {
    id: row.id as string,
    clientId: row.client_id as string,
    entityType: row.entity_type as RevisionEntityType,
    entityId: row.entity_id as string,
    revisionType: row.revision_type as RevisionType,
    actorUserId: (row.actor_user_id as string) ?? null,
    beforeSnapshot: (row.before_snapshot as Record<string, unknown>) ?? null,
    afterSnapshot: (row.after_snapshot as Record<string, unknown>) ?? {},
    reason: (row.reason as string) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export interface RecordRevisionEntryInput {
  clientId: string;
  entityType: RevisionEntityType;
  entityId: string;
  revisionType: RevisionType;
  actorUserId?: string | null;
  beforeSnapshot?: Record<string, unknown> | null;
  afterSnapshot: Record<string, unknown>;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

export const revisionEntriesRepo = {
  /** Plain INSERT — throws on failure. Use recordBestEffort() from route call sites instead. */
  async record(input: RecordRevisionEntryInput): Promise<RevisionEntry> {
    const beforeSnapshot = input.beforeSnapshot ?? null;
    const afterSnapshot = input.afterSnapshot ?? {};
    const metadata = input.metadata ?? {};

    assertSnapshotSafe('beforeSnapshot', beforeSnapshot);
    assertSnapshotSafe('afterSnapshot', afterSnapshot);
    assertMetadataSafe(metadata);

    const reason = truncateReason(input.reason);

    const { rows } = await pool.query(
      `INSERT INTO revision_entries (
         id, client_id, entity_type, entity_id, revision_type, actor_user_id,
         before_snapshot, after_snapshot, reason, metadata
       )
       VALUES (uuid_generate_v4(), $1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        input.clientId,
        input.entityType,
        input.entityId,
        input.revisionType,
        input.actorUserId ?? null,
        beforeSnapshot ? JSON.stringify(beforeSnapshot) : null,
        JSON.stringify(afterSnapshot),
        reason,
        JSON.stringify(metadata),
      ]
    );
    return mapRow(rows[0]);
  },

  /**
   * Fire-and-forget wrapper — NEVER throws. Every route call site
   * (design-dna approve/revise, layout-plans approve/reject, creative-qa
   * approve/reject) uses this, not record(), so a transient DB issue or a
   * sanitization rejection can never break the primary approve/reject/revise
   * response it's attached to. On failure, logs a short warning with NO
   * snapshot/payload content — only the revision type, entity id, and error
   * message class.
   */
  async recordBestEffort(input: RecordRevisionEntryInput): Promise<void> {
    try {
      await revisionEntriesRepo.record(input);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.warn(
        `[revision-entries] best-effort record failed — revisionType=${input.revisionType} entityId=${input.entityId} error=${errorMessage}`
      );
    }
  },

  /** Client-scoped, most-recent-first. Client-scoped by construction — no cross-client leakage possible. */
  async getRecentByClientId(clientId: string, limit = 10): Promise<RevisionEntry[]> {
    const { rows } = await pool.query(
      `SELECT * FROM revision_entries WHERE client_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [clientId, limit]
    );
    return rows.map(mapRow);
  },
};
