# Grafista AI Studio — Satış Demo Script'i

Bu doküman, Grafista AI Studio'yu bir müşteriye canlı gösterirken kullanılacak
hazır anlatım rehberidir. Amaç: kişinin 30 saniyede ne yaptığını, 3-4 dakikada
ise tüm akışı anlaması. Her cümle ekranda gerçekten görünen şeye dayanır, abartı
veya yanlış vaat yoktur.

- **Ne:** Ajansların marka bilinçli kreatif üretimini tek akışta toplayan yapay zeka stüdyosu.
- **Kime:** Reklam/sosyal medya ajansları, marka ekipleri, freelance tasarımcılar.
- **Süre:** 30 sn asansör konuşması + 3-4 dk tam tur.
- **Tek cümle:** "Marka DNA'sından yayına hazır görsele, tek akışta." (Aynı satır giriş ekranında da görünür.)

---

## 1. Demo öncesi hazırlık (2 dakika)

1. Tarayıcıyı **incognito** aç (temiz oturum, cache sorunu olmaz).
2. `grafista-dashboard-staging` adresine gir, giriş yap
   (`demo-verify@grafista.local` / `DemoVerify2026!` ya da kendi hesabın).
3. **Müşteriler** ana sayfasında dur, buradan başla.
4. Galeri anı için hazır müşteri: **"Turyap Sistem Demo"** — bu müşterinin gerçek
   bir render çıktısı var, İndir butonu çalışıyor. Demonun finalini buradan göster.
5. (Opsiyonel, taze bir ortamdaysan) Çıktı Galerisi boşsa, staging Shell'de
   `pnpm --filter @grafista/api run db:seed-demo-all` çalıştır — galeriye bir
   demo kartı ("Demo Brief") gelir. Bu komut güvenlidir, tekrar çalıştırılabilir,
   veriyi silmez.
6. Sekmeleri sadeleştir, bildirimleri kapat.

**Demo modunu seç:**
- **A) Anlatımlı tur (ÖNERİLEN):** Akışı rehber üzerinden anlat, finalde hazır
  çıktıyı göster. Ücretsiz, hızlı, hatasız. Aşağıdaki script bunun içindir.
- **B) Canlı üretim:** İstersen bir görseli canlı ürettir. Yapay zeka görsel
  adımı ücretlidir ve 1-2 dakika sürer, o yüzden sadece zaman ve bütçe uygunsa
  ve önceden bir kez denenmişse yap.

---

## 2. 30 saniyelik asansör script'i (kelime kelime)

> Ekranda **Müşteriler** ana sayfası açık, üstte **MVP Demo Akışı** kartı görünür.

**[0-6 sn]** "Grafista, bir ajansın tüm kreatif üretimini tek bir akışta toplar.
Şu üstteki şerit, işin tamamını gösteriyor: Müşteri, brief, tasarım, render, galeri, indirme."

**[6-14 sn]** *(Bir müşteriye tıkla)* "Her müşterinin markası, renkleri ve stil DNA'sı burada.
Buradan bir içerik fikri onaylıyoruz ve saniyeler içinde bir tasarım brifine dönüşüyor."

**[14-22 sn]** "Brifden yapay zeka, marka bilinçli görseli üretiyor. Sonra tek tıkla
Instagram Post ve Story ölçüsünde render alıyoruz. Render ücretsiz."

**[22-30 sn]** *("Çıktı Galerisini Aç" butonuna bas → Çıktı Geçmişi ekranı açılır)* "Ve tüm çıktılar tek galeride, indirilmeye hazır.
İşte bu kadar: fikirden yayına hazır görsele, tek akışta."

*(~78 kelime, rahat tempoda 30 saniye.)*

---

## 3. Ekran ekran tam demo (3-4 dakika)

Her satır: **ne göster** → **ne söyle** → **sonra ne yap**.

### Ekran 1 — Giriş
- **Göster:** Login ekranı.
- **Söyle:** "Grafista bir ekip aracı. Rollere göre erişim var: sahip, kreatif direktör, tasarımcı, içerik yöneticisi."
- **Yap:** Giriş yap, Müşteriler ana sayfası açılır.

### Ekran 2 — Müşteriler (ana sayfa) + MVP Demo Akışı şeridi
- **Göster:** Üstteki **🎬 MVP Demo Akışı** şeridi ve müşteri kartları.
- **Söyle:** "Ajansın tüm müşterileri burada. Üstteki şerit, birazdan göstereceğim
  akışın haritası: Müşteri → Brief → İçerik/Tasarım → Render → Galeri → İndir."
- **Yap:** Bir müşteriye tıkla (tercihen **Turyap Sistem Demo**).

### Ekran 3 — Müşteri detayı (hub) + Demo Akışı rehberi
- **Göster:** En üstteki **🎬 MVP Demo Akışı (Rehber)** kartı, altında hızlı erişim
  kartları (Marka Varlıkları, Referans Kütüphanesi, Tasarım DNA, İçerik Üretici).
- **Söyle:** "Her müşterinin markası burada başlıyor: logo, renk paleti, yükledikleri
  referans görseller ve bunlardan çıkan Tasarım DNA'sı. Bu rehber, adımları sırayla gösteriyor."
- **Yap:** Rehberde ilk birkaç adımı işaret et, sonra **İçerik Üretici**'ye gir.

### Ekran 4 — İçerik Üretici (fikir → brief)
- **Göster:** İçerik fikirleri ve onay durumu.
- **Söyle:** "Platform seçiyoruz, yapay zeka içerik fikri öneriyor, onaylıyoruz.
  Onaylı fikrin altından tek tıkla 'Tasarım Brifi' oluşuyor. Brief; başlık, hedef,
  ölçü ve marka kurallarını taşıyan yapılandırılmış bir çıktı."
- **Yap:** Bir brief'i aç (ya da rehberdeki 7. adıma geç).

### Ekran 5 — Layout Planları + Kalite Kontrolü
- **Göster:** Layout planı ve Kalite Kontrolü (Creative QA) sonucu.
- **Söyle:** "Brief'den layout planı üretiliyor ve bir kalite kontrolünden geçiyor:
  marka kurallarına uyuyor mu, güvenli alanlar doğru mu. Onaydan sonra görsele geçiyoruz."
- **Yap:** Çıktı kartındaki görsel üretim adımını göster.

### Ekran 6 — Görsel üret (yapay zeka) + üretime gönder
- **Göster:** Görsel üretim ve "Üretime Gönder" aksiyonu.
- **Söyle:** "Yapay zeka, markanın DNA'sına uygun ana görseli üretir. Bu adım ücretli,
  çünkü gerçek bir yapay zeka görsel üretimi. Onaylayıp paketi üretime gönderiyoruz."
- **Yap:** Render adımına geç.

### Ekran 7 — Render / Export
- **Göster:** Instagram Post (1080×1080) ve Story (1080×1920) render seçenekleri.
- **Söyle:** "Tek tıkla, gönderiye hazır ölçülerde render alıyoruz. Render adımı ücretsiz.
  Çıktı PNG veya JPG."
- **Yap:** **Çıktı Galerisi**'ni aç (rehberdeki 9. adım ya da soldaki 📦 Çıktı Geçmişi).

### Ekran 8 — Çıktı Geçmişi / galeri (`/outputs`) — FİNAL
> Sayfa başlığı ekranda **"📦 Çıktı Geçmişi"** yazar; buraya götüren buton/link ise "Çıktı Galerisi" adını taşır. İkisi aynı ekran.
- **Göster:** Render kartı: thumbnail, **Render Hazır** rozeti, PNG · boyut, **👁 Önizle/Aç** ve **⬇ İndir**.
- **Söyle:** "Ve işte sonuç: tüm müşterilerin render edilmiş çıktıları tek galeride.
  Önizleyebiliyoruz, indirebiliyoruz. Bu ekran salt-görüntüleme; onay/red işlemleri brief tarafında."
- **Yap:** **İndir**'e bas, dosyanın indiğini göster. Demo biter.

### Kapanış
- **Söyle:** "Özet: müşterinin markasından, tek akışta, yayına hazır görsele.
  Fikir, brief, tasarım, render, galeri, indirme — hepsi bir arada, ajansın kendi verisiyle."
- **CTA:** "İsterseniz kendi markanızla bir müşteri açıp aynı akışı birlikte deneyelim."

---

## 4. Akış haritası: Müşteri → Brief → İçerik/Tasarım → Render → Galeri → İndir

| Aşama | Ekran | Ne yapılır |
|---|---|---|
| **Müşteri** | Müşteri hub (`/clients/[id]`) | Marka varlıkları, referanslar, Tasarım DNA |
| **Brief** | İçerik Üretici (`/clients/[id]/content`) | Fikir onayla → "Tasarım Brifi Oluştur" |
| **İçerik/Tasarım** | Brief → Layout Planları | Layout + Kalite Kontrolü + yapay zeka görseli |
| **Render** | Layout Planları çıktı kartı | Post & Story render (ücretsiz) |
| **Galeri** | Çıktı Geçmişi (`/outputs`) | Tüm render çıktıları tek yerde |
| **İndir** | Galeri kartı | PNG/JPG indir |

Aynı akış her müşterinin hub sayfasındaki **🎬 MVP Demo Akışı (Rehber)** kartında
adım adım, tıklanabilir olarak da duruyor. Rehber demonun kılavuzu olarak kullanılabilir.

---

## 5. Onboarding / konuşma noktaları

**Üç değer önermesi:**
1. **Marka bilinci:** Her çıktı, müşterinin yüklediği varlıklardan çıkan Tasarım DNA'sına dayanır.
2. **Tek akış:** Fikirden indirmeye kadar her adım aynı yerde, kopukluk yok.
3. **Kalite kapısı:** Görsele geçmeden önce otomatik kalite kontrolü var.

**Dürüst notlar (demoda söylenmesi önerilir, güven kurar):**
- Gönderiye basılan ana görsel yapay zeka ile üretilir; yüklenen varlıklar stil, DNA ve logo için kullanılır.
- Yapay zeka görsel üretimi ücretli, render/dışa aktarma ücretsizdir.
- Seed ile eklenen örnek çıktının kart başlığı "Demo Brief:" ile başlar; bu örnek veridir, canlı üretim değildir.
- Yüklenen bir fotoğrafı doğrudan gönderiye basma özelliği bu sürümde henüz yoktur (sonraki adım).

**Sık sorulan sorular:**
- *"Görseller gerçekten marka renklerini kullanıyor mu?"* → Evet, Tasarım DNA adımı yüklenen referanslardan renk/ton/tipografi profili çıkarır ve brief'e taşır.
- *"Kaç platform?"* → Instagram Post/Story/Reel, Facebook, Twitter, LinkedIn, YouTube thumbnail ölçüleri tanımlı.
- *"Ekip çalışması var mı?"* → Evet, rol bazlı erişim ve onay kuyruğu var.
- *"Verilerim güvende mi?"* → Rol bazlı yetkilendirme var (4 rol: sahip, kreatif direktör, tasarımcı, içerik yöneticisi). Müşteri bazlı erişim kısıtlaması (client-members) opsiyonel olarak tanımlanabilir bir özelliktir; MVP'nin varsayılan kurulumunda aynı hesaptaki yetkili kullanıcılar tüm müşterileri görebilir. Yanlış vaat vermemek için bu ayrımı net söyleyin.

---

## 6. Sonraki adım

- Demo sonrası: müşterinin kendi markasıyla bir hesap kurulumu teklif et.
- Prova öncesi son kontrol: `docs/demo-rehearsal-checklist.md` — tek sayfalık,
  "konuşmadan önce bak" çeklisti (giriş, ilk müşteri, 6 adım, dokunma listesi).
- Teknik ekip için: bu repodaki `docs/mvp-demo-flow.md` ve `docs/demo-day-checklist.md`
  daha ayrıntılı kurulum/akış rehberidir.

---

## 7. Kapsam ve dürüstlük sınırları (sunumu yapan için not)

- Bu demo salt gösterim odaklıdır. Arka planda kuyruk/worker açılmaz
  (`RENDER_QUEUE_ENABLED=false`), production ortamına dokunulmaz.
- Galerideki demo kartı seed verisidir; canlı bir müşteri için gerçek çıktı, akışın
  kendisi çalıştırıldığında oluşur.
- Sayıların (ör. çıktı adedi) demo ortamına göre değişebileceğini unutma.
