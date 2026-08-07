import type { SectorDefinition } from '@grafista/schemas';

export const pastaneFirin: SectorDefinition = {
  key: 'pastane_firin',
  label: 'Pastane & Fırın',
  aliases: [
    'pastane',
    'fırın',
    'ekmek fırını',
    'unlu mamul',
    'pasta',
    'butik pasta',
    'tatlıcı',
    'börekçi',
    'simitçi',
    'bakery',
    'patisserie',
  ],

  contentPillars: [
    {
      key: 'gunun_urunu',
      label: 'Günün Ürünü',
      weight: 0.35,
      sampleTopics: [
        'Fırından yeni çıkmış ekşi mayalı ekmeğin kabuğu',
        'Sabah tepsiye dizilen açma ve poğaçalar',
        'Bu haftanın mevsim meyveli tartı',
        'Tereyağlı kurabiyenin kesit görüntüsü',
        'Öğleden sonra çıkan ikinci ekmek partisi',
        'Vitrindeki dilim pastaların günlük sırası',
      ],
      preferredTemplates: ['photo-caption', 'bold-statement'],
    },
    {
      key: 'mutfak_uretim',
      label: 'Mutfak & Üretim',
      weight: 0.2,
      sampleTopics: [
        'Ekşi mayanın gece boyu dinlenme süreci',
        'Hamurun elle açıldığı sabah saatleri',
        'Fırıncının taş fırını ısıttığı ilk saat',
        'Krema hazırlanırken kullanılan malzemeler',
        'Un ve tereyağının nereden geldiği',
        'Günün sonunda tezgâhın temizlenmesi',
      ],
      preferredTemplates: ['editorial-frame', 'photo-caption'],
    },
    {
      key: 'ozel_siparis',
      label: 'Özel Sipariş & Pasta',
      weight: 0.2,
      sampleTopics: [
        'Doğum günü pastası siparişi kaç gün önceden verilmeli',
        'Nişan pastasında katman ve porsiyon hesabı',
        'Kişiye özel yazı ve süsleme seçenekleri',
        'Kurumsal ikramlık kutu içerikleri',
        'Glütensiz seçeneklerin hazırlanma koşulları',
        'Sipariş teslim saati ve soğuk zincir uyarısı',
      ],
      preferredTemplates: ['carousel', 'split-diagonal'],
    },
    {
      key: 'kampanya_duyuru',
      label: 'Kampanya & Duyuru',
      weight: 0.15,
      sampleTopics: [
        'Sabah 07.00 ekmek çıkış saati duyurusu',
        'Hafta sonu kahvaltılık sepeti',
        'Bayram öncesi sipariş son tarihi',
        'Yeni açılan ikinci şubenin adresi',
        'Öğleden sonra kurabiye tepsisi kampanyası',
      ],
      preferredTemplates: ['offer-badge', 'bold-statement'],
    },
    {
      key: 'musteri_sesi',
      label: 'Müşteri Sesi',
      weight: 0.1,
      sampleTopics: [
        'Her sabah aynı saatte gelen müdavimin siparişi',
        'Bir müşterinin pasta teslimi sonrası bıraktığı not',
        'En çok sorulan soru: hangi ekmek kaç gün tazeliğini korur',
        'Mahalleden gelen ekmek tarifi önerisi',
        'Çocukların en sevdiği kurabiye hangisi',
      ],
      preferredTemplates: ['quote-card', 'carousel'],
    },
  ],

  tone: {
    primary: 'sıcak ve iştah açan',
    secondary: 'mahalle esnafı gibi içten, gösterişsiz',
    do: [
      'Kokuyu, sıcaklığı ve çıtırtıyı hissettir',
      'Ürünün çıkış saatini net yaz',
      'Malzemenin adını ve kaynağını söyle',
      'İçindekiler ve alerjen bilgisini açıkça belirt',
    ],
    dont: [
      'Sağlık ve zayıflama iddiası kurma',
      'Abartılı sıfat yığma ("dünyanın en iyisi")',
      'Bayat ürünü taze gibi gösterme',
      'Rakip fırınlarla kıyaslama yapma',
    ],
  },

  hashtags: {
    core: ['#fırın', '#pastane', '#tazeekmek', '#elyapımı', '#günlüktaze'],
    rotating: [
      '#ekşimaya',
      '#taşfırın',
      '#poğaça',
      '#açma',
      '#simit',
      '#börek',
      '#kurabiye',
      '#butikpasta',
      '#doğumgünüpastası',
      '#yaşpasta',
      '#tartveturta',
      '#tereyağlı',
      '#sabahtazesi',
      '#mahallefırını',
      '#kahvaltılık',
      '#siparişealınır',
    ],
  },

  bestPostingTimes: [
    { dayOfWeek: 0, times: ['08:30', '16:00'] },
    { dayOfWeek: 1, times: ['07:30'] },
    { dayOfWeek: 2, times: ['07:30', '16:30'] },
    { dayOfWeek: 3, times: ['07:30'] },
    { dayOfWeek: 4, times: ['07:30', '16:30'] },
    { dayOfWeek: 5, times: ['07:00', '17:00'] },
    { dayOfWeek: 6, times: ['08:00', '15:30'] },
  ],

  cadence: {
    postsPerWeek: 4,
    preferredDays: [2, 4, 5, 6],
    avoidDays: [],
  },

  backgroundStyle: {
    positive:
      'warm morning light bakery photography, rustic flour dusted wooden counter, crusty bread and pastry texture in sharp detail, soft steam rising, shallow depth of field, muted cream and golden brown tones, single product as the subject, calm uncluttered composition with generous empty space across the upper third for text',
    negative: [
      'plastik görünümlü yapay pasta',
      'aşırı doygun ve parlak renkler',
      'üst üste yığılmış dağınık tepsiler',
      'sert flaş ışığı',
      'stok fotoğraf klişesi şef pozu',
    ],
    palettePreference: 'warm',
  },

  // 5996 sayılı Gıda Kanunu ve TGK etiketleme mevzuatı: alerjen beyanı zorunlu.
  forbidden: [
    'Alerjen bilgisini eksik ya da belirsiz verme (gluten, süt, yumurta, fındık)',
    'Sağlık iddiası yapma ("diyet", "zayıflatır", "şifalı")',
    'Gerçekte şeker içeren ürüne "şekersiz" deme',
    'Sahip olunmayan gıda güvenliği sertifikası ya da denetim belgesi iddiası',
    'Glütensiz üretim ayrı hatta yapılmıyorsa "glütensiz" ibaresini kullanma',
  ],

  seasonalHooks: [
    { monthDay: '01-01', label: 'Yılbaşı sonrası ilk fırın sabahı' },
    { monthDay: '02-14', label: 'Sevgililer Günü özel pasta siparişleri' },
    { monthDay: '04-23', label: 'Ulusal Egemenlik ve Çocuk Bayramı ikramlıkları' },
    { monthDay: '05-14', label: 'Anneler Günü pasta haftası' },
    { monthDay: '06-15', label: 'Babalar Günü tatlı seçenekleri' },
    { monthDay: '10-29', label: 'Cumhuriyet Bayramı' },
    { monthDay: '12-31', label: 'Yılbaşı gecesi sipariş son günü' },
  ],
};
