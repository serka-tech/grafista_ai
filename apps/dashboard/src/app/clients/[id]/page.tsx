'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AnalyticsSummaryPanel } from '@/components/analytics-summary-panel';
import { RevisionHistoryPanel } from '@/components/revision-history-panel';

export default function ClientProfilePage({ params }: { params: { id: string } }) {
  const [client, setClient] = useState<any>(null);
  const [ideas, setIdeas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getClient(params.id),
      api.getContentIdeas(params.id),
    ]).then(([clientRes, ideasRes]) => {
      setClient(clientRes.data);
      setIdeas(ideasRes.data);
    }).catch(console.error).finally(() => setLoading(false));
  }, [params.id]);

  if (loading) return <div className="empty-state" style={{ animation: 'pulse 1.5s infinite' }}>🎨 Yükleniyor...</div>;
  if (!client) return <div className="empty-state">Müşteri bulunamadı</div>;

  const subPages = [
    { href: `/clients/${params.id}/brand`, icon: '🎨', label: 'Marka Varlıkları', desc: 'Logo, renkler, yazı tipleri, kurallar' },
    { href: `/clients/${params.id}/references`, icon: '📐', label: 'Referans Kütüphanesi', desc: 'Önceki onaylanmış tasarımlar' },
    { href: `/clients/${params.id}/design-dna`, icon: '🧬', label: 'Tasarım DNA', desc: 'Yapay zeka ile analiz edilmiş stil profili' },
    { href: `/clients/${params.id}/content`, icon: '💡', label: 'İçerik Üretici', desc: 'İçerik fikirleri üret ve onayla' },
  ];

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h2>{client.name}</h2>
        <p>{client.industry} • {client.contactName} • {client.contactEmail}</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><div className="stat-value">{ideas.length}</div><div className="stat-label">İçerik Fikirleri</div></div>
        <div className="stat-card"><div className="stat-value">{ideas.filter(i => i.status === 'approved').length}</div><div className="stat-label">Onaylanan</div></div>
        <div className="stat-card"><div className="stat-value">{ideas.filter(i => i.status === 'pending_approval').length}</div><div className="stat-label">Bekleyen</div></div>
      </div>

      <div className="card-grid">
        {subPages.map((page) => (
          <a key={page.href} href={page.href} style={{ textDecoration: 'none' }}>
            <div className="card" style={{ cursor: 'pointer' }}>
              <div style={{ fontSize: '2rem', marginBottom: '12px' }}>{page.icon}</div>
              <div className="card-title">{page.label}</div>
              <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>{page.desc}</p>
            </div>
          </a>
        ))}
      </div>

      <AnalyticsSummaryPanel clientId={params.id} />
      <RevisionHistoryPanel clientId={params.id} />

      {/* Hızlı İş Akışları */}
      <div className="card" style={{ marginTop: '24px' }}>
        <div className="card-header">
          <div className="card-title">🔄 Hızlı İş Akışları</div>
          <a href="/workflows" className="btn btn-secondary btn-sm">İş Akışı Stüdyosu →</a>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
          {[
            { id: 'content-generation', icon: '💡', label: 'İçerik Üret' },
            { id: 'style-library-ingestion', icon: '📐', label: 'Referans Analizi' },
            { id: 'monthly-content-calendar', icon: '📅', label: 'Aylık Takvim' },
            { id: 'creative-qa', icon: '✅', label: 'Kalite Kontrolü' },
          ].map(wf => (
            // Bu iş akışlarının zorunlu girdileri var (kampanya hedefi, tasarım dosyaları,
            // ay, brief/layout ID'leri) — o yüzden burada doğrudan başlatmıyoruz, girdilerin
            // toplandığı /workflows/[id] sayfasına yönlendiriyoruz.
            <a key={wf.id} href={`/workflows/${wf.id}`} className="btn btn-secondary" style={{ textDecoration: 'none' }}>
              {wf.icon} {wf.label}
            </a>
          ))}
        </div>
      </div>

      {client.notes && (
        <div className="card" style={{ marginTop: '24px' }}>
          <div className="card-title" style={{ marginBottom: '8px' }}>Notlar</div>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>{client.notes}</p>
        </div>
      )}
    </div>
  );
}
