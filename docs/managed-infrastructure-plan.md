# Grafista AI Studio — Managed Infrastructure Plan (Production Step 11)

> **Status: KARAR PAKETİ + PROVIZYONLAMA CHECKLIST'İ — bu adımda hiçbir
> gerçek provider hesabı açılmadı, hiçbir gerçek servis provizyonlanmadı,
> hiçbir production deploy yapılmadı.** Bu belge
> [`docs/production-readiness-review.md`](./production-readiness-review.md)
> §11'in sıralamasının ("B+A → C → D → E") ve
> [`docs/backup-restore-runbook.md`](./backup-restore-runbook.md) §2'nin
> zaten koyduğu "bu doküman bir sağlayıcı SEÇMİYOR" ilkesinin doğrudan
> devamıdır — Production Step 9/10, managed Postgres/S3 kararını ve gerçek
> altyapıya karşı bir restore drill'i **bilinçli olarak kapsam dışı**
> bırakmıştı (bkz. `docs/backup-restore-runbook.md` dosya başı uyarısı ve
> §2). Bu belge o boşluğu KAPATMIYOR (gerçek provizyonlama hâlâ yapılmadı) —
> yalnızca "hangi kriterlerle, hangi sırayla, hangi gate'lerle" sorusuna net
> bir cevap veriyor, ki gerçek provizyonlama bir sonraki adımda buna
> dayanarak yapılabilsin.
>
> Kaynaklar: [`docs/production-readiness-review.md`](./production-readiness-review.md),
> [`docs/deployment-runbook.md`](./deployment-runbook.md),
> [`docs/backup-restore-runbook.md`](./backup-restore-runbook.md),
> [`docs/ci-stable-profile.md`](./ci-stable-profile.md),
> [`docs/staging-compose.md`](./staging-compose.md), ve doğrudan repo içi
> okuma/grep (`.env.example`, `apps/api/src/config/env.ts`,
> `apps/api/src/storage/factory.ts`, `apps/api/src/db/pool.ts`,
> `apps/api/src/services/render-worker.ts`, `docker-compose.staging.yml`,
> `apps/api/Dockerfile`, `scripts/ci-staging.sh`,
> `scripts/restore-drill-staging.sh`, `.github/workflows/stable-ci.yml`).

## 1. Bu adım neden şimdi, ve neyi KAPSAMIYOR

Production Step 8 remote CI'ı (`stable` 8/8, `staging-smoke` 5/5 temiz —
`docs/ci-stable-profile.md`) candidate merge gate olarak kapattı; Production
Step 9/10 backup/restore PROSEDÜRÜNÜ yazıp staging'de PASS ile doğruladı
(`docs/backup-restore-runbook.md` §12). Her iki gate de **kod-doğruluğu ve
"restore mekaniği çalışıyor mu" sorularını** cevaplıyor — ikisi de **"hangi
gerçek altyapı üzerinde çalışacağız"** sorusuna hiç değinmiyor, çünkü repo'da
bugüne kadar **sıfır managed SERVİS kararı** var. **Not — bu adımda
netleştirildi:** `docs/production-readiness-review.md` §3'ün "Repo'da hiçbir
platform ipucu yok" tespiti bugün ARTIK GÜNCEL DEĞİL — o belgenin kendi §14'ü
bunu zaten "kısmen kapandı" olarak işaretlemişti (`apps/api/Dockerfile`,
`docker-compose.staging.yml`, `.github/workflows/stable-ci.yml` hepsi bugün
repo'da mevcut, §2'nin envanterinde de görülüyor). Bu belgenin iddiası daha
DAR: platform/container-tarafı iskelet var, ama HİÇBİR gerçek managed
PROVIDER (Postgres/S3/hosting hesabı) hâlâ seçilip provizyonlanmadı. Bu adım
o üçüncü, hâlâ açık soruyu kapatmayı hedefliyor — ama **karar paketi
olarak**, gerçek provizyonlama olarak değil.

**Bu adımda YAPILMAYANLAR** (görev tanımının kendi sınırı, burada da açıkça
restate ediliyor):

- Gerçek bir production deploy'u.
- Yeni bir ürün özelliği.
- Gerçek bir provider hesabı/proje açma veya kredi kartı gerektiren herhangi
  bir işlem.
- Gerçek bir secret değeri yazma (bu belgede VE `.env.example`'da yalnızca
  isim + amaç; hiçbir yerde gerçek bir anahtar/parola yok).
- Runtime storage driver refactor'u, yeni bir database migration'ı, UI/tasarım
  değişikliği, test beklentisi gevşetme, retry ile sorun gizleme.

## 2. Infrastructure envanteri — kodun bugün gerçekten neye ihtiyaç duyduğu

Her satır doğrudan koddan/config'ten doğrulandı, varsayılmadı.

| Servis | Zorunlu mu? | Bugün kodun beklediği | Kanıt |
|---|---|---|---|
| **API runtime** | Evet | Uzun-ömürlü tek Node process (Express); `RENDER_QUEUE_ENABLED=true` iken bu SÜREKLİ ayakta kalmalı (aşağıya bkz.) | `apps/api/src/app.ts`, `apps/api/src/index.ts` |
| **Web/dashboard runtime** | Evet, gerçek kullanım için | Next.js (`next build`/`next start`), API'ye `NEXT_PUBLIC_API_URL` ile işaret eder | `apps/dashboard/package.json`, `.env.example` |
| **Managed Postgres** | Evet, zorunlu | `DATABASE_URL` — `postgres://`/`postgresql://` ile başlayan bir connection string; API boot'ta Zod ile fail-fast doğrular, eksik/geçersizse process hiç açılmaz | `apps/api/src/config/env.ts:21-26` |
| **S3-uyumlu object storage** | Koşullu ama production'da ZORUNLU önerilir | `STORAGE_PROVIDER=s3` + `S3_ENDPOINT/REGION/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY` hepsi birlikte; adapter bucket'ı OTOMATİK OLUŞTURMAZ, önceden var olmalı | `apps/api/src/storage/factory.ts`, `.env.example` |
| **Queue/background worker** | Ayrı bir servis/host DEĞİL | `render-worker.ts`'in `setInterval` tabanlı poll loop'u — `apps/api`'nin KENDİ process'i içinde, `RENDER_QUEUE_ENABLED` bayrağıyla açılır; ayrı bir deploy hedefi/instance YOK | `docs/production-readiness-review.md` §2, `apps/api/src/services/render-worker.ts` |
| **Docker registry** | Koşullu, seçilen hosting yaklaşımına bağlı | `apps/api/Dockerfile` + `docker-compose.staging.yml` bugün YALNIZ staging/CI'da build ediliyor (`ci-staging.sh`); bir PaaS (Railway/Render/Fly) genelde kendi build'ini yapar, kendi registry'sine ihtiyaç duymaz — çıplak VM/Compose yaklaşımı seçilirse bir registry (veya host'ta doğrudan build) gerekir | `apps/api/Dockerfile`, `scripts/ci-staging.sh` |
| **Domain/DNS** | Evet, gerçek kullanım için | Bugün kodda/config'te hiçbir domain adı yok — `API_CORS_ORIGIN`/`NEXT_PUBLIC_API_URL` bugün `localhost` değerleriyle örnekleniyor, production'da gerçek domain'lerle değiştirilmesi gerekiyor | `.env.example` |
| **SSL/TLS** | Evet, production'da zorunlu | `COOKIE_SECURE` bayrağı HTTPS varsayımıyla yazılmış (`true` olduğunda cookie yalnız HTTPS'te gönderilir) — TLS terminasyonunun NEREDE yapılacağı (platform seviyesi mi, ayrı bir reverse proxy mi) bugün kod tarafından belirlenmiyor, hosting kararına bağlı | `apps/api/src/config/env.ts:30-33`, `.env.example` |
| **Secrets management** | Evet, zorunlu | Bugün repo'da secrets manager entegrasyonu YOK — `docs/security.md`'nin tek notu bir TODO satırı ("Migrate to secrets manager"); bugün tüm secret'lar düz `.env` dosyaları/platform env değişkenleri üzerinden okunuyor | `docs/production-readiness-review.md` §9 |
| **Logs/monitoring** | Evet, production'da zorunlu | Bugün merkezi bir log toplama/alarm sistemi YOK — yalnız `console.log`/`console.error`, `GET /api/health/ready`'nin kendi JSON özeti (`docs/deployment-runbook.md` §10'un doğruladığı "monitoring yüzeyi neredeyse tamamen boş" bulgusu) | `docs/production-readiness-review.md` §5, `docs/deployment-runbook.md` §10 |
| **Backup automation** | Evet, zorunlu | Bugün OTOMATİK bir backup mekanizması YOK — yalnız staging'de elle tetiklenen bir restore drill script'i (`scripts/restore-drill-staging.sh`); managed sağlayıcının kendi snapshot/PITR özelliği bu boşluğu kapatacak asıl mekanizma olarak önerilmiş durumda | `docs/backup-restore-runbook.md` §3a, §11 |

**Sonuç, tek cümlede:** kodun kendisi zaten "managed Postgres + managed
S3-uyumlu storage + uzun-ömürlü tek process + container-temelli runtime"
kararını (`docs/production-readiness-review.md` §3/§4) önceden vermiş
durumda — bu belgenin işi o kararı YENİDEN TARTIŞMAK değil, hangi somut
sağlayıcı kriterleriyle, hangi env/secret'larla, hangi gate'lerle
gerçekleştirileceğini netleştirmek.

## 3. Provider karar matrisi

**Bu bölüm hiçbir sağlayıcı SEÇMİYOR, hiçbir güncel fiyat iddiası
YAPMIYOR.** Her kategoride "decision required" olarak işaretlenen satır,
kullanıcı onayı/gerçek bir hesap açılışı gerektiriyor. Güçlü bir yön
önerisi var (küçük ekip/MVP için en az operasyon yükü, local disk
production'da KULLANILMAZ, Postgres PITR+snapshot ve object storage
versioning ZORUNLU gate) — ama bu bir sağlayıcı ismi değil, bir kriter
seti.

### 3a. Managed Postgres

| Alan | İçerik |
|---|---|
| Minimum gereksinim | PostgreSQL 14+ (repo'nun kendi gereksinimi, `docs/production-readiness-review.md` §2); `pgvector` extension'ı desteklenmesi TERCİH EDİLİR ama ZORUNLU değil — **düzeltme, bu adımda doğrulandı:** `apps/api/src/db/migrate.ts`'in `isMissingExtensionError()`'ı, Postgres'in kendi hata mesajını yakalayarak migration 002'yi extension kullanılamıyorsa OTOMATİK atlıyor; bu bir env değişkenine bağlı DEĞİL. `.env.example`'daki `PGVECTOR_ENABLED` bugün kodun hiçbir yerinde okunmuyor (grep ile doğrulandı, sıfır sonuç — `database/migrations/002_pgvector.sql` da hiçbir env değişkeni okumuyor) — ölü bir placeholder, gerçek skip mekanizması yukarıdaki capability-based fallback |
| Önerilen kriter | Otomatik günlük snapshot + PITR (point-in-time recovery) desteği — `docs/backup-restore-runbook.md` §2'nin zaten ZORUNLU kriter olarak işaretlediği şey burada TEKRARLANIYOR, yeniden türetilmiyor |
| Aranacak özellikler | Otomatik snapshot + PITR; connection pooling/limit'lerin uygulamanın `pg.Pool` kullanımıyla (`apps/api/src/db/pool.ts`) uyumlu olması; `sslmode=require` desteği; least-privilege ayrı bir backup/okuma rolü açabilme |
| Riskler | PITR penceresi sağlayıcıdan sağlayıcıya büyük fark gösterir (dakika-seviyesi vs. günlük) — gerçek müşteri verisi girmeden önce bu fark düşük önemde, girdikten sonra kritik (`docs/backup-restore-runbook.md` §2'nin zaten belirttiği gibi); bazı managed sağlayıcılar `pgvector`'ı desteklemeyebilir |
| Kabul kriterleri | (1) Otomatik snapshot AÇIK, (2) PITR AÇIK (destekleniyorsa) veya haftalık logical dump ikinci savunma hattı olarak devrede, (3) `DATABASE_URL` `sslmode=require` içeriyor, (4) restore drill bu managed instance'a karşı EN AZ BİR KEZ çalıştırılıp PASS aldı (bkz. §6) |
| **Decision required** | Somut sağlayıcı seçimi (ör. Railway/Render/Neon/RDS/başka) — bu belge bir seçim YAPMIYOR |

### 3b. S3-uyumlu object storage

| Alan | İçerik |
|---|---|
| Minimum gereksinim | `STORAGE_PROVIDER=s3` abstraction'ının (`apps/api/src/storage/factory.ts`) beklediği S3-uyumlu bir API (PutObject/GetObject/ListBucket/DeleteObject) |
| Önerilen kriter | Bucket versioning zorunlu — `docs/backup-restore-runbook.md` §3b'nin zaten koyduğu gate burada TEKRARLANIYOR |
| Aranacak özellikler | Versioning; lifecycle policy desteği (yalnız regenerable tier'a uygulanacak, bkz. `docs/backup-restore-runbook.md` §3b); least-privilege access key (yalnız Put/Get/List, bucket-seviyesi silme/policy değişikliği AYRI bir admin kimliğinde); `S3_FORCE_PATH_STYLE` gerektiren path-style endpoint desteği (MinIO-tarzı sağlayıcılar için) |
| Riskler | Egress ücretlendirmesi sağlayıcıdan sağlayıcıya çok değişir (bu belge fiyat iddiası yapmıyor, ama bu bir değerlendirme ekseni olarak not ediliyor); adapter bucket'ı OTOMATİK OLUŞTURMAZ — provizyonlama sırasında elle oluşturulmalı |
| Kabul kriterleri | (1) Bucket versioning AÇIK, (2) least-privilege access key oluşturuldu (bucket silme YETKİSİ YOK), (3) lifecycle policy yalnız regenerable prefix'e (`render-jobs/*/exports/*`) uygulandı, kalıcı tier'a (`brand-assets/`, `design-references/`, `generated-outputs/`) UYGULANMADI, (4) restore drill bu bucket'a karşı en az bir kez çalıştırıldı (bkz. §6) |
| **Decision required** | Somut sağlayıcı seçimi (AWS S3, Cloudflare R2, MinIO self-host, Backblaze B2, başka) — seçilmedi |

### 3c. App hosting/runtime

| Alan | İçerik |
|---|---|
| Minimum gereksinim | Uzun-ömürlü, sürekli-ayakta tek process çalıştırabilen bir platform — stateless/serverless (ör. çıplak Lambda/Vercel Functions) DİSKALİFİYE, çünkü in-process worker'ın `setInterval` döngüsü process'in sürekli açık kalmasını gerektiriyor (`docs/production-readiness-review.md` §3) |
| Önerilen kriter | Container-temelli çalıştırma (Playwright/Chromium sistem bağımlılıkları bir Dockerfile'da doğal çözülüyor, bare Node buildpack'lerin çoğu bunu içermiyor) |
| Aranacak özellikler | Docker image/Compose desteği; environment variable + secret injection; health/readiness probe yapılandırması (`GET /api/health` liveness için, `GET /api/health/ready` asla hard-fail gate olarak KULLANILMAMALI — bkz. `docs/deployment-runbook.md` §8); zero/rolling-restart olmadan RENDER_QUEUE_ENABLED açıkken devam eden bir render'ın kesilmemesi (ani SIGKILL yerine graceful shutdown penceresi) |
| Riskler | Çoklu-instance/yatay ölçek koordinasyonu HİÇ test edilmedi (`docs/production-readiness-review.md` §7) — birden fazla instance açmak, "2 instance = 2 worker aynı `render_jobs` tablosunu poll ediyor" senaryosunu doğrulanmamış bir alana taşır; bu MVP aşamasında TEK instance ile başlanması güçlü şekilde önerilir |
| Kabul kriterleri | (1) Tek, uzun-ömürlü instance/container ayakta, (2) `GET /api/health` platform'un liveness probe'una bağlandı, (3) tüm zorunlu env/secret'lar (§4) girildi, (4) Playwright/Chromium runtime doğrulandı (`RENDERER_PROVIDER=playwright` kullanılacaksa) |
| **Decision required** | Docker Compose/tek-VM mi, yoksa Railway/Render/Fly gibi uzun-ömürlü-process bir PaaS mi — `docs/production-readiness-review.md` §4 ve `docs/deployment-runbook.md` §2'nin zaten önerdiği aile (K8s DEĞİL, çıplak serverless DEĞİL) burada da geçerli, ama İKİSİ arasındaki seçim ekibin operasyon iştahına bağlı, bu belge onu seçmiyor |

### 3d. Background worker hosting

| Alan | İçerik |
|---|---|
| Minimum gereksinim | **Ayrı bir kategori DEĞİL** — §2'nin doğruladığı gibi worker, App hosting/runtime (§3c) ile AYNI process/instance. Bu kategori burada yalnızca görev tanımının istediği envanteri eksiksiz tutmak için ayrı satır olarak duruyor |
| Önerilen kriter | §3c ile birebir aynı sağlayıcı/instance — ayrı bir worker deploy hedefi PROVİZYONLANMAMALI |
| Aranacak özellikler | (yok — §3c'nin özellikleri geçerli) |
| Riskler | Yanlışlıkla ayrı bir "worker service" provizyonlamak (ör. bir PaaS'ta ikinci bir servis/process tanımlamak) — bu, dokümante edilmemiş bir çoklu-worker senaryosunu (§3c'nin riskleri) İSTEMEDEN tetikler |
| Kabul kriterleri | Provizyonlama sonrası doğrulama: yalnızca TEK bir API+worker instance'ının çalıştığı, `render_worker_heartbeats` tablosunda tek bir `worker_id`'nin aktif olduğu teyit edildi |
| **Decision required** | Yok — bu kategori §3c'nin kararına bağımlı, ayrı bir karar gerektirmiyor |

### 3e. Logs/monitoring

| Alan | İçerik |
|---|---|
| Minimum gereksinim | `GET /api/health/ready`'nin JSON özetini (database/storage/renderQueue/workerHeartbeat/providers/playwright) periyodik olarak toplayıp görünür kılan BİR mekanizma — bugün bu tamamen elle (`curl`) tetikleniyor |
| Önerilen kriter | Merkezi log toplama (stdout/stderr agregasyonu) + `GET /api/health/ready`'nin `error` durumuna (yalnız `degraded` değil) alarm bağlanması |
| Aranacak özellikler | Yapılandırılmış log toplama (platformun kendi log agregasyonu yeterli olabilir, ayrı bir SaaS şart değil); `workerHeartbeat`/`renderQueue` check'lerinin `error` durumuna basit bir alarm/bildirim; secret redaction'ın (bugün yalnız `analytics_events`/`revision_entries` metadata'sına özgü, bkz. `docs/production-readiness-review.md` §6) genel log akışına da uygulanması İDEAL ama bu adımın kapsamında ZORUNLU değil |
| Riskler | Bugün request-id/correlation-id YOK (`docs/production-readiness-review.md` §6) — bir production incident'ında istekleri uçtan uca izlemek zor olacak; bu, monitoring aracının kendisinden bağımsız bir kod-tarafı boşluk, bu belge bunu ÇÖZMÜYOR |
| Kabul kriterleri | (1) Loglar platformdan/instance'tan bağımsız bir yerde en az 7 gün saklanıyor, (2) `GET /api/health/ready`'nin `error` durumuna en az bir bildirim kanalı (email/webhook) bağlı |
| **Decision required** | Platformun kendi log agregasyonu mu yeterli, yoksa ayrı bir log/monitoring servisi mi — seçilmedi, güncel fiyat/özellik karşılaştırması bu belgenin kapsamı dışı |

### 3f. Secrets management

| Alan | İçerik |
|---|---|
| Minimum gereksinim | `.env`/platform env değişkenleri üzerinden secret enjeksiyonu (bugünkü fiili durum) — hiçbir secret repo'ya commit edilmemeli (kök `.gitignore` bunu zaten koruyor) |
| Önerilen kriter | Platformun kendi native secret store'u (çoğu managed PaaS bunu sağlıyor) — ayrı bir secrets-manager SaaS'ı MVP ölçeğinde şart değil |
| Aranacak özellikler | Secret'ların düz metin olarak platform loglarına/UI'ına yazdırılmaması; en az admin/deploy rolü ile secret değiştirme yetkisinin ayrılması; rotasyon YAPILABİLİR olması (repo'da bugün hiçbir rotasyon prosedürü yok — `docs/production-readiness-review.md` §9'un doğruladığı boşluk, bu belge de ÇÖZMÜYOR, yalnız provizyonlama sırasında rotasyon YAPILABİLİR bir mekanizma seçilmesini önerir) |
| Riskler | `AUTH_SECRET` değişirse TÜM aktif session'lar geçersiz olur (imzalama anahtarı) — rotasyon prosedürü YOK, bu yüzden ilk provizyonlamada güçlü, tek seferlik bir `AUTH_SECRET` (`openssl rand -hex 32`, CI'ın kendi staging akışında zaten kullandığı yöntem, bkz. `docs/ci-stable-profile.md` Production Step 8) üretilmeli |
| Kabul kriterleri | (1) Hiçbir secret repo'da/CI log'unda görünmüyor, (2) `AUTH_SECRET`/`S3_SECRET_ACCESS_KEY`/`DATABASE_URL` yalnız platform secret store'unda, (3) secret'lara erişim en az yetkiyle sınırlı |
| **Decision required** | Platform-native secret store'un yeterli olup olmadığı (ekibin büyüklüğüne/complience ihtiyacına bağlı) — seçilmedi |

### 3g. Backup automation

| Alan | İçerik |
|---|---|
| Minimum gereksinim | Managed Postgres'in kendi otomatik snapshot'ı + object storage versioning (§3a/§3b'nin zaten koyduğu gate) — repo kendi başına HİÇBİR backup otomasyonu SAĞLAMIYOR (`docs/backup-restore-runbook.md` §11) |
| Önerilen kriter | `docs/backup-restore-runbook.md` §3c'nin minimum hedefleri: Postgres RPO ≤24 saat (gerçek müşteri verisi öncesi) / ≤1 saat (PITR, sonrası), RTO ≤4 saat; object storage sürekli (versioning) |
| Aranacak özellikler | Sağlayıcı-taraflı otomatik günlük snapshot; haftalık `pg_dump` logical dump'ın sağlayıcıdan BAĞIMSIZ bir ikinci konuma yazılması (`docs/backup-restore-runbook.md` §3a'nın "savunma derinliği" notu) |
| Riskler | Tek sağlayıcının snapshot mekanizması başarısız olursa (hesap kaybı, sağlayıcı-taraflı kesinti) — ikinci, bağımsız bir kopya olmadan tam veri kaybı riski (`docs/backup-restore-runbook.md` §11'in zaten işaret ettiği risk) |
| Kabul kriterleri | (1) Otomatik snapshot AÇIK VE doğrulandı, (2) haftalık logical dump ayrı bir konuma yazılıyor, (3) restore drill managed altyapıya karşı PASS aldı (bkz. §6) — bu üçü olmadan production deploy YOK |
| **Decision required** | Logical dump'ın yazılacağı "sağlayıcıdan bağımsız ikinci konum" (ayrı bir S3 bucket'ı/hesap mı, farklı bir sağlayıcı mı) — seçilmedi |

## 4. Env/secrets matrisi

**Değer YOK — yalnızca isim, amaç, required/optional/local-only.** Kaynak:
`.env.example` (repo'daki gerçek dosya) + `apps/api/src/config/env.ts`
(boot-time Zod validasyonu, gerçekten hangi değişkenlerin fail-fast olduğunu
gösteriyor).

| Değişken | Amaç | Durum | Kaynak/not |
|---|---|---|---|
| `DATABASE_URL` | Postgres connection string | **Required** — boot'ta Zod fail-fast | `apps/api/src/config/env.ts:21-26` |
| `AUTH_SECRET` | Session token imzalama anahtarı (≥16 karakter) | **Required** — boot'ta Zod fail-fast | `apps/api/src/config/env.ts:27-29` |
| `STORAGE_PROVIDER` | `local` \| `s3` | **Required (production'da her zaman `s3` olmalı)** — kodun kendi default'u `local`, ama `docs/backup-restore-runbook.md` §2'nin net önerisi production'da `s3` | `.env.example`, `apps/api/src/storage/factory.ts` |
| `S3_BUCKET` | Hedef bucket adı | **Required, yalnız `STORAGE_PROVIDER=s3` iken** — adapter bucket'ı otomatik oluşturmaz | `.env.example` |
| `S3_REGION` | Bucket bölgesi | **Required, yalnız `STORAGE_PROVIDER=s3` iken** | `.env.example` |
| `S3_ENDPOINT` | AWS-dışı S3-uyumlu sağlayıcılar için custom endpoint | **Optional** — gerçek AWS S3 için boş bırakılır, R2/MinIO/B2 için doldurulur | `.env.example` |
| `S3_ACCESS_KEY_ID` | Bucket erişim kimliği | **Required (secret), yalnız `STORAGE_PROVIDER=s3` iken** | `.env.example` |
| `S3_SECRET_ACCESS_KEY` | Bucket erişim sırrı | **Required (secret), yalnız `STORAGE_PROVIDER=s3` iken** — asla commit edilmez | `.env.example` |
| `S3_FORCE_PATH_STYLE` | MinIO-tarzı path-style endpoint zorunluluğu | **Optional** | `.env.example` |
| `NEXT_PUBLIC_API_URL` | Dashboard'ın API'ye erişmek için kullandığı taban URL | **Required, dashboard runtime'ı için** — görev tanımının istediği "PUBLIC_APP_URL"/"API_BASE_URL" kavramlarının bugünkü karşılığı BUDUR; repo'da ayrıca "uygulamanın kendi genel URL'i" (ör. email/share link üretimi için) kavramı YOK, çünkü bugün hiçbir kod böyle bir link üretmiyor — bu bir gelecek ihtiyaç olarak not ediliyor, bugün eklenmedi | `.env.example` |
| `API_HOST` / `API_PORT` | API'nin bind edildiği host/port | **Required, API runtime'ı için** | `.env.example` |
| `API_CORS_ORIGIN` | API'nin izin verdiği CORS origin | **Required, production domain'iyle güncellenmeli** — bugün `.env.example`'da `http://localhost:3000` örneği var | `.env.example` |
| `COOKIE_SECURE` | Cookie'nin yalnız HTTPS'te mi gönderileceği | **Optional (kodun kendi default'u `false`), production'da elle `true` set edilmeli** — **düzeltme, bu adımda doğrulandı:** `env.ts:30-33`'ün `.default('false')`'u var, `DATABASE_URL`/`AUTH_SECRET` gibi fail-fast DEĞİL — unset kalırsa API sessizce `COOKIE_SECURE=false` (güvensiz cookie) ile boot olur, açılmayı REDDETMEZ | `apps/api/src/config/env.ts:30-33` |
| `NODE_ENV` | Çalışma ortamı | **Local-only/konvansiyonel** — `.env.example`'da var ama repo'nun kendi kodu (`apps/api/src`, `apps/dashboard`) hiçbir yerde `process.env.NODE_ENV` OKUMUYOR (doğrulandı, grep sıfır sonuç); yalnızca Node/Express/Next.js'in kendi standart konvansiyonu için set edilir | grep doğrulaması, bu adımda yapıldı |
| `LOG_LEVEL` | Log ayrıntı seviyesi | **Optional, bugün kod tarafından okunmuyor** — `.env.example`'da var ama repo kodunda hiçbir `process.env.LOG_LEVEL` okuması YOK (doğrulandı, grep sıfır sonuç); bugün yalnızca gelecekteki bir logging implementasyonu için ayrılmış bir isim | grep doğrulaması, bu adımda yapıldı |
| `CI_DEBUG_ROUTES` | İstek/yanıt teşhis middleware'ini açar | **Local/CI-only, ASLA production'da açılmamalı** — `docs/ci-stable-profile.md` Production Step 5'in teşhis aracı, varsayılan kapalı | `apps/api/src/middleware/debug-routes.ts`, `apps/api/src/app.ts` |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | AI provider anahtarları | **Required (presence-only), boot'ta Zod fail-fast** — `AI_DEFAULT_PROVIDER=fake` iken bile dummy bir string zorunlu | `apps/api/src/config/env.ts:11-12` |
| `KIE_AI_API_KEY` / `KIE_AI_BASE_URL` | Gerçek görsel üretimi | **Required birlikte, yalnız gerçek görsel üretimi kullanılacaksa** | `.env.example` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Yalnız `db:seed-admin` tarafından okunur | **Local/one-time-use only** — API boot'unda gerekmez, ilk seed sonrası rotasyon/unset önerilir | `.env.example` |
| `RENDER_QUEUE_ENABLED` ve ilgili `RENDER_*` değişkenleri | Queue/worker davranışı | **Production'da `RENDER_QUEUE_ENABLED=true` önerilir** (kalıcı) — diğerleri (`RENDER_JOB_MAX_ATTEMPTS` vb.) optional, makul default'ları var | `.env.example`, `docs/deployment-runbook.md` §3 |

## 5. Provisioning checklist

Somut, komut-seviyeli checklist artık
[`docs/deployment-runbook.md`](./deployment-runbook.md)'nin yeni
**"Production Infrastructure Provisioning Gate"** bölümünde — burada
TEKRARLANMIYOR, yalnız çapraz referans veriliyor.

## 6. Managed altyapıya karşı restore drill gate

`docs/backup-restore-runbook.md`'nin yeni **"Managed Infrastructure
Requirements"** bölümü, Production Step 10'un staging drill'inin (sentetik
veri, local Docker) managed Postgres/S3 karşılığını tarif ediyor — burada
TEKRARLANMIYOR. Net gate: **managed sağlayıcı seçilmeden VE restore drill
managed altyapıda tekrar edilmeden production deploy YOK.**

## 7. Ops decision — kullanıcıya sunulan üç seçenek

Bu belge somut bir sağlayıcı seçmiyor; ama üç genel YÖN arasında bir seçim
gerekiyor. Antigravity içinde gerçek bir hesap açılmadı, hiçbiri
provizyonlanmadı — aşağıdaki üçü yalnızca karar çerçevesi.

### Option A — Düşük operasyon / hızlı MVP

Tek bir uzun-ömürlü-process PaaS (§3c) + o platformun kendi managed
Postgres + managed object storage eklentileri; ayrı bir secrets-manager/log
SaaS'ı yok, platformun kendi native araçları kullanılır.

- **Artı:** en hızlı kurulum, en az operasyonel yük, küçük ekip için doğru
  ölçek, `STORAGE_PROVIDER=s3`/`DATABASE_URL` abstraction'ları zaten sıfır
  kod değişikliğiyle buna hazır.
- **Eksi:** PITR granülerliği/versioning özellikleri sağlayıcıdan
  sağlayıcıya değişir, bazı platform-native Postgres eklentileri
  RDS/Neon kadar granüler PITR sunmayabilir; ölçek büyüdükçe platform
  değiştirme maliyeti doğabilir.

### Option B — Daha kurumsal / ölçeklenebilir

Bileşenleri AYRI, uzmanlaşmış sağlayıcılardan seçmek (ör. dakika-seviyesi
PITR sunan ayrı bir managed Postgres + egress-ücretsiz ayrı bir object
storage + ayrı bir compute platformu + ayrı bir secrets-manager).

- **Artı:** her kategori için en güçlü PITR/versioning/compliance
  garantileri; gerçek müşteri verisi ölçeği büyüdüğünde daha az
  yeniden-platform değiştirme riski.
- **Eksi:** en yüksek kurulum/entegrasyon karmaşıklığı; birden fazla
  sağlayıcı = birden fazla fatura/hesap/secret store yönetimi; MVP
  aşamasında bu ek karmaşıklığın karşılığı düşük olabilir.

### Option C — Self-host ağırlıklı

Kendi VM'inde Docker Compose ile Postgres + MinIO (self-host S3-uyumlu) +
API — `docker-compose.staging.yml`'in bugünkü skeleton'ı bu yöne zaten
yapısal olarak yakın (yalnız bir `minio` servis bloğu eklenmesi gerekir,
`docs/staging-compose.md`'nin kendi "known gap" notu).

- **Artı:** en düşük dışa-bağımlılık, en fazla kontrol, sağlayıcı
  kilitlenmesi (vendor lock-in) yok.
- **Eksi:** en fazla bakım yükü — otomatik snapshot/PITR/versioning'i
  KENDİN kurup işletmen gerekir (repo bunu SAĞLAMIYOR, `docs/backup-restore-runbook.md`
  §11), patch/güvenlik/yeniden başlatma tamamen insan disiplinine bağlı;
  bu belgenin §3'teki "local disk production'da kullanılmamalı" ilkesiyle
  gerilimli — self-host bile olsa disk backup'ı OTOMATİKLEŞTİRİLMELİ, aksi
  halde bu ilke ihlal edilir.

**Bu belgenin yönü (öneri, karar değil):** küçük ekip/MVP ölçeğinde Option
A, `docs/production-readiness-review.md` §4'ün zaten verdiği "en az
operasyon yükü" gerekçesiyle tutarlı — ama son karar kullanıcıya ait,
**decision required**.

## İlgili dokümanlar

- [`docs/deployment-runbook.md`](./deployment-runbook.md) — "Production
  Infrastructure Provisioning Gate" bölümü (§5'in somut checklist'i).
- [`docs/backup-restore-runbook.md`](./backup-restore-runbook.md) —
  "Managed Infrastructure Requirements" bölümü (§6'nın managed restore
  drill gate'i).
- [`docs/production-readiness-review.md`](./production-readiness-review.md) —
  Step 11 sonuç güncellemesi, production deploy'un hâlâ blokede olduğunun
  net kaydı.
- [`docs/ci-stable-profile.md`](./ci-stable-profile.md) — bu belgenin
  varsaydığı "code-correctness gate" (candidate merge gate, 8/8 ve 5/5
  temiz), bu belgeyle KARIŞTIRILMAMALI (§1'in kendi ayrımı).
