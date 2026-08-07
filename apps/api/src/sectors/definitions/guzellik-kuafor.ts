import type { SectorDefinition } from '@grafista/schemas';

export const guzellikKuafor: SectorDefinition = {
  key: 'guzellik_kuafor',
  label: 'Güzellik Salonu & Kuaför',
  aliases: [
    'kuaför',
    'güzellik salonu',
    'güzellik merkezi',
    'berber',
    'saç tasarım',
    'saç ve makyaj',
    'beauty salon',
    'hair salon',
    'salon',
  ],

  contentPillars: [
    {
      key: 'stil_donusum',
      label: 'Stil & Dönüşüm',
      weight: 0.3,
      sampleTopics: [
        'Uzun saçtan küt kesime geçen bir müşterinin yeni hâli',
        'Bu hafta en çok istenen bal köpüğü tonu',
        'Doğal dalga fönü nasıl duruyor',
        'Gelin saçı denemesinden bir kare',
        'Kısa saçta yan ayrım ile orta ayrım farkı',
        'Kaş tasarımı sonrası çerçeve değişimi',
      ],
      preferredTemplates: ['photo-caption', 'split-diagonal'],
    },
    {
      key: 'bakim_rehberi',
      label: 'Bakım Rehberi',
      weight: 0.25,
      sampleTopics: [
        'Boyalı saçta renk kaç haftada açılır',
        'Fön makinesini saça kaç santim mesafede tutmalı',
        'Kışın kuruyan saç derisi için ev rutini',
        'Kalıcı ojeyi evde sökmek neden zarar verir',
        'Saç maskesi hangi bölgeye sürülür',
        'Deniz ve havuz sonrası ilk yapılacak şey',
      ],
      preferredTemplates: ['carousel', 'bold-statement'],
    },
    {
      key: 'salon_ekip',
      label: 'Salon & Ekip',
      weight: 0.2,
      sampleTopics: [
        'Sabah salonun açılışı, hazırlanan istasyonlar',
        'Renk ustasının karışım hazırladığı an',
        'Ekibe yeni katılan stilist',
        'Kullandığımız fırçalar ve neden bunlar',
        'Ekip eğitim gününden kareler',
      ],
      preferredTemplates: ['editorial-frame', 'photo-caption'],
    },
    {
      key: 'trend_ilham',
      label: 'Trend & İlham',
      weight: 0.15,
      sampleTopics: [
        'Bu sezon öne çıkan üç saç rengi',
        'Kısa boy saçta güncel kesim çizgileri',
        'Düğün sezonunun favori topuz modeli',
        'Sade manikürün geri dönüşü',
        'Ofis için beş dakikada toparlanan saç',
      ],
      preferredTemplates: ['carousel', 'editorial-frame'],
    },
    {
      key: 'randevu_duyuru',
      label: 'Randevu & Duyuru',
      weight: 0.1,
      sampleTopics: [
        'Hafta içi sabah saatlerinde boş randevu',
        'Bayram öncesi randevuların açılması',
        'Yeni açılan cilt bakımı odası',
        'Çalışma saatlerinde değişiklik',
        'Öğrencilere hafta içi öğlen saatleri',
      ],
      preferredTemplates: ['offer-badge', 'bold-statement'],
    },
  ],

  tone: {
    primary: 'sıcak, güven veren, samimi',
    secondary: 'işini bilen bir usta gibi sakin, abartısız',
    do: [
      'Dokuyu ve ışığı anlat: parlaklık, hacim, düşüş',
      'Tek bir işlemi ya da tek bir bakım tüyosunu konu et',
      'Süreci anlat, sonucu abartma',
      'Randevu çağrısı kısa ve net olsun',
    ],
    dont: [
      'Tıbbi terim kullanma ("tedavi", "terapi", "klinik")',
      'Kalıcı ya da garantili sonuç sözü verme',
      'Kişilerin görünümü üzerinden kıyas ya da utandırma kurma',
      '"Şehrin en iyisi" gibi kanıtlanamaz üstünlük iddiası kurma',
    ],
  },

  hashtags: {
    core: ['#kuaför', '#güzelliksalonu', '#saçbakımı', '#stil', '#bakımgünü'],
    rotating: [
      '#saçkesimi',
      '#saçrengi',
      '#balayaj',
      '#röfle',
      '#gelinsaçı',
      '#topuzmodeli',
      '#fönşekli',
      '#keratinbakım',
      '#saçbakımrutini',
      '#manikür',
      '#pedikür',
      '#kalıcıoje',
      '#ciltbakımı',
      '#kaştasarımı',
      '#günlükmakyaj',
      '#randevuluçalışıyoruz',
    ],
  },

  bestPostingTimes: [
    { dayOfWeek: 0, times: ['11:00'] },
    { dayOfWeek: 1, times: ['10:30'] },
    { dayOfWeek: 2, times: ['13:00', '19:30'] },
    { dayOfWeek: 3, times: ['13:00'] },
    { dayOfWeek: 4, times: ['12:30', '19:30'] },
    { dayOfWeek: 5, times: ['11:00', '18:30'] },
    { dayOfWeek: 6, times: ['10:00', '17:00'] },
  ],

  cadence: {
    postsPerWeek: 4,
    preferredDays: [2, 4, 5, 6],
    avoidDays: [1],
  },

  backgroundStyle: {
    positive:
      'bright modern hair and beauty salon interior, soft diffused daylight through large windows, matte pastel walls with brushed brass details, styling chair and mirror in shallow focus, a few clean tools arranged calmly on a marble surface, no faces in frame, generous empty space across the upper third and one side reserved for text',
    negative: [
      'aşırı rötuşlanmış cilt',
      'stok fotoğraf klişesi poz',
      'tıbbi cihaz ya da klinik görüntüsü',
      'dağınık ve kalabalık tezgâh',
      'sert flaş ışığı',
      'neon renkli filtre',
    ],
    palettePreference: 'warm',
  },

  // Salon ve kuaförler tıbbi işlem yapamaz; içerik dili bakım ve görünümle sınırlı kalır.
  forbidden: [
    'Tıbbi işlem izlenimi veren ifade kullanma; botoks, dolgu, lazer epilasyon salon yetkisinde değildir',
    'Kalıcı ya da garantili sonuç vaadi verme',
    'Saç dökülmesi, akne, sedef gibi durumlar için tedavi ya da çözüm iddiası kurma',
    '"Tedavi", "terapi", "klinik", "hekim" gibi sağlık hizmeti çağrıştıran kelimeleri kullanma',
    'Ürünün cildi ya da saçı iyileştirdiğini söyleme; bakım ve görünüm dilinde kal',
    'Müşterinin yüzünü veya öncesi-sonrası görselini yazılı izin olmadan paylaşma',
    'Yaş, kilo ya da fiziksel görünüm üzerinden utandırıcı kıyas kurma',
    '"Şehrin en iyisi", "bir numara" gibi kanıtlanamaz üstünlük iddiası',
  ],

  seasonalHooks: [
    { monthDay: '02-14', label: 'Sevgililer Günü hazırlığı' },
    { monthDay: '03-08', label: 'Dünya Kadınlar Günü' },
    { monthDay: '05-11', label: 'Anneler Günü haftası' },
    { monthDay: '06-01', label: 'Düğün ve gelin sezonu açılışı' },
    { monthDay: '09-01', label: 'Okul ve iş dönüşü bakım rutini' },
    { monthDay: '12-15', label: 'Yılbaşı öncesi randevu yoğunluğu' },
  ],
};
