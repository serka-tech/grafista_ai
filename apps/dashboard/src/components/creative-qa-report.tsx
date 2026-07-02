'use client';

/**
 * Grafista AI Studio — Creative QA Report display (Phase 2 Step 5B, dashboard Part E)
 *
 * Renders one CreativeQAReport (see packages/schemas/src/qa.ts) plus its
 * approve/reject actions. Mirrors the approve/reject UX already established
 * by apps/dashboard/src/app/briefs/[id]/layout-plans/page.tsx and
 * apps/dashboard/src/app/clients/[id]/design-dna/page.tsx: keyed loading
 * booleans, inline ErrorNote, disabled+title (never silently hidden) buttons,
 * and permission-gating read from the same session/user permissions array
 * the parent page already fetches via api.getCurrentUser().
 */

import { useState } from 'react';
import { api } from '@/lib/api';

const QA_STATUS_BADGES: Record<string, { class: string; label: string }> = {
  generated: { class: 'badge-info', label: 'Oluşturuldu' },
  passed: { class: 'badge-success', label: 'Geçti' },
  failed: { class: 'badge-danger', label: 'Başarısız' },
  approved: { class: 'badge-success', label: 'Onaylandı' },
  rejected: { class: 'badge-danger', label: 'Reddedildi' },
  needs_revision: { class: 'badge-warning', label: 'Revizyon Gerekiyor' },
};

// Mirrors creativeQaReportsRepo.approve()/reject() valid from-states in
// apps/api/src/db/repositories/creative-qa.ts — approve additionally allows
// 'needs_revision', reject does not (a rejected-with-notes report already
// moved to needs_revision and would need re-running, not re-rejecting).
const APPROVABLE_QA_STATUSES = ['generated', 'passed', 'failed', 'needs_revision'];
const REJECTABLE_QA_STATUSES = ['generated', 'passed', 'failed'];

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p style={{ color: 'var(--color-danger, #f87171)', fontSize: '0.85rem', marginTop: '8px' }}>
      ⚠ {message}
    </p>
  );
}

function ScoreBar({ label, score }: { label: string; score: number | undefined }) {
  const value = typeof score === 'number' ? Math.round(score) : null;
  const color = value === null ? 'var(--color-text-muted)' : value >= 75 ? '#34d399' : value >= 50 ? '#fbbf24' : '#f87171';
  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '3px' }}>
        <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
        <span style={{ color, fontWeight: 600 }}>{value === null ? '—' : `${value}/100`}</span>
      </div>
      <div style={{ height: '6px', borderRadius: '999px', background: 'var(--color-bg-glass)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${value ?? 0}%`, borderRadius: '999px', background: color }} />
      </div>
    </div>
  );
}

function FixList({ title, items, tone }: { title: string; items: string[] | undefined; tone: 'danger' | 'warning' | 'info' }) {
  if (!items || items.length === 0) return null;
  const color = tone === 'danger' ? '#f87171' : tone === 'warning' ? '#fbbf24' : '#60a5fa';
  return (
    <div style={{ marginBottom: '10px' }}>
      <span className="form-label" style={{ color }}>{title} ({items.length})</span>
      {items.map((item, i) => (
        <div key={i} style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', padding: '2px 0' }}>• {item}</div>
      ))}
    </div>
  );
}

export function CreativeQAReportCard({
  report,
  permissions,
  onUpdated,
}: {
  report: any;
  permissions: string[];
  onUpdated: (updated: any) => void;
}) {
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [notes, setNotes] = useState('');

  const canApprove = permissions.includes('creative_qa:approve');
  const canReject = permissions.includes('creative_qa:reject');

  const statusInfo = QA_STATUS_BADGES[report.status] ?? { class: 'badge-neutral', label: report.status };
  const canApproveThis = APPROVABLE_QA_STATUSES.includes(report.status);
  const canRejectThis = REJECTABLE_QA_STATUSES.includes(report.status);

  const approveTitle = !canApprove
    ? 'Bu işlemi çalıştırmak için yetkiniz yok'
    : !canApproveThis
      ? 'Bu rapor şu an onaylanabilir durumda değil'
      : 'Bu Creative QA raporunu onayla';

  const rejectTitle = !canReject
    ? 'Bu işlemi çalıştırmak için yetkiniz yok'
    : !canRejectThis
      ? 'Bu rapor şu an reddedilebilir durumda değil'
      : 'Notlu gönderirsen rapor revizyona düşer, boş gönderirsen reddedilir';

  async function handleApprove() {
    setApproving(true);
    setApproveError(null);
    try {
      const res = await api.approveCreativeQa(report.id);
      onUpdated(res.data);
    } catch (err: any) {
      setApproveError(err.message ?? 'Onaylama başarısız oldu.');
    } finally {
      setApproving(false);
    }
  }

  async function handleReject() {
    setRejecting(true);
    setRejectError(null);
    try {
      const res = await api.rejectCreativeQa(report.id, notes.trim() || undefined);
      setNotes('');
      setShowRejectInput(false);
      onUpdated(res.data);
    } catch (err: any) {
      setRejectError(err.message ?? 'Reddetme işlemi başarısız oldu.');
    } finally {
      setRejecting(false);
    }
  }

  const scores = report.scores ?? {};

  return (
    <div className="card dna-section" style={{ marginBottom: '14px' }}>
      <div className="card-header">
        <div className="card-title">
          Creative QA — {new Date(report.createdAt).toLocaleString()}
        </div>
        <span className={`badge ${statusInfo.class}`}>{statusInfo.label}</span>
      </div>

      <div className="tag-list" style={{ marginBottom: '10px' }}>
        <span className={`badge ${report.passed ? 'badge-success' : 'badge-danger'}`}>
          {report.passed ? '✓ Geçti' : '✕ Kaldı'} ({Math.round(report.overallScore)}/100, eşik {report.passThreshold})
        </span>
        {report.provider && <span className="tag tag-accent">{report.provider}{report.model ? ` / ${report.model}` : ''}</span>}
        {typeof report.canProceedToProduction === 'boolean' && (
          <span className={`badge ${report.canProceedToProduction ? 'badge-success' : 'badge-warning'}`}>
            {report.canProceedToProduction ? 'Üretime hazır' : 'Üretime hazır değil'}
          </span>
        )}
      </div>

      {/* ─── Required minimum: overall + DNA/readability/mobile/logo/contrast scores ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '4px 16px', marginBottom: '10px' }}>
        <ScoreBar label="Genel Skor" score={report.overallScore} />
        <ScoreBar label="DesignDNA Uyumu" score={scores.designDnaMatch} />
        <ScoreBar label="Okunabilirlik" score={scores.readability} />
        <ScoreBar label="Mobil Okunabilirlik" score={scores.mobileLegibility} />
        <ScoreBar label="Logo Güvenlik Alanı" score={scores.logoSafety} />
        <ScoreBar label="Renk Kontrastı" score={scores.colorContrast} />
        {/* ─── Bonus: remaining named scores ── */}
        <ScoreBar label="Marka Tutarlılığı" score={scores.brandConsistency} />
        <ScoreBar label="Yerleşim Hiyerarşisi" score={scores.layoutHierarchy} />
        <ScoreBar label="Tipografi Tutarlılığı" score={scores.typographyConsistency} />
        <ScoreBar label="İçerik Netliği" score={scores.contentClarity} />
        <ScoreBar label="Dışa Aktarım Hazırlığı" score={scores.exportReadiness} />
      </div>

      {report.summary && (
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: '10px' }}>{report.summary}</p>
      )}

      <FixList title="Tespit Edilen Sorunlar" items={report.detectedIssues} tone="danger" />
      <FixList title="Yüksek Öncelikli Düzeltmeler" items={report.highPriorityFixes} tone="danger" />
      <FixList title="Orta Öncelikli Düzeltmeler" items={report.mediumPriorityFixes} tone="warning" />
      <FixList title="Düşük Öncelikli Düzeltmeler" items={report.lowPriorityFixes} tone="info" />
      <FixList title="Üretim Öncesi Riskler" items={report.risksBeforeProduction} tone="warning" />

      {report.finalRecommendation && (
        <div style={{ marginBottom: '10px' }}>
          <span className="form-label">Nihai Öneri</span>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-primary)' }}>{report.finalRecommendation}</p>
        </div>
      )}

      {report.designerNotes && (
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', fontStyle: 'italic', marginBottom: '10px' }}>
          “{report.designerNotes}”
        </p>
      )}

      {(report.status === 'approved' || report.status === 'rejected' || report.status === 'needs_revision') && (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '10px' }}>
          {report.status === 'approved' && report.approvedAt && `Onaylandı — ${new Date(report.approvedAt).toLocaleString()}`}
          {(report.status === 'rejected' || report.status === 'needs_revision') && report.rejectedAt &&
            `${report.status === 'needs_revision' ? 'Revizyon istendi' : 'Reddedildi'} — ${new Date(report.rejectedAt).toLocaleString()}`}
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
        <button
          className="btn btn-success btn-sm"
          disabled={!canApprove || !canApproveThis || approving}
          title={approveTitle}
          onClick={handleApprove}
        >
          {approving ? '⏳ Onaylanıyor...' : '✓ Onayla'}
        </button>

        {!showRejectInput ? (
          <button
            className="btn btn-danger btn-sm"
            disabled={!canReject || !canRejectThis || rejecting}
            title={rejectTitle}
            onClick={() => setShowRejectInput(true)}
          >
            ✕ Reddet
          </button>
        ) : (
          <>
            <input
              type="text"
              className="form-input"
              placeholder="Revizyon notu (opsiyonel)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{ width: '200px' }}
              disabled={rejecting}
            />
            <button
              className="btn btn-danger btn-sm"
              disabled={!canReject || !canRejectThis || rejecting}
              title={rejectTitle}
              onClick={handleReject}
            >
              {rejecting ? '⏳ Gönderiliyor...' : 'Gönder'}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={rejecting}
              onClick={() => { setShowRejectInput(false); setNotes(''); }}
            >
              Vazgeç
            </button>
          </>
        )}
      </div>

      <ErrorNote message={approveError} />
      <ErrorNote message={rejectError} />
    </div>
  );
}
