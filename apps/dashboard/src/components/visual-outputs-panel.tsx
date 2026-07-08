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
 * no approved/passed CreativeQA report exists); the `creativeQaApproved` prop
 * is only an early-warning UX hint, never a bypass.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, friendlyAiErrorMessage, pollRenderJob, resolveApiFileUrl, TERMINAL_RENDER_JOB_STATUSES } from '@/lib/api';

const OUTPUT_STATUS_BADGES: Record<string, { class: string; label: string }> = {
  pending: { class: 'badge-warning', label: 'Bekliyor' },
  generated: { class: 'badge-success', label: 'Görsel Üretildi' },
  failed: { class: 'badge-danger', label: 'Hata Oluştu' },
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
  pending: { class: 'badge-warning', label: 'Bekliyor' },
  packaging: { class: 'badge-info', label: 'Paketleniyor' },
  package_ready: { class: 'badge-success', label: 'Üretim Paketi Hazır' },
  failed: { class: 'badge-danger', label: 'Hata Oluştu' },
  cancelled: { class: 'badge-neutral', label: 'İptal Edildi' },
  approved: { class: 'badge-success', label: 'Onaylandı' },
  rejected: { class: 'badge-danger', label: 'Reddedildi' },
};

// Render job lifecycle (Phase 2 Step 9A; 'queued' added in Phase 3 Step 5A —
// see packages/schemas/src/render-job.ts's RenderJobStatusEnum). No
// 'approved'/'rejected' states here — a render is a downstream,
// already-approved-upstream artifact request, not another human approval
// gate. 'queued' only ever appears when the backend's render queue is
// enabled (RENDER_QUEUE_ENABLED) — a sync-mode render never rests in that
// state long enough to be observed.
const RENDER_JOB_STATUS_BADGES: Record<string, { class: string; label: string }> = {
  pending: { class: 'badge-warning', label: 'Bekliyor' },
  queued: { class: 'badge-warning', label: 'Sırada' },
  rendering: { class: 'badge-info', label: 'Render Alınıyor' },
  rendered: { class: 'badge-success', label: 'Render Hazır' },
  failed: { class: 'badge-danger', label: 'Hata Oluştu' },
  cancelled: { class: 'badge-neutral', label: 'İptal edildi' },
};

// Render quality warnings (Phase 2 Step 9B) — see RenderJob.renderWarnings in
// packages/schemas/src/render-job.ts. Persisted warnings created before this
// field existed lack `severity` entirely; every lookup below must treat a
// missing severity as 'warning'.
const RENDER_WARNING_SEVERITY_BADGES: Record<string, { class: string; label: string }> = {
  error: { class: 'badge-danger', label: 'Hata' },
  warning: { class: 'badge-warning', label: 'Uyarı' },
  info: { class: 'badge-info', label: 'Bilgi' },
};

// Warning code → Turkish label. Unmapped codes fall back to the raw code.
const RENDER_WARNING_CODE_LABELS: Record<string, string> = {
  font_fallback: 'Font fallback kullanıldı',
  text_overflow_possible: 'Metin taşma riski',
  safe_area_warning: 'Güvenli alan uyarısı',
  safe_area_unavailable: 'Güvenli alan tanımsız',
  missing_image_source: 'Görsel kaynağı eksik',
  low_resolution_image_possible: 'Düşük çözünürlük riski',
  unsupported_filter: 'Filtre desteklenmiyor',
  unsupported_blend_mode: 'Karışım modu desteklenmiyor',
  invalid_color: 'Geçersiz renk düzeltildi',
  invalid_font_weight: 'Geçersiz font kalınlığı',
  unsupported_layer_type: 'Desteklenmeyen katman türü',
  anchor_ignored: 'Hizalama noktası yok sayıldı',
  // Phase 3 Step 1 — generated visual composition (F8 fix).
  selected_visual_loaded: 'Üretilen görsel yerleştirildi',
  selected_visual_missing: 'Seçili görsel bulunamadı',
  selected_visual_storage_missing: 'Görsel depodan okunamadı',
  selected_visual_aspect_mismatch: 'Görsel/slot oran farkı',
  // image_slot_missing is no longer emitted (replaced by full_canvas_visual_fallback
  // below) but kept so historical render_jobs rows still show a Turkish label.
  image_slot_missing: 'Görsel alanı bulunamadı',
  image_slot_unmapped: 'Bazı görsel alanları eşleşmedi',
  // Phase 2 render fix (Option A) — full-canvas visual fallback.
  full_canvas_visual_fallback: 'Görsel tam ekran yerleştirildi',
  full_canvas_visual_invalid: 'Tam ekran görsel geçersiz',
  // Reserved for a future backend warning code — kept mapped defensively so a
  // Turkish label is ready the day it starts being emitted (harmless unused
  // key otherwise, no backend contract implied).
  placeholder_used: 'Placeholder kullanıldı',
};

// Render presets/formats (Phase 2 Step 9A) — mirrors RenderPresetEnum /
// ExportFormatEnum in packages/schemas/src/render-job.ts exactly. Hardcoded
// here rather than fetched since the dashboard doesn't import @grafista/schemas.
//
// allowedFormats (Phase 2 Step 9B, additive) mirrors RENDER_PRESET_METADATA in
// packages/schemas/src/render-job.ts — the backend now 400s any preset/format
// combination outside this list, so the UI must never offer one. The old flat
// EXPORT_FORMATS list is gone; every format <select> now derives its options
// from the currently selected preset's own allowedFormats instead.
const RENDER_PRESETS: Array<{ value: string; label: string; allowedFormats: string[] }> = [
  { value: 'instagram_post', label: 'Instagram Post (1080×1080)', allowedFormats: ['png', 'jpg'] },
  { value: 'instagram_story', label: 'Story (1080×1920)', allowedFormats: ['png', 'jpg'] },
  { value: 'landscape', label: 'Landscape (1920×1080)', allowedFormats: ['png', 'jpg', 'pdf'] },
  { value: 'ad_creative', label: 'Ad Creative (1200×628)', allowedFormats: ['png', 'jpg', 'pdf'] },
];

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p style={{ color: 'var(--color-danger, #f87171)', fontSize: '0.85rem', marginTop: '8px' }}>
      ⚠ {message}
    </p>
  );
}

// Kapsam 5 — small human-readable file size for artifact download links
// (e.g. "1.3 MB"). Returns null for anything not a positive finite number so
// callers can just skip rendering the size instead of showing "NaN undefined".
function formatFileSize(bytes: unknown): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// F6 fix: raw AI-provider/renderer error text (English, technical — e.g.
// "All 3 attempts failed: Kie AI createTask failed (code=500)...") is
// intimidating in an otherwise Turkish demo UI. This shows a short Turkish
// summary up front and tucks the full raw text behind a native <details>
// disclosure (no modal/dialog framework, just semantic HTML) so ops can still
// get the exact string when they need it.
function friendlyErrorSummary(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('kie_ai_api_key') || lower.includes('kie_ai_base_url'))
    return 'Görsel sağlayıcı yapılandırılmamış.';
  if (lower.includes('configuration error') || lower.includes('is not set') || lower.includes('no provider available'))
    return 'API anahtarı eksik veya geçersiz.';
  if (lower.includes('rate limit') || lower.includes('too many requests'))
    return 'AI sağlayıcı şu an yoğun — kısa bir süre sonra tekrar deneyin.';
  if (lower.includes('schema validation')) return 'AI yanıtı beklenen formatta dönmedi, tekrar denenebilir.';
  if (lower.includes('provider') || lower.includes('createtask') || lower.includes('attempts failed') || lower.includes('ai response'))
    return 'Provider geçici olarak yanıt vermedi. Tekrar deneyebilirsiniz.';
  return 'Bir hata oluştu.';
}

function ProviderErrorNote({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div style={{ marginTop: '8px' }}>
      <p style={{ color: 'var(--color-danger, #f87171)', fontSize: '0.85rem', marginBottom: '4px' }}>
        ⚠ {friendlyErrorSummary(message)}
      </p>
      <details style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
        <summary style={{ cursor: 'pointer' }}>Teknik detayı göster</summary>
        <p style={{ marginTop: '4px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message}</p>
      </details>
    </div>
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
  // Render cancel (Phase 3 Step 5A).
  cancellingRender: boolean;
  cancelRenderError: string | null;
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
    cancellingRender: false,
    cancelRenderError: null,
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
  const canCancelRender = permissions.includes('render_jobs:cancel');

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

  // Render job polling (Phase 3 Step 5A) — only while the LATEST render job
  // is non-terminal (queued/rendering/pending); a sync-mode render already
  // comes back terminal so this never even starts a timer in that case.
  // Stops itself as soon as the job reaches a terminal status (see
  // pollRenderJob in lib/api.ts) — no big polling framework, just one
  // setInterval-equivalent per card while it's actually needed.
  useEffect(() => {
    if (!renderJob?.id || TERMINAL_RENDER_JOB_STATUSES.has(renderJob.status)) return;
    const stop = pollRenderJob(renderJob.id, (updated) => {
      setRenderJob(updated);
      if (TERMINAL_RENDER_JOB_STATUSES.has(updated?.status)) {
        // Refresh artifacts/history once the job actually finished.
        loadRenderHistory().catch(() => {});
      }
    });
    return stop;
  }, [renderJob?.id, renderJob?.status, loadRenderHistory]);

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

  // Preset/format policy (Phase 2 Step 9B) — the export-format <select> below
  // only ever offers the currently selected preset's allowed formats, so the
  // user can never construct a combination the backend would now 400 on.
  const selectedPresetConfig = RENDER_PRESETS.find((preset) => preset.value === state.selectedPreset) ?? RENDER_PRESETS[0];
  const allowedExportFormats = selectedPresetConfig.allowedFormats;

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

  // Render cancel (Phase 3 Step 5A). Only shown for a non-terminal renderJob
  // (queued/pending -> cancelled immediately server-side; rendering ->
  // cancellation requested, the polling effect above picks up the eventual
  // 'cancelled' status once the worker observes it).
  const canCancelThisRender = renderJob != null && !TERMINAL_RENDER_JOB_STATUSES.has(renderJob.status);
  const cancelRenderTitle = !canCancelRender
    ? 'Bu işlemi çalıştırmak için yetkiniz yok'
    : renderJob?.status === 'rendering'
      ? 'Render devam ediyor — iptal isteği bir sonraki kontrolde uygulanır'
      : 'Bu render işlemini iptal et';

  async function handleCancelRender() {
    if (!renderJob?.id) return;
    patch({ cancellingRender: true, cancelRenderError: null });
    try {
      const res = await api.cancelRenderJob(renderJob.id);
      setRenderJob(res.data);
    } catch (err: any) {
      patch({ cancelRenderError: err.message ?? 'İptal işlemi başarısız oldu.' });
    } finally {
      patch({ cancellingRender: false });
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
          // F5 fix: 'none' is the model router's literal placeholder for "no
          // model was actually reached" on a total-failure response — never a
          // real model name, so it must never be displayed as one.
          <span className="tag tag-accent">
            {output.provider}
            {output.aiModel && output.aiModel !== 'none' ? ` / ${output.aiModel}` : ''}
          </span>
        )}
        {output.dimensions?.width && output.dimensions?.height && (
          <span className="tag">{output.dimensions.width} × {output.dimensions.height}</span>
        )}
        {output.mimeType && <span className="tag">{output.mimeType}</span>}
        {output.createdAt && <span className="tag">{new Date(output.createdAt).toLocaleString()}</span>}
      </div>

      {output.status === 'failed' && <ProviderErrorNote message={output.errorMessage} />}

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

      {/* Stage-clarity hint (Phase 2 Step 10): derived from state this card
          already loads — no extra fetch, no restructuring. */}
      {output.status === 'generated' && !productionJob && (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '4px' }}>
          Sıradaki adım: Üretime gönder
        </p>
      )}

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

      {/* Stage-clarity hint (Phase 2 Step 10) — same derivation note as above. */}
      {productionJob?.status === 'package_ready' && (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '4px' }}>
          Sıradaki adım: Paketi onayla veya render/export al
        </p>
      )}

      {/* Kapsam 2/3 — the render/export section below is entirely absent
          (never a hidden-but-disabled button) for pending/packaging/failed/
          cancelled/rejected production jobs. Without this line that silence
          reads as "the render feature disappeared"; this explains WHY. */}
      {productionJob && !['package_ready', 'approved'].includes(productionJob.status) && (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '4px' }}>
          {productionJob.status === 'pending' || productionJob.status === 'packaging'
            ? 'Render/export almak için üretim paketinin hazır olması gerekir.'
            : productionJob.status === 'rejected'
              ? 'Bu üretim işi reddedildiği için render/export alınamaz.'
              : productionJob.status === 'cancelled'
                ? 'Bu üretim işi iptal edildiği için render/export alınamaz.'
                : 'Bu üretim işi hata ile sonuçlandığı için render/export alınamaz.'}
        </p>
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
              onChange={(e) => {
                // Preset/format policy (Phase 2 Step 9B): switching preset can
                // narrow the allowed formats — if the currently selected
                // format is no longer valid for the new preset, fall back to
                // 'png' (always allowed) in the same patch so the UI can never
                // hold a combination the backend would reject.
                const nextPreset = RENDER_PRESETS.find((preset) => preset.value === e.target.value) ?? RENDER_PRESETS[0];
                const formatStillAllowed = nextPreset.allowedFormats.includes(state.selectedExportFormat);
                patch({
                  selectedPreset: nextPreset.value,
                  selectedExportFormat: formatStillAllowed ? state.selectedExportFormat : 'png',
                });
              }}
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
              {allowedExportFormats.map((format) => (
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
                {renderJob.status === 'rendering' && renderJob.cancellationRequested ? ' (iptal isteniyor)' : ''}
              </span>
            )}

            {canCancelThisRender && (
              <button
                className="btn btn-danger btn-sm"
                disabled={!canCancelRender || state.cancellingRender || (renderJob.status === 'rendering' && renderJob.cancellationRequested)}
                title={cancelRenderTitle}
                onClick={handleCancelRender}
              >
                {state.cancellingRender
                  ? '⏳ İptal Ediliyor...'
                  : renderJob.status === 'rendering'
                    ? renderJob.cancellationRequested
                      ? 'İptal İstendi'
                      : 'İptal İste'
                    : 'İptal Et'}
              </button>
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
                  title={`${artifact.width ?? '?'}×${artifact.height ?? '?'}${formatFileSize(artifact.sizeBytes) ? ` · ${formatFileSize(artifact.sizeBytes)}` : ''}`}
                >
                  ⬇ {artifact.format.toUpperCase()} İndir
                  {formatFileSize(artifact.sizeBytes) && (
                    <span style={{ opacity: 0.75 }}> ({formatFileSize(artifact.sizeBytes)})</span>
                  )}
                </a>
              ))}
          </div>

          {/* Kapsam 5 — before the very first render request, tell the user
              where the download will appear instead of leaving a silent gap.
              Once a renderJob exists its own status badge/error note already
              covers 'rendering'/'failed', so this hint steps aside then. */}
          {!renderJob && (
            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '6px' }}>
              Render tamamlanınca indirme linki burada görünecek.
            </p>
          )}

          {/* Latest render's quality warnings (Phase 2 Step 9B) — compact,
              non-collapsing list (renderWarnings is short, ≤ ~6 entries in
              practice). Same small/muted-text vocabulary as the render
              history list below. Missing severity (pre-9B persisted rows)
              is treated as 'warning'. */}
          {renderJob?.renderWarnings?.length > 0 && (
            <div style={{ marginTop: '8px' }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
                {`Render uyarıları (${renderJob.renderWarnings.length})`}
              </p>
              {renderJob.renderWarnings.map((warning: any, index: number) => {
                const severity = warning.severity ?? 'warning';
                const severityBadge = RENDER_WARNING_SEVERITY_BADGES[severity] ?? RENDER_WARNING_SEVERITY_BADGES.warning;
                const codeLabel = RENDER_WARNING_CODE_LABELS[warning.code] ?? warning.code;
                return (
                  <div
                    key={`${warning.code}-${warning.layerId ?? index}`}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '6px',
                      flexWrap: 'wrap',
                      fontSize: '0.75rem',
                      color: 'var(--color-text-muted)',
                      marginBottom: '6px',
                    }}
                  >
                    <span className={`badge ${severityBadge.class}`}>{severityBadge.label}</span>
                    <span style={{ flexShrink: 0 }}>{codeLabel}</span>
                    {/* F7 fix: no more mid-sentence truncation — the full
                        message now wraps onto multiple lines instead of
                        being clipped with an ellipsis. */}
                    <span style={{ overflowWrap: 'anywhere', whiteSpace: 'normal', flex: '1 1 260px' }}>
                      {warning.message}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

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
                      {job.renderWarnings?.length > 0 && (
                        // Count only (Phase 2 Step 9B) — per-warning detail is
                        // only shown for the latest render, above.
                        <span>⚠ {job.renderWarnings.length} uyarı</span>
                      )}
                      {(job.artifactSummaries ?? []).map((artifact: any) => (
                        <a
                          key={artifact.id}
                          href={resolveApiFileUrl(artifact.fileUrl ?? `/api/export-artifacts/${artifact.id}/file`)}
                          target="_blank"
                          rel="noreferrer"
                          title={formatFileSize(artifact.sizeBytes) ?? undefined}
                        >
                          ⬇ {artifact.format.toUpperCase()} İndir
                        </a>
                      ))}
                      {job.status === 'failed' && job.errorMessage && (
                        // F6 fix: short Turkish summary in the compact history
                        // line, full raw text still available on hover.
                        <span style={{ color: 'var(--color-danger, #f87171)' }} title={job.errorMessage}>
                          ⚠ {friendlyErrorSummary(job.errorMessage)}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </>
      )}

      {renderJob?.status === 'failed' && (
        <ProviderErrorNote message={renderJob.errorMessage ?? 'Render işlemi başarısız oldu.'} />
      )}
      <ErrorNote message={state.renderError} />
      <ErrorNote message={state.cancelRenderError} />

      {productionJob?.status === 'rejected' && productionJob.rejectionReason && (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '4px' }}>
          Red gerekçesi: {productionJob.rejectionReason}
        </p>
      )}

      {productionJob?.status === 'failed' && (
        <ProviderErrorNote message={productionJob.errorMessage ?? 'Üretim paketleme başarısız oldu.'} />
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
        ? (err.message ?? 'Görsel üretmek için Creative QA raporunun onaylı veya geçmiş (passed) olması gerekir.')
        : err.status === 502
          ? `${friendlyAiErrorMessage(err, 'Görsel üretim başlatılamadı.')} Başarısız deneme kayıt altına alındı.`
          : (err.message ?? 'Görsel üretim başlatılamadı.');
      setGenerateError(message);
    } finally {
      setGenerating(false);
    }
  }

  const generateTitle = !canRun
    ? 'Bu işlemi çalıştırmak için yetkiniz yok'
    : !creativeQaApproved
      ? 'Görsel üretmek için Creative QA raporunun onaylı veya geçmiş (passed) olması gerekir'
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
          Görsel üretmek için Creative QA raporunun onaylı veya geçmiş (passed) olması gerekir.
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
