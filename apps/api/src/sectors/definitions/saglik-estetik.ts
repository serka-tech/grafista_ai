import type { SectorDefinition } from '@grafista/schemas';

export const saglikEstetik: SectorDefinition = {
  key: 'saglik_estetik',
  label: 'Sağlık & Estetik Kliniği',
  aliases: [
    'estetik klinik',
    'estetik kliniği',
    'medikal estetik',
    'dermatoloji',
    'cilt kliniği',
    'plastik cerrahi',
    'sağlık kliniği',
    'poliklinik',
    'saç ekimi',
    'tıp merkezi',
  ],

  // Sağlık hizmeti tanıtımı mevzuatla sınırlı: kampanya, hasta görüşü ve
  // öncesi-sonrası içeriği yoktur. Sütunlar bilgilendirme ekseninde kurulur.
  contentPillars: [
    {
      key: 'bilimsel_bilgilendirme',
      label: 'Bilimsel Bilgilendirme',
      weight: 0.3,
      sampleTopics: [
        'Güneş koruyucu neden kapalı havada da kullanılır',
        'Cilt bariyeri nedir, ne zaman bozulur',
        'Ben takibinde dikkat edilen görsel işaretler',
        'Kollajen kaybı yaşla nasıl seyreder',
        'Saç dökülmesinin mevsimsel ve mevsimsel olmayan nedenleri',
        'Cilt tipi ile cilt durumu arasındaki fark',
      ],
      preferredTemplates: ['carousel', 'bold-statement'],
    },
    {
      key: 'hekim_ve_klinik',
      label: 'Hekim & Klinik',
      weight: 0.25,
      sampleTopics: [
        'Kliniğe katılan hekimin uzmanlık alanı ve akademik geçmişi',
        'Muayene odasının hazırlanışı ve hijyen düzeni',
        'Kullanılan cihazın ruhsat ve bakım süreci',
        'Ekibin katıldığı bilimsel kongre',
        'Sterilizasyon ve tek kullanımlık malzeme akışı',
        'Sabah açılışta sessiz bekleme alanı',
      ],
      preferredTemplates: ['editorial-frame', 'photo-caption'],
    },
    {
      key: 'sik_sorulanlar',
      label: 'Sık Sorulanlar',
      weight: 0.2,
      sampleTopics: [
        'İlk muayenede hangi sorular sorulur',
        'Yaz aylarında hangi işlemler ertelenir',
        'Hamilelikte hangi cilt ürünleri kullanılmaz',
        'Kontrol randevusu neden atlanmamalı',
        'Hangi durumda hekime başvurmak gerekir',
        'Randevuya gelirken hangi bilgiler getirilmeli',
      ],
      preferredTemplates: ['quote-card', 'carousel'],
    },
    {
      key: 'surec_bilgilendirme',
      label: 'Süreç Bilgilendirme',
      weight: 0.15,
      sampleTopics: [
        'Muayeneden kontrole kadar süreç nasıl ilerler',
        'İyileşme döneminde günlük hayata dair genel bilgiler',
        'Kontrol randevularının takvimde yeri',
        'Onam formu ne anlatır, neden okunmalı',
        'Hekimle görüşmeye hazırlanırken not alınacaklar',
      ],
      preferredTemplates: ['carousel', 'split-diagonal'],
    },
    {
      key: 'kurumsal_duyuru',
      label: 'Kurumsal Duyuru',
      weight: 0.1,
      sampleTopics: [
        'Bayram günleri çalışma saatleri',
        'Kliniğe ulaşım ve otopark bilgisi',
        'Randevu sistemi ve iletişim kanalları',
        'Yeni açılan muayene birimi',
        'Engelli erişimi için yapılan düzenleme',
      ],
      preferredTemplates: ['bold-statement', 'editorial-frame'],
    },
  ],

  tone: {
    primary: 'ölçülü, bilimsel, güven veren',
    secondary: 'sakin bir hekim dili; ikna etmeye değil bilgilendirmeye çalışır',
    do: [
      'Genel kabul görmüş bilgiyi sade Türkçeyle anlat',
      'Her içerikte kişiye özel değerlendirmenin muayeneyle olduğunu belirt',
      'Tıbbi terimi kullanınca hemen ardından açıkla',
      'Tek bir konuya odaklan, listeyi kısa tut',
    ],
    dont: [
      'Öncesi-sonrası görsel ya da işlem sonucu paylaşma',
      'Fiyat, indirim, paket veya kampanya dili kurma',
      'Hasta görüşü, teşekkür mesajı ya da referans aktarma',
      'Beden görünümü üzerinden kaygı yaratıp işleme yönlendirme',
    ],
  },

  hashtags: {
    core: ['#sağlık', '#klinik', '#uzmanhekim', '#sağlıklıyaşam', '#bilinçliseçim'],
    rotating: [
      '#dermatoloji',
      '#ciltsağlığı',
      '#güneşkoruyucu',
      '#saçsağlığı',
      '#sağlıkokuryazarlığı',
      '#doğrubilgi',
      '#uzmangörüşü',
      '#klinikgünlüğü',
      '#sterilizasyon',
      '#hastagüvenliği',
      '#randevusistemi',
      '#kontrolmuayenesi',
      '#iyileşmesüreci',
      '#beslenmevesağlık',
      '#uykudüzeni',
      '#mevsimselciltbakımı',
    ],
  },

  bestPostingTimes: [
    { dayOfWeek: 0, times: ['20:00'] },
    { dayOfWeek: 1, times: ['10:00', '20:00'] },
    { dayOfWeek: 2, times: ['13:00'] },
    { dayOfWeek: 3, times: ['10:00', '20:00'] },
    { dayOfWeek: 4, times: ['13:00', '19:00'] },
    { dayOfWeek: 5, times: ['11:00'] },
    { dayOfWeek: 6, times: ['12:00'] },
  ],

  cadence: {
    postsPerWeek: 3,
    preferredDays: [1, 3, 4],
    avoidDays: [0],
  },

  backgroundStyle: {
    positive:
      'serene contemporary medical clinic interior, soft cool natural light, matte white and warm grey surfaces, subtle glass panels and a single green plant, calm architectural composition with clean lines, absolutely no patients, no bodies and no procedure imagery, generous empty space across the upper third and along the left side reserved for text',
    negative: [
      'hasta ya da işlem anı görüntüsü',
      'öncesi-sonrası kurgusu çağrıştıran ikili kadraj',
      'beden ya da vücut hattı vurgusu',
      'aşırı rötuşlanmış cilt',
      'stok fotoğraf klişesi hekim pozu',
      'agresif tıbbi cihaz yakın çekimi',
    ],
    palettePreference: 'cool',
  },

  // Sağlık Bakanlığı tanıtım mevzuatının kırmızı çizgileri.
  forbidden: [
    'Tedavi öncesi ve sonrası görsel paylaşma; sağlık tanıtım mevzuatı bunu yasaklar',
    'Fiyat, indirim, taksit, paket ya da kampanya duyurusu yapma; sağlık hizmetinde ticari tanıtım yasaktır',
    'Hasta görüşü, teşekkür mesajı, referans ya da deneyim aktarımı paylaşma',
    '"Garantili sonuç", "kesin çözüm", "tek seansta", "acısız", "risksiz" gibi iddialar kurma',
    '"En iyi", "lider", "ilk ve tek", "uzmanı" gibi üstünlük ve kıyas ifadeleri kullanma',
    'Hasta görüntüsü, işlem anı ya da ameliyat görüntüsü paylaşma',
    'Sosyal medya üzerinden teşhis koyma, tedavi önerme veya uzaktan muayene izlenimi verme',
    'Çekiliş, hediye, "arkadaşını getir" gibi hasta yönlendiren teşvik kurgusu kullanma',
    'Ruhsatsız ürün ya da cihaz tanıtma; onaylı endikasyon dışı kullanım anlatma',
    'Beden görünümü üzerinden kaygı yaratıp işleme yönlendirme',
  ],

  seasonalHooks: [
    { monthDay: '03-14', label: 'Tıp Bayramı' },
    { monthDay: '04-07', label: 'Dünya Sağlık Günü' },
    { monthDay: '05-12', label: 'Hemşireler Günü' },
    { monthDay: '06-21', label: 'Yaz güneşi ve koruma bilgilendirmesi' },
    { monthDay: '09-01', label: 'Mevsim geçişinde cilt ve saç' },
    { monthDay: '10-01', label: 'Farkındalık ayı, erken kontrol' },
    { monthDay: '11-14', label: 'Dünya Diyabet Günü' },
  ],
};
