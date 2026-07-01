import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Grafista AI Studio — Ajans Kreatif Zeka Sistemi',
  description: 'Yapay zeka destekli reklam ajansı platformu. Marka bilinçli kreatif iş akışı, Tasarım DNA, içerik üretimi ve yapılandırılmış tasarım çıktısı.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <div className="app-layout">
          <Sidebar />
          <Header />
          <main className="main-content animate-fade-in">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}

function Sidebar() {
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
      items: [
        { href: '/settings', icon: '⚙️', label: 'Ayarlar' },
      ],
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
  return (
    <header className="header">
      <div className="header-title">Ajans Kreatif Zeka Sistemi</div>
      <div className="header-actions">
        <span className="badge badge-success">MVP</span>
      </div>
    </header>
  );
}
