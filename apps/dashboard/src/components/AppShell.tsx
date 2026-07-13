'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Login and accept-invite render standalone, without the app chrome
  // (accept-invite is reached from an emailed link, before any session exists).
  if (pathname === '/login' || pathname === '/accept-invite') {
    return <>{children}</>;
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <Header />
      <main className="main-content animate-fade-in">{children}</main>
    </div>
  );
}

function Sidebar() {
  // The team/org page is OWNER-only (org:manage) — hide the nav item for
  // everyone else; the page itself also refuses non-owners.
  const [isOwner, setIsOwner] = useState(false);
  useEffect(() => {
    api
      .getCurrentUser()
      .then((res) => setIsOwner((res.data.user?.roles ?? []).includes('OWNER')))
      .catch(() => setIsOwner(false));
  }, []);

  const systemItems = [
    ...(isOwner ? [{ href: '/settings/team', icon: '👥', label: 'Ekip' }] : []),
    { href: '/settings', icon: '⚙️', label: 'Ayarlar' },
  ];

  const navSections = [
    {
      label: 'Çalışma Alanı',
      items: [
        { href: '/', icon: '🏢', label: 'Müşteriler' },
        { href: '/workflows', icon: '🔄', label: 'İş Akışları' },
        { href: '/approvals', icon: '✅', label: 'Onay Kuyruğu' },
        { href: '/outputs', icon: '📦', label: 'Çıktı Geçmişi' },
      ],
    },
    {
      label: 'Sistem',
      items: systemItems,
    },
  ];

  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        <h1>Grafista AI Studio</h1>
        <span>Kreatif Zeka Sistemi</span>
      </div>
      <div className="sidebar-nav">
        {navSections.map((section) => (
          <div key={section.label}>
            <div className="sidebar-section-label">{section.label}</div>
            {section.items.map((item) => (
              <a key={item.href} href={item.href} className="nav-item">
                <span className="icon">{item.icon}</span>
                {item.label}
              </a>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}

function Header() {
  const [user, setUser] = useState<{ email: string; roles: string[] } | null>(null);

  useEffect(() => {
    api
      .getCurrentUser()
      .then((res) => setUser(res.data.user))
      .catch(() => setUser(null));
  }, []);

  async function handleLogout() {
    try {
      await api.logout();
    } finally {
      window.location.href = '/login';
    }
  }

  return (
    <header className="header">
      <div className="header-title">Ajans Kreatif Zeka Sistemi</div>
      <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span className="badge badge-success">MVP</span>
        {user && (
          <>
            <span style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
              {user.email} · {user.roles.join(', ')}
            </span>
            <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
              Çıkış Yap
            </button>
          </>
        )}
      </div>
    </header>
  );
}
