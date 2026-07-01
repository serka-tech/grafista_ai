'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function ContentPage({ params }: { params: { id: string } }) {
  const [ideas, setIdeas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [platform, setPlatform] = useState('instagram_post');
  const [topic, setTopic] = useState('');

  useEffect(() => {
    api.getContentIdeas(params.id).then((res) => setIdeas(res.data)).catch(console.error).finally(() => setLoading(false));
  }, [params.id]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await api.generateContentIdeas(params.id, { platform, topic: topic || undefined, optionCount: 3 });
      setIdeas([...res.data, ...ideas]);
    } catch (err) { console.error(err); }
    setGenerating(false);
  };

  const handleApprove = async (id: string) => {
    try {
      await api.approveIdea(id);
      setIdeas(ideas.map(i => i.id === id ? { ...i, status: 'approved' } : i));
    } catch (err) { console.error(err); }
  };

  const statusColors: Record<string, string> = {
    draft: 'badge-neutral', pending_approval: 'badge-warning', approved: 'badge-success', rejected: 'badge-danger', revision_requested: 'badge-info',
  };

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div><h2>💡 İçerik Üretici</h2><p>Kampanyalar için içerik fikirleri üretin ve onaylayın</p></div>
          <a href={`/clients/${params.id}`} className="btn btn-secondary">← Geri</a>
        </div>
      </div>

      {/* Generator Form */}
      <div className="card" style={{ marginBottom: '32px' }}>
        <div className="card-title" style={{ marginBottom: '16px' }}>Yeni İçerik Fikirleri Üret</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '16px', alignItems: 'end' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Platform</label>
            <select className="form-select" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="instagram_post">Instagram Gönderisi</option>
              <option value="instagram_story">Instagram Hikayesi</option>
              <option value="instagram_carousel">Instagram Karusel</option>
              <option value="instagram_reel">Instagram Reels</option>
              <option value="facebook_post">Facebook Gönderisi</option>
              <option value="twitter_post">Twitter/X Gönderisi</option>
              <option value="linkedin_post">LinkedIn Gönderisi</option>
              <option value="tiktok">TikTok</option>
              <option value="youtube_thumbnail">YouTube Kapak Görseli</option>
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Konu (opsiyonel)</label>
            <input className="form-input" placeholder="örn. Yaz kampanyası" value={topic} onChange={(e) => setTopic(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={handleGenerate} disabled={generating} style={{ height: '40px' }}>
            {generating ? '⏳ Üretiliyor...' : '✨ 3 Fikir Üret'}
          </button>
        </div>
      </div>

      {/* Ideas List */}
      {loading ? (
        <div className="empty-state" style={{ animation: 'pulse 1.5s infinite' }}>Fikirler yükleniyor...</div>
      ) : ideas.length === 0 ? (
        <div className="empty-state"><div className="icon">💡</div><p>Henüz içerik fikri yok. Yukarıdan üretin!</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {ideas.map((idea) => (
            <div key={idea.id} className={`card approval-card ${idea.status === 'approved' ? 'approved' : idea.status === 'pending_approval' ? 'pending' : ''}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="card-title">{idea.title}</div>
                  <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>{idea.description}</p>
                </div>
                <span className={`badge ${statusColors[idea.status] ?? 'badge-neutral'}`}>{idea.status.replace(/_/g, ' ')}</span>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
                <span className="tag">{idea.platform.replace(/_/g, ' ')}</span>
                <span className="tag">{idea.format?.replace(/_/g, ' ')}</span>
                {idea.campaignName && <span className="tag tag-accent">{idea.campaignName}</span>}
              </div>
              {idea.hook && <p style={{ color: 'var(--color-text-accent)', fontSize: '0.9rem', marginTop: '12px', fontStyle: 'italic' }}>&quot;{idea.hook}&quot;</p>}
              {idea.status === 'pending_approval' && (
                <div className="approval-actions">
                  <button className="btn btn-success btn-sm" onClick={() => handleApprove(idea.id)}>✓ Onayla</button>
                  <button className="btn btn-danger btn-sm" onClick={() => api.rejectIdea(idea.id).then(() => setIdeas(ideas.map(i => i.id === idea.id ? { ...i, status: 'rejected' } : i)))}>✕ Reddet</button>
                </div>
              )}
              {idea.status === 'approved' && (
                <div style={{ marginTop: '12px' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => api.createDesignBrief(idea.id).then(res => window.location.href = `/briefs/${res.data.id}`)}>
                    📋 Tasarım Brifi Oluştur
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
