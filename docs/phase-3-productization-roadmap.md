# Grafista AI Studio — Phase 3 Productization Roadmap

> **Status: IN PROGRESS — Step 1 is DONE (see its status note below); Steps
> 2–7 remain planned.** Phase 2
> closed at commit `a8e5949` with a 12/12 real-provider dashboard demo pass;
> see [`docs/phase-2-final-state.md`](./phase-2-final-state.md) for the
> closure record. This document numbers Phase 3 work as **Phase 3 Step 1–7**
> (mirroring the Phase 2 "Adım 5A/5B" discipline: one step = one reviewable,
> committable unit). Steps are ordered by the recommendation in §Prioritization,
> not necessarily executed strictly 1→7.
>
> Context docs:
> - [`docs/roadmap.md`](./roadmap.md) — overall phase plan + production strategy
> - [`docs/release-readiness.md`](./release-readiness.md) — env/service checklist, debt register
> - [`docs/manual-demo-pass.md`](./manual-demo-pass.md) — F1–F10 friction list + N1 (the raw material for Steps 1–3)
> - [`docs/mvp-demo-flow.md`](./mvp-demo-flow.md) — demo runbook
> - [`docs/photoshop-automation-plan.md`](./photoshop-automation-plan.md) — PARKED optional layer (Step 7 input)

---

## Phase 3 Step 1 — Render Composition Polish (size: M)

> **Status: DONE.** `render-engine.ts` artık `manifest.selectedVisual.storage`
> koordinatlarını storage abstraction üzerinden okuyup görseli base64 data
> URI olarak layout'un primary image slot'una kompoze ediyor (yeni modül:
> `apps/api/src/render/visual-composition.ts` — deterministik slot seçimi +
> `selected_visual_loaded` / `selected_visual_missing` /
> `selected_visual_storage_missing` / `selected_visual_aspect_mismatch` /
> `image_slot_missing` / `image_slot_unmapped` structured warning'leri).
> Kaynak yoksa/okunamıyorsa mevcut placeholder+warning davranışı aynen
> korunur, compositing hiçbir durumda render'ı fail etmez. Kalan kısıtlar:
> tek primary slot doldurulur (fazla slot'lar `image_slot_unmapped` ile
> placeholder kalır), focal-point kırpma yok (`object-fit` ile öngörülebilir
> kırpma var), Photoshop/PSD rendering bu adımın kapsamı dışında (Step 7).

**Amaç:** Üretilen gerçek görselin nihai render'da gerçekten görünmesini
sağlamak — bugün render, layout'un image slot'larında gri placeholder basıyor
("Görsel kaynağı eksik"), oysa bir kart üstünde gerçek KIE görseli duruyor.

**Kapsam:**
- Source visual → image slot mapping: onaylı/generated visual output'u
  production package'daki image layer'lara bağla (manifest v2 kontratı
  üzerinden, format değişikliği olmadan).
- Placeholder yerine gerçek generated image'ın HTML/CSS render'ına gömülmesi
  (html-renderer'da layer→HTML üretimi).
- `object-fit`/crop/focal-point davranışı: slot oranı ile görsel oranı
  uyuşmadığında öngörülebilir kırpma.
- Dashboard preview doğrulaması: render sonucu gerçek görseli içeriyor mu,
  gözle + otomatik kontrol.
- Regression testler: fake provider'ın 64×64 PNG'leriyle deterministik
  compositing testi; "kaynak görsel yoksa" mevcut placeholder+warning
  davranışı korunur.

**Çözdüğü borç:** F8 (Phase 2'nin en görünür eksiği). F9'un görünürlüğünü de
dolaylı azaltır (placeholder comp'un tipografi sorunları gerçek kompozisyonda
yeniden değerlendirilir).

---

## Phase 3 Step 2 — Dashboard UX Polish (size: S–M)

**Amaç:** Demo ve günlük kullanımdaki sürtünmeyi azaltmak — ürünün değer
önerisini değiştirmeden, Step 13/13R'da kayda geçen F-listesi'ni kapatmak.

**Kapsam:**
- Disabled button reason clarity: gate'li butonlarda `title` yerine görünür,
  Türkçe açıklama (F1 dahil: QA "Geçti" + "Üretime hazır değil" çelişkisinin
  tooltip/metin ile netleştirilmesi).
- Türkçe status label'lar: `approved`/`draft`/`pending approval` rozetlerinin
  ve platform/type chip'lerinin Türkçeleştirilmesi (F2), draft dead-end'e
  aksiyon eklenmesi (F3), onaylı DNA'da onay butonunun pasifleştirilmesi (F4).
- Daha net gate/hata mesajları: provider hatalarına kısa Türkçe özet + raw
  metin collapse (F6), `model: none` gösteriminin düzeltilmesi (F5).
- Render warning okunabilirliği: wrap/expand, kesilen mesajların tamamının
  görünmesi (F7).
- Artifact/download görünürlüğü: indirme linklerinin ve render çıktılarının
  keşfedilebilirliği; placeholder render için UI notu (F8'in UI tarafı —
  Step 1 gelene kadar geçici not, sonrasında kaldırılır).
- Adım-adım demo rehberliği: "Sıradaki adım" ipuçlarının zincir boyunca
  tamamlanması; dev/test client temizliği veya filtresi (F10).

**Çözdüğü borç:** F1–F7, F9(kısmen), F10 — özellikle F6/F7/F9/F10.

---

## Phase 3 Step 3 — Provider Robustness + Retry (size: S–M)

**Amaç:** Gerçek provider'larla çalışırken nadir ama görünür hataları
(N1 gibi) kullanıcıya yansımadan emmek ve hata mesajlarını ürün diline
çevirmek.

**Kapsam:**
- Retry policy: LLM yanıtı schema validation'dan geçemediğinde 502 dönmeden
  önce tek otomatik in-service retry (N1'in önerilen çözümü).
- Provider error classification: auth / rate-limit / validation / transient
  ayrımı; hangisinin retry'a değer olduğu.
- Kullanıcı-dostu hata mesajları: sınıflandırılmış hataların Türkçe özetleri
  (Step 2'nin F6 işiyle aynı sözlüğü paylaşır).
- Smoke script sertleştirme: `smoke:providers`'a retry/classification
  farkındalığı; flake ile gerçek arızanın çıktıda ayrışması.
- Regression testler: mock'lu schema-fail→retry→success ve retry→fail
  senaryoları.

**Çözdüğü borç:** N1; F6'nın hata-metni tarafına altyapı sağlar.

---

## Phase 3 Step 4 — Client Isolation Hardening (size: L)

**Amaç:** Global permission modelinden (tek-takım varsayımı) client-scoped
erişime geçiş — SaaS'laşmanın ön koşulu.

**Kapsam:**
- Client/project ownership kontrolleri: her kaynak (brief, layout, output,
  job, artifact) ait olduğu client üzerinden yetkilendirilir.
- Route + servis seviyesi tenant guard: Phase 2'deki çift-katman guard
  desenine (route + domain) client-scope katmanı eklenir.
- Artifact erişim izolasyonu: file route'lar yalnız ilgili client'a yetkili
  kullanıcıya servis eder.
- Regression testler: cross-client erişim denemelerinin 403/404 döndüğünü
  kanıtlayan suite.
- Gerekirse migration planı: kullanıcı-client ilişki tablosu / scope
  kolonları (migration'lar bu adımın implementation'ında, bu belge sadece
  plan).

**Çözdüğü borç:** "Cross-client isolation yok" (Adım 8B'den beri kayıtlı,
[`docs/release-readiness.md`](./release-readiness.md) §9).

---

## Phase 3 Step 5 — Render Queue / Worker Planning (size: M, planning-first)

**Amaç:** Bugün bilinçli olarak senkron olan render/AI çağrılarını production
ölçeğinde async job'lara taşımanın planını yapmak (ilk teslimat plan +
minimal iskelet; büyük altyapı tek adımda yazılmaz).

**Kapsam:**
- Async job queue planı: teknoloji seçimi (Postgres tabanlı kuyruk vs harici
  broker) — MVP'de tek servis kalma eğilimi korunarak.
- Render job retry/cancel semantiği; idempotency.
- Progress status: dashboard'ın job durumunu poll/subscribe etmesi.
- Worker deployment modeli: API ile aynı process'ten ayrık worker'a geçiş
  basamakları.
- MVP→production geçiş stratejisi: hangi eşikte (eşzamanlı render sayısı,
  render süresi) kuyruk zorunlu hale gelir.

**Çözdüğü borç:** "Workflow queue/worker yok" bilinçli kapsam dışısı; render
history N+1 sorgusu da bu adımın redesign'ında birlikte ele alınır.

---

## Phase 3 Step 6 — Analytics + Revision History (size: M)

**Amaç:** Üretim hattının çıktısını ölçülebilir kılmak — ajans sahibinin
"bu ay ne üretildi, ne onaylandı, neye mal oldu" sorusuna panelden cevap.

**Kapsam:**
- Revision history: DNA/brief/layout/output versiyonlarının görünür geçmişi.
- Approval metrikleri: onay/red oranları, QA geçme oranı, ortalama skor.
- Render/export sayıları: preset/format kırılımıyla.
- Provider cost tracking: çağrı sayısı + (mümkünse) token/görsel maliyeti
  provider bazında.
- Client/project performans özeti: client başına üretim/onay panosu.

**Çözdüğü borç:** Doğrudan bir Phase 2 borcu değil; roadmap'in Phase 3
"Analytics, cost tracking, revision history" kalemlerini kapsar.

---

## Phase 3 Step 7 — Optional Photoshop/PSD Handoff Adapter (size: L, OPTIONAL)

**Amaç:** Manifest v2 kontratını tüketen opsiyonel bir PSD/tasarımcı handoff
katmanı — **ana render pipeline'ına (HTML/CSS + Playwright) dokunmadan**,
yalnız ek bir çıktı formatı olarak. Ana motor değildir ve olmayacaktır
(bkz. [`docs/roadmap.md`](./roadmap.md) "Production strategy" ve
[`docs/photoshop-automation-plan.md`](./photoshop-automation-plan.md) — PARKED plan).

**Kapsam:**
- PSD handoff paketi: production package + üretilen görseller + layer
  spesifikasyonunun tasarımcıya teslim formatı.
- Layer mapping planlaması: LayoutPlan layer'ları → PSD layer türleri
  (parked plandaki eşleme tablosunun güncellenmesi).
- Adobe/PSD research spike: UXP vs `ag-psd` benzeri kütüphane ile programatik
  PSD üretimi — spike sonucu go/no-go.
- Manuel tasarımcı handoff: otomasyon go almazsa bile paketin insan
  tasarımcıya anlamlı teslimi.
- Kesin sınır: render/export yolunda hiçbir regresyon; adapter tamamen
  opt-in, `PHOTOSHOP_WORKER_ENABLED=false` varsayılanı korunur.

**Çözdüğü borç:** Yok — bilinçli kapsam dışının ileri tarihli, opsiyonel
karşılığı. En düşük öncelik.

---

## Prioritization — what is the FIRST Phase 3 implementation step?

**Soru:** Step 1 (Render Composition Polish) mi, Step 2 (Dashboard UX
Polish) mi önce gelmeli?

**Değerlendirme:**

1. **Değer boşluğu asimetrik.** Step 13R'dan sonra sistem gerçek bir
   2048×2048 KIE görselini üretiyor, saklıyor, önizletiyor — ama nihai
   export'ta o görsel yok; müşteriye inecek PNG gri kutulu bir placeholder.
   Bu "üretilen değer" ile "sunulan değer" arasında ürünün tek gerçek
   boşluğu (F8) ve manual demo kaydında açıkça "the single most visible
   gap" olarak işaretlendi. F6/F7/F9/F10 ise sürtünme: demoyu yavaşlatır ama
   zinciri tamamlamayı engellemez — Step 13R bu friction'larla 12/12 geçti.
2. **Bağımlılık yönü Step 1'i öne itiyor.** UX Polish'in en az iki parçası
   render composition'ın çıktısına bağımlı: (a) render warning
   okunabilirliği (F7) — bugünkü uyarıların 2'si "Görsel kaynağı eksik",
   Step 1 sonrası bu uyarılar ya kaybolur ya anlam değiştirir; önce F7'yi
   cilalamak kısmen çöpe gidecek iş üretir; (b) F8 için düşünülen "placeholder
   uyarı notu" UI parçası, Step 1 biterse hiç yazılmaz. F9 (taşan başlık)
   da placeholder comp'a özgü olabilir — gerçek kompozisyon gelmeden yargı
   vermek erken. Ters yönde bağımlılık yok: Step 1, hiçbir UX Polish
   maddesine muhtaç değil.
3. **Risk/karmaşıklık dengesi bunu değiştirmiyor.** Evet, Step 1 daha derin:
   html-renderer'ın layer→HTML/CSS üretimine ve package→render veri akışına
   dokunur; Step 2 çoğunlukla dashboard/copy seviyesinde sığ iş. Ama derin
   taraf iyi çitlenmiş durumda — manifest v2 kontratı değişmeden kalıyor,
   fake provider'ın deterministik PNG'leriyle compositing regression testi
   yazılabilir, ve "kaynak görsel yoksa placeholder+warning" mevcut davranışı
   fallback olarak korunuyor. Derinlik yönetilebilir; sığ işi öne almak
   sadece asıl işi erteler.
4. **Demo etkisi.** Bir sonraki gerçek müşteri/yatırımcı demosunda tek bir
   şey değişecekse, o şey export edilen PNG'de gerçek görselin görünmesidir.
   Türkçe rozetler cilalı bir demoyu daha cilalı yapar; kompozisyon ise
   demonun sonundaki "ürün bu mu?" anını çözer.

**Net tavsiye: Evet — Phase 3 Step 1 (Render Composition Polish) ilk
implementation adımı olmalı.** Gerekçe: (X) F8 ürün değeri boşluğu, friction
değil; (Y) UX Polish'in bir kısmı (F7/F8-notu/F9) Step 1'in çıktısına bağımlı
ve önce yapılırsa kısmen yeniden yapılır; (Z) Step 1'in riski kontrat
değişikliği gerektirmediği ve deterministik test edilebildiği için sınırlı.
Step 2 hemen ardından gelir; Step 2 içinden yalnız Step 1'e bağımsız ve çok
ucuz iki mikro-parça (F2 Türkçe rozetler, F5 `model: none`) Step 1 PR'larının
arasında "quick win" olarak alınabilir, ama ayrı bir ön-adım olarak değil.

**Önerilen yürütme sırası:** Step 1 → Step 2 → Step 3 → Step 4 → Step 5
(planning) → Step 6 → Step 7 (opsiyonel, yalnız talep doğarsa).
