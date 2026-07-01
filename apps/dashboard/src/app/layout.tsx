import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Grafista AI Studio — Ajans Kreatif Zeka Sistemi',
  description: 'Yapay zeka destekli reklam ajansı platformu. Marka bilinçli kreatif iş akışı, Tasarım DNA, içerik üretimi ve yapılandırılmış tasarım çıktısı.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
