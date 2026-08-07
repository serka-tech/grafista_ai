import type { SectorDefinition } from '@grafista/schemas';

export const egitimKurs: SectorDefinition = {
  key: 'egitim_kurs',
  label: 'Eğitim Kurumu & Kurs',
  aliases: [
    'eğitim',
    'kurs',
    'dershane',
    'etüt merkezi',
    'özel okul',
    'anaokulu',
    'kreş',
    'dil kursu',
    'yabancı dil',
    'yazılım kursu',
    'müzik kursu',
    'sürücü kursu',
    'akademi',
    'education',
  ],

  contentPillars: [
    {
      key: 'ogrenme_ipucu',
      label: 'Öğrenme İpucu',
      weight: 0.3,
      sampleTopics: [
        'Sınav haftasında çalışma programı nasıl bölünür',
        'Paragraf sorularında zaman kazandıran okuma yöntemi',
        'Yeni öğrenilen kelimeleri kalıcı hale getirmenin yolu',
        'Deneme sonrası hata analizi nasıl yapılır',
        'Evde çalışma masasını dikkat dağıtmayacak şekilde kurmak',
        'Ders çalışırken telefonu uzak tutmanın pratik yolu',
      ],
      preferredTemplates: ['carousel', 'bold-statement'],
    },
    {
      key: 'egitim_programi',
      label: 'Program & Ders Tanıtımı',
      weight: 0.25,
      sampleTopics: [
        'Hafta sonu matematik takviye programının içeriği',
        'Başlangıç seviyesi İngilizce kursunda ilk sekiz hafta',
        'Birebir etüt saatlerinin nasıl planlandığı',
        'Yaz döneminde açılan robotik atölyesi',
        'Deneme sınavı takvimi ve sonuç değerlendirme süreci',
        'Sınıf mevcudunun neden sınırlı tutulduğu',
      ],
      preferredTemplates: ['split-diagonal', 'editorial-frame'],
    },
    {
      key: 'kurum_yasami',
      label: 'Kurum Yaşamı',
      weight: 0.2,
      sampleTopics: [
        'Ders öncesi sabah sınıfının hazırlanması',
        'Laboratuvarda yapılan deney çalışması',
        'Kütüphane ve sessiz çalışma alanı düzeni',
        'Öğretmenler odasında haftalık değerlendirme toplantısı',
        'Servis ve giriş çıkış güvenliğinin işleyişi',
        'Yıl sonu sergisinin hazırlık günleri',
      ],
      preferredTemplates: ['photo-caption', 'editorial-frame'],
    },
    {
      key: 'kayit_duyuru',
      label: 'Kayıt & Duyuru',
      weight: 0.15,
      sampleTopics: [
        'Yeni dönem kayıtlarının açıldığı tarih',
        'Ücretsiz seviye tespit sınavı randevusu',
        'Veli bilgilendirme toplantısının gün ve saati',
        'Kardeş kaydı ve erken kayıt koşulları',
        'Yarıyıl tatili kamp programının kontenjanı',
      ],
      preferredTemplates: ['offer-badge', 'bold-statement'],
    },
    {
      key: 'veli_ogrenci_sesi',
      label: 'Veli & Öğrenci Sesi',
      weight: 0.1,
      sampleTopics: [
        'Bir velinin dönem sonunda bıraktığı not',
        'Mezun bir öğrencinin üniversiteden gönderdiği mesaj',
        'Velilerin en sık sorduğu soru ve kurumun cevabı',
        'Öğrencinin kendi çalışma rutinini anlatması',
        'Rehber öğretmenin veli görüşmelerinden çıkardığı ortak başlık',
      ],
      preferredTemplates: ['quote-card', 'carousel'],
    },
  ],

  tone: {
    primary: 'güven veren ve açıklayıcı',
    secondary: 'sakin bir öğretmen dili, abartısız',
    do: [
      'Yöntemi ve süreci somut adımlarla anlat',
      'Veliye ve öğrenciye ayrı ayrı seslen',
      'Sayıyı ve tarihi net yaz, belirsiz bırakma',
      'Öğrenmenin zaman aldığını dürüstçe söyle',
    ],
    dont: [
      'Başarıyı garanti eden cümle kurma',
      'Korku ve kaygı üzerinden ikna etmeye çalışma',
      'Başka kurumları ima ederek küçümseme',
      'Öğrenciyi not veya sıralama üzerinden etiketleme',
    ],
  },

  hashtags: {
    core: ['#eğitim', '#kurs', '#öğrenme', '#öğrenci', '#derskaydı'],
    rotating: [
      '#sınavhazırlık',
      '#lgs',
      '#yks',
      '#tyt',
      '#ayt',
      '#dersçalışma',
      '#etüt',
      '#İngilizcekursu',
      '#yabancıdil',
      '#matematik',
      '#rehberlik',
      '#velibilgilendirme',
      '#yenidönem',
      '#kayıtlarbaşladı',
      '#yazokulu',
      '#kodlamaeğitimi',
    ],
  },

  bestPostingTimes: [
    { dayOfWeek: 0, times: ['11:00', '20:00'] },
    { dayOfWeek: 1, times: ['08:00', '20:30'] },
    { dayOfWeek: 2, times: ['20:30'] },
    { dayOfWeek: 3, times: ['12:30', '20:30'] },
    { dayOfWeek: 4, times: ['20:30'] },
    { dayOfWeek: 5, times: ['17:30'] },
    { dayOfWeek: 6, times: ['11:00', '19:30'] },
  ],

  cadence: {
    postsPerWeek: 3,
    preferredDays: [1, 3, 6],
    avoidDays: [5],
  },

  backgroundStyle: {
    positive:
      'bright natural daylight in a modern classroom or study space, clean desks, open notebooks and simple stationery, soft shadows, no faces visible, calm and orderly composition, muted blue and warm wood tones, generous empty space in the upper half and along one side for headline text',
    negative: [
      'yapay gülümseyen stok öğrenci fotoğrafı',
      'kalabalık ve dağınık sınıf',
      'diploma ve kupa yığını',
      'aşırı doygun renkler ve keskin flaş',
      'okunmayan küçük yazı dolu tahta',
    ],
    palettePreference: 'cool',
  },

  forbidden: [
    'Sınav başarısı garantisi verme ("kesin kazandırırız")',
    'Kesin sıralama ya da puan artışı vaadi verme',
    'Öğrenci ismini veya fotoğrafını velinin yazılı izni olmadan paylaşma',
    'MEB onayı bulunmayan programı onaylı gibi tanıtma',
  ],

  seasonalHooks: [
    { monthDay: '01-20', label: 'Yarıyıl tatili takviye programları' },
    { monthDay: '02-10', label: 'İkinci dönem başlangıcı' },
    { monthDay: '06-01', label: 'LGS sınav haftası' },
    { monthDay: '06-15', label: 'YKS sınav haftası' },
    { monthDay: '08-15', label: 'Yeni dönem kayıt sezonu' },
    { monthDay: '09-09', label: 'Okulların açılışı ve ilk hafta rutini' },
    { monthDay: '11-24', label: 'Öğretmenler Günü' },
  ],
};
