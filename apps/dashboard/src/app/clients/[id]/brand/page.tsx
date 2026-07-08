'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AssetIntakeNotice } from '@/components/asset-intake-notice';

export default function BrandAssetsPage({ params }: { params: { id: string } }) {
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState('logo');
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'error' | 'success'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  function loadAssets() {
    setLoading(true);
    api.getBrandAssets(params.id)
      .then((res) => setAssets(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadAssets();
  }, [params.id]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !file) {
      setStatus('error');
      setErrorMessage('İsim ve dosya zorunludur.');
      return;
    }
    setStatus('uploading');
    setErrorMessage('');
    try {
      const formData = new FormData();
      formData.append('type', type);
      formData.append('name', name);
      formData.append('file', file);
      await api.uploadBrandAsset(params.id, formData);
      setStatus('success');
      setName('');
      setFile(null);
      setShowForm(false);
      loadAssets();
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err.message ?? 'Yükleme başarısız oldu.');
    }
  }

  const groupedAssets = assets.reduce((acc: Record<string, any[]>, asset) => {
    const type = asset.type || 'other';
    if (!acc[type]) acc[type] = [];
    acc[type].push(asset);
    return acc;
  }, {});

  const typeIcons: Record<string, string> = {
    logo: '🎯', logo_variant: '🎯', icon: '✦', color_palette: '🎨',
    font: '🔤', brand_guideline: '📋', pattern: '🔲', other: '📁',
  };

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2>Marka Varlıkları</h2>
            <p>Logolar, renkler, yazı tipleri ve marka kuralları</p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'İptal' : '+ Marka Varlığı Yükle'}
            </button>
            <a href={`/clients/${params.id}`} className="btn btn-secondary">← Geri</a>
          </div>
        </div>
      </div>

      <AssetIntakeNotice variant="brand" />

      {showForm && (
        <form onSubmit={handleUpload} className="card" style={{ marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '480px' }}>
          <label>
            Tür
            <select value={type} onChange={(e) => setType(e.target.value)} style={{ width: '100%', marginTop: '4px' }}>
              <option value="logo">Logo</option>
              <option value="logo_variant">Logo Varyantı</option>
              <option value="color_palette">Renk Paleti</option>
              <option value="font">Yazı Tipi</option>
              <option value="brand_guideline">Marka Kuralları</option>
              <option value="other">Diğer</option>
            </select>
          </label>
          <label>
            İsim
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', marginTop: '4px' }} required />
          </label>
          <label>
            Dosya
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ width: '100%', marginTop: '4px' }} required />
          </label>
          <button type="submit" className="btn btn-primary" disabled={status === 'uploading'}>
            {status === 'uploading' ? 'Yükleniyor...' : 'Yükle'}
          </button>
          {status === 'error' && <p style={{ color: 'var(--color-danger, #e05252)' }}>{errorMessage}</p>}
        </form>
      )}

      {loading ? (
        <div className="empty-state" style={{ animation: 'pulse 1.5s infinite' }}>Varlıklar yükleniyor...</div>
      ) : Object.keys(groupedAssets).length === 0 ? (
        <div className="empty-state">
          <div className="icon">🎨</div>
          <p>Henüz marka varlığı yüklenmedi</p>
        </div>
      ) : (
        Object.entries(groupedAssets).map(([type, items]) => (
          <div key={type} style={{ marginBottom: '32px' }}>
            <h3 style={{ fontFamily: 'Outfit', fontSize: '1.1rem', marginBottom: '16px', color: 'var(--color-text-accent)' }}>
              {typeIcons[type] || '📁'} {type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </h3>
            <div className="card-grid">
              {items.map((asset: any) => (
                <div key={asset.id} className="card">
                  <div className="card-title">{asset.name}</div>
                  <span className="badge badge-info" style={{ marginTop: '8px' }}>{asset.type}</span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
