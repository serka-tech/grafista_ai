'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

const STATUS_BADGES: Record<string, { class: string; label: string }> = {
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

const STEP_TYPE_LABELS: Record<string, string> = {
  system: 'Sistem',
  user_action: 'Kullanıcı Aksiyonu',
  ai_task: 'AI Görevi',
  approval_gate: 'Onay Kapısı',
  worker_task: 'Worker Görevi',
};

// packages/schemas/src/content.ts PlatformEnum değerleri (dashboard'ın schemas
// bağımlılığı yok — liste elle senkron tutulur).
const PLATFORM_OPTIONS = [
  'instagram_post', 'instagram_story', 'instagram_reel', 'instagram_carousel',
  'facebook_post', 'facebook_story', 'twitter_post', 'linkedin_post', 'tiktok',
  'youtube_thumbnail', 'youtube_short', 'pinterest', 'email_header', 'web_banner', 'other',
];

type StartField = {
  key: string;
  label: string;
  required: boolean;
  kind: 'text' | 'platform';
  placeholder?: string;
};

// Başlatırken client_id dışında hangi girdiler gerekiyor — /workflows sayfası
// ile aynı kopya (kaynak: workflows/*.json required_inputs + engine doğrulaması).
const START_FIELDS: Record<string, StartField[]> = {
  'style-library-ingestion': [
    { key: 'design_files', label: 'Tasarım dosyaları', required: true, kind: 'text', placeholder: 'Yüklenen referans dosya adları (virgülle)' },
  ],
  'content-generation': [
    { key: 'campaign_goal', label: 'Kampanya hedefi', required: true, kind: 'text', placeholder: 'Örn: Yaz koleksiyonu lansmanı' },
    { key: 'platform', label: 'Platform', required: true, kind: 'platform' },
  ],
  'design-brief': [
    { key: 'content_idea_id', label: 'İçerik fikri ID', required: true, kind: 'text', placeholder: 'Onaylı içerik fikri UUID' },
  ],
  'layout-generation': [
    { key: 'design_brief_id', label: 'Tasarım brifi ID', required: true, kind: 'text', placeholder: 'Onaylı tasarım brifi UUID' },
  ],
  'visual-generation': [
    { key: 'design_brief_id', label: 'Tasarım brifi ID', required: true, kind: 'text', placeholder: 'Onaylı tasarım brifi UUID' },
    { key: 'layout_plan_id', label: 'Yerleşim planı ID', required: false, kind: 'text', placeholder: 'Onaylı yerleşim planı UUID (üretim kapısı için gerekli)' },
  ],
  'photoshop-production': [
    { key: 'layout_plan_id', label: 'Yerleşim planı ID', required: true, kind: 'text', placeholder: 'Onaylı yerleşim planı UUID' },
    { key: 'design_brief_id', label: 'Tasarım brifi ID', required: true, kind: 'text', placeholder: 'Onaylı tasarım brifi UUID' },
  ],
  'creative-qa': [
    { key: 'design_brief_id', label: 'Tasarım brifi ID', required: true, kind: 'text', placeholder: 'Onaylı tasarım brifi UUID' },
    { key: 'layout_plan_id', label: 'Yerleşim planı ID', required: true, kind: 'text', placeholder: 'Onaylı yerleşim planı UUID' },
  ],
  'revision-learning': [
    { key: 'feedback_entries', label: 'Geri bildirim girdileri', required: true, kind: 'text', placeholder: 'Revizyon geri bildirim notları' },
  ],
  'monthly-content-calendar': [
    { key: 'month', label: 'Ay', required: true, kind: 'text', placeholder: 'YYYY-MM' },
  ],
};

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p style={{ color: 'var(--color-danger, #f87171)', fontSize: '0.85rem', marginTop: '8px' }}>
      ⚠ {message}
    </p>
  );
}

export default function WorkflowDetailPage({ params }: { params: { id: string } }) {
  const workflowId = params.id;

  const [permissions, setPermissions] = useState<string[]>([]);
  const [workflow, setWorkflow] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedClient, setSelectedClient] = useState<string>('');
  const [startValues, setStartValues] = useState<Record<string, string>>({});
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const loadAll = useCallback(async () => {
    const [userResult, wfResult, runsResult, clientsResult] = await Promise.allSettled([
      api.getCurrentUser(),
      api.getWorkflow(workflowId),
      api.getWorkflowRuns({ workflowId }),
      api.getClients(),
    ]);

    setPermissions(userResult.status === 'fulfilled' ? (userResult.value.data.user?.permissions ?? []) : []);
    setClients(clientsResult.status === 'fulfilled' ? (clientsResult.value.data ?? []) : []);
    setRuns(runsResult.status === 'fulfilled' ? (runsResult.value.data ?? []) : []);

    if (wfResult.status === 'fulfilled') {
      setWorkflow(wfResult.value.data);
      setLoadError(null);
    } else {
      setWorkflow(null);
      setLoadError(wfResult.reason?.message ?? 'İş akışı tanımı yüklenirken hata oluştu.');
    }
  }, [workflowId]);

  useEffect(() => {
    setLoading(true);
    loadAll().finally(() => setLoading(false));
  }, [loadAll]);

  async function handleStart() {
    if (!selectedClient) return;
    const fields = START_FIELDS[workflowId] ?? [];
    const missing = fields.filter((f) => f.required && !(startValues[f.key] ?? '').trim()).map((f) => f.label);
    if (missing.length > 0) {
      setStartError(`Zorunlu alanlar eksik: ${missing.join(', ')}`);
      return;
    }
    const input: Record<string, unknown> = {};
    for (const f of fields) {
      const value = (startValues[f.key] ?? '').trim();
      if (value) input[f.key] = value;
    }

    setStarting(true);
    setStartError(null);
    try {
      const res = await api.startWorkflow(workflowId, selectedClient, input);
      window.location.href = `/workflow-runs/${res.data.run.id}`;
    } catch (err: any) {
      setStartError(err.message ?? 'İş akışı başlatılamadı.');
      setStarting(false);
    }
  }

  if (loading) {
    return <div className="empty-state" style={{ animation: 'pulse 1.5s infinite' }}>🔄 İş akışı tanımı yükleniyor...</div>;
  }

  if (!workflow) {
    return (
      <div className="empty-state">
        <div className="icon">🔄</div>
        <p>{loadError ?? 'İş akışı bulunamadı.'}</p>
        <a href="/workflows" className="btn btn-primary" style={{ marginTop: '16px' }}>← İş Akışlarına Dön</a>
      </div>
    );
  }

  const canStart = permissions.includes('workflows:start');
  const fields = START_FIELDS[workflowId] ?? [];
  const requiredInputs = Object.entries(workflow.requiredInputs ?? {}) as [string, any][];
  const startTitle = !canStart
    ? 'Bu işlemi çalıştırmak için yetkiniz yok'
    : !selectedClient
      ? 'Önce bir müşteri seçin'
      : 'Bu iş akışını seçili müşteri için başlat';

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h2>{workflow.icon} {workflow.name}</h2>
            <p>{workflow.purpose}</p>
          </div>
          <a href="/workflows" className="btn btn-secondary">← İş Akışlarına Dön</a>
        </div>
      </div>

      <ErrorNote message={loadError} />

      {/* Meta */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px' }}>
          <span className="tag">{workflow.stepCount} adım</span>
          {workflow.approvalRequired && <span className="tag tag-accent">🛑 Onay gerektirir</span>}
          {!workflow.executable?.supported && (
            <span className="badge badge-warning">🔮 Gelecek özellik içerir</span>
          )}
          {workflow.nextWorkflow && <span className="tag">→ {workflow.nextWorkflow}</span>}
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
          <strong>Tetikleyici:</strong> {workflow.trigger}
        </div>
        <div className="tag-list" style={{ marginTop: '10px' }}>
          {(workflow.skillsUsed ?? []).map((s: string) => (
            <span key={s} className="tag">{s}</span>
          ))}
        </div>
      </div>

      {/* Start */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-title" style={{ marginBottom: '12px' }}>▶ Başlat</div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'end' }}>
          <div className="form-group" style={{ margin: 0, minWidth: '220px' }}>
            <label className="form-label">Müşteri</label>
            <select
              className="form-select"
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
            >
              <option value="">— Müşteri seçin —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          {fields.map((field) => (
            <div key={field.key} className="form-group" style={{ margin: 0, minWidth: '220px' }}>
              <label className="form-label">
                {field.label} {field.required ? '' : '(opsiyonel)'}
              </label>
              {field.kind === 'platform' ? (
                <select
                  className="form-select"
                  value={startValues[field.key] ?? ''}
                  onChange={(e) => setStartValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                >
                  <option value="">— Platform seçin —</option>
                  {PLATFORM_OPTIONS.map((p) => (
                    <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  className="form-input"
                  placeholder={field.placeholder}
                  value={startValues[field.key] ?? ''}
                  onChange={(e) => setStartValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                />
              )}
            </div>
          ))}
          <button
            className="btn btn-primary"
            disabled={!canStart || !selectedClient || starting}
            title={startTitle}
            onClick={handleStart}
          >
            {starting ? '⏳ Başlatılıyor...' : '▶ Başlat'}
          </button>
        </div>
        <ErrorNote message={startError} />
      </div>

      {/* Required inputs */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-title" style={{ marginBottom: '12px' }}>📥 Girdiler</div>
        {requiredInputs.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Bu iş akışı ek girdi tanımlamıyor.</p>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Alan</th>
                  <th>Tip</th>
                  <th>Zorunlu</th>
                </tr>
              </thead>
              <tbody>
                {requiredInputs.map(([key, spec]) => (
                  <tr key={key}>
                    <td><strong>{key}</strong></td>
                    <td style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{spec?.type ?? '—'}</td>
                    <td>
                      {spec?.required
                        ? <span className="badge badge-warning">Zorunlu</span>
                        : <span className="badge badge-neutral">Opsiyonel</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Steps */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontFamily: 'Outfit', fontSize: '1.1rem', color: 'var(--color-text-accent)', marginBottom: '16px' }}>
          🧭 Adımlar
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {(workflow.steps ?? []).map((step: any, idx: number) => {
            const binding = step.binding;
            const isGate = binding?.bindingKind === 'approval_gate';
            const isFuture = binding?.bindingKind === 'future';
            return (
              <div key={step.step_id} style={{ display: 'flex', alignItems: 'stretch', gap: '0' }}>
                <div style={{ width: '48px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: 'var(--radius-full)',
                    background: isFuture ? 'var(--color-bg-glass)' : 'var(--gradient-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    color: 'white',
                    zIndex: 2,
                    marginTop: '16px',
                  }}>
                    {isFuture ? '🔮' : step.order}
                  </div>
                  {idx < (workflow.steps ?? []).length - 1 && (
                    <div style={{ width: '2px', flex: 1, background: 'var(--color-border)', marginTop: '4px' }} />
                  )}
                </div>
                <div className="card" style={{ flex: 1, marginBottom: '8px', padding: '14px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{step.action}</div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{step.step_id}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className="tag">{STEP_TYPE_LABELS[step.type] ?? step.type}</span>
                    {isGate && <span className="tag tag-accent">🛑 Onay kapısı</span>}
                    {isFuture && <span className="badge badge-warning">🔮 Gelecek özellik</span>}
                    {binding?.requiredPermission && (
                      <span className="tag" style={{ fontSize: '0.7rem' }}>🔑 {binding.requiredPermission}</span>
                    )}
                    {(binding?.skillIds ?? []).map((s: string) => (
                      <span key={s} className="tag" style={{ fontSize: '0.7rem' }}>{s}</span>
                    ))}
                  </div>
                  {isFuture && binding?.futureMessage && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '8px' }}>
                      {binding.futureMessage}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Skills */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontFamily: 'Outfit', fontSize: '1.1rem', color: 'var(--color-text-accent)', marginBottom: '16px' }}>
          🧠 Kullanılan Beceriler
        </h3>
        {(workflow.skills ?? []).length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-muted)' }}>
            Bu iş akışı beceri tanımlamıyor.
          </div>
        ) : (
          <div className="card-grid">
            {(workflow.skills ?? []).map((skill: any) => (
              <div key={skill.id} className="card">
                <div className="card-header">
                  <div className="card-title">{skill.name}</div>
                  <span className="tag">{skill.id}</span>
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>
                  {skill.description}
                </p>
                {skill.whenToUse && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                    <strong>Ne zaman kullanılır:</strong> {skill.whenToUse}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Runs of this workflow */}
      <div>
        <h3 style={{ fontFamily: 'Outfit', fontSize: '1.1rem', color: 'var(--color-text-accent)', marginBottom: '16px' }}>
          📊 Bu İş Akışının Çalıştırmaları
        </h3>
        {runs.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '32px', color: 'var(--color-text-muted)' }}>
            Bu iş akışı henüz hiç çalıştırılmadı.
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Müşteri</th>
                  <th>Durum</th>
                  <th>Güncel Adım</th>
                  <th>Güncelleme</th>
                  <th>İşlemler</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const statusInfo = STATUS_BADGES[run.status] ?? { class: 'badge-neutral', label: run.status };
                  return (
                    <tr key={run.id}>
                      <td>{run.clientName ?? '—'}</td>
                      <td>
                        <span className={`badge ${statusInfo.class}`}>{statusInfo.label}</span>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                        {run.currentStepId ?? '—'}
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                        {new Date(run.updatedAt).toLocaleString()}
                      </td>
                      <td>
                        <a href={`/workflow-runs/${run.id}`} style={{ color: 'var(--color-text-accent)', fontSize: '0.85rem' }}>
                          Detay →
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
