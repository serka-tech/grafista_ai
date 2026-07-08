'use client';

/**
 * DemoFlowGuide — visible, ordered MVP demo walkthrough (Turyap / Play & Bite
 * style customer demo).
 *
 * This is a NAVIGATION/CHECKLIST aid over the screens that already exist — NOT
 * a new module, and NOT a CRM/portfolio system. It puts the full pipeline in
 * one ordered place so a demo driver can click through it end to end:
 *   client -> brand assets -> reference/asset intake -> Design DNA -> content
 *   idea -> brief -> layout + Creative QA -> visual (KIE) -> production ->
 *   render/export (Instagram Post + Story) -> download.
 *
 * Steps 1-5 link to real per-client pages. Steps 6-9 happen INSIDE the
 * content -> brief -> layout-plans flow (the visual/production/render output
 * card lives on the layout-plans page), so they link to the /content entry
 * point and say so, rather than fabricating routes that don't exist.
 *
 * Honesty notes are first-class here (see the footer): the rendered hero image
 * is AI-generated in this MVP, and visual generation (KIE) is a paid step.
 */

interface Step {
  n: number;
  icon: string;
  label: string;
  desc: string;
  href?: string;
  hrefLabel?: string;
  note?: string;
  paid?: boolean;
}

export function DemoFlowGuide({ clientId }: { clientId: string }) {
  const steps: Step[] = [
    {
      n: 1,
      icon: '🏢',
      label: 'Müşteri oluştur / seç',
      desc: 'Ad ve sektör girilir. (Bu müşteri için tamamlandı.)',
    },
    {
      n: 2,
      icon: '🎨',
      label: 'Marka varlıkları',
      desc: 'Logo, renk paleti ve yazı tipi yükle. Marka kimliğini besler.',
      href: `/clients/${clientId}/brand`,
      hrefLabel: 'Marka Varlıkları',
    },
    {
      n: 3,
      icon: '📐',
      label: 'Görsel / asset intake',
      desc: 'Müşteri/mülk görsellerini YÜKLE (internetten değil). Stil analizinde kullanılır.',
      href: `/clients/${clientId}/references`,
      hrefLabel: 'Referans Kütüphanesi',
    },
    {
      n: 4,
      icon: '🧬',
      label: 'Tasarım DNA',
      desc: 'Yüklenenlerden stil profilini (renk/ton/tipografi) çıkar ve onayla.',
      href: `/clients/${clientId}/design-dna`,
      hrefLabel: 'Tasarım DNA',
    },
    {
      n: 5,
      icon: '💡',
      label: 'İçerik fikri üret + onayla',
      desc: 'Platform seç (ör. Instagram), fikir üret, onayla.',
      href: `/clients/${clientId}/content`,
      hrefLabel: 'İçerik Üretici',
    },
    {
      n: 6,
      icon: '📋',
      label: 'Brief oluştur + onayla',
      desc: 'Onaylı fikirden "Tasarım Brifi Oluştur" ile brief üret, aç ve onayla.',
      note: 'İçerik Üretici sayfasından ilerler.',
    },
    {
      n: 7,
      icon: '🖼️',
      label: 'Layout + Kalite Kontrol',
      desc: 'Brief sayfasında layout planı üret, Creative QA çalıştır ve onayla.',
      note: 'Brief -> Layout Planları sayfasında.',
    },
    {
      n: 8,
      icon: '✨',
      label: 'Görsel üret + üretime gönder',
      desc: 'Layout Planları sayfasındaki çıktı kartında görsel üret (KIE), onayla, "Üretime Gönder", paket onayla.',
      note: 'Layout Planları sayfasındaki çıktı kartında.',
      paid: true,
    },
    {
      n: 9,
      icon: '⬇️',
      label: 'Render / Export + indir',
      desc: 'Aynı çıktı kartında Instagram Post (1080×1080) ve Story (1080×1920) render al, PNG/JPG indir.',
      note: 'Render adımı ücretsizdir (Playwright).',
    },
  ];

  return (
    <div className="card" style={{ marginTop: '24px' }}>
      <div className="card-header">
        <div className="card-title">🎬 MVP Demo Akışı (Rehber)</div>
        <span className="badge badge-info">Demo rehberi</span>
      </div>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', margin: '8px 0 16px' }}>
        Aşağıdaki adımları sırayla izleyin. Bu bir yol haritasıdır (mevcut ekranların üzerinde),
        yeni bir modül değildir.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {steps.map((s) => (
          <div
            key={s.n}
            style={{
              display: 'flex',
              gap: '12px',
              alignItems: 'flex-start',
              padding: '12px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-bg-glass)',
            }}
          >
            <div
              style={{
                flex: '0 0 auto',
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: 'var(--color-bg-elevated, rgba(255,255,255,0.06))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'Outfit',
                fontSize: '0.85rem',
              }}
            >
              {s.n}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600 }}>
                  {s.icon} {s.label}
                </span>
                {s.paid && <span className="badge badge-warning">Ücretli adım (KIE)</span>}
              </div>
              <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.83rem', marginTop: '4px' }}>{s.desc}</p>
              {s.note && (
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.76rem', marginTop: '4px' }}>↳ {s.note}</p>
              )}
              {s.href && (
                <a href={s.href} className="btn btn-secondary btn-sm" style={{ marginTop: '8px', textDecoration: 'none' }}>
                  {s.hrefLabel} →
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: '16px',
          paddingTop: '12px',
          borderTop: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        }}
      >
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem', lineHeight: 1.5 }}>
          <strong>Dürüst notlar:</strong> Gönderiye basılan ana görsel bu MVP&apos;de yapay zeka (KIE) ile
          üretilir; yüklediğiniz varlıklar stil/DNA ve logo için kullanılır. Yüklenen bir fotoğrafı
          doğrudan gönderiye basma özelliği henüz yoktur (sonraki adım). Görsel üretim (KIE) ücretli,
          render/export (Playwright) ücretsizdir.
        </p>
      </div>
    </div>
  );
}
