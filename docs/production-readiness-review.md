# Grafista AI Studio — Production Readiness Review (Phase 3 Step 7)

> **Status: REVIEW + PLAN ONLY — no code, no migration, no deployment
> config, no dependency eklendi bu adımda.** Bu belge
> [`docs/phase-3-final-state.md`](./phase-3-final-state.md) §6'nın kapanış
> kararının teslimatıdır: Phase 3 Step 7, Photoshop/PSD handoff değil, bir
> Production Readiness Review / Deployment-Monitoring Planı olmalı. Bu
> belge, `docs/render-queue-worker-plan.md` ve
> `docs/analytics-revision-history-plan.md` ile AYNI disiplinle yazıldı:
> mevcut durum tespiti, karar matrisleri, somut dosya/komut referansları ve
> tek bir hazır implementation prompt'uyla kapanıyor.
>
> Kaynaklar: [`docs/release-readiness.md`](./release-readiness.md),
> [`docs/phase-3-final-state.md`](./phase-3-final-state.md),
> [`docs/phase-3-productization-roadmap.md`](./phase-3-productization-roadmap.md),
> [`docs/render-queue-worker-plan.md`](./render-queue-worker-plan.md),
> [`docs/analytics-revision-history-plan.md`](./analytics-revision-history-plan.md),
> ve doğrudan repo içi grep/okuma (`apps/api/src/app.ts`,
> `apps/api/src/services/render-worker.ts`,
> `apps/api/src/db/repositories/render-jobs.ts`,
> `apps/api/src/db/repositories/analytics-events.ts`,
> `apps/api/vitest.config.ts`, `apps/api/src/test/global-setup.ts`,
> `.env.example`, `database/migrations/`).

---

## 1. Neden bu adım şimdi?

`docs/phase-3-final-state.md` §6, Photoshop/PSD yerine bu belgeyi
önermişti çünkü: (a) stale-lock recovery YALNIZ planlandı, hiç
uygulanmadı; (b) in-flight render iptali sınırlı; (c) test suite'inde
gerçek, tekrarlanan flakiness var; (d) bu projede bugüne kadar SIFIR
deployment/monitoring geçmişi var. Bu belge her dördünü ayrı ayrı
doğruluyor (aşağıda §6, §7) ve TEK bir somut ilk adım öneriyor (§10).

---

## 2. Minimum production servisleri — doğrulanmış envanter

`.env.example`, `docs/release-readiness.md` ve gerçek kod
(`apps/api/src/app.ts`, `package.json`'lar) çapraz kontrol edildi:

| Servis | Zorunlu mu? | Kanıt |
|---|---|---|
| PostgreSQL 14+ | **Evet, zorunlu** | `DATABASE_URL` — API açılışta fail-fast; `pg` bağımlılığı (`apps/api/package.json`); embedded-Postgres yalnız testte (`vitest.config.ts`) |
| API server (`apps/api`, Express) | **Evet, zorunlu** | `apps/api/src/app.ts` — tüm domain route'ları burada; `dev`/`build`/`start` script'leri (`tsx watch` / `tsc` / `node dist/index.js`) |
| Dashboard (`apps/dashboard`, Next.js) | **Evet, gerçek kullanım için** | `next dev --port 3000` / `next build` / `next start`; `NEXT_PUBLIC_API_URL` API'ye işaret eder |
| S3-uyumlu storage | **Koşullu** | `STORAGE_PROVIDER` — `local` (varsayılan, `apps/api/uploads/`) veya `s3` (`S3_ENDPOINT/REGION/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY/FORCE_PATH_STYLE` hepsi birlikte zorunlu, sessiz local-fallback YOK) |
| Render worker | **Ayrı bir servis DEĞİL — aynı Node process'i içinde** | `render-worker.ts` `setInterval` tabanlı `startRenderWorkerLoop()`/`stopRenderWorkerLoop()` — ayrı bir process/entry point yok, `apps/api`'nin kendi process'inde çalışıyor (`RENDER_QUEUE_ENABLED` bayrağıyla açılır kapanır); bu, Step 5A'nın "API ile aynı process" tasarımını AYNEN doğruluyor |
| Playwright/Chromium runtime | **Koşullu, gerçek render için zorunlu** | `apps/api/package.json`'da `playwright` gerçek bağımlılık; `RENDERER_PROVIDER=fake` bu bağımlılığı tamamen ortadan kaldırır (test suite hep `fake` kullanır — `vitest.config.ts`) |
| AI provider anahtarları | **Koşullu** | `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` presence-only zorunlu (fake modda bile dummy string), `KIE_AI_API_KEY`+`KIE_AI_BASE_URL` gerçek görsel üretimi için birlikte zorunlu, `AI_DEFAULT_PROVIDER=fake` tüm bunları by-pass eder |
| Render queue env'leri | **Opsiyonel, Step 5A'dan** | `RENDER_QUEUE_ENABLED` (varsayılan kapalı — backward-compatible), `RENDER_WORKER_ID`, `RENDER_JOB_MAX_ATTEMPTS`, `RENDER_JOB_BASE_DELAY_MS`, `RENDER_WORKER_POLL_INTERVAL_MS` |

**Sonuç: kullanıcının ön-listesi doğru, ama bir nüans önemli** — "render
worker" ayrı bir servis/deploy hedefi DEĞİL, `apps/api`'nin process'i
içinde bir arka plan döngüsü. Bu, deployment topolojisini önemli ölçüde
BASİTLEŞTİRİYOR (§3) ama aynı zamanda yatay ölçek için yeni bir kısıtlama
getiriyor (§6).

---

## 3. Deployment topolojisi karşılaştırması

Repo'da **hiçbir** platform ipucu yok: `railway.json`, `Dockerfile`,
`docker-compose.yml`, `fly.toml`, `render.yaml`, `.github/workflows/` —
hiçbiri repo genelinde (root, `apps/api`, `apps/dashboard`) mevcut değil
(doğrulandı). Tek referans `docs/security.md`'deki bir TODO satırı:
"Migrate to secrets manager (Railway secrets / AWS Secrets Manager)" —
bu bir seçim değil, bir fikir notu; hiçbir platform commit edilmiş
değil.

| Yaklaşım | Değerlendirme |
|---|---|
| Tek VM / Docker Compose (API+Worker aynı container, ayrı Postgres/MinIO container) | **En doğal uyum** — in-process worker zaten "tek uzun-ömürlü Node process" varsayıyor; Compose bunu birebir yansıtır (API container, Postgres container, opsiyonel MinIO container). Playwright'ın Chromium bağımlılıkları bir Dockerfile'da (`npx playwright install --with-deps chromium`) doğal olarak çözülür. |
| Railway / Render.com / Fly.io (uzun-ömürlü process desteği olan PaaS) | **İkinci en iyi** — hepsi "her zaman açık, tek process" servis modelini destekliyor (stateless/serverless değil); managed Postgres + object storage eklentileri var. Repo'da bir platform seçilmiş DEĞİL ama `docs/security.md`'nin Railway'e tek atıfı bir sinyal değil, sadece bir olasılık notu. |
| VPS + PM2/Docker (kendi sunucu yönetimi) | **Çalışır ama operasyonel yük en yüksek** — patch/güvenlik/yeniden başlatma manuel; küçük bir ekip için gereksiz bakım maliyeti. |
| Managed Postgres + managed S3 (ayrı sağlayıcılar, API'yi herhangi bir yerde çalıştır) | **Storage/DB için doğru varsayılan** — zaten `STORAGE_PROVIDER=s3` abstraction'ı buna hazır; hangi compute platformuyla eşleşirse eşleşsin bağımsız bir karar. |
| Kubernetes | **Şimdilik orantısız** — çoklu worker/pod yatay ölçeği gerektirir, ama §6'da gösterildiği gibi in-process worker'ın "2 API instance = 2 worker aynı tabloyu poll ediyor" davranışı HİÇ test edilmedi; K8s'in getirdiği "N replica" modeli bu doğrulanmamış varsayımı doğrudan tetikler. Erken. |

**Sonuç:** In-process worker tasarımı, "stateless/serverless request-response"
için optimize edilmiş bir platformu (örn. çıplak Vercel serverless
functions, AWS Lambda) **doğrudan diskalifiye eder** — worker'ın
`setInterval` döngüsü çalışabilmesi için process'in sürekli ayakta
kalması ZORUNLU; bir serverless fonksiyon isteksiz kaldığında worker da
durur, kuyruktaki job'lar hiç işlenmez. Bu yüzden "her zaman açık tek
process" çalıştırabilen bir platform (Docker Compose / Railway / Render /
Fly / VPS) doğru aday kümesi; K8s bugünkü doğrulanmamış çoklu-worker
riskiyle erken.

---

## 4. En güvenli ilk MVP deployment yaklaşımı

Ağırlıklandırma: basitlik, maliyet, worker execution (in-process =
uzun-ömürlü process zorunlu), Playwright/Chromium runtime (container
gerektirir — Node buildpack'lerin çoğu Chromium'un sistem
bağımlılıklarını (libnss3, fonts, vb.) içermez), env/secret yönetimi,
storage uyumluluğu, test edilebilirlik.

**Somut öneri: Docker Compose ile tek-VM/tek-host dağıtımı (veya
eşdeğer bir "uzun-ömürlü process" PaaS'ı, örn. Railway/Render) —
Kubernetes DEĞİL, çıplak serverless DEĞİL.**

Gerekçe:
- Repo'da Dockerfile/Compose YOK — bu adımın kapsamı bunu yazmak
  DEĞİL, ama bir sonraki adımın (§11 dışındaki "Deployment Runbook"
  adayı) doğal ilk teslimi bir Dockerfile + Compose dosyası olurdu.
- Playwright, `RENDERER_PROVIDER=fake` DIŞINDA gerçek render için
  Chromium sistem bağımlılıkları ister — bu, "bare Node buildpack"
  (örn. çoğu PaaS'ın varsayılan Node runtime'ı) ile değil, Playwright'ın
  resmi Docker image'ı veya `npx playwright install-deps` çalıştırılmış
  bir container ile çözülür. Bu, tek başına "hangi platform" kararını
  container-temelli bir yöne zaten itiyor.
- Worker aynı process'te olduğu için "ayrı bir worker deploy hedefi"
  YOK — bu, iki deploy pipeline'ı yerine BİR tane yönetmek anlamına
  gelir (API image = worker image, aynı process).
- Managed Postgres (Railway/Render/Neon/RDS) + managed S3-uyumlu
  storage (Railway/Cloudflare R2/AWS S3) storage abstraction'ıyla
  (`STORAGE_PROVIDER=s3`) zaten uyumlu, sıfır kod değişikliği ister.
- Maliyet: tek instance + managed Postgres + managed storage, MVP
  ölçeğinde (bir ajans, birkaç client) en düşük operasyonel yük/maliyet
  kombinasyonu — Kubernetes'in getirdiği kontrol düzlemi karmaşıklığı bu
  ölçekte karşılığını vermez.

---

## 5. Monitoring ihtiyaçları — bugün gerçekten ne var, ne yok

Her biri doğrudan grep/okuma ile doğrulandı, varsayılmadı:

| İhtiyaç | Bugün var mı? | Kanıt |
|---|---|---|
| API healthcheck | **Kısmen var, ama sığ** | `apps/api/src/app.ts:45` — `GET /api/health` var, ama yalnız statik `{status:'ok', service, version, timestamp}` döner; DB/storage/worker bağlantısını KONTROL ETMEZ — process ayakta olduğu sürece her zaman `ok` döner, DB düşse bile. |
| DB connectivity check | **Yok** | `/api/health` DB'ye hiç sorgu atmıyor; başka hiçbir "DB ping" route'u yok. |
| Storage connectivity check | **Yok** | Ne bir route ne bir script storage bağlantısını izole "canlı mı" diye kontrol ediyor — yalnız `smoke:providers`'ın `storage` bölümü (manuel, CLI, deploy sonrası otomatik DEĞİL). |
| Provider smoke status | **Yalnız manuel CLI, otomatik/canlı değil** | `pnpm run smoke:providers` (`apps/api/src/scripts/smoke-real-providers.ts`) — elle çalıştırılan bir script, bir monitoring endpoint'i/cron DEĞİL; son gerçek çalıştırma `docs/release-readiness.md`'de tek seferlik kayıt. |
| Render worker heartbeat | **Yok** | `render-worker.ts`'de `console.log`/`console.error` VAR ama kalıcı bir "worker şu an canlı/son ne zaman tick attı" sinyali (DB satırı, endpoint, metrik) YOK. |
| Queue depth (bekleyen job sayısı) | **Yok** | `renderJobsRepo`'da `pending`/`queued` sayısını dönen bir metod yok; Step 6A'nın analytics özeti (`GET /clients/:id/analytics/summary`) `renderJobsRendered`/`renderJobsFailed` SAYAR ama "şu an kuyrukta kaç job bekliyor" YOK. |
| Failed job count | **Kısmen — client-scoped analytics özeti var, global/operasyonel görünüm yok** | Analytics özeti `renderJobsFailed`'i client bazında sayıyor ama tüm client'lar genelinde tek bir operasyonel "kaç job failed durumda takıldı" görünümü/alarmı yok. |
| Last render success (zaman damgası) | **Yok, dolaylı türetilebilir** | `render_jobs.finished_at`'tan sorgulanabilir ama bunu gösteren bir endpoint/dashboard widget'ı yok. |
| Analytics/revision write health | **Yok — yalnız `console.warn`** | `recordBestEffort()` (analytics-events.ts, revision-entries.ts) bir yazma hatasını yutuyor ve sadece stdout'a `console.warn` yazıyor; bunu izleyen bir alarm/metrik yok. |

**Sonuç: monitoring/observability yüzeyi neredeyse tamamen boş.** Tek
gerçek varlık, işlevsel ama sığ bir `/api/health` — process liveness'ı
gösterir, dependency (DB/storage/worker) readiness'ı GÖSTERMEZ. Bu,
§11'deki önceliklendirmenin ana girdisi.

---

## 6. Logging standardı — mevcut ve eksik

| Alan | Bugün var mı? | Kanıt |
|---|---|---|
| Secret redaction | **Evet, bir emsal var** | `apps/api/src/db/repositories/analytics-events.ts`'in `isDenylistedKey()`/`assertMetadataSafe()` — kelime-farkında bir denylist (`secret`/`password`/`authorization`/`auth`, `apiKey`, sonu `token` ile biten anahtarlar) `analytics_events.metadata`'ya secret sızmasını engelliyor; `revision-entries.ts` bunu AYNEN yeniden kullanıyor. **Ama bu yalnız analytics/revision metadata'sına özgü** — genel `console.log`/`console.error` çağrılarında merkezi bir redaction katmanı YOK; disiplin elle uyulan bir kurala dayanıyor. |
| Request/correlation ID | **Yok** | Repo genelinde gerçek bir request-id middleware'i yok. Bir isteğin loglarda uçtan uca izlenmesi için ortak bir ID yok. |
| Job id / client id loglarda | **Kısmen, worker seviyesinde var** | `render-worker.ts` — job/worker id'li log satırları var ama `clientId` çoğu satırda YOK (job'ın kendisi client_id taşısa da log satırına kopyalanmıyor). |
| Provider hata sınıflandırması | **Evet, zaten var (Step 3)** | `packages/model-router/src/provider-errors.ts`'in `classifyProviderError` — `permanent`/`auth_error`/`transient`/`rate_limit`/`provider_unavailable` sınıfları; render-worker bunu DOĞRUDAN yeniden kullanıyor. |
| Worker lifecycle logları | **Var, temel seviyede** | `startRenderWorkerLoop()`/`stopRenderWorkerLoop()` başlangıç/bitiş logları; her poll tick hatası loglanıyor. Bunlar VAR ama yalnız stdout'a — kalıcı değil, agregasyon/alarm bağlanmıyor (bkz §5). |
| Artifact download logları | **Yalnız analytics event, ayrı log satırı yok** | Dosya indirme handler'ı `analyticsEvents.recordBestEffort({eventType:'export_artifact_downloaded', ...})` çağırıyor (Step 6A); bunun DIŞINDA ayrı bir "indirme oldu" log satırı yok — tek iz analytics tablosunda, best-effort (yazma başarısız olursa sessizce kaybolabilir, §5). |

**Sonuç:** Provider hata sınıflandırması ve secret-denylist emsali sağlam
temeller; ama bunların ikisi de merkezi bir "logging standardı"na
GENELLEŞTİRİLMEDİ — request-id yok, worker logları client_id taşımıyor,
ve genel `console.log` disiplini kural-tabanlı (elle uyulan), araç-tabanlı
(otomatik enforced) değil.

---

## 7. Queue/worker production riskleri — her biri doğrulandı

| Risk | Doğrulama |
|---|---|
| **Stale lock recovery UYGULANMADI** | `docs/render-queue-worker-plan.md` sweep'i PLANLADI ("periyodik bir sweep `locked_by`/`locked_at`'ı NULL'a resetler"); ama `apps/api/src/services/render-worker.ts`'de `stale`/`sweep` mekanizması YOK — yalnızca claim/process/poll loop var. Bir worker `rendering` ortasında çökerse, job GERÇEKTEN sonsuza kadar kilitli kalır — bu bugün gerçek, aktif bir gap, sadece dokümante edilmiş bir risk değil. |
| **In-flight cancellation sınırlı** | Onaylandı — `cancellation_requested` yalnız bir sonraki `poll`'da görülür; Playwright zaten render alıyorsa o render KESİLMEZ, tamamlanır. |
| **Worker heartbeat yok** | Onaylandı — `render-worker.ts`'de `console.log` VAR ama kalıcı bir heartbeat sinyali (DB satırı/`last_seen_at` gibi) yok; bir worker process'inin sessizce durduğunu (crash, ama process kill edilmeden) tespit edecek hiçbir mekanizma yok. |
| **Çoklu worker deploy — yatay ölçek testi edilmemiş** | `render-queue-worker-plan.md`'nin kendi admisyonu: tek-process worker, yatay ölçek yok. `SELECT ... FOR UPDATE SKIP LOCKED` teorik olarak doğru claim semantiğini sağlar, AMA "2 API instance çalıştırırsan otomatik 2 worker aynı tabloyu poll eder" senaryosu hiçbir testte (`render-queue-worker.test.ts` dahil, tek `runOnePollCycle()` yardımcı fonksiyonu kullanıyor, gerçek eşzamanlı iki worker process'i DEĞİL) egzersiz edilmedi. |
| **Retry exhaustion görünürlüğü zayıf** | Onaylandı — `max_attempts`'e ulaşıp `failed` olan bir job, bugün YALNIZ (a) dashboard'da o production job'ın sayfasını açıp görmek veya (b) doğrudan `render_jobs WHERE status='failed'` SQL sorgusu ile görülebilir. Analytics özeti `renderJobsFailed`'i SAYAR ama "HANGİ job'lar failed, ne zamandır" bir liste/alarm sunmaz. |
| **Queue depth dashboard'ı yok** | Onaylandı — `docs/analytics-revision-history-plan.md`'nin tam response şekli incelendi: `queueDepth`/`pendingJobCount` gibi bir alan YOK. Step 6A'nın kapsamı bilinçli olarak bunu içermiyordu (all-time toplamlar, gerçek-zamanlı kuyruk durumu değil). |

**Sonuç:** Kullanıcının 6 risk maddesinin HEPSİ doğrulandı, hiçbiri
abartı/varsayım değil — özellikle stale-lock recovery'nin "planlandı ama
sıfır satır kod" olması ve worker heartbeat'in tamamen yokluğu, bir
production ortamında "worker sessizce durdu, kimse fark etmedi, job'lar
sonsuza kadar kuyrukta bekliyor" senaryosunu bugün gerçek kılıyor.

---

## 8. Test/CI stratejisi — bugünkü gerçek durum

- **Vitest config doğrulandı:** `apps/api/vitest.config.ts` — embedded
  Postgres (`globalSetup: './src/test/global-setup.ts'`), `RENDERER_
  PROVIDER: 'fake'` sabit env, `AI_DEFAULT_PROVIDER` fake test
  anahtarlarıyla ayarlı.
- **`test:stable` gerçek script tanımı** (root `package.json`):
  `"test:stable": "pnpm --filter @grafista/api exec vitest run
  --maxWorkers=2"` — kullanıcının belirttiği gibi doğrulandı.
- **Flakiness gerçek ve dokümante edilmiş** — `docs/phase-3-final-state.md`'nin
  teknik borç listesi: "Test suite has documented flakiness under
  parallel load... observed repeatedly during Step 5A/6A/6B implementation
  sessions (a file failing under full parallelism, passing cleanly in
  isolation and on a clean full re-run)." Bu iddia hem
  `docs/release-readiness.md`'de hem final-state'te BAĞIMSIZ olarak
  tekrarlanıyor — icat edilmiş bir risk değil, aynı gözlem iki ayrı
  dokümanda.
- **CI config dosyası: YOK.** `.github/` dizini repo'da mevcut değil,
  başka bir CI sağlayıcı config'i de yok. `pnpm run test:stable`/
  `pnpm run check:release` bugün **yalnızca yerel bir konvansiyon** —
  hiçbir otomatik pipeline bunu her PR/push'ta ÇALIŞTIRMIYOR.
- **Real-provider smoke testing test suite'inde YOK, doğru şekilde** —
  `vitest.config.ts`'in `RENDERER_PROVIDER: 'fake'` sabit env'i ve
  `AI_DEFAULT_PROVIDER` test anahtarları, gerçek network çağrısı
  yapılmadığını garanti eder. Gerçek provider bağlantısı yalnız
  `smoke:providers` CLI script'inde, test suite'inin DIŞINDA, elle
  çalıştırılıyor.

**Sonuç:** Kullanıcının önerdiği her madde birebir doğru. Ek bulgu: CI'ın
tamamen yokluğu, "test:stable" bir yerel disiplin olarak var olsa da
uygulanmasının insan hafızasına bağlı olduğu anlamına geliyor —
kimse `pnpm run test:stable`'ı unutup doğrudan `git push` yapabilir, bunu
engelleyen hiçbir otomatik kapı yok.

---

## 9. Env/secret checklist

`.env.example`'daki gerçek anahtar isimleri (değerler asla
yazdırılmadı, yalnız isimler):

| Kategori | Anahtarlar | Rotasyon stratejisi dokümante mi? |
|---|---|---|
| Database | `DATABASE_URL`, `PGVECTOR_ENABLED` | **Yok** |
| Auth/session | `AUTH_SECRET`, `COOKIE_SECURE`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | **Yok** — `docs/security.md` yalnız `AUTH_SECRET`'ın ≥16 karakter olması gerektiğini not ediyor, rotasyon planı yok. |
| Storage | `STORAGE_PROVIDER`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | **Yok** |
| AI providerları | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `KIE_AI_API_KEY`, `KIE_AI_BASE_URL` | **Yok** |
| Routing | `AI_DEFAULT_PROVIDER`, `DEFAULT_TEXT_PROVIDER`, `DEFAULT_VISION_PROVIDER`, `DEFAULT_IMAGE_PROVIDER` | n/a (routing config, secret değil) |
| Render/queue (Step 5A) | `RENDERER_PROVIDER`, `RENDER_QUEUE_ENABLED`, `RENDER_WORKER_ID`, `RENDER_JOB_MAX_ATTEMPTS`, `RENDER_JOB_BASE_DELAY_MS`, `RENDER_WORKER_POLL_INTERVAL_MS` | n/a (davranış config'i, secret değil) |
| API/dashboard/port | `API_PORT`, `API_HOST`, `API_CORS_ORIGIN`, `NEXT_PUBLIC_API_URL` | n/a |
| Diğer/güvenlik | `UPLOAD_MAX_SIZE_MB`, `ALLOWED_FILE_TYPES`, `LOG_LEVEL`, `NODE_ENV` | n/a |

**Admin/seed env:** `ADMIN_EMAIL`/`ADMIN_PASSWORD` yalnız
`db:seed-admin` script'i tarafından okunuyor, API boot'unda gerekli
DEĞİL.

**Rotasyon boşluğu:** `docs/security.md`'nin tek somut notu bir TODO
satırı ("Migrate to secrets manager") — hiçbir gerçek rotasyon prosedürü
hiçbir dokümanda yazılı değil. Bu, production'a çıkmadan önce kapatılması
gereken açık bir boşluk, ama bu belgenin kapsamındaki "en riskli alan"
değil (§11'in gerekçesine bkz).

---

## 10. Backup/restore planı

- **PostgreSQL migration/rollback:** `database/migrations/` (001–024,
  sıralı, sadece yukarı doğru numaralı SQL dosyaları) incelendi —
  hiçbir dosyada `DROP TABLE`/`DROP COLUMN`/bir "down" fonksiyonu YOK.
  Her Phase 3 adımı kendi planında "additive-only" disiplinini AÇIKÇA
  belirtiyor. **Sonuç: bugün gerçek bir migration-rollback mekanizması
  YOK — "additive-only, asla yıkıcı değişiklik yok" disiplini FİİLEN
  rollback stratejisinin kendisi.** Bir hata durumunda geri dönüş, eski
  bir DB snapshot'ını restore etmek olurdu (klasik PITR/backup), kod-
  seviyeli bir "migration down" komutu değil — ama bugün böyle bir
  snapshot/backup prosedürü de hiçbir yerde dokümante değil.
- **S3/storage artifact backup:** Storage abstraction'ı
  (`STORAGE_PROVIDER=local|s3`) doğrulandı — `local` modda dosyalar
  `apps/api/uploads/` altında düz diskte, **hiçbir backup mekanizması
  yok** (tek instance'ın diski kaybolursa tüm görsel/render/artifact
  geçmişi kaybolur). `s3` modda ise gerçek bir backup hikayesi olur
  ANCAK bu S3 sağlayıcısının kendi versioning/replication ayarına
  bağlıdır — repo bunu ne yapılandırıyor ne dokümante ediyor. **Bu, özellikle
  local-disk deployment için gerçek, henüz kapatılmamış bir production
  gap'idir.**
- **Seed/demo verisi ayrımı:** `db:seed` (roller/izinler + örnek client) ve
  `db:seed-admin` (giriş kullanıcısı) production'da da gerçekten gerekli
  adımlar; `db:seed-demo` ise AÇIKÇA ayrı, opsiyonel bir script. **Bu üçü
  zaten temiz şekilde ayrık scriptler** (`db:migrate` → `db:seed` →
  `db:seed-admin` → opsiyonel `db:seed-demo`) — demo verisinin production'a
  kazayla karışması riski düşük, çünkü hiçbiri otomatik zincirlenmiyor.

**Sonuç:** Migration tarafı "additive-only" disipliniyle fiilen kendi
rollback stratejisini taşıyor (kabul edilebilir, ama backup/restore
PROSEDÜRÜ hâlâ yazılı değil); asıl gerçek gap **storage artifact
backup'ı**, özellikle `local` modda hiç ele alınmamış durumda.

---

## 11. Beş aday değerlendirmesi ve NET öneri

Kullanıcının 5 adayı (A: Healthcheck+Doctor endpoint, B: Worker
Heartbeat+Stale Lock Recovery, C: Deployment Runbook, D: CI Stable Test
Profile, E: Production Smoke Script) §2–10'daki bulgulara karşı
tartılıyor:

| Aday | Değerlendirme |
|---|---|
| **A — Healthcheck + Doctor endpoint** | Gerçek bir gap (§5: `/api/health` sığ, dependency check yok). Bir healthcheck'in NE'yi kontrol edeceği kısmen deployment topolojisine bağlı — yine de bu bağımlılık zayıf, çünkü DB/storage/worker'ın "var mı çalışıyor mu" kontrolü platform-agnostik. |
| **B — Worker Heartbeat + Stale Lock Recovery** | §7'nin gösterdiği EN somut, EN gerçek, EN aktif risk — planlandı ama hiç uygulanmadı, ve bir worker crash'i bugün SESSİZCE bir job'ı sonsuza dek kilitler. Deployment hedefinden BAĞIMSIZ olarak uygulanabilir. |
| **C — Deployment Runbook** | Gerçek bir gap (§3: sıfır platform seçimi, sıfır Dockerfile/Compose). Ama İÇERİĞİ (§4'ün önerdiği Docker Compose + Playwright container) bu belgenin KENDİSİ zaten belirledi — "hangi platform" sorusu bu review'da CEVAPLANDI. Runbook'un YAZILMASI hâlâ ayrı bir iş ama A/B'nin özünü BLOKE ETMİYOR çünkü A/B platform-agnostik. |
| **D — CI Stable Test Profile** | Gerçek bir gap (§8: CI config yok, flakiness dokümante). Ama flakiness'in kendisi bir CORRECTNESS riski değil — iki ayrı doküman bunu "load sensitivity, not a product bug" olarak nitelendiriyor; `--maxWorkers=2` bugün İYİ ÇALIŞAN bir workaround. |
| **E — Production Smoke Script** | `smoke:providers` zaten VAR ve manuel olarak işlevsel — eksik olan otomasyon/zamanlamadır, temel yetenek değil. En düşük öncelik. |

### Kullanıcının ön-tercihinin değerlendirmesi

Kullanıcının ön-tercihi: "A+B planning together, then small
implementation of Healthcheck+Worker Heartbeat/Stale Lock Recovery
first, because queue/worker visibility and stuck-job recovery is the
riskiest area in production."

**Bu tercih bulgularla DESTEKLENİYOR, sadece rubber-stamp değil:**
- §7, B'nin hedeflediği riskin (`stale lock` + heartbeat yokluğu) bu
  belgede doğrulanan TÜM risklerin İÇİNDE en somut, en "sessiz veri
  kaybına" en yakın olanı olduğunu gösteriyor.
- C (Deployment Runbook) mantıken önce gelmeli GİBİ görünebilir ama bu
  belgenin §3/§4 analizi PLATFORM SORUSUNU zaten cevapladı (Docker
  Compose/uzun-ömürlü process PaaS, K8s değil) — C'nin "keşif" kısmı bu
  review'da bitti; geriye kalan yalnız YAZI İŞİ, ki bu A/B'yi
  ENGELLEMİYOR.
- D (test flakiness) gerçek ama daha düşük aciliyette — mevcut
  `--maxWorkers=2` workaround'u çalışıyor, iki ayrı dokümanda "ürün
  hatası değil, yük hassasiyeti" olarak doğrulandı; production'da veri
  kaybı/görünmezlik riski taşımıyor, B taşıyor.
- E zaten var olan bir aracın ötesine geçmiyor.

**NET ÖNERİ: Kullanıcının ön-tercihi doğru — B (Worker Heartbeat +
Stale Lock Recovery), A (Healthcheck derinleştirme) ile BİRLİKTE planlanıp,
küçük ve izole bir ilk implementasyon olarak uygulanmalı.** Gerekçe tek
cümlede: bu, bu belgenin doğruladığı TÜM risklerin içinde tek başına
"sessiz, tespit edilemeyen üretim arızası" senaryosuna en yakın olanı,
ve platform seçiminden (C) BAĞIMSIZ olarak bugün, herhangi bir deployment
hedefinde uygulanabilir. C/D/E sırayla sonra gelir.

**Önerilen sıralama:** B+A (bu belgenin hemen ardından, küçük scope) →
C (Deployment Runbook — bu belgenin §3/§4 kararını Dockerfile/Compose'a
döker) → D (CI stable profile) → E (smoke script otomasyonu/zamanlama).
Photoshop/PSD (`docs/photoshop-automation-plan.md`) hâlâ en düşük
öncelik, talep doğmadan gündeme alınmaz.

---

## 12. Önerilen sonraki implementation prompt'u

Aşağıdaki prompt, bu review onaylandıktan sonra "Healthcheck + Worker
Heartbeat/Stale Lock Recovery" adımını başlatacak bir sonraki konuşmaya
doğrudan verilebilir:

```
Grafista AI Studio MVP — Production Readiness Step — Healthcheck + Worker
Heartbeat/Stale Lock Recovery Implementation

Çalışma dizini: /Users/sercanbingol/Desktop/Antigravity/Projeler/Grafista-AI-Studio
Branch: phase-2-checkpoint (bu review commit'i sonrası)
Referans doküman: docs/production-readiness-review.md (bu planın §5, §7,
§11'ini uygula).

Hedef: (1) /api/health'i gerçek bağımlılık kontrollerine genişlet, (2)
render worker'a heartbeat + stale-lock recovery ekle. Yeni dış bağımlılık
YOK (Redis/BullMQ/monitoring SaaS eklenmez) — mevcut pg bağlantısı ve
render_jobs tablosu kullanılır.

Kapsam:
1. apps/api/src/app.ts'teki mevcut GET /api/health DEĞİŞTİRİLMEZ (statik
   liveness kalır) — YENİ bir GET /api/health/ready (veya /api/doctor)
   route'u eklenir: DB'ye SELECT 1, storage adapter'ına bir hafif
   erişim kontrolü, ve render worker'ın son heartbeat zaman damgasını
   (adım 3) döner. Secret/config sızdırmaz, yalnız ok/degraded + kısa
   neden döner.
2. Additive migration: render_jobs'a (veya ayrı küçük bir
   render_worker_heartbeats tablosuna — hangisi mevcut şemaya daha
   uyumluysa, karar gerekçelendirilsin) worker'ın son poll tick zamanını
   ve worker_id'sini kaydeden bir alan/tablo.
3. apps/api/src/services/render-worker.ts: her poll tick'te heartbeat
   yazan bir adım (best-effort, ana render akışını asla bloklamaz).
4. Stale lock recovery: docs/render-queue-worker-plan.md'nin planladığı
   sweep'i UYGULA — periyodik bir kontrol: started_at bir eşik süreden
   eski VE locked_by hâlâ set VE status='rendering' olan job'ları
   locked_by/locked_at=NULL, status='pending', attempt_count+1 olarak
   resetler.
5. Testler: fake worker/deterministic poll-tick yardımcı fonksiyonuyla
   (a) heartbeat'in her tick'te güncellendiği, (b) bir job'ın "takılı"
   durumdan resetlendiği, (c) reset sonrası job'ın normal akışla tekrar
   claim edilip bitirilebildiği, (d) /api/health/ready endpoint'inin
   DB/storage/worker durumuna göre doğru ok/degraded döndüğü. Mevcut
   TÜM testler KIRILMAMALI.

Kesinlikle yapılmayacaklar: Redis/BullMQ/harici monitoring SaaS'ı,
Deployment Runbook/Dockerfile yazımı (ayrı bir sonraki adım), CI config
dosyası (ayrı adım), gerçek çoklu-worker yatay-ölçek testi (bu adımın
kapsamı dışı), Photoshop/PSD.

Komutlar (hepsi geçmeden commit atma): pnpm run typecheck, pnpm run lint,
pnpm run test:stable, pnpm run build.

Commit mesajı önerisi: "production readiness: healthcheck + worker
heartbeat/stale-lock recovery"
```

---

## İlgili dokümanlar

- [`docs/phase-3-final-state.md`](./phase-3-final-state.md) §6 — bu
  belgenin var olma nedeni ve kapanış kararı.
- [`docs/render-queue-worker-plan.md`](./render-queue-worker-plan.md) —
  stale-lock sweep'in orijinal planı, bu belgenin §7/§12'sinin doğrudan
  girdisi.
- [`docs/analytics-revision-history-plan.md`](./analytics-revision-history-plan.md) —
  best-effort kayıt deseni ve secret-denylist emsali (`isDenylistedKey`),
  bu belgenin §6'sının doğrudan girdisi.
- [`docs/release-readiness.md`](./release-readiness.md) — env/servis
  checklist'i, test flakiness'in ilk kaydı.
- [`docs/security.md`](./security.md) — secrets-manager fikrinin tek
  ön-kaydı (henüz seçim değil).
- [`docs/photoshop-automation-plan.md`](./photoshop-automation-plan.md) —
  hâlâ PARKED, hâlâ en düşük öncelik.
