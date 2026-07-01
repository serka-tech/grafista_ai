'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface WorkflowDef {
  workflow_id: string;
  name: string;
  icon: string;
  purpose: string;
  skills: string[];
  next: string | null;
}

interface WorkflowInstance {
  id: string;
  workflowId: string;
  clientId: string;
  clientName?: string;
  workflowName?: string;
  workflowIcon?: string;
  status: string;
  currentStep: number;
  totalSteps: number;
  startedAt: string;
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
};

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [startingWorkflow, setStartingWorkflow] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.getWorkflows(),
      api.getWorkflowInstances(),
      api.getClients(),
    ]).then(([wfRes, instRes, clientRes]) => {
      setWorkflows(wfRes.data);
      setInstances(instRes.data);
      setClients(clientRes.data);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const handleStartWorkflow = async (workflowId: string) => {
    if (!selectedClient) return;
    setStartingWorkflow(workflowId);
    try {
      const res = await api.startWorkflow(workflowId, selectedClient);
      setInstances([res.data, ...instances]);
    } catch (err) {
      console.error(err);
    }
    setStartingWorkflow(null);
  };

  if (loading) return <div className="empty-state" style={{ animation: 'pulse 1.5s infinite' }}>🔄 İş akışları yükleniyor...</div>;

  // Group workflows by pipeline order
  const pipelineOrder = [
    'client-onboarding', 'style-library-ingestion', 'content-generation',
    'design-brief', 'layout-generation', 'visual-generation',
    'photoshop-production', 'creative-qa', 'revision-learning',
    'monthly-content-calendar',
  ];

  const orderedWorkflows = pipelineOrder
    .map(id => workflows.find(w => w.workflow_id === id))
    .filter(Boolean) as WorkflowDef[];

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h2>🔄 İş Akışı Stüdyosu</h2>
        <p>Kreatif üretim hattı — bir müşteri seçin ve iş akışlarını çalıştırın</p>
      </div>

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
          {orderedWorkflows.map((wf, idx) => (
            <div key={wf.workflow_id} style={{ display: 'flex', alignItems: 'stretch', gap: '0' }}>
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
                {idx < orderedWorkflows.length - 1 && (
                  <div style={{
                    width: '2px',
                    flex: 1,
                    background: 'var(--color-border)',
                    marginTop: '4px',
                  }} />
                )}
              </div>

              {/* Workflow card */}
              <div className="card" style={{
                flex: 1,
                marginBottom: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                  <span style={{ fontSize: '1.5rem' }}>{wf.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{wf.name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                      {wf.purpose}
                    </div>
                    <div style={{ display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap' }}>
                      {wf.skills.map(s => (
                        <span key={s} className="tag" style={{ fontSize: '0.7rem', padding: '1px 6px' }}>{s}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {wf.next && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                      → {wf.next}
                    </span>
                  )}
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!selectedClient || startingWorkflow === wf.workflow_id}
                    onClick={() => handleStartWorkflow(wf.workflow_id)}
                  >
                    {startingWorkflow === wf.workflow_id ? '⏳' : '▶'} Başlat
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Active Workflow Instances */}
      <div>
        <h3 style={{ fontFamily: 'Outfit', fontSize: '1.1rem', color: 'var(--color-text-accent)', marginBottom: '16px' }}>
          📊 Aktif İş Akışları
        </h3>

        {instances.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '32px', color: 'var(--color-text-muted)' }}>
            Henüz aktif iş akışı yok. Yukarıdan bir müşteri seçin ve iş akışı başlatın.
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>İş Akışı</th>
                  <th>Müşteri</th>
                  <th>Durum</th>
                  <th>İlerleme</th>
                  <th>Başlangıç</th>
                  <th>İşlemler</th>
                </tr>
              </thead>
              <tbody>
                {instances.map((inst) => {
                  const statusInfo = STATUS_BADGES[inst.status] ?? { class: 'badge-neutral', label: inst.status };
                  return (
                    <tr key={inst.id}>
                      <td>
                        <span style={{ marginRight: '6px' }}>{inst.workflowIcon}</span>
                        <strong>{inst.workflowName}</strong>
                      </td>
                      <td>{inst.clientName}</td>
                      <td>
                        <span className={`badge ${statusInfo.class}`}>{statusInfo.label}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{
                            width: '80px',
                            height: '6px',
                            background: 'var(--color-bg-glass)',
                            borderRadius: 'var(--radius-full)',
                            overflow: 'hidden',
                          }}>
                            <div style={{
                              width: `${(inst.currentStep / inst.totalSteps) * 100}%`,
                              height: '100%',
                              background: inst.status === 'completed' ? 'var(--gradient-success)' : 'var(--gradient-primary)',
                              borderRadius: 'var(--radius-full)',
                              transition: 'width var(--transition-base)',
                            }} />
                          </div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                            {inst.currentStep}/{inst.totalSteps}
                          </span>
                        </div>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                        {new Date(inst.startedAt).toLocaleDateString()}
                      </td>
                      <td>
                        {inst.status === 'waiting_for_approval' && (
                          <button
                            className="btn btn-success btn-sm"
                            onClick={() => api.advanceWorkflow(inst.id, { approval: 'approved' }).then(res => {
                              setInstances(instances.map(i => i.id === inst.id ? res.data : i));
                            })}
                          >
                            ✓ Onayla
                          </button>
                        )}
                        {inst.status === 'in_progress' && (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => api.advanceWorkflow(inst.id, { stepResult: 'completed' }).then(res => {
                              setInstances(instances.map(i => i.id === inst.id ? res.data : i));
                            })}
                          >
                            → Sonraki Adım
                          </button>
                        )}
                        {inst.status === 'completed' && (
                          <span style={{ fontSize: '0.8rem', color: '#34d399' }}>✓ Tamamlandı</span>
                        )}
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
