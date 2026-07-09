'use client';

/**
 * Grafista AI Studio — Product Gallery card ("Çıktı Geçmişi" / /outputs page).
 *
 * Self-contained, READ-ONLY presentational card for one render job (a single
 * rendered artifact request against a generated visual output). No fetching,
 * no mutations — every value it needs is passed in as props by the gallery
 * page, which does the aggregation across clients/layout-plans/outputs/
 * production-jobs/render-jobs.
 *
 * Deliberately does NOT import from visual-outputs-panel.tsx (per the task
 * constraint that file stays untouched) — the small status-badge map below is
 * a verbatim copy of that file's RENDER_JOB_STATUS_BADGES so the two surfaces
 * stay visually consistent without a shared import.
 */

import { resolveApiFileUrl } from '@/lib/api';

// Render job lifecycle (Phase 2 Step 9A; 'queued' added in Phase 3 Step 5A) —
// copied verbatim from visual-outputs-panel.tsx's RENDER_JOB_STATUS_BADGES.
// See packages/schemas/src/render-job.ts's RenderJobStatusEnum for the source
// of truth this mirrors.
const RENDER_JOB_STATUS_BADGES: Record<string, { class: string; label: string }> = {
  pending: { class: 'badge-warning', label: 'Bekliyor' },
  queued: { class: 'badge-warning', label: 'Sırada' },
  rendering: { class: 'badge-info', label: 'Render Alınıyor' },
  rendered: { class: 'badge-success', label: 'Render Hazır' },
  failed: { class: 'badge-danger', label: 'Hata Oluştu' },
  cancelled: { class: 'badge-neutral', label: 'İptal edildi' },
};

// Same small human-readable file-size helper as visual-outputs-panel.tsx's
// formatFileSize — copied rather than imported for the same reason as the
// badge map above.
function formatFileSize(bytes: unknown): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function GalleryOutputCard({
  renderJob,
  output,
  clientName,
  briefTitle,
  campaignName,
}: {
  renderJob: any;
  // The generated visual output (GeneratedOutput) this render job was
  // produced from — used as a fallback preview image and for
  // alternativeIndex when no export artifact exists yet.
  output?: any | null;
  clientName?: string | null;
  briefTitle?: string | null;
  // Display-only label if the caller has one — this codebase has no
  // projects/campaigns entity, so this is never more than a cosmetic string.
  campaignName?: string | null;
}) {
  // A render job can, in principle, produce more than one artifact — the
  // gallery only ever shows the first/primary one (same "MVP" simplicity as
  // the rest of this read-only card).
  const artifact = renderJob?.artifactSummaries?.[0] ?? null;

  // Prefer the actual rendered export; fall back to the upstream generated
  // output's own preview/file (e.g. while a render is still queued/rendering
  // and no artifact exists yet). Both are API-relative protected routes, so
  // both must go through resolveApiFileUrl — same reasoning documented there.
  const imagePath = artifact?.fileUrl ?? output?.previewUrl ?? output?.fileUrl ?? null;
  const imageSrc = imagePath ? resolveApiFileUrl(imagePath) : null;

  const statusInfo =
    RENDER_JOB_STATUS_BADGES[renderJob?.status] ?? { class: 'badge-neutral', label: renderJob?.status ?? 'Bilinmiyor' };

  const format = (artifact?.format ?? renderJob?.requestedFormat?.exportFormat ?? null) as string | null;
  const width = artifact?.width ?? renderJob?.requestedFormat?.width ?? null;
  const height = artifact?.height ?? renderJob?.requestedFormat?.height ?? null;
  const dimensionsLabel =
    format && width && height ? `${format.toUpperCase()} · ${width}×${height}` : format ? format.toUpperCase() : null;

  const sizeLabel = formatFileSize(artifact?.sizeBytes);

  const cardTitle = briefTitle || `Görsel Alternatif ${output?.alternativeIndex ?? '—'}`;

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title" title={cardTitle}>
          {cardTitle}
        </div>
        <span className={`badge ${statusInfo.class}`}>{statusInfo.label}</span>
      </div>

      {imageSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- generated asset URLs come from arbitrary storage providers; next/image domain allowlisting is not configured for them
        <img
          src={imageSrc}
          alt={cardTitle}
          style={{
            width: '100%',
            height: '200px',
            objectFit: 'contain',
            borderRadius: '8px',
            background: 'var(--color-bg-glass)',
            marginBottom: '10px',
          }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '200px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '8px',
            background: 'var(--color-bg-glass)',
            marginBottom: '10px',
            color: 'var(--color-text-muted)',
            fontSize: '0.8rem',
            textAlign: 'center',
            padding: '8px',
          }}
        >
          {renderJob?.status === 'failed' ? 'Render başarısız olduğu için önizleme yok.' : 'Önizleme henüz hazır değil.'}
        </div>
      )}

      <div className="tag-list" style={{ marginBottom: '10px' }}>
        {dimensionsLabel && <span className="tag tag-accent">{dimensionsLabel}</span>}
        {sizeLabel && <span className="tag">{sizeLabel}</span>}
        {renderJob?.createdAt && <span className="tag">{new Date(renderJob.createdAt).toLocaleString()}</span>}
      </div>

      <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '10px' }}>
        {clientName ?? 'Bilinmeyen müşteri'}
        {campaignName ? ` · ${campaignName}` : ''}
      </p>

      {renderJob?.status === 'failed' && renderJob?.errorMessage && (
        <p
          style={{ fontSize: '0.75rem', color: 'var(--color-danger, #f87171)', marginBottom: '10px', overflowWrap: 'anywhere' }}
          title={renderJob.errorMessage}
        >
          ⚠ {renderJob.errorMessage}
        </p>
      )}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <a
          className="btn btn-secondary btn-sm"
          href={imageSrc ?? undefined}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!imageSrc}
          title={imageSrc ? 'Görseli yeni sekmede aç' : 'Henüz gösterilecek bir görsel yok'}
          style={!imageSrc ? { pointerEvents: 'none', opacity: 0.5 } : undefined}
        >
          👁 Önizle/Aç
        </a>
        <a
          className="btn btn-primary btn-sm"
          href={artifact ? resolveApiFileUrl(artifact.fileUrl) : undefined}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!artifact}
          title={artifact ? 'Dosyayı indir' : 'Bu render için henüz indirilebilir bir dosya yok'}
          style={!artifact ? { pointerEvents: 'none', opacity: 0.5 } : undefined}
        >
          ⬇ İndir
        </a>
      </div>
    </div>
  );
}
