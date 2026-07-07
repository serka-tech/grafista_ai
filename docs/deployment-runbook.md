# Grafista AI Studio — Deployment Runbook (Staging & Production, İlk Sürüm)

> **Status: RUNBOOK — dokümantasyon, hiçbir deployment config/script/CI
> dosyası bu adımda yazılmadı.** Bu belge
> [`docs/production-readiness-review.md`](./production-readiness-review.md)'nin
> §11 önerdiği sıralamanın ("B+A → C (Deployment Runbook) → D → E")
> **C** maddesinin teslimatıdır — Production Readiness Step (healthcheck
> `GET /api/health` + `GET /api/health/ready`, worker heartbeat, stale-lock
> recovery, queue depth özeti; commit `63ed547`) tamamlandıktan hemen sonra
> gelen adım. Bu belge yeni bir platform/mimari kararı ÜRETMİYOR — o karar
> zaten `docs/production-readiness-review.md` §3/§4'te verildi; burada o
> kararı somut, sıralı, komut-seviyeli bir operasyon prosedürüne döküyoruz.
>
> Kaynaklar: [`docs/production-readiness-review.md`](./production-readiness-review.md),
> [`docs/release-readiness.md`](./release-readiness.md),
> [`docs/phase-3-final-state.md`](./phase-3-final-state.md),
> [`docs/render-queue-worker-plan.md`](./render-queue-worker-plan.md),
> [`docs/mvp-demo-flow.md`](./mvp-demo-flow.md), ve doğrudan repo içi
> okuma/grep (`apps/api/src/routes/health.ts`,
> `apps/api/src/services/render-queue-env.ts`,
> `apps/api/src/db/repositories/render-jobs.ts`,
> `apps/api/src/db/repositories/render-worker-heartbeats.ts`,
> `apps/api/src/services/render-worker.ts`, root `package.json`,
> `apps/api/package.json`, `apps/dashboard/package.json`, `.env.example`,
> `database/migrations/`).

---

## 1. Deployment hedefi

İlk staging/production dağıtımının "canlı" sayılabilmesi için gereken
somut envanter — `docs/production-readiness-review.md` §2'nin doğrulanmış
listesiyle birebir aynı, burada operasyonel hedef olarak yeniden ifade
ediliyor:

| Bileşen | Zorunlu mu? | Not |
|---|---|---|
| API server (`apps/api`, Express, port `4000` varsayılan) | **Evet** | `apps/api/src/app.ts` — tüm domain route'ları + `healthRouter` burada mount edilir (`app.use('/api', healthRouter)`) |
| Dashboard (`apps/dashboard`, Next.js, port `3000` varsayılan) | **Evet, gerçek kullanım için** | `NEXT_PUBLIC_API_URL` API'ye işaret etmeli |
| PostgreSQL 14+ | **Evet, zorunlu** | `DATABASE_URL` — API boot'ta fail-fast; embedded-Postgres yalnız testte kullanılır |
| S3-uyumlu storage | **Koşullu ama staging/production'da önerilir** | `STORAGE_PROVIDER=local` (varsayılan, tek-host diskine yazar, backup yok — bkz. §11) veya `s3` (tüm `S3_*` değişkenleri birlikte zorunlu) |
| Playwright/Chromium runtime | **Koşullu, gerçek render için zorunlu** | `RENDERER_PROVIDER=fake` bu bağımlılığı tamamen kaldırır; gerçek render Chromium sistem bağımlılıkları ister |
| Render queue worker modu | **Aynı process içinde bir bayrak, ayrı bir deploy hedefi DEĞİL** | `RENDER_QUEUE_ENABLED` — `apps/api`'nin kendi process'inde `setInterval` tabanlı polling loop |
| OpenAI/KIE provider env | **Koşullu** | `AI_DEFAULT_PROVIDER=fake` ile tamamen by-pass edilebilir; gerçek görsel üretimi `KIE_AI_API_KEY`+`KIE_AI_BASE_URL` ister |
| Health/readiness doğrulaması | **Evet, deploy'un başarılı sayılması için zorunlu** | `GET /api/health` (liveness) + `GET /api/health/ready` (dependency readiness) — §8 |

Bu tablonun tek pratik sonucu: **"render worker" ayrı bir servis/deploy
hedefi değildir** — API image'ı = worker image'ı, aynı process. Bu,
aşağıdaki topoloji tartışmasını önemli ölçüde basitleştiriyor.

---

## 2. Önerilen ilk topoloji

Bu bölüm yeni bir analiz YAPMIYOR — `docs/production-readiness-review.md`
§3/§4'ün zaten verdiği kararı doğrulayıp restate ediyor, çünkü bu runbook o
review'un **sonraki** teslimatı, onunla yarışan bir ikinci analiz değil.

`docs/production-readiness-review.md` §3'ün karşılaştırma matrisi (Docker
Compose/tek-VM vs. Railway/Render/Fly vs. VPS+PM2 vs. managed Postgres+S3
vs. Kubernetes) şu sonuca varmıştı: **in-process worker tasarımı**
(`setInterval` tabanlı, `apps/api`'nin kendi process'inde) **serverless/
stateless platformları doğrudan diskalifiye eder** (worker'ın çalışması
için process'in sürekli ayakta kalması zorunlu) ve **Kubernetes bugün
orantısız** (çoklu-worker/pod yatay ölçek davranışı hiç test edilmedi —
bkz. §7). Geriye kalan aday kümesi: Docker Compose/tek-VM, uzun-ömürlü
process destekleyen bir PaaS (Railway/Render.com/Fly.io), veya VPS+PM2.

Bu runbook bu kararı **doğruluyor, yeniden türetmiyor**:

| Ortam | Önerilen topoloji | Gerekçe |
|---|---|---|
| **İlk STAGING** | **Docker Compose, tek host/VM** (API container + Postgres container + opsiyonel MinIO container) | En hızlı doğrulama döngüsü, local dev'e en yakın parite (aynı `docker-compose` şekli local'de de çalıştırılabilir), Playwright'ın Chromium bağımlılıkları bir Dockerfile'da (`npx playwright install --with-deps chromium`) doğal çözülür, maliyet en düşük |
| **İlk PRODUCTION** | **AYNI topoloji ailesi** — Docker Compose/tek-VM VEYA eşdeğer bir uzun-ömürlü-process PaaS (Railway/Render/Fly), ekibin sunucu-yönetim iştahına göre | Aşağıya bkz. |

**Staging ve production AYNI topoloji ailesini kullanmalı, farklısını
değil.** Gerekçe: bu projede bugüne kadar **sıfır deployment geçmişi**
var (`docs/phase-3-final-state.md` — "her doğrulama local dev stack +
embedded-Postgres test ortamına karşı yapıldı, hiçbir deploy edilmiş
ortama karşı değil"). Staging'i bir topolojide (örn. Docker Compose),
production'ı başka birinde (örn. Kubernetes veya çıplak serverless)
çalıştırmak, tam olarak review'un kapatmaya çalıştığı riski yeniden açar:
"staging'de çalıştı ama production'da hiç doğrulanmadı" senaryosu —
özellikle in-process worker'ın `setInterval` döngüsünün sürekli-ayakta-
process gerektirdiği ve stale-lock sweep/heartbeat davranışının gerçek
bir crash senaryosunda hiç egzersiz edilmediği (§7) göz önüne alındığında.
Managed Postgres + managed S3-uyumlu storage (`STORAGE_PROVIDER=s3`) her
iki ortamda da (yalnız production'da değil) önerilir — bu, `s3` storage
yolunu gerçek ihtiyaçtan önce staging'de doğrulamayı sağlar ve local
`local` modun backup'sız disk riskini (§11) production'a taşımaz.

Compute tercihi (çıplak VM/Docker Compose mi, yoksa Railway/Render/Fly
gibi bir PaaS mi) ekibin operasyonel yük iştahına bağlı bir ikincil karar
— ama HANGİSİ seçilirse seçilsin, "uzun-ömürlü tek process + container
içinde Chromium" gereksinimi sabit kalır; bu, review'un K8s'i "erken"
olarak elemesinin aynı gerekçesiyle, ilk dağıtım için Kubernetes'i bu
runbook da önermiyor.

---

## 3. Environment profiles

Üç profil, gerçek env değişkenleriyle (`.env.example`,
`apps/api/src/services/render-queue-env.ts`):

### Local (geliştirme)

- `AI_DEFAULT_PROVIDER=fake`, `RENDERER_PROVIDER=fake` — sıfır ağ,
  sıfır maliyet, deterministik (`docs/release-readiness.md`).
- `STORAGE_PROVIDER=local` (varsayılan) — `apps/api/uploads/` altında düz
  disk, MinIO opsiyonel (`S3_*` set edilirse).
- Yerel PostgreSQL 14+, `pnpm --filter @grafista/api run db:seed-demo` ile
  demo tasarım referansları (gerçek görsel byte'larıyla, DesignDNA için
  gerekli).
- `RENDER_QUEUE_ENABLED` kapalı (varsayılan) — senkron render akışı yeterli.

### Staging

- Gerçek PostgreSQL (managed veya Compose container) — `local`/embedded
  DEĞİL.
- Gerçek veya sınırlı-gerçek `S3_*` yapılandırması (S3-uyumlu bir bucket,
  `STORAGE_PROVIDER=s3`) — production'daki storage yolunu erkenden
  doğrulamak için.
- OpenAI/KIE anahtarları: gerçek anahtarlarla **sınırlı/kontrollü**
  `smoke:providers` çalıştırması önerilir (§9) — tam trafik değil, tek
  seferlik doğrulama.
- `RENDER_QUEUE_ENABLED=true` **deneme amaçlı** açılmalı — bu, production'a
  geçmeden önce worker heartbeat/stale-lock davranışının gerçek bir
  ortamda (laptop değil) ilk kez gözlemlendiği yer.
- `GET /api/health` + `GET /api/health/ready` **zorunlu** doğrulama —
  deploy başarı kriterinin parçası (§8).
- `db:seed-demo` staging'de **serbest** — production'a hiç
  çalıştırılmaması gereken script, staging'de tam tersine faydalı
  (dashboard walkthrough'unu gerçek bir ortamda tekrarlamak için).

### Production

- Gerçek `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` (presence-only zorunlu, boot
  zamanında kontrol edilir) ve `KIE_AI_API_KEY`+`KIE_AI_BASE_URL` (gerçek
  görsel üretimi için birlikte zorunlu).
- Managed PostgreSQL, managed S3-uyumlu storage — `local` storage modu
  production için ÖNERİLMEZ (backup yok, tek disk kaybı = tüm artifact
  geçmişinin kaybı, bkz. §11).
- `RENDER_QUEUE_ENABLED=true` — kalıcı olarak açık, worker heartbeat
  izlenen bir operasyonel sinyal (§7).
- Migration'lar yalnız kontrollü, sıralı şekilde uygulanır (§6) —
  otomatik/kör bir CI adımı değil (bugün zaten yok, §12).
- **`db:seed-demo` KAPALI/ÇALIŞTIRILMAZ** — açıkça ayrı, opsiyonel bir
  script (`docs/production-readiness-review.md`); demo verisinin
  production'a kazayla karışması riski zaten düşük çünkü hiçbir script
  otomatik zincirlenmiyor, ama bu, "production'da asla çalıştırma"
  kuralının insan disiplinine bağlı olduğu anlamına gelir.

---

## 4. Env checklist (kategori bazlı — yalnız isim + amaç, değer YOK)

`.env.example`'daki gerçek anahtar isimleri, kategoriye göre gruplanmış.
Hiçbir örnek/placeholder değer verilmiyor, yalnız isim ve tek satırlık amaç.

**Database**
- `DATABASE_URL` — Postgres bağlantı stringi; API boot'ta fail-fast.
- `PGVECTOR_ENABLED` — pgvector migration adımının atlanıp atlanmayacağı.

**Auth/session**
- `AUTH_SECRET` — oturum/kimlik doğrulama imzalama anahtarı (≥16 karakter
  zorunlu, boot'ta kontrol edilir).
- `COOKIE_SECURE` — cookie'nin yalnız HTTPS üzerinden mi gönderileceği.

**Storage/S3**
- `STORAGE_PROVIDER` — `local` veya `s3` seçimi.
- `S3_ENDPOINT` — S3-uyumlu servisin endpoint URL'i.
- `S3_REGION` — bucket bölgesi.
- `S3_BUCKET` — hedef bucket adı (adapter otomatik oluşturmaz).
- `S3_ACCESS_KEY_ID` — erişim anahtarı kimliği.
- `S3_SECRET_ACCESS_KEY` — erişim anahtarı sırrı.
- `S3_FORCE_PATH_STYLE` — path-style URL zorunluluğu (MinIO gibi
  sağlayıcılar için).

**OpenAI / AI provider routing**
- `OPENAI_API_KEY` — OpenAI API anahtarı (presence-only, boot'ta zorunlu).
- `OPENAI_VISION_MODEL` — vision görevleri için model adı.
- `ANTHROPIC_API_KEY` — Anthropic API anahtarı (presence-only, boot'ta
  zorunlu).
- `GEMINI_API_KEY` — Gemini API anahtarı (henüz placeholder adapter).
- `HIGGSFIELD_API_KEY` / `HIGGSFIELD_BASE_URL` — placeholder adapter,
  gerçek bir yeteneğe bağlı değil.
- `AI_DEFAULT_PROVIDER` — tüm AI çağrılarını hangi adaptöre yönlendireceği
  (`fake` tüm gerçek çağrıları by-pass eder).
- `DEFAULT_TEXT_PROVIDER` / `DEFAULT_VISION_PROVIDER` /
  `DEFAULT_IMAGE_PROVIDER` — görev bazlı routing varsayılanları.
- `AI_TIMEOUT_MS` — AI çağrıları için timeout.

**KIE**
- `KIE_AI_API_KEY` — Kie AI API anahtarı (gerçek görsel üretimi için
  `KIE_AI_BASE_URL` ile birlikte zorunlu).
- `KIE_AI_BASE_URL` — Kie AI servis taban URL'i.
- `KIE_AI_IMAGE_MODEL` — opsiyonel model override.
- `KIE_AI_POLL_INTERVAL_MS` — üretim durumu poll aralığı.
- `KIE_AI_TIMEOUT_MS` — Kie çağrıları için timeout.

**Renderer/Playwright**
- `RENDERER_PROVIDER` — `playwright` (gerçek render, Chromium gerekir)
  veya `fake` (Chromium bağımlılığını tamamen kaldırır). Playwright'ın
  kendisi için ayrı bir env değişkeni yok — yalnız bu bayrak.

**Queue/worker**
- `RENDER_QUEUE_ENABLED` — kuyruk/worker modunu açıp kapatan ana bayrak
  (varsayılan kapalı).
- `RENDER_WORKER_ID` — bu worker process'inin kimliği (`render_jobs.locked_by`
  için).
- `RENDER_JOB_MAX_ATTEMPTS` — bir job'ın kaç kez deneneceği.
- `RENDER_JOB_BASE_DELAY_MS` — retry'lar arası temel bekleme (exponential
  backoff tabanı).
- `RENDER_WORKER_POLL_INTERVAL_MS` — worker'ın kuyruğu ne sıklıkla poll
  edeceği.
- `RENDER_JOB_STALE_LOCK_MS` — bir `rendering` job'ın ne kadar süre
  kilitli kalırsa "stale" sayılıp sweep tarafından kurtarılacağı.

**Admin seed**
- `ADMIN_EMAIL` — yalnız `db:seed-admin` tarafından okunur, API boot'unda
  gerekmez.
- `ADMIN_PASSWORD` — aynı, yalnız `db:seed-admin` tarafından okunur.

**App ports/public URLs**
- `API_PORT` — API'nin dinlediği port.
- `API_HOST` — API'nin bind edildiği host.
- `NEXT_PUBLIC_API_URL` — dashboard'ın API'ye erişmek için kullandığı taban
  URL.

**Security/CORS/cookies**
- `API_CORS_ORIGIN` — CORS izin verilen origin.
- `UPLOAD_MAX_SIZE_MB` — yükleme boyutu üst sınırı.
- `ALLOWED_FILE_TYPES` — izin verilen dosya uzantıları/tipleri.
- `LOG_LEVEL` — log ayrıntı seviyesi.
- `NODE_ENV` — çalışma ortamı (`development`/`production`/vb.).
- `PHOTOSHOP_WORKER_URL` / `PHOTOSHOP_WORKER_ENABLED` — parked özellik,
  devre dışı bırakılmış tutulmalı (Photoshop/PSD handoff hiç
  uygulanmadı).

---

## 5. First deployment sequence

> **Docker Compose staging alternatifi (Production Step 2, YENİ):** aşağıdaki
> 18 adımlık bare-metal/manuel sıra hâlâ geçerli ve bu belgenin birincil
> prosedürü — ama STAGING için artık ikinci bir yol da var:
> `docker-compose.staging.yml` (repo kökü) + `apps/api/Dockerfile` +
> `pnpm run staging:up`/`staging:down`. Bu, aşağıdaki adım 1-11'i (checkout →
> install → env → migrate → API start → health check) tek bir container
> stack'ine sarar; adım 12-17 (seed/smoke) hâlâ container İÇİNDE elle
> çalıştırılır (`docker compose exec api ...`) — otomatik zincirlenmiş
> DEĞİL, bilinçli bir tercih (bu belgenin §6'sının "migration otomatik bir CI
> adımı değil" ilkesiyle tutarlı). Tam detay, tasarım kararları ve
> sınırlamalar için bkz. [`docs/staging-compose.md`](./staging-compose.md) —
> o belge burada TEKRARLANMIYOR, yalnız çapraz referans veriliyor. Bu
> alternatif artık gerçek bir Docker daemon'a karşı çalıştırılıp doğrulandı
> (Production Step 2B): `staging:up` → migrate → `/api/health`,
> `/api/health/ready` → `smoke:staging` → `staging:down`/`staging:up`
> reprodüksiyonu, hepsi yeşil. Bu süreçte 2 gerçek bug bulunup düzeltildi
> (eksik `.dockerignore`, kullanılmayan `tsconfig` `composite` ayarı) ve 1
> ortam sorunu (Docker Desktop'ın bu makinedeki dosya sistemi katmanı,
> `COPY`'lenen kaynak üzerinde `tsc`'nin bazı workspace paketleri için
> deterministik olmayan şekilde sıfır çıktı üretmesine yol açıyor) kök
> nedeni tam bulunamadan geçici bir çözümle (host'ta önceden build edilmiş
> `packages/*/dist`'in image'a taşınması) aşıldı. Tam detay, tasarım
> kararları ve sınırlamalar için bkz.
> [`docs/staging-compose.md`](./staging-compose.md) — o belge burada
> TEKRARLANMIYOR, yalnız çapraz referans veriliyor.
>
> **Production Step 2C sonucu (reprodüksiyon doğrulaması, YENİ):** İki senaryo
> gerçek Docker'a karşı test edildi — (A) mevcut repo'da `staging:down` →
> `staging:up`, hiç `--no-cache` ya da Docker Desktop restart olmadan: PASS.
> (B) tamamen temiz bir `git clone`'da, belgelenmiş "önce host'ta `pnpm run
> build`, sonra `staging:up`" akışıyla: PASS. İki senaryoda da `smoke:staging`
> `2 pass, 2 warn, 1 skip, 0 fail` verdi. Sonuç: `--no-cache` veya Docker
> Desktop restart artık HİÇBİR senaryoda gerekmiyor — ama Step 2B'nin
> workaround'ı (3 paketin `dist/`'inin host'ta önceden build edilmiş olması
> şartı) hâlâ YÜRÜRLÜKTE ve kaldırılmadı; bu yüzden temiz bir clone/CI runner
> için akış hâlâ "clone → install → host build → staging:up" — sıfır adımlı
> değil, ama tekrarlanabilir ve script'lenebilir tek bir ek adım. Tam detay
> için bkz. [`docs/staging-compose.md`](./staging-compose.md)'deki
> "Production Step 2C" bölümü.
>
> **Production Step 3 sonucu (CI Stable Test Profile, YENİ):** Step 2C'nin
> "clone → install → host build → staging:up" akışı artık script'lendi —
> root `package.json`'a `ci:stable` (`typecheck && lint && build &&
> test:ci`, Docker/secret YOK), `ci:staging` (→ `scripts/ci-staging.sh`: host
> `build` → `staging:up` → health poll → `db:migrate` → `smoke:staging`,
> `staging:down` bir `trap ... EXIT` ile BAŞARI/HATA fark etmeksizin her zaman
> çalışıyor — iki ayrı zorlanmış-hata testiyle doğrulandı) ve `ci:all`
> eklendi. `test:ci` (yeni, `--maxWorkers=1`) — mevcut `test:stable`
> (`--maxWorkers=2`, dokunulmadı) yerine — bu adımın KENDİ doğrulaması
> sırasında CANLI bulunan bir sorun yüzünden eklendi: `ci:staging` her
> denemede PASS oldu, ama test suite bu makinede bugün 5 tam-suite
> denemesinin sadece 1'inde temiz geçti (worker sayısından/retry'dan
> bağımsız, her seferinde FARKLI rastgele testler, izolede hepsi PASS) —
> önceden belgelenen "yük hassasiyeti" teknik borcuyla tutarlı, YENİ bir
> regresyon değil, bu adımın kapsamında ÇÖZÜLMEDİ. Repo'da hiç GitHub
> remote'u olmadığından (`git remote -v` boş) bir `.github/workflows/ci.yml`
> şimdilik EKLENMEDİ — bilinçli tercih, gerekçesi ve drop-in-hazır workflow
> YAML'ı [`docs/ci-stable-profile.md`](./ci-stable-profile.md)'de. Tam
> dürüst detay (hangi testler, kaç deneme, ne denendi) o belgede — burada
> TEKRARLANMIYOR.

Aşağıdaki adımlar gerçek script isimleriyle — hiçbiri icat edilmedi, her
biri `package.json`/`apps/api/package.json`'da doğrudan doğrulandı.

```bash
# 1. Repo checkout
git clone <repo> && cd Grafista-AI-Studio   # veya mevcut checkout'u kullan

# 2. Dependency install
pnpm install

# 3. Env file creation
cp .env.example apps/api/.env
# apps/api/.env'i doldur — §3/§4'teki profile göre (local/staging/production)

# 4. Postgres connectivity check (dedike bir script yok — doğrudan doğrula)
psql "$DATABASE_URL" -c "SELECT 1;"

# 4b. Backup + restore drill doğrulaması (YALNIZ production, staging/local'de
# opsiyonel — bkz. docs/backup-restore-runbook.md, Production Step 9/10)
# Migration'ı çalıştırmadan ÖNCE: (a) mevcut instance'ın güncel bir backup'ı
# alınmış olmalı (docs/backup-restore-runbook.md §3a), (b) en az bir kez
# staging'de bu backup'tan restore drill'i başarıyla tamamlanmış olmalı —
# artık script'le tekrarlanabilir:
scripts/restore-drill-staging.sh
# (Production Step 10'da staging'de PASS ile doğrulandı — bkz.
# docs/backup-restore-runbook.md §12. Bu script YALNIZ staging/local
# compose stack'ine karşı çalışır, production'a karşı ÇALIŞTIRILAMAZ —
# kendi güvenlik guard'ları bunu reddeder.) Bu adım bugün OTOMATİZE
# DEĞİL — elle tetikleniyor, bir CI job'ı veya cron değil; §6'nın
# "backup ZORUNLU ama otomatize eden bir tool yok" notuyla aynı, insan
# disiplinine bağlı bir gate.

# 5. Migration run
pnpm --filter @grafista/api run db:migrate
# (001'den bugünkü en yüksek numaralı migration'a kadar sırayla uygulanır;
#  bugün en yüksek numara 025_render_worker_heartbeats.sql)

# 6. Storage bucket check (yalnız STORAGE_PROVIDER=s3 ise)
# Adapter bucket'ı OTOMATİK OLUŞTURMAZ — S3_BUCKET'ta belirtilen bucket'ın
# zaten var olduğunu ve kimlik bilgilerinin çalıştığını manuel doğrula.

# 7. Playwright/Chromium runtime check (yalnız RENDERER_PROVIDER unset/'playwright' ise)
cd apps/api && npx playwright install chromium && cd ../..

# 8. API start
pnpm run dev:api                 # geliştirme/staging hızlı yol
# production/derlenmiş yol:
pnpm run build && pnpm --filter @grafista/api run start   # node dist/index.js

# 9. Dashboard start
pnpm run dev:dashboard            # geliştirme/staging hızlı yol
# production/derlenmiş yol: apps/dashboard içinde `next build` + `next start`

# 10. GET /api/health check (liveness)
curl -sf http://localhost:4000/api/health

# 11. GET /api/health/ready check (readiness — bkz. §8 için "degraded" yorumu)
curl -s http://localhost:4000/api/health/ready | jq .

# 12. Roles/permissions + örnek client seed (db:seed-admin'den ÖNCE gerekir)
pnpm --filter @grafista/api run db:seed

# 13. Admin (login) kullanıcısı seed
ADMIN_EMAIL=... ADMIN_PASSWORD=... \
  pnpm --filter @grafista/api run db:seed-admin

# 14. Demo seed — YALNIZ staging/local, PRODUCTION'DA ASLA
pnpm --filter @grafista/api run db:seed-demo

# 15. Fake-provider smoke (demo akışı, ağ yok)
cd apps/api && npx vitest run src/__tests__/demo-flow.test.ts && cd ../..

# 16. Real-provider smoke — opsiyonel/kontrollü (staging'de önerilir, prod'da dikkatli)
set -a; source apps/api/.env; set +a
pnpm --filter @grafista/api run smoke:providers

# 17. Render queue smoke (RENDER_QUEUE_ENABLED=true iken)
curl -s http://localhost:4000/api/health/ready | jq '.checks.renderQueue, .checks.workerHeartbeat'

# 18. Artifact download smoke
# Dashboard'dan bir render/export akışı çalıştır, indirilen dosyanın
# beklenen format/magic-byte'lara sahip olduğunu doğrula (manuel — dedike
# bir CLI script yok, bkz. §9).
```

Not: adım 12 (`db:seed`) adım 13'ten (`db:seed-admin`) ÖNCE çalışmalı —
`db:seed-admin` yalnız kullanıcı satırını oluşturur, rol/izin şeması
`db:seed`'e bağımlıdır.

---

## 6. Migration strategy

- **Additive-only disiplin, 25/25 migration'da doğrulanmış:**
  `database/migrations/001_initial_schema.sql`'dan
  `025_render_worker_heartbeats.sql`'e kadar hiçbir dosyada `DROP TABLE`/
  `DROP COLUMN`/yıkıcı bir değişiklik yok — her Phase 3 adımı bunu kendi
  planında açıkça belirtti, `docs/production-readiness-review.md` bunu
  tüm migration'lar üzerinden doğruladı.
- **Production'da migration çalıştırmadan önce backup ZORUNLU** — ama
  bugün bunu otomatikleştiren bir araç/script YOK (`pg_dump`/managed
  Postgres'in kendi snapshot mekanizması kullanılmalı, elle). Bu bir
  prosedür notudur, var olan bir tool'un referansı değildir.
  **GÜNCELLEME (Production Step 9):** bu "backup ZORUNLU" notu artık bir
  prosedüre bağlandı — [`docs/backup-restore-runbook.md`](./backup-restore-runbook.md)
  §3a (backup policy) ve §7 (staging restore drill). Prosedür YAZILDI,
  ama henüz gerçek production verisiyle egzersiz edilmedi (bkz. o
  dokümanın dosya başı uyarısı) — otomatikleştirme hâlâ yok, yalnızca
  artık ne yapılacağı dokümante.
- **Rollback stratejisi:** `docs/production-readiness-review.md`'nin
  bulgusu aynen geçerli — **bugün gerçek bir "migration down" komutu/
  mekanizması YOK; additive-only disiplin FİİLEN rollback stratejisinin
  kendisidir.** Bir hata durumunda geri dönüş yolu, migration'ı tersine
  çeviren bir kod komutu değil, eski bir DB backup/snapshot'ını restore
  etmektir — ve bu ikinci prosedür de (bkz. §11) bugün hiçbir yerde
  dokümante/otomatikleştirilmiş değil.
- **Seed/demo verisi ayrımı korunmalı:** `db:seed` (roller/izinler + örnek
  client) ve `db:seed-admin` (login kullanıcısı) production'da da
  gerçekten gerekli adımlar; `db:seed-demo` **açıkça ayrı, opsiyonel** bir
  script — production ortamına asla çalıştırılmamalı. Üçü otomatik
  zincirlenmediği için (`db:setup` yalnız `db:migrate && db:seed`'i
  zincirler, `db:seed-admin`/`db:seed-demo`'yu DEĞİL) demo verisinin
  kazayla production'a karışması riski düşük, ama sıfır değil — insan
  disiplinine bağlı.
- **Migration sonrası health/ready kontrolü zorunlu:** her migration
  uygulamasından hemen sonra `GET /api/health/ready`'nin `database`
  check'i `ok` dönmeli; `degraded`/`error` dönerse ilerlemeden önce
  araştırılmalı (§8).

---

## 7. Queue/worker production operation

- **`RENDER_QUEUE_ENABLED=true` ne zaman açılmalı?** Staging'de en az bir
  kez "deneme" olarak açılıp worker heartbeat/stale-lock davranışının
  gözlemlenmesinden SONRA — bu davranış bugüne kadar hiçbir gerçek
  ortamda (yalnız testte) egzersiz edilmedi
  (`docs/render-queue-worker-plan.md`: "çoklu-worker/gerçek çökme
  senaryosu hiç test edilmedi"). Production'da kalıcı olarak açık
  tutulması önerilir (senkron render, gerçek Playwright render'ları HTTP
  isteğini bloke eder — kuyruk modu bunu çözer).
- **Worker heartbeat nasıl kontrol edilir?** `GET /api/health/ready`'nin
  `workerHeartbeat` check'i — `render_worker_heartbeats` tablosundan
  (`025_render_worker_heartbeats.sql`) `listRecentHeartbeats()` ile son
  heartbeat'leri okur; eşik `max(RENDER_WORKER_POLL_INTERVAL_MS * 3,
  10000)` ms (varsayılan ayarlarla efektif 10 saniye). `RENDER_QUEUE_ENABLED
  =false` iken bu check her zaman `ok`/"not applicable" döner — asla
  blocker değildir (§8).
- **Stale lock recovery gerçekte ne yapar?** `renderJobsRepo.resetStaleLocks()`
  (`apps/api/src/db/repositories/render-jobs.ts`) — `status='rendering'`
  VE `locked_by IS NOT NULL` VE `started_at` eşiğin (`RENDER_JOB_STALE_LOCK_MS`,
  varsayılan 900000ms/15dk) üzerinde eski olan satırları bulur:
  `attempt_count < max_attempts` ise `pending`'e (kilitler temizlenir,
  `next_run_at=NOW()`, sabit güvenli bir `error_message` notuyla) geri
  döner; `attempt_count >= max_attempts` ise terminal `failed`'e geçer.
  Bu, her poll tick'te `render-worker.ts`'in `sweepStaleRenderLocks()`
  export'u aracılığıyla çalışır — ayrı bir zamanlayıcı/cron GEREKMEZ.
- **Queue depth nasıl izlenir?** `GET /api/health/ready`'nin `renderQueue`
  check'i — `getQueueSummary()` üzerinden `byStatus` (durum başına sayım),
  `staleLockedCount`, `oldestQueuedAgeMs`, `lastRenderedAt` döner.
  `staleLockedCount > 0` ise check `degraded` döner (bu her zaman bir
  gerçek blocker değildir — bkz. §8).
- **Başarısız bir job nasıl incelenir? — bugünkü boşluk açıkça
  doğrulanmış:** **global bir "failed job'lar" listesi/UI'ı YOK.** Bugün
  yalnız iki yol var: (a) `render_jobs WHERE status='failed'` doğrudan SQL
  sorgusu, veya (b) ilgili production job'ın dashboard sayfasını açıp o
  tekil render'ı görmek (client-scoped). Client'lar arası genel bir
  operasyonel görünüm/alarm bugün mevcut değil
  (`docs/production-readiness-review.md`'nin "retry exhaustion görünürlüğü
  zayıf" bulgusuyla birebir tutarlı).
- **Cancel davranışı ne kadar gerçek?** `cancelRenderJob()`
  (`apps/api/src/services/render-worker.ts`) — `pending`/`queued`
  durumundaki bir job HEMEN `cancelled` olur (henüz claim edilmediği
  için). Ama `rendering` durumundaki bir job için yalnız
  `cancellation_requested=true` set edilir; bu bayrak **bir sonraki poll
  tick'te** görülür ve o zaman `cancelled`'a geçer. **Playwright zaten
  render alıyorsa bu render KESİLMEZ, tamamlanır** — bu, bilinçli,
  dokümante edilmiş bir sınırlamadır (`docs/render-queue-worker-plan.md`,
  `docs/phase-3-final-state.md`), yeni bir bulgu değil.

---

## 8. Health/readiness usage

- **`GET /api/health`** — statik process-liveness sinyali
  (`{status:'ok', service, version, timestamp}`), hiçbir bağımlılık
  kontrol etmez. Bir deployment platformunun "process ayakta mı" temel
  probe'u için uygundur — DB düşse bile bu endpoint `ok` döner, bu yüzden
  TEK BAŞINA deploy-başarı kriteri OLMAMALI.
- **`GET /api/health/ready`** — deployment readiness gate'i olmalı: bir
  load balancer/platform trafiği bu endpoint `ok`/`degraded` (HTTP 200)
  döndüğünde yönlendirmeli, yalnız gerçek bir `error` (HTTP 503) durumunda
  durdurmalı. **Önemli nüans:** route'un kendisi `degraded` durumunda da
  HTTP 200 döner (yalnız en az bir check `error` ise 503) — yani HTTP
  status koduna bakan bir platform probe'u "degraded"ı otomatik olarak
  başarısızlık SAYMAZ; bu bilinçli bir tasarım, ama deploy'u onaylayan
  insanın `status` alanının kendisini (yalnız HTTP kodunu değil) okuması
  gerektiği anlamına gelir.
- **`degraded` raporlandığında ne yapılmalı — otomatik blocker değil,
  muhakeme gerektirir:**
  - Tek bir stale-locked job (`renderQueue.staleLockedCount > 0`) —
    genellikle blocker DEĞİL, çünkü sweep bir sonraki tick'te kendisi
    düzeltir (§7); sürekli/artan bir sayıysa (worker hiç çalışmıyor
    olabilir) araştırılmalı.
  - `providers` check'i `degraded` (bir anahtar eksik) — **eğer** gerçek
    görsel üretimi gereken bir müşteri akışı çalışacaksa ve `KIE_AI_API_KEY`
    eksikse, bu GERÇEK bir blocker'dır (visual generation açıkça
    "provider configuration" hatasıyla başarısız olur). **Eğer** ortam
    bilinçli olarak `AI_DEFAULT_PROVIDER=fake` demo modundaysa, aynı
    "eksik anahtar" durumu blocker DEĞİLDİR — fake mod zaten anahtarları
    kullanmaz.
  - `workerHeartbeat` `degraded` — **eğer** `RENDER_QUEUE_ENABLED=true`
    VE hiçbir yakın heartbeat yoksa, bu GERÇEK bir blocker'dır (worker
    loop çalışmıyor olabilir, kuyruktaki job'lar hiç işlenmez). **Eğer**
    `RENDER_QUEUE_ENABLED=false` ise bu check her zaman "not applicable"
    döner (`ok` durumu) — asla blocker değildir, kontrol mantığının kendisi
    bunu garanti eder.

---

## 9. Smoke test checklist

Her madde için bugün GERÇEKTEN var olan mekanizma — icat edilmiş bir
script yok, boşluklar açıkça işaretli:

| Smoke testi | Bugünkü mekanizma |
|---|---|
| DB migration smoke | `pnpm --filter @grafista/api run db:migrate` başarıyla biter mi + `GET /api/health/ready`'nin `database` check'i `ok` mı — dedike bir "migration smoke" scripti yok, bu ikisinin birleşimi bugünkü fiili karşılığı |
| Storage put/get smoke | `smoke:providers`'ın `storage` bölümü (`apps/api/src/scripts/smoke-real-providers.ts`) — local put/get/delete roundtrip |
| Fake provider demo smoke | `apps/api/src/__tests__/demo-flow.test.ts` — tam MVP akışını (client → DesignDNA → ... → render/export → download) `RENDERER_PROVIDER=fake`/`AI_DEFAULT_PROVIDER=fake` ile uçtan uca çalıştırır; her `vitest` çalıştırmasında egzersiz edilir |
| OpenAI smoke | `smoke:providers`'ın `openai` bölümü — tek bir chat completion, auth+routing doğrulaması |
| KIE smoke | `smoke:providers`'ın `kie` bölümü — gerçek bir görsel üretimi, byte indirme+storage+doğrulama |
| Render/export smoke | `smoke:providers`'ın `render` bölümü — gerçek Playwright/Chromium PNG render |
| Artifact download smoke | **Dedike bir mekanizma YOK** — bugün yalnız manuel: dashboard'dan bir export indirip dosyanın format/magic-byte beklentisine uyduğunu elle kontrol etmek. `smoke-staging.ts` (aşağıya bkz.) bunu KAPATMIYOR — bilinçli olarak dışarıda bırakıldı (bkz. `demoFlow` satırı) |
| Analytics event smoke | **Dedike bir mekanizma YOK** — `analytics-events.test.ts` var ama bu bir unit/integration test, "deploy sonrası smoke" olarak adlandırılmış/otomatikleştirilmiş bir akış değil |
| Revision history smoke | **Dedike bir mekanizma YOK** — aynı şekilde `revision-entries.test.ts` var, ayrı bir smoke script yok |
| Queue worker heartbeat smoke | `apps/api/src/__tests__/render-health-ready.test.ts` (15 test) — heartbeat yazımı, stale-lock recovery, `/api/health/ready`'nin `renderQueue`/`workerHeartbeat` check'lerinin doğru dönmesi. **KISMEN formalize edildi (Production Step 2):** `apps/api/src/scripts/smoke-staging.ts`'in `queue` bölümü artık AYRI bir "deploy sonrası çalıştır" CLI komutu olarak bu iki check'i (canlı `/api/health/ready`'den) okuyup PASS/WARN/FAIL/SKIP raporluyor — ama bu YENİ bir doğrulama mekanizması değil, var olan endpoint'in kendi hesapladığı sonucu HTTP üzerinden relay ediyor; asıl davranışsal doğrulama hâlâ `render-health-ready.test.ts`'te |

**Production Step 2 güncellemesi (bu belgenin kendisi tarafından formalize
edildi — YENİ bir bulgu değil, §13'ün önerdiği adımın somut teslimatı):**
`apps/api/src/scripts/smoke-staging.ts` artık gerçek bir "deploy sonrası
çalıştır" komutu olarak var — `app` (liveness), `ready` (tam
`/api/health/ready` özeti, `degraded`'ı WARN olarak, ASLA otomatik FAIL
olarak işlemez), `providers` (anahtar presence/absence relay), `queue`
(renderQueue/workerHeartbeat relay, kapalıyken SKIP) bölümleri. Bu, aşağıdaki
üç maddeyi (fake-provider demo, real-provider connectivity, heartbeat/queue
davranışı) TEK bir komuta bağlamadı — üçü hâlâ ayrı elle tetiklenir
(`vitest run demo-flow.test.ts`, `smoke:providers`, `smoke:staging`) — ama
`smoke:staging`'in kendisi, canlı bir staging dağıtımına karşı çalıştırılan
İLK gerçek HTTP tabanlı smoke mekanizmasıdır. **Artifact download / analytics
/ revision smoke'ları için bugün hâlâ gerçek bir dedike mekanizma yok** —
`smoke:staging`'in `demoFlow` bölümü bunu bilinçli olarak SKIP ile işaretler
ve `demo-flow.test.ts`'e yönlendirir, tam bir authenticated HTTP walkthrough
inşa etmez (bkz. [`docs/staging-compose.md`](./staging-compose.md)). Tam
detay için o belgeye bakın — burada tekrarlanmıyor.

---

## 10. Monitoring checklist

Metriklerin bugün gerçekten hesaplanabilir olup olmadığı — veri var mı,
yoksa yeni enstrümantasyon mu gerekir:

| Metrik | Veri bugün var mı? | Kaynak |
|---|---|---|
| Uptime | **Kısmen** — `GET /api/health` process-liveness sağlar, ama kalıcı bir uptime kaydı/geçmişi tutan bir sistem yok | `apps/api/src/routes/health.ts` |
| Ready status | **Evet** | `GET /api/health/ready`'nin `status` alanı |
| Queue depth | **Evet** | `GET /api/health/ready`'nin `renderQueue.byStatus` |
| Stale locked count | **Evet** | `GET /api/health/ready`'nin `renderQueue.staleLockedCount` |
| Failed render jobs (sayı) | **Kısmen** — `renderQueue.byStatus.failed` sayıyı verir, ama HANGİ job'ların failed olduğunu listeleyen bir endpoint yok (§7'nin doğruladığı boşluk) | `getQueueSummary()` |
| Last worker heartbeat | **Evet** | `GET /api/health/ready`'nin `workerHeartbeat.details.mostRecent` |
| Provider error count | **Kısmen — veri var, dedike bir sayım endpoint'i yok** | `analytics_events` tablosunda `visual_generation_failed`/`render_job_failed` event'leri var, `analyticsEventsRepo.getClientSummary()` client-scoped bir özet döner ama tüm client'lar arası tek bir "provider hata sayacı" YOK |
| Render duration | **Türetilebilir, ama yüzeye çıkarılmamış** — `render_jobs.started_at`/`finished_at` her ikisi de var, aradaki fark hesaplanabilir, ama bunu döndüren bir endpoint/alan bugün yok | `022_render_jobs_queue.sql` alanları |
| Storage errors | **Yok** — storage adapter'ının kendi hatalarını sayan/kaydeden bir mekanizma yok, yalnız çağıran kodun try/catch'i (best-effort, bkz. §12) | — |
| Artifact download count | **Kısmen** — `export_artifact_downloaded` analytics event'i kaydediliyor (best-effort, sessizce kaybolabilir), ama bunu toplayan tek bir global sayaç/endpoint yok | `analytics-events.ts` |

**Sonuç:** `renderQueue`/`workerHeartbeat`/`ready status` zaten canlı
veriden hesaplanıyor (bugün başka hiçbir şey yazmadan izlenebilir);
`provider error count`/`render duration`/`storage errors`/`artifact
download count` ise ya ham veri var ama yüzeye çıkarılmamış (yeni bir
endpoint/agregasyon gerektirir) ya da hiç kaydedilmiyor (yeni
enstrümantasyon gerektirir) — bu ayrım, gelecekte bir "Monitoring
Dashboard Mini Panel" implementasyonunun tam olarak ne inşa etmesi
gerektiğini belirler (§13).

---

## 11. Backup/restore

> **GÜNCELLEME (Production Step 10):** §7'deki staging restore drill
> artık GERÇEKTEN çalıştırıldı (`scripts/restore-drill-staging.sh`) ve
> PASS ile sonuçlandı — Postgres restore VE object-storage restore
> (manuel kopya + checksum) ayrı ayrı kanıtlandı. Tam sonuç
> `docs/backup-restore-runbook.md` §12'de. **Bu hâlâ gerçek production
> verisi/managed Postgres/S3 ile bir egzersiz DEĞİL** — sentetik staging
> verisiyle bir drill. Aşağıdaki maddeler (Step 9'dan) hâlâ teknik olarak
> doğru — hiçbir OTOMASYON eklenmedi (script elle tetikleniyor, bir
> cron/zamanlanmış görev değil) — ama "restore smoke yok" artık "restore
> smoke VAR, elle tetikleniyor, staging'de bir kez doğrulandı" olarak
> okunmalı.

- **PostgreSQL backup:** bugün **otomatik bir backup mekanizması yok** —
  ne bir cron, ne bir script, ne bir dokümante prosedür
  (`docs/production-readiness-review.md`'nin doğruladığı boşluk, burada
  aynen restate ediliyor). Production'a çıkmadan önce en az managed
  Postgres sağlayıcısının kendi otomatik snapshot/PITR özelliği
  etkinleştirilmeli — repo bunu kendi başına sağlamıyor. Somut policy
  (retention, RPO/RTO hedefleri) artık `docs/backup-restore-runbook.md`
  §3a/§3c'de. **Restore MEKANİĞİ artık staging'de kanıtlandı** (§12) —
  eksik olan hâlâ OTOMATİK backup ALMA, restore etme değil.
- **S3/artifact backup:** `STORAGE_PROVIDER=local` modunda **sıfır backup
  hikayesi** — tek instance'ın diski kaybolursa tüm görsel/render/artifact
  geçmişi kalıcı olarak kaybolur (`docs/production-readiness-review.md`,
  confirmed). `s3` modunda bir backup hikayesi olabilir ama bu tamamen S3
  sağlayıcısının kendi versioning/replication ayarına bağlı — repo bunu
  ne yapılandırıyor ne dokümante ediyor. `docs/backup-restore-runbook.md`
  §2, production'da `local` modun hiç kullanılmaması gerektiğini net
  şekilde önerir.
- **Restore smoke:** artık bir script VAR —
  `scripts/restore-drill-staging.sh` (§7'nin/`docs/backup-restore-runbook.md`
  §12'nin otomasyonu) — staging Docker ortamında Postgres + artifact
  restore'unu uçtan uca egzersiz eder, checksum ile doğrular. Elle
  tetikleniyor (bir CI job'ı veya zamanlanmış görev DEĞİL). Bir restore
  denemesi gerekirse artık sıfırdan icat edilmesi GEREKMEZ — script
  zaten bir kez staging'de PASS ile çalıştı (bir gerçek bug bulup
  düzeltti bu süreçte, bkz. `docs/backup-restore-runbook.md` §12).
- **Migration rollback:** §6'ya bkz. — additive-only disiplin fiilen
  rollback stratejisidir, ayrı bir "down migration" tool'u yok.
- **Analytics/revision veri saklama (retention):** bugün **hiçbir
  retention politikası yok** — `analytics_events` ve `revision_entries`
  append-only tablolar, süresiz büyür (`docs/phase-3-final-state.md`'nin
  doğruladığı gibi bu tablolara yazım zaten best-effort ve sessizce
  başarısız olabilir; ayrıca bu tabloların ne zaman/nasıl budanacağına
  dair hiçbir plan da yok). Bu, MVP ölçeğinde acil değil ama production'da
  uzun süre çalışırsa disk/performans etkisi doğurabilecek, bugün tamamen
  ele alınmamış bir boşluktur.

---

## 12. Known limitations

Aşağıdakilerin HİÇBİRİ bu runbook'un yeni bulgusu değil — her biri
`docs/production-readiness-review.md` veya `docs/phase-3-final-state.md`'de
zaten tespit edilmiş, burada yalnız deployment bağlamında yeniden
listeleniyor:

- **Gerçek deployment config'i bugün mevcut değil** — bu runbook bir
  PLAN'dır, gerçekleştirilmiş bir deployment değil. Repo'da `Dockerfile`,
  `docker-compose.yml`, `fly.toml`, `railway.json`, `render.yaml` —
  hiçbiri yok.
- **CI/CD yok** — `.github/` dizini repo'da mevcut değil, başka bir CI
  config'i de yok; `pnpm run test:stable`/`pnpm run check:release`
  bugün yalnızca yerel bir konvansiyon, hiçbir otomatik pipeline
  her PR/push'ta çalıştırmıyor.
- **Çoklu-worker yatay ölçek koordinasyonu test edilmedi** — `SELECT ...
  FOR UPDATE SKIP LOCKED` teorik olarak doğru claim semantiği sağlar, ama
  "2 API instance = 2 worker aynı tabloyu poll ediyor" senaryosu hiçbir
  testte gerçek eşzamanlı iki process ile egzersiz edilmedi.
- **In-flight render iptali sınırlı** — §7'de detaylandırıldığı gibi,
  `cancellation_requested` yalnız bir sonraki poll'da görülür, mevcut
  Playwright render'ı kesilmez.
- **Test suite'inde dokümante edilmiş yük-hassasiyeti/flakiness var** —
  paralel yükte tek bir dosyanın flake edip izole/temiz tam koşuda geçtiği
  tekrar tekrar gözlemlendi; `pnpm run test:stable` (`--maxWorkers=2`)
  çalışan bir workaround, kök neden araştırılmadı.
- **Maliyet takibi gerçek faturalama değil** — `analytics_events.metadata`'daki
  `estimatedCost`, her adapter'ın kendi `AIResponse.usage.estimatedCost`'unu
  yansıtır, adapter'lar arası tutarlılık hiç doğrulanmadı.
- **Photoshop/PSD handoff ertelendi** — tamamen PARKED, sıfır satır
  uygulanmış; `docs/photoshop-automation-plan.md`'nin kendi admisyonu ve
  `docs/phase-3-final-state.md`'nin final kararı (Production Readiness
  Review, Photoshop/PSD değil, doğru sonraki adımdı).

---

## 13. Sonraki implementation önerisi

Dört aday değerlendiriliyor: **CI Stable Test Profile**, **Docker
Compose/Staging Deployment Skeleton**, **Production Smoke Script**,
**Monitoring Dashboard Mini Panel**.

Kullanıcının ön-tercihi: *"CI Stable Test Profile + Production Smoke
Script, deployment config'den ÖNCE gelmeli, çünkü test/smoke güvenilirliği
deployment'tan önce kilitlenmeli."*

**Bu tercih kısmen doğrulanıyor, kısmen doğrulanmıyor — rubber-stamp
değil, gerekçeli bir ayrışma:**

| Aday | Bulgulara karşı değerlendirme |
|---|---|
| **Docker Compose/Staging Deployment Skeleton** | §2'nin gösterdiği gibi, "hangi topoloji" sorusu ZATEN CEVAPLANDI (`docs/production-readiness-review.md`, bu runbook'un §2'sinde restate edildi) — bunu yazmak artık bir KEŞİF değil, bir YAZI/EXECUTION işi. Ama bu, bugün repo'da SIFIR platform config'i olduğu (§12) ve bu runbook'un kendisinin "plan, gerçekleştirilmiş deployment değil" olarak işaretlendiği anlamına geliyor — yani bugün bu proje TEK BİR YERDE bile çalıştırılamaz durumda. Bu, dört adayın içinde tek başına "hiçbir şey yapılmazsa proje asla deploy edilemez" durumunu kapatan tek aday. |
| **Production Smoke Script** | §9'un gösterdiği gibi, gerçek parçalar zaten var ve ÇALIŞIYOR (`demo-flow.test.ts`, `smoke:providers`'ın storage/openai/kie/render bölümleri, `render-health-ready.test.ts`) — eksik olan bunları TEK bir çalıştırılabilir checklist'e (bu runbook'un §9'unun kendisi) bağlayan otomasyon, temel bir yetenek değil. Düşük risk, yüksek pratik değer — mevcut parçaları formalize etmek. |
| **CI Stable Test Profile** | `docs/production-readiness-review.md`'nin KENDİSİ bunu zaten değerlendirdi ve DÖRDÜNCÜ sıraya koydu: flakiness'in kendisi bir CORRECTNESS riski DEĞİL — iki ayrı doküman (`docs/release-readiness.md`, `docs/phase-3-final-state.md`) bunu "yük hassasiyeti, ürün hatası değil" olarak bağımsız doğruladı, VE `--maxWorkers=2` bugün ÇALIŞAN bir workaround. Deployment'ı bu maddeye bağlamak, gerçekte HİÇBİR yeni riski kapatmıyor — zaten iyi çalışan bir workaround'un üstüne inşa edilen bir rahatlık/hijyen işi. |
| **Monitoring Dashboard Mini Panel** | §10'un gösterdiği gibi bazı metrikler için ham veri var ama yüzeye çıkarılmamış (render duration, provider error count) — ama bir monitoring paneli, izlenecek GERÇEK bir dağıtılmış ortam olmadan (bugün YOK, §12) erken; bu aday mantıken Deployment Skeleton'dan SONRA gelmeli. |

**Kullanıcının ön-tercihinin değerlendirmesi:** "Smoke Script önce"
kısmı bulgularla destekleniyor — §9 zaten dağınık halde var olan üç
mekanizmayı formalize etmenin ucuz ve gerçek bir değer olduğunu
gösteriyor. Ama **"CI Stable Test Profile önce" kısmı bulgularla
DESTEKLENMİYOR** — bu tam olarak `docs/production-readiness-review.md`'nin
kendi sıralamasının (B+A → C → D → E, D=CI stable profile en sonda)
tersini önermek olur, ve o sıralamanın gerekçesi (flakiness "correctness
riski değil, yük hassasiyeti", zaten iyi çalışan bir workaround var) bu
belgede yeniden okunduğunda hâlâ geçerli. Deployment config'i
test-flakiness hijyenine bağlamak, bugün projenin HİÇBİR YERDE
çalıştırılamıyor olması (§12) gibi çok daha somut, çok daha acil bir
boşluğu gerekçesiz şekilde erteler.

**NET ÖNERİ: Docker Compose/Staging Deployment Skeleton, Production
Smoke Script ile BİRLİKTE (aynı çalışma diliminde, smoke script bu
runbook'un §9'unu doğrudan otomatikleştirerek) ÖNCE yapılmalı; CI Stable
Test Profile ve Monitoring Dashboard Mini Panel SONRA gelmeli.**
Gerekçe tek cümlede: platform kararı zaten verildi (§2) ve bugün
projenin gerçekleştirilmiş SIFIR deployment'ı var (§12) — bu, dört
adayın içinde tek başına "proje bugün hiçbir yerde çalışamaz" riskini
kapatan tek madde, ve bunu bir smoke script'le (zaten var olan
`demo-flow.test.ts`/`smoke:providers`/`render-health-ready.test.ts`
parçalarını birleştirerek) birlikte yapmak neredeyse aynı çalışma
diliminde ek değer katar; CI test flakiness'i ise repo'nun kendi önceki
review'unun zaten "acil değil, çalışan bir workaround var" olarak
doğruladığı bir madde — deployment'ı ona bağlamanın bulgularla
gerekçelendirilebilir bir yanı yok.

**Önerilen sıralama:** Docker Compose/Staging Deployment Skeleton +
Production Smoke Script (birlikte) → Monitoring Dashboard Mini Panel →
CI Stable Test Profile. Photoshop/PSD (`docs/photoshop-automation-plan.md`)
hâlâ en düşük öncelik, talep doğmadan gündeme alınmaz.

---

## 14. GitHub remote eklendikten sonra ilk CI doğrulama adımları (Production Step 7, GERÇEKTEN YÜRÜTÜLDÜ Production Step 8)

> **GÜNCELLEME (Production Step 8): bu bölümün adımları artık gerçekten
> uygulandı** — repo `git@github.com:serka-tech/grafista_ai.git`'e push
> edildi (kullanıcı onayıyla), ve aşağıdaki 5-run protokolü gerçek bir
> GitHub remote'a karşı çalıştırıldı. Tam sonuç, çalıştırma tablosu ve 3
> bulunan/düzeltilen bug için bkz.
> [`docs/ci-stable-profile.md`](./ci-stable-profile.md)'nin "Production Step
> 8" bölümü — burada TEKRARLANMIYOR. Bu bölümün altındaki adım-adım komut
> dizisi artık bir GELECEK tarifi değil, GERÇEKTEN İZLENMİŞ bir kayıt —
> placeholder'lar (`<GITHUB_REPO_URL>`, `<OWNER>/<REPO>`) tarihsel doğruluk
> için olduğu gibi bırakıldı, ama gerçek çalıştırmada bunların yerine
> `git@github.com:serka-tech/grafista_ai.git` / `serka-tech/grafista_ai`
> kullanıldı.

> Bu bölüm [`docs/ci-stable-profile.md`](./ci-stable-profile.md)'nin
> "Production Step 7 — CI Runner Readiness & Remote Validation Package"
> bölümünün doğrudan operasyonel devamıdır — protokolün TAM gerekçesi orada,
> burada yalnız komut sırası var. Bu repo'da bugün `git remote -v` boş; aşağıdaki
> adımlar bir remote eklendiğinde izlenecek sıra, gerçek bir repo/URL
> UYDURULMADAN. `<GITHUB_REPO_URL>` ve `<OWNER>/<REPO>` placeholder'ları asıl
> değerlerle değiştirilmeden hiçbiri çalıştırılmamalı.

```bash
# 1. Remote'u ekle (henüz eklenmediyse)
git remote add origin <GITHUB_REPO_URL>

# 2. Mevcut branch'i push et (repo'nun bugünkü çalışma branch'i)
git push -u origin phase-2-checkpoint

# 3. .github/workflows/stable-ci.yml artık dormant değil — push'un kendisi
#    "CI" workflow'unu (stable + staging-smoke job'ları) otomatik tetikler
#    (on: push, phase-2-checkpoint dahil — bkz. workflow dosyasının `on:` bloğu).
#    Elle tetiklenecek ayrı bir adım YOK.

# 4. GitHub Actions run'ını kontrol et
gh run list --repo <OWNER>/<REPO> --workflow=stable-ci.yml --limit 5
gh run view --repo <OWNER>/<REPO> <RUN_ID> --log

# 5. Rerun protokolü — docs/ci-stable-profile.md'nin "Remote Runner
#    Validation Protocol"unun 1. maddesi: EN AZ 5 AYRI çalıştırma gerekir.
#    Aynı run'ı yeniden denemek (re-run) bunlardan biri SAYILMAZ — protokolün
#    amacı bağımsız runner örnekleri gözlemlemek, aynı run'ın cache/state'ini
#    tekrar kullanmak değil. Her biri ayrı bir push veya
#    `gh workflow run stable-ci.yml --repo <OWNER>/<REPO>` ile tetiklenmeli.
for i in 1 2 3 4 5; do
  gh workflow run stable-ci.yml --repo <OWNER>/<REPO>
  # her tetiklemeden sonra run'ın bitmesini bekle, sonucu kaydet
  # (docs/ci-stable-profile.md'nin "Remote Runner Validation Protocol"
  # 6. maddesi gereği, o dokümana ekle — burada tekrarlanmıyor)
done

# 6. Başarısızlıkta CI_DEBUG_ROUTES ile tekrar koşma
#    (docs/ci-stable-profile.md Adım 4 — hangi log sinyalini arayacağınız da orada)
gh workflow run stable-ci.yml --repo <OWNER>/<REPO> -f CI_DEBUG_ROUTES=1
# NOT (GÜNCELLEME, Production Step 8): `workflow_dispatch` trigger'ı artık
# stable-ci.yml'e eklendi (tam olarak bu adım 5'teki "5 bağımsız çalıştırma"
# ihtiyacı için) — yukarıdaki `gh workflow run` komutu artık gerçekten
# çalışır, `-f CI_DEBUG_ROUTES=1` inputu ise workflow bir `workflow_dispatch`
# input'u TANIMLAMADIĞI için hâlâ çalışmaz (yalnız tetikleme çalışır, env
# override'ı çalışmaz). CI_DEBUG_ROUTES=1 ile tekrar koşmak istenirse, en
# pratik yol hâlâ geçici bir commit'te `env: { CI_DEBUG_ROUTES: '1' }`'i job
# seviyesinde eklemek, log'u `gh run view --log` ile okumak, sonra o geçici
# env'i geri almaktır — bu, workflow dosyasına kalıcı bir CI_DEBUG_ROUTES
# input desteği eklemek yerine (henüz gerekmeyen bir scope genişletmesi)
# bilinçli bir tercih.
```

**NOT (Production Step 8'in kendi deneyiminden, önceden dokümante edilmemiş
bir ön-koşul):** `gh` CLI bu adımın başında bu makinede kurulu DEĞİLDİ —
`brew install gh` ile kuruldu, ardından kullanıcı kendi terminalinde `gh auth
login` ile (GitHub.com → HTTPS → tarayıcı üzerinden device-code girişi)
interaktif olarak authenticate etti. Bu adım BAŞKA BİRİSİ tarafından
otomatikleştirilemez — OAuth device-code akışı bir insan onayı gerektirir.
`gh auth login` çalıştırılmadan `gh run list`/`gh workflow run`/`gh run
view --log` komutlarının HİÇBİRİ çalışmaz (kimliksiz `gh` CLI çağrıları
kimlik doğrulama hatası verir). Ayrıca: `curl`/doğrudan `api.github.com`
çağrıları kimliksiz de çalışır ama saatte yalnız 60 istekle sınırlıdır
(`GET /rate_limit` ile kontrol edilebilir) — bu adımda gerçekten aşıldı ve
sıfırlanmasını beklemek gerekti; `gh auth login` sonrası bu sınır çok daha
yüksek bir kimlik doğrulanmış limite çıkar.

**Sonucu nereye kaydet:** her çalıştırmanın temiz/başarısız olduğu ve
başarısızsa hangi sınıfa (§gerçek regresyon / bilinen dış-çakışma / başka)
girdiği [`docs/ci-stable-profile.md`](./ci-stable-profile.md)'nin "Remote
Runner Validation Protocol" bölümüne eklenir (append, üzerine yazılmaz) —
burada tekrarlanmıyor. 5/5 temiz olmadan `ci:stable`'ı bir merge gate olarak
kabul etmeyin; 4/5 veya altıysa gerçek oranı dürüstçe raporlayın.

---

## 15. Implementation status update (Backup/Restore Runbook & Managed Storage Decision — Production Step 9)

**YAZILDI — prosedür + karar dokümanı, egzersiz edilmedi.** Bu adımın
hedefi §11'in ve `docs/production-readiness-review.md` §10/§16'nın ortak
tespit ettiği "backup/restore prosedürü hiçbir yerde yazılı değil"
boşluğunu kapatmaktı. Gerçekten kapatılan/kapatılmayan:

- **Kapatıldı:** persistence envanteri (hangi Postgres tablosu/storage
  prefix'i kalıcı, hangisi cache), managed Postgres/S3 için ölçüt ve yön
  önerisi (sağlayıcı SEÇİLMEDİ, yalnızca kriterler), backup policy
  (RPO/RTO hedefleri dahil), adım adım Postgres + object storage restore
  komutları, staging restore drill prosedürü, verification/rollback
  checklist'leri — hepsi [`docs/backup-restore-runbook.md`](./backup-restore-runbook.md)'de.
- **Kapatılmadı (bilinçli, bu adımın kapsamı dışı):** hiçbir otomasyon
  eklenmedi (backup script/cron YOK, hâlâ manuel); hiçbir managed
  Postgres/S3 sağlayıcısı seçilip provizyonlanmadı; staging restore
  drill **gerçekten çalıştırılmadı** — yalnızca nasıl çalıştırılacağı
  yazıldı; hiçbir production deploy yapılmadı, hiçbir migration
  eklenmedi.
- **Bu adımın kendi doğrulaması:** typecheck/lint/build/`ci:stable`/
  `ci:staging` hepsi bu adımda (yalnızca dokümantasyon + `.env.example`
  yorum değişikliği sonrası) tekrar çalıştırıldı — hepsi PASS (kod
  değişikliği yok, beklenen sonuç).
- **Dürüst sonuç:** production deploy'a giden yoldaki "veri güvenliği"
  gate'i artık bir PROSEDÜRE sahip, ama bu prosedür kendisi HENÜZ
  doğrulanmadı. `docs/production-readiness-review.md`'nin bu adımı
  nasıl sınıflandırdığı için bkz. o dosyanın kendi Step 9 güncellemesi.

---

## 16. Implementation status update (Staging Restore Drill Executed — Production Step 10)

**EGZERSİZ EDİLDİ — §15'in bıraktığı "prosedür yazıldı ama hiç
çalıştırılmadı" boşluğu kapandı.** Tam sonuç
[`docs/backup-restore-runbook.md`](./backup-restore-runbook.md) §12'de —
burada yalnızca bu runbook'un kapsamına düşen özet var.

- **Kapatıldı:** yeni `scripts/restore-drill-staging.sh` — §11'in
  prosedürünü (Postgres restore + object-storage restore) staging
  Docker ortamında uçtan uca çalıştırıp checksum'la doğruluyor.
  Güvenlik guard'ları var (NODE_ENV/DATABASE_URL kontrolü, yalnız
  disposable staging compose'a karşı çalışır, `--if-exists`/`--clean`
  gibi güvenli bayraklar). Script GERÇEKTEN çalıştırıldı — ilk deneme
  bir gerçek bug buldu (`psql -t -A`'nın bir `INSERT ... RETURNING`
  komutunun tamamlanma etiketini bastırmadığı), düzeltme sonrası ikinci
  deneme tam PASS oldu.
- **Kapatılmadı (bilinçli, bu adımın kapsamı dışı):** hiçbir otomasyon
  (cron/zamanlanmış görev) eklenmedi — script hâlâ elle tetikleniyor;
  hiçbir managed Postgres/S3 sağlayıcısı seçilip provizyonlanmadı;
  hiçbir production deploy yapılmadı; gerçek production verisiyle hiç
  denenmedi.
- **Bu adımın kendi doğrulaması:** typecheck/lint/build/`ci:stable`/
  `ci:staging` hepsi bu adımda (script + dokümantasyon değişikliği
  sonrası) tekrar çalıştırıldı — hepsi PASS. `bash -n
  scripts/restore-drill-staging.sh` temiz.

### Production öncesi zorunlu gate'ler

Backup/restore prosedürü artık yazılı VE staging'de egzersiz edilmiş
olsa da, **gerçek bir production deploy'a geçmeden önce aşağıdakilerin
HEPSİ tamamlanmış olmalı** — bu liste `docs/production-readiness-review.md`
§16/§18'in dağınık halde bıraktığı açık kalemleri TEK bir gate
listesinde topluyor, yeni bir bulgu değil:

1. **Managed Postgres seçimi** — sağlayıcı seçilip provizyonlanmalı
   (`docs/backup-restore-runbook.md` §2'nin kriterleri: otomatik
   snapshot + PITR zorunlu).
2. **S3-uyumlu object storage seçimi** — sağlayıcı seçilip
   provizyonlanmalı, `STORAGE_PROVIDER=s3` + versioning açık (aynı §2).
   `STORAGE_PROVIDER=local` production'da KULLANILMAMALI.
3. **Backup automation** — günlük otomatik snapshot + haftalık bağımsız
   logical dump gerçekten kurulmalı (bugün bu Step 10 sonrası bile hâlâ
   YOK — yalnız MEKANİK kanıtlandı, otomasyon ayrı bir iş).
4. **Restore drill'in managed altyapıya karşı TEKRAR çalıştırılması** —
   bu Step 10'un drill'i yalnız local Docker'a karşıydı; gerçek managed
   Postgres/S3 seçildikten sonra `scripts/restore-drill-staging.sh`'ın
   (veya onun managed-altyapı eşdeğerinin) O ortama karşı da en az bir
   kez PASS etmesi gerekir.
5. **Final remote CI green** — `docs/ci-stable-profile.md`'nin candidate
   merge gate'i (stable + staging-smoke) production deploy anında da
   güncel/yeşil olmalı, stale bir eski çalıştırmaya güvenilmemeli.

Bu beş madde tamamlanmadan production deploy/canlıya çıkış adımına
geçilmemeli.

---

## 17. Production Infrastructure Provisioning Gate (Production Step 11)

> **Status: CHECKLIST — bu bölümdeki hiçbir madde bu adımda
> İŞARETLENMEDİ.** §16'nın "Production öncesi zorunlu gate'ler" listesi
> yüksek seviyeli beş kalemdi; bu bölüm onun YERİNE geçmiyor, onu somut,
> komut-seviyeli bir provizyonlama checklist'ine açıyor. Karar
> kriterleri/gerekçeler için bkz.
> [`docs/managed-infrastructure-plan.md`](./managed-infrastructure-plan.md) —
> burada TEKRARLANMIYOR, yalnız yürütme sırası var. Tüm komutlar
> placeholder içerir (`<DATABASE_URL>`, `<S3_BUCKET>`, `<S3_ENDPOINT>`,
> `<PRODUCTION_APP_URL>`) — gerçek bir değerle bu adımda hiçbiri
> çalıştırılmadı.

**Sıra önemli** — her madde bir öncekine bağımlı (ör. connection string'i
secret store'a eklemeden önce Postgres instance'ının var olması gerekir).

- [ ] **Managed Postgres oluşturuldu.**
  ```bash
  # Sağlayıcıya özel — bu adımda seçilmedi (bkz. managed-infrastructure-plan.md §3a).
  # Sağlayıcının kendi CLI/konsolu ile: PostgreSQL 14+, pgvector desteği
  # (varsa) veya PGVECTOR_ENABLED=false kararı netleştirilmiş olmalı.
  ```
- [ ] **PITR/snapshot aktif.**
  ```bash
  # Sağlayıcıya özel — otomatik günlük snapshot AÇIK, destekleniyorsa PITR AÇIK.
  # Doğrulama: sağlayıcının kendi arayüzünde "backups enabled: true" / eşdeğeri.
  ```
- [ ] **DB connection string secret store'a eklendi.**
  ```bash
  # Platform-native secret store'a (bkz. managed-infrastructure-plan.md §3f):
  <PLATFORM_CLI> secrets set DATABASE_URL="<DATABASE_URL>" --env production
  # DATABASE_URL sslmode=require İÇERMELİ (docs/backup-restore-runbook.md §3a).
  ```
- [ ] **S3 bucket oluşturuldu.**
  ```bash
  # Sağlayıcıya özel — bu adımda seçilmedi (bkz. managed-infrastructure-plan.md §3b).
  # Adapter bucket'ı OTOMATİK OLUŞTURMAZ (apps/api/src/storage/factory.ts) —
  # <S3_BUCKET> bucket'ı sağlayıcının kendi CLI/konsolunda önceden oluşturulmalı.
  ```
- [ ] **Versioning aktif.**
  ```bash
  # Örnek (AWS S3 CLI syntax'ı — seçilen sağlayıcıya göre uyarlanmalı):
  aws s3api put-bucket-versioning --bucket <S3_BUCKET> \
    --versioning-configuration Status=Enabled --endpoint-url <S3_ENDPOINT>
  ```
- [ ] **Lifecycle policy tanımlandı.**
  ```bash
  # Yalnız regenerable prefix'e (render-jobs/*/exports/*) — kalıcı tier'a
  # (brand-assets/, design-references/, generated-outputs/) UYGULANMAMALI.
  # (docs/backup-restore-runbook.md §3b'nin ayrımı — burada tekrarlanmıyor.)
  ```
- [ ] **Least privilege access key oluşturuldu.**
  ```bash
  # S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY yalnız PutObject/GetObject/
  # ListBucket yapabilmeli — bucket silme/policy değiştirme YAPAMAMALI
  # (managed-infrastructure-plan.md §3b'nin kabul kriteri).
  ```
- [ ] **App runtime env/secrets girildi.**
  ```bash
  # §4'ün (managed-infrastructure-plan.md) tam listesi — değer YOK, yalnız isim:
  <PLATFORM_CLI> secrets set AUTH_SECRET="$(openssl rand -hex 32)" --env production
  <PLATFORM_CLI> env set STORAGE_PROVIDER=s3 S3_REGION=<...> S3_BUCKET=<S3_BUCKET> \
    S3_ENDPOINT=<S3_ENDPOINT> NEXT_PUBLIC_API_URL=<PRODUCTION_APP_URL> \
    API_CORS_ORIGIN=<PRODUCTION_APP_URL> COOKIE_SECURE=true \
    RENDER_QUEUE_ENABLED=true --env production
  <PLATFORM_CLI> secrets set S3_ACCESS_KEY_ID="<...>" S3_SECRET_ACCESS_KEY="<...>" \
    OPENAI_API_KEY="<...>" ANTHROPIC_API_KEY="<...>" \
    KIE_AI_API_KEY="<...>" KIE_AI_BASE_URL="<...>" --env production
  ```
- [ ] **Worker runtime env/secrets girildi.**
  ```bash
  # AYRI bir runtime DEĞİL (managed-infrastructure-plan.md §3d) — worker,
  # App runtime (üst madde) ile AYNI instance/process. Bu madde yalnızca
  # yanlışlıkla ayrı bir worker servisi provizyonlanmadığının doğrulaması:
  <PLATFORM_CLI> services list --env production
  # Beklenen: tek bir API+worker servisi, ikinci bir "worker" servisi YOK.
  ```
- [ ] **Domain/DNS hazır.**
  ```bash
  # <PRODUCTION_APP_URL> domain'inin DNS kaydı (A/CNAME) hedef platforma
  # işaret ediyor — sağlayıcının kendi domain-bağlama adımları.
  ```
- [ ] **SSL hazır.**
  ```bash
  # Platformun kendi TLS terminasyonu (çoğu PaaS otomatik) veya ayrı bir
  # reverse proxy/sertifika — seçilen hosting kararına bağlı
  # (managed-infrastructure-plan.md §3c). Doğrulama:
  curl -sf https://<PRODUCTION_APP_URL>/api/health
  ```
- [ ] **Backup automation planlandı.**
  ```bash
  # Managed Postgres'in otomatik snapshot'ı (üstteki madde) + haftalık
  # pg_dump'ın sağlayıcıdan BAĞIMSIZ ikinci bir konuma yazılması
  # (docs/backup-restore-runbook.md §3a) — "planlandı" burada "otomatik
  # olarak ÇALIŞIYOR" anlamına gelir, yalnız dokümante edilmiş bir niyet
  # DEĞİL.
  ```
- [ ] **Restore drill managed altyapıya karşı tekrar çalıştırılacak.**
  ```bash
  # scripts/restore-drill-staging.sh bugün YALNIZ local/staging Docker
  # compose stack'ine karşı çalışır (kendi güvenlik guard'ları bunu
  # zorunlu kılıyor) — managed altyapıya karşı EŞDEĞER bir drill
  # gerekir; tam gerekçe ve fark için bkz.
  # docs/backup-restore-runbook.md'nin "Managed Infrastructure
  # Requirements" bölümü. Bu adım PASS almadan production deploy YOK.
  ```

**Bu checklist'in HİÇBİR maddesi bu Step 11'de tamamlanmadı** — hepsi
gerçek bir provider hesabı/provizyonlama gerektiriyor, ki bu adımın
kapsamı dışı (bkz. `docs/managed-infrastructure-plan.md` §1). Bu bölüm,
bir sonraki adımın (gerçek provizyonlama) başlayacağı somut, sıralı
listedir.

---

## 18. Staging Deployment Gate — Option A (Production Step 12)

> **Status: CHECKLIST + PROVIDER-AGNOSTİK AKIŞ — bu bölümdeki hiçbir
> madde bu adımda İŞARETLENMEDİ, hiçbir gerçek provider hesabı açılmadı,
> hiçbir staging deploy'u yapılmadı.** Kullanıcı
> `docs/managed-infrastructure-plan.md` §7'nin Option A/B/C
> seçeneklerinden **Option A'yı seçti** (bkz.
> `docs/managed-infrastructure-plan.md` §7'nin güncellenmiş işareti ve
> yeni §8 "Option A Provider Short-List"). Bu bölüm o kararın STAGING
> tarafındaki somut, sıralı checklist'i — §17'nin PRODUCTION provisioning
> checklist'inin YERİNE geçmiyor, ondan ÖNCE gelen bir ara adım (staging
> önce, production sonra — Option A'nın 7. prensibi,
> `docs/managed-infrastructure-plan.md` §7).

### 18a. GitHub branch seçimi

Staging deploy'un hangi branch'ten tetikleneceği — bu adımda bir karar
VERİLMEDİ, yalnızca seçenek netleştiriliyor: bugünkü çalışma branch'i
`phase-2-checkpoint`'tir (`git status -sb` ile bu adımın başında
doğrulandı). Çoğu Option A adayı (Railway/Render/Fly, bkz.
`docs/managed-infrastructure-plan.md` §8c) bir branch'i doğrudan staging
ortamına bağlayabiliyor — **hangi branch'in (`phase-2-checkpoint` mi,
yoksa ayrı bir `staging` branch'i mi) kullanılacağı bir "decision
required"** (provider seçimiyle birlikte netleşecek, bu adımın kapsamı
dışı).

### 18b. Checklist

Her madde bir öncekine bağımlı olabilir (ör. env/secrets girmeden önce
runtime'ın var olması gerekir) — **hiçbiri bu adımda işaretlenmedi,
gerçek provizyonlama gerektiriyor:**

- [ ] GitHub branch seçimi netleşti (§18a — bugün henüz decision required).
- [ ] Staging app runtime (dashboard, Next.js) oluşturuldu.
- [ ] Staging API runtime oluşturuldu.
- [ ] Staging worker runtime oluşturuldu VEYA worker strategy belirlendi —
      **Option A'da bu ayrı bir provizyonlama ADIMI DEĞİL**, §9'un
      doğruladığı gibi worker API runtime'ıyla AYNI instance; bu madde
      yalnızca "yanlışlıkla ayrı bir worker servisi açılmadı" doğrulaması.
- [ ] Managed staging Postgres oluşturuldu.
- [ ] Staging S3 bucket oluşturuldu.
- [ ] Env/secrets eklendi (§18c'nin tam listesi).
- [ ] Migration çalıştırıldı (`pnpm --filter @grafista/api run db:migrate`,
      staging Postgres'e karşı).
- [ ] API health PASS (`GET /api/health` → 200; `GET /api/health/ready`
      okunup `database`/`storage` check'lerinin `ok` olduğu doğrulandı —
      `docs/deployment-runbook.md` §8 doktrini: genel `status`un
      `degraded` olması tek başına blocker değil).
- [ ] Frontend/API bağlantısı doğrulandı (`NEXT_PUBLIC_API_URL` staging
      API'ye işaret ediyor, dashboard'dan bir istek gerçekten API'ye
      ulaşıyor).
- [ ] Upload/render artifact smoke test PASS (`pnpm --filter @grafista/api
      run smoke:staging`'in `queue`/`providers` bölümleri VEYA elle bir
      upload+render+download döngüsü).
- [ ] Restore drill managed staging altyapıya karşı tekrarlandı —
      `docs/backup-restore-runbook.md` §13/§14'ün gate'i, bu adımda
      YAPILMADI.
- [ ] GitHub Actions deploy workflow doğrulandı — bugün AKTİF bir deploy
      workflow'u YOK (bkz. §18d), yalnızca pasif bir template var
      (`docs/staging-deploy-workflow-template.yml`).

### 18c. Staging env/secrets matrisi

**Değer YOK — yalnızca isim, amaç, required/optional/debug-only.** Bu
tablo `docs/managed-infrastructure-plan.md` §4'ün genel env/secrets
matrisini STAGING PROFİLİNE daraltıyor — o matrisin YERİNE geçmiyor,
`.env.staging.example`'ın (bkz. `docs/staging-compose.md`) staging'e özgü
varsayılanlarıyla çapraz okunmalı. **Güncelleme (Production Step 13):**
somut sağlayıcı (Render + Cloudflare R2) seçildiği için "Not" kolonu artık
o sağlayıcılara özgü — genel/sağlayıcı-agnostik hali hâlâ
`docs/managed-infrastructure-plan.md` §4'te.

| Değişken | Amaç | Durum (staging) | Not |
|---|---|---|---|
| `NODE_ENV` | Çalışma ortamı | **Optional/konvansiyonel** | `docs/managed-infrastructure-plan.md` §4'ün doğruladığı gibi kod bunu okumuyor — staging'de `production` veya `staging` değeri set edilebilir, davranışı DEĞİŞTİRMEZ |
| `DATABASE_URL` | Managed staging Postgres connection string | **Required** — boot'ta Zod fail-fast | `apps/api/src/config/env.ts:21-26`; Render Postgres'te elle kopyalanmaz — Render Blueprint'in `fromDatabase: {name, property: connectionString}` mekanizmasıyla otomatik bağlanır, bkz. §20b |
| `AUTH_SECRET` | Session imzalama anahtarı | **Required** — boot'ta Zod fail-fast | Staging için AYRI, production'dan FARKLI bir değer üretilmeli (`openssl rand -hex 32`) — `docs/ci-stable-profile.md` Production Step 8'in CI'da zaten yaptığı gibi |
| `OPENAI_API_KEY` | OpenAI API anahtarı | **Required (presence-only)** — boot'ta Zod fail-fast, `AI_DEFAULT_PROVIDER=fake` iken bile dummy bir string zorunlu | `apps/api/src/config/env.ts:11` — **düzeltme, bu adımda eklendi:** bu satır Step 12'nin ilk taslağında eksikti, adversarial doc-review workflow'u bulup doğruladı |
| `ANTHROPIC_API_KEY` | Anthropic API anahtarı | **Required (presence-only)** — boot'ta Zod fail-fast, `AI_DEFAULT_PROVIDER=fake` iken bile dummy bir string zorunlu | `apps/api/src/config/env.ts:12` — aynı düzeltme |
| `STORAGE_PROVIDER` | `local` \| `s3` | **Required, staging'de `s3` önerilir** | Option A'nın 6. prensibi (local disk YOK) staging için de geçerli — bugünkü `docker-compose.staging.yml` skeleton'ı `local` kullanıyor (`docs/backup-restore-runbook.md` §1d'nin bilinçli basit-başlangıç kararı), R2'ye geçişte `s3`'e çevrilmeli |
| `S3_BUCKET` | Staging bucket adı (R2) | **Required, `STORAGE_PROVIDER=s3` iken** | `<R2_BUCKET_STAGING>` — production bucket'ından AYRI olmalı, bkz. §19a |
| `S3_REGION` | Bucket bölgesi | **Required, `STORAGE_PROVIDER=s3` iken** | R2-özel: `auto` — Cloudflare'ın kendi dokümantasyonu, bkz. §19d |
| `S3_ENDPOINT` | R2'nin S3-uyumlu endpoint'i | **Required (R2 için — AWS S3'ten farklı olarak boş bırakılamaz)** | `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` — Cloudflare'ın kendi dokümantasyonundan doğrulanmış format, bkz. §19d |
| `S3_ACCESS_KEY_ID` | Bucket erişim kimliği | **Required (secret), `STORAGE_PROVIDER=s3` iken** | R2 "Object Read & Write" token'ı, `<R2_BUCKET_STAGING>`'e scope'lu, least-privilege, production'dan AYRI bir key — bkz. §19c |
| `S3_SECRET_ACCESS_KEY` | Bucket erişim sırrı | **Required (secret), `STORAGE_PROVIDER=s3` iken** | Aynı token'ın secret'ı — asla commit edilmez, bkz. §19c |
| `S3_FORCE_PATH_STYLE` | Path-style adresleme zorunluluğu | **Doğrulanmadı, R2 için — provizyonlama sırasında test edilmeli** | Cloudflare'ın S3-uyumluluk dokümantasyonu bu konuda açık değil, bkz. §19d |
| `NEXT_PUBLIC_API_URL` ("PUBLIC_APP_URL"/"API_BASE_URL"'in bu repo'daki karşılığı) | Dashboard'ın API'ye erişim URL'i | **Required, dashboard runtime'ı için** | `docs/managed-infrastructure-plan.md` §4'ün zaten netleştirdiği gibi ayrı bir "genel app URL" kavramı bugün kodda YOK |
| `API_CORS_ORIGIN` ("API_BASE_URL" kavramının API tarafındaki karşılığı) | API'nin izin verdiği origin | **Required, staging domain'iyle** | Staging dashboard URL'i neyse ona eşit olmalı |
| `LOG_LEVEL` | Log ayrıntı seviyesi | **Optional, kod tarafından okunmuyor** | `docs/managed-infrastructure-plan.md` §4'ün doğruladığı gibi — yalnızca gelecekteki bir implementasyon için ayrılmış isim |
| `CI_DEBUG_ROUTES` | Teşhis middleware'i | **Debug-only, staging'de AÇILABİLİR (production'da ASLA)** | `apps/api/src/middleware/debug-routes.ts` — staging bir CI/test ortamı sayıldığı için gerçek bir spurious-failure teşhisinde geçici olarak açılması güvenli, kalıcı açık BIRAKILMAMALI |
| `CI_DEBUG_ROUTES_LOG_FILE` | Teşhis logunun dosya çıktısı | **Debug-only, optional** | Yalnız `CI_DEBUG_ROUTES=1` ile birlikte anlamlı |
| `RENDERER_PROVIDER` | `playwright` \| `fake` | **Staging'de `fake` ÖNERİLİR (ilk bring-up)** | `docker-compose.staging.yml`'in bugünkü varsayılanı (Chromium riski sıfırlanır); gerçek render doğrulaması istenirse `playwright`'a çevrilebilir, rebuild GEREKMEZ (`docs/staging-compose.md`'nin "pure env flip" notu) |
| `AI_DEFAULT_PROVIDER` | AI provider routing | **Staging'de `fake` ÖNERİLİR** | `docs/deployment-runbook.md` §3'ün zaten koyduğu staging profili — gerçek anahtarlarla sınırlı/kontrollü bir `smoke:providers` koşusu AYRI, isteğe bağlı bir adım |
| `RENDER_QUEUE_ENABLED` | Queue/worker modu | **Staging'de `true` ÖNERİLİR (deneme amaçlı)** | `docs/deployment-runbook.md` §3'ün zaten koyduğu ilke — production'a geçmeden önce worker heartbeat/stale-lock davranışının gerçek (laptop-dışı) bir ortamda ilk kez gözlemlendiği yer |
| `COOKIE_SECURE` | HTTPS-only cookie | **Staging'de `true` önerilir (HTTPS varsa)** — **düzeltme (Step 11'de doğrulandı):** kodun kendi default'u `false`, fail-fast DEĞİL | Staging domain'i HTTPS sunuyorsa `true` set edilmeli, aksi halde varsayılan `false` sessizce kalır |

### 18d. Provider-agnostic staging deploy akışı

**Henüz gerçek bir provider seçilmediği için burada AKTİF bir deploy
workflow'u YOK** — `.github/workflows/` bugün yalnız `stable-ci.yml`
içeriyor (kod-doğruluğu gate'i, Production Step 7/8), bir deploy adımı
EKLENMEDİ. Aşağıdaki akış, HANGİ Option A adayı seçilirse seçilsin
geçerli olan, sağlayıcıdan bağımsız adım sırasıdır — somut komutlar
sağlayıcı seçildikten sonra netleşir:

1. **Build** — `pnpm install --frozen-lockfile && pnpm run build` (tüm
   workspace paketleri; `apps/api`/`apps/dashboard` dahil, §2C/Step 8'in
   zaten belgelediği host-build-first gereksinimiyle tutarlı, eğer seçilen
   platform kendi Docker build'ini yapıyorsa bu adım platformun kendi CI
   image'ına taşınır).
2. **Deploy** — seçilen platformun kendi deploy mekanizması (`git push`
   ile otomatik, veya `railway up`/`flyctl deploy`/eşdeğeri — sağlayıcıya
   özel, bu adımda seçilmedi).
3. **Migrate** — `pnpm --filter @grafista/api run db:migrate`, staging
   `DATABASE_URL`'ine karşı, deploy SONRASI ama trafiğin tam
   yönlendirilmesinden ÖNCE (`docs/deployment-runbook.md` §6'nın
   "migration sonrası health/ready kontrolü zorunlu" ilkesiyle tutarlı).
4. **Health check** — `curl -sf <STAGING_URL>/api/health` (liveness) ve
   `GET /api/health/ready` (dependency readiness, §8 doktrini).
5. **Smoke** — `pnpm --filter @grafista/api run smoke:staging` (host'tan,
   staging URL'ine karşı — bugünkü `scripts/ci-staging.sh`'ın YAPTIĞI
   şeyin managed-staging karşılığı, local Docker yerine gerçek bir
   deploy'a karşı).
6. **Restore drill** — `docs/backup-restore-runbook.md` §13/§14'ün
   managed-staging drill'i, PASS almadan production'a geçilmez.

Bu altı adımın GitHub Actions'a nasıl bağlanacağının PASİF bir taslağı
[`docs/staging-deploy-workflow-template.yml`](./staging-deploy-workflow-template.yml)'de
— **bu dosya `.github/workflows/` İÇİNDE DEĞİL, aktif bir workflow
DEĞİL**, yalnızca sağlayıcı seçildiğinde uyarlanacak bir başlangıç
noktası. Gerçek secret isimleriyle (§18c) uyumlu ama hiçbir secret DEĞERİ
içermiyor.

**Bu bölümün HİÇBİR maddesi bu Step 12'de tamamlanmadı** — hepsi gerçek
bir provider hesabı/provizyonlama/deploy gerektiriyor, ki bu adımın
kapsamı dışı (bkz. `docs/managed-infrastructure-plan.md` §1 ve bu
belgenin görev tanımının kendi sınırı).

---

## 19. Cloudflare R2 Staging Setup (Production Step 13)

> **Status: HAZIRLIK ADIMLARI — bu adımda hiçbir Cloudflare hesabı
> açılmadı, hiçbir bucket oluşturulmadı, hiçbir access key üretilmedi.**
> Kullanıcı Option A'nın somut S3-uyumlu storage sağlayıcısı olarak
> **Cloudflare R2**'yi seçti
> (`docs/managed-infrastructure-plan.md` §9). Bu bölüm gerçek
> provizyonlama sırasında izlenecek adımları, doğrulanmış Cloudflare
> dokümantasyonuna dayanarak tarif ediyor — hiçbir adım bu Step 13'te
> gerçekten YÜRÜTÜLMEDİ.

### 19a. Staging bucket oluştur

1. Cloudflare dashboard → R2 Object Storage → "Create bucket".
2. Bucket adı: `<R2_BUCKET_STAGING>` (production bucket'ından AYRI
   olmalı — ortamlar arası veri karışmasını önler, `docs/deployment-runbook.md`
   §18c'nin zaten koyduğu ilke).
3. Bölge/jurisdiction: sağlayıcının sunduğu seçenekler arasından —
   Türkiye'den latency'yi optimize eden seçim provizyonlama sırasında
   test edilmeli (`docs/managed-infrastructure-plan.md` §8b'nin zaten
   işaretlediği "decision required" notu).

### 19b. Versioning/lifecycle kararlarını uygula — DÜZELTİLMİŞ mekanizma

**Bu adımda yapılan araştırma, önceki bir varsayımı YANLIŞ bulup
düzeltti** — bkz. `docs/managed-infrastructure-plan.md` §9c ve
`docs/backup-restore-runbook.md` §3b'nin güncellenmiş notu. Kısa özet:
R2, S3-style bucket versioning'i DESTEKLEMİYOR (Cloudflare'ın kendi güncel
dokümantasyon indeksinde bu konuya dair tek bir sayfa yok, S3 API
uyumluluk referansı `GetBucketVersioning`/`PutBucketVersioning`'i
"Unimplemented bucket-level operations" tablosunda ❌ ile işaretliyor —
**düzeltme:** bu belgenin önceki hali bunu yanlışlıkla Cloudflare'dan
DOĞRUDAN bir alıntı gibi sunmuştu, gerçek sayfa o literal ifadeyi
içermiyor; sonuç aynı, atıf düzeltildi, bkz.
`docs/managed-infrastructure-plan.md` §9c).
Bu yüzden aşağıdaki adımlar "versioning açma" DEĞİL, R2'nin GERÇEKTEN
sunduğu iki mekanizmayı kullanıyor:

1. **Bucket Locks (kalıcı tier için, `brand-assets/`, `design-references/`,
   `generated-outputs/` prefix'lerine karşılık gelen bucket için)** —
   Cloudflare dashboard → bucket → Settings → "Object Lifecycle
   Rules"/"Bucket Locks" (Cloudflare'ın kendi dokümantasyonuna göre
   dashboard, Wrangler CLI veya API ile yapılandırılabilir) — süresiz
   veya uzun süreli bir retention kilidi ÖNERİLİR. **Önemli sınırlama
   (Cloudflare'ın kendi dokümantasyonundan doğrulandı):** kilit
   AKTİFKEN bucket boşaltılamaz/silinemez — bu, staging bucket'ının
   test amaçlı sık sık temizlenmesi gerekiyorsa dikkate alınmalı bir
   trade-off.
2. **Lifecycle rules (yalnız regenerable tier için,
   `render-jobs/*/exports/*` prefix'i)** — bu GERÇEKTEN destekleniyor
   (dashboard/Wrangler/S3 API'nin hepsinden) — eski export'lar 90 gün
   sonra expire edilebilir (`docs/backup-restore-runbook.md` §3b'nin
   maliyet-kontrolü ilkesiyle tutarlı).
3. **Kalıcı tier için asıl geri-getirme mekanizması artık versioning
   DEĞİL, haftalık logical dump/ayrı bir backup kopyasıdır** —
   `docs/backup-restore-runbook.md` §3a'nın "sağlayıcıdan bağımsız
   ikinci konum" ilkesi burada object storage'a da genişletiliyor. Bu,
   bu adımın kapsamında bir OTOMASYON DEĞİL — yalnızca hangi mekanizmanın
   doğru olduğunun netleşmesi.

### 19c. Access key oluştur — least privilege

1. Cloudflare dashboard → R2 → "Manage API Tokens" (Account Details
   altında).
2. Token tipi: **Object Read & Write**, **yalnızca `<R2_BUCKET_STAGING>`
   bucket'ına scope'lanmış** (Cloudflare'ın kendi dokümantasyonu: "Object
   Read and Write" ve "Object Read only" izinleri belirli bucket'lara
   scope'lanabiliyor — bu izin seviyeleri yalnızca S3-uyumlu API
   üzerinden destekleniyor, Cloudflare REST API'sinden DEĞİL).
3. Bucket-seviyesi silme/policy değişikliği için AYRI, daha yüksek
   yetkili bir "Admin" token KULLANILMAMALI — uygulamanın kendi
   `S3_ACCESS_KEY_ID`'si yalnızca Object Read & Write olmalı
   (`docs/backup-restore-runbook.md` §3b'nin "least privilege" ilkesiyle
   tutarlı).
4. Token oluşturulduğunda dönen Access Key ID + Secret Access Key —
   **bu adımda hiçbiri üretilmedi, gerçek bir değer bu dokümanda YOK.**

### 19d. S3 endpoint formatı ve env/secrets eşlemesi

Cloudflare'ın kendi dokümantasyonundan doğrulanmış, gerçek format:

```
S3_ENDPOINT=https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
S3_REGION=auto
```

`S3_REGION=auto` — Cloudflare'ın kendi notu: "the region for an R2 bucket
is `auto`... an empty value and `us-east-1` will alias to the `auto`
region" — yani bu repo'nun `.env.example`'daki `S3_REGION=us-east-1`
varsayılanı R2 için de TEKNİK OLARAK çalışır, ama `auto` açık ve doğru
olan değer.

**`S3_FORCE_PATH_STYLE` — DOĞRULANMADI:** Cloudflare'ın S3-uyumluluk
dokümantasyonu path-style'a karşı virtual-hosted-style adresleme
konusunda AÇIK bir ifade içermiyor. Bu belge bir varsayım YAPMIYOR —
provizyonlama sırasında `apps/api/src/storage/s3-provider.ts`'nin gerçek
davranışına karşı test edilmeli (bkz. `docs/managed-infrastructure-plan.md`
§9d'nin "decision required/verify" notu).

| Env değişkeni | R2'deki karşılığı |
|---|---|
| `STORAGE_PROVIDER` | `s3` |
| `S3_ENDPOINT` | `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `S3_REGION` | `auto` |
| `S3_BUCKET` | `<R2_BUCKET_STAGING>` |
| `S3_ACCESS_KEY_ID` | §19c'nin ürettiği token'ın Access Key ID'si (secret) |
| `S3_SECRET_ACCESS_KEY` | §19c'nin ürettiği token'ın Secret Access Key'i (secret) |
| `S3_FORCE_PATH_STYLE` | Doğrulanmadı — provizyonlama sırasında test edilmeli |

## 20. Render Postgres Staging Setup (Production Step 13)

> **Status: HAZIRLIK ADIMLARI — bu adımda hiçbir Render hesabı açılmadı,
> hiçbir Postgres servisi oluşturulmadı.** Kullanıcı Option A'nın somut
> managed Postgres sağlayıcısı olarak **Render Postgres**'i seçti
> (`docs/managed-infrastructure-plan.md` §9).

### 20a. Postgres service oluştur

1. Render dashboard → New → PostgreSQL (veya
   `docs/render-staging-blueprint.template.yaml`'daki `databases:`
   bloğunun sync'lenmesiyle).
2. İsim: `grafista-postgres-staging`, `databaseName: grafista_staging`,
   `user: grafista` (template'in zaten önerdiği değerler).
3. Postgres major version: `16` (bu repo'nun kendi minimum gereksinimi
   "PostgreSQL 14+", `docker-compose.staging.yml`'in kullandığı
   `postgres:16-alpine` ile parite için `16` önerilir).
4. Plan/region: **decision required** — bu belge güncel fiyat/plan
   iddiası YAPMIYOR.

### 20b. `DATABASE_URL` secret olarak bağla

`docs/render-staging-blueprint.template.yaml`'ın zaten modellediği gibi,
`grafista-api-staging`'in `DATABASE_URL` env değişkeni Render'ın kendi
`fromDatabase: {name: grafista-postgres-staging, property:
connectionString}` mekanizmasıyla OTOMATİK bağlanabilir — elle bir
connection string kopyalamak GEREKMEZ (Render'ın kendi Blueprint
özelliği). **Bu adımda hiçbir gerçek `DATABASE_URL` üretilmedi/yazılmadı.**

### 20c. Migration çalıştır

```bash
# Render Postgres'e (staging) karşı, gerçek provizyonlama SONRASI:
DATABASE_URL="<RENDER_STAGING_DATABASE_URL>" \
  pnpm --filter @grafista/api run db:migrate
```

Bu komut `docs/deployment-runbook.md` §5 adım 5'in ZATEN belgelediği
`db:migrate` script'inin AYNISI — sağlayıcı DEĞİŞTİ, komut değişmedi
(`apps/api/src/db/migrate.ts`'in sağlayıcı-agnostik tasarımı).

### 20d. `schema_migrations` kontrol et

```bash
psql "<RENDER_STAGING_DATABASE_URL>" \
  -c "SELECT filename, applied_at FROM schema_migrations ORDER BY filename;"
```

`docs/backup-restore-runbook.md` §5 adım 3'ün zaten belgelediği
doğrulama — 001'den bugünkü en yüksek numaralı migration'a (bugün
`025_render_worker_heartbeats.sql`) kadar EKSİKSİZ olmalı.

### 20e. Connection pooling / PITR / backup notları — production öncesi ZORUNLU gate

- **Connection pooling:** Render Blueprint spec'inin `connectionPool:
  "pgbouncer" | "none"` alanı var (bu adımda doğrulandı) — bu repo'nun
  `apps/api/src/db/pool.ts`'nin kendi `pg.Pool` singleton'ıyla (Production
  Step 4'te connection-leak sorunu bulunup düzeltilen aynı mekanizma)
  etkileşimi HENÜZ test edilmedi — provizyonlama sırasında doğrulanmalı.
- **PITR granülerliği:** `docs/managed-infrastructure-plan.md` §3a'nın
  "Neon/RDS daha granüler PITR sunuyor olabilir" notu Render'a özgü
  olarak HENÜZ doğrulanmadı — bu belge bunu VARSAYMIYOR, provizyonlama
  öncesi Render'ın güncel dokümantasyonundan teyit edilmeli.
- **Backup automation:** `docs/deployment-runbook.md` §17'nin PRODUCTION
  provisioning gate'i ("PITR/snapshot aktif") burada da geçerli — Render
  Postgres'in kendi otomatik snapshot'ı doğrulanmalı, provizyonlama
  sırasında AÇIK olduğu teyit edilmeden production'a geçilmemeli.
- **Restore drill gate DEĞİŞMEDİ:** `docs/backup-restore-runbook.md`'nin
  yeni "Render + R2 Managed Staging Restore Drill" bölümü (bkz. o
  belgenin kendisi) — managed staging altyapıya karşı bir restore drill
  PASS almadan production deploy YOK, bu Step 13'te de DEĞİŞMEDİ.

---

## 21. Render Staging Provisioning — Live Setup Checklist (Production Step 14)

> **Status: LIVE SETUP REHBERİ — bu adımda hiçbir gerçek Render hesabı
> açılmadı, hiçbir servis oluşturulmadı, hiçbir secret girildi.** §18b'nin
> provider-agnostik checklist'i ile §20'nin Postgres-özel adımlarının
> YERİNE geçmiyor — ikisini de Render'a özgü, kullanıcının panelde
> takip edebileceği TEK bir sıralı listeye topluyor. Aşağıdaki her madde
> kullanıcı tarafından Render dashboard'unda (veya Render CLI'ında) ELLE
> yürütülecek — bu Antigravity oturumu hiçbir gerçek hesap/kredi kartı/API
> çağrısı YAPAMAZ.
>
> **Bu adımda kullanıcıdan alınan non-secret kararlar** (ileride bu
> listeyi doldururken kullanılacak):
> - Hesap durumu: Render VE Cloudflare hesaplarının **ikisi de henüz yok**
>   — sıfırdan başlanıyor.
> - Branch: **`phase-2-checkpoint`** (mevcut çalışma branch'i, §18a'nın
>   "decision required" notu bu kullanıcı kararıyla KAPANDI).
> - Bölge tercihi: **Frankfurt/Avrupa** (Türkiye'ye en yakın seçenek) —
>   Render'ın bugünkü bölge listesinde Frankfurt'un gerçekten mevcut
>   olduğu ve tam bölge kodunun ne olduğu **provizyonlama sırasında
>   Render dashboard'undan teyit edilmeli**, bu belge bir varsayım
>   YAPMIYOR.
> - `render.yaml` aktivasyonu: kullanıcı **pasif taslağın kalmasını,
>   servisleri kendisinin Render panelinden manuel kurmasını** seçti —
>   bkz. aşağıdaki "render.yaml kararı" notu.

**Sıra önemli** — her madde bir öncekine bağımlı:

- [ ] **Render hesabı/workspace oluşturuldu.** (render.com üzerinden
      signup — Antigravity bu adımı YAPAMAZ.)
- [ ] **GitHub repo Render'a bağlandı.** Render dashboard → New →
      Web Service (veya Blueprint) → "Connect GitHub" → `serka-tech/grafista_ai`
      repo'sunu seç → Render'ın GitHub App'ine yetki ver.
- [ ] **Branch seçildi: `phase-2-checkpoint`.** (Kullanıcı kararı, yukarı
      bkz. — §18a'nın decision required'ı kapandı.)
- [ ] **Render Postgres (`grafista-postgres-staging`) oluşturuldu** — §20a'nın
      adımları, bölge: Frankfurt/Avrupa (yukarıdaki doğrulama notuyla).
- [ ] **API Web Service (`grafista-api-staging`) oluşturuldu** —
      `docs/render-staging-blueprint.template.yaml`'ın modellediği gibi
      Docker runtime, `dockerfilePath: apps/api/Dockerfile`,
      `dockerContext` repo kökü. **Provizyonlamadan ÖNCE o dosyanın
      HIGH-RISK notunu oku** — bugünkü Dockerfile host-build-first bir
      workaround'a dayanıyor, Render'ın Docker build'inin bunu nasıl
      etkileyeceği HENÜZ test edilmedi (bkz.
      `docs/production-readiness-review.md`'nin Step 13 güncellemesi).
- [ ] **Dashboard Web Service (`grafista-dashboard-staging`) oluşturuldu** —
      native Node runtime (`buildCommand`/`startCommand`, Docker YOK —
      `apps/dashboard`'ın hiç Dockerfile'ı yok, bu doğrulandı).
- [ ] **Worker stratejisi doğrulandı: AYRI bir worker servisi
      PROVİZYONLANMADI.** Bu bir "hangisini seçelim" sorusu DEĞİL —
      `RENDER_QUEUE_ENABLED=true` yalnızca API service'in kendi
      process'inde çalışır (`docs/managed-infrastructure-plan.md`
      §3d/§9a'nın zaten kapattığı karar). Render'da "New Background
      Worker" gibi ikinci bir servis AÇILMAMALI — açılırsa
      `docs/production-readiness-review.md` §7'nin hiç test edilmediğini
      belirttiği çoklu-worker senaryosu istemeden tetiklenir.
- [ ] **Environment variables girildi** — bkz. aşağıdaki §23 (panel
      bazlı tam eşleme).
- [ ] **Health check path ayarlandı: `/api/health`** (API service'in
      Render ayarlarında "Health Check Path" alanı — bu repo'nun mevcut,
      DEĞİŞTİRİLMEMİŞ liveness endpoint'i, §8 doktrini).
- [ ] **Deploy trigger ayarı yapıldı: başlangıçta `off`.**
      `docs/render-staging-blueprint.template.yaml`'ın zaten koyduğu
      güvenli varsayılan — ilk manuel deploy başarıyla bitene KADAR
      otomatik deploy AÇILMAMALI; başarılı ilk deploy'dan SONRA
      "Auto-Deploy: on commit"e çevrilebilir.

**`render.yaml` kararı (bu Step 14'te netleşti):** kullanıcı, gerçek
provizyonlama zamanı geldiğinde `docs/render-staging-blueprint.template.yaml`'ı
repo köküne aktif bir `render.yaml` olarak taşımak yerine, servisleri
Render dashboard'undan **elle** kurmayı seçti. Bu, o şablon dosyasının
kendi başındaki gerekçeyle (Render'ın bir `render.yaml`'ı otomatik
algılayıp sync teklif etmesi, henüz doğrulanmamış bir Dockerfile
build-risk'i taşıyan bir şablondan gerçek servis oluşturma riski)
TUTARLI — şablon dosyası PASİF kalmaya devam ediyor, bu adımda
`render.yaml` olarak kopyalanmadı/aktifleştirilmedi. Kullanıcı ileride
fikrini değiştirip aktifleştirmeyi isterse, bu ayrı bir açık onay
gerektirir (bkz. görev tanımının kendi §7 sınırı).

---

## 22. Cloudflare R2 Staging Live Setup Checklist (Production Step 14)

> **Status: LIVE SETUP REHBERİ — bu adımda hiçbir Cloudflare hesabı
> açılmadı, hiçbir bucket oluşturulmadı, hiçbir access key üretilmedi.**
> §19'un hazırlık adımlarının YERİNE geçmiyor, onu kullanıcının panelde
> takip edebileceği bir checklist'e çeviriyor.

- [ ] **Cloudflare hesabı oluşturuldu.** (cloudflare.com üzerinden signup
      — Antigravity bu adımı YAPAMAZ.)
- [ ] **R2 Object Storage aktifleştirildi** (bazı yeni hesaplarda R2 için
      ayrı bir "Enable R2" adımı istenebilir — Cloudflare dashboard → R2).
- [ ] **Staging bucket oluşturuldu.** Önerilen isim:
      `<R2_BUCKET_STAGING>` (§19a'nın ilkesi — production bucket'ından
      AYRI olmalı). Kullanıcı henüz kesin bir isim belirtmedi; bu belge
      bir isim UYDURMUYOR, provizyonlama sırasında kullanıcı kendi
      adlandırma tercihiyle (ör. `grafista-assets-staging`,
      `.env.example`'daki `S3_BUCKET=grafista-assets` konvansiyonuyla
      tutarlı bir öneri) doldurabilir.
- [ ] **Bucket Locks kararı uygulandı** (kalıcı tier —
      `brand-assets/`, `design-references/`, `generated-outputs/`
      prefix'leri için) — **VERSIONING DEĞİL**, §19b'nin düzeltilmiş
      mekanizması: WORM-tarzı bir retention kilidi, eski versiyonu geri
      GETİRMEZ, yalnızca kilit süresince silme/üzerine-yazmayı ENGELLER.
- [ ] **Lifecycle rules tanımlandı** (yalnız regenerable tier —
      `render-jobs/*/exports/*` prefix'i için, §19b/§3b'nin ayrımı).
- [ ] **Access key oluşturuldu — least privilege.** Token tipi: "Object
      Read & Write", yalnızca staging bucket'ına scope'lu (§19c) — bucket
      silme/policy değiştirme yetkisi olan bir "Admin" token
      KULLANILMAMALI.
- [ ] **S3-compatible endpoint alındı.** Format (Cloudflare'ın kendi
      dokümantasyonundan doğrulanmış, §19d):
      `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`,
      `S3_REGION=auto`.
- [ ] **`S3_FORCE_PATH_STYLE` davranışı test edildi.** §19d'nin
      DOĞRULANMADI notu hâlâ geçerli — Cloudflare'ın S3-uyumluluk
      dokümantasyonu path-style'a karşı virtual-hosted-style konusunda
      açık değil; provizyonlama sırasında `apps/api/src/storage/s3-provider.ts`'nin
      gerçek davranışına karşı test edilmeli, bir değer VARSAYILMAMALI.
- [ ] **Render API service env'ine S3\_\* secret'ları girildi** — bkz.
      aşağıdaki §23 (hangi panelde hangi değişken).

---

## 23. Staging Env/Secrets Entry Guide — Panel Mapping (Production Step 14)

> **Değer YOK — yalnızca hangi PANELE hangi değişkenin gireceği.** §18c
> zaten her değişkenin amacını/required-optional durumunu listeledi — bu
> bölüm o listenin YERİNE geçmiyor, ona "hangi Render servisinin env
> sekmesine, yoksa GitHub Secrets'a mı" sorusunu ekliyor. Bu repo'da
> gerçek env değişken isimleri görev tanımının kullandığı jenerik
> isimlerden (`PUBLIC_APP_URL`, `API_BASE_URL`) FARKLI —
> `docs/managed-infrastructure-plan.md` §4'ün zaten netleştirdiği eşleme
> burada da geçerli: `PUBLIC_APP_URL` → `NEXT_PUBLIC_API_URL`,
> `API_BASE_URL` → `API_CORS_ORIGIN`.

### 23a. Render API service (`grafista-api-staging`) env sekmesi

| Değişken | Durum | Not |
|---|---|---|
| `NODE_ENV` | Optional/konvansiyonel | Kod bunu okumuyor (§4'ün doğruladığı gibi) — `production` set edilebilir, davranışı DEĞİŞTİRMEZ |
| `DATABASE_URL` | **Required** | Elle YAZILMAZ — Render Blueprint'in `fromDatabase: {name: grafista-postgres-staging, property: connectionString}` mekanizmasıyla OTOMATİK bağlanır (§20b); panelden manuel kurulumda Render "Connect to a Database" seçeneğiyle aynı sonucu verir |
| `AUTH_SECRET` | **Required (secret)** | `openssl rand -hex 32` ile ÜRETİLİP Render'ın kendi secret alanına girilir — asla repoya/chat'e yazılmaz |
| `STORAGE_PROVIDER` | **Required** | Değer: `s3` |
| `S3_BUCKET` / `S3_REGION` / `S3_ENDPOINT` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | **Required (son ikisi secret)** | §22'nin R2 checklist'inden gelen değerler |
| `S3_FORCE_PATH_STYLE` | Doğrulanmadı | §22'nin son maddesi test edilene kadar boş/varsayılan bırakılabilir |
| `API_CORS_ORIGIN` | **Required** | `grafista-dashboard-staging`'in Render URL'i — bu servis oluşturulmadan bilinemez (circular dependency, blueprint template'in kendi notu) |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | **Required (presence-only secret)** | `AI_DEFAULT_PROVIDER=fake` iken bile dummy bir string zorunlu (boot fail-fast) |
| `AI_DEFAULT_PROVIDER` / `RENDERER_PROVIDER` | **Required, staging'de `fake` önerilir** | İlk bring-up için Chromium/gerçek AI çağrısı riski sıfırlanır |
| `RENDER_QUEUE_ENABLED` | **Required, staging'de `true` önerilir** | Worker davranışını gerçek (laptop-dışı) bir ortamda ilk kez gözlemlemek için (§3) |
| `COOKIE_SECURE` | **Required, `true`** | Render kendi domain'lerinde TLS terminasyonu yapıyor (§18c) |
| `CI_DEBUG_ROUTES` | **Debug-only** | Staging'de geçici açılabilir, PRODUCTION'DA ASLA |
| `CI_DEBUG_ROUTES_LOG_FILE` | **Debug-only, optional** | Yalnız `CI_DEBUG_ROUTES=1` ile birlikte anlamlı |
| `LOG_LEVEL` | Optional | Kod okumuyor (§4) — kozmetik |

### 23b. Render Dashboard service (`grafista-dashboard-staging`) env sekmesi

| Değişken | Durum | Not |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | **Required** | `grafista-api-staging`'in Render URL'i — aynı circular-dependency notu, bu servis API'den SONRA (veya en azından API'nin URL'i bilindikten sonra) doldurulabilir |

### 23c. Render worker env sekmesi

**Ayrı bir panel YOK.** Worker, API service'in kendi process'i
(`RENDER_QUEUE_ENABLED=true`, §21'in "worker stratejisi" maddesi) — 23a
dışında girilecek hiçbir ek env değişkeni/panel yok. Bu satır, görev
tanımının istediği envanteri eksiksiz tutmak için var.

### 23d. GitHub Actions secrets

**Bu Step 14'te GEREKMEZ** — `docs/staging-deploy-workflow-template.yml`
hâlâ `.github/workflows/` DIŞINDA, pasif bir taslak (§18d). Yalnızca
kullanıcı bu şablonu gerçek bir GitHub Actions workflow'una
dönüştürmeye karar verirse, o şablonun kendi sonundaki envanterdeki
isimler (`RENDER_DEPLOY_HOOK_API`, `RENDER_DEPLOY_HOOK_DASHBOARD`,
`STAGING_DATABASE_URL`, `STAGING_API_URL`, vb.) GitHub repo Settings →
Secrets and variables → Actions altına girilir — bu belge o kararı
VERMİYOR, yalnızca ne zaman gerekeceğini netleştiriyor.

---

## 24. Render API Docker Build Fix — Production Step 15

> **§21'in "Render Docker build riski GERÇEKTEN test edilmedi" notu ve
> §13/§21'in HIGH-RISK bulgusu bu adımda KAPANDI — risk gerçek bir
> deploy hatası olarak DOĞRULANDI, kök nedeni bulundu, ve düzeltildi.**
> Gerçek Render staging altyapısı bu adımdan önce kullanıcı tarafından
> provizyonlandı (`grafista-api-staging`, Docker runtime, Frankfurt,
> Starter plan; `grafista-postgres-staging`, Basic-256mb, PostgreSQL 18)
> ve ilk deploy denemesi tam olarak `docs/render-staging-blueprint.template.yaml`'ın
> HIGH-RISK notunun öngördüğü hatayla başarısız oldu: `Error: Cannot
> find module '/repo/apps/api/dist/index.js'`.

**Kök neden — iki katmanlı:**

1. **Yüzey neden:** `apps/api/Dockerfile`'ın build stage'i (Production
   Step 8'den beri) hiçbir workspace paketini container İÇİNDE
   derlemiyordu — her paketin `dist/`'inin HOST'ta önceden build
   edilmiş olmasını ve `COPY . .` ile image'a taşınmasını bekliyordu.
   Bu, `scripts/ci-staging.sh`'in kendi host-build adımıyla (ve her
   geliştiricinin kendi çalışma dizininde biriken, gitignore'lu ama
   diskte duran `dist/` klasörleriyle) hep gizlenmiş bir varsayımdı.
   Render'ın `runtime: docker` servisi ise `docker build`'i doğrudan,
   host-build adımı OLMADAN, taze bir `git clone`'a karşı çalıştırıyor
   — bu yüzden `dist/` hiç var olmadı.
2. **Asıl kök neden — bu adımda YENİ bulundu:** Build stage'e
   `RUN pnpm --filter @grafista/api... run build`'i geri eklemek
   (in-container derleme) tek başına YETMEDİ — gerçek çalışma
   dizinine (temiz bir `git clone`'a değil) karşı test edildiğinde AYNI
   "modül bulunamadı" hatası (bu kez TypeScript derleme hatası olarak,
   `Cannot find module '@grafista/schemas'`) tekrar üretildi. Kaynağı:
   `.dockerignore`'daki bare `*.tsbuildinfo` deseni yalnızca context
   KÖKÜNDEKİ dosyaları hariç tutuyor — `.gitignore`'un aksine, `/`
   içermeyen bir desen bu Docker/BuildKit sürümünde (29.5.2 /
   buildx 0.34.0-desktop.1) İÇ İÇE (nested) dosyaları hariç TUTMUYOR
   (minik bir izole repro ile doğrulandı — aşağıya bkz.). Sonuç: her
   paketin host'ta üretilmiş `tsconfig.tsbuildinfo`'su (TypeScript'in
   `"incremental": true` — `tsconfig.base.json` — çıktısı) sessizce
   image'a kopyalanıyordu; tsc kendi eski build-info'sunu bulunca
   paketi "zaten güncel" sayıp SIFIR dosya emit ediyordu — HER SEFERİNDE,
   %100 deterministik. **Production Step 2B ve Step 8'in "tsc COPY'lenen
   kaynağa karşı güvenilmez" diye kaydettiği bulgu, gerçekte BU tek
   satırlık `.dockerignore` glob bug'ıydı** — bir yıllık host-build-önce
   workaround'ı, aslında root-cause edilebilir, tek satırlık bir düzeltmesi
   olan bir sorun içindi.

**Yapılan düzeltme (yalnızca 2 dosya, hiçbir Render panel ayarı
gerektirmiyor):**

- `apps/api/Dockerfile` — build stage artık `RUN pnpm --filter
  @grafista/api... run build` ile @grafista/api VE workspace
  bağımlılıklarının (schemas, model-router, prompt-engine) hepsini
  in-container, doğru topolojik sırada derliyor (pnpm'in `...` filtre
  sözdizimi). Host-build-ve-kopyala workaround'ı tamamen kaldırıldı.
- `.dockerignore` — `apps/*/dist/` ve `packages/*/dist/` yeniden
  eklendi (artık hiçbir paket host-built dist'e güvenmiyor, hepsi
  in-container build ediliyor) VE `*.tsbuildinfo` → `**/*.tsbuildinfo`
  (asıl kök-neden düzeltmesi — nested tsbuildinfo dosyalarını da
  gerçekten hariç tutuyor).

**Doğrulama (hepsi bu adımda gerçekten çalıştırıldı):**

- Minik izole repro: `*.tsbuildinfo` deseni context kökündeki dosyayı
  hariç tuttu ama `sub/nested.tsbuildinfo`'yu TUTMADI (kopyalandı);
  `**/*.tsbuildinfo` her iki durumu da doğru hariç tuttu.
- Temiz `git clone` (host build hiç çalışmamış, sıfır `dist/`/tsbuildinfo)
  üzerinden `docker build --no-cache --target build`: **4/4 PASS** —
  2× bu makinenin native mimarisinde (arm64), 2× `--platform linux/amd64`
  (Render'ın gerçek mimarisi, QEMU emülasyonuyla) — hepsi
  `apps/api/dist/index.js`'i doğru üretti.
  **Düzeltme ÖNCESİ** aynı temiz clone'a karşı: dist/index.js YOK
  (repro edildi, beklenen).
  **Düzeltme ÖNCESİ, .dockerignore düzeltmesi olmadan, host-build
  artıklarıyla dolu gerçek çalışma dizinine karşı** (`docker build` VE
  `docker compose build`, ikisi de, isole/eşzamanlı başka build
  olmadan): **3/3 FAIL** — `Cannot find module '@grafista/schemas'`,
  yukarıdaki kök-neden analiziyle birebir eşleşen.
  **Düzeltme SONRASI, aynı host-build-artıklı gerçek çalışma dizinine
  karşı**: **2/2 PASS** (determinism doğrulaması) + ayrı bir
  post-COPY inceleme, `.dockerignore`'un artık hiçbir tsbuildinfo'yu
  context'e sızdırmadığını doğrudan gösterdi (COPY'den hemen sonra,
  hiçbir RUN build adımı çalışmadan, container içinde SIFIR
  `*.tsbuildinfo` bulundu).
- `pnpm run typecheck` / `pnpm run lint` / `pnpm run build`: PASS.
- `pnpm run ci:stable`: PASS.
- `pnpm run ci:staging` (gerçek Docker Desktop'a karşı — host build →
  `staging:up` → health poll → migrate → `smoke:staging` →
  `staging:down`, hepsi `docker-compose.staging.yml` üzerinden, düzeltme
  SONRASI): PASS — tam sonuç ve komut tablosu bu adımın kendi final
  raporunda.

**Bu adımda AYRICA olan, plansız ama şeffafça kaydedilen bir olay:**
Doğrulama sürecinde (izole bir `.dockerignore` deseni testi için
kullanılan geçici bir scratch dizinini temizlerken) yanlışlıkla TEK bir
`rm -rf` komutuna gerçek proje dizininin yolu da eklendi ve proje
dizini silindi. Working tree bu adımın başında ZATEN temizdi (`git
status` — commit edilmemiş hiçbir değişiklik yoktu, tek uncommitted
değişiklik bu adımın kendi Dockerfile/.dockerignore fix'iydi ve ayrı bir
scratch kopyası vardı) — bu yüzden `git clone` ile origin'den (GitHub)
sıfır veri kaybıyla tam kurtarıldı, fix dosyaları scratch kopyasından
geri uygulandı. Kaybolan tek şey `.env.staging` (gitignore'lu, secret
İÇERMİYOR, `.env.staging.example`'dan CI'ın kendi yaptığı gibi yeniden
üretildi) idi. Bu olay burada gelecekte benzer bir hatadan kaçınmak için
kaydediliyor, gizlenmiyor.

**Kapatılmadı (bilinçli, dürüstçe restate):**

- Gerçek Render deploy'unun bu fix'le başarılı olacağı %100
  GARANTİ değil — yerel doğrulama (native + amd64 emülasyon, temiz
  clone + gerçek host-build-artıklı senaryo) mümkün olan en yakın
  proxy, ama Render'ın kendi build altyapısına karşı gerçek bir deploy
  hâlâ YAPILMADI (bu adımın kapsamı dışı — "production deploy yapma"
  görev kısıtı).
  Render panelinden yeniden deploy tetiklenmeli ve gerçek log
  doğrulanmalı.
- `.dockerignore`'daki bu bare-pattern-recursion bug'ı sınıfının
  BAŞKA satırlarda da (bu adımda kontrol edilmedi — yalnız
  `*.tsbuildinfo` düzeltildi) gizli olup olmadığı ayrıca denetlenmedi;
  mevcut diğer satırların hepsi ya `/` içeriyor (`node_modules/`,
  `.pnpm-store/`) ya da zaten `**/` prefix'i var (`**/node_modules/`) —
  yalnızca `*.tsbuildinfo` ve `*.psd`/`*.log` gibi bare-glob'lar
  aynı riski taşıyabilir; `*.psd`/`*.log`/`logs/` bu repo için
  build-doğruluğunu etkilemiyor (yalnızca disk/imaj boyutu), bu yüzden
  bilinçli olarak bu adımın kapsamı dışında bırakıldı.
- Env/secret/R2/production deploy/runtime storage refactor'a
  dokunulmadı — görev kısıtına uygun.

---

## 25. Render API Redeploy Validation & Staging API Health Gate (Production Step 16)

> **§24'ün "gerçek Render altyapısına karşı yeniden deploy TETİKLENMEDİ"
> notu bu adımda KAPANDI — Render API staging servisi gerçek ortamda
> boot etti ve `/api/health` doğrulandı.** Step 15'in Docker build
> fix'i (`b785398`) Render'ın kendi build altyapısında da çalıştı;
> ilk deploy'u kesen `Cannot find module '/repo/apps/api/dist/index.js'`
> hatası TEKRARLAMADI. Bu adımda HİÇBİR kod değişikliği yapılmadı —
> yalnızca dış (Render panel) redeploy doğrulandı, health/DB/storage
> gate'leri sınıflandırıldı ve dokümante edildi.

### 25a. Redeploy sonucu

| Alan | Değer |
|---|---|
| Deploy status | **Live** |
| Deploy edilen commit | `b785398` (Step 15 Docker build fix) |
| Servis URL | `https://grafista-api-staging.onrender.com` |
| Build adımı | `RUN pnpm --filter @grafista/api... run build` çalıştı, `apps/api/dist/index.js` üretildi |
| MODULE_NOT_FOUND | TEKRARLAMADI — Step 15 fix gerçek Render ortamında doğrulandı |

Yerel önceden-doğrulama (bu adımın başında, `b785398`'e karşı):
`typecheck`/`lint`/`build`/`ci:stable`/`ci:staging` + `docker build -f
apps/api/Dockerfile` hepsi PASS, image içinde `apps/api/dist/index.js`
doğrulandı (Render'ın çalıştıracağı build'in en yakın yerel proxy'si).

### 25b. Health gate — `/api/health` (liveness)

```
GET https://grafista-api-staging.onrender.com/api/health
→ 200 {"status":"ok","service":"grafista-ai-studio-api","version":"0.1.0",...}
```
**PASS.** Container boot ediyor, process ayakta, liveness sinyali temiz.
Bağımsız olarak bu oturumda `curl` ile doğrulandı (kullanıcının
raporuyla birebir aynı).

**Yan bulgu — port binding artık DOĞRULANDI (§13'ün/§21'in açık
"UNVERIFIED PORT" kalemi kapandı):** uygulama listen portunu `API_PORT`'tan
okuyor, platform-konvansiyonel `PORT`'tan DEĞİL (`apps/api/src/config/env.ts`
+ `src/index.ts:19` `const PORT = env.API_PORT`; tüm `apps/api/src`'te
`process.env.PORT`'a sıfır referans — kod-doğrulaması ile teyit edildi).
`render-staging-blueprint.template.yaml` bunu öngörüp hem `PORT` hem
`API_PORT`'u `4000`'e set etmişti ama "Render'ın port-algılaması env
ismini mi okuyor yoksa TCP probe mu — UNVERIFIED" notu düşmüştü. Public
Render URL'inden `/api/health`'in 200 dönmesi bu soruyu ÇÖZÜYOR: Render'ın
routing'i uygulamanın bağlandığı porta gerçekten ulaşıyor — yani panelde
`API_PORT` doğru set edilmiş ve Render'ın mekanizması bu config'le çalışıyor.
Kod tarafında bir değişiklik GEREKMİYOR; bu yalnızca daha önce açık olan
bir belirsizliğin canlı kanıtla kapanması.

### 25c. Readiness gate — `/api/health/ready` (DB/storage/providers/queue)

```
GET .../api/health/ready → HTTP 200, overall status "degraded"
```
`degraded` HTTP 200'dür ve §8'e göre otomatik bir blocker DEĞİLDİR —
her check ayrı yorumlanır:

| Check | Durum | Yorum |
|---|---|---|
| `database` | **ok** — "database reachable" | **DB bağlantı gate'i (ilk seviye) PASS** — uygulama GERÇEK Render Postgres'e bağlandı. Kanıt: `apps/api/src/routes/health.ts:64` yalnızca `SELECT 1` çalıştırır — bu bir BAĞLANTI kontrolü, ŞEMA kontrolü DEĞİL (bkz. §25d) |
| `storage` | ok — "s3 (config present, no live connectivity check)" | **Yanıltıcı olabilir:** yalnızca `STORAGE_PROVIDER=s3` + S3/R2 env'lerinin VAR olduğunu gösterir; gerçek bir R2 put/get roundtrip'i YAPILMADI (bkz. §25e). Bu "ok" bir CONFIG-presence sinyali, R2'nin çalıştığının kanıtı DEĞİL |
| `providers` | **degraded** — openai:present, anthropic:present, **kie:missing** | Beklenen — `KIE_AI_API_KEY` staging'de bilinçli boş. `overall degraded`'ın ana kaynağı bu. Boot blocker DEĞİL, ama gerçek görsel üretimi (KIE) bu env girilmeden ÇALIŞMAZ |
| `renderQueue` | ok — "queue disabled (RENDER_QUEUE_ENABLED=false)" | Canlı panel `false` (bkz. §25f drift notu) — render'lar senkron çalışır |
| `workerHeartbeat` | ok — "not applicable (queue disabled)" | Queue kapalı olduğu için uygulanmıyor |
| `playwright` | ok — "package resolvable (no browser launched)" | Canlı panel `RENDERER_PROVIDER=playwright` (blueprint `fake` öneriyordu, §25f) — Chromium image'da kurulu ve paket resolve oluyor, ama bu check GERÇEK bir browser başlatmıyor/render denemiyior |

### 25d. DB migration / schema gate — AÇIK (kod-doğrulaması ile netleştirildi)

**`database: ok "reachable"` MIGRATION'ların çalıştığı anlamına GELMEZ.**
Bu adımda doğrudan kaynak-kod doğrulaması yapıldı:

- **Uygulama boot'ta migration ÇALIŞTIRMIYOR** — `apps/api/src/index.ts`
  yalnızca `app.listen(PORT)` (satır 21) + `startRenderWorkerLoop()`
  (satır 31) çağırıyor; hiçbir migration çağrısı yok. Tüm repoda
  `runMigrations`'ı çağıran YALNIZCA `src/test/global-setup.ts` (testler)
  ve migration script'inin kendisi (`src/db/migrate.ts`). Yani
  migration, boot'tan AYRI, elle tetiklenen bir adım (`db:migrate`,
  `apps/api/package.json`).
- **Readiness `database` check'i `SELECT 1`** (`health.ts:64`) — yalnız
  bağlantı; şema/tablo varlığını KONTROL ETMEZ. Bu yüzden Render Postgres
  şu an bağlanılabilir ama büyük olasılıkla ŞEMASIZ (migration'lar hiç
  çalışmadı) — herhangi bir gerçek tablo sorgusu `relation does not exist`
  ile başarısız olur.

**Render Postgres'e migration nasıl çalıştırılır — üç yol, §6'nın
"migration otomatik bir CI adımı değil, kontrollü/elle" ilkesiyle
tutarlı sırada:**

1. **Render Shell (ÖNERİLEN, staging ilk-koşu için):** Render dashboard
   → `grafista-api-staging` → **Shell** sekmesi → container İÇİNDE
   (kod + `DATABASE_URL` env zaten mevcut) şunu çalıştır:
   ```
   pnpm --filter @grafista/api run db:migrate
   ```
   En basit, en kontrollü yol; secret terminale/repoya girmez (env
   Render tarafından zaten enjekte edilmiş). Migration additive-only
   (§6, 25/25 migration'da doğrulandı) olduğundan tek-yönlü güvenli.
   Ardından `db:seed` (roller/izinler) ve gerekiyorsa `db:seed-admin`
   çalıştırılır (§5 adım 12-13 sırası).
2. **Pre-Deploy Command (opt-in, OPSİYONEL — mecbur DEĞİL):** Render
   servis ayarlarındaki "Pre-Deploy Command" alanına
   `pnpm --filter @grafista/api run db:migrate` yazılabilir; her
   deploy'da canlıya geçmeden önce çalışır. **Bu adımda BİLİNÇLİ olarak
   BOŞ bırakıldı** — §6'nın "migration kör bir otomatik adım değil"
   ilkesine ve görevin "mevcut pre-deploy command boş kalmalıysa koru"
   kısıtına uygun. İleride istenirse açık bir tercih olarak eklenebilir.
3. **GitHub Actions (en ağır, şimdilik gereksiz):** `DATABASE_URL`'i
   GitHub Secrets'tan okuyup migrate çalıştırmak mümkün ama DB'nin
   dışarıdan erişilebilir olmasını + secret'ın GH'a girilmesini
   gerektirir — staging ilk-koşu için gerekmez.

**Bu adımda migration ÇALIŞTIRILMADI** — gerçek `DATABASE_URL`'e
bu oturumdan erişilmedi (görev kısıtı). Migration'ı çalıştırmak
kullanıcının Render Shell'de yapması gereken bir SONRAKİ adım.

### 25e. R2 / storage gate — AÇIK (config var, canlı doğrulama YOK)

- `storage: ok` yalnızca `STORAGE_PROVIDER=s3` + S3/R2 env'lerinin
  panelde MEVCUT olduğunu gösteriyor — uygulama BOOT edebiliyor ve
  health gate geçiyor. Ama readiness check'i gerçek bir R2 bağlantısı/
  put-get roundtrip'i YAPMIYOR ("no live connectivity check").
- **Sonuç (görev item 9 ile birebir):** API boot + health PASS, ama
  **upload / render-artifact gate GEÇMEDİ sayılır** — bir dosyanın
  gerçekten R2'ye yazılıp okunabildiği HİÇ doğrulanmadı (bucket var mı,
  credential geçerli mi, path-style doğru mu — hepsi açık). Bu bir
  BLOKAJ olarak kalır: **R2 canlı doğrulanmadan production deploy'a
  geçilmez.**
- Somut doğrulama yolu (gelecek adım): Render Shell'de
  `pnpm --filter @grafista/api run smoke:providers`'ın `storage`
  bölümü (put/get/delete roundtrip) VEYA dashboard'dan gerçek bir
  export indirip R2'de nesnenin oluştuğunu görmek.

### 25f. Canlı panel ile blueprint template farkı (drift — kayıt amaçlı)

`/api/health/ready` canlı env'i açığa çıkardı; iki değer
`docs/render-staging-blueprint.template.yaml`'ın ÖNERDİĞİNDEN farklı
(ikisi de geçerli operasyonel tercih, blocker DEĞİL, ama kayda geçiyor):

| Env | Blueprint önerisi | Canlı panel (Step 16) | Etki |
|---|---|---|---|
| `RENDER_QUEUE_ENABLED` | `true` (staging deneme) | **`false`** | Render'lar senkron çalışır; worker heartbeat/stale-lock davranışı gerçek ortamda HÂLÂ gözlemlenmedi (§7'nin açık kalemi sürüyor) |
| `RENDERER_PROVIDER` | `fake` (güvenli ilk bring-up) | **`playwright`** | Gerçek Chromium render yolu aktif; image Chromium içeriyor (Dockerfile), paket resolve oluyor, ama gerçek bir render bu adımda denenmedi |

Bu drift `docs/render-staging-blueprint.template.yaml`'a kısa bir "canlı
Step 16'da gözlenen değer" notu olarak da eklendi — template'in ÖNERİSİ
değişmedi (öneriler hâlâ geçerli), yalnız canlı gerçek not düşüldü.

### 25g. Kapatılmadı (bilinçli, dürüstçe restate)

- Migration Render Postgres'te ÇALIŞTIRILMADI (§25d) — şema henüz yok.
- R2 canlı bağlantı/upload-artifact roundtrip DOĞRULANMADI (§25e).
- Dashboard (`grafista-dashboard-staging`) deploy EDİLMEDİ — bu adımın
  kapsamı dışı, API health gate'i öncelikli.
- Managed staging restore drill YAPILMADI (`docs/backup-restore-runbook.md`
  §15c hâlâ boş).
- Gerçek görsel üretimi (KIE) doğrulanmadı — `KIE_AI_API_KEY` bilinçli boş.
- Hiçbir kod değişikliği, hiçbir production deploy, hiçbir yeni migration,
  hiçbir runtime storage refactor yapılmadı.

### 25h. Sıradaki somut adım

1. Render Shell'de `pnpm --filter @grafista/api run db:migrate` + `db:seed`
   çalıştır (§25d), ardından `/api/health/ready`'nin `database` check'i
   hâlâ `ok` mı ve gerçek bir authenticated akış çalışıyor mu doğrula.
2. R2 canlı doğrulaması (§25e) — `smoke:providers` storage roundtrip'i
   veya gerçek bir export.
3. İkisi de PASS olduğunda: dashboard deploy → managed restore drill →
   (ancak ondan sonra) production deploy değerlendirmesi.

---

## 26. Staging DB Migration + R2 Live Roundtrip Gate (Production Step 16→17)

> **§25'in bıraktığı iki açık gate — DB migration/şema ve R2 canlı
> roundtrip — bu adımda KAPANDI.** Migration+seed Render Shell'de gerçek
> Render Postgres'e karşı çalıştırıldı; R2 put/get/delete roundtrip'i
> gerçek `grafista-staging-assets` bucket'ına karşı PASS verdi. İki commit
> deploy edildi (`d784185`, `fe61a2d`). Bu adımda gerçek secret değeri
> hiçbir yere yazılmadı — migration/R2 secret'ları Render/Cloudflare
> panelinde kaldı.

### 26a. Render Shell'de çalıştırılan komutlar (operatör, staging container içinde)

`grafista-api-staging` → **Shell** (container'da kod + `DATABASE_URL` +
S3/R2 env'leri Render tarafından enjekte, elle secret girilmedi):
```
pnpm --filter @grafista/api run db:migrate
pnpm --filter @grafista/api run db:seed
pnpm --filter @grafista/api run smoke:providers -- storage
```

### 26b. DB migration / schema gate — PASS (bağımsız doğrulandı)

- `db:migrate` gerçek Render Postgres'e karşı çalıştı.
- **Bağımsız doğrulama (bu oturumdan, secret'sız):** migration ÖNCESİ
  `POST /api/auth/login` (bogus credential) `500 relation "users" does
  not exist` veriyordu; migration SONRASI aynı istek `401 Invalid email
  or password` veriyor. Bu 500→401 geçişi, `users` tablosunun (ve dolayısıyla
  migration'ın gerçekten uygulandığının) doğrudan kanıtı — bu doğrulama
  yalnız public HTTP endpoint'i kullanır, gerçek DB'ye/secret'a hiç
  dokunmaz. `login` handler'ı `usersRepo.findByEmail` (users tablosu)
  çağırdığı için bu temiz bir şema-probe'u (`apps/api/src/routes/auth.ts`).
- `db:seed` (Flavora örnek client) çalıştırıldı — operatör raporuna göre
  başarılı; bu oturumdan bağımsız olarak seed'e özgü ayrı bir signal
  probe edilmedi (seed verisi authenticated endpoint'ler ardında, ve bu
  adımda `db:seed-admin` login kullanıcısı bilinçli oluşturulmadı).

### 26c. R2 canlı roundtrip gate — PASS

- **İlk deneme FAIL etti ve gerçek bir config sorununu ortaya çıkardı**
  (bu, Step 17'nin storage-smoke fix'inin ÇALIŞTIĞININ kanıtı — smoke
  artık gerçekten R2'yi test ediyor, eskiden sessizce local disk'i test
  edip yanıltıcı PASS veriyordu): `[smoke] storage FAIL s3 roundtrip
  threw: S3 upload failed: Invalid URL`.
- **Kök neden:** `S3_ENDPOINT` env'i geçerli bir absolute URL değildi
  (AWS SDK'nın parse edemediği bir değer — büyük olasılıkla `https://`
  şeması eksik veya placeholder). Diğer 4 zorunlu S3 var'ı mevcuttu
  (değilse hata "required env var(s) missing" olurdu). Kod tarafı fix
  (`fe61a2d`): factory artık `S3_ENDPOINT`'i önden doğruluyor ve değeri
  LOGLAMADAN (R2 account id içerir) net bir hata veriyor
  (`apps/api/src/storage/factory.ts`).
- **Operatör düzeltmesi (Render panel):** `S3_ENDPOINT`
  `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` formatına getirildi;
  R2 Access Key ID / Secret, Cloudflare R2 Account API Token'dan
  yenilendi.
- **Sonuç (gerçek Render Shell çıktısı, düzeltme SONRASI):**
  `[smoke] storage PASS s3 put/get/delete roundtrip ok
  (bucket=grafista-staging-assets)` — `1 pass, 0 fail`. Bu roundtrip
  gerçek bir nesneyi R2'ye yazıp okuyup sildiği için, R2 connectivity +
  credential + bucket erişimi CANLI doğrulandı. (Not: `/api/health/ready`
  `storage` check'i tasarım gereği hâlâ yalnız "config present" der —
  canlı roundtrip kanıtı bu smoke çıktısıdır, health endpoint'i değil.)

### 26d. Bu adımın canlı health durumu (bağımsız curl, düzeltme sonrası)

| Endpoint | Sonuç |
|---|---|
| `GET /api/health` | 200 `status:ok` |
| `GET /api/health/ready` | 200 `degraded` — `database:ok`, `storage:ok`(config-presence), `providers:degraded`(kie missing), `renderQueue/workerHeartbeat:ok`(queue kapalı), `playwright:ok` |
| Schema probe (`POST /api/auth/login`, bogus) | 401 (şema mevcut) |

### 26e. Kod değişiklikleri (2 commit, ci:stable 444/444)

- **`d784185`** — storage smoke artık `getStorageProvider()` ile
  YAPILANDIRILAN provider'ı test ediyor (Render'da `s3` → gerçek R2
  roundtrip); `StorageProvider` arayüzüne + iki implementasyona
  `deleteObject` eklendi (idempotent). 5 yeni unit test.
- **`fe61a2d`** — factory'de `S3_ENDPOINT` absolute-URL validation'ı
  (secret'sız, açık hata) + `.env.example`'da https:// şema/R2 endpoint
  formatı netleştirildi. 6 yeni unit test.

### 26f. Kalan açık kalemler (Step 18'e)

- **`KIE_AI_API_KEY` eksik — bilinçli blokaj:** `/api/health/ready`
  `providers:degraded`; gerçek görsel üretimi (KIE) bu env girilmeden
  çalışmaz. Boot blocker değil; bilinçli olarak açık bırakıldı.
- Dashboard (`grafista-dashboard-staging`) deploy edilmedi.
- Worker davranışı (`RENDER_QUEUE_ENABLED=false`) gerçek ortamda hâlâ
  gözlemlenmedi (§7'nin açık kalemi, drift §25f).
- Managed staging restore drill yapılmadı
  (`docs/backup-restore-runbook.md` §15c hâlâ boş).
- Production deploy AÇILMADI.

---

## İlgili dokümanlar

- [`docs/managed-infrastructure-plan.md`](./managed-infrastructure-plan.md) —
  Production Step 11: §17'nin checklist'inin dayandığı karar
  kriterleri/matrisi, env/secrets matrisi, ops decision (Option A/B/C).
  Production Step 12: §7'nin güncellenmiş Option A işareti, §8'in provider
  short-list'i — §18'in doğrudan girdisi. Production Step 13: §9 — somut
  Render + Cloudflare R2 seçimi, §19/§20'nin doğrudan kaynağı.
- [`docs/staging-deploy-workflow-template.yml`](./staging-deploy-workflow-template.yml) —
  §18d'nin pasif GitHub Actions taslağı — AKTİF bir workflow DEĞİL.
  Production Step 13'te Render + R2'ye özgü hale güncellendi.
- [`docs/render-staging-blueprint.template.yaml`](./render-staging-blueprint.template.yaml) —
  Production Step 13: pasif Render Blueprint taslağı, §19/§20'nin somut
  servis modellemesi. Production Step 14: dosya PASİF kalmaya devam
  ediyor — kullanıcı servisleri Render panelinden elle kurmayı seçti
  (§21'in "render.yaml kararı" notu).
- [`docs/backup-restore-runbook.md`](./backup-restore-runbook.md) —
  Production Step 9'un tam teslimatı: persistence envanteri, managed
  Postgres/S3 karar kriterleri, backup policy, restore/restore-drill
  prosedürü; §12 — Production Step 10'un gerçek drill sonucu. §11/§6'nın
  artık işaret ettiği doküman.
- `scripts/restore-drill-staging.sh` — §16'nın tam otomasyonu, §11'in
  restore prosedürünü staging'de çalıştırıp doğrulayan script.
- [`docs/ci-stable-profile.md`](./ci-stable-profile.md) — §14'ün doğrudan
  kaynağı: Remote Runner Validation Protocol'ün tam gerekçesi, dormant
  `.github/workflows/stable-ci.yml` kararı, ve `CI_DEBUG_ROUTES` teşhis
  aracının kullanımı.
- [`docs/staging-compose.md`](./staging-compose.md) — Production Step 2:
  bu runbook'un §2/§13'ünün önerdiği Docker Compose staging skeleton +
  `smoke-staging.ts`'in gerçek teslimatı — tasarım kararları, ne kapsıyor/ne
  kapsamıyor, ve "Docker bu ortamda hiç çalıştırılamadı" dürüst notu.
- [`docs/production-readiness-review.md`](./production-readiness-review.md) —
  bu runbook'un §2'sinin doğrudan girdisi (topoloji kararı) ve §7/§8'in
  temel dayanağı (healthcheck/heartbeat/stale-lock uygulama detayları).
- [`docs/release-readiness.md`](./release-readiness.md) — env/servis
  checklist'i, local startup adımlarının kaynağı (§5).
- [`docs/phase-3-final-state.md`](./phase-3-final-state.md) — teknik borç
  kaydı (§12'nin kaynağı), Phase 3 Step 7'nin bu runbook'a nasıl vardığının
  kapanış kaydı.
- [`docs/render-queue-worker-plan.md`](./render-queue-worker-plan.md) —
  render queue/worker mimarisinin orijinal planı, §7'nin cancel/stale-lock
  detaylarının kaynağı.
- [`docs/mvp-demo-flow.md`](./mvp-demo-flow.md) — dashboard'daki 12 adımlık
  manuel demo akışının kaynağı (§5/§9'un "fake smoke" referansı).
