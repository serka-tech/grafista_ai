import type { SectorDefinition } from '@grafista/schemas';

export const insaatTadilat: SectorDefinition = {
  key: 'insaat_tadilat',
  label: 'İnşaat, Tadilat & Mimarlık',
  aliases: [
    'inşaat',
    'tadilat',
    'mimarlık',
    'mimar',
    'iç mimarlık',
    'yapı',
    'müteahhit',
    'dekorasyon',
    'renovasyon',
    'construction',
    'yapı market',
  ],

  contentPillars: [
    {
      key: 'is_vitrin',
      label: 'Tamamlanan İş Vitrini',
      weight: 0.3,
      sampleTopics: [
        'Teslim edilen mutfağın tezgâh ve dolap düzeni',
        'Banyoda seçilen seramik ölçüsü ve derz rengi',
        'Cephe boyası bitmiş apartmanın sokaktan görünümü',
        'Ofis bölme duvarlarının akustik çözümü',
        'Merdiven korkuluğunun ölçüye göre üretilmiş hâli',
        'Küçük dairede kazanılan depolama alanı',
      ],
      preferredTemplates: ['photo-caption', 'editorial-frame'],
    },
    {
      key: 'once_sonra',
      label: 'Öncesi & Sonrası',
      weight: 0.25,
      sampleTopics: [
        'Yirmi yıllık banyonun sökümden teslime kadar hâli',
        'Kapalı mutfağın salona açılması',
        'Nem alan dış duvarın yalıtım sonrası durumu',
        'Eski parkenin sökülüp zemin tesviyesi yapılması',
        'Karanlık koridorun aydınlatma sonrası hâli',
        'Balkonun kışlık kullanıma çevrilmesi',
      ],
      preferredTemplates: ['split-diagonal', 'carousel'],
    },
    {
      key: 'malzeme_uygulama',
      label: 'Malzeme & Uygulama',
      weight: 0.2,
      sampleTopics: [
        'Su yalıtımında kullanılan malzeme türleri ve nerede işe yaradığı',
        'Alçıpan ile tuğla bölme duvar arasındaki fark',
        'Seramik ile porselen karo dayanım farkı',
        'Boya öncesi astar neden atlanmamalı',
        'Islak hacimde eğim nasıl verilir',
        'Isı yalıtımında kalınlık seçimi neye göre yapılır',
      ],
      preferredTemplates: ['carousel', 'bold-statement'],
    },
    {
      key: 'saha_ekip',
      label: 'Saha & Ekip',
      weight: 0.15,
      sampleTopics: [
        'Şantiyede günün ilk saatindeki hazırlık',
        'Ustanın kullandığı ölçüm aleti ve neden gerekli',
        'İş güvenliği ekipmanının sahadaki kullanımı',
        'Ekibin bir günde tamamladığı iş kalemi',
        'Molozun toplanması ve teslim sonrası temizlik',
      ],
      preferredTemplates: ['photo-caption', 'quote-card'],
    },
    {
      key: 'surec_sozlesme',
      label: 'Süreç & Sözleşme',
      weight: 0.1,
      sampleTopics: [
        'Keşif randevusunda nelerin ölçüldüğü',
        'Teklif kalemlerinin nasıl okunacağı',
        'Tadilat öncesi yönetimden alınacak izinler',
        'Ruhsat gerektiren ve gerektirmeyen işler ayrımı',
        'İş takviminin hava koşullarına göre değişmesi',
      ],
      preferredTemplates: ['bold-statement', 'editorial-frame'],
    },
  ],

  tone: {
    primary: 'işini bilen ve açık',
    secondary: 'sakin, teknik ama anlaşılır, sözünü tutan',
    do: [
      'Yapılan işi adım adım ve sırayla anlat',
      'Malzeme adını ve ölçüsünü açıkça yaz',
      'Sahadan gerçek görüntü kullan',
      'Keşif davetini tek cümleyle ver',
    ],
    dont: [
      'Süre ve fiyat garantisi verme',
      'Ruhsatı olmayan bir işi tanıtım konusu yapma',
      'Mühendislik onayı olmayan yapısal iddia kurma',
      '"Anahtar teslim, hiç uğraşmadan" gibi kolaylık abartısı yapma',
    ],
  },

  hashtags: {
    core: ['#tadilat', '#inşaat', '#mimarlık', '#yapı', '#uygulama'],
    rotating: [
      '#içmimarlık',
      '#mutfaktadilatı',
      '#banyotadilatı',
      '#cepheyenileme',
      '#ısıyalıtımı',
      '#suyalıtımı',
      '#alçıpan',
      '#zeminkaplama',
      '#seramikuygulama',
      '#boyabadana',
      '#öncesisonrası',
      '#şantiye',
      '#işgüvenliği',
      '#ustaişi',
      '#projelendirme',
      '#renovasyon',
    ],
  },

  bestPostingTimes: [
    { dayOfWeek: 1, times: ['08:00', '18:30'] },
    { dayOfWeek: 2, times: ['18:30'] },
    { dayOfWeek: 3, times: ['08:00', '18:30'] },
    { dayOfWeek: 4, times: ['12:30'] },
    { dayOfWeek: 5, times: ['08:30', '17:30'] },
    { dayOfWeek: 6, times: ['10:30'] },
    { dayOfWeek: 0, times: ['11:00'] },
  ],

  cadence: {
    postsPerWeek: 3,
    preferredDays: [1, 3, 5],
    avoidDays: [0],
  },

  backgroundStyle: {
    positive:
      'documentary construction and renovation photography, real job site and finished interior, natural daylight from windows, visible material texture in concrete plaster wood and tile, ordered tools and safety gear, precise geometry and straight lines, dust free finished surfaces, wide calm composition with generous empty space in the upper third and along one wall for text',
    negative: [
      'render ya da üç boyutlu çizim görüntüsü',
      'dağınık ve tehlikeli görünen şantiye',
      'stok fotoğraf klişesi kaskla poz veren ekip',
      'aşırı parlatılmış yapay yüzeyler',
      'ölçeği bozan aşırı geniş açı',
    ],
    palettePreference: 'warm',
  },

  forbidden: [
    'Kesin süre ya da kesin fiyat garantisi verme',
    'Ruhsat gerektiren bir işi ruhsatsız yapılmış hâliyle tanıtma',
    'Mühendislik onayı olmayan yapısal dayanım iddiası kurma',
    'Başkasının işini kendi referansı gibi gösterme',
    'Deprem güvenliği konusunda kesinlik içeren vaat verme',
  ],

  seasonalHooks: [
    { monthDay: '03-01', label: 'Bahar tadilat sezonunun açılışı' },
    { monthDay: '05-15', label: 'Yaz öncesi su ve ısı yalıtımı dönemi' },
    { monthDay: '08-17', label: 'Deprem yıl dönümü, yapı güvenliği bilgilendirmesi' },
    { monthDay: '09-15', label: 'Kış öncesi çatı ve cephe kontrolü' },
    { monthDay: '10-01', label: 'Kombi ve tesisat bakım dönemi' },
    { monthDay: '11-15', label: 'Kapalı sezon iç mekân tadilat dönemi' },
    { monthDay: '12-15', label: 'Yıl sonu proje teslimleri' },
  ],
};
