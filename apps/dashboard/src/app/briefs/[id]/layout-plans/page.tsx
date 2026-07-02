'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

const STATUS_BADGES: Record<string, { class: string; label: string }> = {
  generated: { class: 'badge-info', label: 'Oluşturuldu' },
  approved: { class: 'badge-success', label: 'Onaylandı' },
  rejected: { class: 'badge-danger', label: 'Reddedildi' },
  needs_revision: { class: 'badge-warning', label: 'Revizyon Gerekiyor' },
};

const APPROVABLE_STATUSES = ['generated', 'needs_revision'];

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p style={{ color: 'var(--color-danger, #f87171)', fontSize: '0.85rem', marginTop: '8px' }}>
      ⚠ {message}
    </p>
  );
}

function formatPosition(position: any): string {
  if (!position) return '—';
  const parts: string[] = [];
  if (typeof position.x === 'number') parts.push(`x:${position.x}`);
  if (typeof position.y === 'number') parts.push(`y:${position.y}`);
  if (typeof position.width === 'number') parts.push(`w:${position.width}`);
  if (typeof position.height === 'number') parts.push(`h:${position.height}`);
  return parts.length > 0 ? parts.join(' ') : '—';
}

type ActionState = {
  approving: boolean;
  approveError: string | null;
  rejecting: boolean;
  rejectError: string | null;
  notes: string;
};

function emptyActionState(): ActionState {
  return { approving: false, approveError: null, rejecting: false, rejectError: null, notes: '' };
}

export default function LayoutPlansPage({ params }: { params: { id: string } }) {
  const designBriefId = params.id;

  const [permissions, setPermissions] = useState<string[]>([]);
  const [brief, setBrief] = useState<any>(null);
  const [layoutPlans, setLayoutPlans] = useState<any[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});

  const getActionState = (planId: string) => actionStates[planId] ?? emptyActionState();
  const updateActionState = (planId: string, patch: Partial<ActionState>) =>
    setActionStates((prev) => ({ ...prev, [planId]: { ...emptyActionState(), ...prev[planId], ...patch } }));

  const loadAll = useCallback(async () => {
    const [userResult, briefResult, layoutPlansResult] = await Promise.allSettled([
      api.getCurrentUser(),
      api.getDesignBrief(designBriefId),
      api.getLayoutPlansForBrief(designBriefId),
    ]);

    setPermissions(userResult.status === 'fulfilled' ? (userResult.value.data.user?.permissions ?? []) : []);
    setBrief(briefResult.status === 'fulfilled' ? briefResult.value.data : null);

    if (layoutPlansResult.status === 'fulfilled') {
      const plans = [...(layoutPlansResult.value.data ?? [])].sort((a, b) => (a.alternativeIndex ?? 0) - (b.alternativeIndex ?? 0));
      setLayoutPlans(plans);
      setLoadError(null);
    } else {
      setLayoutPlans([]);
      setLoadError(layoutPlansResult.reason?.message ?? 'Yerleşim planları yüklenirken hata oluştu.');
    }
  }, [designBriefId]);

  useEffect(() => {
    setLoading(true);
    loadAll().finally(() => setLoading(false));
  }, [loadAll]);

  async function handleApprove(planId: string) {
    updateActionState(planId, { approving: true, approveError: null });
    try {
      await api.approveLayoutPlan(planId);
      await loadAll();
    } catch (err: any) {
      updateActionState(planId, { approveError: err.message ?? 'Onaylama başarısız oldu.' });
    } finally {
      updateActionState(planId, { approving: false });
    }
  }

  async function handleReject(planId: string) {
    const notes = getActionState(planId).notes;
    updateActionState(planId, { rejecting: true, rejectError: null });
    try {
      await api.rejectLayoutPlan(planId, notes.trim() || undefined);
      updateActionState(planId, { notes: '' });
      await loadAll();
    } catch (err: any) {
      updateActionState(planId, { rejectError: err.message ?? 'Reddetme işlemi başarısız oldu.' });
    } finally {
      updateActionState(planId, { rejecting: false });
    }
  }

  if (loading) {
    return <div className="empty-state" style={{ animation: 'pulse 1.5s infinite' }}>🎨 Yerleşim planları yükleniyor...</div>;
  }

  const canApprove = permissions.includes('layout_plans:approve');
  const canReject = permissions.includes('layout_plans:reject');

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h2>🎨 Yerleşim Planı Alternatifleri</h2>
            <p>{brief ? `${brief.title} • ${brief.platform?.replace(/_/g, ' ')}` : 'Tasarım brifi için üretilen yerleşim planları'}</p>
          </div>
          <a href={`/briefs/${designBriefId}`} className="btn btn-secondary">← Brife Dön</a>
        </div>
      </div>

      <ErrorNote message={loadError} />

      {layoutPlans.length === 0 && !loadError && (
        <div className="empty-state">
          <div className="icon">🎨</div>
          <p>Bu brif için henüz yerleşim planı oluşturulmadı.</p>
          <a href={`/briefs/${designBriefId}`} className="btn btn-primary" style={{ marginTop: '16px' }}>
            ← Brife dön ve oluştur
          </a>
        </div>
      )}

      {layoutPlans.length > 0 && (
        <div className="card-grid">
          {layoutPlans.map((plan) => {
            const statusInfo = STATUS_BADGES[plan.status] ?? { class: 'badge-neutral', label: plan.status };
            const state = getActionState(plan.id);
            const canActOnThis = APPROVABLE_STATUSES.includes(plan.status);
            const imageLayers = (plan.layers ?? []).filter((l: any) => l.type === 'image');
            const orderedLayers = [...(plan.layers ?? [])].sort((a: any, b: any) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

            const approveTitle = !canApprove
              ? 'Bu işlemi çalıştırmak için yetkiniz yok'
              : !canActOnThis
                ? 'Bu alternatif şu an onaylanabilir durumda değil'
                : 'Bu yerleşim planı alternatifini onayla';

            const rejectTitle = !canReject
              ? 'Bu işlemi çalıştırmak için yetkiniz yok'
              : !canActOnThis
                ? 'Bu alternatif şu an reddedilebilir durumda değil'
                : 'Notlu gönderirsen alternatif revizyona düşer, boş gönderirsen reddedilir';

            return (
              <div key={plan.id} className="card dna-section">
                <div className="card-header">
                  <div className="card-title">Alternatif {plan.alternativeIndex ?? '—'}</div>
                  <span className={`badge ${statusInfo.class}`}>{statusInfo.label}</span>
                </div>

                <div className="tag-list" style={{ marginBottom: '10px' }}>
                  <span className="tag">{plan.format ?? '—'}</span>
                  <span className="tag">{plan.canvas?.width ?? '?'} × {plan.canvas?.height ?? '?'}</span>
                  {plan.canvas?.dpi && <span className="tag">{plan.canvas.dpi} dpi</span>}
                  {plan.provider && <span className="tag tag-accent">{plan.provider}{plan.model ? ` / ${plan.model}` : ''}</span>}
                </div>

                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '10px' }}>
                  <div><strong>Başlık konumu:</strong> {formatPosition(plan.headlinePlacement?.position)}</div>
                  <div><strong>Alt başlık konumu:</strong> {formatPosition(plan.subtitlePlacement?.position)}</div>
                  <div><strong>Logo konumu:</strong> {formatPosition(plan.logoPlacement?.position)}</div>
                  <div><strong>CTA alanı:</strong> {formatPosition(plan.ctaArea?.position)}</div>
                </div>

                <div style={{ marginBottom: '10px' }}>
                  <span className="form-label">Görsel Alanları ({imageLayers.length})</span>
                  {imageLayers.length > 0 ? (
                    imageLayers.map((l: any) => (
                      <div key={l.id} style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', padding: '2px 0' }}>
                        • {l.name ?? l.id} — {formatPosition(l.position)}
                      </div>
                    ))
                  ) : (
                    <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Bu alternatifte görsel katmanı yok.</p>
                  )}
                </div>

                <div style={{ marginBottom: '10px' }}>
                  <span className="form-label">Katman Sırası ({orderedLayers.length})</span>
                  {orderedLayers.length > 0 ? (
                    <div style={{ maxHeight: '140px', overflowY: 'auto' }}>
                      {orderedLayers.map((l: any) => (
                        <div key={l.id} style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', padding: '2px 0' }}>
                          • {l.name ?? l.id} ({l.type}) — z:{l.zIndex ?? 0}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Katman bulunamadı.</p>
                  )}
                </div>

                <div style={{ marginBottom: '10px' }}>
                  <span className="form-label">Kullanılan DesignDNA Kuralları</span>
                  {plan.designDnaRulesUsed?.length > 0 ? (
                    <div className="tag-list">
                      {plan.designDnaRulesUsed.map((rule: string, i: number) => (
                        <span key={i} className="tag">{rule}</span>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                      Bu alternatif için DesignDNA bağlamı kullanılmadı.
                    </p>
                  )}
                </div>

                {plan.designerNotes && (
                  <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', fontStyle: 'italic', marginBottom: '10px' }}>
                    “{plan.designerNotes}”
                  </p>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
                  <button
                    className="btn btn-success btn-sm"
                    disabled={!canApprove || !canActOnThis || state.approving}
                    title={approveTitle}
                    onClick={() => handleApprove(plan.id)}
                  >
                    {state.approving ? '⏳ Onaylanıyor...' : '✓ Onayla'}
                  </button>

                  <input
                    type="text"
                    className="form-input"
                    placeholder="Revizyon notu (opsiyonel)"
                    value={state.notes}
                    onChange={(e) => updateActionState(plan.id, { notes: e.target.value })}
                    style={{ width: '180px' }}
                    disabled={!canReject || !canActOnThis || state.rejecting}
                  />
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={!canReject || !canActOnThis || state.rejecting}
                    title={rejectTitle}
                    onClick={() => handleReject(plan.id)}
                  >
                    {state.rejecting ? '⏳ Gönderiliyor...' : '✕ Reddet'}
                  </button>
                </div>

                <ErrorNote message={state.approveError} />
                <ErrorNote message={state.rejectError} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
