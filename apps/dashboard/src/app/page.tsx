'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DemoPipelineOverview } from '@/components/demo-pipeline-overview';

interface ClientSummary {
  id: string;
  name: string;
  slug: string;
  industry?: string;
  status: string;
  brandAssetsCount: number;
  designReferencesCount: number;
  hasDNA: boolean;
}

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  function loadClients() {
    setLoading(true);
    api.getClients()
      .then((res) => setClients(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadClients();
  }, []);

  async function handleCreateClient(e: React.FormEvent) {
    e.preventDefault();
    if (!name) {
      setStatus('error');
      setErrorMessage('Müşteri adı zorunludur.');
      return;
    }
    setStatus('saving');
    setErrorMessage('');
    try {
      await api.createClient({ name, industry: industry || undefined });
      setName('');
      setIndustry('');
      setShowForm(false);
      setStatus('idle');
      loadClients();
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err.message ?? 'Müşteri oluşturulamadı.');
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2>Müşteriler</h2>
            <p>Ajans müşterilerinizi ve marka varlıklarını yönetin</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'İptal' : '+ Yeni Müşteri'}
          </button>
        </div>
      </div>

      <DemoPipelineOverview />

      {showForm && (
        <form onSubmit={handleCreateClient} className="card" style={{ marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '480px' }}>
          <label>
            Müşteri Adı
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', marginTop: '4px' }} required />
          </label>
          <label>
            Sektör
            <input type="text" value={industry} onChange={(e) => setIndustry(e.target.value)} style={{ width: '100%', marginTop: '4px' }} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={status === 'saving'}>
            {status === 'saving' ? 'Kaydediliyor...' : 'Müşteriyi Oluştur'}
          </button>
          {status === 'error' && <p style={{ color: 'var(--color-danger, #e05252)' }}>{errorMessage}</p>}
        </form>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{clients.length}</div>
          <div className="stat-label">Toplam Müşteri</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{clients.filter(c => c.status === 'active').length}</div>
          <div className="stat-label">Aktif</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{clients.filter(c => c.hasDNA).length}</div>
          <div className="stat-label">Tasarım DNA&apos;sı Olan</div>
        </div>
      </div>

      {loading ? (
        <div className="empty-state"><div className="icon" style={{ animation: 'pulse 1.5s infinite' }}>🎨</div><p>Müşteriler yükleniyor...</p></div>
      ) : clients.length === 0 ? (
        <div className="empty-state">
          <div className="icon">🏢</div>
          <p>Henüz müşteri yok</p>
        </div>
      ) : (
        <div className="card-grid">
          {clients.map((client) => (
            <a key={client.id} href={`/clients/${client.id}`} style={{ textDecoration: 'none' }}>
              <div className="card" style={{ cursor: 'pointer' }}>
                <div className="card-header">
                  <div className="card-title">{client.name}</div>
                  <span className={`badge ${client.status === 'active' ? 'badge-success' : 'badge-neutral'}`}>
                    {client.status === 'active' ? 'Aktif' : client.status}
                  </span>
                </div>
                {client.industry && (
                  <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', marginBottom: '12px' }}>
                    {client.industry}
                  </p>
                )}
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <span className="tag">{client.brandAssetsCount} varlık</span>
                  <span className="tag">{client.designReferencesCount} referans</span>
                  {client.hasDNA && <span className="tag tag-accent">🧬 DNA</span>}
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
