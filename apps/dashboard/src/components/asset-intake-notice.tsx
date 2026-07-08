'use client';

/**
 * AssetIntakeNotice — Demo Asset Intake honesty banner (MVP demo flow).
 *
 * Shown on the brand-asset and design-reference upload screens. States the
 * one hard product rule for a client/property demo (Turyap, Play & Bite, ...):
 * customer/property images are UPLOADED here, never taken from random internet
 * sources. It is deliberately explicit about what an uploaded asset does and
 * does NOT do today, so the demo never over-promises:
 *   - uploaded assets DO feed DesignDNA/style analysis + logo placement,
 *   - the rendered hero visual is still AI-generated (KIE) in this MVP — a
 *     "use my exact uploaded photo as the post image" path does not exist yet.
 *
 * Pure presentational component (no state, no API) — safe to drop onto any
 * upload page. Uses the app's existing CSS class vocabulary only.
 */
export function AssetIntakeNotice({ variant = 'reference' }: { variant?: 'reference' | 'brand' }) {
  return (
    <div
      className="card"
      style={{
        marginBottom: '20px',
        borderLeft: '3px solid var(--color-warning, #e0a53f)',
        background: 'var(--color-bg-glass)',
      }}
    >
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        📌 Görsel Yükleme Kuralı
      </div>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.88rem', marginTop: '8px', lineHeight: 1.5 }}>
        Müşteri ve mülk görselleri buradan <strong>yüklenir</strong>. İnternetten veya rastgele
        kaynaklardan alınan görseller kullanılmaz. Sadece hakkında izniniz olan, müşteriye ait
        görselleri yükleyin.
      </p>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', marginTop: '8px', lineHeight: 1.5 }}>
        {variant === 'brand'
          ? 'Yüklenen logo/renk/yazı tipi varlıkları marka kimliğini ve logo yerleşimini besler.'
          : 'Yüklenen referanslar Tasarım DNA/stil analizinde kullanılır.'}{' '}
        <strong>Not:</strong> Bu MVP&apos;de gönderiye basılan ana görsel yapay zeka (KIE) ile üretilir;
        &quot;yüklediğim fotoğrafı doğrudan gönderiye bas&quot; özelliği henüz yoktur (sonraki adım).
      </p>
    </div>
  );
}
