'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Packaging Phase A — invite acceptance. Reached from a one-time link an OWNER
 * shares (?token=...). The invitee sets their name + password; on success the
 * API creates their user in the inviting org and logs them in (session cookie),
 * then we land them in the app. Reached without a session — the dashboard
 * middleware exempts /accept-invite.
 *
 * The token is read from window.location (client-only) to avoid the App Router
 * useSearchParams prerender/Suspense constraint on this standalone page.
 */
export default function AcceptInvitePage() {
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get('token') ?? '');
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage('');
    if (!token) {
      setStatus('error');
      setErrorMessage('Davet bağlantısı geçersiz (token bulunamadı).');
      return;
    }
    if (password.length < 8) {
      setStatus('error');
      setErrorMessage('Şifre en az 8 karakter olmalı.');
      return;
    }
    if (password !== confirm) {
      setStatus('error');
      setErrorMessage('Şifreler eşleşmiyor.');
      return;
    }
    setStatus('submitting');
    try {
      await api.acceptInvite(token, password, name || undefined);
      window.location.href = '/';
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err.message ?? 'Davet kabul edilemedi.');
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
      <form
        onSubmit={handleSubmit}
        className="card"
        style={{ width: '100%', maxWidth: '380px', display: 'flex', flexDirection: 'column', gap: '16px' }}
      >
        <div>
          <h2 style={{ marginBottom: '4px' }}>Ekibe Katıl</h2>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
            Hesabını oluşturmak için adını ve bir şifre belirle.
          </p>
        </div>
        <label>
          Ad Soyad (opsiyonel)
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', marginTop: '4px' }} />
        </label>
        <label>
          Şifre
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: '100%', marginTop: '4px' }}
            required
            autoComplete="new-password"
          />
        </label>
        <label>
          Şifre (tekrar)
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            style={{ width: '100%', marginTop: '4px' }}
            required
            autoComplete="new-password"
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={status === 'submitting'}>
          {status === 'submitting' ? 'Oluşturuluyor...' : 'Hesabı Oluştur ve Giriş Yap'}
        </button>
        {status === 'error' && <p style={{ color: 'var(--color-danger, #e05252)' }}>{errorMessage}</p>}
      </form>
    </div>
  );
}
