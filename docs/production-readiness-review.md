# Grafista AI Studio — Production Readiness Review (Phase 3 Step 7)

> **Follow-up:** §11's "C" recommendation (Deployment Runbook) has been
> written — see [`docs/deployment-runbook.md`](./deployment-runbook.md)
> for the environment profiles, first-deployment sequence, and its own
> recommended next implementation step.

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

## 13. Implementation status update (Healthcheck + Worker Heartbeat/Stale Lock Recovery)

**UYGULANDI** — §12'nin prompt'u bu güncellemeyi yazan oturumda hayata
geçirildi:

- `database/migrations/025_render_worker_heartbeats.sql` — yeni
  `render_worker_heartbeats` tablosu (worker_id PK, upsert-friendly).
- `RENDER_JOB_STALE_LOCK_MS` (varsayılan 900000ms/15dk) —
  `render-queue-env.ts`'e eklendi, `.env.example`/`docs/release-readiness.md`
  güncellendi.
- `renderJobsRepo.countByStatus()` / `getQueueSummary()` /
  `resetStaleLocks()` — global (client-scoped değil) operasyonel görünürlük
  + gerçek stale-lock sweep (`pending` eğer `attempt_count < max_attempts`,
  aksi halde terminal `failed`; her ikisinde de sabit, güvenli bir
  `error_message` notu — ham hata detayı asla yazılmaz).
- `render-worker.ts`'e `sweepStaleRenderLocks()` (deterministik, testten
  doğrudan çağrılabilir) + her poll tick'te best-effort heartbeat yazımı
  (`processNextRenderJob` içinde, tick boş geçse bile çalışır; tick'in
  kendisi patlarsa `degraded` bir heartbeat yazılıp hata yeniden fırlatılır).
- `GET /api/health` **DEĞİŞMEDİ** (byte-for-byte aynı) — `apps/api/src/routes/health.ts`'e
  taşındı, sadece dosya organizasyonu. Yeni `GET /api/health/ready`
  (auth'suz, hiçbir secret/connection-string döndürmez) — `database`,
  `storage`, `renderQueue`, `workerHeartbeat`, `providers` (presence-only),
  `playwright` (shallow — gerçek tarayıcı hiç başlatılmaz) check'leri;
  overall `status` en kötü check'e eşit.
- `GET /api/doctor` **eklenmedi** — görevin kendi talimatı gereği,
  `/health` + `/ready` kapsamı yeterli görülüp scope küçük tutuldu.
- Yeni test dosyası: `apps/api/src/__tests__/render-health-ready.test.ts`
  (15 test) — mevcut `render-queue-worker.test.ts`/`analytics-events.test.ts`/
  `revision-entries.test.ts`/`client-isolation.test.ts` dahil tüm suite
  (433 test) yeşil kaldı.

**Bilinen sınırlamalar (bilinçli, MVP kapsamı):** storage/playwright
check'leri sığ (gerçek bağlantı/tarayıcı testi değil, config/presence
kontrolü); queue-depth özeti global/tüm-client'lar arası (client-scoped
değil, kasıtlı — bu bir ops görünümü); çoklu-worker koordinasyonu hâlâ test
edilmedi (§7'nin kendi kabul ettiği sınır, bu adımın kapsamı dışı).

---

## 14. Implementation status update (Docker Compose Staging Skeleton + Staging Smoke Script — Production Step 2)

**KISMEN UYGULANDI** — §11'in dört adaydan seçtiği "Docker Compose/Staging
Deployment Skeleton + Production Smoke Script (birlikte)" sırasının somut
teslimatı. Tam tasarım kararları/kapsam için
[`docs/staging-compose.md`](./staging-compose.md) — burada yalnız KISA,
dürüst bir "ne kapandı / ne kapanmadı" notu var, o belge TEKRARLANMIYOR.

**Bu adımın gerçekten kapattığı şey:**

- Repo'da artık gerçek, statik olarak gözden geçirilmiş, ÇALIŞTIRILABİLİR
  bir Docker Compose staging iskeleti var — `apps/api/Dockerfile`
  (multi-stage: pnpm build + Node 20/Chromium runtime, non-root user),
  `docker-compose.staging.yml` (repo kökü: `postgres` + `api` servisleri,
  healthcheck'ler, in-process worker — ayrı worker container YOK, Redis/
  BullMQ YOK), `.env.staging.example`. §3'ün "repo'da hiçbir platform ipucu
  yok" bulgusu artık kısmen kapandı: platform config'i ilk kez var.
- İlk kez gerçek bir staging smoke MEKANİZMASI var —
  `apps/api/src/scripts/smoke-staging.ts` — canlı bir dağıtımın
  `/api/health` + `/api/health/ready`'sine HTTP üzerinden vurup `app`/
  `ready`/`providers`/`queue`/`demoFlow` bölümlerini PASS/WARN/SKIP/FAIL
  olarak raporluyor (`degraded`'ı asla otomatik FAIL saymadan — bu
  belgenin ve `docs/deployment-runbook.md` §8'in kendi ilkesiyle tutarlı).

**Bu adımın KAPATMADIĞI şey — abartılmıyor:**

- **Gerçek bir production deployment DEĞİL** — bu hâlâ bir STAGING
  validation iskeleti, gerçekleştirilmiş hiçbir production dağıtımı yok.
- **Hiçbir CI/CD bunu otomatik ÇALIŞTIRMIYOR** — `staging:up`/
  `smoke:staging` bugün tamamen elle tetiklenen komutlar; `.github/`
  hâlâ repo'da yok (§12'nin bulgusu değişmedi).
- **Çoklu-worker yatay ölçek koordinasyonu hâlâ test edilmedi** — bu
  skeleton tek bir `api` container'ı çalıştırıyor; "2 instance = 2 worker
  aynı tabloyu poll ediyor" senaryosu hâlâ hiçbir gerçek ortamda
  egzersiz edilmedi (§7'nin bulgusu aynen geçerli).
- **Tam authenticated bir HTTP end-to-end walkthrough YOK** —
  `smoke-staging.ts`'in `demoFlow` bölümü bunu bilinçli olarak SKIP ile
  işaretleyip `demo-flow.test.ts`'e yönlendiriyor, yeni bir HTTP test
  framework'ü inşa etmiyor.
- **Docker bu adımı yazan oturumda hiç gerçek bir Docker daemon'a karşı
  çalıştırılmadı** — sandbox'ta Docker yoktu (`docker --version` "command
  not found" döndü). Doğrulama tamamen statik (dosya/YAML syntax review) —
  gerçek bir `docker compose up` denemesi hâlâ bir insan tarafından
  yapılmalı. **GÜNCELLEME (Production Step 2B): bu artık yapıldı** — gerçek
  Docker Desktop'a karşı `staging:up` → migrate → health/ready → smoke →
  down/up reprodüksiyonu, hepsi yeşil. Bu sırada 2 gerçek bug bulunup
  düzeltildi (eksik `.dockerignore`, kullanılmayan `tsconfig` `composite`
  ayarı) ve 1 ortam sorunu kök nedeni tam bulunamadan bir workaround'la
  aşıldı (bu makinenin Docker Desktop kurulumu, `COPY`'lenen kaynak
  üzerinde `tsc`'nin 3 workspace paketi için deterministik olmayan şekilde
  sıfır çıktı üretmesine yol açıyor — `packages/*/dist`'in host'ta
  build edilip image'a taşınmasıyla aşıldı). Tam detay:
  [`docs/staging-compose.md`](./staging-compose.md)'nin "Production Step
  2B" bölümü — burada TEKRARLANMIYOR.
- **GÜNCELLEME (Production Step 3 — CI Stable Test Profile):** "Hiçbir
  CI/CD bunu otomatik ÇALIŞTIRMIYOR" bulgusu artık KISMEN kapandı —
  `pnpm run ci:stable` (typecheck/lint/build/`test:ci`, Docker/secret YOK)
  ve `pnpm run ci:staging` (→ `scripts/ci-staging.sh`: host build →
  `staging:up` → health poll → migrate → `smoke:staging`, `staging:down`
  `trap ... EXIT` ile başarı/hata farketmeksizin garanti — iki zorlanmış-hata
  testiyle doğrulandı) script'lendi. `ci:staging` gerçek Docker'a karşı her
  denemede PASS oldu. **Yeni, dürüst bulgu — abartılmıyor:** `ci:stable`'ın
  test adımı bu makinede bugün 5 tam-suite denemesinden sadece 1'inde temiz
  geçti (worker sayısı `--maxWorkers=1/2` veya `--retry` fark etmeksizin,
  her seferinde FARKLI rastgele testler, hepsi izolede PASS) — önceden
  belgelenen "yük hassasiyeti" teknik borcuyla tutarlı, bu adımın YOL AÇTIĞI
  bir regresyon değil ve bu adımın kapsamında ÇÖZÜLMEDİ (çözümü test
  izolasyon mimarisinin yeniden tasarımını gerektirir — ayrı, daha büyük bir
  iş). **Hâlâ kapanmadı:** repo'da GitHub remote'u olmadığından (`git remote
  -v` boş) bir `.github/workflows/` dosyası HENÜZ eklenmedi — drop-in-hazır
  YAML [`docs/ci-stable-profile.md`](./ci-stable-profile.md)'de duruyor;
  §12'nin ".github/ yok" bulgusu bu anlamda hâlâ teknik olarak geçerli, ama
  artık "hiç script yok" değil "script var, otomatik tetikleyici yok"
  durumu. Tam dürüst detay (hangi testler, kaç deneme):
  [`docs/ci-stable-profile.md`](./ci-stable-profile.md) — burada
  TEKRARLANMIYOR.
- **GÜNCELLEME (Production Step 4 — Test Isolation & Stable CI Reliability
  Hardening):** Step 3'ün flakiness bulgusu 4 paralel ajanla araştırıldı;
  **gerçek, doğrulanmış bir kök neden bulunup düzeltildi**:
  `apps/api/src/db/pool.ts`'in module-level `pg.Pool` singleton'ı hiçbir test
  dosyasında kapatılmıyordu — Vitest'in `isolate:true` varsayımıyla her dosya
  kendi pool'unu yaratıp aynı (paylaşılan) worker process'inde terk ediyor,
  bağlantılar paylaşılan tek embedded Postgres'e karşı birikip rastgele bir
  anda tükeniyordu. Fix: `vitest.config.ts`'e `setupFiles` ile her dosya
  sonunda otomatik `closePool()` + `pool.ts`'e `connectionTimeoutMillis` +
  `GET /api/clients`'teki gerçek bir N+1 anti-pattern'in (`Promise.all` ile
  client başına ayrı sorgu) tek batch sorguya çevrilmesi. **`pg_stat_activity`
  ile canlı izlenerek doğrulandı** — bağlantı sayısı bir tam koşu boyunca
  sabit kaldı (önceden büyüyordü varsayımı artık gözlemle kanıtlandı).
  **Dürüst sonuç — abartılmıyor:** bu düzeltme genel flakiness oranını
  ÖLÇÜLEBİLİR şekilde iyileştirmedi (fix sonrası 6 tam-suite denemeden yine
  sadece 1'i temiz) — en az bir farklı, henüz kök nedeni bulunamamış katkı
  faktörü daha var: en az 2 denemede meşru bir POST endpoint'i (`design-dna/
  approve`, `uploadReference`) beklenmedik bir **405 Method Not Allowed**
  döndürdü; bu, düzeltilen pool-leak mekanizmasıyla açıklanamıyor (bir
  denemede bağlantı sayısının sabit kaldığı DOĞRULANMIŞKEN bile 405 oluştu),
  ve `error-handler.ts`/`express`/`multer`/`pg` kaynak kodunda hiçbir yerde
  405 set edilmiyor — kaynağı bu adımın kapsamında bulunamadı. **`ci:stable`
  hâlâ tam güvenilir bir merge gate değil.** Tam dürüst detay:
  [`docs/ci-stable-profile.md`](./ci-stable-profile.md)'nin "Production Step
  4" bölümü — burada TEKRARLANMIYOR.
- **GÜNCELLEME (Production Step 5 — 405 flake'i kök nedeni bulundu, uygulama
  hatası DEĞİL):** Step 4'ün açıklayamadığı 405 (ve devamında gözlenen
  403/404/"socket hang up" varyantları) bu adımda **canlı kanıtla kök
  nedenine ulaştırıldı**: `apps/api/src/app.ts`'e en başa `CI_DEBUG_ROUTES=1`
  ile açılan, varsayılan kapalı bir teşhis middleware'i eklendi
  (`apps/api/src/middleware/debug-routes.ts`) — her gerçek isteği/yanıtı
  loglar. Bir tam-suite koşusunda, hatalı 405/403 alan `POST /api/auth/login`
  çağrılarının bu logda **HİÇ karşılığı yoktu** (aynı koşudaki diğer 1039
  login çağrısının tamamı loglandı, hepsi 200/401) — yani hatalı yanıt hiç bu
  uygulamanın Express pipeline'ına uğramamış. Küçük, izole bir stres
  script'iyle (800 tekrar, ~170 saniyede reprodüksiyon; sonradan silindi,
  repoya eklenmedi) yakalanan hatalı yanıtın tam header/body içeriği —
  `text/plain`, gövde `"404 page not found"`, `X-Content-Type-Options:
  nosniff` ama `Content-Security-Policy` YOK — Express'in kendi 404
  fallback'ının (`finalhandler`, her zaman HTML + CSP header) DEĞİL,
  **Go'nun standart kütüphanesinin `net/http.Error()` imzasının** birebir
  eşleşmesi. Kök neden: bu makinede `lsof` ile doğrulandı — Antigravity
  IDE'nin arka plan `language_server_macos_arm` process'i (Go tabanlı),
  `sysctl net.inet.ip.portrange`'in aynı efemer port aralığında (49152–65535)
  birkaç port dinliyor; `supertest`'in her çağrıda (~2000 kez/koşu) yeni bir
  efemer `http.Server` açıp kapatması bu paylaşılan port havuzuyla nadiren
  çakışıyor ve istemcinin isteği bazen bizim Express sunucumuz yerine bu
  ilgisiz IDE process'i tarafından yanıtlanıyor. **Bu bir uygulama/test kodu
  hatası değil** — dört farklı, ilgisiz endpoint'te (`design-dna/approve`,
  `uploadReference`, `auth/login` iki kez, `content-ideas`) aynı imzayla
  gözlendi, tamamen transport-katmanı rastlantısıyla tutarlı. **Kalıcı düzeltme
  kapsam dışı bırakıldı**: doğru çözüm (`supertest`'e her dosya/koşu için TEK
  bir zaten-dinleyen server vermek, ~2000 efemer bind'i ~26'ya indirmek) 26
  test dosyasının hemen hepsindeki çağrı noktalarını değiştirmeyi gerektiriyor
  — bu adımın "test izolasyon mimarisinde büyük refactor yok" sınırını aşıyor.
  `CI_DEBUG_ROUTES` teşhis aracı kalıcı olarak repoda bırakıldı (varsayılan
  kapalı, sıfır maliyetli). **`ci:stable` hâlâ tam güvenilir bir merge gate
  değil** — ama artık NEDEN olmadığı kanıtlı ve belgeli. Tam dürüst detay:
  [`docs/ci-stable-profile.md`](./ci-stable-profile.md)'nin "Production Step
  5" bölümü — burada TEKRARLANMIYOR.
- **GÜNCELLEME (Production Step 6 — 405 flake'i azaltıldı, TAMAMEN
  giderilmedi):** Step 5'in tespit ettiği ama kapsam dışı bıraktığı kalıcı
  çözüm bu adımda uygulandı: `apps/api/src/test/http-test-server.ts` adında
  küçük bir yardımcı eklendi (`startTestServer(app)` → `app.listen(0)`'ı
  SADECE BİR KEZ çağırıp zaten-dinleyen bir `http.Server` döndürür).
  `supertest`'in kendi kaynak kodu doğrulandı: `Test.serverAddress()` sadece
  bare bir fonksiyona (`app.address()` hâlâ null olduğunda) kendi
  `.listen(0)`'ını çağırıyor — zaten dinleyen bir server verilirse onu tekrar
  kullanıyor ve `end()`'in otomatik kapama mantığını da atlıyor. `supertest`
  import eden 17 test dosyasının HEPSİNDE (`analytics-events`, `auth`,
  `client-isolation`, `creative-qa`, `demo-flow`, `design-dna`,
  `layout-plans`, `production-jobs`, `render-health-ready`, `render-jobs`,
  `render-queue-worker`, `revision-entries`, `routes`, `stability`,
  `storage`, `visual-generation`, `workflows`) `request(app)`/
  `request.agent(app)` çağrıları `request(testServer.server)`/
  `request.agent(testServer.server)` olarak mekanik biçimde değiştirildi; her
  dosya `app`'i aldıktan hemen sonra TEK bir server açıp `afterAll`'da
  kapatıyor. Bu, Step 5'in bulduğu ~2000 efemer bind/kapatma döngüsünü
  ~17'ye indiriyor. **Doğrulama:** 17 dosyanın her biri dönüştürüldükten
  hemen sonra tek başına çalıştırıldı (hepsi ilk denemede geçti);
  `pnpm typecheck`/`pnpm lint`/`pnpm build` temiz; `pnpm run test:ci` (433
  test, 26 dosya) toplam **7 kez** çalıştırıldı (agent tarafından 4 kez —
  3 bağımsız + `ci:stable` zinciri içinde 1 kez — ve orkestratör oturum
  tarafından bağımsız olarak 3 kez daha, çünkü 4 temiz koşu tek başına
  yetersiz bir örneklem gibi geldi). **Sonuç: 7 denemeden 6'sı temiz
  433/433, 1'i başarısız** — orkestratörün 5. bağımsız koşusunda
  `production-jobs.test.ts`'in login helper'ında yine bir 405 görüldü (aynı
  dosyada 22 teste yayıldı, hepsi login'e bağımlı); dosya hemen ardından
  tek başına 23/23 temiz geçti — Step 3'ten beri belgelenen "sadece tam
  suite yükü altında nadiren, izole hep temiz" deseniyle birebir tutarlı.
  `CI_DEBUG_ROUTES` ile bu belirtiyi yeniden yakalamaya çalışan 2 ek koşu
  ikisi de temiz geldi — yani bu spesifik tekrarın log imzası bağımsız
  olarak yeniden doğrulanamadı, sadece belirti eşleşmesiyle Step 5'in aynı
  dış-çakışma sınıfına ait olduğu varsayıldı. **Dürüst sonuç: bu, tek bir
  geliştirici makinesinde bir oturumda ~%86 (6/7) temiz oran — Step 3-5'in
  ~1'de-3-ila-6 (~%17-33) oranına göre gerçek ve ölçülebilir bir iyileşme,
  ama SIFIR flakiness DEĞİL.** Flake bu adımın kendi doğrulaması sırasında
  bir kez daha tekrarlandığından, `ci:stable` "aday bir merge gate" olarak
  bile abartılı olur — daha doğru tanım: **iyileştirilmiş ama hâlâ
  deterministik olmayan bir gate**. `CI_DEBUG_ROUTES` teşhis aracı hiç
  değiştirilmedi. Tam dürüst detay: [`docs/ci-stable-profile.md`](./ci-stable-profile.md)'nin
  "Production Step 6" bölümü — burada TEKRARLANMIYOR.
- **GÜNCELLEME (Production Step 2C — reprodüksiyon doğrulaması):** Step
  2B'nin workaround'ı gerçek Docker'a karşı iki senaryoda test edildi: (A)
  mevcut repo'da `staging:down` → `staging:up`, hiç `--no-cache`/restart
  olmadan — PASS; (B) tamamen temiz bir `git clone`'da, belgelenmiş "clone →
  `pnpm install` → host'ta `pnpm run build` → `staging:up`" akışıyla — PASS.
  İkisi de `smoke:staging`'de `2 pass, 2 warn, 1 skip, 0 fail` verdi ve
  `--no-cache`/Docker Desktop restart hiçbir senaryoda gerekmedi. **Risk
  seviyesi düşürüldü:** "`docker compose build` bare bir clone'dan
  reprodüksiyonlu değil" riski artık bir hard blocker DEĞİL — "belgelenmiş,
  script'lenebilir tek-ek-adımlı bir host-build-first akışıyla
  reprodüksiyonlu, CI Step 3 için kabul edilebilir" olarak yeniden
  sınıflandırılıyor, ANCAK şu şartla: CI pipeline'ı Docker build'den ÖNCE bu
  host build adımını (`pnpm run build` veya en az `pnpm --filter
  "@grafista/{schemas,model-router,prompt-engine}" run build`) içermeli —
  aksi halde aynı boşluğa düşer. Step 2B'nin altta yatan Docker Desktop
  overlayfs/containerd-snapshotter sorunu KÖK NEDENİ HÂLÂ BULUNMADI ve
  workaround HÂLÂ YÜRÜRLÜKTE (kaldırılmadı) — Step 2C bunu yeniden
  tetiklemeye çalışmadı, sadece mevcut workaround'ın kendisinin
  reprodüksiyonlu olduğunu doğruladı. Tam detay:
  [`docs/staging-compose.md`](./staging-compose.md)'nin "Production Step
  2C" bölümü — burada TEKRARLANMIYOR.

## 15. Implementation status update (CI Runner Readiness & Remote Validation Package — Production Step 7)

**UYGULANDI (dokümantasyon + dormant workflow dosyası, yeni product feature
YOK)** — [`docs/ci-stable-profile.md`](./ci-stable-profile.md)'nin "Production
Step 7" bölümünün tam teslimatı; tasarım kararları ve tam gerekçe orada,
burada yalnız bu belgenin kendi kapsamına (production readiness durumu, gate)
düşen kısım özetleniyor.

**Bu adımın gerçekten kapattığı şey:**

- Repo'da artık gerçek, statik olarak YAML-syntax-doğrulanmış bir
  `.github/workflows/stable-ci.yml` var — §12/§14'ün tekrar tekrar doğruladığı
  "`.github/` yok" bulgusu artık tam olarak kapandı, dosya şu an mevcut.
  **Ama bu dosya bugün DORMANT** — repo'da hâlâ `git remote` yok
  (`git remote -v` bu adımın başında yeniden kontrol edildi, boş), yani bu
  workflow hiçbir gerçek GitHub Actions runner'ında HENÜZ ÇALIŞMADI.
- İlk kez yazılı, somut bir **Remote Runner Validation Protocol** var
  (`docs/ci-stable-profile.md`) — bir remote eklendiğinde `ci:stable`'ın kaç
  kez, hangi kritere göre "candidate merge gate" sayılabileceğini (5/5 temiz)
  ve temiz olmayan bir sonucun nasıl üç ayrı belirtiye (gerçek regresyon /
  bilinen dış-çakışma / başka) sınıflandırılacağını PLANLIYOR — henüz
  UYGULANMADI, çünkü uygulanacak bir remote yok.
- `docs/deployment-runbook.md`'ye "GitHub remote eklendikten sonra ilk CI
  doğrulama adımları" bölümü eklendi (§5) — placeholder repo/URL ile, gerçek
  bir remote uydurulmadan.

**Bu adımın KAPATMADIĞI şey — abartılmıyor:**

- **Gerçek bir remote CI doğrulaması SIFIR kez yapıldı.** Protokolün
  gerektirdiği 5 remote çalıştırmadan 0'ı gerçekleşti — bu belge veya
  `docs/ci-stable-profile.md` bunun tersini iddia etmiyor.
- **`ci:stable`'ın test adımının flakiness'i hâlâ çözülmedi, hâlâ Step 6'nın
  bulduğu ~6/7 (~%86) yerel oranda** — bu adım flake'i kovalamadı, kasıtlı
  olarak (görevin kendi kapsam sınırı: "flake'i lokal makinede sonsuza kadar
  kovalamak değil"). Bu adımın kendi doğrulaması sırasında çalıştırılan
  `pnpm run ci:stable`'ın sonucu bu belgenin altına dürüstçe kaydedildi (bkz.
  bu bölümün "Bu adımın kendi doğrulaması" alt-başlığı).
- **Production/deploy blokajı DEVAM EDİYOR, netleştirildi:** bu belge ve
  `docs/ci-stable-profile.md`'nin ikisi de artık açıkça şu net kapıyı
  taşıyor: **remote CI doğrulaması (yukarıdaki protokol, en az 5 çalıştırma)
  tamamlanmadan production deploy'a geçilmez.** Bu, §11'in daha önce verdiği
  "B+A → C → D → E" sıralamasını değiştirmiyor — yalnız D maddesinin (CI
  stable profile) ne zaman "bitti" sayılabileceğine dair daha önce belirsiz
  olan eşiği netleştiriyor.

**Bu adımın kendi doğrulaması (dürüstçe kaydedilmiş, gerçek sayılarla):**

`pnpm run typecheck` PASS, `pnpm run lint` PASS (yalnız iki pre-existing
React Hook `exhaustive-deps` uyarısı, hata değil), `pnpm run build` PASS —
üçü de bu adımda hiç değişiklik göstermedi (Steps 3-6'nın "bu üçü hep temiz"
bulgusuyla tutarlı). `pnpm run ci:stable` bu adımda **iki kez** tam olarak
çalıştırıldı — biri değişikliklerden ÖNCE (baseline), biri dokümantasyon/
workflow dosyası değişikliklerinden SONRA (bu adım hiçbir kaynak/test kodu
değiştirmediği için ikisinin de aynı sonucu vermesi beklenirdi): **ikisi de
433/433 temiz geçti (2/2 bu oturumda).** Bu, Step 6'nın yerel ~6/7 (~%86)
bulgusuyla ÇELİŞMİYOR — küçük bir örneklemde (2 deneme) hem tamamen temiz hem
de kısmen flake sonucu görmek istatistiksel olarak beklenen bir varyans;
**bu 2/2 sonucu flakiness'in ortadan kalktığı anlamına GELMEZ** ve böyle
sunulmuyor — Step 6'nın 6/7'lik daha büyük örneklemi hâlâ bu makinedeki daha
güvenilir yerel tahmin, ve her ikisi de zaten yukarıda netleştirilen tek
gerçek standardın (remote runner'da 5/5) yerine geçmiyor.

## 16. Implementation status update (GitHub Remote Setup & First Runner Validation — Production Step 8)

**UYGULANDI — remote CI doğrulaması gerçekten yapıldı, §15'in bıraktığı
"SIFIR kez yapıldı" boşluğu kapandı.** Tam gerekçe/kanıt
[`docs/ci-stable-profile.md`](./ci-stable-profile.md)'nin "Production Step
8" bölümünde — burada yalnız bu belgenin kapsamına (production gate durumu)
düşen özet var.

**Bu adımın gerçekten kapattığı şey:**

- Kullanıcıdan GitHub repo URL'si istendi, `git remote add origin` ve `git
  push` HER İKİSİ İÇİN AYRI AYRI açık onay alındıktan sonra yapıldı — hiçbir
  geri alınamaz işlem onaysız gerçekleştirilmedi.
- İlk gerçek remote çalıştırma anında (`ci:stable` sırası hatası) ve
  ardından iki adım daha (`.env.staging` eksikliği, sonra `apps/api`
  Dockerfile'ının amd64'te sessizce dist/ üretmemesi) olmak üzere **3 gerçek,
  %100 deterministik bug bulundu ve düzeltildi** — hiçbiri Steps 3-6'nın
  belgelediği efemer-port flake'i DEĞİL. Her biri kanıtla kök nedenine
  ulaştırıldı (tahmin değil) ve yalnız kullanıcı onayı alındıktan sonra
  düzeltildi (bu adımın kendi "config değişikliği onaysız yapılmaz" kuralı
  tutarlı şekilde uygulandı — 4 ayrı onay noktası: fix #1, fix #2, fix #3,
  workflow_dispatch eklentisi).
- **Remote Runner Validation Protocol SONUCU: `stable` job 8/8 temiz
  (gerekli 5'i fazlasıyla aşıyor), `staging-smoke` job kendi son düzeltmesi
  sonrası 5/5 temiz.** Tam çalıştırma tablosu
  `docs/ci-stable-profile.md`'nin "Production Step 8" bölümünde — burada
  TEKRARLANMIYOR. **Efemer-port flake'i (Steps 3-6) 8 gerçek çalıştırma
  boyunca BİR KEZ BİLE tekrarlanmadı** — Step 5'in "çakışma kaynağı bu
  geliştiricinin kendi makinesine özgü" hipotezini destekleyen güçlü, dolaylı
  bir kanıt.

**Production gate — yeniden sınıflandırıldı, dürüstçe:**

`docs/ci-stable-profile.md`'nin (Production Step 7'den beri taşıdığı) "remote
CI doğrulaması (en az 5 çalıştırma) tamamlanmadan production deploy'a
geçilmez" kapısı **artık KARŞILANDI** — hem `stable` hem `staging-smoke`
candidate merge gate sayılabilir durumda. **Ama bu, projenin production'a
HAZIR olduğu anlamına GELMEZ** — yalnızca bu belgenin §11'de tanımladığı beş
adaydan D maddesinin (CI Stable Test Profile) kendi dar kapsamlı kapısının
kapandığı anlamına gelir. Hâlâ açık kalan, bu belgenin önceki bölümlerinin
doğruladığı gerçek production-readiness boşlukları (bu adımın kapsamı DIŞI,
DEĞİŞTİRİLMEDİ):

- §7'nin doğruladığı worker heartbeat/stale-lock riskleri — B+A adımıyla
  ZATEN kapatılmıştı (bkz. §13 implementation notu), bu adımla ilgisi yok.
- §9'un backup/restore boşluğu (storage artifact backup'ı, özellikle `local`
  modda) — hâlâ kapatılmadı.
- §7'nin çoklu-worker yatay ölçek koordinasyonu — hâlâ test edilmedi.
- Gerçek production ortamına HİÇ deploy yapılmadı — bu adım yalnız CI
  runner'ı doğruladı, bir production ortamını değil. `RENDERER_PROVIDER=fake`/
  `AI_DEFAULT_PROVIDER=fake`/`STORAGE_PROVIDER=local` fake-provider disposable
  bir CI/staging stack'i doğruluyor, gerçek bir müşteri ortamını değil.

**Sonraki mantıklı adım, bu belgenin kendi §13'ünün sıralamasıyla tutarlı:**
CI/remote doğrulama artık bitti (D maddesi kapandı); sırada production'a
GERÇEKTEN çıkmadan önce kapatılması gereken somut boşluklar var — özellikle
backup/restore prosedürü (bugün hâlâ hiçbir yerde yazılı değil) ve managed
Postgres/S3 seçimi gibi gerçek altyapı kararları. Bu belge bunları YENİDEN
ÖNCELİKLENDİRMİYOR, yalnız hangisinin hâlâ açık olduğunu netleştiriyor.

## 17. Implementation status update (Backup/Restore Prosedürü & Managed Storage Kararı — Production Step 9)

**§16'nın bıraktığı iki açık kalemden biri (backup/restore) artık
DOKÜMANTE — otomatize/uygulanmış değil.** Tam gerekçe/prosedür
[`docs/backup-restore-runbook.md`](./backup-restore-runbook.md)'de — burada
yalnızca bu belgenin production-gate sınıflandırmasına düşen özet var.

**Bu adımın gerçekten kapattığı şey:**

- **Persistence envanteri çıkarıldı:** hangi Postgres tablosu/object
  storage prefix'i kalıcı (yedeklenmesi ZORUNLU) — kullanıcı-kaynaklı
  yüklemeler (`brand-assets/`, `design-references/`) ve AI-üretilmiş
  görseller (`generated-outputs/`) — hangisi güvenle regenerable/cache
  (render export'ları, `render-jobs/*/exports/*`, render pipeline'ı
  yeniden çalıştırarak reprodüklenebilir). Kod incelemesiyle doğrulandı:
  hiçbir tabloda `BYTEA`/binary kolon yok, tüm dosya baytları
  Postgres dışında object storage'da.
- **Managed Postgres/S3 için karar KRİTERLERİ hazırlandı** (sağlayıcı
  SEÇİLMEDİ — bu, gerçek bir hesap/altyapı provizyonu, bu adımın kapsamı
  dışı): `STORAGE_PROVIDER=s3` soyutlamasının zaten sıfır kod
  değişikliğiyle her S3-uyumlu sağlayıcıyla çalıştığı (bu belgenin §4'ünün
  iddiası) kod okumasıyla YENİDEN doğrulandı; `local` modun production'da
  hiç kullanılmaması gerektiği netleştirildi.
- **Backup policy + RPO/RTO hedefleri yazıldı** — günlük otomatik
  snapshot + haftalık bağımsız logical dump, versioning + lifecycle
  policy (yalnız cache tier'da), somut RPO/RTO tablosu.
- **Restore prosedürü + staging restore drill adım adım yazıldı** —
  Postgres (`pg_restore`) ve object storage (versiyon geri getirme / bucket
  senkronizasyonu) için placeholder komutlar, verification/rollback
  checklist'leri.
- **`docs/deployment-runbook.md` güncellendi:** §5'e "4b" backup+restore-drill
  doğrulama adımı (production öncesi zorunlu gate), §6/§11'e bu yeni
  runbook'a referanslar eklendi.
- **`docs/ci-stable-profile.md` güncellendi:** CI candidate-merge-gate
  durumunun bu backup/restore gate'inden AYRI bir şey olduğu netleştirildi
  — biri karışmasın diye.

**Kapatılmadı (bilinçli, dürüstçe restate):**

- Hiçbir otomasyon eklenmedi — backup/restore hâlâ tamamen manuel bir
  prosedür, bir script/cron değil.
- Staging restore drill **gerçekten çalıştırılmadı** — yalnızca nasıl
  çalıştırılacağı yazıldı (`docs/backup-restore-runbook.md` §7). İlk
  gerçek koşum aynı zamanda bu prosedürün ilk doğrulaması olacak.
- Managed Postgres/S3 sağlayıcısı seçilip provizyonlanmadı — yalnızca
  seçim kriterleri hazır.
- §16'nın listelediği diğer açık kalem (çoklu-worker yatay ölçek
  koordinasyonu) bu adımın kapsamı DIŞI, değişmedi.
- Hiçbir production deploy yapılmadı — bu adım yalnız veri-güvenliği
  prosedürünü hazırladı, bir production ortamını değil.

**Bu adımın kendi doğrulaması:** `pnpm run typecheck`/`lint`/`build`/
`ci:stable`/`ci:staging` bu adımda (dokümantasyon + `.env.example` yorum
değişikliği sonrası) tekrar çalıştırıldı, hepsi PASS — kod değişikliği
olmadığı için beklenen sonuç, ama gerçekten koşuldu, varsayılmadı.

**Sonraki mantıklı adım:** backup/restore prosedürü artık yazılı olduğu
için, gerçek production deploy'a geçmeden önceki en somut kalan iş bu
prosedürün staging'de en az bir kez GERÇEKTEN çalıştırılıp doğrulanması
(`docs/backup-restore-runbook.md` §7) — bu, bir sonraki implementation
adayı için doğal bir aday, ama bu belge bunu yeniden önceliklendirmiyor.

## 18. Implementation status update (Staging Restore Drill Executed — Production Step 10)

**§17'nin bıraktığı "prosedür yazıldı ama egzersiz edilmedi" boşluğu
artık KAPANDI — staging'de, sentetik veriyle, gerçekten çalıştırıldı ve
PASS ile sonuçlandı.** Tam sonuç, aşama-aşama tablo ve gerçek bir bug
bulgusu [`docs/backup-restore-runbook.md`](./backup-restore-runbook.md)
§12'de — burada yalnızca bu belgenin production-gate sınıflandırmasına
düşen özet var.

**Bu adımın gerçekten kapattığı şey:**

- Yeni `scripts/restore-drill-staging.sh` — §17'nin "otomasyon yok,
  tamamen manuel" notunu kısmen kapattı: prosedür artık TEK bir
  script'le tekrarlanabilir, güvenlik guard'lı (NODE_ENV/DATABASE_URL
  kontrolü, yalnız disposable staging compose'a karşı çalışır),
  aşama-aşama loglu (setup/seed/backup/reset/restore/verify/cleanup).
  **Bu bir CRON/zamanlanmış otomasyon DEĞİL** — hâlâ elle tetiklenmesi
  gerekiyor, ama "sıfırdan icat etmek" gerekmiyor artık.
- Drill, Postgres restore'unu (`pg_dump`/`pg_restore`, checksum'lı
  `schema_migrations` doğrulaması) VE object-storage restore'unu
  (manuel host-side kopya + sha256 checksum eşleşmesi) AYRI AYRI
  kanıtladı — "komut exit 0 döndü" değil, gerçek bir bayt-seviyesi
  karşılaştırmayla.
- **Gerçek bir bug bulundu ve düzeltildi bu adımda:** script'in ilk
  denemesi, `psql -t -A`'nın bir `INSERT ... RETURNING id` komutunun
  tamamlanma etiketini bastırmadığını ortaya çıkardı (dönen UUID ile
  birleşip geçersiz veri üretti) — `WITH ... SELECT` CTE'sine sarılarak
  düzeltildi. Bu tam olarak bu adımın amacı: yazılı bir prosedürün
  yalnızca "mantıklı görünmesi" ile "gerçekten çalışması" arasındaki
  farkı somut olarak kanıtladı.
- **Yeni, dürüst bir gözlem (ve kendi kendini düzelten bir bulgu):**
  `workerHeartbeat` check'i bazen geçici `degraded` görünüyor. İlk
  hipotez ("restore edilen eski heartbeat satırı") bu adımın kendi
  FİNAL doğrulama koşumunda (restore İÇERMEYEN, sıradan bir
  `ci:staging`) AYNI durumun tekrar gözlenmesiyle ÇÜRÜTÜLDÜ — muhtemelen
  restore'a özgü değil, `smoke:staging`'in worker'ın ilk heartbeat
  tick'iyle yarıştığı genel bir zamanlama duyarlılığı (tam kök neden
  bağımsız doğrulanmadı, bkz. `docs/backup-restore-runbook.md` §12'nin
  tam yazımı). Blocker değil (§8 doktrini), ama restore sonrası VEYA
  sıradan bir bring-up sonrası "anında her şey yeşil" beklentisine karşı
  dokümante edildi (`docs/backup-restore-runbook.md` §12).

**Kapatılmadı (bilinçli, dürüstçe restate):**

- **Gerçek production verisi/managed Postgres/S3 hâlâ hiç kullanılmadı**
  — bu drill tamamen sentetik staging verisiyle, local Docker'da
  çalıştı. Managed bir sağlayıcıya karşı bir restore hâlâ hiç
  denenmedi.
- **Otomasyon hâlâ elle tetikleniyor** — bir cron/zamanlanmış görev
  DEĞİL, tek seferlik bir script.
- **Tek bir sentetik satır/obje test edildi** — ölçek (yüzlerce/binlerce
  satır) altında restore süresi/davranışı hâlâ bilinmiyor.
- §16'nın listelediği diğer açık kalemler (çoklu-worker yatay ölçek
  koordinasyonu, managed Postgres/S3 seçimi) bu adımın kapsamı DIŞI,
  değişmedi.
- Hiçbir production deploy yapılmadı.

**Bu adımın kendi doğrulaması:** `pnpm run typecheck`/`lint`/`build`/
`ci:stable`/`ci:staging` bu adımda (script + dokümantasyon değişikliği
sonrası) tekrar çalıştırıldı, hepsi PASS. `bash -n
scripts/restore-drill-staging.sh` temiz. Script'in kendisi de GERÇEKTEN
çalıştırıldı (yalnız sözdizimi kontrolü değil) — ilk deneme başarısız
oldu (yukarıdaki bug), düzeltme sonrası ikinci deneme tam PASS.

**Production gate — yeniden sınıflandırıldı, dürüstçe:** Backup/restore
prosedürü artık hem YAZILI hem de staging'de EGZERSİZ EDİLMİŞ durumda.
**Ama bu, projenin production'a HAZIR olduğu anlamına GELMEZ** — managed
Postgres/S3 kararı hâlâ verilmedi, gerçek production verisiyle hiç
denenmedi, ve otomasyon hâlâ elle tetikleniyor. Production deploy'a
geçmeden önceki somut gate listesi netleştirildi:
[`docs/deployment-runbook.md`](./deployment-runbook.md)'ün yeni
"Production öncesi zorunlu gate'ler" bölümüne bkz.

## 19. Implementation status update (Managed Infrastructure Plan — Production Step 11)

**§18'in bıraktığı son açık kalemlerden biri (managed Postgres/S3 kararı)
artık bir KARAR PAKETİNE sahip — sağlayıcı hâlâ SEÇİLMEDİ, hiçbir şey
PROVİZYONLANMADI.** Tam içerik
[`docs/managed-infrastructure-plan.md`](./managed-infrastructure-plan.md)'de
(yeni doküman) — burada yalnızca bu belgenin production-gate
sınıflandırmasına düşen özet var.

**Bu adımın gerçekten kapattığı şey:**

- **Infrastructure envanteri çıkarıldı** — API runtime, dashboard runtime,
  managed Postgres, S3-uyumlu storage, queue/worker (AYRI bir servis
  DEĞİL, §2'nin zaten doğruladığı gibi), Docker registry, domain/DNS,
  SSL/TLS, secrets management, logs/monitoring, backup automation — her
  biri için kodun bugün NE beklediği doğrudan kaynak/config
  referanslarıyla dokümante edildi.
- **Provider karar matrisi hazırlandı** (7 kategori: managed Postgres,
  S3-uyumlu storage, app hosting/runtime, background worker hosting,
  logs/monitoring, secrets management, backup automation) — her biri için
  minimum gereksinim, önerilen kriter, aranacak özellikler, riskler, kabul
  kriterleri. **Hiçbir güncel fiyat iddiası yok, hiçbir sağlayıcı
  SEÇİLMEDİ** — her kategoride "decision required" olarak işaretlendi.
  Güçlü bir yön önerisi var (küçük ekip/MVP için en az operasyon yükü,
  local disk production'da KULLANILMAZ, Postgres PITR+snapshot ve object
  storage versioning ZORUNLU gate) — ama bu bir sağlayıcı ismi değil, bir
  kriter seti.
- **Env/secrets matrisi hazırlandı** — `.env.example`/`apps/api/src/config/env.ts`
  ile çapraz doğrulanmış, hangi değişkenin required/optional/local-only
  olduğu netleştirildi. Görev tanımının istediği "PUBLIC_APP_URL"/
  "API_BASE_URL" kavramlarının bu repo'daki GERÇEK karşılığının
  `NEXT_PUBLIC_API_URL`/`API_CORS_ORIGIN` olduğu, ve `NODE_ENV`/`LOG_LEVEL`'in
  `.env.example`'da var olduğu ama repo kodunun hiçbir yerinde
  OKUNMADIĞI (grep ile doğrulandı, sıfır sonuç) dürüstçe not edildi —
  icat edilmiş bir env değişkeni YOK.
- **`docs/deployment-runbook.md`'ye §17 "Production Infrastructure
  Provisioning Gate" eklendi** — somut, placeholder'lı, komut-seviyeli bir
  checklist (Managed Postgres/S3 provizyonu, PITR/versioning, secret
  girişi, domain/DNS/SSL, backup automation, managed-altyapı restore
  drill) — **hiçbir maddesi işaretlenmedi**.
- **`docs/backup-restore-runbook.md`'ye §13 "Managed Infrastructure
  Requirements" eklendi** — §12'nin local/staging drill'i ile managed
  altyapıya karşı yapılacak EK drill arasındaki farkın net tarifi, ve net
  bir gate: "managed sağlayıcı seçilmeden VE restore drill managed
  altyapıda tekrar edilmeden production deploy YOK."

**Kapatılmadı (bilinçli, dürüstçe restate — bu adımın kendi başarı
kriteri budur, provider hesabı açmak DEĞİL):**

- Hiçbir gerçek provider hesabı/projesi açılmadı.
- Hiçbir gerçek servis (Postgres/S3/hosting/secrets/monitoring)
  provizyonlanmadı.
- Hiçbir gerçek secret değeri yazılmadı — bu belge ve güncellenen üç
  doküman yalnızca isim + amaç içeriyor.
- Managed altyapıya karşı bir restore drill hâlâ hiç yapılmadı
  (`docs/backup-restore-runbook.md` §13c hâlâ boş).
- §16'nın listelediği diğer açık kalem (çoklu-worker yatay ölçek
  koordinasyonu) bu adımın kapsamı DIŞI, değişmedi.
- Hiçbir production deploy yapılmadı, hiçbir yeni ürün özelliği
  eklenmedi, hiçbir migration eklenmedi.

**Bu adımın kendi doğrulaması:** `pnpm run ci:stable` bu adımda
dokümantasyon-öncesi bir baseline olarak çalıştırıldı — `build`/
`typecheck`/`lint` temiz, `test:ci` **433/433 temiz (26/26 dosya, tek
denemede)**. `pnpm run ci:staging` da bu adımda çalıştırıldı — **PASS**:
`staging:up` sonrası her iki container (`postgres`/`api`) healthy oldu,
migration'lar container içinde temiz uygulandı, `smoke:staging` **2 pass,
2 warn, 1 skip, 0 fail** verdi (`ready` WARN yalnız `providers` check'inin
`degraded` olmasından — `KIE_AI_API_KEY` staging'de bilinçli olarak boş,
`.env.staging.example`'ın fake-provider demo modu; `database`/`storage`/
`renderQueue`/`workerHeartbeat`/`playwright` hepsi `ok`; `demoFlow` her
zamanki gibi SKIP, `docs/ci-stable-profile.md`'nin zaten belgelediği
tasarım gereği), `staging:down` temiz teardown yaptı. `bash -n
scripts/restore-drill-staging.sh` temiz (önceki adımlardan beri
değişmedi, bu adımda script'e dokunulmadı).

**Production gate — DEVAM EDEN durum, dürüstçe:** kod-doğruluğu gate'i
(`ci:stable`/`ci:staging`, Production Step 8) ve veri-güvenliği
prosedürü/staging-mekanik gate'i (backup/restore, Production Step 9/10)
her ikisi de tamamlandı. **Managed altyapı kararı/provizyonu hâlâ
"planned, not provisioned"** — bu adım o kararın NASIL verileceğini
netleştirdi, kararın kendisini vermedi. **Production deploy hâlâ
BLOKEDE** — `docs/deployment-runbook.md` §17'nin checklist'inin TAMAMI
işaretlenmeden, ve managed altyapıya karşı bir restore drill PASS
almadan (`docs/backup-restore-runbook.md` §13) bu blokaj kalkmaz.

## 20. Implementation status update (Option A Selection & Staging Deployment Preparation — Production Step 12)

**§19'un bıraktığı "hangi ops yönü" sorusu artık CEVAPLANDI — somut
sağlayıcı hâlâ SEÇİLMEDİ.** Tam içerik
[`docs/managed-infrastructure-plan.md`](./managed-infrastructure-plan.md)
§7/§8'de ve [`docs/deployment-runbook.md`](./deployment-runbook.md) §18'de
— burada yalnızca bu belgenin production-gate sınıflandırmasına düşen
özet var.

**Bu adımın gerçekten kapattığı şey:**

- **Option A (düşük operasyon / hızlı MVP) SEÇİLEN YÖN olarak
  işaretlendi** — `docs/managed-infrastructure-plan.md` §7'nin
  güncellenmiş banner'ı ve prensipler listesi (managed Postgres, S3-uyumlu
  storage, managed app/runtime hosting, managed logs/monitoring, local
  disk production'da YOK, staging-önce + managed restore drill ZORUNLU).
  **Bu bir sağlayıcı seçimi DEĞİL** — "provider selection pending" durumu
  aynen devam ediyor, dürüstçe böyle işaretlendi.
- **Provider short-list hazırlandı** (`docs/managed-infrastructure-plan.md`
  §8) — 5 kategoride (managed Postgres, S3-uyumlu storage, app/runtime
  hosting, background worker hosting [ayrı kategori DEĞİL, §3d'nin
  tekrarı], monitoring/logging) her biri için birden fazla ÖRNEK aday,
  görev tanımının istediği sekiz eksende (kolay kurulum, GitHub Actions
  entegrasyonu, env/secrets yönetimi, backup/PITR, object storage
  versioning, Docker/Node runtime desteği, worker process desteği,
  Türkiye'den erişim/latency). **Hiçbir güncel fiyat iddiası yok, hiçbir
  sağlayıcı SEÇİLMEDİ.**
- **Staging Deployment Gate — Option A hazırlandı**
  (`docs/deployment-runbook.md` §18) — 13 maddelik checklist (GitHub
  branch seçiminden GitHub Actions deploy workflow doğrulamasına kadar),
  staging'e özgü env/secrets matrisi (required/optional/debug-only
  ayrımlı, `NODE_ENV`/`DATABASE_URL`/`AUTH_SECRET`/`STORAGE_PROVIDER`/
  `S3_*`/`NEXT_PUBLIC_API_URL`/`API_CORS_ORIGIN`/`LOG_LEVEL`/
  `CI_DEBUG_ROUTES*` dahil), ve provider-agnostic 6-adımlı staging deploy
  akışı (build → deploy → migrate → health check → smoke → restore
  drill). **Checklist'in HİÇBİR maddesi işaretlenmedi.**
- **Pasif bir GitHub Actions template'i eklendi**
  (`docs/staging-deploy-workflow-template.yml`) — `.github/workflows/`
  İÇİNDE DEĞİL, bu yüzden GitHub Actions tarafından hiçbir zaman
  keşfedilmez/çalıştırılmaz; deploy (Adım 2) ve managed-staging restore
  drill (Adım 6) adımları bilinçli olarak TODO placeholder — provider
  seçilmeden gerçek komutlar yazılamaz.
- **Runtime readiness doğrulandı, YENİ bir belirsizlik BULUNMADI:**
  worker'ın API ile aynı process'te çalıştığı (ayrı bir servis/instance
  OLMADIĞI) daha önceki adımların (§2, §7) zaten doğruladığı gibi bugün
  de NET — bu adım bunu YENİDEN doğruladı, belirsiz bir komut/karar
  bulunmadı. `apps/api`/`apps/dashboard`'ın ikisinin de `build`/`start`
  script'leri (`tsc`+`node dist/index.js`, `next build`+`next start`)
  zaten var ve eksiksiz. **Gerçek, dokümante edilen bir gap:**
  `apps/dashboard` için hiçbir `Dockerfile` yok — yalnızca
  `apps/api/Dockerfile` var (`docker-compose.staging.yml`'in yalnız
  `postgres`+`api` servisleri olması bunun doğal sonucu). Bu, Option A'nın
  §8c adaylarının ÇOĞU (Railway/Render/Fly gibi Next.js'i Dockerfile'sız,
  doğrudan buildpack/`next build`+`next start` ile çalıştırabilen
  platformlar) için BLOKER DEĞİL — ama Docker-zorunlu bir platform
  seçilirse (ör. çıplak bir VM/Compose yaklaşımı) `apps/dashboard` için
  yeni bir Dockerfile YAZILMASI gerekecek, ki bu bu adımın "büyük refactor
  yapma" sınırının dışında bırakıldı — yalnızca burada RİSK olarak
  kaydedildi.

**Kapatılmadı (bilinçli, dürüstçe restate — bu adımın kendi başarı
kriteri budur, gerçek deploy yapmak DEĞİL):**

- Hiçbir gerçek provider hesabı/projesi açılmadı.
- Hiçbir gerçek servis (staging Postgres/S3/hosting) provizyonlanmadı.
- Hiçbir staging deploy'u yapılmadı.
- Hiçbir gerçek secret değeri yazılmadı.
- Managed staging altyapıya karşı bir restore drill hâlâ hiç yapılmadı
  (`docs/backup-restore-runbook.md` §13c hâlâ boş, §14'ün yeni gate'i de
  hâlâ karşılanmadı).
- `apps/dashboard` için Dockerfile YAZILMADI (yukarıdaki risk notu —
  bilinçli, kapsam dışı).
- §16'nın listelediği diğer açık kalem (çoklu-worker yatay ölçek
  koordinasyonu) bu adımın kapsamı DIŞI, değişmedi.
- Hiçbir production deploy yapılmadı, hiçbir yeni ürün özelliği
  eklenmedi, hiçbir migration eklenmedi.

**Bu adımın kendi doğrulaması:** `pnpm run ci:stable` PASS — `build`/
`typecheck`/`lint` temiz, `test:ci` **433/433 temiz (26/26 dosya)**.
`pnpm run ci:staging` PASS — `smoke:staging` 2 pass, 2 warn (`providers`
degraded, `KIE_AI_API_KEY` staging'de bilinçli boş — beklenen), 1 skip, 0
fail. `bash -n scripts/restore-drill-staging.sh` temiz (script'e
dokunulmadı). Yeni `docs/staging-deploy-workflow-template.yml` YAML
sözdizimi `python3 -c "import yaml; yaml.safe_load(...)"` ile doğrulandı
— temiz parse (repo'daki mevcut `.github/workflows/stable-ci.yml` ile
aynı, zararsız YAML 1.1 `on:`→bool quirk'i dışında sürpriz yok).

**Production gate — DEVAM EDEN durum, dürüstçe:** Option A artık SEÇİLİ
YÖN, provider short-list ve staging deployment checklist'i HAZIR. **Ama
bu, projenin staging'e veya production'a HAZIR olduğu anlamına GELMEZ** —
somut sağlayıcı seçimi hâlâ yapılmadı, hiçbir gerçek provizyonlama
olmadı. **Production deploy hâlâ BLOKEDE, DEĞİŞMEDİ** (§19'un koyduğu
gate aynen geçerli). **Bir sonraki somut adım: sağlayıcı seçimi +
staging provisioning** — `docs/managed-infrastructure-plan.md` §8'in
short-list'inden somut bir Postgres/S3/hosting sağlayıcısı seçilip
`docs/deployment-runbook.md` §18b'nin checklist'i gerçekten
işaretlenmeye başlanmalı.

## 21. Implementation status update (Render + Cloudflare R2 Staging Provisioning Package — Production Step 13)

**§20'nin bıraktığı "hangi somut sağlayıcı" sorusu artık CEVAPLANDI —
gerçek servisler hâlâ KURULMADI.** Tam içerik
[`docs/managed-infrastructure-plan.md`](./managed-infrastructure-plan.md)
§9'da, [`docs/deployment-runbook.md`](./deployment-runbook.md) §19/§20'de
— burada yalnızca bu belgenin production-gate sınıflandırmasına düşen
özet var.

**Bu adımın gerçekten kapattığı şey:**

- **Provider path SEÇİLDİ:** Render (API/dashboard/worker runtime +
  managed Postgres) + Cloudflare R2 (S3-uyumlu object storage) —
  `docs/managed-infrastructure-plan.md` §9. **"Selected, not
  provisioned"** — hiçbir hesap açılmadı, hiçbir servis kuruldu.
- **Provisioning package HAZIRLANDI:**
  - `docs/render-staging-blueprint.template.yaml` — pasif Render
    Blueprint taslağı (repo köküne `render.yaml` olarak EKLENMEDİ,
    bilinçli — bkz. aşağıdaki HIGH-RISK bulgusu ve dosyanın kendi
    gerekçesi), 2 web service (API — Docker, dashboard — native Node) +
    1 Postgres database modelledi, worker AYRI bir servis olarak
    modellenmedi (mimari zaten böyle).
  - `docs/deployment-runbook.md` §19 "Cloudflare R2 Staging Setup" —
    bucket oluşturma, veri koruması (bkz. aşağıdaki R2 versioning
    düzeltmesi), least-privilege access key, S3 endpoint formatı.
  - `docs/deployment-runbook.md` §20 "Render Postgres Staging Setup" —
    Postgres oluşturma, `DATABASE_URL` bağlama, migration, PITR/backup
    notları.
  - `docs/deployment-runbook.md` §18c'nin staging env/secrets matrisi
    Render/R2'ye özgü hale getirildi (`S3_REGION=auto`, gerçek
    `S3_ENDPOINT` formatı, vb.).
  - `docs/staging-deploy-workflow-template.yml` Render Deploy Hook
    mekanizmasına (Cloudflare/Render'ın kendi dokümantasyonundan
    doğrulandı) göre güncellendi — CI gate job'ı eklendi, restore drill
    bilinçli olarak MANUEL bir gate olarak bırakıldı (otomatik
    değil — bir restore drill kendi hedefine karşı YIKICI).
  - `docs/backup-restore-runbook.md` §15 "Render + R2 Managed Staging
    Restore Drill" — somut, Render/R2'ye özgü prosedür; **"pending
    provider provisioning"** olarak işaretli, §15c hâlâ boş.
- **GERÇEK BİR HATA BULUNUP DÜZELTİLDİ (bu adımın kendi araştırması,
  Cloudflare'ın güncel dokümantasyonuna karşı doğrulandı):**
  `docs/managed-infrastructure-plan.md` §8b ve `docs/backup-restore-runbook.md`
  §3b, R2'nin "bucket versioning destekliyor" dediği YANLIŞ bir iddia
  içeriyordu (Production Step 9/11'de, sağlayıcı seçilmeden önce
  yazılmıştı) — Cloudflare'ın kendi dokümantasyonu (S3 API uyumluluk
  referansı + versioning'e dair sıfır sayfa) bunun DOĞRU OLMADIĞINI
  gösteriyor. Düzeltildi: R2'nin gerçek mekanizması "Bucket Locks"
  (WORM-tarzı retention, eski versiyon geri getirilemiyor) + lifecycle
  rules (bu GERÇEKTEN destekleniyor) — versioning DEĞİL. Detay:
  `docs/managed-infrastructure-plan.md` §9c.
- **YENİ, GERÇEK BİR RİSK BULUNDU (runtime readiness doğrulaması,
  Render'ın kendi dokümantasyonuna karşı):** `apps/api/Dockerfile`,
  Production Step 2B/8'in bulduğu "tsc COPY'lenen kaynağa karşı Docker
  içinde güvenilir çalışmıyor" bug'ı yüzünden HOST-BUILT `dist/`
  klasörlerinin `COPY . .` ile image'a taşınmasına dayanıyor — yani
  `docker build`'den ÖNCE host'ta (veya CI runner'da)
  `pnpm run build` çalıştırılmış OLMALI. Render'ın kendi Blueprint
  dokümantasyonu (bu adımda doğrulandı), Docker-runtime bir servis için
  `docker build`'den önce host komutu çalıştıran bir mekanizma
  TANIMLAMIYOR — `buildCommand`/`startCommand` alanları yalnız
  Docker-DIŞI runtime'lar için. **Sonuç: bugünkü Dockerfile, Render'ın
  Docker runtime'ında, GitHub Actions'ta (Step 8) bulunan AYNI
  "Cannot find module dist/index.js" hatasını verme riski taşıyor —
  bu HENÜZ gerçek Render altyapısına karşı TEST EDİLMEDİ, doğrulanmış bir
  arıza değil, kanıta dayalı bir RİSK.** İki yol dokümante edildi
  (`docs/render-staging-blueprint.template.yaml`'ın kendi HIGH-RISK
  notu): (A) Docker runtime, risk yukarıdaki gibi; (B) native Node
  runtime (Docker YOK), `RENDERER_PROVIDER=fake` ile ilk staging
  bring-up için uygun (Chromium bağımlılığı yok) — ikisi arasında seçim
  provizyonlama sırasına bırakıldı, bu belge bir seçim YAPMIYOR. Bu,
  büyük bir refactor GEREKTİRMEDİ — yalnızca iki alternatif dokümante
  edildi.
- **Worker start command belirsizliği YOK** — §20/§9a'nın zaten
  doğruladığı gibi worker, API Web Service'in KENDİ process'i
  (`RENDER_QUEUE_ENABLED=true`), ayrı bir start command/servis
  GEREKTİRMİYOR. Bu, task'ın "worker start command belirsizse risk
  yaz" şartını TETİKLEMİYOR — belirsizlik yok.
- **Render port binding — kısmen doğrulanmış, kısmen değil:** Render'ın
  kendi dokümantasyonu (bu adımda fetch edildi) her iki runtime türü
  için de `PORT` env değişkenine bağlanmayı öneriyor
  (varsayılan `10000`, override edilebilir). Bu repo'nun API'si
  `API_PORT` (özel isim) okuyor — `docs/render-staging-blueprint.template.yaml`
  hem `PORT` hem `API_PORT`'u `4000`'e set ederek bunu ele alıyor, ama
  Render'ın port-algılama mekanizmasının TAM OLARAK nasıl çalıştığı
  (env değişkeni okuması mı, TCP probe mu) bu adımda kesin
  DOĞRULANAMADI — provizyonlama sırasında teyit edilmeli.

**Kapatılmadı (bilinçli, dürüstçe restate — bu adımın kendi başarı
kriteri budur, gerçek deploy/provizyonlama yapmak DEĞİL):**

- Hiçbir gerçek Render/Cloudflare hesabı açılmadı.
- Hiçbir gerçek servis (Render Web Service/Postgres, R2 bucket)
  provizyonlanmadı.
- Hiçbir staging deploy'u yapılmadı.
- Hiçbir gerçek secret/API key üretilmedi.
- Managed staging altyapıya karşı bir restore drill hâlâ hiç yapılmadı
  (`docs/backup-restore-runbook.md` §15c hâlâ boş).
- Render Docker build riski GERÇEKTEN test edilmedi — yalnızca kanıta
  dayalı bir risk olarak kaydedildi.
- §16'nın listelediği diğer açık kalem (çoklu-worker yatay ölçek
  koordinasyonu) bu adımın kapsamı DIŞI, değişmedi.
- Hiçbir production deploy yapılmadı, hiçbir yeni ürün özelliği
  eklenmedi, hiçbir migration eklenmedi.

**Bu adımın kendi doğrulaması:** `pnpm run ci:stable` PASS — `build`/
`typecheck`/`lint` temiz, `test:ci` **433/433 temiz (26/26 dosya)**.
`pnpm run ci:staging` PASS — `smoke:staging` 2 pass, 2 warn (`providers`
degraded, `KIE_AI_API_KEY` staging'de bilinçli boş — beklenen), 1 skip, 0
fail. `bash -n scripts/restore-drill-staging.sh` temiz (script'e
dokunulmadı). Yeni `docs/render-staging-blueprint.template.yaml` VE
güncellenen `docs/staging-deploy-workflow-template.yml` YAML sözdizimi
`python3 -c "import yaml; yaml.safe_load(...)"` ile doğrulandı — ikisi de
temiz parse.

**Production gate — DEVAM EDEN durum, dürüstçe:** Provider path SEÇİLDİ,
provisioning paketi HAZIR. **Ama bu, projenin staging'e veya
production'a HAZIR olduğu anlamına GELMEZ** — Render/R2 gerçek
servisleri hâlâ kurulmadı, managed staging deploy hâlâ yapılmadı,
managed staging restore drill hâlâ yapılmadı. **Production deploy hâlâ
BLOKEDE, DEĞİŞMEDİ.** **Bir sonraki somut adım:** kullanıcının gerçek
Render hesabı/Cloudflare hesabı açması, `docs/render-staging-blueprint.template.yaml`'ı
gerçek `render.yaml`'a dönüştürüp sync etmesi (Docker vs native Node
kararını vererek), R2 bucket'ı gerçekten oluşturması — bunların HİÇBİRİ
bu Antigravity oturumunda yapılamaz (gerçek hesap/kredi kartı/secret
işlemi gerektiriyor), kullanıcının kendi platformlarında yapması
gerekiyor.

## 22. Implementation status update (Render + Cloudflare R2 Live Staging Provisioning Guide — Production Step 14)

**§21'in bıraktığı "somut sağlayıcı seçildi ama nasıl kurulacağı
kullanıcıya net anlatılmadı" boşluğu bu adımda KAPANDI — gerçek servisler
hâlâ KURULMADI.** Tam içerik `docs/deployment-runbook.md` §21/§22/§23'te
— burada yalnızca bu belgenin production-gate sınıflandırmasına düşen
özet var.

**Bu adımın gerçekten kapattığı şey:**

- **Kullanıcıdan dört non-secret karar alındı:** (1) Render VE Cloudflare
  hesaplarının ikisi de henüz yok — sıfırdan başlanıyor; (2) staging
  branch `phase-2-checkpoint` (§18a'nın decision required'ı kapandı); (3)
  bölge tercihi Frankfurt/Avrupa (Türkiye'ye en yakın, provizyonlama
  sırasında Render'ın gerçek bölge listesine karşı teyit edilmeli); (4)
  `docs/render-staging-blueprint.template.yaml` PASİF kalacak, kullanıcı
  servisleri Render panelinden elle kuracak — bu belge repo köküne
  `render.yaml` olarak KOPYALANMADI.
- **Üç yeni, sıralı, panelde takip edilebilir checklist yazıldı**
  (`docs/deployment-runbook.md` §21/§22/§23): Render Staging Provisioning
  Live Setup Checklist, Cloudflare R2 Staging Live Setup Checklist, ve
  hangi env değişkeninin hangi Render servisinin (API/dashboard) env
  sekmesine (veya hiçbirine — worker ayrı bir panel değil, §23c) gireceğini
  gösteren panel-eşleme tablosu. Üçü de §17/§18/§19/§20'nin YERİNE
  geçmiyor, onları tek, kullanıcının gerçekten tıklayarak ilerleyebileceği
  bir sıraya topluyor.
- **`docs/backup-restore-runbook.md`'ye yeni §15d eklendi** — managed
  restore drill'in (§15) ÇALIŞTIRILABİLİR olması için gereken preflight
  kriterleri (Render/R2 checklist'lerinin tamamlanmış olması, sentetik
  veri kararı, staging-vs-production teyidi) — drill'in kendisi bu adımda
  YAPILMADI, yalnızca "ne zaman yapılabilir" sorusu somutlaştırıldı.
- **Repo doğrulaması bu adımda YENİDEN çalıştırıldı** (kod hiç
  değişmedi, yalnızca dokümantasyon eklendi) — bkz. aşağıdaki
  "Bu adımın kendi doğrulaması".

**Kapatılmadı (bilinçli, dürüstçe restate — bu adımın kendi başarı
kriteri budur, gerçek deploy/provizyonlama yapmak DEĞİL):**

- Hiçbir gerçek Render/Cloudflare hesabı açılmadı — §21/§22'nin
  checklist'lerinin HİÇBİR maddesi bu adımda işaretlenmedi.
- Hiçbir gerçek servis (Render Web Service/Postgres, R2 bucket)
  provizyonlanmadı, hiçbir gerçek secret/API key üretilmedi.
- Repo köküne aktif bir `render.yaml` EKLENMEDİ — kullanıcının kendi
  kararı, §21'in "render.yaml kararı" notu.
- Hiçbir staging deploy'u yapılmadı.
- Managed staging altyapıya karşı bir restore drill hâlâ hiç yapılmadı
  (`docs/backup-restore-runbook.md` §15c hâlâ boş, §15d'nin preflight
  kriterleri hâlâ karşılanmadı).
- §21'in Render Docker build riskiyle ilgili notu (§13'ün HIGH-RISK
  bulgusu) hâlâ gerçek Render altyapısına karşı TEST EDİLMEDİ.
- Hiçbir production deploy yapılmadı, hiçbir yeni ürün özelliği
  eklenmedi, hiçbir migration eklenmedi, hiçbir runtime storage driver
  refactor'u yapılmadı.

**Bu adımın kendi doğrulaması:** `pnpm run typecheck`/`pnpm run
lint`/`pnpm run build` temiz. `pnpm run ci:stable` PASS — **433/433
test yeşil (26/26 dosya)**. `pnpm run ci:staging` PASS — gerçek Docker
Desktop'a karşı build+up+migrate+health/ready+smoke, `smoke:staging` 2
pass, 2 warn (`providers` degraded — `KIE_AI_API_KEY` staging'de
bilinçli boş, beklenen), 1 skip, 0 fail. `bash -n
scripts/restore-drill-staging.sh` ve `bash -n scripts/ci-staging.sh`
temiz (ikisine de dokunulmadı). `docs/render-staging-blueprint.template.yaml`
VE `docs/staging-deploy-workflow-template.yml` YAML sözdizimi yeniden
doğrulandı (`python3 -c "import yaml; yaml.safe_load(...)"`) — ikisi de
temiz parse, ikisine de bu adımda içerik değişikliği YAPILMADI (yalnızca
bir cross-reference notu eklendi). `git status` bu adımın başında ve
validasyon komutları sonrasında temiz — hiçbir kalıntı/gizli değer
working tree'de bırakılmadı.

**Production gate — DEVAM EDEN durum, dürüstçe:** Provider path SEÇİLDİ
(Step 13), live provisioning rehberi HAZIR (bu adım). **Ama bu, projenin
staging'e veya production'a HAZIR olduğu anlamına GELMEZ** — Render/R2
gerçek servisleri hâlâ kurulmadı, managed staging deploy hâlâ yapılmadı,
managed staging restore drill hâlâ yapılmadı. **Production deploy hâlâ
BLOKEDE, DEĞİŞMEDİ.** **Bir sonraki somut adım:** kullanıcının
`docs/deployment-runbook.md` §21/§22'nin checklist'lerini kendi
platformlarında (Render dashboard, Cloudflare dashboard) gerçekten
işaretleyerek yürütmesi — bunların HİÇBİRİ bu Antigravity oturumunda
yapılamaz (gerçek hesap/kredi kartı/secret işlemi gerektiriyor).
Provizyonlama tamamlandıktan SONRA sıradaki adım
`docs/backup-restore-runbook.md` §15d'nin preflight listesini
tamamlayıp §15b'nin managed restore drill'ini gerçekten çalıştırmak
olacak — bu da HENÜZ bu adımın kapsamında DEĞİL.

## İlgili dokümanlar

- [`docs/managed-infrastructure-plan.md`](./managed-infrastructure-plan.md) —
  §19'un tam teslimatı: infrastructure envanteri, provider karar matrisi,
  env/secrets matrisi, ops decision (Option A/B/C). §7/§8 — §20'nin
  kaynağı: Option A'nın "SEÇİLEN YÖN" işareti ve provider short-list'i.
  §9 — §21'in kaynağı: somut Render + R2 seçimi, R2 versioning
  düzeltmesi.
- [`docs/deployment-runbook.md`](./deployment-runbook.md) §18 — §20'nin
  doğrudan teslimatı: Staging Deployment Gate checklist'i, staging
  env/secrets matrisi, provider-agnostic deploy akışı. §19/§20 — §21'in
  doğrudan teslimatı: Cloudflare R2 ve Render Postgres staging setup.
- [`docs/staging-deploy-workflow-template.yml`](./staging-deploy-workflow-template.yml) —
  §20'nin pasif GitHub Actions taslağı, §21'de Render/R2'ye özgü hale
  güncellendi.
- [`docs/render-staging-blueprint.template.yaml`](./render-staging-blueprint.template.yaml) —
  §21'in pasif Render Blueprint taslağı, Docker build riskinin kaynağı.
- [`docs/backup-restore-runbook.md`](./backup-restore-runbook.md) — §17'nin
  tam teslimatı: persistence envanteri, managed Postgres/S3 karar
  kriterleri, backup policy, restore/restore-drill prosedürü; §12 —
  §18'in kaynağı olan gerçek drill sonucu.
- `scripts/restore-drill-staging.sh` — §18'in tam otomasyonu.
- [`docs/ci-stable-profile.md`](./ci-stable-profile.md) — §16'nın doğrudan
  kaynağı: Production Step 8'in tam çalıştırma tablosu, 3 bulunan bug'ın
  kanıtlı kök-neden yazımı, ve Remote Runner Validation Protocol'ün gerçek
  sonucu.
- [`docs/staging-compose.md`](./staging-compose.md) — bu §14'ün tam
  teslimatı: Dockerfile/Compose/env/smoke script tasarım kararları, ne
  doğrulanıp ne doğrulanmadığı, ve Docker-yok dürüst notu.
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
