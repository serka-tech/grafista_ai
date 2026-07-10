'use client';

/**
 * Grafista AI Studio — Product Gallery ("Çıktı Geçmişi" / /outputs).
 *
 * Read-only, client-side aggregated view of every render job across every
 * client this user can see. There is no single backend endpoint for "all
 * rendered outputs" yet, so this page fans out through the existing
 * per-entity list endpoints (see lib/api.ts):
 *
 *   getClients()
 *     -> getLayoutPlansForClient(client.id)
 *       -> listVisualOutputs(layoutPlan.id)
 *         -> listProductionJobs(output.id)
 *           -> listRenderJobsForProductionJob(productionJob.id)
 *
 * plus one getDesignBriefs() call (unscoped by client on the backend) used
 * only as an id -> brief lookup for titles/status labels. Client isolation is
 * preserved because the brief map is only ever read for clientIds that
 * already came out of the properly-scoped getClients() list — a client this
 * user cannot see never gets a section rendered, regardless of what
 * getDesignBriefs() itself returns.
 *
 * Every level of the fan-out is wrapped in its own try/catch and simply skips
 * on failure (empty array) rather than throwing — mirrors this codebase's
 * "one transient failure must not break the UI" idiom used throughout
 * visual-outputs-panel.tsx and lib/api.ts's pollRenderJob. A 403 on any one
 * client's layout plans (or any deeper level) just means that piece of the
 * gallery stays empty, never a blank page.
 *
 * Purely read-only: no approve/reject/render-trigger/delete action lives
 * here — see visual-outputs-panel.tsx (a layout plan's own page) for those.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { GalleryOutputCard } from '@/components/gallery-output-card';

// Design brief status badges — copied verbatim from
// apps/dashboard/src/app/briefs/[id]/page.tsx's BRIEF_STATUS_BADGES, used
// only for the per-client "no render yet" note below (a client that has
// briefs but nothing rendered still shows where its pipeline stands instead
// of a silent gap).
const BRIEF_STATUS_BADGES: Record<string, { class: string; label: string }> = {
  draft: { class: 'badge-neutral', label: 'Taslak' },
  in_progress: { class: 'badge-info', label: 'Devam Ediyor' },
  qa_pending: { class: 'badge-warning', label: 'Kalite Kontrolü Bekliyor' },
  qa_passed: { class: 'badge-info', label: 'Kalite Kontrolünden Geçti' },
  approved: { class: 'badge-success', label: 'Onaylandı' },
  exported: { class: 'badge-success', label: 'Dışa Aktarıldı' },
  rejected: { class: 'badge-danger', label: 'Reddedildi' },
  needs_revision: { class: 'badge-danger', label: 'Revizyon Gerekiyor' },
};

type GalleryEntry = {
  output: any;
  renderJob: any;
  brief: any | null;
};

type ClientGroup = {
  client: any;
  entries: GalleryEntry[]; // newest render job first
  briefs: any[]; // this client's design briefs (for the "no render yet" note)
};

export default function OutputsPage() {
  const [groups, setGroups] = useState<ClientGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Optional `?client=<id>` filter (Slice 2 — client hub "Tümü →" link).
  // Read from window.location.search inside an effect rather than Next's
  // useSearchParams(): this page is 'use client' and otherwise statically
  // prerenderable, and useSearchParams() would force build-time errors
  // unless wrapped in <Suspense>. Reading window.location post-mount avoids
  // that entirely and keeps the page's existing static-friendly shape. SSR/
  // first client render both start from null (window is undefined during any
  // static render), so there is no hydration mismatch — the filter simply
  // applies a tick after mount, same as this page's existing "loading" flash.
  const [filterClientId, setFilterClientId] = useState<string | null>(null);

  const loadGallery = useCallback(async () => {
    // Brief lookup (id -> brief) — used only for display labels. A failure
    // here must not blank the gallery, it just means cards fall back to
    // "Görsel Alternatif N" instead of the brief's own title.
    const briefsById = new Map<string, any>();
    try {
      const briefsRes = await api.getDesignBriefs();
      for (const brief of briefsRes.data ?? []) briefsById.set(brief.id, brief);
    } catch {
      // Keep the empty map — see note above.
    }

    // getClients() is the client-isolation boundary: a scoped viewer only
    // ever sees their own clients here, and every nested fetch below is
    // driven off THIS list's ids, never off the (unscoped) brief map.
    const clientsRes = await api.getClients();
    const clients = clientsRes.data ?? [];

    const clientGroups = await Promise.all(
      clients.map(async (client: any): Promise<ClientGroup> => {
        const clientBriefs = Array.from(briefsById.values()).filter((brief) => brief.clientId === client.id);

        let layoutPlans: any[] = [];
        try {
          const res = await api.getLayoutPlansForClient(client.id);
          layoutPlans = res.data ?? [];
        } catch {
          layoutPlans = [];
        }

        const perPlanEntries = await Promise.all(
          layoutPlans.map(async (layoutPlan: any): Promise<GalleryEntry[]> => {
            let outputs: any[] = [];
            try {
              const res = await api.listVisualOutputs(layoutPlan.id);
              outputs = res.data ?? [];
            } catch {
              outputs = [];
            }

            const perOutputEntries = await Promise.all(
              outputs.map(async (output: any): Promise<GalleryEntry[]> => {
                let productionJobs: any[] = [];
                try {
                  const res = await api.listProductionJobs(output.id);
                  productionJobs = res.data ?? [];
                } catch {
                  productionJobs = [];
                }

                const perJobEntries = await Promise.all(
                  productionJobs.map(async (productionJob: any): Promise<GalleryEntry[]> => {
                    let renderJobs: any[] = [];
                    try {
                      const res = await api.listRenderJobsForProductionJob(productionJob.id);
                      renderJobs = res.data ?? [];
                    } catch {
                      renderJobs = [];
                    }

                    return renderJobs.map((renderJob) => ({
                      output,
                      renderJob,
                      brief: briefsById.get(output.designBriefId ?? layoutPlan.designBriefId) ?? null,
                    }));
                  })
                );

                return perJobEntries.flat();
              })
            );

            return perOutputEntries.flat();
          })
        );

        const entries = perPlanEntries.flat().sort((a, b) => {
          const aTime = new Date(a.renderJob.createdAt ?? 0).getTime();
          const bTime = new Date(b.renderJob.createdAt ?? 0).getTime();
          return bTime - aTime; // newest first
        });

        return { client, entries, briefs: clientBriefs };
      })
    );

    setGroups(clientGroups);
  }, []);

  useEffect(() => {
    setLoading(true);
    loadGallery()
      .catch((err: any) => setLoadError(err?.message ?? 'Çıktılar yüklenirken hata oluştu.'))
      .finally(() => setLoading(false));
  }, [loadGallery]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    setFilterClientId(params.get('client'));
  }, []);

  // When a client filter is active, narrow to that one client's group (or an
  // empty array if the id matches no client this viewer can see — same
  // client-isolation boundary as the unfiltered gallery, since `groups` only
  // ever contains clients that came out of the scoped getClients() call).
  // When absent, this is exactly `groups` — unfiltered behavior is unchanged.
  const matchedGroup = filterClientId ? groups.find((group) => group.client.id === filterClientId) ?? null : null;
  const displayGroups = filterClientId ? (matchedGroup ? [matchedGroup] : []) : groups;

  const allEntries = displayGroups.flatMap((group) => group.entries);
  const renderedCount = allEntries.filter((entry) => entry.renderJob.status === 'rendered').length;
  const pendingCount = allEntries.filter((entry) =>
    ['queued', 'rendering', 'pending'].includes(entry.renderJob.status)
  ).length;
  const failedCount = allEntries.filter((entry) => entry.renderJob.status === 'failed').length;

  // "Literally zero" gate: no client has any render job AND no client has
  // any brief either — i.e. genuinely nothing to show, as opposed to clients
  // existing but simply not having started a pipeline yet (that case is
  // still handled per-client below, not folded into this overall empty state).
  const hasAnyContent = allEntries.length > 0 || displayGroups.some((group) => group.briefs.length > 0);

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h2>
          📦 Çıktı Geçmişi{' '}
          <span style={{ fontSize: '0.7em', fontWeight: 400, color: 'var(--color-text-muted)' }}>· Çıktı Galerisi</span>
        </h2>
        <p>Tüm müşterilerin tamamlanmış render çıktıları tek galeride — görüntüleyin ve indirin. Onay/red işlemleri brief sayfasında yapılır.</p>
      </div>

      {filterClientId && matchedGroup && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '8px',
            marginBottom: '20px',
          }}
        >
          <h3 style={{ fontFamily: 'Outfit, sans-serif', fontSize: '1rem', margin: 0 }}>
            🔎 Filtre: {matchedGroup.client.name}
          </h3>
          <a href="/outputs" className="btn btn-secondary btn-sm">
            ← Tüm müşteriler
          </a>
        </div>
      )}

      {loading ? (
        <div className="empty-state" style={{ animation: 'pulse 1.5s infinite' }}>
          <div className="icon">📦</div>
          <p>Çıktılar yükleniyor...</p>
        </div>
      ) : loadError ? (
        <div className="empty-state">
          <div className="icon">⚠️</div>
          <p>{loadError}</p>
        </div>
      ) : filterClientId && !matchedGroup ? (
        <div className="empty-state">
          <div className="icon">🔍</div>
          <p>Bu müşteri bulunamadı</p>
          <a href="/outputs" className="btn btn-primary" style={{ marginTop: '16px' }}>
            ← Tüm müşteriler
          </a>
        </div>
      ) : !hasAnyContent ? (
        <div className="empty-state">
          <div className="icon">📦</div>
          <p>Henüz gösterilecek bir çıktı yok</p>
          <p style={{ fontSize: '0.85rem', marginTop: '8px', maxWidth: '400px' }}>
            Bir müşteri için tasarım brifi oluşturup görsel ürettiğinizde, üretilen ve render edilen çıktılar burada
            listelenir.
          </p>
          <a href="/" className="btn btn-primary" style={{ marginTop: '16px' }}>
            Müşterilere Git →
          </a>
        </div>
      ) : (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{renderedCount}</div>
              <div className="stat-label">Render Hazır</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{pendingCount}</div>
              <div className="stat-label">Bekliyor / Render Alınıyor</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{failedCount}</div>
              <div className="stat-label">Hata Oluştu</div>
            </div>
          </div>

          {displayGroups.map((group) => {
            // Nothing at all for this client (no renders, no briefs) — skip
            // quietly rather than printing an empty heading for every
            // never-touched demo client.
            if (group.entries.length === 0 && group.briefs.length === 0) return null;

            return (
              <div key={group.client.id} style={{ marginBottom: '32px' }}>
                <h3 style={{ fontFamily: 'Outfit, sans-serif', fontSize: '1.1rem', marginBottom: '12px' }}>
                  {group.client.name}
                </h3>

                {group.entries.length > 0 ? (
                  <div className="card-grid">
                    {group.entries.map((entry) => (
                      <GalleryOutputCard
                        key={entry.renderJob.id}
                        renderJob={entry.renderJob}
                        output={entry.output}
                        clientName={group.client.name}
                        briefTitle={entry.brief?.title}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="card">
                    <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '10px' }}>
                      Bu müşteri için henüz render edilmiş bir görsel yok.
                    </p>
                    {group.briefs.map((brief) => {
                      const info = BRIEF_STATUS_BADGES[brief.status] ?? { class: 'badge-neutral', label: brief.status };
                      return (
                        <div
                          key={brief.id}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}
                        >
                          <span style={{ fontSize: '0.85rem' }}>{brief.title}</span>
                          <span className={`badge ${info.class}`}>{info.label}</span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Henüz render yok</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
