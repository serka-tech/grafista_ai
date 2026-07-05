'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, friendlyAiErrorMessage } from '@/lib/api';

const BRIEF_STATUS_BADGES: Record<string, { class: string; label: string }> = {
  draft: { class: 'badge-neutral', label: 'Taslak' },
  in_progress: { class: 'badge-info', label: 'Devam Ediyor' },
  qa_pending: { class: 'badge-warning', label: 'Kalite Kontrolü Bekliyor' },
  qa_passed: { class: 'badge-info', label: 'Kalite Kontrolünden Geçti' },
  approved: { class: 'badge-success', label: 'Onaylandı' },
  exported: { class: 'badge-success', label: 'Dışa Aktarıldı' },
  rejected: { class: 'badge-danger', label: 'Reddedildi' },
  needs_revision: { class: 'badge-danger', label: 'Revizyon Gerekiyor' },
};

const APPROVABLE_BRIEF_STATUSES = ['draft', 'in_progress', 'qa_passed', 'needs_revision'];

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p style={{ color: 'var(--color-danger, #f87171)', fontSize: '0.85rem', marginTop: '8px' }}>
      ⚠ {message}
    </p>
  );
}

export default function BriefPage({ params }: { params: { id: string } }) {
  const briefId = params.id;

  const [permissions, setPermissions] = useState<string[]>([]);
  const [brief, setBrief] = useState<any>(null);
  const [layoutPlans, setLayoutPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  const [rejecting, setRejecting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [revisionNotes, setRevisionNotes] = useState('');

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const [userResult, briefResult, layoutPlansResult] = await Promise.allSettled([
      api.getCurrentUser(),
      api.getDesignBrief(briefId),
      api.getLayoutPlansForBrief(briefId),
    ]);

    setPermissions(userResult.status === 'fulfilled' ? (userResult.value.data.user?.permissions ?? []) : []);
    setBrief(briefResult.status === 'fulfilled' ? briefResult.value.data : null);
    setLayoutPlans(layoutPlansResult.status === 'fulfilled' ? (layoutPlansResult.value.data ?? []) : []);
  }, [briefId]);

  useEffect(() => {
    setLoading(true);
    loadAll().finally(() => setLoading(false));
  }, [loadAll]);

  async function handleApproveBrief() {
    setApproving(true);
    setApproveError(null);
    try {
      await api.approveDesignBrief(briefId);
      await loadAll();
    } catch (err: any) {
      setApproveError(err.message ?? 'Onaylama başarısız oldu.');
    } finally {
      setApproving(false);
    }
  }

  async function handleRejectBrief() {
    setRejecting(true);
    setRejectError(null);
    try {
      await api.rejectDesignBrief(briefId, revisionNotes.trim() || undefined);
      setRevisionNotes('');
      await loadAll();
    } catch (err: any) {
      setRejectError(err.message ?? 'Reddetme işlemi başarısız oldu.');
    } finally {
      setRejecting(false);
    }
  }

  async function handleGenerateLayoutPlans() {
    setGenerating(true);
    setGenerateError(null);
    try {
      await api.generateLayoutPlans(briefId);
      await loadAll();
    } catch (err: any) {
      setGenerateError(
        friendlyAiErrorMessage(err, 'Yerleşim planı oluşturma başarısız oldu.', {
          schema: 'Layout üretimi geçici olarak başarısız oldu. Tekrar deneyin.',
        })
      );
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return <div className="empty-state" style={{ animation: 'pulse 1.5s infinite' }}>📋 Brif yükleniyor...</div>;
  if (!brief) return <div className="empty-state">Brif bulunamadı</div>;

  const canApproveBrief = permissions.includes('design_briefs:approve');
  const canCreateLayout = permissions.includes('layout_plans:create');
  const briefIsApprovable = APPROVABLE_BRIEF_STATUSES.includes(brief.status);
  const briefIsApproved = brief.status === 'approved';
  const statusInfo = BRIEF_STATUS_BADGES[brief.status] ?? { class: 'badge-neutral', label: brief.status };

  const generateButtonTitle = !briefIsApproved
    ? 'Önce tasarım brifini onaylayın'
    : !canCreateLayout
      ? 'Bu işlemi çalıştırmak için yetkiniz yok'
      : 'Bu brif için 2-3 yerleşim planı alternatifi üretir';

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

      {/* ─── Brief onay/red ────────────────────────────────── */}
      <div className="card" style={{ marginTop: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span className={`badge ${statusInfo.class}`} style={{ fontSize: '0.85rem', padding: '6px 16px' }}>
            Durum: {statusInfo.label}
          </span>

          {briefIsApprovable && (
            <button
              className="btn btn-success"
              disabled={!canApproveBrief || approving}
              title={!canApproveBrief ? 'Bu işlemi çalıştırmak için yetkiniz yok' : 'Bu tasarım brifini onayla'}
              onClick={handleApproveBrief}
            >
              {approving ? '⏳ Onaylanıyor...' : '✓ Brifi Onayla'}
            </button>
          )}

          {briefIsApprovable && canApproveBrief && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Revizyon notu (opsiyonel)"
                value={revisionNotes}
                onChange={(e) => setRevisionNotes(e.target.value)}
                style={{ width: '220px' }}
                disabled={rejecting}
              />
              <button
                className="btn btn-danger"
                disabled={rejecting}
                title="Notlu gönderirsen brif revizyona düşer, boş gönderirsen reddedilir"
                onClick={handleRejectBrief}
              >
                {rejecting ? '⏳ Gönderiliyor...' : '✕ Reddet'}
              </button>
            </div>
          )}

          {!briefIsApprovable && (
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              Bu brif şu an onay/red işlemine uygun durumda değil.
            </span>
          )}
        </div>
        <ErrorNote message={approveError} />
        <ErrorNote message={rejectError} />
      </div>

      {/* ─── Yerleşim planı üretimi ───────────────────────────── */}
      <div className="card" style={{ marginTop: '24px' }}>
        <h3 style={{ fontFamily: 'Outfit', fontSize: '1rem', color: 'var(--color-text-accent)', marginBottom: '12px' }}>🎨 Yerleşim Planı</h3>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            disabled={!briefIsApproved || !canCreateLayout || generating}
            title={generateButtonTitle}
            onClick={handleGenerateLayoutPlans}
          >
            {generating ? '⏳ Oluşturuluyor (biraz sürebilir)...' : '🎨 Yerleşim Planı Oluştur'}
          </button>
          <a href={`/briefs/${briefId}/layout-plans`} className="btn btn-secondary">
            📊 Kalite kontrol ve görseller → Yerleşim Planları
          </a>
        </div>

        {!briefIsApproved && (
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '10px' }}>
            Yerleşim planı oluşturmak için önce bu brif onaylanmalı.
          </p>
        )}

        <ErrorNote message={generateError} />

        {layoutPlans.length > 0 && (
          <p style={{ marginTop: '12px' }}>
            <a href={`/briefs/${briefId}/layout-plans`} className="btn btn-secondary">
              {layoutPlans.length} Yerleşim Planı Alternatifi →
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
