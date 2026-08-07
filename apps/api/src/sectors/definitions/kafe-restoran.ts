import type { SectorDefinition } from '@grafista/schemas';

export const kafeRestoran: SectorDefinition = {
  key: 'kafe_restoran',
  label: 'Kafe & Restoran',
  aliases: ['kafe', 'restoran', 'cafe', 'restaurant', 'yeme içme', 'yeme-içme', 'lokanta', 'bistro'],

  contentPillars: [
    {
      key: 'urun_vitrin',
      label: 'Ürün Vitrini',
      weight: 0.35,
      sampleTopics: [
        'Bu haftanın imza kahvesi ve nasıl demlendiği',
        'Menüye yeni giren tatlının hikâyesi',
        'Kahvaltı tabağındaki yerel ürünler',
        'Gün içinde en çok tercih edilen üç içecek',
        'Mevsim meyvesiyle hazırlanan limonata',
        'Ekmeğin fırından çıktığı saat',
      ],
      preferredTemplates: ['photo-caption', 'bold-statement'],
    },
    {
      key: 'mekan_atmosfer',
      label: 'Mekân & Atmosfer',
      weight: 0.2,
      sampleTopics: [
        'Sabah ışığında boş salon',
        'Bahçe kısmının açıldığı ilk gün',
        'Çalışmaya en uygun köşe ve priz düzeni',
        'Akşam üstü mumlar yakıldığında',
        'Yağmurlu günde camdan görünen manzara',
      ],
      preferredTemplates: ['editorial-frame', 'photo-caption'],
    },
    {
      key: 'ekip_mutfak',
      label: 'Ekip & Mutfak',
      weight: 0.15,
      sampleTopics: [
        'Baristanın günün ilk demlemesi',
        'Mutfakta hazırlık saatleri',
        'Şefin en sevdiği malzeme',
        'Ekibe yeni katılan arkadaş',
        'Tedarikçiyle pazar sabahı',
      ],
      preferredTemplates: ['photo-caption', 'editorial-frame'],
    },
    {
      key: 'kampanya_duyuru',
      label: 'Kampanya & Duyuru',
      weight: 0.15,
      sampleTopics: [
        'Hafta içi öğlen menüsü',
        'Öğrenci indirimi saatleri',
        'Yeni açılan üst kat',
        'Rezervasyon açılan özel gece',
        'Bayram günleri çalışma saatleri',
      ],
      preferredTemplates: ['offer-badge', 'bold-statement'],
    },
    {
      key: 'misafir_sesi',
      label: 'Misafir Sesi',
      weight: 0.15,
      sampleTopics: [
        'Bir misafirin bıraktığı not',
        'En çok sorulan soru ve cevabı',
        'Sabah müdavimlerinin alışkanlığı',
        'Doğum günü kutlaması yapan masa',
        'Uzaktan gelip tekrar uğrayan misafir',
      ],
      preferredTemplates: ['quote-card', 'carousel'],
    },
  ],

  tone: {
    primary: 'sıcak ve davetkâr',
    secondary: 'sakin, gösterişsiz, komşu sohbeti gibi',
    do: [
      'Duyulara hitap et: koku, sıcaklık, çıtırtı, buhar',
      'Tek bir ürüne ya da tek bir ana odaklan',
      'Günün saatini ve mevsimi hissettir',
      'Davet cümlesi kısa ve net olsun',
    ],
    dont: [
      'Abartılı sıfat yığma ("eşsiz", "muhteşem", "efsane")',
      'Ünlem işaretini arka arkaya kullanma',
      'Fiyatı görselin üstüne yazma, açıklamada belirt',
      'Rakip mekânlarla kıyaslama yapma',
    ],
  },

  hashtags: {
    core: ['#kahve', '#lezzet', '#kafe', '#yemek', '#buradayiz'],
    rotating: [
      '#üçüncüdalga',
      '#filtrekahve',
      '#espresso',
      '#kahvaltı',
      '#brunch',
      '#tatlı',
      '#evyapımı',
      '#taze',
      '#mevsiminde',
      '#yerelüretici',
      '#akşamüstü',
      '#şehirdekaçamak',
      '#buluşmanoktası',
      '#çalışmamekânı',
      '#bahçekat',
      '#günündemlemesi',
    ],
  },

  bestPostingTimes: [
    { dayOfWeek: 1, times: ['08:30', '12:30'] },
    { dayOfWeek: 2, times: ['12:30'] },
    { dayOfWeek: 3, times: ['08:30', '19:00'] },
    { dayOfWeek: 4, times: ['12:30', '19:00'] },
    { dayOfWeek: 5, times: ['12:30', '18:30'] },
    { dayOfWeek: 6, times: ['10:30', '19:30'] },
    { dayOfWeek: 0, times: ['10:30'] },
  ],

  cadence: {
    postsPerWeek: 3,
    preferredDays: [1, 3, 5, 6],
    avoidDays: [],
  },

  backgroundStyle: {
    positive:
      'natural daylight food and cafe photography, shallow depth of field, warm wooden and stone surfaces, steam and texture visible, calm uncluttered composition with generous empty space in the upper and lower third',
    negative: [
      'plastik görünümlü yemek',
      'aşırı doygun renkler',
      'stok fotoğraf klişesi gülümseme',
      'üst üste yığılmış tabaklar',
      'sert flaş ışığı',
    ],
    palettePreference: 'warm',
  },

  forbidden: [
    'Sağlık iddiası yapma (zayıflatır, hastalık iyileştirir gibi)',
    'Alkollü içecekleri özendirici biçimde öne çıkarma',
    'Menüde olmayan ürünü varmış gibi gösterme',
    'Fiyat garantisi ya da süresiz kampanya vaadi verme',
  ],

  seasonalHooks: [
    { monthDay: '01-01', label: 'Yılbaşı sonrası ilk kahve' },
    { monthDay: '03-08', label: 'Dünya Kadınlar Günü' },
    { monthDay: '04-23', label: 'Ulusal Egemenlik ve Çocuk Bayramı' },
    { monthDay: '05-14', label: 'Anneler Günü haftası' },
    { monthDay: '09-01', label: 'Okul dönüşü sabah rutini' },
    { monthDay: '10-29', label: 'Cumhuriyet Bayramı' },
    { monthDay: '12-21', label: 'Yılın en uzun gecesi, sıcak içecekler' },
  ],
};
