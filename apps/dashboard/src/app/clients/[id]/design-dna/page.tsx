'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function DesignDNAPage({ params }: { params: { id: string } }) {
  const [dna, setDNA] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getDesignDNA(params.id)
      .then((res) => setDNA(res.data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) return <div className="empty-state" style={{ animation: 'pulse 1.5s infinite' }}>🧬 Analiz ediliyor...</div>;

  if (error || !dna) {
    return (
      <div className="animate-fade-in">
        <div className="page-header">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div><h2>Tasarım DNA</h2><p>Yapay zeka ile analiz edilmiş görsel stil profili</p></div>
            <a href={`/clients/${params.id}`} className="btn btn-secondary">← Geri</a>
          </div>
        </div>
        <div className="empty-state">
          <div className="icon">🧬</div>
          <p>Henüz Tasarım DNA&apos;sı yok. Tasarım referansları yükleyip analiz çalıştırın.</p>
          <button className="btn btn-primary" style={{ marginTop: '16px' }} disabled title="Görsel analiz Faz 2'de aktif olacak">
            Analizi Çalıştır (Faz 2)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div><h2>🧬 Tasarım DNA</h2><p>Versiyon {dna.version} • {dna.sourceAnalysisCount} referansa dayanıyor</p></div>
          <a href={`/clients/${params.id}`} className="btn btn-secondary">← Geri</a>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '24px' }}>
        <div className="card dna-section">
          <h3>🎭 Marka Kişiliği</h3>
          <div className="tag-list">{dna.brandPersonality?.map((p: string) => <span key={p} className="tag tag-accent">{p}</span>)}</div>
        </div>

        <div className="card dna-section">
          <h3>📐 Tercih Edilen Yerleşimler</h3>
          <div className="tag-list">{dna.preferredLayouts?.map((l: string) => <span key={l} className="tag">{l}</span>)}</div>
        </div>

        <div className="card dna-section">
          <h3>👁️ Görsel Kurallar</h3>
          {dna.visualRules?.map((rule: any, i: number) => (
            <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)', fontSize: '0.9rem' }}>
              <div style={{ color: 'var(--color-text-primary)' }}>{rule.rule}</div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <span className="badge badge-info">{rule.source}</span>
                <span className="badge badge-neutral">%{Math.round(rule.confidence * 100)} güven</span>
              </div>
            </div>
          ))}
        </div>

        <div className="card dna-section">
          <h3>🔤 Tipografi Kuralları</h3>
          {dna.typographyRules?.map((rule: any, i: number) => (
            <div key={i} style={{ padding: '6px 0', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>• {rule.rule}</div>
          ))}
        </div>

        <div className="card dna-section">
          <h3>🎨 Renk Kullanım Kuralları</h3>
          {dna.colorUsageRules?.map((rule: any, i: number) => (
            <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: '0.9rem' }}>{rule.rule}</div>
              {rule.colors && (
                <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                  {rule.colors.map((hex: string) => (
                    <div key={hex} className="color-swatch">
                      <div className="color-dot" style={{ backgroundColor: hex }} />
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{hex}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="card dna-section">
          <h3>🎙️ İçerik Tonu</h3>
          <div style={{ marginBottom: '8px' }}>
            <span className="tag tag-accent">{dna.contentTone?.primary}</span>
            {dna.contentTone?.secondary && <span className="tag" style={{ marginLeft: '6px' }}>{dna.contentTone.secondary}</span>}
          </div>
          <div className="tag-list">
            {dna.contentTone?.keywords?.map((k: string) => <span key={k} className="tag">{k}</span>)}
          </div>
        </div>

        <div className="card dna-section">
          <h3>🚫 Kaçınılacaklar Listesi</h3>
          <div className="tag-list">
            {dna.avoidList?.map((item: string) => (
              <span key={item} className="tag" style={{ borderColor: 'rgba(248,113,113,0.3)', color: '#f87171' }}>✕ {item}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
