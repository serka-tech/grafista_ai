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

// Render job lifecycle (Phase 2 Step 9A) — see packages/schemas/src/render-job.ts
// (RenderJobStatusEnum). No 'approved'/'rejected' states here — a render is a
// downstream, already-approved-upstream artifact request, not another human
// approval gate.
const RENDER_JOB_STATUS_BADGES: Record<string, { class: string; label: string }> = {
  pending: { class: 'badge-warning', label: 'Sırada' },
  rendering: { class: 'badge-info', label: 'Render Ediliyor' },
  rendered: { class: 'badge-success', label: 'Hazır' },
  failed: { class: 'badge-danger', label: 'Başarısız' },
  cancelled: { class: 'badge-neutral', label: 'İptal Edildi' },
};

// Render presets/formats (Phase 2 Step 9A) — mirrors RenderPresetEnum /
// ExportFormatEnum in packages/schemas/src/render-job.ts exactly. Hardcoded
// here rather than fetched since the dashboard doesn't import @grafista/schemas.
const RENDER_PRESETS = [
  { value: 'instagram_post', label: 'Instagram Post (1080×1080)' },
  { value: 'instagram_story', label: 'Story (1080×1920)' },
  { value: 'landscape', label: 'Landscape (1920×1080)' },
  { value: 'ad_creative', label: 'Ad Creative (1200×628)' },
];
const EXPORT_FORMATS = ['png', 'jpg', 'pdf'];

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
  // Production job approve/reject (Phase 2 Step 8B) — mirrors the visual
  // output's own approving/rejecting/showRejectInput/notes fields above.
  approvingProductionJob: boolean;
  approveProductionJobError: string | null;
  rejectingProductionJob: boolean;
  rejectProductionJobError: string | null;
  showProductionRejectInput: boolean;
  productionRejectReason: string;
  // Render / export (Phase 2 Step 9A) — one render request at a time per card.
  rendering: boolean;
  renderError: string | null;
  selectedPreset: string;
  selectedExportFormat: string;
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
    approvingProductionJob: false,
    approveProductionJobError: null,
    rejectingProductionJob: false,
    rejectProductionJobError: null,
    showProductionRejectInput: false,
    productionRejectReason: '',
    rendering: false,
    renderError: null,
    selectedPreset: 'instagram_post',
    selectedExportFormat: 'png',
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

  // Render job + its artifacts (Phase 2 Step 9A). Hotfix: hydrated from
  // persisted history — GET /production-jobs/:id/render-jobs — on mount and
  // whenever the production job reaches package_ready/approved, so a page
  // reload no longer loses it (previously this only ever reflected a render
  // requested during the current browser session). renderJob always mirrors
  // the LATEST entry of renderHistory below; see loadRenderHistory.
  const [renderJob, setRenderJob] = useState<any | null>(null);
  const [renderArtifacts, setRenderArtifacts] = useState<any[]>([]);

  // Full render-job history for this production job, oldest-first (same
  // order the backend returns) — this hotfix. Powers the compact "Önceki
  // render işlemleri" list further down; renderJob/renderArtifacts above are
  // just its last entry, kept as their own state since the Step 9A code
  // (handleRenderExport, the JSX below) already reads them directly.
  const [renderHistory, setRenderHistory] = useState<any[]>([]);

  const canApprove = permissions.includes('visual_generation:approve');
  const canReject = permissions.includes('visual_generation:reject');
  const canSendToProduction = permissions.includes('production_jobs:create');
  const canApproveProductionJob = permissions.includes('production_jobs:approve');
  const canRejectProductionJob = permissions.includes('production_jobs:reject');
  const canRender = permissions.includes('render_jobs:create');

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

  // Render history (this hotfix): fetches every render job for this
  // production job and hydrates renderJob/renderArtifacts from the latest
  // entry (oldest-first, so the last entry is the latest — same idiom as the
  // productionJob effect above). Shared between the hydration effect below
  // and handleRenderExport's post-render refresh, mirroring the panel-level
  // loadOutputs reusable-useCallback idiom.
  const loadRenderHistory = useCallback(async () => {
    const productionJobId = productionJob?.id;
    if (!productionJobId) return;
    try {
      const res = await api.listRenderJobsForProductionJob(productionJobId);
      const jobs = res.data ?? [];
      setRenderHistory(jobs);
      if (jobs.length > 0) {
        const latest = jobs[jobs.length - 1];
        setRenderJob(latest);
        setRenderArtifacts(latest.artifactSummaries ?? []);
      }
    } catch {
      // A 403 (user lacks render_jobs:read) is an expected gating outcome,
      // and a transient load failure should not break the card — mirror the
      // productionJob effect's silent handling above.
    }
  }, [productionJob?.id]);

  useEffect(() => {
    // The render section only ever renders for package_ready/approved jobs
    // (see the JSX gate further down), so only fetch history in those states.
    const isRenderReady = productionJob?.status === 'package_ready' || productionJob?.status === 'approved';
    if (!isRenderReady) return;
    let active = true;
    if (active) loadRenderHistory();
    return () => {
      active = false;
    };
  }, [productionJob?.id, productionJob?.status, loadRenderHistory]);

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

  // Production job approve/reject (Phase 2 Step 8B). Only a job in
  // `package_ready` can be actioned; once approved/rejected it is terminal
  // (the server 409s a repeat action, this is just a UX pre-warning via title).
  const canActOnProductionJob = productionJob?.status === 'package_ready';
  const productionJobTerminal = productionJob?.status === 'approved' || productionJob?.status === 'rejected';

  const approveProductionJobTitle = !canApproveProductionJob
    ? 'Bu işlemi çalıştırmak için yetkiniz yok'
    : productionJobTerminal
      ? 'Bu üretim işi zaten sonuçlandırıldı'
      : !canActOnProductionJob
        ? 'Bu üretim işi şu an onaylanabilir durumda değil'
        : 'Bu üretim işini onayla';

  const rejectProductionJobTitle = !canRejectProductionJob
    ? 'Bu işlemi çalıştırmak için yetkiniz yok'
    : productionJobTerminal
      ? 'Bu üretim işi zaten sonuçlandırıldı'
      : !canActOnProductionJob
        ? 'Bu üretim işi şu an reddedilebilir durumda değil'
        : 'Bu üretim işini reddet';

  async function handleApproveProductionJob() {
    if (!productionJob) return;
    patch({ approvingProductionJob: true, approveProductionJobError: null });
    try {
      const res = await api.approveProductionJob(productionJob.id);
      setProductionJob(res.data);
    } catch (err: any) {
      patch({ approveProductionJobError: err.message ?? 'Onaylama başarısız oldu.' });
    } finally {
      patch({ approvingProductionJob: false });
    }
  }

  async function handleRejectProductionJob() {
    if (!productionJob) return;
    patch({ rejectingProductionJob: true, rejectProductionJobError: null });
    try {
      const res = await api.rejectProductionJob(productionJob.id, state.productionRejectReason.trim() || undefined);
      patch({ productionRejectReason: '', showProductionRejectInput: false });
      setProductionJob(res.data);
    } catch (err: any) {
      patch({ rejectProductionJobError: err.message ?? 'Reddetme işlemi başarısız oldu.' });
    } finally {
      patch({ rejectingProductionJob: false });
    }
  }

  // Render / export (Phase 2 Step 9A). The backend response is synchronous —
  // the returned RenderJob already reflects its final status ('rendered' or
  // 'failed') — so a single POST + one artifacts fetch is enough, no polling.
  const renderTitle = !canRender
    ? 'Bu işlemi çalıştırmak için yetkiniz yok'
    : 'Seçilen format ve boyutta bir export oluştur';

  async function handleRenderExport() {
    if (!productionJob) return;
    patch({ rendering: true, renderError: null });
    try {
      const res = await api.createRenderJob(productionJob.id, state.selectedPreset, state.selectedExportFormat);
      setRenderJob(res.data);
      setRenderArtifacts([]);
      try {
        await loadRenderHistory();
      } catch {
        // A transient history-refresh failure must not clobber the render
        // job that just succeeded above — same forgiving reasoning as the
        // artifact-listing follow-up fetch this replaces.
      }
    } catch (err: any) {
      patch({ renderError: err.message ?? 'Render işlemi başarısız oldu.' });
    } finally {
      patch({ rendering: false });
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
          {productionJob.packageSummary && (
            // Step 8C — compact, unobtrusive package summary line (version,
            // canvas size, target format(s), ready indicator). Derived from
            // `listProductionJobs`'s per-item packageSummary (see api.ts /
            // production-jobs.ts) — no extra fetch needed.
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              {productionJob.packageSummary.packageVersion != null && `v${productionJob.packageSummary.packageVersion}`}
              {productionJob.packageSummary.canvasSize &&
                ` · ${productionJob.packageSummary.canvasSize.width}×${productionJob.packageSummary.canvasSize.height}`}
              {productionJob.packageSummary.targetFormats?.length > 0 &&
                ` · ${productionJob.packageSummary.targetFormats.join(', ')}`}
              {' · '}
              <span className={`badge ${productionJob.packageSummary.packageReady ? 'badge-success' : 'badge-neutral'}`}>
                {productionJob.packageSummary.packageReady ? 'Paket Hazır' : 'Paket Bekliyor'}
              </span>
            </span>
          )}

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

          {/* Approve/reject are always rendered (never hidden), disabled + titled
              once the job is no longer package_ready — same idiom as every
              other action button in this file. */}
          <button
            className="btn btn-success btn-sm"
            disabled={!canApproveProductionJob || !canActOnProductionJob || state.approvingProductionJob}
            title={approveProductionJobTitle}
            onClick={handleApproveProductionJob}
          >
            {state.approvingProductionJob ? '⏳ Onaylanıyor...' : '✓ Onayla'}
          </button>

          {!state.showProductionRejectInput ? (
            <button
              className="btn btn-danger btn-sm"
              disabled={!canRejectProductionJob || !canActOnProductionJob || state.rejectingProductionJob}
              title={rejectProductionJobTitle}
              onClick={() => patch({ showProductionRejectInput: true })}
            >
              ✕ Reddet
            </button>
          ) : (
            <>
              <input
                type="text"
                className="form-input"
                placeholder="Red gerekçesi (opsiyonel)"
                value={state.productionRejectReason}
                onChange={(e) => patch({ productionRejectReason: e.target.value })}
                style={{ width: '200px' }}
                disabled={state.rejectingProductionJob}
              />
              <button
                className="btn btn-danger btn-sm"
                disabled={!canRejectProductionJob || !canActOnProductionJob || state.rejectingProductionJob}
                title={rejectProductionJobTitle}
                onClick={handleRejectProductionJob}
              >
                {state.rejectingProductionJob ? '⏳ Gönderiliyor...' : 'Gönder'}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                disabled={state.rejectingProductionJob}
                onClick={() => patch({ showProductionRejectInput: false, productionRejectReason: '' })}
              >
                Vazgeç
              </button>
            </>
          )}
        </div>
      )}

      {/* Render / export (Phase 2 Step 9A) — only makes sense once a package
          actually exists, same reasoning as why approve/reject only appear
          once productionJob itself exists; this whole feature section is
          absent (not a hidden button) for pending/packaging/failed/cancelled/
          rejected production jobs. */}
      {productionJob && (productionJob.status === 'package_ready' || productionJob.status === 'approved') && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Export:</span>
            <select
              className="form-select"
              style={{ width: 'auto' }}
              value={state.selectedPreset}
              onChange={(e) => patch({ selectedPreset: e.target.value })}
              disabled={state.rendering}
            >
              {RENDER_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
            <select
              className="form-select"
              style={{ width: 'auto' }}
              value={state.selectedExportFormat}
              onChange={(e) => patch({ selectedExportFormat: e.target.value })}
              disabled={state.rendering}
            >
              {EXPORT_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {format.toUpperCase()}
                </option>
              ))}
            </select>
            <button
              className="btn btn-primary btn-sm"
              disabled={!canRender || state.rendering}
              title={renderTitle}
              onClick={handleRenderExport}
            >
              {state.rendering ? '⏳ Render Ediliyor...' : '🎨 Render / Export Oluştur'}
            </button>

            {renderJob && (
              <span
                className={`badge ${(RENDER_JOB_STATUS_BADGES[renderJob.status] ?? { class: 'badge-neutral' }).class}`}
              >
                {(RENDER_JOB_STATUS_BADGES[renderJob.status] ?? { label: renderJob.status }).label}
              </span>
            )}

            {renderJob?.status === 'rendered' &&
              renderArtifacts.map((artifact) => (
                // Same API-origin resolution as the package/preview links above —
                // the export-artifacts file route is API-relative and protected
                // by the session cookie. Prefer the summary's own fileUrl (this
                // hotfix); fall back to the hand-built path if it's ever absent.
                <a
                  key={artifact.id}
                  className="btn btn-secondary btn-sm"
                  href={resolveApiFileUrl(artifact.fileUrl ?? `/api/export-artifacts/${artifact.id}/file`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  ⬇ {artifact.format.toUpperCase()} İndir
                </a>
              ))}
          </div>

          {/* Render history (this hotfix) — compact, muted list of up to the
              last 3 OLDER renders (the latest one is already shown in the row
              above), newest-first. Hydrated by loadRenderHistory; see the
              renderHistory state and its hydration effect above. Not a
              redesign — same small/muted-text vocabulary as the other
              secondary lines in this card. */}
          {renderHistory.length > 1 && (
            <div style={{ marginTop: '8px' }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
                {'Önceki render işlemleri:'}
              </p>
              {renderHistory
                .slice(0, -1)
                .slice(-3)
                .reverse()
                .map((job) => {
                  const historyBadge =
                    RENDER_JOB_STATUS_BADGES[job.status] ?? { class: 'badge-neutral', label: job.status };
                  return (
                    <div
                      key={job.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        flexWrap: 'wrap',
                        fontSize: '0.75rem',
                        color: 'var(--color-text-muted)',
                        marginBottom: '4px',
                      }}
                    >
                      <span>
                        {job.requestedFormat?.preset} · {job.requestedFormat?.exportFormat?.toUpperCase()}
                      </span>
                      <span className={`badge ${historyBadge.class}`}>{historyBadge.label}</span>
                      <span>{new Date(job.createdAt).toLocaleString()}</span>
                      {(job.artifactSummaries ?? []).map((artifact: any) => (
                        <a
                          key={artifact.id}
                          href={resolveApiFileUrl(artifact.fileUrl ?? `/api/export-artifacts/${artifact.id}/file`)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          ⬇ {artifact.format.toUpperCase()}
                        </a>
                      ))}
                      {job.status === 'failed' && job.errorMessage && (
                        <span style={{ color: 'var(--color-danger, #f87171)' }}>⚠ {job.errorMessage}</span>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </>
      )}

      {renderJob?.status === 'failed' && (
        <ErrorNote message={renderJob.errorMessage ?? 'Render işlemi başarısız oldu.'} />
      )}
      <ErrorNote message={state.renderError} />

      {productionJob?.status === 'rejected' && productionJob.rejectionReason && (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '4px' }}>
          Red gerekçesi: {productionJob.rejectionReason}
        </p>
      )}

      {productionJob?.status === 'failed' && (
        <ErrorNote message={productionJob.errorMessage ?? 'Üretim paketleme başarısız oldu.'} />
      )}
      <ErrorNote message={state.sendToProductionError} />
      <ErrorNote message={state.approveError} />
      <ErrorNote message={state.rejectError} />
      <ErrorNote message={state.approveProductionJobError} />
      <ErrorNote message={state.rejectProductionJobError} />
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
