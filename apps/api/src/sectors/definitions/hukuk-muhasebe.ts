import type { SectorDefinition } from '@grafista/schemas';

// Türkiye Barolar Birliği Reklam Yasağı Yönetmeliği gereği bu sektörde içerik
// yalnızca genel bilgilendirme olabilir. Kampanya, ücret ve iş vaadi taşıyan
// `offer-badge` şablonu bu sektörde bilinçli olarak kullanılmaz.
export const hukukMuhasebe: SectorDefinition = {
  key: 'hukuk_muhasebe',
  label: 'Hukuk & Mali Müşavirlik',
  aliases: [
    'hukuk',
    'avukat',
    'hukuk bürosu',
    'mali müşavir',
    'mali müşavirlik',
    'muhasebe',
    'smmm',
    'ymm',
    'vergi',
    'arabuluculuk',
  ],

  contentPillars: [
    {
      key: 'mevzuat_takvimi',
      label: 'Mevzuat Takvimi',
      weight: 0.3,
      sampleTopics: [
        'Yıllık gelir vergisi beyannamesinin verildiği dönem',
        'Kurumlar vergisi beyan ve ödeme takvimi',
        'Katma değer vergisi beyannamesinin aylık son günü',
        'Geçici vergi dönemlerinin takvim üzerindeki yeri',
        'Emlak vergisi taksitlerinin son ödeme günleri',
        'Adli tatilin başlangıç ve bitiş tarihleri',
      ],
      preferredTemplates: ['bold-statement', 'carousel'],
    },
    {
      key: 'kavram_aciklama',
      label: 'Kavram Açıklaması',
      weight: 0.25,
      sampleTopics: [
        'İhbar tazminatı ile kıdem tazminatı arasındaki fark',
        'Zamanaşımı ile hak düşürücü sürenin ayrımı',
        'Şahıs şirketi ile limited şirketin sorumluluk farkı',
        'Amortisman kavramının genel işleyişi',
        'Vekâletname türleri ve kapsamları',
        'Arabuluculuğun dava şartı olduğu uyuşmazlık türleri',
      ],
      preferredTemplates: ['carousel', 'editorial-frame'],
    },
    {
      key: 'mevzuat_degisiklikleri',
      label: 'Mevzuat Değişiklikleri',
      weight: 0.2,
      sampleTopics: [
        'Resmî Gazete’de yayımlanan yeni tebliğin kapsamı',
        'Yeniden değerleme oranıyla güncellenen had ve tutarlar',
        'Asgari ücret değişiminin bordro kalemlerine yansıması',
        'E-fatura ve e-defter kapsamına giren mükellef sınırları',
        'Yargı harçlarındaki güncelleme',
        'Yeni yürürlüğe giren usul değişikliğinin genel çerçevesi',
      ],
      preferredTemplates: ['bold-statement', 'split-diagonal'],
    },
    {
      key: 'sik_sorulan_konular',
      label: 'Sıkça Sorulan Genel Konular',
      weight: 0.15,
      sampleTopics: [
        'Kira artış oranının hangi ölçüte göre belirlendiği',
        'İşe iade başvurusunda genel süre kuralı',
        'Serbest meslek makbuzunun düzenlenme esasları',
        'Şirket kuruluşunda istenen temel belgeler',
        'Mirasta yasal pay dağılımının genel mantığı',
      ],
      preferredTemplates: ['carousel', 'editorial-frame'],
    },
    {
      key: 'meslek_kulturu',
      label: 'Ofis & Meslek Kültürü',
      weight: 0.1,
      sampleTopics: [
        'Kanun maddesinden bir alıntı ve sade açıklaması',
        'Meslek günlerine dair kısa bilgilendirme',
        'Ofisin çalışma ve görüşme saatleri duyurusu',
        'Mesleki terminolojide sık karıştırılan iki kelime',
        'Bir mevzuat kavramının tarihsel arka planı',
      ],
      preferredTemplates: ['quote-card', 'photo-caption'],
    },
  ],

  tone: {
    primary: 'ölçülü ve bilgilendirici',
    secondary: 'mesafeli, kesinlik iddia etmeyen, sade',
    do: [
      'Yalnızca genel ve kamuya açık bilgi ver',
      'Tarih, süre ve oranı kaynağıyla birlikte yaz',
      'Her içeriğin sonunda somut olayın kendi koşullarına bağlı olduğunu belirt',
      'Cümleyi kısa kur, terimi ilk geçtiği yerde açıkla',
    ],
    dont: [
      'İş vaadi, dava sonucu ya da başarı oranı ifadesi kullanma',
      'Müvekkil referansı, teşekkür mesajı ya da dosya örneği paylaşma',
      'Ücret, indirim ya da kampanya duyurusu yapma',
      '"En iyi", "uzman", "lider" gibi üstünlük iddiası kurma',
    ],
  },

  hashtags: {
    core: ['#hukuk', '#mevzuat', '#vergi', '#bilgilendirme', '#malimüşavirlik'],
    rotating: [
      '#gelirvergisi',
      '#kurumlarvergisi',
      '#kdv',
      '#beyanname',
      '#vergitakvimi',
      '#işhukuku',
      '#borçlarhukuku',
      '#ticarethukuku',
      '#ailehukuku',
      '#kiralarhukuku',
      '#arabuluculuk',
      '#şirketkuruluşu',
      '#bordro',
      '#efatura',
      '#resmigazete',
      '#hukuksalbilgi',
    ],
  },

  bestPostingTimes: [
    { dayOfWeek: 1, times: ['09:00'] },
    { dayOfWeek: 2, times: ['09:30', '13:00'] },
    { dayOfWeek: 3, times: ['09:30'] },
    { dayOfWeek: 4, times: ['09:30', '13:00'] },
    { dayOfWeek: 5, times: ['09:00', '16:30'] },
    { dayOfWeek: 6, times: ['11:00'] },
    { dayOfWeek: 0, times: ['11:00'] },
  ],

  cadence: {
    postsPerWeek: 2,
    preferredDays: [2, 4],
    avoidDays: [0, 6],
  },

  backgroundStyle: {
    positive:
      'restrained corporate photography of a quiet professional office, soft natural window light, dark wooden desk, bound books and neatly stacked closed folders, brushed metal and deep navy surfaces, shallow depth of field, no readable text on documents, no faces and no people, calm symmetric composition with generous empty space across the upper half for text',
    negative: [
      'adalet terazisi ve tokmak klişesi',
      'takım elbiseli el sıkışma stok fotoğrafı',
      'para ve banknot görüntüsü',
      'okunabilir belge ya da dosya metni',
      'yüz görünen kişi fotoğrafı',
    ],
    palettePreference: 'cool',
  },

  forbidden: [
    'İş, müvekkil ya da dosya kabulüne yönelik davet ve vaat kurma',
    'Dava sonucu, kazanma oranı ya da "kazandırdık" türü ifade kullanma',
    'Müvekkil referansı, teşekkür mesajı veya memnuniyet paylaşımı yapma',
    'Ücret, ücret aralığı, indirim veya kampanya duyurusu yapma',
    '"En iyi", "uzman", "lider", "bir numara" gibi üstünlük iddiası kurma',
    'Somut bir olaya özel hukuki ya da mali tavsiye verme',
    'Kimliği anlaşılabilecek dosya, taraf ya da olay detayı paylaşma',
    'Meslektaşları ya da diğer büroları kıyaslayarak öne çıkma',
  ],

  seasonalHooks: [
    { monthDay: '01-01', label: 'Yeniden değerleme oranıyla güncellenen had ve tutarlar' },
    { monthDay: '03-01', label: 'Muhasebe Haftası ve yıllık gelir vergisi beyan dönemi' },
    { monthDay: '04-05', label: 'Avukatlar Günü' },
    { monthDay: '04-30', label: 'Kurumlar vergisi beyan ve ödeme son günü' },
    { monthDay: '05-31', label: 'Emlak vergisi birinci taksit son günü' },
    { monthDay: '07-20', label: 'Adli tatilin başlangıcı' },
    { monthDay: '09-01', label: 'Yeni adli yılın açılışı' },
  ],
};
