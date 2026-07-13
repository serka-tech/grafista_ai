'use client';

import { Fragment, useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Packaging Phase A — organization team management (OWNER-only, org:manage).
 * Invite members, change their role, enable/disable them, and scope them to
 * specific clients (client_members: empty = sees ALL org clients).
 */

const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'OWNER', label: 'Sahip (tüm yetkiler)' },
  { value: 'CREATIVE_DIRECTOR', label: 'Kreatif Direktör' },
  { value: 'DESIGNER', label: 'Tasarımcı' },
  { value: 'CONTENT_MANAGER', label: 'İçerik Yöneticisi' },
];

interface OrgUser {
  id: string;
  email: string;
  name?: string;
  status: string;
  roles: string[];
}

export default function TeamPage() {
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('DESIGNER');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [inviteError, setInviteError] = useState('');

  // Per-user client scoping (userId -> assigned client id set)
  const [expandedUser, setExpandedUser] = useState<string>('');
  const [scopeByUser, setScopeByUser] = useState<Record<string, string[]>>({});
  const [rowError, setRowError] = useState('');

  async function loadAll() {
    setLoading(true);
    try {
      const [usersRes, clientsRes, invitesRes, meRes] = await Promise.all([
        api.getOrgUsers(),
        api.getClients(),
        api.getOrgInvites(),
        api.getCurrentUser(),
      ]);
      setUsers(usersRes.data);
      setClients(clientsRes.data.map((c: any) => ({ id: c.id, name: c.name })));
      setInvites(invitesRes.data);
      setCurrentUserId(meRes.data.user?.id ?? '');
    } catch (err: any) {
      if (err?.status === 403) setForbidden(true);
      else console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError('');
    setInviteLink('');
    setInviteBusy(true);
    try {
      const res = await api.inviteOrgUser(inviteEmail.trim(), inviteRole);
      setInviteLink(`${window.location.origin}${res.data.acceptPath}`);
      setInviteEmail('');
      const invitesRes = await api.getOrgInvites();
      setInvites(invitesRes.data);
    } catch (err: any) {
      setInviteError(err.message ?? 'Davet oluşturulamadı.');
    } finally {
      setInviteBusy(false);
    }
  }

  async function handleRoleChange(user: OrgUser, role: string) {
    setRowError('');
    try {
      await api.setOrgUserRole(user.id, role);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, roles: [role] } : u)));
    } catch (err: any) {
      setRowError(err.message ?? 'Rol güncellenemedi.');
    }
  }

  async function handleToggleStatus(user: OrgUser) {
    setRowError('');
    const next = user.status === 'active' ? 'disabled' : 'active';
    try {
      await api.setOrgUserStatus(user.id, next);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, status: next } : u)));
    } catch (err: any) {
      setRowError(err.message ?? 'Durum güncellenemedi.');
    }
  }

  async function toggleExpand(userId: string) {
    if (expandedUser === userId) {
      setExpandedUser('');
      return;
    }
    setExpandedUser(userId);
    if (!scopeByUser[userId]) {
      try {
        const res = await api.getOrgUserClients(userId);
        setScopeByUser((prev) => ({ ...prev, [userId]: res.data }));
      } catch (err: any) {
        setRowError(err.message ?? 'Müşteri erişimi okunamadı.');
      }
    }
  }

  async function toggleClient(userId: string, clientId: string, assigned: boolean) {
    setRowError('');
    try {
      if (assigned) {
        await api.removeOrgUserClient(userId, clientId);
      } else {
        await api.assignOrgUserClient(userId, clientId);
      }
      const res = await api.getOrgUserClients(userId);
      setScopeByUser((prev) => ({ ...prev, [userId]: res.data }));
    } catch (err: any) {
      setRowError(err.message ?? 'Müşteri ataması güncellenemedi.');
    }
  }

  if (forbidden) {
    return (
      <div className="animate-fade-in">
        <div className="page-header"><h2>👥 Ekip</h2></div>
        <div className="card">Bu sayfayı görüntülemek için Sahip (OWNER) yetkisi gerekir.</div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h2>👥 Ekip</h2>
        <p>Organizasyon kullanıcılarını yönet, davet et ve müşterilere ata</p>
      </div>

      {/* Invite */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-title" style={{ marginBottom: '16px' }}>Yeni Kullanıcı Davet Et</div>
        <form onSubmit={handleInvite} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: '1 1 220px' }}>
            E-posta
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              style={{ width: '100%', marginTop: '4px' }}
              required
            />
          </label>
          <label style={{ flex: '0 0 200px' }}>
            Rol
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} style={{ width: '100%', marginTop: '4px' }}>
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-primary" disabled={inviteBusy}>
            {inviteBusy ? 'Oluşturuluyor...' : 'Davet Oluştur'}
          </button>
        </form>
        {inviteError && <p style={{ color: 'var(--color-danger, #e05252)', marginTop: '10px' }}>{inviteError}</p>}
        {inviteLink && (
          <div style={{ marginTop: '14px' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
              Davet bağlantısı oluşturuldu. Kullanıcıya iletin (7 gün geçerli):
            </p>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <code style={{ flex: 1, fontSize: '0.8rem', wordBreak: 'break-all', color: 'var(--color-text-accent)' }}>{inviteLink}</code>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => navigator.clipboard?.writeText(inviteLink)}
              >
                Kopyala
              </button>
            </div>
          </div>
        )}
        {invites.length > 0 && (
          <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: '12px' }}>
            Bekleyen davet: {invites.map((i) => i.email).join(', ')}
          </p>
        )}
      </div>

      {/* Users */}
      <div className="card">
        <div className="card-title" style={{ marginBottom: '16px' }}>Kullanıcılar</div>
        {rowError && <p style={{ color: 'var(--color-danger, #e05252)', marginBottom: '10px' }}>{rowError}</p>}
        {loading ? (
          <div style={{ animation: 'pulse 1.5s infinite', color: 'var(--color-text-muted)' }}>Yükleniyor...</div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr><th>E-posta</th><th>Rol</th><th>Durum</th><th>İşlemler</th></tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelf = u.id === currentUserId;
                  const role = u.roles[0] ?? '';
                  const scoped = scopeByUser[u.id] ?? [];
                  return (
                    <Fragment key={u.id}>
                      <tr>
                        <td style={{ fontWeight: 600 }}>
                          {u.email}
                          {u.name ? <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}> · {u.name}</span> : null}
                          {isSelf ? <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}> (siz)</span> : null}
                        </td>
                        <td>
                          <select
                            value={role}
                            onChange={(e) => handleRoleChange(u, e.target.value)}
                            disabled={isSelf}
                            style={{ fontSize: '0.85rem' }}
                          >
                            {ROLE_OPTIONS.map((r) => (
                              <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <span className={`badge ${u.status === 'active' ? 'badge-success' : 'badge-danger'}`}>
                            {u.status === 'active' ? '● Aktif' : '○ Devre dışı'}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <button className="btn btn-secondary btn-sm" onClick={() => toggleExpand(u.id)}>
                              {expandedUser === u.id ? 'Kapat' : 'Müşteri Ata'}
                            </button>
                            {!isSelf && (
                              <button className="btn btn-secondary btn-sm" onClick={() => handleToggleStatus(u)}>
                                {u.status === 'active' ? 'Devre Dışı Bırak' : 'Aktifleştir'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expandedUser === u.id && (
                        <tr>
                          <td colSpan={4} style={{ background: 'var(--color-bg-subtle, rgba(0,0,0,0.02))' }}>
                            <div style={{ padding: '4px 0' }}>
                              <p style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>
                                Seçili müşteri yoksa kullanıcı <strong>tüm müşterileri</strong> görür. Bir veya daha fazla
                                seçilirse yalnızca onlara erişir.
                              </p>
                              {clients.length === 0 ? (
                                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>Henüz müşteri yok.</span>
                              ) : (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                                  {clients.map((c) => {
                                    const assigned = scoped.includes(c.id);
                                    return (
                                      <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
                                        <input
                                          type="checkbox"
                                          checked={assigned}
                                          onChange={() => toggleClient(u.id, c.id, assigned)}
                                        />
                                        {c.name}
                                      </label>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
