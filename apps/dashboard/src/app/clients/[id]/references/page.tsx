'use client';

import { useEffect, useState } from 'react';
import { api, resolveApiFileUrl } from '@/lib/api';
import { AssetIntakeNotice } from '@/components/asset-intake-notice';

export default function ReferencesPage({ params }: { params: { id: string } }) {
  const [refs, setRefs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'error' | 'success'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  function loadRefs() {
    setLoading(true);
    api.getDesignReferences(params.id).then((res) => setRefs(res.data)).catch(console.error).finally(() => setLoading(false));
  }

  useEffect(() => {
    loadRefs();
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
      formData.append('name', name);
      if (description) formData.append('description', description);
      formData.append('file', file);
      await api.uploadDesignReference(params.id, formData);
      setStatus('success');
      setName('');
      setDescription('');
      setFile(null);
      setShowForm(false);
      loadRefs();
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err.message ?? 'Yükleme başarısız oldu.');
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div><h2>Referans Tasarım Kütüphanesi</h2><p>Tasarım DNA analizinde kullanılan daha önce onaylanmış tasarımlar</p></div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'İptal' : '+ Tasarım Referansı Yükle'}
            </button>
            <a href={`/clients/${params.id}`} className="btn btn-secondary">← Geri</a>
          </div>
        </div>
      </div>

      <AssetIntakeNotice variant="reference" />

      {showForm && (
        <form onSubmit={handleUpload} className="card" style={{ marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '480px' }}>
          <label>
            İsim
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', marginTop: '4px' }} required />
          </label>
          <label>
            Açıklama
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: '100%', marginTop: '4px' }} />
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
        <div className="empty-state" style={{ animation: 'pulse 1.5s infinite' }}>Yükleniyor...</div>
      ) : refs.length === 0 ? (
        <div className="empty-state"><div className="icon">📐</div><p>Henüz tasarım referansı yüklenmedi</p></div>
      ) : (
        <div className="card-grid">
          {refs.map((ref) => (
            <div key={ref.id} className="card">
              {ref.fileUrl ? (
                // fileUrl is an API-relative protected route, resolved against the API origin —
                // same idiom as the preview image in visual-outputs-panel.tsx.
                // eslint-disable-next-line @next/next/no-img-element -- uploaded reference files are served by the API (or a storage redirect); next/image domain allowlisting is not configured for them
                <img
                  src={resolveApiFileUrl(ref.fileUrl)}
                  alt={ref.name}
                  style={{ width: '100%', height: '160px', objectFit: 'cover', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-glass)', marginBottom: '12px' }}
                />
              ) : (
                <div style={{ background: 'var(--color-bg-glass)', borderRadius: 'var(--radius-md)', height: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px', fontSize: '3rem' }}>
                  📐
                </div>
              )}
              <div className="card-title">{ref.name}</div>
              {ref.description && <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>{ref.description}</p>}
              <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                {ref.tags?.map((tag: string) => <span key={tag} className="tag">{tag}</span>)}
                {ref.isApproved && <span className="badge badge-success">Onaylı</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
