'use client';

// Grafista AI Studio — Analytics Summary Panel (Phase 3 Step 6A)
//
// Fetches GET /api/clients/:id/analytics/summary and renders it with the
// EXISTING `.stats-grid`/`.stat-card` CSS classes (see
// apps/dashboard/src/app/clients/[id]/page.tsx) — no new CSS is introduced.
// A plain "Son Aktiviteler" list follows, one short Turkish sentence per
// event. Errors (e.g. a 403/404 for a user without analytics:read, or the
// client isolation guard) render a generic, safe message — no endpoint or
// permission internals are leaked.

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface RecentActivityItem {
  eventType: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

interface AnalyticsSummary {
  totalEvents: number;
  visualGenerationSucceeded: number;
  visualGenerationFailed: number;
  productionPackagesCreated: number;
  productionApproved: number;
  productionRejected: number;
  renderJobsRendered: number;
  renderJobsFailed: number;
  exportArtifactDownloads: number;
  recentActivity: RecentActivityItem[];
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  creative_qa_approved: 'Kalite kontrolü onaylandı',
  visual_generation_succeeded: 'Görsel üretimi tamamlandı',
  visual_generation_failed: 'Görsel üretimi başarısız oldu',
  production_package_created: 'Üretim paketi oluşturuldu',
  production_job_approved: 'Üretim işi onaylandı',
  production_job_rejected: 'Üretim işi reddedildi',
  render_job_queued: 'Render işi kuyruğa alındı',
  render_job_rendered: 'Render işi tamamlandı',
  render_job_failed: 'Render işi başarısız oldu',
  render_job_cancelled: 'Render işi iptal edildi',
  export_artifact_downloaded: 'Export dosyası indirildi',
};

function describeActivity(item: RecentActivityItem): string {
  return EVENT_TYPE_LABELS[item.eventType] ?? item.eventType;
}

export function AnalyticsSummaryPanel({ clientId }: { clientId: string }) {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    api
      .getClientAnalyticsSummary(clientId)
      .then((res) => {
        if (!cancelled) setSummary(res.data);
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
    return <div className="card" style={{ marginTop: '24px' }}>Özet bilgisi yükleniyor...</div>;
  }

  if (error || !summary) {
    return (
      <div className="card" style={{ marginTop: '24px' }}>
        <div className="card-title">📊 Analitik Özet</div>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
          Özet bilgisi şu anda görüntülenemiyor.
        </p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: '24px' }}>
      <div className="card-title" style={{ marginBottom: '12px' }}>📊 Analitik Özet</div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{summary.visualGenerationSucceeded}</div>
          <div className="stat-label">Üretilen Görseller</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{summary.visualGenerationFailed}</div>
          <div className="stat-label">Başarısız Görsel Üretimleri</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{summary.productionPackagesCreated}</div>
          <div className="stat-label">Üretim Paketleri</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{summary.renderJobsRendered}</div>
          <div className="stat-label">Render Edilen</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{summary.renderJobsFailed}</div>
          <div className="stat-label">Render Hataları</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{summary.exportArtifactDownloads}</div>
          <div className="stat-label">İndirilen Export Dosyaları</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: '16px' }}>
        <div className="card-title" style={{ marginBottom: '8px' }}>Son Aktiviteler</div>
        {summary.recentActivity.length === 0 ? (
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>Henüz aktivite yok.</p>
        ) : (
          <ul style={{ paddingLeft: '20px', margin: 0 }}>
            {summary.recentActivity.map((item, i) => (
              <li key={`${item.entityId}-${i}`} style={{ fontSize: '0.9rem', marginBottom: '4px' }}>
                {describeActivity(item)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
