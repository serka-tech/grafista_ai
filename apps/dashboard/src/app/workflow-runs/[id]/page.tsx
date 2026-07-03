'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

const RUN_STATUS_BADGES: Record<string, { class: string; label: string }> = {
  draft: { class: 'badge-neutral', label: 'Taslak' },
  waiting_for_approval: { class: 'badge-warning', label: 'Onay Bekliyor' },
  approved: { class: 'badge-success', label: 'Onaylandı' },
  in_progress: { class: 'badge-info', label: 'Devam Ediyor' },
  qa_failed: { class: 'badge-danger', label: 'KK Başarısız' },
  completed: { class: 'badge-success', label: 'Tamamlandı' },
  cancelled: { class: 'badge-neutral', label: 'İptal Edildi' },
  failed: { class: 'badge-danger', label: 'Başarısız' },
  blocked_future_feature: { class: 'badge-warning', label: 'Gelecek Özellik Bekliyor' },
};

const STEP_STATUS_BADGES: Record<string, { class: string; label: string }> = {
  pending: { class: 'badge-neutral', label: 'Bekliyor' },
  in_progress: { class: 'badge-info', label: 'Devam Ediyor' },
  waiting_for_approval: { class: 'badge-warning', label: 'Onay Bekliyor' },
  approved: { class: 'badge-success', label: 'Onaylandı' },
  rejected: { class: 'badge-danger', label: 'Reddedildi' },
  skipped: { class: 'badge-neutral', label: 'Atlandı' },
  completed: { class: 'badge-success', label: 'Tamamlandı' },
  failed: { class: 'badge-danger', label: 'Başarısız' },
};

const STEP_TYPE_LABELS: Record<string, string> = {
  system: 'Sistem',
  user_action: 'Kullanıcı Aksiyonu',
  ai_task: 'AI Görevi',
  approval_gate: 'Onay Kapısı',
  worker_task: 'Worker Görevi',
};

// apps/api/src/routes/workflows.ts WORKFLOW_ICONS ile aynı (sunum amaçlı kopya).
const WORKFLOW_ICONS: Record<string, string> = {
  'client-onboarding': '🏢',
  'style-library-ingestion': '📐',
  'content-generation': '💡',
  'design-brief': '📋',
  'layout-generation': '🧩',
  'visual-generation': '🎨',
  'photoshop-production': '🖌️',
  'creative-qa': '✅',
  'revision-learning': '🧠',
  'monthly-content-calendar': '📅',
};

// Hangi workflow hangi onay kapısı türünü kullanıyor (kaynak:
// apps/api/src/workflows/step-bindings.ts). Listede olmayanlar henüz
// uygulanmamış gelecek özellik kapılarıdır.
const GATE_KINDS: Record<string, 'design_dna' | 'content_idea' | 'design_brief' | 'layout_plan' | 'creative_qa'> = {
  'style-library-ingestion': 'design_dna',
  'content-generation': 'content_idea',
  'design-brief': 'design_brief',
  'layout-generation': 'layout_plan',
  'creative-qa': 'creative_qa',
};

// Engine bu durumlardan iptale izin verir (workflow-runs repo markCancelled guard).
const CANCELLABLE_STATUSES = ['draft', 'in_progress', 'waiting_for_approval', 'blocked_future_feature', 'qa_failed'];

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p style={{ color: 'var(--color-danger, #f87171)', fontSize: '0.85rem', marginTop: '8px' }}>
      ⚠ {message}
    </p>
  );
}

function JsonDetails({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && Object.keys(value as object).length === 0) return null;
  return (
    <details style={{ marginTop: '8px' }}>
      <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{label}</summary>
      <pre style={{
        fontSize: '0.75rem',
        background: 'var(--color-bg-glass)',
        padding: '10px',
        borderRadius: '8px',
        overflowX: 'auto',
        maxHeight: '280px',
        marginTop: '6px',
        whiteSpace: 'pre-wrap',
      }}>
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function stepCircleBackground(status: string): string {
  if (status === 'completed' || status === 'approved') return 'var(--gradient-success)';
  if (status === 'failed' || status === 'rejected') return '#f87171';
  if (status === 'in_progress' || status === 'waiting_for_approval') return '#fbbf24';
  return 'var(--color-bg-glass)';
}

export default function WorkflowRunDetailPage({ params }: { params: { id: string } }) {
  const runId = params.id;

  const [permissions, setPermissions] = useState<string[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [selectedEntityId, setSelectedEntityId] = useState('');

  const loadAll = useCallback(async () => {
    const [userResult, runResult] = await Promise.allSettled([
      api.getCurrentUser(),
      api.getWorkflowRun(runId),
    ]);

    setPermissions(userResult.status === 'fulfilled' ? (userResult.value.data.user?.permissions ?? []) : []);

    if (runResult.status === 'fulfilled') {
      setDetail(runResult.value.data);
      setLoadError(null);
    } else {
      setDetail(null);
      setLoadError(runResult.reason?.message ?? 'Çalıştırma yüklenirken hata oluştu.');
    }
  }, [runId]);

  useEffect(() => {
    setLoading(true);
    loadAll().finally(() => setLoading(false));
  }, [loadAll]);

  async function handleAdvance() {
    setAdvancing(true);
    setAdvanceError(null);
    try {
      await api.advanceWorkflowRun(runId);
      await loadAll();
    } catch (err: any) {
      const message = err.status === 502
        ? 'Adım tamamlanamadı — AI sağlayıcı veya yanıt doğrulaması başarısız oldu. Adım başarısız olarak kaydedildi.'
        : (err.message ?? 'Adım çalıştırılamadı.');
      setAdvanceError(message);
      // Başarısız adım engine tarafından kalıcı olarak kaydedilir — güncel durumu çek.
      await loadAll();
    } finally {
      setAdvancing(false);
    }
  }

  async function handleApprove(gateKind: string | undefined) {
    setApproving(true);
    setApproveError(null);
    try {
      const body: { contentIdeaId?: string; layoutPlanId?: string } = {};
      if (gateKind === 'content_idea' && selectedEntityId) body.contentIdeaId = selectedEntityId;
      if (gateKind === 'layout_plan' && selectedEntityId) body.layoutPlanId = selectedEntityId;
      await api.approveWorkflowStep(runId, body);
      setSelectedEntityId('');
      setNotes('');
      await loadAll();
    } catch (err: any) {
      setApproveError(err.message ?? 'Onaylama başarısız oldu.');
    } finally {
      setApproving(false);
    }
  }

  async function handleReject(gateKind: string | undefined) {
    setRejecting(true);
    setRejectError(null);
    try {
      const body: { contentIdeaId?: string; layoutPlanId?: string; notes?: string } = {
        notes: notes.trim() || undefined,
      };
      if (gateKind === 'content_idea' && selectedEntityId) body.contentIdeaId = selectedEntityId;
      if (gateKind === 'layout_plan' && selectedEntityId) body.layoutPlanId = selectedEntityId;
      await api.rejectWorkflowStep(runId, body);
      setSelectedEntityId('');
      setNotes('');
      await loadAll();
    } catch (err: any) {
      setRejectError(err.message ?? 'Reddetme işlemi başarısız oldu.');
    } finally {
      setRejecting(false);
    }
  }

  async function handleCancel() {
    if (!window.confirm('Bu çalıştırmayı iptal etmek istediğinize emin misiniz?')) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await api.cancelWorkflowRun(runId);
      await loadAll();
    } catch (err: any) {
      setCancelError(err.message ?? 'İptal işlemi başarısız oldu.');
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return <div className="empty-state" style={{ animation: 'pulse 1.5s infinite' }}>🔄 Çalıştırma yükleniyor...</div>;
  }

  if (!detail) {
    return (
      <div className="empty-state">
        <div className="icon">🔄</div>
        <p>{loadError ?? 'Çalıştırma bulunamadı.'}</p>
        <a href="/workflows" className="btn btn-primary" style={{ marginTop: '16px' }}>← İş Akışlarına Dön</a>
      </div>
    );
  }

  const run = detail.run;
  const steps: any[] = detail.steps ?? [];
  const outputs: any[] = detail.outputs ?? [];
  const approvals: any[] = detail.approvals ?? [];

  const statusInfo = RUN_STATUS_BADGES[run.status] ?? { class: 'badge-neutral', label: run.status };
  const icon = WORKFLOW_ICONS[run.workflowId] ?? '⚙️';

  const canAdvance = permissions.includes('workflows:advance');
  const canApprove = permissions.includes('workflows:approve');
  const canCancel = permissions.includes('workflows:cancel');

  const currentStep = run.currentStepId ? steps.find((s) => s.stepId === run.currentStepId) : undefined;
  const gateKind = run.status === 'waiting_for_approval' ? GATE_KINDS[run.workflowId] : undefined;
  const isPlaceholderGate = run.status === 'waiting_for_approval' && !gateKind;

  // Kapı seçenekleri: bu çalıştırmanın ürettiği gerçek varlıklar (adım çıktıları).
  const ideaStepOutput = steps.find((s) => s.stepId === 'generate_ideas')?.outputJson;
  const ideaOptions: { id: string; label: string }[] = Array.isArray(ideaStepOutput?.ideas)
    ? ideaStepOutput.ideas.map((i: any) => ({ id: i.id, label: i.title ?? i.id }))
    : outputs.filter((o) => o.entityType === 'content_idea' && o.entityId).map((o) => ({ id: o.entityId, label: o.entityId }));
  const planStepOutput = steps.find((s) => s.stepId === 'generate_layouts')?.outputJson;
  const planOptions: { id: string; label: string }[] = Array.isArray(planStepOutput?.layoutPlans)
    ? planStepOutput.layoutPlans.map((p: any) => ({ id: p.id, label: `Alternatif ${p.alternativeIndex ?? '—'} (${p.id.slice(0, 8)}...)` }))
    : outputs.filter((o) => o.entityType === 'layout_plan' && o.entityId).map((o) => ({ id: o.entityId, label: o.entityId }));

  const gateOptions = gateKind === 'content_idea' ? ideaOptions : gateKind === 'layout_plan' ? planOptions : [];

  const showAdvance = run.status === 'in_progress' && currentStep && currentStep.status === 'pending';
  const cancellable = CANCELLABLE_STATUSES.includes(run.status);

  const advanceTitle = !canAdvance
    ? 'Bu işlemi çalıştırmak için yetkiniz yok'
    : 'Sıradaki adımı çalıştır';
  const approveTitle = !canApprove
    ? 'Bu işlemi çalıştırmak için yetkiniz yok'
    : 'Bekleyen onay kapısını onayla';
  const rejectTitle = !canApprove
    ? 'Bu işlemi çalıştırmak için yetkiniz yok'
    : 'Notlu gönderirsen ilgili kayıt revizyona düşebilir, boş gönderirsen reddedilir';
  const cancelTitle = !canCancel
    ? 'Bu işlemi çalıştırmak için yetkiniz yok'
    : 'Bu çalıştırmayı iptal et';

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h2>{icon} {run.workflowName ?? run.workflowId}</h2>
            <p>{run.clientName ?? '—'} • Çalıştırma {run.id.slice(0, 8)}...</p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <a href="/workflows" className="btn btn-secondary">← İş Akışlarına Dön</a>
            {cancellable && (
              <button
                className="btn btn-danger"
                disabled={!canCancel || cancelling}
                title={cancelTitle}
                onClick={handleCancel}
              >
                {cancelling ? '⏳ İptal ediliyor...' : '✕ İptal Et'}
              </button>
            )}
          </div>
        </div>
      </div>

      <ErrorNote message={loadError} />
      <ErrorNote message={cancelError} />

      {/* Run header card */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px' }}>
          <span className={`badge ${statusInfo.class}`}>{statusInfo.label}</span>
          {run.currentStepId && <span className="tag">Güncel adım: {run.currentStepId}</span>}
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div><strong>Başlatan:</strong> {run.startedBy}</div>
          <div><strong>Oluşturulma:</strong> {new Date(run.createdAt).toLocaleString()}</div>
          <div><strong>Güncelleme:</strong> {new Date(run.updatedAt).toLocaleString()}</div>
          {run.completedAt && <div><strong>Tamamlanma:</strong> {new Date(run.completedAt).toLocaleString()}</div>}
        </div>
        <JsonDetails label="Çalıştırma girdisi (input JSON)" value={run.inputJson} />
        <JsonDetails label="Çalıştırma çıktısı (output JSON)" value={run.outputJson} />
      </div>

      {/* Status banners */}
      {run.status === 'blocked_future_feature' && (
        <div className="card" style={{ marginBottom: '24px', borderLeft: '3px solid #fbbf24' }}>
          <p style={{ fontSize: '0.9rem' }}>
            🔮 Bu workflow gelecekteki bir özellikte devam edecek: {run.errorJson?.message ?? 'Özellik henüz uygulanmadı.'}
          </p>
          {run.errorJson?.pipelineState === 'ready_for_visual_generation' && (
            <p style={{ fontSize: '0.85rem', color: '#34d399', marginTop: '8px' }}>
              ✓ Üretim hattı temiz — pipelineState: ready_for_visual_generation. Görsel üretim uygulandığında bu çalıştırma kaldığı yerden devam edebilir.
            </p>
          )}
        </div>
      )}

      {run.status === 'failed' && (
        <div className="card" style={{ marginBottom: '24px', borderLeft: '3px solid #f87171' }}>
          <p style={{ fontSize: '0.9rem', color: 'var(--color-danger, #f87171)' }}>
            ⚠ Çalıştırma başarısız oldu: {run.errorJson?.message ?? 'Hata detayı kaydedilmedi.'}
          </p>
          <JsonDetails label="Hata detayı (error JSON)" value={run.errorJson} />
        </div>
      )}

      {run.status === 'qa_failed' && (
        <div className="card" style={{ marginBottom: '24px', borderLeft: '3px solid #f87171' }}>
          <p style={{ fontSize: '0.9rem', color: 'var(--color-danger, #f87171)' }}>
            ⚠ Kalite kontrol engeli: {run.errorJson?.message ?? 'Creative QA skoru onay kapısını açmak için çok düşük.'}
          </p>
        </div>
      )}

      {/* Action bar */}
      {run.status === 'waiting_for_approval' && (
        <div className="card" style={{ marginBottom: '24px', borderLeft: '3px solid #fbbf24' }}>
          <div className="card-title" style={{ marginBottom: '10px' }}>🛑 Onay Kapısı Bekliyor</div>
          {isPlaceholderGate && (
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '10px' }}>
              Bu onay kapısı henüz uygulanmamış bir özelliğe ait — karar denemesi sunucu tarafından reddedilir.
            </p>
          )}
          {gateKind === 'content_idea' && (
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '10px' }}>
              Onaylanacak veya reddedilecek içerik fikrini seçin. Seçim yapmadan onaylarsanız bu çalıştırmada daha önce onaylanmış en az bir fikir aranır.
            </p>
          )}
          {gateKind === 'layout_plan' && (
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '10px' }}>
              Karar için bu çalıştırmada üretilen yerleşim planlarından birini seçmeniz gerekir.
            </p>
          )}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            {(gateKind === 'content_idea' || gateKind === 'layout_plan') && (
              <select
                className="form-select"
                style={{ width: '260px' }}
                value={selectedEntityId}
                onChange={(e) => setSelectedEntityId(e.target.value)}
                disabled={approving || rejecting}
              >
                <option value="">
                  {gateKind === 'content_idea' ? '— İçerik fikri seçin —' : '— Yerleşim planı seçin —'}
                </option>
                {gateOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            )}
            <button
              className="btn btn-success"
              disabled={!canApprove || approving || rejecting}
              title={approveTitle}
              onClick={() => handleApprove(gateKind)}
            >
              {approving ? '⏳ Onaylanıyor...' : '✓ Onayla'}
            </button>
            <input
              type="text"
              className="form-input"
              placeholder="Revizyon notu (opsiyonel)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{ width: '220px' }}
              disabled={!canApprove || approving || rejecting}
            />
            <button
              className="btn btn-danger"
              disabled={!canApprove || approving || rejecting}
              title={rejectTitle}
              onClick={() => handleReject(gateKind)}
            >
              {rejecting ? '⏳ Gönderiliyor...' : '✕ Reddet'}
            </button>
          </div>
          <ErrorNote message={approveError} />
          <ErrorNote message={rejectError} />
        </div>
      )}

      {showAdvance && (
        <div className="card" style={{ marginBottom: '24px', borderLeft: '3px solid var(--color-text-accent, #a78bfa)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <div className="card-title">Sıradaki adım: {currentStep.action}</div>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                {currentStep.stepId} • {STEP_TYPE_LABELS[currentStep.stepType] ?? currentStep.stepType}
              </p>
            </div>
            <button
              className="btn btn-primary"
              disabled={!canAdvance || advancing}
              title={advanceTitle}
              onClick={handleAdvance}
            >
              {advancing ? '⏳ Çalıştırılıyor...' : '→ Adımı Çalıştır'}
            </button>
          </div>
          <ErrorNote message={advanceError} />
        </div>
      )}

      {!showAdvance && run.status === 'in_progress' && <ErrorNote message={advanceError} />}

      {run.status === 'completed' && (
        <div className="card" style={{ marginBottom: '24px', borderLeft: '3px solid #34d399' }}>
          <p style={{ fontSize: '0.9rem', color: '#34d399' }}>✓ Tüm adımlar tamamlandı.</p>
        </div>
      )}

      {/* Step timeline */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontFamily: 'Outfit', fontSize: '1.1rem', color: 'var(--color-text-accent)', marginBottom: '16px' }}>
          🧭 Adım Zaman Çizelgesi
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {steps.map((step, idx) => {
            const stepStatusInfo = STEP_STATUS_BADGES[step.status] ?? { class: 'badge-neutral', label: step.status };
            const isFuture = step.outputJson?.futureFeature === true;
            const isCurrent = step.stepId === run.currentStepId;
            return (
              <div key={step.id} style={{ display: 'flex', alignItems: 'stretch', gap: '0' }}>
                <div style={{ width: '48px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: 'var(--radius-full)',
                    background: stepCircleBackground(step.status),
                    border: step.status === 'pending' && !isFuture ? '1px solid var(--color-border)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    color: 'white',
                    zIndex: 2,
                    marginTop: '16px',
                  }}>
                    {isFuture ? '🔮' : step.stepOrder}
                  </div>
                  {idx < steps.length - 1 && (
                    <div style={{ width: '2px', flex: 1, background: 'var(--color-border)', marginTop: '4px' }} />
                  )}
                </div>
                <div
                  className="card"
                  style={{
                    flex: 1,
                    marginBottom: '8px',
                    padding: '14px 20px',
                    border: isCurrent ? '1px solid var(--color-text-accent, #a78bfa)' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                      {step.action}
                      {isCurrent && <span className="tag tag-accent" style={{ marginLeft: '8px' }}>Güncel adım</span>}
                    </div>
                    <span className={`badge ${stepStatusInfo.class}`}>{stepStatusInfo.label}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{step.stepId}</span>
                    <span className="tag">{STEP_TYPE_LABELS[step.stepType] ?? step.stepType}</span>
                    {step.requiredPermission && (
                      <span className="tag" style={{ fontSize: '0.7rem' }}>🔑 {step.requiredPermission}</span>
                    )}
                    {(step.skillIds ?? []).map((s: string) => (
                      <span key={s} className="tag" style={{ fontSize: '0.7rem' }}>{s}</span>
                    ))}
                    {step.revisionCount > 0 && (
                      <span className="tag" style={{ fontSize: '0.7rem' }}>↻ {step.revisionCount}. revizyon</span>
                    )}
                  </div>
                  {isFuture && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '8px' }}>
                      🔮 {step.outputJson?.message ?? 'Bu adım gelecekteki bir özelliğe ait.'}
                    </p>
                  )}
                  <JsonDetails label="Girdi JSON" value={step.inputJson} />
                  <JsonDetails label="Çıktı JSON" value={step.outputJson} />
                  <JsonDetails label="Hata JSON" value={step.errorJson} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Produced entities */}
      {outputs.length > 0 && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="card-title" style={{ marginBottom: '10px' }}>📦 Üretilen Varlıklar</div>
          <div className="tag-list">
            {outputs.map((o) => (
              <span key={o.id} className="tag" title={o.entityId ?? o.outputKey}>
                {o.entityType}{o.entityId ? `: ${o.entityId.slice(0, 8)}...` : ''} ({o.outputKey})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Approval audit */}
      {approvals.length > 0 && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: '10px' }}>📝 Onay Kararları</div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Karar</th>
                  <th>Varlık</th>
                  <th>Not</th>
                  <th>Tarih</th>
                </tr>
              </thead>
              <tbody>
                {approvals.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.decision === 'approved'
                        ? <span className="badge badge-success">Onaylandı</span>
                        : <span className="badge badge-danger">Reddedildi</span>}
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                      {a.entityType ?? '—'}{a.entityId ? ` (${a.entityId.slice(0, 8)}...)` : ''}
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{a.notes ?? '—'}</td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                      {new Date(a.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
