# Grafista AI Studio — Render Queue / Worker Architecture Plan (Phase 3 Step 5)

Status: **PLANNING ONLY — no code, no migration, no dependency added in this step.**
This document is the deliverable for Phase 3 Step 5. It defines the target
architecture, the model gaps, the lifecycle, and a ready-to-hand-off
implementation prompt for Step 5A. Nothing in `apps/api`, `apps/dashboard`,
or `database/migrations` changes as part of this step.

---

## 1. Mevcut durum özeti

Bugün üç ağır işlem tamamen **senkron**, tek HTTP request/response döngüsü
içinde çalışıyor — hiçbir queue/worker/broker/cron yok (repo genelinde
Redis, BullMQ, `worker_threads`, `child_process`, `node-cron` — HİÇBİRİ yok):

- **`renderProductionJob()`** (`apps/api/src/services/render-engine.ts:158-299`)
  — `pending → rendering → rendered/failed`. Ağır adımlar: gerçek Playwright
  render çağrısı (247-253) ve storage `putObject` (259-260). `render_jobs`
  tablosunda `'cancelled'` durumu şema/CHECK'te var ama hiçbir kod yolu onu
  set etmiyor — bugün aspirational, kullanılmıyor.
- **`runVisualGeneration()`** (`apps/api/src/services/visual-generation.ts:121-311`)
  — AI görsel üretim çağrısı (kendi provider-retry'ı dahil) + görsel başına
  indirme (30s timeout'lu `fetch`) + storage yazma; N görsel varsa N kat I/O
  tek istek içinde.
- **`buildProductionPackage()`** (`apps/api/src/services/production-package-builder.ts:401-589`)
  — en hafif üçü: `pending → packaging → package_ready/failed`, tek storage
  `putObject`, AI/render bağımlılığı yok.

Dashboard tarafında **hiçbir polling yok**: `visual-outputs-panel.tsx:432-434`
açıkça "backend senkron döner, tek POST + tek artifacts fetch yeterli, polling
gerekmiyor" diyor — çünkü bugün gerçekten öyle.

Workflow engine (`apps/api/src/workflows/engine.ts`) da senkron
request/response, ama state-machine ŞEKLİ (`pending → running →
completed/failed/skipped`, + `waiting_for_approval` duraklatma durumu) ve
"hata mesajını persist et, asla yut" sözleşmesi render/production job'larıyla
neredeyse birebir aynı — bu, kuyruk state machine'i için en yakın mevcut
emsal (refactor önerilmiyor, sadece şekil referansı).

Test konvansiyonu güçlü bir temel sunuyor: `RENDERER_PROVIDER=fake` ile
deterministik sahte renderer adaptörü (gerçek Playwright hiç açılmıyor) ve
`vi.mock('@grafista/model-router', ...)` ile sahte AI router — ikisi de
gelecek bir "fake worker" testi için doğrudan örnek alınabilir.

---

## 2. Async job adayları

| İşlem | Bugünkü süre riski | Async'e taşınma önceliği |
|---|---|---|
| Render/export (`renderProductionJob`) | Yüksek — gerçek Playwright render + storage yazma, ölçekte saniyeler | **1 — ilk aday** |
| Visual generation (`runVisualGeneration`) | Yüksek — AI görsel üretimi + N görsel indirme/yazma | 2 — ikinci aday, ama provider tarafı zaten kendi retry'ını yönetiyor |
| Production package build | Düşük — sadece JSON + tek storage yazma, AI/render yok | 4 — en son, belki hiç gerekmez |
| Provider smoke script | Yok — zaten offline/manuel bir CLI script, HTTP request döngüsünde değil | Kapsam dışı — zaten async bir "job" değil |
| Artifact generation (export_artifacts satırı) | Render job'ın bir alt-adımı, ayrı bir job değil | Render job ile birlikte taşınır, ayrı ele alınmaz |

**Sonuç:** Render/export gerçekten repo gerçeklerine göre de en doğru ilk
aday — kullanıcının ön-önerisiyle örtüşüyor. Gerekçe: (a) en yüksek
tek-adımlık gecikme riski (gerçek Playwright + dosya yazma), (b) zaten en
temiz idempotent/gate mimarisine sahip (tek üretim job'ı başına tek
"package_ready" ön koşulu), (c) `'cancelled'` durumu şemada zaten var — bir
queue mantığına geçişte "iptal" kavramı sıfırdan icat edilmiyor, sadece
gerçek bir kod yoluna bağlanıyor.

---

## 3. Queue teknolojisi karar matrisi

| Kriter | In-process lightweight runner | **Postgres-backed job table + polling worker** | BullMQ + Redis | Temporal / durable workflow | Cloud task queue (SQS/Cloud Tasks) |
|---|---|---|---|---|---|
| Lokal geliştirme kolaylığı | Yüksek (hiç yeni servis yok) | Yüksek (zaten Postgres var, ek servis yok) | Düşük (Redis kurulumu + ayrı worker process) | Çok düşük (Temporal server + ayrı runtime) | Düşük (cloud emülatörü veya gerçek hesap gerekir) |
| Deployment karmaşıklığı | Düşük ama **kalıcılık yok** (process restart = job kaybı) | Düşük — mevcut Postgres'e ek tablo, worker ayrı process/aynı process olabilir | Orta-yüksek — yeni bağımlılık (Redis) + operasyonel yük | Yüksek — ayrı altyapı bileşeni | Bulut sağlayıcıya kilitlenme + IAM/network yapılandırması |
| Retry/cancel/progress ihtiyacı | Zayıf (elle, kalıcı değil) | **İyi** — `render_jobs` tablosuna `attempt_count`/`next_run_at`/`cancellation_requested` eklemek yeterli, SQL ile atomic claim | Çok iyi (yerleşik) ama render job zaten Postgres'te yaşıyor — iki kaynak-of-truth riski | Çok iyi ama bu MVP'nin ihtiyacının çok üstünde | İyi ama bulut-özel API'lere bağımlılık |
| Test edilebilirlik | Kolay (senkron mock) | **Kolay** — mevcut embedded-Postgres test deseniyle birebir uyumlu, gerçek SQL ile deterministik testler | Zor — Redis'i test ortamına sokmak, embedded-Postgres emsaliyle uyumsuz | Zor — ayrı bir test runtime'ı gerekir | Zor — bulut emülatörü veya mock SDK gerekir |
| Mevcut PostgreSQL altyapısıyla uyum | Uyumlu ama kalıcı durum tutmuyor | **Mükemmel** — `render_jobs` zaten client_id/status/timestamps taşıyan bir Postgres tablosu, üstüne polling worker doğal uzantı | Zayıf — job durumu iki sistemde (Redis kuyruğu + Postgres render_jobs satırı) çatallanır | Zayıf — kendi event store'unu ister | Zayıf — job state bulut tarafında, Postgres'teki satırla senkron tutulmalı |
| Yeni dependency riski | Yok | **Yok/az** — `pg` zaten bağımlılık, belki `pg-boss` gibi ince bir kütüphane (opsiyonel) | Yüksek — yeni runtime bağımlılığı (Redis) + BullMQ paketi | Çok yüksek — yeni SDK + sunucu bağımlılığı | Yüksek — bulut SDK'sı + kimlik bilgisi yönetimi |

---

## 4. Önerilen MVP queue yaklaşımı

**PostgreSQL-backed job table + polling worker.**

Kullanıcının ön-önerisiyle örtüşüyor ve repo gerçekleriyle de doğrulanıyor:

- Zaten `render_jobs` diye bir Postgres tablosu var, client_id/status/
  timestamp alanları zaten mevcut — "job kuyruğu" kavramen zaten yarı yarıya
  var, sadece **claim/lock/retry alanları** eksik (bkz. §5).
- Repo'nun HİÇBİR yerinde background execution emsali yok (Redis/BullMQ/
  worker_threads/cron — hiçbiri) — bu, MVP'nin bilinçli olarak
  tek-servis/tek-process kalmayı tercih ettiğinin güçlü bir işareti. Yeni bir
  dış bağımlılık (Redis) eklemek, bu adımın "en küçük güvenli MVP" hedefiyle
  orantısız risk taşır.
- Test deseni (embedded Postgres, deterministik fake adapter) Postgres
  tabanlı bir job runner ile SIFIR sürtünmeyle birleşir — Redis/BullMQ ise
  test altyapısına yeni, kırılgan bir bağımlılık sokardı.
- Worker, başlangıçta **API ile aynı process içinde** bir arka plan
  `setInterval`/polling loop olarak çalışabilir (deployment karmaşıklığı
  sıfıra yakın), ölçek gerektiğinde ayrı bir `worker` process/servisine
  (aynı kod, farklı entry point + `WORKER_ENABLED=false` API tarafında)
  taşınabilir — Temporal/BullMQ'nun gerektirdiği "günden güne farklı
  altyapı" sıçraması olmadan.
- `pg-boss` gibi ince, Postgres-native bir kütüphane (SKIP LOCKED tabanlı
  claim, retry, cron) OPSİYONEL bir değerlendirme konusu olarak not
  edilebilir, ama Step 5A'da "yeni tablo alanları + elle yazılmış polling
  loop" ile başlamak, yeni bir kütüphane bağımlılığı riski almadan aynı
  sonucu MVP ölçeğinde verir. Bu, ileride `pg-boss`'a geçişi de
  imkansızlaştırmaz (aynı tablo şekli üstüne inşa edilebilir).

**Sonuç:** BullMQ/Redis veya Temporal gibi ağır çözümler bu ölçekte
gerekçesiz risk; cloud task queue bulut sağlayıcıya kilitlenme yaratır. MVP
için doğru sıradaki adım, mevcut `render_jobs` tablosunu queue-yetkin hale
getirmek ve API process'i içinde (veya yanında) basit bir polling worker
çalıştırmaktır.

---

## 5. RenderJob model gap analizi

Mevcut `render_jobs` şeması (`019_render_jobs.sql`): `id, client_id,
production_job_id, requested_format, manifest_snapshot,
template_contract_snapshot, status, renderer_name, renderer_version,
render_warnings, requested_by, error_message, created_at, updated_at`.

| Önerilen alan | Bugün var mı? | Neden gerekli |
|---|---|---|
| `queued_at` | Yok | "Ne zaman kuyruğa girdi" ile "ne zaman işlenmeye başladı" farkı — bekleme süresi metriği + dashboard "sırada" mesajı için |
| `started_at` | Yok (yalnız `created_at`/`updated_at` var) | Gerçek işlem süresini ölçmek, timeout hesaplamak için |
| `finished_at` | Yok | Toplam süre + SLA/monitoring |
| `progress` | Yok | Dashboard'da "% tamamlandı" göstermek isteniyorsa (opsiyonel — MVP'de basit durum mesajı da yeterli olabilir, bkz. §8) |
| `attempt_count` | Yok | Kaç kez denendiğini takip etmek — job-level retry için zorunlu |
| `max_attempts` | Yok | Retry'ın nerede duracağını belirlemek |
| `next_run_at` | Yok | Backoff'lu retry zamanlamasını Postgres'te tutmak (worker `WHERE next_run_at <= now()` ile claim eder) |
| `locked_by` | Yok | Birden fazla worker instance'ı aynı job'ı iki kez almasın diye (worker id/hostname) |
| `locked_at` | Yok | Stale lock tespiti — bir worker çökerse kilidin süresi dolsun |
| `last_error` | **Var** (`error_message`) — isim değişmeden aynı amaca hizmet edebilir | Zaten var, yeniden adlandırmaya gerek yok |
| `cancellation_requested` | Yok (yalnız şemada `'cancelled'` status değeri var, hiç set edilmiyor) | Kullanıcının "iptal et" isteğini worker'ın bir sonraki poll'da görebilmesi için ayrı bir bayrak — status'u direkt `cancelled` yapmak yarıda kalan bir render'ı tutarsız bırakabilir |

**Not:** Bu alanların TAMAMI additive/nullable migration'lar olarak eklenir
(Step 3/4'teki additive-only disiplinle aynı) — mevcut satırlar/kod
etkilenmez. Bu adımda migration YAZILMADI; yukarıdaki liste Step 5A'nın
migration taslağı için hazır bir sözleşmedir.

`production_jobs` ve `export_artifacts` için aynı analiz DAHA DÜŞÜK
öncelikli: `production_jobs` zaten hafif ve AI/render'a bağımlı değil (§2),
`export_artifacts` render job'ın çocuğu — kendi kuyruk durumuna ihtiyacı yok,
sahibi render job'ın durumunu miras alır.

---

## 6. Worker lifecycle planı

```
pending  (row created, requestedBy known, nothing claimed yet)
   │  worker polls: SELECT ... WHERE status='pending' AND next_run_at<=now()
   │                FOR UPDATE SKIP LOCKED  (Postgres-native claim, no new lib needed)
   ▼
queued   (locked_by/locked_at set atomically with the claim; queued_at set once, on first claim only)
   │  worker begins actual work
   ▼
rendering  (started_at set; existing render-engine.ts body runs UNCHANGED here)
   │
   ├─ success ──────────────► rendered  (finished_at set; export_artifacts row created — EXACT same code path as today)
   │
   ├─ failure, attempt_count < max_attempts
   │        └─► pending again, next_run_at = now() + backoff(attempt_count)
   │            (mirrors provider-errors.ts's exponential backoff shape —
   │             see §10 for which failure classes actually qualify)
   │
   ├─ failure, attempt_count >= max_attempts ─► failed  (last_error set, terminal)
   │
   ├─ cancellation_requested seen at next poll ─► cancelled  (terminal; if already
   │                                              'rendering', worker finishes or
   │                                              aborts the in-flight adapter call
   │                                              — Playwright's page.close() is the
   │                                              natural abort point)
   │
   └─ started_at older than a timeout threshold, locked_by still set,
      but no progress ─► STALE LOCK RECOVERY: a periodic sweep resets
      locked_by/locked_at to NULL and status back to 'pending' (with
      attempt_count incremented) so a crashed worker doesn't strand a job
      forever in 'rendering'.
```

Bu, bugünkü `pending → rendering → rendered/failed` durumlarının ÜSTÜNE
`queued` durumu ve `cancelled`'ın GERÇEK bir kod yolu eklemesidir — mevcut
üç terminal/geçiş durumu (`rendered`, `failed`, ve şemada zaten var olan
`cancelled`) korunur, hiçbiri kaldırılmaz.

---

## 7. API planı

- `POST /production-jobs/:id/render` — davranış değişir: bugünkü gibi
  SENKRON render sonucu dönmek yerine, satırı `status:'pending'` (queued)
  olarak oluşturup **202 Accepted** + `{data: renderJob}` döner (job henüz
  bitmemiş haliyle). Mevcut 400 (preset/format) ve 409 (gate) davranışları
  DEĞİŞMEZ — hâlâ senkron olarak, job hiç oluşturulmadan önce kontrol edilir.
- `GET /render-jobs/:id` — DEĞİŞMEZ (zaten var, zaten client-isolation
  guard'lı) — dashboard bunu polling için kullanır.
- YENİ: `POST /render-jobs/:id/cancel` — `render_jobs:cancel` iznini
  gerektirir (yeni permission, mevcut `render_jobs:create/read` desenine
  uyumlu), `cancellation_requested=true` set eder; zaten terminal bir job için
  409.
- Geri kalan her şey (`GET /render-jobs/:id/artifacts`,
  `GET /export-artifacts/:id/file`, render history) DEĞİŞMEZ — Step 4'ün
  client-isolation guard'ları zaten bu route'larda var ve queue'ya geçişte
  hiç dokunulmuyor.

## 8. Dashboard UX planı

`visual-outputs-panel.tsx`'in bugünkü "senkron, polling yok" varsayımı
(432-434) DEĞİŞMESİ gereken tek büyük varsayım. Önerilen minimal ekleme:

- `handleRenderExport()` artık 202 + `pending/queued` job alır — buton
  metni "Render Al" yerine "Sırada…" / "Render Alınıyor…" olur (durağan
  durum metinleri, karmaşık bir progress bar YOK — MVP'de progress %'si
  gerekmez, sadece durum adı yeterli).
- Basit bir `setInterval` polling (`GET /render-jobs/:id`, 2-3 sn aralık,
  terminal durumda (`rendered`/`failed`/`cancelled`) otomatik durur) —
  `visual-outputs-panel.tsx`'e eklenecek, workflow-runs sayfasının zaten
  yaptığı "advance sonrası yeniden yükle" desenine benzer ama zaman
  tabanlı.
- "Tekrar Dene" butonu: `failed` durumundaki bir render job için YENİ bir
  `POST /production-jobs/:id/render` çağrısı (yeni bir satır, mevcut
  idempotency deseniyle uyumlu — production-jobs'taki "aynı isteği tekrar
  gönder" davranışına benzer, ayrı bir "retry" endpoint'i gerekmez).
- "İptal Et" butonu: yalnız `pending`/`queued`/`rendering` durumundaki
  job'larda görünür, yeni cancel route'unu çağırır.
- Artifact hazır olduğunda (`rendered`), mevcut `fileUrl` linki AYNEN
  kullanılır — hiçbir dosya erişim davranışı değişmez.
- Hata mesajı: mevcut `friendlyErrorSummary()` (Step 3'te eklendi)
  AYNEN kullanılır — job-level "tekrar deneniyor" durumu için ayrı, kısa bir
  Türkçe not eklenir (örn. "Geçici bir hata oluştu, otomatik olarak tekrar
  deneniyor…"), ama mevcut sözlük genişletilir, değiştirilmez.

Büyük UI redesign YOK — sadece durum metni + polling + iki yeni buton.

---

## 9. RBAC / client isolation planı

Step 4'te kurulan mimari AYNEN taşınır, hiçbir yeni kavram icat edilmez:

- **Job create sırasında guard:** `POST /production-jobs/:id/render` bugün
  zaten `assertClientAccessible` çağırıyor (render-engine.ts:168) — job
  `pending` olarak yazılırken `client_id` zaten satıra gömülü. Değişiklik
  yok.
- **Worker execution sırasında client metadata:** worker bir job'ı claim
  ettiğinde `client_id` zaten satırda mevcut — worker'ın YENİDEN
  yetkilendirme kontrolü yapmasına gerek YOK (job zaten yetkili bir istekle
  oluşturuldu, worker bir HTTP isteği değil, arka plan sürecidir — kullanıcı
  bağlamı taşımaz). Bu, mevcut "gate BİR KERE, oluşturma anında" ilkesiyle
  tutarlı (bkz. production-package-builder.ts'in idempotency deseni).
- **Artifact file access:** `GET /export-artifacts/:id/file` zaten Step
  4'ün `assertClientAccessible` guard'ını taşıyor — job'ın nasıl işlendiği
  (senkron/async) bu route'u hiç etkilemez, artifact satırı oluştuktan
  sonra erişim kontrolü AYNEN kalır.
- **Cross-client leakage önleme:** worker'ın SQL claim sorgusu
  (`SELECT ... FOR UPDATE SKIP LOCKED`) `client_id`'ye göre FİLTRELEMEZ —
  worker tüm client'lar için TEK ORTAK kuyruktur (bu doğrudur, çünkü worker
  bir kullanıcı bağlamında çalışmaz). İzolasyon, job SATIRININ kendisinde
  taşınan `client_id` ve mevcut route guard'ları üzerinden sağlanır, worker
  seviyesinde AYRICA bir kontrol gerekmez — worker sadece "hangi job"ı işler,
  "kim görebilir"i asla karar vermez.

**Sonuç: Step 5, Step 4'ün guard mimarisini genişletmez, sadece ONA
dokunmadan üstüne inşa eder.**

---

## 10. Provider retry ile job retry ayrımı

Bu, en kritik tasarım kararı — Step 3'ün retry'ıyla ÇAKIŞMAMASI gerekiyor:

| Katman | Ne zaman devreye girer | Hangi hatalar |
|---|---|---|
| **Provider-level retry** (`packages/model-router/src/provider-errors.ts`, mevcut, DEĞİŞMEZ) | Tek bir AI çağrısı içinde, transport hatası anında | `transient` (2 retry), `rate_limit` (2 retry), `timeout` (1 retry), `unknown` (1 retry) — HEPSİ zaten `ModelRouter.complete()` içinde, milisaniye-saniye ölçeğinde, aynı HTTP isteği bitmeden |
| **Schema-retry** (`apps/api/src/services/ai-call-helper.ts`, mevcut, DEĞİŞMEZ) | AI transport başarılı ama JSON/schema geçersiz | 1 ek deneme, aynı prompt |
| **YENİ: Job-level retry** (Step 5A'da eklenecek) | Bir job ATTEMPT'i TAMAMEN başarısız olduğunda (yukarıdaki İKİ katman da tükendiğinde, VEYA AI'la hiç ilgisi olmayan bir hata: Playwright render exception, storage `putObject` throw, görsel indirme `fetch` timeout) | `permanent`, `auth_error`, `provider_unavailable` (provider seviyesinde retry EDİLMEZ ama job seviyesinde de anlamsız — bunlar hemen `failed` olmalı, job retry'ı da atlanır), VE ai-dışı I/O hataları (storage/network) — bunlar için job-level retry gerçek değer katar çünkü provider katmanı bunları hiç görmez |

**Kural:** Job-level retry, provider/schema retry'ın TÜKETTİĞİ veya HİÇ
KAPSAMADIĞI hata sınıflarını ele alır — asla aynı hatayı iki kez, iki farklı
katmanda retry etmez. `permanent`/`auth_error`/`provider_unavailable`
sınıfları için job-level retry de YAPILMAMALI (config/kalıcı hata — tekrar
denemek sonucu değiştirmez), doğrudan `failed` olarak işaretlenmeli.
Storage/Playwright hataları bugün HİÇBİR katmanda retry edilmiyor — job-level
retry'ın asıl kazandırdığı budur.

---

## 11. Test planı

Mevcut konvansiyonları (embedded Postgres, `RENDERER_PROVIDER=fake`,
`vi.mock` router) AYNEN kullanarak:

- **Fake worker / deterministic job runner:** gerçek `setInterval` yerine,
  testte tek bir "poll tick" fonksiyonunu elle çağıran bir yardımcı (`await
  runOnePollCycle()`) — zamanlamaya bağlı flake riski olmadan deterministik.
- **Render job queued → running → rendered:** tam zincir, mevcut
  `createPackageReadyProductionJob` yardımcısı + yeni `runOnePollCycle`
  çağrısı, sonunda `status==='rendered'` ve bir `export_artifacts` satırı.
- **Retry success:** ilk attempt'te sahte adapter/storage bir kez throw
  etsin (yeni bir `aiControl`-benzeri kontrol objesi), ikinci pollde
  başarılı — `attempt_count===2`, `status==='rendered'`.
- **Retry exhausted → failed:** `max_attempts` kez üst üste başarısız,
  `status==='failed'`, `last_error` set, `attempt_count===max_attempts`.
- **Cancel:** `pending` durumda cancel çağrısı → job hiç claim edilmeden
  `cancelled` olarak kalır; `rendering` durumda cancel çağrısı → bir sonraki
  pollde `cancelled`'a geçer (in-flight render'ı gerçekten kesmek Step 5A'nın
  DAHA İLERİ bir alt-hedefi olabilir; MVP'de "bir sonraki kontrol noktasında
  durur" yeterli).
- **Client isolation:** Step 4'ün `client-isolation.test.ts` deseniyle
  birebir — iki farklı client'ın job'ları aynı kuyrukta işlenir ama route
  seviyesinde birbirine sızmaz (worker'ın client-agnostic claim sorgusu
  BİLEREK test edilir: iki client'ın job'ı karışık sırayla işlense bile
  hiçbir route cross-client veri döndürmez).
- **Artifact storage:** DEĞİŞMEZ — mevcut render-jobs.test.ts'in storage
  assertion'ları aynen geçerli kalmalı (job async olsa da sonuç satırı
  aynı şekle sahip).
- **Dashboard polling/hydration:** dashboard tarafı için birim/entegrasyon
  testi yerine, `api.ts`'teki yeni polling fonksiyonunun bir sahte
  `fetch` sırasıyla (`pending`→`pending`→`rendered`) doğru şekilde
  interval'ı durdurduğunu test eden küçük bir unit test yeterli — büyük bir
  E2E gerekmez.

---

## 12. Riskler

- **Stale lock / crashed worker:** Bir worker process'i `rendering`
  ortasında çökerse job sonsuza kadar kilitli kalabilir — §6'daki periyodik
  stale-lock sweep bunu ele alıyor, ama sweep'in kendisi de bir zamanlama
  bileşeni gerektirir (basit bir `setInterval`, ek bir kütüphane değil).
  **UYGULANDI (Production Readiness Step):** burada planlanan sweep artık
  gerçek kod — `renderJobsRepo.resetStaleLocks()` (RENDER_JOB_STALE_LOCK_MS,
  varsayılan 900000ms/15dk) + `render-worker.ts`'in `sweepStaleRenderLocks()`
  export'u, her poll tick'te (heartbeat yazımıyla birlikte, ayrı bir
  interval olmadan) çalışıyor. Ayrıca yeni bir worker heartbeat mekanizması
  (`render_worker_heartbeats` tablosu) eklendi — "worker canlı mı" artık
  `GET /api/health/ready`'nin `workerHeartbeat`/`renderQueue` check'lerinden
  görülebiliyor. Detay: `docs/production-readiness-review.md`.
- **Tek-process worker, yatay ölçek yok:** Bu MVP yaklaşımı tek worker
  instance'ı varsayar (`SKIP LOCKED` çoklu worker'a teknik olarak izin verir
  ama Step 5A'da tek worker yeterli olmalı) — gerçek yüksek eşzamanlılık
  gerekirse (bkz. roadmap'in "MVP→production geçiş eşiği" sorusu) bu, ayrı
  bir sonraki adımda ele alınmalı.
- **In-flight render'ı gerçekten kesmek zor:** `cancellation_requested`
  bayrağı bir sonraki poll'da görülür ama Playwright zaten render alıyorsa
  o render'ı YARIDA kesmek (process/page abort) ek karmaşıklık — MVP'de
  "kesme değil, bir sonraki adımda durdurma" kabul edilebilir bir kısıtlama
  olarak not edildi.
- **Dashboard polling'in eklenmesi mevcut "senkron" varsayımını kırıyor:**
  `visual-outputs-panel.tsx`'in birçok yerinde "backend senkron döner"
  varsayımı var (§1) — bu değişiklik dikkatli yapılmazsa mevcut Step
  1/2/3 testlerini kırma riski taşır; Step 5A'nın kapsamı BUNU regresyon
  riski olarak açıkça not etmeli ve mevcut render/export testlerini
  değiştirmeden GEÇMESİNİ zorunlu tutmalı.
- **Migration additive olsa da index/lock davranışı test edilmeli:**
  `FOR UPDATE SKIP LOCKED` performansı/doğruluğu embedded-Postgres test
  ortamında gerçek Postgres semantiğiyle test edilebilir (iyi haber — mock
  DB değil, gerçek Postgres olduğu için bu risk düşük).
- **Provider vs job retry sınır çizgisinin yanlış çizilmesi:** §10'daki
  ayrım net değilse, bir hatanın 2 (provider) × 1 (schema) × N (job) kez
  denenip toplamda aşırı gecikmeye/gereksiz maliyete yol açması riski var —
  Step 5A implementasyonunda bu sınırın testle KANITLANMASI gerekir (bkz.
  §11 "retry success/exhausted" testleri, özellikle hangi hata sınıflarının
  job-retry'a hiç girmediğini doğrulayan bir test eklenmeli).

---

## 13. Phase 3 Step 5A için hazır implementation promptu

Aşağıdaki prompt, bu plan onaylandıktan sonra Step 5A'yı başlatacak bir
sonraki konuşmaya doğrudan verilebilir:

```
Grafista AI Studio MVP — Phase 3 Step 5A — Render Queue MVP Implementation

Çalışma dizini: /Users/sercanbingol/Desktop/Antigravity/Projeler/Grafista-AI-Studio
Branch: phase-2-checkpoint (Step 5 planning commit'i sonrası)
Referans doküman: docs/render-queue-worker-plan.md (bu planın TAMAMINI
uygula — özellikle §5 model gap, §6 lifecycle, §10 retry ayrımı, §11 test
planı).

Hedef: renderProductionJob() akışını senkron HTTP'den Postgres-backed
kuyruk + in-process polling worker'a taşı. Yeni dış bağımlılık (Redis,
BullMQ, Temporal) EKLEME — pg zaten var, onu kullan.

Kapsam:
1. Additive migration: render_jobs tablosuna queued_at, started_at,
   finished_at, attempt_count, max_attempts, next_run_at, locked_by,
   locked_at, cancellation_requested alanları (§5) — mevcut error_message
   alanı last_error yerine geçer, yeniden adlandırma YOK.
2. render_jobs status enum'una 'queued' ekle (mevcut pending/rendering/
   rendered/failed/cancelled korunur, cancelled'a GERÇEK bir kod yolu
   bağlanır — §6).
3. Basit bir in-process polling worker (yeni setInterval tabanlı loop,
   API process'i içinde, WORKER_ENABLED=true varsayılan env flag'i ile
   kapatılabilir) — SELECT ... FOR UPDATE SKIP LOCKED ile job claim
   (§4, §6).
4. render-engine.ts'in MEVCUT senkron gövdesi (HTML build → adapter.render
   → checksum → storage → artifact) worker'ın İÇİNE taşınır, DEĞİŞTİRİLMEZ
   — sadece çağrıldığı yer değişir (route → worker tick).
5. POST /production-jobs/:id/render artık 202 + pending job döner (§7).
6. Yeni POST /render-jobs/:id/cancel route + render_jobs:cancel permission.
7. Job-level retry SADECE §10'da tanımlanan hata sınıfları için (storage/
   Playwright/ai-dışı hatalar + provider/schema retry tükendikten sonraki
   kalıcı olmayan hatalar) — permanent/auth_error/provider_unavailable için
   job retry YAPMA.
8. Dashboard: visual-outputs-panel.tsx'e minimal polling (§8) — "Sırada",
   "Render Alınıyor", "Tekrar Dene", "İptal Et" — büyük UI redesign YOK.
9. Client isolation: Step 4'ün assertClientAccessible guard'ı create
   sırasında AYNEN kalır; worker seviyesinde YENİDEN yetkilendirme YOK (§9).
10. Testler (§11): fake worker/deterministic poll-tick yardımcı fonksiyonu,
    queued→running→rendered, retry success, retry exhausted→failed, cancel
    (pending ve rendering durumlarından), client isolation, artifact
    storage — mevcut render-jobs.test.ts/production-jobs.test.ts/
    visual-generation.test.ts/demo-flow.test.ts/client-isolation.test.ts
    KIRILMAMALI.

Kesinlikle yapılmayacaklar: Redis/BullMQ/Temporal, workflow engine
refactor, provider mimarisi refactor, multi-tenant redesign, büyük UI
redesign, gerçek Photoshop/Adobe/PSD rendering.

Komutlar (hepsi geçmeden commit atma): pnpm run typecheck, pnpm run lint,
pnpm run test:stable, pnpm run build. Ayrıca render-queue/worker testlerini
izole çalıştır.

Commit mesajı önerisi: "phase 3 step 5a: postgres-backed render queue + polling worker"
```

---

## İlgili dokümanlar

- [`docs/phase-3-productization-roadmap.md`](./phase-3-productization-roadmap.md)
  — Step 5'in orijinal kapsam tanımı (bu belge onun teslimatıdır).
- [`docs/release-readiness.md`](./release-readiness.md) §9 — "workflow
  queue/worker yok" bilinçli kapsam dışı notu; bu plan, o notun bir sonraki
  adımı nasıl ele alacağını tanımlar (henüz UYGULANMADI).
