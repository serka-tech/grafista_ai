'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DemoStepNote } from '@/components/demo-step-note';
import { platformLabel, formatLabel, prettify } from '@/lib/enum-labels';

// Same local ErrorNote idiom as briefs/[id]/page.tsx and layout-plans/page.tsx.
function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p style={{ color: 'var(--color-danger, #f87171)', fontSize: '0.85rem', marginTop: '8px' }}>
      ⚠ {message}
    </p>
  );
}

// F2 fix — these badges/tags used to show the raw English enum value
// (ContentIdeaSchema.status / PlatformEnum / ContentFormatEnum in
// packages/schemas/src/content.ts) in an otherwise Turkish UI. Backend
// values are untouched; these are UI-only display label maps. Any value not
// in the map (e.g. a future enum addition) falls back to a prettified
// version of the raw value, never a raw untouched string.
const IDEA_STATUS_LABELS: Record<string, { class: string; label: string }> = {
  draft: { class: 'badge-neutral', label: 'Taslak' },
  pending_approval: { class: 'badge-warning', label: 'Onay Bekliyor' },
  approved: { class: 'badge-success', label: 'Onaylandı' },
  rejected: { class: 'badge-danger', label: 'Reddedildi' },
  revision_requested: { class: 'badge-info', label: 'Revizyon İstendi' },
};

// Platform / format Turkish labels + prettify() fallback now live in the shared
// @/lib/enum-labels module (imported above) so every screen reads the same maps.

// F3 fix: legacy 'draft' rows (older seed data, predating this UI — new ideas
// are always created as 'pending_approval', see content-ideation.ts) used to
// show NO action buttons at all — a dead end. Approve/reject have no
// from-state gate on the backend (routes/approvals.ts), so treating 'draft'
// the same as 'pending_approval' here is a safe, backward-compatible fix.
const ACTIONABLE_IDEA_STATUSES = ['draft', 'pending_approval'];

export default function ContentPage({ params }: { params: { id: string } }) {
  const [ideas, setIdeas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [platform, setPlatform] = useState('instagram_post');
  const [topic, setTopic] = useState('');
  const [generateError, setGenerateError] = useState<string | null>(null);
  // Approve/reject errors, keyed by content idea id, shown inline on that idea's card.
  const [actionErrors, setActionErrors] = useState<Record<string, string | null>>({});

  useEffect(() => {
    api.getContentIdeas(params.id).then((res) => setIdeas(res.data)).catch(console.error).finally(() => setLoading(false));
  }, [params.id]);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await api.generateContentIdeas(params.id, { platform, topic: topic || undefined, optionCount: 3 });
      setIdeas([...res.data, ...ideas]);
    } catch (err: any) {
      setGenerateError(err.message ?? 'İçerik fikri üretimi başarısız oldu.');
    }
    setGenerating(false);
  };

  const handleApprove = async (id: string) => {
    setActionErrors((prev) => ({ ...prev, [id]: null }));
    try {
      await api.approveIdea(id);
      setIdeas(ideas.map(i => i.id === id ? { ...i, status: 'approved' } : i));
    } catch (err: any) {
      setActionErrors((prev) => ({ ...prev, [id]: err.message ?? 'Onaylama başarısız oldu.' }));
    }
  };

  const handleReject = async (id: string) => {
    setActionErrors((prev) => ({ ...prev, [id]: null }));
    try {
      await api.rejectIdea(id);
      setIdeas(ideas.map(i => i.id === id ? { ...i, status: 'rejected' } : i));
    } catch (err: any) {
      setActionErrors((prev) => ({ ...prev, [id]: err.message ?? 'Reddetme işlemi başarısız oldu.' }));
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div><h2>💡 İçerik Üretici</h2><p>Kampanyalar için içerik fikirleri üretin ve onaylayın</p></div>
          <a href={`/clients/${params.id}`} className="btn btn-secondary">← Geri</a>
        </div>
      </div>

      <DemoStepNote
        step="MVP Demo Akışı · 5-6. Adım"
        text="Fikir üretip onaylayın, sonra onaylı fikrin altından tasarım brifi oluşturup onaylayın."
      />

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
        <ErrorNote message={generateError} />
      </div>

      {/* Ideas List */}
      {loading ? (
        <div className="empty-state" style={{ animation: 'pulse 1.5s infinite' }}>Fikirler yükleniyor...</div>
      ) : ideas.length === 0 ? (
        <div className="empty-state"><div className="icon">💡</div><p>Henüz içerik fikri yok. Yukarıdan üretin!</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {ideas.map((idea) => {
            const statusInfo = IDEA_STATUS_LABELS[idea.status] ?? { class: 'badge-neutral', label: prettify(idea.status) };
            const isActionable = ACTIONABLE_IDEA_STATUSES.includes(idea.status);
            return (
              <div key={idea.id} className={`card approval-card ${idea.status === 'approved' ? 'approved' : isActionable ? 'pending' : ''}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div className="card-title">{idea.title}</div>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>{idea.description}</p>
                  </div>
                  <span className={`badge ${statusInfo.class}`}>{statusInfo.label}</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
                  <span className="tag">{platformLabel(idea.platform)}</span>
                  {idea.format && <span className="tag">{formatLabel(idea.format)}</span>}
                  {idea.campaignName && <span className="tag tag-accent">{idea.campaignName}</span>}
                </div>
                {idea.hook && <p style={{ color: 'var(--color-text-accent)', fontSize: '0.9rem', marginTop: '12px', fontStyle: 'italic' }}>&quot;{idea.hook}&quot;</p>}
                {/* F3 fix: 'draft' used to be a dead end with no action at
                    all — approve/reject have no from-state gate on the
                    backend, so a legacy draft row can be actioned exactly
                    like a pending_approval one. */}
                {isActionable && (
                  <>
                    <div className="approval-actions">
                      <button className="btn btn-success btn-sm" onClick={() => handleApprove(idea.id)}>✓ Onayla</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleReject(idea.id)}>✕ Reddet</button>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '6px' }}>
                      Sıradaki adım: Fikri onayla
                    </p>
                  </>
                )}
                {idea.status === 'approved' && (
                  <div style={{ marginTop: '12px' }}>
                    <button className="btn btn-primary btn-sm" onClick={() => api.createDesignBrief(idea.id).then(res => window.location.href = `/briefs/${res.data.id}`)}>
                      📋 Tasarım Brifi Oluştur
                    </button>
                    <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '6px' }}>
                      Sıradaki adım: Tasarım brifi oluştur
                    </p>
                  </div>
                )}
                <ErrorNote message={actionErrors[idea.id] ?? null} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
