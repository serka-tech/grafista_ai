/**
 * Grafista AI Studio — deterministic ordering for the output gallery.
 *
 * Shared by the /outputs Product Gallery (app/outputs/page.tsx), its
 * ?client=<id> filtered view (same code path), and the client hub's
 * "Son Çıktılar" strip (components/client-recent-outputs.tsx) so all three
 * surfaces lead with the same "real, completed render first" ordering.
 *
 * Pure, read-only, frontend-only: it ranks entries purely from metadata the
 * existing list endpoints already return — render job status, export artifact
 * summaries, the honest `demo-seed` provider/renderer flag written by
 * scripts/db-seed-demo-all.ts, and createdAt. It never hides, mutates, or
 * fabricates anything: a lower-ranked demo-seed placeholder still renders, it
 * just sorts after the stronger real renders.
 *
 * Ordering priority (highest first), matching the demo-polish spec:
 *   1. Render-ready ('rendered') outputs before in-progress before failed.
 *   2. Outputs with a real downloadable artifact before preview-only before
 *      nothing to show.
 *   3. Real renders before honestly-flagged `demo-seed` placeholder/seed rows
 *      (this is what lifts the Turyap "Sistem Demo" real renders above the
 *      Flavora demo-seed placeholder).
 *   4. Newest first within an otherwise-equal quality group.
 *
 * Both callers' entry shapes ({ output, renderJob, ... }) satisfy this
 * structural type — the extra brief/briefTitle fields are simply ignored.
 */

export type GalleryOrderingEntry = {
  output?: { provider?: unknown; previewUrl?: unknown; fileUrl?: unknown } | null;
  renderJob?: {
    status?: unknown;
    rendererName?: unknown;
    createdAt?: unknown;
    artifactSummaries?: Array<{ fileUrl?: unknown } | null | undefined> | null;
  } | null;
};

// Render-ready first, in-progress next, failed/cancelled/unknown last. Mirrors
// the /outputs stat-card grouping (Render Hazır / Bekliyor·Render Alınıyor /
// Hata Oluştu).
function statusRank(status: unknown): number {
  if (status === 'rendered') return 2;
  if (status === 'pending' || status === 'queued' || status === 'rendering') return 1;
  return 0;
}

// A real downloadable export artifact beats a preview-only image beats nothing
// to show. Matches exactly what GalleryOutputCard can actually display/download
// (artifactSummaries[0].fileUrl, then output.previewUrl/fileUrl).
function assetRank(entry: GalleryOrderingEntry): number {
  const artifact = entry.renderJob?.artifactSummaries?.[0];
  if (artifact && artifact.fileUrl) return 2;
  if (entry.output?.previewUrl || entry.output?.fileUrl) return 1;
  return 0;
}

// The honest demo-seed flag: db-seed-demo-all.ts stamps both the visual output
// (provider 'demo-seed') and its render job (rendererName 'demo-seed'). Real
// renders come from a real adapter (e.g. 'playwright'), so "not demo-seed"
// ranks above the seeded placeholder without inventing any new flag.
function realRank(entry: GalleryOrderingEntry): number {
  const isDemoSeed =
    entry.renderJob?.rendererName === 'demo-seed' || entry.output?.provider === 'demo-seed';
  return isDemoSeed ? 0 : 1;
}

// Newest first within an otherwise-equal quality group. Same createdAt-with-0
// -fallback convention the two callers already used.
function createdAtMs(entry: GalleryOrderingEntry): number {
  const t = new Date((entry.renderJob?.createdAt as string | number | undefined) ?? 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Comparator (best first) for a flat list of gallery entries — drop-in for
 * Array.prototype.sort. Deterministic: falls through status → asset → real
 * → recency, so any two entries have a total order.
 */
export function compareGalleryEntries(a: GalleryOrderingEntry, b: GalleryOrderingEntry): number {
  return (
    statusRank(b.renderJob?.status) - statusRank(a.renderJob?.status) ||
    assetRank(b) - assetRank(a) ||
    realRank(b) - realRank(a) ||
    createdAtMs(b) - createdAtMs(a)
  );
}

// The strongest entry in a group, by the same comparator. Independent of
// whether `entries` is pre-sorted, so callers can order groups safely.
function bestEntry(entries: GalleryOrderingEntry[]): GalleryOrderingEntry | null {
  let best: GalleryOrderingEntry | null = null;
  for (const entry of entries) {
    if (!best || compareGalleryEntries(entry, best) < 0) best = entry;
  }
  return best;
}

/**
 * Comparator (best first) for the /outputs per-client groups, so the gallery
 * leads with the client whose strongest render is the strongest overall
 * (e.g. Turyap's real render group ahead of the Flavora demo-seed group).
 * Groups that have at least one render always sort above groups that only have
 * briefs (no entries yet); ties fall through to the best entry's own ranking.
 */
export function compareGalleryGroups(
  a: { entries: GalleryOrderingEntry[] },
  b: { entries: GalleryOrderingEntry[] }
): number {
  const aBest = bestEntry(a.entries);
  const bBest = bestEntry(b.entries);
  if (!aBest && !bBest) return 0;
  if (!aBest) return 1; // a has no renders -> after b
  if (!bBest) return -1; // b has no renders -> a before b
  return compareGalleryEntries(aBest, bBest);
}
