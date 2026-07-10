# Grafista AI Studio — Demo Prova Çeklisti

Bu tek sayfalık çeklist, canlı sözlü demodan hemen önce (son ~5 dakika) bakmak
içindir. Amaç: konuşmaya başlamadan önce her şeyin hazır olduğundan emin olmak.

Bu çeklist iki kardeş dokümanı **tekrar etmez**, sadece prova anında lazım olanı
toplar:
- Kelime kelime anlatım → [`demo-sales-script.md`](./demo-sales-script.md)
- Teknik ön uçuş + Render env → [`demo-day-checklist.md`](./demo-day-checklist.md)
- 12 adımlı tıkla-geç runbook → [`mvp-demo-flow.md`](./mvp-demo-flow.md)

---

## 1. Demoya girmeden (2 dakika)

- [ ] Tarayıcıyı **incognito** aç (temiz oturum, cache sorunu olmaz).
- [ ] Giriş sayfasını aç: `https://grafista-dashboard-staging.onrender.com/login`
      (staging dashboard; incognito sekmede).
- [ ] Giriş yap, **Müşteriler** ana sayfasının açıldığını gör.
- [ ] Bildirimleri kapat, fazla sekmeleri kapat, ekran paylaşımını hazırla.
- [ ] 30 saniyelik açılışı bir kez sessizce prova et.

## 2. Giriş bilgisi (demo hesabı) — TEK KAYNAK

- **Hesap:** `demo-verify@grafista.local`
- **Şifre:** `DemoVerify2026!`  *(yalnızca staging demo hesabıdır; production
  veya gerçek müşteri hesabı değildir)*
- **Giriş çalışmıyorsa** hesap o ortamda yok demektir. Aynı hesabı üretmek için:
  ```bash
  ADMIN_EMAIL=demo-verify@grafista.local ADMIN_PASSWORD='DemoVerify2026!' \
    pnpm --filter @grafista/api run db:seed-demo-all
  ```
  Bu komut seed hesabı ile giriş bilgisini **eşitler** (güvenli, tekrar
  çalıştırılabilir, veri silmez).

> Not: Diğer dokümanlarda geçen `demo-owner@grafista.local` (demo-day-checklist
> seed varsayılanı) ve `demo@grafista.local` (mvp-demo-flow / manual-demo-pass
> yerel runbook örneği) **farklı** örnek hesaplardır. Demoda karışıklık olmasın
> diye **yukarıdaki tek hesabı** kullan; giriş bilgisi ile seed hesabını yukarıdaki
> komutla aynı tut.

## 3. İlk açılacak müşteri

- [ ] Galeri finali için **Turyap Sistem Demo** müşterisini aç.
- **Neden:** bu müşterinin gerçek bir render çıktısı vardır, **⬇ İndir** butonu
  çalışır. Demonun finalini buradan göster.
- Turyap Sistem Demo, staging'de önceden hazırlanmış demo müşterisidir (gerçek
  render'ları vardır). Taze/yeniden kurulmuş bir ortamda yoksa: `pnpm --filter
  @grafista/api run db:seed-demo-all` çalıştır; bu, başlığı "Demo Brief:" ile
  başlayan seed kartlı bir müşteri ekler, o müşteriyi aç.

## 4. İlk 30 saniyede ne söylenir

Tek cümle (giriş ekranında da yazar):
> "Marka DNA'sından yayına hazır görsele, tek akışta."

Açılış (Müşteriler ana sayfası, üstte 🎬 **MVP Demo Akışı** şeridi açık):
> "Grafista bir ajansın tüm kreatif üretimini tek akışta toplar. Şu üstteki şerit
> işin tamamını gösteriyor: Müşteri, brief, tasarım, render, galeri, indirme."

Tam kelime kelime metin: [`demo-sales-script.md`](./demo-sales-script.md) §2.

## 5. Hangi butonlara basılır (6 adımlık akış)

| # | Adım | Ne yap |
|---|---|---|
| 1 | **Müşteri** | Müşteriler ana sayfasında bir müşteriye tıkla (Turyap Sistem Demo). |
| 2 | **Brief** | Müşteri hub'ında 🎬 MVP Demo Akışı rehberini göster → **İçerik Üretici**'ye gir → onaylı fikirden "Tasarım Brifi Oluştur". |
| 3 | **İçerik / Tasarım** | Brief'ten layout planı + **Kalite Kontrolü** + yapay zeka görseli. |
| 4 | **Render** | Layout Planları çıktı kartında **Post (1080×1080)** ve **Story (1080×1920)** render (ücretsiz). |
| 5 | **Galeri** | Galeriye git — temiz final için hub'daki "Son Çıktılar → **Tümü →**" (filtreli, sadece bu müşterinin çıktıları); alternatif: ana sayfadaki "📦 **Çıktı Galerisini Aç**". |
| 6 | **İndir** | Bir render kartında **⬇ İndir**'e bas, dosyanın indiğini göster. Demo biter. |

> "Çıktı Galerisi" butonu ile "Çıktı Geçmişi" sayfası **aynı ekrandır** (sayfa
> başlığında ikisi de yazar). Aynı ekranın müşteri hub'ındaki özeti ise
> "Son Çıktılar" şerididir. Genel (filtresiz) galeride örnek/seed kartlar (ör.
> boş beyaz önizleme) da görünebilir; en temiz final için Turyap'ın filtreli
> "Tümü →" görünümünü kullan.

## 6. Başarı neye benziyor

- [ ] Giriş başarılı, **Müşteriler** ana sayfası açıldı.
- [ ] **MVP Demo Akışı** şeridi 6 adımı sırayla gösteriyor.
- [ ] Turyap Sistem Demo hub'ında rehber + **Son Çıktılar** görünüyor.
- [ ] **Çıktı Geçmişi** sayfasında en az bir "**Render Hazır**" kartı var.
- [ ] **⬇ İndir** çalışıyor, dosya iniyor.

## 7. Demo sırasında DOKUNMA

- ❌ Kuyruk/worker açma. `RENDER_QUEUE_ENABLED=false` kalır.
- ❌ Production ortamına girme. Sadece **staging**.
- ❌ Restore-drill, migration, DB silme gibi işlem yapma.
- ❌ Ayarlar / silme butonlarına deneme amaçlı basma.
- ⚠️ Canlı AI görsel üretimini **sadece** önceden bir kez denediysen ve
  zaman/bütçe uygunsa yap (ücretli, 1-2 dk sürer). Güvenli demo = anlatımlı tur +
  hazır çıktı.

## 8. Gösterme (bilinen sınırlar, kaçın)

- Yüklenen bir fotoğrafı **doğrudan** gönderiye basma özelliği henüz yoktur; ana
  görsel yapay zeka ile üretilir. (Dürüst not olarak söylenebilir, sorun değil.)
- Galeride başlığı "**Demo Brief:**" ile başlayan kart **seed örneğidir**, canlı
  üretim değildir.
- Bazı etiketler TR/EN karışıktır (kozmetik, akışı etkilemez).
- Çıktı adedi gibi sayılar demo ortamına göre değişir; ezbere sayı verme.

---

Daha fazla ayrıntı: [`demo-sales-script.md`](./demo-sales-script.md) (kelime
kelime), [`demo-day-checklist.md`](./demo-day-checklist.md) (teknik ön uçuş +
Render env), [`mvp-demo-flow.md`](./mvp-demo-flow.md) (12 adımlı runbook).
