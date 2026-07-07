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
# opsiyonel — bkz. docs/backup-restore-runbook.md, Production Step 9)
# Migration'ı çalıştırmadan ÖNCE: (a) mevcut instance'ın güncel bir backup'ı
# alınmış olmalı (docs/backup-restore-runbook.md §3a), (b) en az bir kez
# staging'de bu backup'tan restore drill'i (§7) başarıyla tamamlanmış
# olmalı. Bu adım bugün OTOMATİZE DEĞİL — §6'nın "backup ZORUNLU ama
# otomatize eden bir tool yok" notuyla aynı, insan disiplinine bağlı bir
# gate.

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

> **GÜNCELLEME (Production Step 9):** bu bölümün altındaki maddeler
> ("otomatik backup yok", "restore smoke yok") Step 9 öncesi durumu
> yansıtıyordu ve **hâlâ teknik olarak doğru** — Step 9 hiçbir otomasyon
> EKLEMEDİ (bilinçli kapsam sınırı, bkz. aşağıdaki not). Değişen şey: artık
> tam bir prosedür/karar dokümanı var —
> [`docs/backup-restore-runbook.md`](./backup-restore-runbook.md) — persistence
> envanteri (hangi veri kalıcı/hangisi cache), managed Postgres/S3 yön
> önerisi, backup policy (RPO/RTO hedefleri dahil), ve adım adım
> restore/restore-drill prosedürü. **Bu doküman henüz gerçek bir restore
> ile egzersiz edilmedi** (bugüne kadar gerçek production verisi/yedeği
> hiç olmadı) — prosedür yazılı, doğrulanmış değil. §7'deki staging
> restore drill, production'a geçmeden önce en az bir kez ÇALIŞTIRILMALI
> (bkz. §5'in yeni "4b" adımı, bu runbook'a bu Step 9'da eklendi).

- **PostgreSQL backup:** bugün **otomatik bir backup mekanizması yok** —
  ne bir cron, ne bir script, ne bir dokümante prosedür
  (`docs/production-readiness-review.md`'nin doğruladığı boşluk, burada
  aynen restate ediliyor). Production'a çıkmadan önce en az managed
  Postgres sağlayıcısının kendi otomatik snapshot/PITR özelliği
  etkinleştirilmeli — repo bunu kendi başına sağlamıyor. Somut policy
  (retention, RPO/RTO hedefleri) artık `docs/backup-restore-runbook.md`
  §3a/§3c'de.
- **S3/artifact backup:** `STORAGE_PROVIDER=local` modunda **sıfır backup
  hikayesi** — tek instance'ın diski kaybolursa tüm görsel/render/artifact
  geçmişi kalıcı olarak kaybolur (`docs/production-readiness-review.md`,
  confirmed). `s3` modunda bir backup hikayesi olabilir ama bu tamamen S3
  sağlayıcısının kendi versioning/replication ayarına bağlı — repo bunu
  ne yapılandırıyor ne dokümante ediyor. `docs/backup-restore-runbook.md`
  §2, production'da `local` modun hiç kullanılmaması gerektiğini net
  şekilde önerir.
- **Restore smoke:** script hâlâ **yok**, ama artık bir dokümante
  prosedür var — `docs/backup-restore-runbook.md` §5/§6 (restore
  komutları) ve §7 (staging restore drill, adım adım). Bir restore
  denemesi gerekirse artık sıfırdan icat edilmesi GEREKMEZ, ama bu
  prosedürün kendisi de henüz gerçek veriyle koşulmadı — ilk gerçek
  koşum aynı zamanda prosedürün ilk doğrulaması olacak.
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

## İlgili dokümanlar

- [`docs/backup-restore-runbook.md`](./backup-restore-runbook.md) —
  Production Step 9'un tam teslimatı: persistence envanteri, managed
  Postgres/S3 karar kriterleri, backup policy, restore/restore-drill
  prosedürü. §11/§6'nın artık işaret ettiği doküman.
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
