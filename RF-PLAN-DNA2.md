# RF-PLAN-DNA2 — DesignDNA yanlış yorumlanmasını kökten çöz + tasarım/vision zincirini OpenAI vision'a güvenilir bağla

## Core Focus (tek cümle)
DesignDNA, müşterinin gerçek marka gerçeğinden (yüklü referans görselleri gerçek vision ile +
color_palette kartelası çapa olarak) türetilsin; hiçbir tasarım/vision görevi görsele bakmadan
halüsine etmesin; renk/logo, üretim anında paletten deterministik olarak persist edilen DNA ve
layout'a "pişirilerek" tüm downstream tüketicilerde tutarlı olsun.

## Arka plan (doğrulanmış kök nedenler)
- Prod `AI_DEFAULT_PROVIDER=openai` (vision var); sistem yine kırılgan:
- **KN1 (router):** `router.ts selectProvider()` sat. 106-109 — explicit provider verilince
  `requiredCapabilities` (vision) kontrolü ATLANIYOR; text-only sağlayıcı (claude görselleri düşürür)
  style_analysis'i görsele bakmadan halüsine ettirir. (fake=['text','vision','image_generation'] → etkilenmez.)
- **KN2 (çapa yok):** DNA aşama 1 sadece tek referans görseli + metin besliyor; gerçek color_palette
  kartelası DNA'ya HİÇ girmiyor.
- **KN3 (synthesis text-only, doğru):** yanlış aşama-1'i düzeltemez.
- **KN4 (downstream):** layout renk için palet yaması var ama çelişkili colorUsageRules hâlâ prompt'a
  gidiyor; layout modelinin ürettiği layer renkleri palete deterministik doğrulanmıyor; logo override yok.

## Sabit kararlar (Same Page R1-R2)
- **Palet = güncel yetkili marka gerçeği**; tarihsel referans renklerini EZER.
- **Stage 1 SAF gözlem** (renk zorlaması yok); palet çapası yalnız synthesis + deterministik son-işlem.
- **Prompt-umuduna güvenme:** renk kuralları ve layout layer renkleri palete DETERMİNİSTİK normalize edilir.
- **Palet ÜRETİM ANINDA DNA + layout'a pişirilir** → persist edilen artefaktları okuyan tüm downstream
  (creative-QA, production-package, render) inşa gereği tutarlı. Palet ÜRETİMDEN SONRA düzenlenirse →
  operasyonel rerun (DNA + layout yeniden üret); otomatik invalidation DEFER (RF-ISSUES-DNA2).

## Non-goals
- Görsel üretim modeli/butonları (gpt-image-1 vs KIE) — DOKUNMA.
- Görsel üretimini async job'a çevirmek — DEFER. Yeni DB migration — YOK (provenance DEFER, migration ister).
- Dashboard UI değişikliği. Yeni contrast/legibility motoru — DEFER (mevcut F9 QA yalnız UYARI verir, garanti değil).

## Constraints / stack
- pnpm workspace, TS strict. `model-router`+`prompt-engine` dist'ten tüketiliyor → değişince önce build.
- Türkçe çıktı; enum/hex/koordinat İngilizce. **NOT: yalnız `apps/api` paketinde vitest var**
  (schemas/model-router/prompt-engine'de test runner YOK) → color-normalize + router testleri dahil TÜM
  testler `apps/api/src/**/__tests__/`'e konur, değişen paketlerin build dist'inden import eder.
  Proof: `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run test:stable`.

---

## DETERMİNİSTİK SPEC (paylaşılan; Rock 2 + Rock 3 ortak kullanır)
Yeni saf modül: `packages/schemas/src/color-normalize.ts` (bağımlılıksız, iki pakette de import edilebilir).

- `normalizeHex(h: string): string | null` — trim, `#` opsiyonel; `#RGB`→`#RRGGBB`; 8-haneli (alpha)
  → ilk 6 hane; sonuç `#` + 6 upper-hex; geçersiz → `null`.
- `canonicalizePalette(paletteHexes: string[]): string[]` — her girdiyi `normalizeHex`; `null` olanları AT;
  sırayı koruyarak tekilleştir (ilk görülen kalır). Sonuç boşsa `[]`. **nearestPaletteHex ve
  normalizeColorsToPalette her çağrıda önce paleti bununla kanonikleştirir** (palet lowercase/shorthand/
  duplicate/invalid içerebilir).
- `colorDistance(a: string, b: string): number` — sRGB Öklid: `sqrt((r1-r2)²+(g1-g2)²+(b1-b2)²)`
  (0-255 kanal). (Basit, yeterli; Lab/CIE gerekmez.)
- `nearestPaletteHex(hex, paletteHexes): string` — palet kanonikleştirilir; **kanonik palet boşsa girdiyi
  aynen döndür** (no-op); `normalizeHex(hex)===null` ise kanonik palet[0]; değilse argmin `colorDistance`;
  **beraberlik → kanonik palet dizisinde ÖNCE gelen** (stabil).
- `normalizeColorsToPalette(colors, paletteHexes): string[]` — palet kanonikleştirilir; her rengi
  `nearestPaletteHex` ile eşle, sırayı koruyarak tekilleştir. `colors` boş → `[]`. kanonik palet boş → `colors` aynen.
- **Palet rol sırası (fallback kural + rol-etiketli çıktı için kanonik):** `primary → secondary → accent →
  background → text → other`; **aynı rol içinde orijinal asset sırası** korunur (stabil tie-break).

Tüm fonksiyonlar SAF (I/O yok) → her edge case unit-testlenir (geçersiz hex, #RGB, alpha, boş dizi,
boş/geçersiz/lowercase/duplicate palet, beraberlik).

## LAYOUT RENK NORMALİZER SPEC (Rock 3, saf + recursive)
`normalizeLayoutColors(layout, paletteHexes)` — SAF, layout kopyasını döndürür; kanonik palet boşsa no-op.
Kapsanan alanlar (packages/schemas/src/layout.ts doğrulandı) HER katman derinliğinde recursive gezilir:
- `canvas.backgroundColor` (layout.ts:130)
- her layer `textProperties.color` (37), `shapeProperties.fillColor` (59), `shapeProperties.strokeColor` (60)
- `children[]` (80, `z.lazy` recursive) → aynı normalizasyon rekürsif uygulanır.
Var olan her renk `nearestPaletteHex`'e snap edilir; opsiyonel/eksik alanlara dokunulmaz.

## LOGO KONUM SPEC (Rock 2 son-işlem, deterministik)
- Gözlem kümesi O = per-reference `logoPosition` değerleri; `'none'` ve eksik/omit HARİÇ.
- denominator = |O| (gerçek logo konumu bildiren referans sayısı).
- **Güven koşulu: |O| ≥ 2 VE modal konum count(modal)/|O| > 0.5 (kesin çoğunluk → tek kazanan, beraberlik yok).**
- Güvenliyse: TEK kanonik konum = modal; tüm `logoUsageRules[].preferredPosition` bu değerle ÜZERİNE YAZ.
  **`logoUsageRules` BOŞSA (yazılacak kural yok) → tek kanonik kural EKLE:
  `{ rule: "Logo konumu (referanslardan çıkarıldı)", preferredPosition: <kanonik> }`** (yoksa downstream
  grounded konum alamaz).
- Güven yoksa (|O|<2 veya çoğunluk yok): tüm `logoUsageRules[].preferredPosition` alanını OMIT (kural
  metni kalır, konum düşer); boşsa kural EKLENMEZ. Uydurma "top-left" asla dayatılmaz.

---

## Rock 1 — Vision routing bütünlüğü + route-table gerçeği
**Ne:**
1. `selectProvider()`: explicit `request.provider` YALNIZCA görevin `requiredCapabilities`'ini
   karşılıyorsa onurlansın; karşılamıyorsa capability-filtreli routing-table seçimine düş. Caps boş/
   tanımsızsa explicit eskisi gibi onurlanır (image_generation openai+kie değişmez).
2. **creative_qa route:** `['text','vision']`→`['text']` (bugün görsel göndermiyor, `creative-qa.ts:12`).
3. **gemini seçilemez:** `gemini.isAvailable()`→`false` (placeholder complete() hep fail).
4. **Gözlemlenebilirlik + model sızıntısı:** capability-mismatch takasını logla (requested/selected/neden);
   takasta `request.model` temizle.
**Done looks like:** vision görevinde explicit non-vision sağlayıcı → vision-capable seçilir ve görsel
byte'ları o adapter'a ULAŞIR; explicit image_generation (openai/kie) onurlanır; caps'siz görevde explicit
onurlanır; creative_qa text-only ile çalışır; gemini asla seçilmez.
**Proof:** `apps/api/src/services/__tests__/router-capability.test.ts` (apps/api vitest, dist'ten import) ÇALIŞTIRILABİLİR stub'larla:
(a) explicit 'claude'+style_analysis → seçilen adapter `request.images`'ı GERÇEKTEN alır; (b) 'openai'+
image_generation→openai; (c) 'kie-ai'+image_generation→kie-ai; (d) caps'siz+explicit→o provider;
(e) 'claude'+creative_qa→claude (yeniden yönlendirilmez); (f) gemini hiç seçilmez; (g) takasta model temizlenir.
`pnpm run test:stable` yeşil (router testi apps/api altında).

## Rock 2 — DNA'yı kaynakta marka gerçeğine çapala (renk + logo), stage 1 SAF
**Ne:**
1. **Stage 1 SAF** — style_analysis'e renk zorlaması yok.
2. **`brand-palette-text.ts` sağlamlaştır:** geçerlilik renk SAYISINDAN bağımsız — şema-geçerli ≥1 swatch
   usable (monochrome atılmaz; `<2 distinct` kuralı kalkar). **En yeni color_palette metadata.palette
   safeParse FAIL → fail-closed: palet-YOK gibi davran (uyarı logla), eski sürüme SESSİZCE düşme.**
3. **Synthesis çapası:** `design-dna-synthesis` template + servise "AUTHORITATIVE BRAND PALETTE" bloğu +
   direktif (palet varsa): colorUsageRules paletten türesin, çelişkide palet kazanır.
4. **Deterministik son-işlem (persist ÖNCESİ, palet geçerliyse):**
   - Her `colorUsageRules[].colors` → `normalizeColorsToPalette(colors, paletteHexes)`.
   - `colors`'u olmayan/boş kurallar → metin aynen (açıklayıcı).
   - İşlem sonrası HİÇBİR kuralda palet rengi yoksa VEYA colorUsageRules boşsa → başa fallback kural
     ekle: `{ rule: "Marka ana renkleri (paletten)", colors: [palet hex'leri rol sırasında] }` →
     palet geçerliyken ≥1 palet-renkli kural GARANTİ.
   - Logo: yukarıdaki LOGO KONUM SPEC uygulanır.
**Done looks like:** ≥1 geçerli swatch'lı müşteride DNA rerun → persisted colorUsageRules yalnız palet
hex'leri (#2D5016 yeşili yok), palet boş/tek-renk edge'lerinde bile ≥1 palet kuralı; logo konumu
gözlem çoğunluğundan ya da sinyalsizde omit; paletsiz müşteride DNA renkleri değişmez.
**Proof:** `apps/api/src/services/__tests__/design-dna-analysis-grounding.test.ts` adversarial: per-reference
analizler ÇELİŞEN yeşil + palet mavi → PERSIST edilen DNA colorUsageRules palet mavisi içerir, yeşil
İÇERMEZ; synthesis boş colorUsageRules döndürse bile fallback palet kuralı persist edilir; logo çoğunluktan/
omit; paletsiz müşteride korunur; stage-1 gerçek görsel byte aldığı doğrulanır. + color-normalize saf unit
testleri. `pnpm run test:stable` yeşil.

## Rock 3 — Layout renklerini palete deterministik pişir (tek kaynak, prompt-umudu değil)
**Ne:**
1. `layout-generation.ts`: palet GEÇERLİYKEN, layout üretildikten SONRA persist ETMEDEN önce
   `normalizeLayoutColors(layout, paletteHexes)` (LAYOUT RENK NORMALİZER SPEC — recursive, tüm renk
   alanları + nested children) uygulanır → persist edilen layout palet-doğru olur. Böylece render/
   production-package/creative-QA (persist edilen layout'u okur) inşa gereği tutarlı — runtime resolver yok.
2. Prompt tarafı: palet doluyken çelişen `colorUsageRules` `dnaContext`'ten çıkar (model paleti görsün);
   palet boşken eski davranış (DNA renkleri) korunur.
3. **Legibility:** palet üyeliği text/bg için katı dayatılıp okunmazlık üretebilir → tam contrast
   ENFORCE bu döngüde YOK; mevcut F9 QA yalnızca düşük-kontrast UYARISI verir (garanti değil, DEFER).
**Done looks like:** palet varken PERSIST edilen layout layer renkleri ∈ palet (model off-palette hex
dönse bile normalize edilir); palet yokken DNA renkleri korunur; downstream ekstra resolver'sız tutarlı.
**Proof:** `apps/api/src/services/__tests__/layout-generation-palette.test.ts`: model KASITEN off-palette
hex döndürür → PERSIST edilen layout renkleri palete snap edilmiş (∈ palet) assert; palet boşken renkler
korunur. `pnpm run test:stable` yeşil.

---

## Genel proof (tüm rock'lardan sonra)
- `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run test:stable` yeşil (tüm testler apps/api vitest).
- Claude adversarial: (a) explicit claude+style_analysis vision'a düşer, görsel byte ulaşır; (b) çelişen
  per-reference+palet → persisted DNA renk = palet + boş-colorUsageRules'ta fallback kural; (c) paletsiz
  müşteride SIFIR davranış değişimi; (d) off-palette layout hex → persist'te palete snap.

## Stale/fake DNA — deployment checklist (finding: provenance yokken etkilenen müşteriler)
Provenance DEFER olduğu için etkilenen küme deterministik değil; sınırlı checklist:
1. `design_dna` satırı olan TÜM client'ları listele (bu deploy'dan önce üretilenler eski kod olabilir).
2. Gerçek/aktif müşteri kümesi bugün küçük: **Yenişehir Merkez Koleji (client 7a562ab3…)** + varsa Turyap.
   Her aktif müşteri için: DNA rerun → yeni sürümü GÖZLE doğrula (renk palet mavisi, logo doğru) → ONAYLA;
   ilgili approved layout varsa yeniden üret.
3. Rerun+approval tamamlanışını buraya kaydet (tarih + client + yeni DNA sürüm id).
4. Otomatik toplu invalidation + palet-edit tetikli rerun → RF-ISSUES-DNA2 (follow-up rock).

- Deploy + canlı doğrulama (Yenişehir, gerçek openai vision) kullanıcı onayıyla ayrı adım.
