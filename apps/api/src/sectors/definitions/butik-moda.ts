import type { SectorDefinition } from '@grafista/schemas';

export const butikModa: SectorDefinition = {
  key: 'butik_moda',
  label: 'Butik & Moda Perakende',
  aliases: [
    'butik',
    'moda',
    'giyim',
    'hazır giyim',
    'tekstil perakende',
    'concept store',
    'kadın giyim',
    'erkek giyim',
    'aksesuar',
    'ayakkabı',
    'fashion',
    'boutique',
  ],

  contentPillars: [
    {
      key: 'urun_vitrin',
      label: 'Ürün Vitrini',
      weight: 0.3,
      sampleTopics: [
        'Bu hafta rafa giren keten gömleğin dokusu ve rengi',
        'Tek bir elbisenin üç farklı açıdan detayı',
        'Sezonun en çok sorulan pantolon kalıbı',
        'Yeni gelen çanta serisinin iç bölmeleri',
        'Aynı triko modelinin beş renk seçeneği',
        'Kumaşın yakından görüntüsü ve dokunma hissi',
      ],
      preferredTemplates: ['photo-caption', 'editorial-frame'],
    },
    {
      key: 'kombin_stil',
      label: 'Kombin & Stil Önerisi',
      weight: 0.25,
      sampleTopics: [
        'Ofisten akşam yemeğine geçen tek parça kombin',
        'Beyaz gömleği üç farklı şekilde giymek',
        'Ceket ve etek uyumunda renk dengesi',
        'Sabah yürüyüşü için rahat ama toparlı görünüm',
        'Düğün davetine sade bir seçim',
        'Aynı ayakkabıyla üç ayrı kombin denemesi',
      ],
      preferredTemplates: ['carousel', 'split-diagonal'],
    },
    {
      key: 'kampanya_indirim',
      label: 'Kampanya & Duyuru',
      weight: 0.2,
      sampleTopics: [
        'Sezon sonu indiriminin başladığı gün',
        'Yeni koleksiyonun vitrine çıktığı tarih',
        'İkinci ürüne özel fiyat haftası',
        'Kargo ve değişim koşullarının güncellenmesi',
        'Bayram öncesi çalışma saatleri',
        'Butiğin yeni adresine taşınması',
      ],
      preferredTemplates: ['offer-badge', 'bold-statement'],
    },
    {
      key: 'butik_perde_arkasi',
      label: 'Butik Perde Arkası',
      weight: 0.15,
      sampleTopics: [
        'Kutuların açıldığı ve ürünlerin asıldığı sabah',
        'Vitrin düzeninin baştan kurulması',
        'Tedarikçiyle kumaş seçimi görüşmesi',
        'Butiğin sahibi neden bu markayı getirdi',
        'Kapanış saatinden sonra reyon düzeni',
      ],
      preferredTemplates: ['photo-caption', 'editorial-frame'],
    },
    {
      key: 'musteri_stili',
      label: 'Müşteri Stili & Geri Bildirim',
      weight: 0.1,
      sampleTopics: [
        'Bir müşterinin butikten aldığı parçayla paylaştığı kare',
        'En çok sorulan beden sorusu ve net cevabı',
        'Bir hediye seçiminde nasıl yardımcı olundu',
        'Denemeden alan müşteri ne dedi',
        'Aynı modeli üç yıldır giyen müşterinin notu',
      ],
      preferredTemplates: ['quote-card', 'carousel'],
    },
  ],

  tone: {
    primary: 'zarif ve kendinden emin',
    secondary: 'samimi bir stil danışmanı gibi, baskısız',
    do: [
      'Kumaşı, kalıbı ve rengi somut anlat',
      'Tek bir parçayı ya da tek bir kombini öne çıkar',
      'Beden ve ölçü bilgisini net ver',
      'Günlük hayatta nerede giyileceğini göster',
    ],
    dont: [
      'Beden üzerinden yargılayıcı dil kullanma',
      'Aciliyet baskısı kurma ("son 2 saat, kaçırma")',
      'Marka adlarını kıyaslayarak üstünlük iddia etme',
      'Filtreyle ürünün gerçek rengini değiştirme',
    ],
  },

  hashtags: {
    core: ['#butik', '#moda', '#stil', '#yenisezon', '#günlükkombin'],
    rotating: [
      '#kombinönerisi',
      '#sezonluk',
      '#kadıngiyim',
      '#erkekgiyim',
      '#trikoseverler',
      '#ketengömlek',
      '#elbisemodelleri',
      '#aksesuar',
      '#çantaseverler',
      '#ayakkabımodelleri',
      '#sadegiyim',
      '#yerliüretim',
      '#sezonsonu',
      '#vitrinden',
      '#hediyefikri',
      '#doğalkumaş',
    ],
  },

  bestPostingTimes: [
    { dayOfWeek: 0, times: ['13:00', '20:00'] },
    { dayOfWeek: 1, times: ['19:30'] },
    { dayOfWeek: 2, times: ['19:30'] },
    { dayOfWeek: 3, times: ['13:00', '20:00'] },
    { dayOfWeek: 4, times: ['20:00'] },
    { dayOfWeek: 5, times: ['18:00', '20:30'] },
    { dayOfWeek: 6, times: ['12:00', '19:00'] },
  ],

  cadence: {
    postsPerWeek: 4,
    preferredDays: [3, 4, 5, 6],
    avoidDays: [1],
  },

  backgroundStyle: {
    positive:
      'soft diffused daylight fashion retail photography, clean minimal boutique interior, neutral plaster and light wood surfaces, fabric texture and drape clearly visible, single garment or styled rail as the subject, calm uncluttered composition with generous empty space on one side and across the lower third for text',
    negative: [
      'aşırı rötuşlanmış ten ve vücut',
      'kalabalık ve dağınık askılık',
      'sert flaş ve yansımalı ayna',
      'ürünün gerçek rengini bozan filtre',
      'stok fotoğraf klişesi poz',
    ],
    palettePreference: 'neutral',
  },

  forbidden: [
    'Stokta olmayan ürünü satışta gösterme',
    'Fiyatı önce yükseltip sonra indirim gibi sunma',
    'Beden ve ölçü konusunda yanıltıcı bilgi verme',
    'Kumaş içeriğini ve bakım koşullarını olduğundan farklı anlatma',
  ],

  seasonalHooks: [
    { monthDay: '02-14', label: 'Sevgililer Günü hediye seçimi' },
    { monthDay: '03-08', label: 'Dünya Kadınlar Günü' },
    { monthDay: '04-01', label: 'İlkbahar sezon geçişi ve yeni koleksiyon' },
    { monthDay: '05-14', label: 'Anneler Günü haftası' },
    { monthDay: '08-15', label: 'Yaz sezonu sonu indirim dönemi' },
    { monthDay: '09-15', label: 'Sonbahar koleksiyonu vitrine çıkıyor' },
    { monthDay: '11-28', label: 'Kasım indirimleri haftası' },
  ],
};
