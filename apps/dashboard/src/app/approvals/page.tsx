'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getApprovals().then((res) => setApprovals(res.data)).catch(console.error).finally(() => setLoading(false));
  }, []);

  return (
    <div className="animate-fade-in">
      <div className="page-header"><h2>✅ Onay Kuyruğu</h2><p>Bekleyen içerik fikirlerini ve tasarım briflerini inceleyip onaylayın</p></div>

      {loading ? (
        <div className="empty-state" style={{ animation: 'pulse 1.5s infinite' }}>Yükleniyor...</div>
      ) : approvals.length === 0 ? (
        <div className="empty-state"><div className="icon">✅</div><p>Her şey tamam! Bekleyen onay yok.</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {approvals.map((item) => (
            <div key={item.entityId} className="card approval-card pending">
              <div className="card-header">
                <div>
                  <div className="card-title">{item.title}</div>
                  <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>{item.clientName} • {item.entityType.replace(/_/g, ' ')}</p>
                </div>
                <span className="badge badge-warning">bekliyor</span>
              </div>
              <div className="approval-actions">
                <button className="btn btn-success btn-sm" onClick={async () => { await api.approveIdea(item.entityId); setApprovals(approvals.filter(a => a.entityId !== item.entityId)); }}>✓ Onayla</button>
                <button className="btn btn-danger btn-sm" onClick={async () => { await api.rejectIdea(item.entityId); setApprovals(approvals.filter(a => a.entityId !== item.entityId)); }}>✕ Reddet</button>
                <a href={`/clients/${item.clientId}/content`} className="btn btn-secondary btn-sm">Detayları Gör →</a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
