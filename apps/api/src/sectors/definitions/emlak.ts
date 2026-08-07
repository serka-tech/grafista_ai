import type { SectorDefinition } from '@grafista/schemas';

export const emlak: SectorDefinition = {
  key: 'emlak',
  label: 'Emlak & Gayrimenkul',
  aliases: [
    'emlak',
    'gayrimenkul',
    'emlakçı',
    'emlak ofisi',
    'real estate',
    'konut',
    'satılık',
    'kiralık',
    'proje pazarlama',
    'arsa',
  ],

  contentPillars: [
    {
      key: 'portfoy_vitrin',
      label: 'Portföy Vitrini',
      weight: 0.3,
      sampleTopics: [
        'Bu hafta portföye giren üç artı bir daire ve öne çıkan üç detayı',
        'Güney cepheli salonun gün içindeki ışık değişimi',
        'Bahçe katının dış alan ölçüsü ve kullanım şekli',
        'Ara katta yer alan dairenin kat planı ve oda dağılımı',
        'Devren kiralık dükkânın vitrin genişliği ve cadde yoğunluğu',
        'Yeni teslim projede bir dairenin boş hâli ve ölçüleri',
      ],
      preferredTemplates: ['photo-caption', 'editorial-frame'],
    },
    {
      key: 'bolge_rehberi',
      label: 'Bölge Rehberi',
      weight: 0.25,
      sampleTopics: [
        'Mahalledeki okul ve sağlık ocağına yürüme mesafeleri',
        'Sabah trafiğinde merkeze ulaşım süresi ve toplu taşıma hatları',
        'Semtteki pazar günü ve otopark durumu',
        'İki komşu mahallenin kira aralığı farkı ve nedeni',
        'Metro hattının açık olan ve inşaat hâlindeki durakları',
        'Site içi sosyal alanların gerçek kullanım saatleri',
      ],
      preferredTemplates: ['carousel', 'editorial-frame'],
    },
    {
      key: 'alici_satici_rehberi',
      label: 'Alıcı & Satıcı Rehberi',
      weight: 0.2,
      sampleTopics: [
        'Tapu devrinde hazır bulunması gereken belgeler listesi',
        'Konut kredisi başvurusunda ekspertiz raporunun rolü',
        'Kat irtifakı ile kat mülkiyeti arasındaki fark',
        'DASK ve zorunlu deprem sigortası yenileme adımları',
        'Satış öncesi evi hazırlarken yapılacak beş küçük iş',
        'Kira sözleşmesinde tarafların sık atladığı maddeler',
      ],
      preferredTemplates: ['carousel', 'bold-statement'],
    },
    {
      key: 'ekip_surec',
      label: 'Ekip & Süreç',
      weight: 0.15,
      sampleTopics: [
        'Bir portföyün fotoğraf çekimine nasıl hazırlandığı',
        'Ofisin gün içindeki randevu akışı',
        'Danışmanın bölgede yaptığı yerinde inceleme',
        'Alıcıyla ilk görüşmede sorulan sorular',
        'Ekibe yeni katılan danışmanın uzmanlık bölgesi',
      ],
      preferredTemplates: ['photo-caption', 'quote-card'],
    },
    {
      key: 'piyasa_notu',
      label: 'Piyasa Notu',
      weight: 0.1,
      sampleTopics: [
        'Bu ay bölgede kaç konut ilanı listelendi',
        'Kiralık ile satılık ilan sayısı arasındaki denge',
        'Ortalama ilan yayında kalma süresi',
        'Yeni açılan ofis ve çalışma saatleri duyurusu',
        'Bayram döneminde randevu takvimi',
      ],
      preferredTemplates: ['bold-statement', 'split-diagonal'],
    },
  ],

  tone: {
    primary: 'net ve güven veren',
    secondary: 'ölçülü, rakamla konuşan, abartısız',
    do: [
      'Ölçü, kat, cephe gibi somut bilgiyi öne çıkar',
      'Konumu tarif ederken mesafe ve süre ver',
      'Görselde ne varsa metinde de o olsun',
      'Randevu daveti tek cümle ve net olsun',
    ],
    dont: [
      'Yatırım getirisi ya da değer artışı vaadi verme',
      '"Kaçırılmaz fırsat", "son daire" gibi baskı dili kullanma',
      'Kesinleşmemiş imar ya da proje bilgisi paylaşma',
      'Görseli gerçekte olmayan bir mekânla temsil etme',
    ],
  },

  hashtags: {
    core: ['#emlak', '#gayrimenkul', '#konut', '#portföy', '#evarayanlar'],
    rotating: [
      '#satılıkdaire',
      '#kiralıkdaire',
      '#satılıkvilla',
      '#kiralıkofis',
      '#satılıkarsa',
      '#yenidaire',
      '#sıfırkonut',
      '#ikincielkonut',
      '#tapu',
      '#konutkredisi',
      '#emlakdanışmanı',
      '#taşınmavakti',
      '#mahalleanlatımı',
      '#denizmanzarası',
      '#bahçekatı',
      '#sitedeyaşam',
    ],
  },

  bestPostingTimes: [
    { dayOfWeek: 1, times: ['09:00', '19:30'] },
    { dayOfWeek: 2, times: ['19:30'] },
    { dayOfWeek: 3, times: ['09:00', '19:30'] },
    { dayOfWeek: 4, times: ['19:30'] },
    { dayOfWeek: 5, times: ['12:30', '18:30'] },
    { dayOfWeek: 6, times: ['11:00', '17:00'] },
    { dayOfWeek: 0, times: ['11:00', '20:00'] },
  ],

  cadence: {
    postsPerWeek: 4,
    preferredDays: [1, 3, 5, 6],
    avoidDays: [],
  },

  backgroundStyle: {
    positive:
      'architectural real estate photography in natural daylight, honest wide framing of interiors and building exteriors, empty tidy rooms, balconies and neighbourhood views, soft shadows, muted neutral surfaces in plaster stone and light wood, straight vertical lines, calm uncluttered composition with generous empty space across the upper third and one side for text',
    negative: [
      'yapay ışıkla renklendirilmiş oda',
      'çizim ya da render görüntüsü',
      'stok fotoğraf klişesi anahtar teslimi pozu',
      'aşırı geniş açıdan bozulmuş duvarlar',
      'eşyayla dolmuş dağınık salon',
    ],
    palettePreference: 'neutral',
  },

  forbidden: [
    'Gerçekte var olmayan bir mekânın görselini ilan görseli gibi sunma',
    'Yatırım getirisi ya da kira geliri garantisi verme',
    '"Değeri kesin artacak" gibi kesinlik iddiası kurma',
    'Kesinleşmemiş imar, proje ya da kentsel dönüşüm bilgisi paylaşma',
    'Fiyatı gerçek değerin altında göstererek ilgi toplama',
  ],

  seasonalHooks: [
    { monthDay: '03-01', label: 'Emlak vergisi birinci taksit dönemi başlangıcı' },
    { monthDay: '05-31', label: 'Emlak vergisi birinci taksit son günü' },
    { monthDay: '06-15', label: 'Yaz taşınma sezonu' },
    { monthDay: '08-15', label: 'Üniversite yerleştirme sonrası öğrenci kiralama dönemi' },
    { monthDay: '09-01', label: 'Okul dönemi öncesi son taşınma haftası' },
    { monthDay: '11-30', label: 'Emlak vergisi ikinci taksit son günü' },
    { monthDay: '12-15', label: 'Yıl sonu portföy ve piyasa değerlendirmesi' },
  ],
};
