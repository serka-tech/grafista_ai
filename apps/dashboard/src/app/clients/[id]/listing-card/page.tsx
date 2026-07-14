'use client';

import { useState } from 'react';
import { api, resolveApiFileUrl } from '@/lib/api';
import { FileDropzone } from '@/components/file-dropzone';

type Step = 'idle' | 'creating' | 'packaging' | 'rendering' | 'done' | 'error';

const STEP_LABEL: Record<Step, string> = {
  idle: '',
  creating: 'Fotoğraf yükleniyor ve ilan hazırlanıyor...',
  packaging: 'Üretim paketi hazırlanıyor...',
  rendering: 'Kart render ediliyor...',
  done: 'Hazır',
  error: 'Hata',
};

export default function ListingCardPage({ params }: { params: { id: string } }) {
  const [preset, setPreset] = useState<'instagram_post' | 'instagram_story'>('instagram_post');
  const [price, setPrice] = useState('');
  const [title, setTitle] = useState('');
  const [address, setAddress] = useState('');
  const [agencyName, setAgencyName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');

  async function pollUntilRendered(renderJobId: string, initialStatus: string) {
    let status = initialStatus;
    for (let i = 0; i < 40 && status !== 'rendered'; i++) {
      if (status === 'failed' || status === 'cancelled') throw new Error(`Render ${status}`);
      await new Promise((r) => setTimeout(r, 2000));
      const res = await api.getRenderJob(renderJobId);
      status = res.data.status;
    }
    if (status !== 'rendered') throw new Error('Render zaman aşımına uğradı');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !price || !title) {
      setStep('error');
      setErrorMessage('Fotoğraf, fiyat ve başlık zorunludur.');
      return;
    }
    setErrorMessage('');
    setDownloadUrl('');
    try {
      // 1. Create the listing card (uploaded photo -> 'uploaded' generated_output).
      setStep('creating');
      const fd = new FormData();
      fd.append('preset', preset);
      fd.append('price', price);
      fd.append('title', title);
      if (address) fd.append('address', address);
      if (agencyName) fd.append('agencyName', agencyName);
      fd.append('file', file);
      const card = await api.createListingCard(params.id, fd);

      // 2. Send to production (unchanged pipeline).
      setStep('packaging');
      const prod = await api.createProductionJob(card.data.id);

      // 3. Render at the chosen preset.
      setStep('rendering');
      const render = await api.createRenderJob(prod.data.id, preset, 'png');
      await pollUntilRendered(render.data.id, render.data.status);

      // 4. Resolve the export artifact for preview + download.
      const arts = await api.listRenderJobArtifacts(render.data.id);
      const artifact = arts.data[0];
      setDownloadUrl(resolveApiFileUrl(`/api/export-artifacts/${artifact.id}/file`));
      setStep('done');
    } catch (err: any) {
      setStep('error');
      setErrorMessage(err.message ?? 'İşlem başarısız oldu.');
    }
  }

  const busy = step === 'creating' || step === 'packaging' || step === 'rendering';

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2>Yeni İlan Kartı</h2>
            <p>Mülk fotoğrafını yükle, ilan bilgilerini gir — yayına hazır kart üret.</p>
          </div>
          <a href={`/clients/${params.id}`} className="btn btn-secondary">← Geri</a>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'start' }}>
        <form onSubmit={handleSubmit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label>
            Format
            <select value={preset} onChange={(e) => setPreset(e.target.value as any)} style={{ width: '100%', marginTop: '4px' }}>
              <option value="instagram_post">Kare (1080×1080)</option>
              <option value="instagram_story">Story (1080×1920)</option>
            </select>
          </label>
          <label>
            Fiyat
            <input type="text" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="₺4.250.000" style={{ width: '100%', marginTop: '4px' }} required />
          </label>
          <label>
            Başlık
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="3+1 Deniz Manzaralı Daire" style={{ width: '100%', marginTop: '4px' }} required />
          </label>
          <label>
            Adres
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Kadıköy, İstanbul" style={{ width: '100%', marginTop: '4px' }} />
          </label>
          <label>
            Emlak Ofisi / Acente
            <input type="text" value={agencyName} onChange={(e) => setAgencyName(e.target.value)} placeholder="Turyap" style={{ width: '100%', marginTop: '4px' }} />
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span>Mülk Fotoğrafı</span>
            <FileDropzone
              value={file}
              onChange={setFile}
              disabled={busy}
              accept="image/png,image/jpeg,image/webp"
              hint="PNG, JPG veya WEBP"
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? STEP_LABEL[step] : 'İlan Kartı Üret'}
          </button>
          {step === 'error' && <p style={{ color: 'var(--color-danger, #e05252)' }}>{errorMessage}</p>}
        </form>

        <div className="card" style={{ minHeight: '320px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
          {step === 'done' && downloadUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- rendered artifact served by the API (or a storage redirect) */}
              <img src={downloadUrl} alt="İlan kartı" style={{ maxWidth: '100%', maxHeight: '420px', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)' }} />
              <a href={downloadUrl} download className="btn btn-primary">⬇ İndir</a>
            </>
          ) : busy ? (
            <div className="empty-state" style={{ animation: 'pulse 1.5s infinite' }}>{STEP_LABEL[step]}</div>
          ) : (
            <div className="empty-state"><div className="icon">🏡</div><p>Önizleme burada görünecek</p></div>
          )}
        </div>
      </div>
    </div>
  );
}
