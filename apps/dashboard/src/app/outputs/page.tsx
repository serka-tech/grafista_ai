'use client';

export default function OutputsPage() {
  return (
    <div className="animate-fade-in">
      <div className="page-header"><h2>📦 Çıktı Geçmişi</h2><p>Üretilen tüm tasarım çıktıları ve dışa aktarımlar</p></div>
      <div className="empty-state">
        <div className="icon">📦</div>
        <p>Henüz çıktı üretilmedi</p>
        <p style={{ fontSize: '0.85rem', marginTop: '8px', maxWidth: '400px' }}>
          İçerik fikirleri oluşturup onaylayın, tasarım briflerini üretin, ardından nihai çıktıları oluşturun. Gerçek üretim için AI sağlayıcı API anahtarlarını bağlayın.
        </p>
      </div>
    </div>
  );
}
