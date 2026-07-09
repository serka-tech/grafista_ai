'use client';

/**
 * DemoPipelineOverview — compact "MVP Demo Akışı" story strip for the top of
 * the landing screen (root '/', the Müşteriler list).
 *
 * The full, clickable 9-step walkthrough already lives on each client's hub
 * (see demo-flow-guide.tsx). The problem this solves is discoverability: the
 * first screen a new viewer sees is a raw client list with no hint of the
 * end-to-end story. This strip states that story at a glance —
 *   Müşteri → Brief → İçerik/Tasarım → Render → Galeri → İndir
 * — so a demo audience understands what the product does in ~30 seconds
 * before drilling into a single client.
 *
 * Static, self-contained, honest demo language: it describes the pipeline
 * that genuinely exists on the client hub; it makes no claims of its own and
 * fetches nothing. The only link points at the real Product Gallery (/outputs).
 */

interface Stage {
  icon: string;
  label: string;
  desc: string;
}

const STAGES: Stage[] = [
  { icon: '🏢', label: 'Müşteri', desc: 'Marka + varlıklar' },
  { icon: '📋', label: 'Brief', desc: 'Fikir → onaylı brief' },
  { icon: '🎨', label: 'İçerik / Tasarım', desc: 'Layout + kalite + görsel' },
  { icon: '🖼️', label: 'Render', desc: 'Post & Story çıktısı' },
  { icon: '📦', label: 'Galeri', desc: 'Çıktılar bir arada' },
  { icon: '⬇️', label: 'İndir', desc: 'PNG / JPG indir' },
];

export function DemoPipelineOverview() {
  return (
    <div className="card" style={{ marginBottom: '24px' }}>
      <div className="card-header">
        <div className="card-title">🎬 MVP Demo Akışı</div>
        <span className="badge badge-info">Demo rehberi</span>
      </div>

      <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', margin: '8px 0 16px' }}>
        Grafista bir müşteriyi tek bir akışta yayına hazır görsele çevirir. Bir müşteriye tıklayın; aşağıdaki
        adımların tamamını sırayla, o müşterinin sayfasında görürsünüz.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: '8px' }}>
        {STAGES.map((stage, i) => (
          <div key={stage.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-bg-glass)',
                minWidth: '120px',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                {stage.icon} {stage.label}
              </span>
              <span style={{ color: 'var(--color-text-muted)', fontSize: '0.74rem' }}>{stage.desc}</span>
            </div>
            {i < STAGES.length - 1 && (
              <span aria-hidden="true" style={{ color: 'var(--color-text-muted)', fontSize: '1rem' }}>
                →
              </span>
            )}
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: '16px',
          paddingTop: '12px',
          borderTop: '1px solid var(--color-border, rgba(255,255,255,0.08))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>
          Render çıktılarının tamamı Çıktı Galerisi&apos;nde toplanır ve oradan indirilir.
        </span>
        <a href="/outputs" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>
          📦 Çıktı Galerisini Aç →
        </a>
      </div>
    </div>
  );
}
