import type { SectorDefinition } from '@grafista/schemas';

export const otomotivServis: SectorDefinition = {
  key: 'otomotiv_servis',
  label: 'Oto Servis & Lastik',
  aliases: [
    'oto servis',
    'otomotiv',
    'lastik',
    'lastikçi',
    'oto tamir',
    'araç bakım',
    'servis',
    'oto ekspertiz',
    'kaporta boya',
    'yedek parça',
    'oto elektrik',
  ],

  contentPillars: [
    {
      key: 'bakim_ipuclari',
      label: 'Bakım İpuçları',
      weight: 0.3,
      sampleTopics: [
        'Motor yağı değişim aralığı neye göre belirlenir',
        'Fren balatasının ömrünü gösteren üç işaret',
        'Akü voltajı kaçın altına düşerse dikkat gerekir',
        'Rot balans ayarının ne zaman gerektiği',
        'Silecek lastiğinin değişim zamanını anlamak',
        'Klima filtresinin kabin kokusuna etkisi',
      ],
      preferredTemplates: ['carousel', 'bold-statement'],
    },
    {
      key: 'servis_vitrin',
      label: 'Serviste Bugün',
      weight: 0.25,
      sampleTopics: [
        'Periyodik bakımda değişen parçaların tek tek gösterimi',
        'Lift üstünde alt takım kontrolü',
        'Diagnostik cihazın okuduğu hata kodunun açıklaması',
        'Fren diski yüzeyinin aşınma ölçümü',
        'Yağ ve filtre değişiminin adım adım akışı',
        'Yıkama ve teslim öncesi son kontrol',
      ],
      preferredTemplates: ['photo-caption', 'editorial-frame'],
    },
    {
      key: 'lastik_mevsim',
      label: 'Lastik & Mevsim Hazırlığı',
      weight: 0.2,
      sampleTopics: [
        'Kış lastiğinde diş derinliği sınırı ve ölçüm yöntemi',
        'Yazlık ve kışlık lastiğin kauçuk farkı',
        'Lastik yanağındaki üretim tarihi nasıl okunur',
        'Doğru basınç değeri hangi etikette yazar',
        'Lastik otelinde saklama koşulları',
        'Dört mevsim lastiğin hangi kullanımda anlamlı olduğu',
      ],
      preferredTemplates: ['carousel', 'split-diagonal'],
    },
    {
      key: 'ekip_ekipman',
      label: 'Ekip & Ekipman',
      weight: 0.15,
      sampleTopics: [
        'Servisin sabah açılış rutini',
        'Balans makinesinin nasıl çalıştığı',
        'Ustanın kullandığı tork anahtarı ve neden önemli',
        'Ekipteki teknisyenin uzmanlık alanı',
        'Atık yağın kayıt altına alınarak teslimi',
      ],
      preferredTemplates: ['photo-caption', 'quote-card'],
    },
    {
      key: 'randevu_duyuru',
      label: 'Randevu & Duyuru',
      weight: 0.1,
      sampleTopics: [
        'Kış bakımı randevu takviminin açılması',
        'Bayram öncesi çalışma saatleri',
        'Mevsim geçişinde lastik değişim randevusu',
        'Yeni açılan ikinci servis noktası',
        'Randevusuz gelinebilen kontrol saatleri',
      ],
      preferredTemplates: ['offer-badge', 'bold-statement'],
    },
  ],

  tone: {
    primary: 'güvenilir ve açık sözlü',
    secondary: 'teknik ama sade, korkutmadan uyaran',
    do: [
      'Parça adını ve işlemin ne işe yaradığını birlikte yaz',
      'Ölçüm sonucunu rakamla ver',
      'Yapılan işi fotoğrafla belgele',
      'Randevu ve konum bilgisini net ver',
    ],
    dont: [
      'Kesin fiyat taahhüdü verme',
      'Orijinal olmayan parçayı orijinal gibi gösterme',
      'Garanti iptaline yol açacak işlemi tavsiye gibi sunma',
      'Korku diliyle gereksiz işlem yaptırma baskısı kurma',
    ],
  },

  hashtags: {
    core: ['#otoservis', '#araçbakım', '#lastik', '#otomotiv', '#güvenlisürüş'],
    rotating: [
      '#periyodikbakım',
      '#yağdeğişimi',
      '#frenbakımı',
      '#kışlastiği',
      '#yazlıklastik',
      '#rotbalans',
      '#akü',
      '#dizel',
      '#motorbakımı',
      '#araçklima',
      '#diagnostik',
      '#yedekparça',
      '#lastikoteli',
      '#uzunyolhazırlığı',
      '#araçmuayenesi',
      '#servisrandevusu',
    ],
  },

  bestPostingTimes: [
    { dayOfWeek: 1, times: ['08:00', '18:00'] },
    { dayOfWeek: 2, times: ['18:00'] },
    { dayOfWeek: 3, times: ['08:00', '18:00'] },
    { dayOfWeek: 4, times: ['12:30', '18:00'] },
    { dayOfWeek: 5, times: ['08:30', '17:30'] },
    { dayOfWeek: 6, times: ['09:30', '13:00'] },
    { dayOfWeek: 0, times: ['12:00'] },
  ],

  cadence: {
    postsPerWeek: 3,
    preferredDays: [1, 3, 5, 6],
    avoidDays: [0],
  },

  backgroundStyle: {
    positive:
      'clean modern auto service workshop photography, soft diffused overhead light, tidy lift bays and organised tool walls, tyre stacks and brake components in sharp detail, brushed metal dark grey concrete and matte black surfaces, subtle reflections on paintwork, no visible brand logos, wide balanced composition with generous empty space along the left side and upper third for text',
    negative: [
      'yağ içinde dağınık atölye',
      'stok fotoğraf klişesi baş parmak kaldıran usta',
      'aşırı doygun mavi ve turuncu renk düzeni',
      'gerçek olmayan parlak reklam görüntüsü',
      'okunabilir marka logosu',
    ],
    palettePreference: 'cool',
  },

  forbidden: [
    'Orijinal olmayan bir parçayı orijinal olarak tanıtma',
    'Garanti kapsamını iptal edecek işlemi öneri gibi sunma',
    'Kesin fiyat ya da sabit fiyat taahhüdü verme',
    'Yapılmayan bir işlemi yapılmış gibi gösterme',
    'Emisyon veya muayene sonucunu etkileyecek uygulamayı özendirme',
  ],

  seasonalHooks: [
    { monthDay: '01-10', label: 'Kış ortası akü ve antifriz kontrolü' },
    { monthDay: '04-01', label: 'Kış lastiği zorunluluğunun bitişi, yazlık lastiğe geçiş' },
    { monthDay: '06-15', label: 'Yaz tatili öncesi uzun yol kontrolü' },
    { monthDay: '08-01', label: 'Sıcak havada klima ve soğutma sistemi bakımı' },
    { monthDay: '09-15', label: 'Okul dönüşü şehir içi kullanım ve fren kontrolü' },
    { monthDay: '11-15', label: 'Kış bakımı hazırlığı: akü, silecek, antifriz' },
    { monthDay: '12-01', label: 'Kış lastiği zorunluluğunun başlangıcı' },
  ],
};
