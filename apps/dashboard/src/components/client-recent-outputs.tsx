'use client';

/**
 * Grafista AI Studio — "Son Çıktılar" strip for the client hub (/clients/[id]).
 *
 * Read-only. Fans out over THIS ONE client's pipeline
 *   getLayoutPlansForClient -> listVisualOutputs -> listProductionJobs
 *   -> listRenderJobsForProductionJob
 * and shows up to 4 most-recent render jobs, so a rendered image is visible on
 * the client hub without drilling ~8 levels deep. Reuses GalleryOutputCard (the
 * /outputs gallery card) so the two surfaces look identical, and a "Tümü →"
 * link points at the gallery filtered to this client (/outputs?client=<id>).
 *
 * Renders NOTHING (return null) until loaded. Once loaded it ALWAYS shows the
 * "Son Çıktılar" section: the recent render cards + a "Tümü →" link when they
 * exist, or a short placeholder line when the client hasn't rendered anything
 * yet (so the section's purpose stays visible during a live demo instead of
 * being a silent gap). Each fan-out level has its own try/catch that skips on
 * failure (mirrors outputs/page.tsx's "one transient failure must not break the
 * UI" idiom). Purely read-only; the client id comes from the route the viewer
 * is already authorized for, so no isolation boundary is crossed here.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { GalleryOutputCard } from '@/components/gallery-output-card';

const MAX_ITEMS = 4;

type Entry = { output: any; renderJob: any; briefTitle: string | null };

export function ClientRecentOutputs({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // brief id -> title, display-only; a failure just drops titles (the card
    // falls back to "Görsel Alternatif N").
    const titleById = new Map<string, string>();
    try {
      const res = await api.getDesignBriefs();
      for (const b of res.data ?? []) titleById.set(b.id, b.title);
    } catch {
      // keep empty map
    }

    let layoutPlans: any[] = [];
    try {
      layoutPlans = (await api.getLayoutPlansForClient(clientId)).data ?? [];
    } catch {
      layoutPlans = [];
    }

    const perPlan = await Promise.all(
      layoutPlans.map(async (plan: any): Promise<Entry[]> => {
        let outputs: any[] = [];
        try {
          outputs = (await api.listVisualOutputs(plan.id)).data ?? [];
        } catch {
          outputs = [];
        }

        const perOutput = await Promise.all(
          outputs.map(async (output: any): Promise<Entry[]> => {
            let jobs: any[] = [];
            try {
              jobs = (await api.listProductionJobs(output.id)).data ?? [];
            } catch {
              jobs = [];
            }

            const perJob = await Promise.all(
              jobs.map(async (job: any): Promise<Entry[]> => {
                let renders: any[] = [];
                try {
                  renders = (await api.listRenderJobsForProductionJob(job.id)).data ?? [];
                } catch {
                  renders = [];
                }
                return renders.map((renderJob: any) => ({
                  output,
                  renderJob,
                  briefTitle: titleById.get(output.designBriefId ?? plan.designBriefId) ?? null,
                }));
              })
            );

            return perJob.flat();
          })
        );

        return perOutput.flat();
      })
    );

    const sorted = perPlan.flat().sort(
      (a, b) => new Date(b.renderJob.createdAt ?? 0).getTime() - new Date(a.renderJob.createdAt ?? 0).getTime()
    );
    setEntries(sorted.slice(0, MAX_ITEMS));
  }, [clientId]);

  useEffect(() => {
    setLoading(true);
    load()
      .catch(() => {
        // swallowed — the strip simply stays empty rather than erroring the hub
      })
      .finally(() => setLoading(false));
  }, [load]);

  // Nothing while loading — the section settles in after the fetch. Once
  // loaded it always renders, so a demo of a not-yet-rendered client still
  // shows what this area is for (placeholder below) instead of a silent gap.
  if (loading) return null;

  return (
    <div style={{ marginTop: '24px' }}>
      <div className="card-header" style={{ marginBottom: '12px' }}>
        <div className="card-title">🖼 Son Çıktılar</div>
        {entries.length > 0 && (
          <a href={`/outputs?client=${clientId}`} className="btn btn-secondary btn-sm">
            Tümü →
          </a>
        )}
      </div>
      {entries.length > 0 ? (
        <div className="card-grid">
          {entries.map((entry) => (
            <GalleryOutputCard
              key={entry.renderJob.id}
              renderJob={entry.renderJob}
              output={entry.output}
              clientName={clientName}
              briefTitle={entry.briefTitle ?? undefined}
            />
          ))}
        </div>
      ) : (
        <div className="card">
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: 0 }}>
            Bu müşteri için render alındığında, üretilen görseller burada görünür ve buradan indirilir.
          </p>
        </div>
      )}
    </div>
  );
}
