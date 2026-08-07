import type { SectorDefinition } from '@grafista/schemas';

export const disKlinigi: SectorDefinition = {
  key: 'dis_klinigi',
  label: 'Diş Kliniği',
  aliases: [
    'diş kliniği',
    'diş hekimi',
    'dişçi',
    'ağız ve diş sağlığı',
    'ağız diş sağlığı polikliniği',
    'diş polikliniği',
    'dental',
    'dental klinik',
    'ortodonti',
  ],

  // Sağlık hizmeti tanıtımı mevzuatla sınırlı: kampanya, hasta görüşü ve
  // öncesi-sonrası içeriği yoktur. Sütunlar bilgilendirme ekseninde kurulur.
  contentPillars: [
    {
      key: 'agiz_sagligi_bilgi',
      label: 'Ağız Sağlığı Bilgilendirme',
      weight: 0.35,
      sampleTopics: [
        'Diş fırçalarken en sık atlanan bölge neresi',
        'Diş ipi fırçadan önce mi sonra mı kullanılır',
        'Diş eti kanaması ne anlama gelebilir',
        'Soğuk suya hassasiyetin bilinen nedenleri',
        'Diş fırçası kaç ayda bir değişmeli',
        'Asitli içecek sonrası neden hemen fırçalanmaz',
      ],
      preferredTemplates: ['carousel', 'bold-statement'],
    },
    {
      key: 'klinik_gunlugu',
      label: 'Klinik Günlüğü',
      weight: 0.25,
      sampleTopics: [
        'Sterilizasyon ünitesinde günün ilk döngüsü',
        'Randevu öncesi hazırlanan muayene odası',
        'Klinikte kullanılan görüntüleme cihazı ve ne işe yarar',
        'Hekimlerin katıldığı mesleki eğitim günü',
        'Tek kullanımlık malzemelerin hazırlanışı',
        'Sabah açılışında sessiz bekleme salonu',
      ],
      preferredTemplates: ['photo-caption', 'editorial-frame'],
    },
    {
      key: 'soru_cevap',
      label: 'Sık Sorulanlar',
      weight: 0.2,
      sampleTopics: [
        'Kontrol muayenesi ne sıklıkla yapılır',
        'Yirmilik diş her zaman çekilir mi',
        'Hamilelikte diş kontrolü yapılır mı',
        'Diş taşı temizliği dişi aşındırır mı',
        'Gece diş sıkma neden fark edilmez',
        'Ağız kokusunun ağız içi kaynaklı nedenleri',
      ],
      preferredTemplates: ['quote-card', 'carousel'],
    },
    {
      key: 'cocuk_dis_sagligi',
      label: 'Çocuk Diş Sağlığı',
      weight: 0.1,
      sampleTopics: [
        'Süt dişi düşmeden yenisi çıkarsa ne olur',
        'İlk diş hekimi ziyareti kaç yaşında',
        'Çocukta biberon çürüğü nasıl oluşur',
        'Çocuğa fırçalama alışkanlığı kazandırma yolları',
        'Okul çağında ağız içi darbede ilk adım',
      ],
      preferredTemplates: ['carousel', 'photo-caption'],
    },
    {
      key: 'kurumsal_bilgi',
      label: 'Kurumsal Bilgilendirme',
      weight: 0.1,
      sampleTopics: [
        'Bayram günleri çalışma saatleri',
        'Kliniğe ulaşım ve otopark bilgisi',
        'Randevu nasıl alınır, hangi bilgiler gerekir',
        'Engelli erişimi için yapılan düzenleme',
        'Kliniğe katılan yeni hekimin uzmanlık alanı',
      ],
      preferredTemplates: ['bold-statement', 'editorial-frame'],
    },
  ],

  tone: {
    primary: 'sakin, açıklayıcı, güven veren',
    secondary: 'bilgilendirici ve mesafeli, hiçbir zaman satış dili değil',
    do: [
      'Tek bir soruya tek bir net cevap ver',
      'Kaynağı belirsiz sayı değil, genel kabul görmüş bilgi kullan',
      'Kişiye özel durumlar için muayene gerektiğini hatırlat',
      'Sade Türkçe kullan, tıbbi terimi hemen açıkla',
    ],
    dont: [
      'Öncesi-sonrası görsel ya da tedavi sonucu paylaşma',
      'Fiyat, indirim, taksit veya kampanya dili kurma',
      'Hasta görüşü, teşekkür mesajı ya da referans aktarma',
      '"Garantili", "acısız", "tek seansta" gibi iddialarda bulunma',
    ],
  },

  hashtags: {
    core: ['#dişsağlığı', '#ağızsağlığı', '#dişhekimi', '#sağlıklıgülüş', '#dişkliniği'],
    rotating: [
      '#dişfırçalama',
      '#dişipi',
      '#dişetisağlığı',
      '#çürükönleme',
      '#sütdişi',
      '#çocukdişhekimliği',
      '#ortodonti',
      '#ağızhijyeni',
      '#diştaşıtemizliği',
      '#dişsıkma',
      '#ağızkokusu',
      '#florür',
      '#düzenlikontrol',
      '#dişhassasiyeti',
      '#koruyucudişhekimliği',
      '#doğrubilgi',
    ],
  },

  bestPostingTimes: [
    { dayOfWeek: 0, times: ['12:00'] },
    { dayOfWeek: 1, times: ['09:00', '18:00'] },
    { dayOfWeek: 2, times: ['09:00'] },
    { dayOfWeek: 3, times: ['09:00', '18:00'] },
    { dayOfWeek: 4, times: ['12:30'] },
    { dayOfWeek: 5, times: ['09:30', '17:30'] },
    { dayOfWeek: 6, times: ['11:00'] },
  ],

  cadence: {
    postsPerWeek: 3,
    preferredDays: [1, 3, 5],
    avoidDays: [0],
  },

  backgroundStyle: {
    positive:
      'calm modern dental clinic interior, soft cool daylight, matte white and pale mint surfaces, clean sterilised instruments and equipment resting in shallow focus, quiet architectural lines and a single plant, absolutely no patients and no close-up mouth or teeth imagery, generous empty space across the upper half reserved for text',
    negative: [
      'ağız içi ya da diş yakın çekimi',
      'hasta ya da tedavi anı görüntüsü',
      'aşırı beyazlatılmış gülüş klişesi',
      'korkutucu tıbbi alet vurgusu',
      'sert flaş ışığı',
      'stok fotoğraf klişesi hekim pozu',
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
    'Hasta görüntüsü, ağız içi fotoğrafı ya da tedavi anı görüntüsü paylaşma',
    'Sosyal medya üzerinden teşhis koyma, tedavi önerme veya uzaktan muayene izlenimi verme',
    'Çekiliş, hediye, "arkadaşını getir" gibi hasta yönlendiren teşvik kurgusu kullanma',
  ],

  seasonalHooks: [
    { monthDay: '01-02', label: 'Yeni yılda düzenli kontrol alışkanlığı' },
    { monthDay: '03-20', label: 'Dünya Ağız Sağlığı Günü' },
    { monthDay: '04-23', label: 'Çocuk Bayramı, çocukta ağız sağlığı' },
    { monthDay: '06-15', label: 'Yaz tatili öncesi kontrol' },
    { monthDay: '09-01', label: 'Okul dönüşü diş kontrolü' },
    { monthDay: '11-21', label: 'Ağız ve Diş Sağlığı Haftası' },
  ],
};
