'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function SettingsPage() {
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getProviders().then((res) => setProviders(res.data)).catch(console.error).finally(() => setLoading(false));
  }, []);

  return (
    <div className="animate-fade-in">
      <div className="page-header"><h2>⚙️ Ayarlar</h2><p>API sağlayıcı yapılandırması ve sistem ayarları</p></div>

      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-title" style={{ marginBottom: '16px' }}>AI Sağlayıcı Durumu</div>
        {loading ? (
          <div style={{ animation: 'pulse 1.5s infinite', color: 'var(--color-text-muted)' }}>Yükleniyor...</div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr><th>Sağlayıcı</th><th>Durum</th><th>Ortam Değişkeni</th></tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.name}>
                    <td style={{ fontWeight: 600, textTransform: 'capitalize' }}>{p.name}</td>
                    <td>
                      <span className={`badge ${p.available ? 'badge-success' : 'badge-danger'}`}>
                        {p.available ? '● Bağlı' : '○ Yapılandırılmadı'}
                      </span>
                    </td>
                    <td><code style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{p.envVar}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title" style={{ marginBottom: '12px' }}>Yapılandırma Notları</div>
        <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <li style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>• Proje kök dizinindeki <code style={{ color: 'var(--color-text-accent)' }}>.env</code> dosyasına API anahtarlarını ekleyin</li>
          <li style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>• Ortam değişkenlerini değiştirdikten sonra API sunucusunu yeniden başlatın</li>
          <li style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>• En az bir metin sağlayıcısı (OpenAI, Claude veya Gemini) önerilir</li>
          <li style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>• KIE AI ve Higgsfield isteğe bağlıdır (video/görsel üretimi)</li>
        </ul>
      </div>
    </div>
  );
}
