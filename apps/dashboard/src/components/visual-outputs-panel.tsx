'use client';

/**
 * Grafista AI Studio — Visual Outputs panel (Phase 2 Step 7, dashboard)
 *
 * Renders the generated visual alternatives of one layout plan plus the
 * "generate" / approve / reject actions. Mirrors the UX patterns already
 * established by apps/dashboard/src/components/creative-qa-report.tsx and
 * apps/dashboard/src/app/briefs/[id]/layout-plans/page.tsx: keyed loading
 * booleans, inline ErrorNote, disabled+title (never silently hidden) buttons,
 * and permission-gating read from the same session/user permissions array
 * the parent page already fetches via api.getCurrentUser().
 *
 * The Creative QA approval gate also lives in the backend service (409 when
 * no approved CreativeQA report exists); the `creativeQaApproved` prop is
 * only an early-warning UX hint, never a bypass.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, resolveApiFileUrl } from '@/lib/api';

const OUTPUT_STATUS_BADGES: Record<string, { class: string; label: string }> = {
  pending: { class: 'badge-warning', label: 'Bekliyor' },
  generated: { class: 'badge-success', label: 'Üretildi' },
  failed: { class: 'badge-danger', label: 'Başarısız' },
};

const APPROVAL_STATUS_BADGES: Record<string, { class: string; label: string }> = {
  pending: { class: 'badge-info', label: 'Onay Bekliyor' },
  approved: { class: 'badge-success', label: 'Onaylandı' },
  rejected: { class: 'badge-danger', label: 'Reddedildi' },
  revision_requested: { class: 'badge-warning', label: 'Revizyon İstendi' },
};

// Production job lifecycle (Phase 2 Step 8A) — single linear status axis,
// see packages/schemas/src/production-job.ts.
const PRODUCTION_JOB_STATUS_BADGES: Record<string, { class: string; label: string }> = {
  pending: { class: 'badge-warning', label: 'Sırada' },
  packaging: { class: 'badge-info', label: 'Paketleniyor' },
  package_ready: { class: 'badge-success', label: 'Paket Hazır' },
  failed: { class: 'badge-danger', label: 'Başarısız' },
  cancelled: { class: 'badge-neutral', label: 'İptal Edildi' },
  approved: { class: 'badge-success', label: 'Onaylandı' },
  rejected: { class: 'badge-danger', label: 'Reddedildi' },
};

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p style={{ color: 'var(--color-danger, #f87171)', fontSize: '0.85rem', marginTop: '8px' }}>
      ⚠ {message}
    </p>
  );
}

type OutputActionState = {
  approving: boolean;
  approveError: string | null;
  rejecting: boolean;
  rejectError: string | null;
  showRejectInput: boolean;
  notes: string;
  sendingToProduction: boolean;
  sendToProductionError: string | null;
};

function emptyOutputActionState(): OutputActionState {
  return {
    approving: false,
    approveError: null,
    rejecting: false,
    rejectError: null,
    showRejectInput: false,
    notes: '',
    sendingToProduction: false,
    sendToProductionError: null,
  };
}

function OutputCard({
  output,
  permissions,
  onUpdated,
}: {
  output: any;
  permissions: string[];
  onUpdated: (updated: any) => void;
}) {
  const [state, setState] = useState<OutputActionState>(emptyOutputActionState());
  const patch = (p: Partial<OutputActionState>) => setState((prev) => ({ ...prev, ...p }));

  // Latest production job for this output (Phase 2 Step 8A). Eagerly loaded on
  // mount — same idiom as the panel's own loadOutputs effect — so the job
  // status badge is visible without any user interaction.
  const [productionJob, setProductionJob] = useState<any | null>(null);

  const canApprove = permissions.includes('visual_generation:approve');
  const canReject = permissions.includes('visual_generation:reject');
  const canSendToProduction = permissions.includes('production_jobs:create');

  useEffect(() => {
    // Jobs only ever exist for successfully generated outputs; skip the
    // round-trip for pending/failed cards.
    if (output.status !== 'generated') return;
    let active = true;
    api
      .listProductionJobs(output.id)
      .then((res) => {
        // History is ordered oldest-first — the last entry is the latest job.
        const jobs = res.data ?? [];
        if (active) setProductionJob(jobs.length > 0 ? jobs[jobs.length - 1] : null);
      })
      .catch(() => {
        // A 403 (user lacks production_jobs:read) is an expected gating
        // outcome, and a transient load failure should not break the card —
        // mirror loadOutputs' silent handling and just show no job.
      });
    return () => {
      active = false;
    };
  }, [output.id, output.status]);

  const statusInfo = OUTPUT_STATUS_BADGES[output.status] ?? { class: 'badge-neutral', label: output.status };
  const approvalInfo = APPROVAL_STATUS_BADGES[output.approvalStatus] ?? { class: 'badge-neutral', label: output.approvalStatus };

  // Only a generated output still awaiting approval can be approved/rejected;
  // the backend returns 409 for any other state, this just pre-warns via title.
  const canActOnThis = output.status === 'generated' && output.approvalStatus === 'pending';

  const approveTitle = !canApprove
    ? 'Bu işlemi çalıştırmak için yetkiniz yok'
    : !canActOnThis
      ? 'Bu görsel şu an onaylanabilir durumda değil'
      : 'Bu görsel alternatifi onayla';

  const rejectTitle = !canReject
    ? 'Bu işlemi çalıştırmak için yetkiniz yok'
    : !canActOnThis
      ? 'Bu görsel şu an reddedilebilir durumda değil'
      : 'Notlu gönderirsen görsel revizyona düşer, boş gönderirsen reddedilir';

  async function handleApprove() {
    patch({ approving: true, approveError: null });
    try {
      const res = await api.approveVisualOutput(output.id);
      onUpdated(res.data);
    } catch (err: any) {
      patch({ approveError: err.message ?? 'Onaylama başarısız oldu.' });
    } finally {
      patch({ approving: false });
    }
  }

  // Only a successfully generated output can be sent to production (backend
  // returns 409 otherwise), and at most one active job can exist per output
  // (the create route is idempotent and would just return it).
  const hasActiveJob =
    productionJob != null && !['failed', 'cancelled', 'rejected'].includes(productionJob.status);
  const canSendThis = output.status === 'generated' && !hasActiveJob;

  const sendToProductionTitle = !canSendToProduction
    ? 'Bu işlemi çalıştırmak için yetkiniz yok'
    : hasActiveJob
      ? 'Bu görsel için zaten aktif bir üretim işi var'
      : output.status !== 'generated'
        ? 'Sadece başarıyla üretilmiş görseller üretime gönderilebilir'
        : 'Bu görseli üretim paketlemesine gönder';

  async function handleSendToProduction() {
    patch({ sendingToProduction: true, sendToProductionError: null });
    try {
      const res = await api.createProductionJob(output.id);
      setProductionJob(res.data);
    } catch (err: any) {
      patch({ sendToProductionError: err.message ?? 'Üretime gönderme başarısız oldu.' });
    } finally {
      patch({ sendingToProduction: false });
    }
  }

  async function handleReject() {
    patch({ rejecting: true, rejectError: null });
    try {
      const res = await api.rejectVisualOutput(output.id, state.notes.trim() || undefined);
      patch({ notes: '', showRejectInput: false });
      onUpdated(res.data);
    } catch (err: any) {
      patch({ rejectError: err.message ?? 'Reddetme işlemi başarısız oldu.' });
    } finally {
      patch({ rejecting: false });
    }
  }

  // fileUrl is an API-relative protected route (/api/visual-outputs/:id/file), so it
  // must be resolved against the API origin — the dashboard runs on a different port.
  const previewPath = output.previewUrl ?? output.fileUrl ?? null;
  const previewSrc = previewPath ? resolveApiFileUrl(previewPath) : null;

  return (
    <div className="card dna-section" style={{ marginBottom: '14px' }}>
      <div className="card-header">
        <div className="card-title">Görsel Alternatif {output.alternativeIndex ?? '—'}</div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <span className={`badge ${statusInfo.class}`}>{statusInfo.label}</span>
          <span className={`badge ${approvalInfo.class}`}>{approvalInfo.label}</span>
        </div>
      </div>

      {previewSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- generated asset URLs come from arbitrary storage providers; next/image domain allowlisting is not configured for them
        <img
          src={previewSrc}
          alt={`Görsel alternatif ${output.alternativeIndex ?? ''}`}
          style={{
            width: '100%',
            maxHeight: '260px',
            objectFit: 'contain',
            borderRadius: '8px',
            background: 'var(--color-bg-glass)',
            marginBottom: '10px',
          }}
        />
      ) : (
        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '10px' }}>
          {output.status === 'failed' ? 'Üretim başarısız olduğu için önizleme yok.' : 'Önizleme henüz hazır değil.'}
        </p>
      )}

      <div className="tag-list" style={{ marginBottom: '10px' }}>
        {output.provider && (
          <span className="tag tag-accent">{output.provider}{output.aiModel ? ` / ${output.aiModel}` : ''}</span>
        )}
        {output.dimensions?.width && output.dimensions?.height && (
          <span className="tag">{output.dimensions.width} × {output.dimensions.height}</span>
        )}
        {output.mimeType && <span className="tag">{output.mimeType}</span>}
        {output.createdAt && <span className="tag">{new Date(output.createdAt).toLocaleString()}</span>}
      </div>

      {output.status === 'failed' && output.errorMessage && (
        <p style={{ color: 'var(--color-danger, #f87171)', fontSize: '0.8rem', marginBottom: '10px' }}>
          Hata: {output.errorMessage}
        </p>
      )}

      {output.approvalStatus === 'approved' && output.approvedAt && (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '10px' }}>
          Onaylandı — {new Date(output.approvedAt).toLocaleString()}
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
        <button
          className="btn btn-success btn-sm"
          disabled={!canApprove || !canActOnThis || state.approving}
          title={approveTitle}
          onClick={handleApprove}
        >
          {state.approving ? '⏳ Onaylanıyor...' : '✓ Onayla'}
        </button>

        {!state.showRejectInput ? (
          <button
            className="btn btn-danger btn-sm"
            disabled={!canReject || !canActOnThis || state.rejecting}
            title={rejectTitle}
            onClick={() => patch({ showRejectInput: true })}
          >
            ✕ Reddet
          </button>
        ) : (
          <>
            <input
              type="text"
              className="form-input"
              placeholder="Revizyon notu (opsiyonel)"
              value={state.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              style={{ width: '200px' }}
              disabled={state.rejecting}
            />
            <button
              className="btn btn-danger btn-sm"
              disabled={!canReject || !canActOnThis || state.rejecting}
              title={rejectTitle}
              onClick={handleReject}
            >
              {state.rejecting ? '⏳ Gönderiliyor...' : 'Gönder'}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={state.rejecting}
              onClick={() => patch({ showRejectInput: false, notes: '' })}
            >
              Vazgeç
            </button>
          </>
        )}

        <button
          className="btn btn-primary btn-sm"
          disabled={!canSendToProduction || !canSendThis || state.sendingToProduction}
          title={sendToProductionTitle}
          onClick={handleSendToProduction}
        >
          {state.sendingToProduction ? '⏳ Gönderiliyor...' : '🏭 Üretime Gönder'}
        </button>
      </div>

      {productionJob && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Üretim işi:</span>
          <span
            className={`badge ${(PRODUCTION_JOB_STATUS_BADGES[productionJob.status] ?? { class: 'badge-neutral' }).class}`}
          >
            {(PRODUCTION_JOB_STATUS_BADGES[productionJob.status] ?? { label: productionJob.status }).label}
          </span>
          {(productionJob.status === 'package_ready' || productionJob.status === 'approved') && (
            // Same API-origin resolution as the preview image above: the
            // package route is API-relative and protected by the session cookie.
            <a
              className="btn btn-secondary btn-sm"
              href={resolveApiFileUrl(`/api/production-jobs/${productionJob.id}/package`)}
              target="_blank"
              rel="noreferrer"
            >
              ⬇ Paketi İndir
            </a>
          )}
        </div>
      )}

      {productionJob?.status === 'failed' && (
        <ErrorNote message={productionJob.errorMessage ?? 'Üretim paketleme başarısız oldu.'} />
      )}
      <ErrorNote message={state.sendToProductionError} />
      <ErrorNote message={state.approveError} />
      <ErrorNote message={state.rejectError} />
    </div>
  );
}

export function VisualOutputsPanel({
  layoutPlanId,
  creativeQaApproved,
  permissions,
}: {
  layoutPlanId: string;
  creativeQaApproved: boolean;
  permissions: string[];
}) {
  const [outputs, setOutputs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const canRun = permissions.includes('visual_generation:run');

  const loadOutputs = useCallback(async () => {
    try {
      const res = await api.listVisualOutputs(layoutPlanId);
      setOutputs(res.data ?? []);
      setLoadError(null);
    } catch (err: any) {
      // A 403 (user lacks visual_generation:read) is an expected gating outcome,
      // not a load failure — just show an empty list, mirroring the Creative QA
      // report loading behavior on the layout plans page.
      if (err.status === 403) {
        setOutputs([]);
        setLoadError(null);
      } else {
        setLoadError(err.message ?? 'Görsel çıktılar yüklenirken hata oluştu.');
      }
    }
  }, [layoutPlanId]);

  useEffect(() => {
    setLoading(true);
    loadOutputs().finally(() => setLoading(false));
  }, [loadOutputs]);

  async function handleGenerate() {
    setGenerating(true);
    setGenerateError(null);
    try {
      // Each run produces a brand-new alternative set (not idempotent), so
      // prepend the fresh set on top of the existing history.
      const res = await api.runVisualGeneration(layoutPlanId);
      setOutputs((prev) => [...(res.data ?? []), ...prev]);
    } catch (err: any) {
      const message = err.status === 409
        ? (err.message ?? 'Görsel üretmek için önce Creative QA onayı gerekli.')
        : err.status === 502
          ? 'Görsel üretim tamamlanamadı — AI sağlayıcı hatası. Çıktı kaydedilmedi.'
          : (err.message ?? 'Görsel üretim başlatılamadı.');
      setGenerateError(message);
    } finally {
      setGenerating(false);
    }
  }

  const generateTitle = !canRun
    ? 'Bu işlemi çalıştırmak için yetkiniz yok'
    : !creativeQaApproved
      ? 'Görsel üretmek için önce Creative QA onayı gerekli'
      : 'Bu yerleşim planı için yeni bir görsel alternatif seti üret';

  return (
    <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--color-border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
        <span className="form-label" style={{ marginBottom: 0 }}>
          🖼️ Görsel Alternatifler {outputs.length > 0 ? `(${outputs.length})` : ''}
        </span>
        <button
          className="btn btn-primary btn-sm"
          disabled={!canRun || !creativeQaApproved || generating}
          title={generateTitle}
          onClick={handleGenerate}
        >
          {generating ? '⏳ Üretiliyor...' : '▶ Yeni Alternatif Üret'}
        </button>
      </div>

      {!creativeQaApproved && (
        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '10px' }}>
          Görsel üretmek için önce Creative QA onayı gerekli.
        </p>
      )}

      <ErrorNote message={generateError} />
      <ErrorNote message={loadError} />

      {loading && (
        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Görsel çıktılar yükleniyor...</p>
      )}

      {!loading && outputs.length === 0 && !loadError ? (
        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
          Bu alternatif için henüz görsel üretilmedi.
        </p>
      ) : (
        outputs.map((output) => (
          <OutputCard
            key={output.id}
            output={output}
            permissions={permissions}
            onUpdated={(updated) =>
              setOutputs((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
            }
          />
        ))
      )}
    </div>
  );
}
