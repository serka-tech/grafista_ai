# DEVİR — Grafista sadeleştirme (sektör + takvim + şablon) — 2026-08-07

**Hedef:** Grafista'yı kullanıcının "çok karmaşık, çıktılar istediğim gibi değil" dediği
9 aşamalı / 7 onay kapılı sistemden, firma sektörüne göre içerik üreten + aylık takvim kuran +
tasarımı deterministik şablonla çizen sade bir akışa dönüştürmek.
**İlk hareket:** Faz 3'e başla (migration 029-032 + `studio/worker.ts`).
**Teyit:** `cd Projeler/Grafista-AI-Studio && pnpm run test:stable` → 43 dosya / 860 test geçmeli.

Plan dosyası (faz tablosu, riskler, doğrulama):
`~/.claude/plans/projeler-grafista-ai-studio-projemi-al-cuddly-whistle.md`

---

## DEĞİŞMEZLER (bağlayıcı — yeniden tartışma)

Kullanıcının işi tarif eden cümlesi, verbatim:

> "bu projeyi yaparken ben daha basit düşünmüştüm ancak tamamlanan proje hem çok karmaşık hemde
> zor bir sistem oldu. çıkışlarda istediğim gibi değil. daha basit ve daha iyi çıktılar
> alabileceğim bir sisteme dönüştürmek istiyorum. firma sektörlerine ve özelliklerine göre
> içerik üretsin, içerik takvimi oluştursun, tasarımları yapsın. bu benim için şimdilik yeterli
> olacak. Referans alabileceği görseller yine olsun."

Kullanıcının açıkça seçtiği yedi karar (soruldu, cevaplandı, tartışma kapandı):

1. **Aynı repoda yeni sade akış.** Eski 18 sayfa SİLİNMEZ, `app/(legacy)/` grubuna taşınıp
   bayrakla kapatılacak (Faz 8).
2. **Marka şablonu + AI arka plan.** Yazı, logo ve düzen deterministik şablondan çizilir.
   **AI'ın metin çizmesine asla izin verilmez**, sadece arka plan üretir.
3. **Referanslardan stil çıkarımı.** Bir kez analiz, sürekli kullanım.
4. **Ay/hafta takvimi**, sürükle bırak, PNG/CSV dışa aktarma. **Otomatik yayınlama YOK.**
5. **Dört çıktı türü:** kare 1080x1080, story 1080x1920, carousel 3-5 kart, yatay 1200x628.
6. **Dört metin:** görsel üzeri başlık, caption, hashtag, en iyi paylaşım saati.
7. **Kısa form + hazır sektör listesi.** Web sitesi kazıma YOK.

Çalışma kuralları (global CLAUDE.md'den, bağlayıcı):
- Kullanıcıyla **Türkçe** konuş. Türkçe metinde **em-dash yok**, kısa cümle, sade dil.
- Kod, değişken adları, kod içi yorumlar **İngilizce** (mevcut repo konvansiyonu).
- Çok dosyaya yayılan iş için **alt-ajan kullan**, tek başına ilerleme.
- Her uzun süren iş **kendi terminalinde**, açıklayıcı Türkçe isimle
  (`printf '\033]0;İsim\007'`).
- Onaylı maddede sormadan devam et (otonom ilerleme).

Para / güvenlik kapıları:
- Lokal geliştirme **fake AI modunda**: `AI_DEFAULT_PROVIDER=fake`, `RENDERER_PROVIDER=fake`.
  Sıfır maliyet. Gerçek sağlayıcıya geçmek kullanıcının kararı.
- Grafista'nın **prod ortamı CANLI ve gerçek maliyetli** (Render + Turyap müşterisi).
  Bu dalda yapılan hiçbir şey prod'a gitmedi, deploy YOK.

---

## DURUM (2026-08-07 — bayatlar, ucuzsa teyit et)

### Doğrulandı (ölçüldü ya da gözle görüldü)

- **Faz 0 KAPANDI.** `packages/model-router/src/providers/claude.ts` model kimliği
  `claude-opus-5` + `ANTHROPIC_MODEL` env override.
- **Faz 1 KAPANDI, canlıda çalıştı.** 12 sektör kataloğu. `GET /api/sectors` gerçek veri
  döndürdü, 12 sektör, Türkçe karakterler sağlam (curl ile görüldü).
- **Faz 2 KAPANDI.** 7 şablon + kalıcı Chromium render + piksel denetimi.
  `pnpm --filter @grafista/api run preview:templates` → `apps/api/.preview/` altına
  **21 PNG**. Beşine gözle bakıldı, kalite iyi, Türkçe kusursuz
  (`IŞIĞIN İZİNDE: İSTANBUL'DA İYİ ŞUBAT` — noktalı İ ve noktasız I doğru).
- **Test tabanı: 43 dosya / 860 test geçiyor.** Typecheck 5 pakette temiz.
- Sektör nöbetçileri **mutasyonla sınandı**: ağırlık bozma, sahte şablon id'si, Türkçe katlama
  (İ ve ı), kelime sınırı eşleştirmesi — hepsi yakalanıyor.
- Fontlar gerçekten yükleniyor: Chromium'da genişlik ölçüldü (Montserrat 809px, yedek 722px).

### DOĞRULANMADI (borç — "bitti" sayma)

- **18 önizlemede `low_contrast` uyarısı duruyor.** Bunlar yanlış alarm: rozet gibi dolu zeminli
  bölgeler kendi metin renkleriyle değil tasarımın ana metin rengiyle ölçülüyor.
  `TextRect.textColor` alanı eklendi ama şablonların çoğu doldurmuyor. **Faz 5'te kapanacak**,
  çünkü yeniden-render kararını orası verecek.
- **Carousel gerçek AI arka planıyla hiç denenmedi.** Sadece sentetik SVG fotoğrafla render
  edildi. Plan onu Faz 5.5'e koymuştu, sektörler zaten referans verdiği için öne alındı.
- Faz 2 için ayrı bir **Chromium render testi yok**. Kırpma ve font nöbetçileri
  `preview-templates.ts` içinde koşuyor, vitest süitinde değil. Süitteki şablon testleri
  HTML üretimi seviyesinde.
- Dashboard tarafında **hiçbir şey yapılmadı** (Faz 7).

### Pointer'lar (yeniden arama)

| Ne | Nerede |
|---|---|
| Sektör şeması | `packages/schemas/src/sector.ts` |
| 12 sektör tanımı | `apps/api/src/sectors/definitions/*.ts` |
| Sektör kaydı + Türkçe katlama | `apps/api/src/sectors/catalog.ts` |
| Şablonlar (7) | `apps/api/src/templates/` |
| Şablon sözleşmesi | `apps/api/src/templates/types.ts` |
| Kalıcı Chromium + piksel örnekleme | `apps/api/src/templates/render.ts` |
| Piksel denetimi | `apps/api/src/qa/pixel-check.ts` |
| Önizleme CLI | `apps/api/src/scripts/preview-templates.ts` |
| Fontlar (18 woff2 + manifest) | `apps/api/assets/fonts/` |
| Yeni router | `apps/api/src/routes/studio.ts` (şu an tek uç: `GET /api/sectors`) |
| Testler | `apps/api/src/__tests__/sectors.test.ts`, `templates.test.ts` |

Lokal ortam (kurulu, çalışıyor):
- Postgres: `docker start grafista-postgres` — `pgvector/pgvector:pg16`, host portu **55432**,
  migration + demo seed uygulanmış.
- `apps/api/.env` var (gitignore'da). **Repoda `dotenv` YOK**, başlatmadan önce
  `set -a; source apps/api/.env; set +a` şart.
- Demo hesap: `demo@grafista.local` / `Demo1234!`
- Dev sunucuları **kapatıldı**, sana devrediliyor:
  `pnpm run dev:api` (4000) · `pnpm --filter @grafista/dashboard exec next dev --port 3001`
  (port 3000'de BAŞKA bir projenin next-server'ı var, ona dokunma).

### En düşük güvenli varsayımım (yanılmış olabileceğim yer)

Şablonların **gerçek AI fotoğrafı** altında nasıl davranacağını bilmiyorum. Bütün önizlemeler
tek bir sentetik SVG gradyanla üretildi: düzgün, öngörülebilir, kenar yoğunluğu düşük.
Gerçek `gpt-image-1` çıktısı çok daha gürültülü olacak ve `busy_text_area` eşiği (%18 kenar
yoğunluğu) tamamen tahmin. Faz 5'te ilk gerçek görselle bu eşiği yeniden ayarlaman gerekebilir.

---

## NEREDE YANILMIŞ OLABİLİRİM

- **Planın Faz 0 gerekçesi yanlıştı ve bunu keşif ajanı uydurmuştu.** Plan
  "`claude-opus-4-8` geçersiz model, 404 verir" diyordu. Resmi katalogla doğruladım: o model
  **geçerli ve aktif**. Ortada düzeltilecek hata yoktu. Aynı ajanın başka iddiaları da plana
  girmiş olabilir, şüpheyle yaklaş.
- **Plandan bilinçli saptım:** `render/adapters/playwright-adapter.ts`'e dokunmadım. Plan
  `waitUntil` değişikliği öngörüyordu ama eski akış Google Fonts'u yüklemek için `networkidle`'a
  bağımlı; değiştirmek eski render'ı sessizce bozardı. Yeni akış kendi render'ını getirdi.
- **Alt-ajan raporları iki kez tutmadı.** Biri "alias çakışması yok" dedi, testim çakışma buldu.
  Diğeri "76 kontrol geçti" dedi ama yazdığı üç şablonun hepsinde CSS birim hatası vardı.
  Ajan çıktısını her zaman kendi nöbetçinle sına.
- Sektör tanımlarındaki mevzuat maddeleri (Barolar Birliği reklam yasağı, Sağlık Bakanlığı
  kısıtları) ajanlar tarafından yazıldı, **hukukçu gözünden geçmedi**. İçerik üretimi
  başlayınca kullanıcıya bir kez göstermekte fayda var.

---

## ÇIKMAZLAR & TUZAKLAR (gerekçeli iz, emir değil)

Bunlar zaman kaybettirdi, tekrar düşme:

1. **`calc(N * var(--u))` birimsiz sayı üretir.** `--u` birimsiz tanımlı, dolayısıyla bu ifade
   `<length>` değil `<number>` verir ve tarayıcı bildirimi **sessizce atar**: punto 16px
   varsayılana, dolgu 0'a, `gap` `normal`'a düşer. Konvansiyon: **`calc(N * var(--u) * 1px)`**.
   Değişkeni px'li yapmak da çözüm ama ikisi karışırsa `px²` olur ve yine bozar.
   Nöbetçi: `templates.test.ts` içinde "multiplies every scale-unit expression by a unit".
2. **Google Fonts Türkçeyi iki alt kümeye böler.** `ğ Ğ ş Ş İ` latin-ext'te, `ı ç Ç ö Ö ü Ü`
   latin'de. Tek alt küme indirirsen eksik harfler tofu kutusu olur ve hiçbir tip kontrolü
   görmez. Her yüz için **iki dosya** var, `unicode-range` ile birleşiyorlar. CSS çekerken
   **modern Chrome User-Agent** şart, yoksa Google eski TTF döndürür.
3. **`page.evaluate()` içinde adlandırılmış fonksiyon yazma.** esbuild (tsx üzerinden) onları
   `__name` yardımcısına sarar, o yardımcı tarayıcıda yok, çağrı
   `ReferenceError: __name is not defined` ile patlar. Sadece anonim callback kullan.
4. **`document.fonts.check()` tüm bildirilen yüzler için çalıştırılamaz.** `unicode-range`
   yüzleri gerekene kadar `unloaded` kalır; bir şablon altı aileden ikisini kullanır. Tüm
   yüzleri kontrol etmek 21 önizlemenin hepsinde yanlış alarm verdi. Doğrusu: sayfada
   **gerçekten kullanılan** aileleri, **taşıdıkları metinle** kontrol et.
5. **Otomatik punto hesabında karakter/satır bölmesi yanlış.** Kelimeler bölünmüyor; sığmayan
   kelime satırı erken bitirir ve bir satır daha gerekir. Gerçek greedy sarma simülasyonu şart
   (`estimateLineCount` / `estimateWrappedHeight` helpers'ta).
6. **Kutuyu sabit oranla bölme (%60 başlık / %40 alt metin).** Oran, alt metnin bu ay üç satır
   sardığını öğrenmez. İki şablonda metni kırptı. Doğrusu: alt metnin **gerçek** yüksekliğini
   hesapla, kalanı başlığa ver.
7. **Flexbox metin öğesini içeriğinin altına sıkıştırır.** `overflow:hidden` ile birleşince
   sessizce kırpar. Metin öğelerine `flex:0 0 auto` gerekiyor.
8. **`pnpm typecheck` şema değişince patlar** çünkü `packages/schemas/dist` bayat kalır.
   Şemaya dokununca `pnpm --filter @grafista/schemas run build` koş.
9. **zsh globbing:** `rm -f dir/*.woff2` eşleşme yoksa `no matches found` verip `&&` zincirini
   kırar. `find ... -delete` kullan.

---

## DOKUNMA / sağlam parçalar

- **Eski akışın hiçbir dosyası değişmedi.** `layout_plans`, `creative_qa_reports`,
  `production_jobs`, `render_jobs`, workflow motoru, `visual-outputs-panel.tsx` — hepsi yerinde.
  Faz 8'e kadar öyle kalsın; 44 test dosyası bunlara bağlı.
- `render/adapters/playwright-adapter.ts` ve `render/html-renderer.ts`: eski akışın kalbi,
  yeni akış bunları **hiç çağırmıyor**. Değiştirme.
- `app.ts` router mount sırası: `studioRouter` en sona eklendi ki mevcut rotaları gölgelemesin.

---

## YAKLAŞIMIM (başlangıç, kısıt değil)

Faz 3 için şu an nasıl ilerlerdim:

1. **Migration'ları önce boş bir Postgres'te dene.** `global-setup.ts` her test koşusunda tüm
   migration'ları uyguluyor; tek SQL hatası 43 test dosyasının hepsini birden düşürür. Bu, tüm
   plandaki en yüksek regresyon riski.
2. Tabloları plan dosyasındaki gibi kur: `content_plans`, `content_items`, `content_designs`,
   `studio_jobs`, `studio:read`/`studio:write` izinleri, `clients` tablosuna `sector_key` +
   `style_profile` + `studio_setup` sütunları. Hiçbir sütun düşürme.
3. `studio/worker.ts` için `services/render-worker.ts` desenini oku ama **kodunu kopyalama** —
   o worker `render_jobs` zincirine bağlı. Alınacak olan desen: `FOR UPDATE SKIP LOCKED` ile
   iş kapma, takılı kilit süpürme, `setInterval` + `unref`, tek-tick test kancası.
4. Migration'ları yazarken 021/022'ye bak, kuyruk alanlarının mevcut konvansiyonu orada.

Daha iyi bir yol görürsen onu izle. Bunlar benim başlangıç noktam.

---

## SIRADAKİ ADIMLAR (öncelik sırası — yeniden önceliklendirebilirsin)

1. **Faz 3:** migration 029-032 + 4 repository + `studio/worker.ts`. Doğrulama: iki worker aynı
   işi alamıyor, takılı kilit geri dönüyor, `pnpm run test:stable` hâlâ yeşil.
2. **Faz 4:** aylık plan prompt'u + `plan-generation.ts` + `schedule.ts` + fake sağlayıcıya
   `monthly_plan` canned payload. Doğrulama: fake modda 12 `content_items`, tarihler sektörün
   ritmine uygun.
3. **Faz 5:** arka plan üretimi + `design-generation.ts` + şablon seçimi.
   **Burada `TextRect.textColor` borcunu kapat** ve `busy_text_area` eşiğini gerçek AI
   görseliyle yeniden ayarla.
4. **Faz 6:** 14 uç + stil profili + CSV/ZIP dışa aktarma.
5. **Faz 7:** dashboard 3 sayfa. Sonunda tık sayısını say ve raporla (hedef: kurulum sonrası 2).
6. **Faz 8:** eskiyi `(legacy)` grubuna taşı + bayrak.

---

## AÇIK KARARLAR (yalnız kullanıcı verebilir)

- Sektör tanımlarındaki mevzuat maddeleri (diş/sağlık/hukuk reklam kısıtları) bir kez gözden
  geçirilmeli mi? İçerik üretimi başlamadan önce göstermek mantıklı.
- Gerçek AI sağlayıcısına ne zaman geçilecek? Faz 5'in sonunda gerçek bir görselle bir kez
  denemek gerekiyor ve bu ücretli.
