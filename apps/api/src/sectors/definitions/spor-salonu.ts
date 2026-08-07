import type { SectorDefinition } from '@grafista/schemas';

export const sporSalonu: SectorDefinition = {
  key: 'spor_salonu',
  label: 'Spor Salonu & Fitness',
  aliases: [
    'spor salonu',
    'spor merkezi',
    'fitness',
    'fitness center',
    'gym',
    'crossfit',
    'pilates stüdyosu',
    'yoga stüdyosu',
    'kişisel antrenör',
    'antrenman salonu',
  ],

  contentPillars: [
    {
      key: 'hareket_teknigi',
      label: 'Hareket & Teknik',
      weight: 0.3,
      sampleTopics: [
        'Squat sırasında dizin ayak hizasını koruması',
        'Deadlift kaldırışında sırtın nötr kalması',
        'Şınavda omuz açısı neden 45 derece',
        'Plankta bel çökmesini engelleyen ipucu',
        'Koşu bandında adım sıklığı ve duruş',
        'Isınma ve soğuma neden atlanmaz',
      ],
      preferredTemplates: ['split-diagonal', 'carousel'],
    },
    {
      key: 'ders_ve_program',
      label: 'Ders & Program',
      weight: 0.2,
      sampleTopics: [
        'Bu haftanın grup ders takvimi',
        'Yeni açılan sabah pilates saati',
        'Üst vücut gününde hareket sırası nasıl kurulur',
        'Haftada üç gün antrenman planı örneği',
        'Yeni başlayan için ilk iki hafta nasıl geçer',
        'Yoga dersinde kullanılan nefes çalışması',
      ],
      preferredTemplates: ['carousel', 'bold-statement'],
    },
    {
      key: 'topluluk_uye',
      label: 'Topluluk & Üye Hayatı',
      weight: 0.2,
      sampleTopics: [
        'Sabah 07:00 grubunun düzenli üyeleri',
        'Salon içi mini turnuva günü',
        'Antrenörle tanışma: kimin hangi branşı var',
        'Üyelerin en çok tercih ettiği ders saati',
        'Birlikte koşuya çıkan hafta sonu grubu',
      ],
      preferredTemplates: ['photo-caption', 'quote-card'],
    },
    {
      key: 'tesis_ekipman',
      label: 'Tesis & Ekipman',
      weight: 0.15,
      sampleTopics: [
        'Yeni gelen serbest ağırlık takımı',
        'Soyunma odası ve duş düzeni',
        'Ekipman bakımı ve temizlik rutini',
        'Fonksiyonel antrenman alanının kullanımı',
        'Kardiyo bölümünde hangi cihaz ne işe yarar',
      ],
      preferredTemplates: ['editorial-frame', 'photo-caption'],
    },
    {
      key: 'uyelik_duyuru',
      label: 'Üyelik & Duyuru',
      weight: 0.15,
      sampleTopics: [
        'Yeni dönem üyelik kayıtları açıldı',
        'Hafta içi gündüz saatleri için esnek üyelik',
        'Öğrenci üyelik koşulları',
        'Bayram günleri çalışma saatleri',
        'Deneme dersi nasıl planlanır',
      ],
      preferredTemplates: ['offer-badge', 'bold-statement'],
    },
  ],

  tone: {
    primary: 'enerjik ama gerçekçi',
    secondary: 'destekleyici bir antrenör gibi; baskı değil süreklilik anlatır',
    do: [
      'Tek bir hareketi ya da tek bir alışkanlığı konu et',
      'Formu ve güvenliği sonuçtan önce anlat',
      'Yeni başlayanı kapsayan bir dil kur',
      'Süreklilik vurgusu yap, hız yarışı kurma',
    ],
    dont: [
      'Kilo verme garantisi ya da süre taahhüdü verme',
      'Sağlık iddiası kurma ya da tedavi eder deme',
      'Takviye, yağ yakıcı veya diyet önerisi verme',
      'Beden tipi üzerinden utandırma ya da "yaza kalmadı" baskısı kurma',
    ],
  },

  hashtags: {
    core: ['#spor', '#fitness', '#antrenman', '#sporsalonu', '#düzenlihareket'],
    rotating: [
      '#kuvvetantrenmanı',
      '#kardiyo',
      '#esneme',
      '#pilates',
      '#yoga',
      '#grupdersi',
      '#formkontrolü',
      '#ısınma',
      '#toparlanma',
      '#antrenmanplanı',
      '#sabahsporu',
      '#akşamantrenmanı',
      '#kişiselantrenör',
      '#serbestağırlık',
      '#fonksiyonelantrenman',
      '#süreklilik',
    ],
  },

  bestPostingTimes: [
    { dayOfWeek: 0, times: ['11:00', '19:30'] },
    { dayOfWeek: 1, times: ['07:00', '18:30'] },
    { dayOfWeek: 2, times: ['12:30', '19:00'] },
    { dayOfWeek: 3, times: ['07:00', '18:30'] },
    { dayOfWeek: 4, times: ['19:00'] },
    { dayOfWeek: 5, times: ['12:00', '17:30'] },
    { dayOfWeek: 6, times: ['10:30'] },
  ],

  cadence: {
    postsPerWeek: 4,
    preferredDays: [0, 1, 3, 5],
    avoidDays: [6],
  },

  backgroundStyle: {
    positive:
      'modern gym interior in natural morning light, matte black steel and raw concrete surfaces, racked free weights and equipment in shallow focus, faint chalk dust and floor texture, wide calm composition without posed models or body close-ups, generous empty space across the upper third and along one side reserved for text',
    negative: [
      'aşırı kaslı ve rötuşlanmış model pozu',
      'öncesi-sonrası vücut kurgusu',
      'takviye ya da protein ürünü vitrini',
      'agresif kırmızı neon aydınlatma',
      'kalabalık ve dağınık salon kadrajı',
      'stok fotoğraf klişesi gülümseme',
    ],
    palettePreference: 'neutral',
  },

  forbidden: [
    'Kilo verme garantisi verme; "2 haftada 10 kilo" gibi süre ve miktar taahhüdü kurma',
    'Hastalık iyileştirme ya da tedavi iddiası kurma (bel fıtığını geçirir, diyabeti çözer gibi)',
    'Takviye, yağ yakıcı veya protein ürünü önerme; bu bir sağlık danışmanlığıdır',
    'Kişiye özel beslenme ya da diyet programı verme; diyetisyen yetkisindedir',
    'Beden tipi üzerinden utandırma ya da kaygı yaratarak üyeliğe yönlendirme',
    'Üyenin öncesi-sonrası fotoğrafını yazılı izin olmadan ya da sonuç vaadi olarak kullanma',
    'Sakatlık riski taşıyan hareketi uzman gözetimi uyarısı olmadan tarif etme',
    'Kanıtlanamaz üstünlük iddiası kurma ("şehrin en iyi salonu", "bir numaralı program")',
  ],

  seasonalHooks: [
    { monthDay: '01-02', label: 'Yeni yıl hedefleri ve ilk hafta' },
    { monthDay: '03-01', label: 'Bahar başlangıcı, dışarı çıkan antrenman' },
    { monthDay: '05-19', label: 'Gençlik ve Spor Bayramı' },
    { monthDay: '06-15', label: 'Yaz döneminde antrenman saati düzeni' },
    { monthDay: '09-01', label: 'Okul ve iş dönüşü rutine geri dönüş' },
    { monthDay: '11-01', label: 'Kış aylarında kapalı alan antrenmanı' },
  ],
};
