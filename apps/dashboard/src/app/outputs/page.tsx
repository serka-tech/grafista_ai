'use client';

export default function OutputsPage() {
  return (
    <div className="animate-fade-in">
      <div className="page-header"><h2>📦 Çıktı Geçmişi</h2><p>Üretilen tüm tasarım çıktıları ve dışa aktarımlar</p></div>
      <div className="empty-state">
        <div className="icon">📦</div>
        <p>Çıktılar yerleşim planlarının altında listelenir</p>
        <p style={{ fontSize: '0.85rem', marginTop: '8px', maxWidth: '400px' }}>
          Üretilen görseller, paketler ve export dosyaları her yerleşim planının kendi sayfasında yaşar. Bir müşteri seçin, tasarım brifine girin, ardından &quot;Yerleşim Planları&quot; sayfasını açın.
        </p>
        <a href="/" className="btn btn-primary" style={{ marginTop: '16px' }}>
          Müşterilere Git →
        </a>
      </div>
    </div>
  );
}
