'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface WorkflowSummary {
  workflowId: string;
  name: string;
  icon: string;
  purpose: string;
  trigger: string;
  nextWorkflow: string | null;
  stepCount: number;
  approvalRequired: boolean;
  skillsUsed: string[];
  executable: { supported: boolean; futureSteps: string[]; gateSteps: string[] };
}

interface WorkflowRunItem {
  id: string;
  workflowId: string;
  clientId: string;
  clientName?: string;
  workflowName?: string;
  status: string;
  currentStepId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

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

// Başlatırken client_id dışında hangi girdiler gerekiyor — kaynak:
// workflows/*.json required_inputs + engine'in start doğrulaması.
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

export default function WorkflowsPage() {
  const [permissions, setPermissions] = useState<string[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [runs, setRuns] = useState<WorkflowRunItem[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<string>('');

  const [startOpen, setStartOpen] = useState<string | null>(null);
  const [startValues, setStartValues] = useState<Record<string, string>>({});
  const [startErrors, setStartErrors] = useState<Record<string, string | null>>({});
  const [startingWorkflow, setStartingWorkflow] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const [userResult, wfResult, runsResult, clientsResult] = await Promise.allSettled([
      api.getCurrentUser(),
      api.getWorkflows(),
      api.getWorkflowRuns(),
      api.getClients(),
    ]);

    setPermissions(userResult.status === 'fulfilled' ? (userResult.value.data.user?.permissions ?? []) : []);
    setClients(clientsResult.status === 'fulfilled' ? (clientsResult.value.data ?? []) : []);
    setRuns(runsResult.status === 'fulfilled' ? (runsResult.value.data ?? []) : []);

    if (wfResult.status === 'fulfilled') {
      setWorkflows(wfResult.value.data ?? []);
      setLoadError(null);
    } else {
      setWorkflows([]);
      setLoadError(wfResult.reason?.message ?? 'İş akışları yüklenirken hata oluştu.');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadAll().finally(() => setLoading(false));
  }, [loadAll]);

  const setStartError = (workflowId: string, message: string | null) =>
    setStartErrors((prev) => ({ ...prev, [workflowId]: message }));

  function handleStartClick(wf: WorkflowSummary) {
    const fields = START_FIELDS[wf.workflowId] ?? [];
    if (fields.length > 0 && startOpen !== wf.workflowId) {
      setStartOpen(wf.workflowId);
      setStartValues({});
      setStartError(wf.workflowId, null);
      return;
    }
    doStart(wf);
  }

  async function doStart(wf: WorkflowSummary) {
    if (!selectedClient) return;
    const fields = START_FIELDS[wf.workflowId] ?? [];
    const missing = fields.filter((f) => f.required && !(startValues[f.key] ?? '').trim()).map((f) => f.label);
    if (missing.length > 0) {
      setStartError(wf.workflowId, `Zorunlu alanlar eksik: ${missing.join(', ')}`);
      return;
    }
    const input: Record<string, unknown> = {};
    for (const f of fields) {
      const value = (startValues[f.key] ?? '').trim();
      if (value) input[f.key] = value;
    }

    setStartingWorkflow(wf.workflowId);
    setStartError(wf.workflowId, null);
    try {
      const res = await api.startWorkflow(wf.workflowId, selectedClient, input);
      window.location.href = `/workflow-runs/${res.data.run.id}`;
    } catch (err: any) {
      setStartError(wf.workflowId, err.message ?? 'İş akışı başlatılamadı.');
      setStartingWorkflow(null);
    }
  }

  if (loading) {
    return <div className="empty-state" style={{ animation: 'pulse 1.5s infinite' }}>🔄 İş akışları yükleniyor...</div>;
  }

  const canStart = permissions.includes('workflows:start');
  const iconByWorkflowId: Record<string, string> = {};
  workflows.forEach((w) => { iconByWorkflowId[w.workflowId] = w.icon; });

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h2>🔄 İş Akışı Stüdyosu</h2>
        <p>Kreatif üretim hattı — bir müşteri seçin ve iş akışlarını çalıştırın</p>
      </div>

      <ErrorNote message={loadError} />

      {/* Client Selection */}
      <div className="card" style={{ marginBottom: '32px' }}>
        <div className="card-title" style={{ marginBottom: '12px' }}>Müşteri Seçin</div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'end' }}>
          <div className="form-group" style={{ margin: 0, flex: 1 }}>
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
        </div>
      </div>

      {/* Workflow Pipeline */}
      <div style={{ marginBottom: '32px' }}>
        <h3 style={{ fontFamily: 'Outfit', fontSize: '1.1rem', color: 'var(--color-text-accent)', marginBottom: '16px' }}>
          🎯 Üretim Hattı
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {workflows.map((wf, idx) => {
            const fields = START_FIELDS[wf.workflowId] ?? [];
            const isStarting = startingWorkflow === wf.workflowId;
            const startTitle = !canStart
              ? 'Bu işlemi çalıştırmak için yetkiniz yok'
              : !selectedClient
                ? 'Önce bir müşteri seçin'
                : 'Bu iş akışını seçili müşteri için başlat';

            return (
              <div key={wf.workflowId} style={{ display: 'flex', alignItems: 'stretch', gap: '0' }}>
                {/* Pipeline connector */}
                <div style={{
                  width: '48px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  position: 'relative',
                }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: 'var(--radius-full)',
                    background: 'var(--gradient-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    color: 'white',
                    zIndex: 2,
                    marginTop: '16px',
                  }}>
                    {idx + 1}
                  </div>
                  {idx < workflows.length - 1 && (
                    <div style={{
                      width: '2px',
                      flex: 1,
                      background: 'var(--color-border)',
                      marginTop: '4px',
                    }} />
                  )}
                </div>

                {/* Workflow card */}
                <div className="card" style={{ flex: 1, marginBottom: '8px', padding: '16px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                      <span style={{ fontSize: '1.5rem' }}>{wf.icon}</span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                          <a href={`/workflows/${wf.workflowId}`} style={{ color: 'inherit' }}>{wf.name}</a>
                          {!wf.executable.supported && (
                            <span className="badge badge-warning" style={{ marginLeft: '8px' }}>🔮 Gelecek özellik içerir</span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                          {wf.purpose}
                        </div>
                        <div style={{ display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap' }}>
                          {wf.skillsUsed.map((s) => (
                            <span key={s} className="tag" style={{ fontSize: '0.7rem', padding: '1px 6px' }}>{s}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{wf.stepCount} adım</span>
                      {wf.nextWorkflow && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                          → {wf.nextWorkflow}
                        </span>
                      )}
                      <a href={`/workflows/${wf.workflowId}`} style={{ fontSize: '0.8rem', color: 'var(--color-text-accent)' }}>
                        Detay →
                      </a>
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={!canStart || !selectedClient || isStarting}
                        title={startTitle}
                        onClick={() => handleStartClick(wf)}
                      >
                        {isStarting ? '⏳ Başlatılıyor...' : '▶ Başlat'}
                      </button>
                    </div>
                  </div>

                  {/* Inline start inputs (workflow ek girdi istiyorsa) */}
                  {startOpen === wf.workflowId && fields.length > 0 && (
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'end' }}>
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
                        className="btn btn-primary btn-sm"
                        disabled={!canStart || !selectedClient || isStarting}
                        title={startTitle}
                        onClick={() => doStart(wf)}
                      >
                        {isStarting ? '⏳ Başlatılıyor...' : '▶ Çalıştır'}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={isStarting}
                        onClick={() => { setStartOpen(null); setStartError(wf.workflowId, null); }}
                      >
                        Vazgeç
                      </button>
                    </div>
                  )}

                  <ErrorNote message={startErrors[wf.workflowId] ?? null} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Workflow Runs */}
      <div>
        <h3 style={{ fontFamily: 'Outfit', fontSize: '1.1rem', color: 'var(--color-text-accent)', marginBottom: '16px' }}>
          📊 İş Akışı Çalıştırmaları
        </h3>

        {runs.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '32px', color: 'var(--color-text-muted)' }}>
            Henüz iş akışı çalıştırması yok. Yukarıdan bir müşteri seçin ve iş akışı başlatın.
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>İş Akışı</th>
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
                      <td>
                        <span style={{ marginRight: '6px' }}>{iconByWorkflowId[run.workflowId] ?? '⚙️'}</span>
                        <strong>{run.workflowName ?? run.workflowId}</strong>
                      </td>
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
