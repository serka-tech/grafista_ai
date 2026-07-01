'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function BriefPage({ params }: { params: { id: string } }) {
  const [brief, setBrief] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDesignBrief(params.id).then((res) => setBrief(res.data)).catch(console.error).finally(() => setLoading(false));
  }, [params.id]);

  if (loading) return <div className="empty-state" style={{ animation: 'pulse 1.5s infinite' }}>📋 Brif yükleniyor...</div>;
  if (!brief) return <div className="empty-state">Brif bulunamadı</div>;

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h2>📋 {brief.title}</h2>
        <p>{brief.platform?.replace(/_/g, ' ')} • {brief.format?.replace(/_/g, ' ')} • {brief.dimensions?.width}×{brief.dimensions?.height}px</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '24px' }}>
        <div className="card">
          <h3 style={{ fontFamily: 'Outfit', fontSize: '1rem', color: 'var(--color-text-accent)', marginBottom: '12px' }}>📝 İçerik Öğeleri</h3>
          {brief.contentElements?.headline && <div style={{ marginBottom: '8px' }}><span className="form-label">Başlık</span><p style={{ fontSize: '1rem', fontWeight: 600 }}>{brief.contentElements.headline}</p></div>}
          {brief.contentElements?.caption && <div style={{ marginBottom: '8px' }}><span className="form-label">Açıklama</span><p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>{brief.contentElements.caption}</p></div>}
          {brief.contentElements?.callToAction && <div><span className="form-label">Eylem Çağrısı</span><span className="badge badge-success">{brief.contentElements.callToAction}</span></div>}
        </div>

        <div className="card">
          <h3 style={{ fontFamily: 'Outfit', fontSize: '1rem', color: 'var(--color-text-accent)', marginBottom: '12px' }}>🎨 Görsel Yönlendirme</h3>
          {brief.visualDirection?.mood && <div style={{ marginBottom: '8px' }}><span className="form-label">Ruh Hali</span><span className="tag tag-accent">{brief.visualDirection.mood}</span></div>}
          {brief.visualDirection?.imageDirection && <div><span className="form-label">Görsel Yönü</span><p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>{brief.visualDirection.imageDirection}</p></div>}
        </div>

        <div className="card">
          <h3 style={{ fontFamily: 'Outfit', fontSize: '1rem', color: 'var(--color-text-accent)', marginBottom: '12px' }}>📐 Boyutlar</h3>
          <div className="stat-value">{brief.dimensions?.width} × {brief.dimensions?.height}</div>
          <div className="stat-label">{brief.dimensions?.unit}</div>
        </div>

        <div className="card">
          <h3 style={{ fontFamily: 'Outfit', fontSize: '1rem', color: 'var(--color-text-accent)', marginBottom: '12px' }}>🎯 Hedef</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>{brief.objective}</p>
        </div>

        {brief.aiImagePrompts?.length > 0 && (
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <h3 style={{ fontFamily: 'Outfit', fontSize: '1rem', color: 'var(--color-text-accent)', marginBottom: '12px' }}>🤖 AI Görsel Promptları</h3>
            {brief.aiImagePrompts.map((p: any, i: number) => (
              <div key={i} style={{ padding: '12px', background: 'var(--color-bg-glass)', borderRadius: 'var(--radius-md)', marginBottom: '8px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-accent)', marginBottom: '4px' }}>{p.label}</div>
                <code style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>{p.prompt}</code>
              </div>
            ))}
          </div>
        )}

        {brief.client && (
          <div className="card">
            <h3 style={{ fontFamily: 'Outfit', fontSize: '1rem', color: 'var(--color-text-accent)', marginBottom: '12px' }}>🏢 Müşteri</h3>
            <div className="card-title">{brief.client.name}</div>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>{brief.client.industry}</p>
          </div>
        )}
      </div>

      <div style={{ marginTop: '32px', display: 'flex', gap: '12px' }}>
        <span className={`badge ${brief.status === 'draft' ? 'badge-neutral' : brief.status === 'approved' ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '0.85rem', padding: '6px 16px' }}>
          Durum: {brief.status}
        </span>
        <button className="btn btn-primary" disabled title="Faz 2'de aktif olacak">🎨 Yerleşim Planı Oluştur (Faz 2)</button>
        <button className="btn btn-secondary" disabled title="Faz 2'de aktif olacak">📊 Kalite Kontrolü Çalıştır (Faz 2)</button>
      </div>
    </div>
  );
}
