'use client';

// Grafista AI Studio — Revision History Panel (Phase 3 Step 6B)
//
// Fetches GET /api/clients/:id/revisions/recent and renders it with the
// SAME loading/error/empty-state structure as analytics-summary-panel.tsx
// (see apps/dashboard/src/components/analytics-summary-panel.tsx) — no new
// CSS is introduced, just the existing `.card`/`<ul>` idiom. Only covers
// design_dna/layout_plan/creative_qa_report revisions (see
// docs/revision-history-plan.md §3/§9) — ProductionJob/RenderJob decisions
// are NOT included, they are out of scope for this MVP.

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface RevisionEntrySummary {
  id: string;
  entityType: string;
  entityId: string;
  revisionType: string;
  actorUserId: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  design_dna: 'DesignDNA',
  layout_plan: 'Layout Planı',
  creative_qa_report: 'Creative QA',
};

const REVISION_TYPE_LABELS: Record<string, string> = {
  design_dna_approved: 'Onaylandı',
  design_dna_needs_revision: 'Yeniden Gözden Geçirme İstendi',
  layout_plan_approved: 'Onaylandı',
  layout_plan_rejected: 'Reddedildi',
  layout_plan_needs_revision: 'Yeniden Gözden Geçirme İstendi',
  creative_qa_report_approved: 'Onaylandı',
  creative_qa_report_rejected: 'Reddedildi',
  creative_qa_report_needs_revision: 'Yeniden Gözden Geçirme İstendi',
};

const REASON_PREVIEW_LENGTH = 80;

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('tr-TR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function describeRevision(item: RevisionEntrySummary): string {
  const entityLabel = ENTITY_TYPE_LABELS[item.entityType] ?? item.entityType;
  const revisionLabel = REVISION_TYPE_LABELS[item.revisionType] ?? item.revisionType;
  const parts = [entityLabel, revisionLabel];
  if (item.reason) {
    const truncated =
      item.reason.length > REASON_PREVIEW_LENGTH
        ? `${item.reason.slice(0, REASON_PREVIEW_LENGTH)}…`
        : item.reason;
    parts.push(`"${truncated}"`);
  }
  parts.push(formatShortDate(item.createdAt));
  return parts.join(' — ');
}

export function RevisionHistoryPanel({ clientId }: { clientId: string }) {
  const [revisions, setRevisions] = useState<RevisionEntrySummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    api
      .getClientRecentRevisions(clientId)
      .then((res) => {
        if (!cancelled) setRevisions(res.data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (loading) {
    return <div className="card" style={{ marginTop: '24px' }}>Revizyon geçmişi yükleniyor...</div>;
  }

  if (error || !revisions) {
    return (
      <div className="card" style={{ marginTop: '24px' }}>
        <div className="card-title">📝 Revizyon Geçmişi</div>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
          Revizyon geçmişi şu anda görüntülenemiyor.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: '24px' }}>
      <div className="card-title" style={{ marginBottom: '8px' }}>📝 Revizyon Geçmişi</div>
      {revisions.length === 0 ? (
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>Henüz revizyon kaydı yok.</p>
      ) : (
        <ul style={{ paddingLeft: '20px', margin: 0 }}>
          {revisions.map((item) => (
            <li key={item.id} style={{ fontSize: '0.9rem', marginBottom: '4px' }}>
              {describeRevision(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
