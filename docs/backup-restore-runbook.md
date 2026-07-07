# Grafista AI Studio — Backup/Restore Runbook (Production Step 9, egzersiz edildi Production Step 10)

> **Durum (GÜNCELLEME — Production Step 10):** bu doküman Production
> Step 9'da PROSEDÜR + KARAR DOKÜMANI olarak yazıldı, ama henüz hiç
> çalıştırılmamıştı. **Production Step 10'da §7'nin prosedürü,
> `scripts/restore-drill-staging.sh` ile staging Docker ortamında
> GERÇEKTEN çalıştırıldı ve PASS ile sonuçlandı** (tam sonuç: §12).
> Bu, hâlâ gerçek production verisi/managed Postgres/S3 ile bir
> egzersiz DEĞİL — tamamen sentetik staging verisiyle, restore
> MEKANİĞİNİN çalıştığını (checksum'la kanıtlanmış) doğrulayan bir
> drill. Hiçbir production deploy hâlâ yapılmadı, hiçbir yeni ürün
> özelliği eklenmedi, hiçbir migration eklenmedi (Step 9'dan beri
> değişmedi). Bu doküman, `docs/production-readiness-review.md` §10 ve
> `docs/deployment-runbook.md` §11'in ikisinin de tespit ettiği aynı
> boşluğu ("backup/restore prosedürü hiçbir yerde yazılı değil, hiç
> egzersiz edilmedi") kapatmak için yazıldı — **prosedür artık hem
> yazılı HEM DE staging'de en az bir kez gerçekten doğrulanmış.**
>
> **GÜNCELLEME (Production Step 11):** bu adım, hâlâ bilinçli olarak
> kapsam dışı bırakılan "managed Postgres/S3 sağlayıcısının seçilip
> provizyonlanması" sorusuna bir karar KRİTERİ paketi ekledi (bkz. §13 ve
> [`docs/managed-infrastructure-plan.md`](./managed-infrastructure-plan.md))
> — ama gerçek bir sağlayıcı hâlâ SEÇİLMEDİ, gerçek bir provizyonlama hâlâ
> YAPILMADI, ve bu dosyanın §7/§12'sindeki drill hâlâ yalnızca
> local/staging Docker'a karşı. §13, managed altyapıya karşı yapılacak
> EK bir drill'in ne gerektirdiğini tarif ediyor — kendisi o drill
> DEĞİL.
>
> **GÜNCELLEME (Production Step 12):** kullanıcı Option A'yı (düşük
> operasyon / hızlı MVP) seçti ve provider short-list'i hazırlandı
> (`docs/managed-infrastructure-plan.md` §7/§8) — **somut sağlayıcı hâlâ
> SEÇİLMEDİ**, bu yüzden §13'ün managed-altyapı drill'i hâlâ
> çalıştırılamaz durumda. Yeni §14, bu gate'i açıkça netleştiriyor: local/
> staging drill (§12) PASS + managed staging drill (§13, henüz yapılmadı)
> PASS, İKİSİ BİRDEN olmadan production deploy yok.
>
> **GÜNCELLEME (Production Step 13):** kullanıcı somut sağlayıcıları
> seçti — Render Postgres + Cloudflare R2
> (`docs/managed-infrastructure-plan.md` §9). Yeni §15, §13/§14'ün
> managed drill'ini artık bu iki sağlayıcıya özgü, somut bir prosedürle
> tarif ediyor — **"pending provider provisioning" durumu DEĞİŞMEDİ**,
> gerçek Render/R2 servisleri hâlâ kurulmadı, bu drill hâlâ
> ÇALIŞTIRILAMAZ. Ayrıca bu adımda §3b'nin "bucket versioning" ilkesinin
> R2 için YANLIŞ olduğu (Cloudflare'ın güncel dokümantasyonuna karşı
> doğrulanarak) bulunup düzeltildi — bkz. §3b'nin güncellenmiş notu.

## Amaç

Production'a gerçekten çıkmadan önce şu iki soruya somut, çalıştırılabilir
bir cevap vermek:

1. Postgres'teki veya object storage'daki veri kaybolursa (disk arızası,
   yanlış `DELETE`, yanlış migration, hesap/erişim kaybı) **nasıl geri
   getirilir?**
2. Hangi veri **gerçekten** yedeklenmeli, hangisi güvenle "cache" kabul
   edilip yeniden üretilebilir?

## Kapsam

Kapsam içinde: Postgres veritabanı, object storage'daki (S3-uyumlu veya
local) kalıcı dosyalar, ve bu ikisinin birbiriyle tutarlılığı (bir
Postgres satırı silinmiş bir storage objesine işaret etmemeli, ve tersi).

Kapsam dışında (bu adımda ele alınmadı, bilinçli olarak): gerçek bir
managed Postgres/S3 sağlayıcısının seçilip provizyonlanması (bkz.
"Managed Postgres / S3 kararı" bölümü — bu yalnızca bir ÖNERİ, henüz
uygulanmadı), gerçek bir production deploy'u, secrets rotation prosedürü
(`docs/security.md`'nin kendi TODO'su, ayrı bir konu).

## 1. Persistence envanteri (data inventory)

Bu envanter, apps/api/src/db/, apps/api/src/storage/, ve
database/migrations/001–025 dosyalarının doğrudan okunmasıyla çıkarıldı
(Production Step 9 araştırması). Hiçbir tabloda `BYTEA` veya başka bir
binary kolon yok — repo genelinde tutarlı bir mimari kararla, tüm gerçek
dosya baytları Postgres DIŞINDA, object storage'da yaşıyor; Postgres
yalnızca `storage_provider`/`storage_bucket`/`storage_key` üçlüsü +
metadata (mime type, boyut, checksum) tutuyor.

### 1a. Postgres — kalıcı, yedeklenmesi ZORUNLU

| Tablo | İçerik | Kaynak migration |
|---|---|---|
| `users`, `roles`, `permissions`, `user_roles`, `sessions` | Kimlik/yetkilendirme | `003_auth.sql` |
| `clients`, `client_members` | Müşteri/organizasyon | `001_initial_schema.sql`, `021_client_members.sql` |
| `brand_assets`, `design_references` | Yüklenen dosyaların METADATA'sı (storage pointer) | `001_initial_schema.sql`, `004_storage.sql` |
| `design_analysis`, `design_dna` | AI destekli stil analizi (versiyonlu) | `006_design_dna_analysis.sql`, `005/007/010` izin migration'ları |
| `design_briefs`, `content_ideas`, `layout_plans`, `creative_qa_reports` | Kreatif pipeline verisi (JSONB dahil) | `001_initial_schema.sql`, `008/009_layout_plans*.sql` |
| `generated_outputs` | AI-üretilmiş görsel METADATA'sı (storage pointer) | `014_visual_generation_extension.sql` |
| `production_jobs` | Paketleme job'ı + manifest/template-contract JSONB snapshot'ları + paket dosyası METADATA'sı (storage pointer) | `016/017/018_production_jobs*.sql` |
| `render_jobs`, `export_artifacts` | Render kuyruğu durumu + export dosyası METADATA'sı (storage pointer) | `019/020/022_render_jobs*.sql` |
| `render_worker_heartbeats` | Worker liveness sinyali | `025_render_worker_heartbeats.sql` |
| `workflow_runs`, `workflow_steps`, `workflow_step_outputs`, `workflow_approvals` | Workflow motoru durumu | `012/013_workflow*.sql` |
| `approvals` | Genel review/approval kaydı | `001_initial_schema.sql` |
| `revision_entries` | Append-only, insan onay/red/revize geçmişi | `024_revision_entries.sql` |
| `analytics_events` | Append-only, olay/kullanım kaydı | `023_analytics_events.sql` |

`schema_migrations` (uygulanan migration dosyalarının kaydı,
`apps/api/src/db/migrate.ts` tarafından yönetiliyor) da bu veritabanının
bir parçası — ayrı bir backup gerektirmiyor çünkü Postgres backup'ının
içinde otomatik olarak geliyor, ama bir restore sonrası bu tablonun
içeriği ile `database/migrations/`'daki dosyaların tutarlı olduğu
doğrulanmalı (bkz. "Verification checklist").

### 1b. Object storage — kalıcı tier (yedeklenmesi ZORUNLU)

Kaynak: `apps/api/src/storage/file-service.ts`, `services/render-engine.ts`,
`services/visual-generation.ts`.

| Key prefix | İçerik | Neden kalıcı? |
|---|---|---|
| `brand-assets/<clientId>/<uuid>.<ext>` | Müşterinin yüklediği marka varlıkları (logo, vb.) | Kullanıcı-kaynaklı orijinal — sistemde başka hiçbir kopyası yok, kaybolursa geri getirilemez |
| `design-references/<clientId>/<uuid>.<ext>` | Müşterinin yüklediği tasarım referansları | Aynı — kullanıcı-kaynaklı orijinal |
| `generated-outputs/<clientId>/<uuid>.<ext>` | AI-üretilmiş görsel çıktılar | Teorik olarak yeniden üretilebilir AMA `runVisualGeneration()` idempotent DEĞİL (her çalıştırma farklı bir "alternatif" set üretir) ve ücretli bir AI provider çağrısı gerektirir; ayrıca daha sonraki bir render'ın `loadSelectedVisual()`'ı bu objeyi ID'siyle geri okuyor — obje silinirse o üretim job'ının render'ı sessizce placeholder'a düşer |

### 1c. Object storage — regenerable/cache tier (yedeklenmesi OPSİYONEL)

| Key prefix | İçerik | Neden güvenle yeniden üretilebilir? |
|---|---|---|
| `render-jobs/<clientId>/<jobId>/exports/<preset>.<format>` (`export_artifacts` satırlarına karşılık gelir) | Render edilmiş export dosyaları (PNG/JPG/PDF) | `render-engine.ts`'nin kendi tasarımı bunları regenerable olarak ele alıyor ("kullanıcı renderer güncellemesi sonrası meşru şekilde yeniden render isteyebilir") — girdileri (`manifestSnapshot`/`templateContractSnapshot`, zaten Postgres'te) sabit olduğu sürece render pipeline'ı yeniden çalıştırmak yeterli, yeni bir AI çağrısı gerekmez |

### 1d. Ephemeral — backup GEREKMEZ

- Staging Docker Compose skeleti'ndeki local upload dizini
  (`docker-compose.staging.yml`'de bu dizin için hiçbir volume mount YOK —
  `docs/staging-compose.md`'nin kendi notu: "disposable, NOT persisted
  across `docker compose down`/recreate"). Bu zaten kasıtlı olarak kalıcı
  değil, production'da `STORAGE_PROVIDER=local` kullanılmaması gerektiğinin
  (bkz. "Managed Postgres / S3 kararı") bir kanıtı.
- `CI_DEBUG_ROUTES_LOG_FILE` (varsa) — yalnızca teşhis amaçlı, default off.
- HTML render ara çıktısı (`render/html-renderer.ts`) — hiç diske
  yazılmıyor, tamamen bellekte string olarak üretiliyor.

## 2. Managed Postgres / S3 kararı

`docs/production-readiness-review.md` §4 ve §16'nın zaten işaret ettiği
gibi: `STORAGE_PROVIDER=s3` soyutlaması (`apps/api/src/storage/factory.ts`)
**sıfır kod değişikliğiyle** herhangi bir S3-uyumlu sağlayıcıyla çalışıyor
(`S3_ENDPOINT` override'ı sayesinde AWS S3, Cloudflare R2, MinIO, Backblaze
B2 — hepsi aynı `S3StorageProvider` sınıfı üzerinden). Aynı şekilde
`DATABASE_URL` zaten yalnızca `postgres://`/`postgresql://` ile başlayan
geçerli bir connection string bekliyor (`apps/api/src/config/env.ts`, Zod
validasyonu) — managed bir Postgres'e geçiş de sıfır kod değişikliği
gerektiriyor, yalnızca env değişkeni + provizyon.

**Bu doküman bir sağlayıcı SEÇMİYOR** (gerçek bir hesap/altyapı kararı,
bu adımın kapsamı dışı) — yalnızca değerlendirme kriterlerini ve önerilen
yönü netleştiriyor:

- **Managed Postgres:** otomatik snapshot + PITR (point-in-time recovery)
  sunan bir sağlayıcı ZORUNLU kriter olmalı (kendi kendine barındırılan bir
  Postgres, bugün repo'da hiç yok, bu yükü tamamen insana bindirir).
  Railway/Render/Neon/RDS hepsi bunu sunuyor; Neon ve RDS'in PITR
  penceresi tipik olarak Railway/Render'ın managed snapshot'larından daha
  granüler (dakika-seviyesi vs. günlük) — gerçek müşteri verisi
  girmeden önce bu farkın önemi düşük, girdikten sonra önemli.
- **Object storage:** `STORAGE_PROVIDER=s3` + gerçek bir S3-uyumlu bucket
  (AWS S3 veya Cloudflare R2 gibi egress-ücretsiz bir alternatif) —
  versioning açık, aşağıdaki "Backup policy" bölümünde detaylandırılan
  lifecycle ile. **Düzeltme (Production Step 13, somut sağlayıcı Cloudflare
  R2 seçildikten sonra doğrulandı):** bu cümle R2 için YANLIŞ — R2
  S3-style versioning DESTEKLEMİYOR (bkz. §3b'nin ve §15'in güncellenmiş
  notu, `docs/managed-infrastructure-plan.md` §9c). AWS S3 için bu cümle
  hâlâ doğru; R2 seçildiği için somut mekanizma "Bucket Locks + lifecycle"
  (versioning DEĞİL) — bu paragraf genel bir prensip olarak Step 9'da
  sağlayıcı seçilmeden önce yazıldığı için burada TEKRARLANMIYOR, düzeltme
  yalnızca §3b/§9c'de.
- **Local disk (`STORAGE_PROVIDER=local`):** production'da KULLANILMAMALI.
  Bugünkü staging skeleti bunu zaten disposable olarak işaretliyor (§1d);
  kod tarafında hiçbir dosya sistemi geçici/cache kullanımı tespit
  edilmedi (render pipeline'ı da tamamen bellekte çalışıyor, `html-renderer.ts`
  hiç diske yazmıyor) — yani production'da local disk'in meşru HİÇBİR
  kullanım alanı yok, tamamen S3-uyumlu bir sağlayıcıya geçilmeli.

### Storage env değişkenleri (isim + amaç, DEĞER YOK — bkz. `.env.example`)

| Değişken | Amaç |
|---|---|
| `DATABASE_URL` | Postgres connection string; managed sağlayıcıya geçişte tek değişen şey |
| `PGVECTOR_ENABLED` | pgvector extension'ının var olup olmadığını belirtir (managed sağlayıcı bunu desteklemiyorsa migration 002 uyarıyla atlanır) |
| `STORAGE_PROVIDER` | `local` \| `s3` — production'da her zaman `s3` olmalı (yukarı bkz.) |
| `S3_ENDPOINT` | AWS dışı S3-uyumlu sağlayıcılar için custom endpoint (ör. R2/MinIO/B2); gerçek AWS S3 için boş bırakılır |
| `S3_REGION` | Bucket'ın bölgesi |
| `S3_BUCKET` | Bucket adı |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Bucket'a erişim kimlik bilgileri — asla commit edilmez |
| `S3_FORCE_PATH_STYLE` | MinIO-tarzı path-style endpoint'ler için `true` |

## 3. Backup policy

### 3a. Postgres

- **Otomatik snapshot:** managed sağlayıcının kendi günlük snapshot
  özelliği etkinleştirilmeli (repo kendi başına bunu sağlamıyor — bkz.
  `docs/deployment-runbook.md` §11).
- **Logical dump (savunma derinliği):** günlük otomatik snapshot'a EK
  olarak, haftalık bir `pg_dump` alınıp sağlayıcıdan BAĞIMSIZ bir
  konuma (ör. ayrı bir object storage bucket'ı) yazılmalı — tek
  sağlayıcının kendi snapshot mekanizmasının başarısız olma/hesap kaybı
  senaryosuna karşı ikinci bir kopya.
- **PITR:** sağlayıcı destekliyorsa (Neon/RDS) açılmalı — gerçek müşteri
  verisi (özellikle `brand_assets`/`design_references`/`generated_outputs`
  metadata'sı) girmeden önce ZORUNLU hale getirilmesi önerilir.
- **Retention:** günlük snapshot için 30 gün rolling, haftalık logical
  dump için 90 gün rolling — MVP-ölçeği bir varsayılan, gerçek
  compliance/müşteri gereksinimi ortaya çıkarsa sıkılaştırılmalı.
- **Encryption:** managed sağlayıcının kendi at-rest encryption'ı +
  `DATABASE_URL` bağlantısında `sslmode=require` (bugün `.env.example`'da
  zorunlu değil — production `DATABASE_URL`'i mutlaka `sslmode=require`
  içermeli).
- **Access control:** backup'lara erişim, uygulamanın kendi
  `DATABASE_URL` kimlik bilgilerinden AYRI, en az yetkiyle sınırlı bir
  hesap/rol üzerinden olmalı (least privilege).
- **Test restore sıklığı:** bkz. "Restore drill planı" — production
  öncesi en az bir kez, sonrasında üç ayda bir.

### 3b. Object storage

- **Versioning:** kalıcı tier prefix'lerinde (`brand-assets/`,
  `design-references/`, `generated-outputs/`) bucket versioning AÇIK
  olmalı — yanlışlıkla silinen/üzerine yazılan bir obje, versioning
  sayesinde geri getirilebilir. **Düzeltme (Production Step 13):** bu
  ilke, Production Step 9'da sağlayıcı seçilmeden önce yazıldı; Step 13'te
  seçilen somut sağlayıcı Cloudflare R2'nin S3-style versioning'i
  DESTEKLEMEDİĞİ Cloudflare'ın güncel dokümantasyonuna karşı doğrulandı —
  bu ilkenin R2'deki somut karşılığı "Bucket Locks" (WORM-tarzı
  retention, eski versiyonu GERİ GETİRMEZ, yalnızca silme/üzerine yazmayı
  belirli bir süre ENGELLER) + ayrı bir logical dump/backup kopyasıdır,
  klasik S3 versioning DEĞİL. Tam detay:
  `docs/managed-infrastructure-plan.md` §9c ve
  `docs/deployment-runbook.md`'nin yeni "Cloudflare R2 Staging Setup"
  bölümü.
- **Lifecycle policy:** yalnızca regenerable tier'a (`render-jobs/*/exports/*`)
  uygulanmalı — eski versiyonlar 90 gün sonra expire edilebilir (maliyet
  kontrolü). Kalıcı tier'ın eski versiyonları EXPIRE EDİLMEMELİ.
- **Kazayla silme koruması:** bucket policy'de `s3:DeleteObject` yalnızca
  uygulamanın kendi service credential'ına, bucket-seviyesi silme/policy
  değişikliği ise ayrı, MFA korumalı bir admin hesabına kısıtlanmalı.
- **Bucket policy / least privilege:** uygulamanın `S3_ACCESS_KEY_ID`'si
  yalnızca `PutObject`/`GetObject`/`ListBucket` yapabilmeli — bucket
  silme, policy değiştirme gibi yönetimsel işlemler bu kimlik bilgisiyle
  YAPILAMAMALI.

### 3c. Minimum hedefler

**Düzeltme (Production Step 13, somut sağlayıcı Cloudflare R2 seçildikten
sonra doğrulandı):** aşağıdaki tablonun Object storage kolonundaki
"Sürekli (versioning)" hücreleri bu adımda YANLIŞ bulundu — R2, S3-style
versioning DESTEKLEMİYOR (bkz. §3b/§15, `docs/managed-infrastructure-plan.md`
§9c). Tablo R2'nin gerçek mekanizmasını (Bucket Locks + haftalık logical
dump) yansıtacak şekilde güncellendi; bu tablo genel bir prensip olarak
Step 9'da sağlayıcı seçilmeden önce yazılmıştı.

| Metrik | Postgres | Object storage |
|---|---|---|
| RPO (MVP, gerçek müşteri verisi yokken) | ≤ 24 saat (günlük snapshot) | ≤ 1 hafta (haftalık logical dump/backup kopyası — R2 versioning desteklemiyor, Bucket Locks yalnızca silme/üzerine-yazmayı ÖNLÜYOR, önceki içeriği geri GETİRMİYOR) |
| RPO (gerçek müşteri verisi girdikten sonra) | ≤ 1 saat (PITR) | Aynı ≤ 1 hafta sınırı geçerli — daha sık logical dump/backup, gerçek müşteri verisi girmeden önce SIKILAŞTIRILMALI |
| RTO | ≤ 4 saat (staging'de doğrulanmış tam restore) | ≤ 2 saat (tek obje veya tam bucket senkronizasyonu, backup kopyasından) |
| Backup frequency | Günlük otomatik snapshot + haftalık logical dump | Haftalık logical dump/backup kopyası (R2 versioning YOK) + Bucket Locks (sürekli AKTİF, ama bu bir BACKUP değil, yalnızca kilit süresince silme/üzerine-yazma koruması) |
| Restore drill frequency | Production öncesi 1×, sonra 3 ayda 1 | Postgres drill'iyle birlikte |

## 4. Restore ön koşulları

- Hedef ortamın (staging veya production-acil-durum) `DATABASE_URL`'i
  restore edilecek Postgres instance'ına işaret etmeli — **canlı
  production instance'ına DOĞRUDAN restore YAPMAYIN**, önce yeni/boş bir
  instance'a restore edip doğrulayın, sonra trafiği yönlendirin (bkz. §6).
  Bu doğrudan repo koduna bir hüküm değildir, standart bir güvenli-restore
  disiplinidir.
- `pg_dump`/`pg_restore` (PostgreSQL 16 client tools) gerekli — ama
  **bunların host makinede AYRICA kurulu olması ZORUNLU DEĞİL**
  (Production Step 10'da doğrulandı): staging/local Docker ortamında,
  bu araçlar zaten çalışan `postgres:16-alpine` container'ının içinde
  mevcut — `docker compose exec -T postgres pg_dump/pg_restore ...` ile
  host'ta hiçbir ek kurulum yapmadan kullanılabilir (bkz.
  `scripts/restore-drill-staging.sh`'ın kendisi, tam olarak bu yolu
  izliyor). Host-side kurulum yalnız container dışı bir Postgres'e
  (ör. managed bir sağlayıcıya) doğrudan bağlanmak gerektiğinde
  gerekir. Seçilen S3-uyumlu sağlayıcının CLI'ı (`aws` CLI veya
  eşdeğeri) yine de yerel makinede kurulu olmalı (S3 tarafı bir
  container içinde çalışmıyor).
- Restore edilecek backup'ın hangi migration seviyesinde alındığı bilinmeli
  (`schema_migrations` tablosunun backup içindeki içeriği) — restore
  sonrası `database/migrations/`'daki dosyalarla karşılaştırılacak (§7).

## 5. Postgres restore adımları

```bash
# --- DESTRUCTIVE: aşağıdaki adımlar hedef veritabanının içeriğini
# TAMAMEN DEĞİŞTİRİR. Canlı bir production instance'ına karşı ASLA
# doğrudan çalıştırmayın — önce yeni/boş bir instance'a restore edin.

# 1. Yeni/boş bir Postgres instance'ı hazırlayın (managed sağlayıcının
#    kendi arayüzü/CLI'ı ile, veya yerel staging drill için:)
docker run -d --name grafista-restore-drill \
  -e POSTGRES_USER=grafista -e POSTGRES_PASSWORD=<PLACEHOLDER> \
  -e POSTGRES_DB=grafista_restore_drill -p 5433:5432 postgres:16-alpine

# 2. Snapshot/dump'ı restore edin
#    (a) Managed sağlayıcının kendi point-in-time/snapshot restore'u
#        (sağlayıcıya özel, burada placeholder komut yok — sağlayıcının
#        kendi dokümantasyonunu izleyin)
#    (b) Logical dump'tan (pg_dump ile alınmış .dump veya .sql dosyası):
pg_restore --clean --if-exists --no-owner \
  -h localhost -p 5433 -U grafista -d grafista_restore_drill \
  <PLACEHOLDER_BACKUP_FILE>.dump

# 3. schema_migrations tablosunun içeriğini kontrol edin
psql -h localhost -p 5433 -U grafista -d grafista_restore_drill \
  -c "SELECT filename, applied_at FROM schema_migrations ORDER BY filename;"

# 4. Eğer restore edilen backup, repo'daki en güncel migration'dan
#    eskiyse (database/migrations/'da schema_migrations'ta olmayan
#    dosyalar varsa), eksik migration'ları uygulayın:
DATABASE_URL="postgresql://grafista:<PLACEHOLDER>@localhost:5433/grafista_restore_drill" \
  pnpm --filter @grafista/api run db:migrate
```

## 6. S3/object storage restore adımları

```bash
# --- Aşağıdaki komutlar örnek/placeholder'dır; kullanılan S3-uyumlu
# sağlayıcının kendi CLI syntax'ına göre uyarlanmalıdır (aws s3 /
# rclone / sağlayıcıya özel CLI).

# 1. Versioning açık bir bucket'ta, belirli bir objenin önceki
#    versiyonunu geri getirme (tek obje, yanlışlıkla silinme/üzerine
#    yazılma senaryosu):
aws s3api list-object-versions \
  --bucket <PLACEHOLDER_BUCKET> --prefix "brand-assets/<clientId>/"
aws s3api copy-object \
  --bucket <PLACEHOLDER_BUCKET> \
  --copy-source "<PLACEHOLDER_BUCKET>/<KEY>?versionId=<VERSION_ID>" \
  --key "<KEY>"

# 2. Tam bucket'ı yeni/boş bir bucket'a senkronize etme (bucket-seviyesi
#    felaket kurtarma senaryosu — DESTRUCTIVE olmayan yön, hedef bucket
#    boş olduğu sürece güvenli):
aws s3 sync "s3://<PLACEHOLDER_SOURCE_BUCKET>" "s3://<PLACEHOLDER_TARGET_BUCKET>"

# 3. Restore sonrası, Postgres'teki storage_bucket/storage_key
#    referanslarının yeni bucket adıyla eşleştiğini doğrulayın (bucket
#    adı değiştiyse, ilgili satırların storage_bucket kolonu da
#    güncellenmeli — repo'da bunu yapan bir migration/script YOK, bu
#    Step 9'un kapsamı dışı bırakılan bir gelecek iş kalemi).
```

## 7. Staging restore drill adımları (dry-run)

Bugüne kadar gerçek production verisi/yedeği olmadığı için, aşağıdaki
drill **staging'de sentetik/seed veriyle** çalıştırılmalı — gerçek bir
restore denemesi değil, prosedürün KENDİSİNİN çalıştığını doğrulayan bir
egzersiz.

1. `pnpm run staging:up` ile staging stack'ini ayağa kaldırın, `db:migrate`
   + `db:seed` + `db:seed-demo` çalıştırın (bkz.
   `docs/deployment-runbook.md` §5, adım 12/14).
2. Seed edilmiş veritabanından bir `pg_dump` alın:
   ```bash
   docker compose -f docker-compose.staging.yml exec -T postgres \
     pg_dump -U grafista grafista_staging > /tmp/drill-backup.sql
   ```
3. Staging stack'ini tamamen indirin (`pnpm run staging:down`) — bu,
   Postgres volume'unu SİLMEZ (named volume `grafista_staging_pgdata`
   kalıcıdır), gerçek bir veri kaybı senaryosunu simüle etmek için
   volume'u da açıkça silin: `docker volume rm grafista-ai-studio_grafista_staging_pgdata`.
4. Stack'i tekrar ayağa kaldırın (`pnpm run staging:up`) — bu noktada
   veritabanı BOŞTUR (yeni volume).
5. §5'teki adımları izleyerek `/tmp/drill-backup.sql`'i restore edin.
6. **Başarı kriterleri** (bkz. `docs/deployment-runbook.md` §5'in
   sağlık kontrolleriyle aynı standart):
   - Postgres restore hatasız tamamlandı.
   - `schema_migrations` içeriği, `database/migrations/`'daki dosyalarla
     tutarlı (eksik migration yok).
   - `GET /api/health` → 200.
   - `GET /api/health/ready` → `database` check `ok`.
   - Seed edilmiş örnek client/brand-asset'lerin storage referansları
     hâlâ erişilebilir (`getObjectBuffer()` ile örnek bir dosyayı geri
     okuyup checksum'ını karşılaştırın).
   - `pnpm run ci:staging` (veya en azından `smoke:staging`) PASS.
7. Bu drill'i `docs/deployment-runbook.md` §5'e **production öncesi
   zorunlu bir gate** olarak eklendi (bkz. aşağıdaki "İlgili dokümanlar"
   ve o dosyadaki §11 güncellemesi).

## 8. Production restore acil durum adımları

> Bu bölüm, gerçek bir production incident'ı sırasında izlenecek sırayı
> tarif eder — bugüne kadar hiç gerçek production olmadığı için (bkz.
> dosya başı uyarısı) bu adımlar HENÜZ gerçek bir olayda test edilmedi.

1. **Durdur:** etkilenen servise yeni trafiği durdurun (mümkünse
   maintenance-mode/503, tam kapatma değil — mevcut kullanıcı
   session'larının aniden kopmasını önlemek için).
2. **Kapsam belirle:** hangi veri etkilendi — yalnızca Postgres mi,
   yalnızca storage mı, ikisi birden mi? `GET /api/health/ready`'nin
   `database`/`storage` check'lerinin hangisi `error` döndüğüne bakın.
3. **Yeni instance'a restore et, ASLA canlı instance'ın üzerine
   yazmayın** — §5/§6'daki adımları YENİ bir Postgres instance'ına ve
   (bucket-seviyesi felaketse) yeni bir bucket'a uygulayın.
4. **Doğrula (§9'daki checklist ile), SONRA trafiği yönlendir** —
   `DATABASE_URL`/`S3_BUCKET` env değişkenlerini yeni instance'a
   işaret edecek şekilde güncelleyip API'yi yeniden başlatın.
5. **Post-mortem:** kök nedeni belirleyin, bu runbook'a (veya ilgili
   koda) bir düzeltme/önlem olarak geri besleyin.

## 9. Verification checklist (her restore sonrası)

> **GÜNCELLEME (Production Step 10):** bu checklist artık gerçek bir
> staging restore drill'inde birebir uygulandı (bkz. §12) — teorik bir
> liste olmaktan çıktı. `GET /api/health/ready`'nin `database`/`storage`
> maddesi ok olsa da, drill sırasında `workerHeartbeat` check'inin
> restore sonrası birkaç saniyeliğine `degraded` görünebildiği gözlemlendi
> (§12'de detaylı) — bu maddeyi "ok" ile birebir eşleştirmek yerine
> aşağıdaki gibi netleştirildi.

- [x] Postgres restore hatasız tamamlandı (exit code 0). — §12'de
      doğrulandı (`pg_restore --clean --if-exists`).
- [x] `schema_migrations` tablosu `database/migrations/`'daki tüm
      dosyaları içeriyor (eksikse `db:migrate` ile tamamlandı). — §12'de
      doğrulandı (tam eşleşme).
- [x] `GET /api/health` → 200. — §12'de doğrulandı.
- [ ] `GET /api/health/ready` → `database` check `ok`, `storage` check
      `ok`. **Not:** `workerHeartbeat` check'i restore'dan hemen sonraki
      ilk birkaç saniyede `degraded` görünebilir (§12) — bu bir blocker
      DEĞİL (§8 doktrini ile tutarlı), ama `database`/`storage` check'i
      spesifik olarak `ok` olmalı, genel `status` alanının `degraded`
      olması TEK BAŞINA bir fail sinyali değildir.
- [x] Örnek bir kalıcı-tier objesi (`brand-assets/`) checksum ile geri
      okunup doğrulandı. — §12'de sha256 ile doğrulandı (local mode;
      `design-references/`/`generated-outputs/` henüz ayrı test
      edilmedi — aynı kod yolunu kullandıkları için düşük risk, ama
      TEK TEK doğrulanmadı).
- [ ] Rastgele seçilmiş birkaç Postgres satırının storage referansı
      gerçekten erişilebilir bir objeye işaret ediyor (orphan referans
      yok). — §12'nin drill'i yalnız TEK bir sentetik satır kullandı,
      bu maddeyi "çoklu satır" ölçeğinde henüz egzersiz etmedi.
- [x] `pnpm run ci:staging` (veya eşdeğer bir smoke test) PASS. — §12'de
      `smoke:staging` 0 fail ile çalıştırıldı (1 pass/3 warn/1 skip).

## 10. Rollback checklist

Bir restore denemesi BAŞARISIZ olursa veya beklenmeyen bir veri
tutarsızlığı ortaya çıkarsa:

- [ ] Yeni/hedef instance'ı SİLMEYİN — teşhis için saklayın.
- [ ] Trafiği (yönlendirilmişse) eski/orijinal instance'a geri alın.
- [ ] Kullanılan backup dosyasının/snapshot'ın bütünlüğünü doğrulayın
      (bozuk bir dump dosyası mı, yoksa restore prosedüründeki bir adım
      mı hatalı — ayırt edin).
- [ ] Postgres restore BAŞARILI ama artifact/object-storage restore
      BAŞARISIZ olduysa (veya tersi): ikisini AYRI başarı/başarısızlık
      olarak ele alın — restore edilmiş Postgres instance'ını, artifact
      tarafı düzelene kadar SİLMEYİN/DÜŞÜRMEYİN (veri güvenliği,
      kolaylıktan önce gelir). §12'nin drill'i bu iki tarafı bilinçli
      olarak ayrı checksum'larla doğruladı, tam da bu senaryoyu
      ayırt edebilmek için.
- [ ] Bu runbook'un ilgili adımını (§5/§6/§7) güncelleyin, aynı hataya
      bir daha düşülmesin.

## 11. Failure escalation

- Restore, §9 checklist'ini geçemiyorsa ve kapsam production ise:
  bu bir P0/acil durumdur — mevcut ekip iletişim kanalı üzerinden
  derhal eskale edilmeli (bu repo'da henüz tanımlı bir oncall/eskalasyon
  prosedürü yok — bu, bu dokümanın kapsamı dışında kalan ayrı bir
  operasyonel boşluktur, `docs/production-readiness-review.md` §5/§6'nın
  monitoring/logging boşluklarıyla aynı kategoride).
- Managed sağlayıcının kendi snapshot/PITR mekanizması başarısız
  olursa (ör. sağlayıcı-taraflı bir kesinti): §3a'daki haftalık logical
  dump ikinci savunma hattı olarak kullanılmalı — bu yüzden bu dump'ın
  sağlayıcıdan BAĞIMSIZ bir konumda tutulması (§3a) kritik.

## 12. First Staging Restore Drill Result (Production Step 10)

- **Tarih/saat:** 2026-07-07, ~13:33 (yerel), ikinci (başarılı) koşum.
- **Branch:** `phase-2-checkpoint`.
- **Commit:** Step 9'un `3f48bf4`'ü üzerine, bu Step 10'un kendi
  `scripts/restore-drill-staging.sh`'ı (bu drill sırasında henüz commit
  edilmemiş working-tree değişikliği) ile çalıştırıldı.
- **Ortam:** yerel makine, Docker Desktop, `docker-compose.staging.yml`
  stack'i (`postgres:16-alpine` + `apps/api` container) — gerçek bir CI
  runner'da DEĞİL, gerçek production/managed altyapıda HİÇ DEĞİL.
  Kullanılan tüm veri (client, `brand_assets` satırı, artifact bytes)
  bu drill'in kendisi tarafından üretilen sentetik veri — gerçek müşteri
  verisi veya gerçek secret KULLANILMADI.
- **Kullanılan komut:** `bash scripts/restore-drill-staging.sh`.

### Sonuç: PASS (ikinci denemede — birinci deneme gerçek bir script
### bug'ı yakaladı, bu tam olarak bu adımın amacı)

**İlk deneme BAŞARISIZ oldu — ve bu, drill'in kendisinin değerini
kanıtladı:** `seed` aşamasında, sentetik client'ı oluşturan
`INSERT ... RETURNING id;` komutunun çıktısı `psql -t -A` ile
ayrıştırılırken, psql'in `-t`/`-A` bayraklarının bir `INSERT ... RETURNING`
komutunun "INSERT 0 1" tamamlanma etiketini BASTIRMADIĞI ortaya çıktı —
dönen UUID ile bu etiket birleşip geçersiz bir UUID string'i oluşturdu
(`7dd77fea-...a0a9cINSERT01`), bir sonraki `brand_assets` INSERT'i bu
yüzden `invalid input syntax for type uuid` hatasıyla düştü. **Script
sadece yazılıp hiç çalıştırılmasaydı, bu bug hiç yakalanmazdı.**
Düzeltme: `INSERT ... RETURNING id` bir `WITH ins AS (INSERT ... RETURNING
id) SELECT id FROM ins;` CTE'sine sarıldı — dıştaki komut artık gerçek
bir `SELECT`, ki bu, `-t`'nin doğru şekilde bastırdığı durum. Script'in
`trap cleanup`'ı bu başarısız denemede de doğru çalıştı: container
logları dump edildi, stack + volume tamamen indirildi, host-side scratch
dizini silindi — hiçbir kalıntı kalmadı (`docker compose ps -a` ve
`docker volume ls` ile doğrulandı).

**İkinci deneme, düzeltme sonrası, TAM PASS:**

| Aşama | Sonuç |
|---|---|
| setup (build, staging:up, healthcheck, migrate) | PASS — 2/2 servis healthy |
| seed (sentetik client + `brand_assets` satırı + artifact bytes) | PASS |
| backup (`pg_dump -Fc`, artifact host'a kopyalandı) | PASS — backup checksum orijinalle eşleşti |
| reset (`docker compose down -v` + `staging:up`) | PASS — reset sonrası `public` şemada 0 tablo doğrulandı (gerçek veri kaybı simülasyonu) |
| restore (`pg_restore --clean --if-exists`, artifact geri kopyalandı) | PASS |
| verify — `schema_migrations` vs disk | PASS — tam eşleşme |
| verify — restore edilmiş `brand_assets` satırı | PASS — 1 satır, `storage_key` eşleşiyor |
| verify — artifact checksum (sha256, restore öncesi/sonrası) | **PASS — `6e045ca5...` birebir eşleşti** (asıl kanıt bu, "komut exit 0 döndü" değil) |
| verify — `GET /api/health` | PASS — 200 |
| verify — `GET /api/health/ready` | `database`/`storage`/`renderQueue`/`playwright` ok; `workerHeartbeat`/`providers` degraded (aşağıya bkz.) |
| verify — `smoke:staging` | PASS (0 fail) — 1 pass, 3 warn, 1 skip |
| cleanup | PASS — stack + volume + scratch dizin tamamen temizlendi |

**Gerçek, dürüst bir gözlem — `workerHeartbeat` bazen `degraded`, ve bu
İLK teoriden DAHA GENEL bir şey çıktı:** Bu drill'in restore-sonrası
ayağa kalkışında `smoke:staging`, `workerHeartbeat` check'ini `degraded`
("no worker heartbeat within the last 10000ms") olarak raporladı. İlk
hipotez "restore edilen eski heartbeat satırı" idi — **ama bu Step
10'un kendi FİNAL doğrulama koşumunda** (bu drill'le hiç ilgisi olmayan,
sıradan bir `pnpm run ci:staging`, restore YOK, dümdüz bir `staging:up`)
**AYNI `degraded` durumu YİNE gözlemlendi.** Bu, ilk teoriyi ÇÜRÜTÜYOR:
sorun restore'a özgü değil. Bu oturumdaki 3 koşumun özeti — baseline
(Step 10'un ilk doğrulaması, restore yok): `ok`; bu drill (restore
sonrası): `degraded`; final doğrulama (restore yok, dümdüz `ci:staging`):
`degraded` — 3'te 2'si `degraded`, ikisi de restore'suz. **Dürüst sonuç:
bu muhtemelen `smoke:staging`'in, worker'ın ilk heartbeat tick'ini
yazmasıyla yarışan genel bir zamanlama duyarlılığı** (makine
yüküne/zamanlamaya bağlı, `docs/ci-stable-profile.md`'nin kendi
ephemeral-port flake'inin "yük hassasiyeti" karakterine benzer bir
desen) — restore'a ÖZGÜ bir regresyon değil, ama kesin kök neden de
BAĞIMSIZ OLARAK DOĞRULANMADI (3 örneklem küçük bir sayı). **Bu bir
blocker DEĞİL** — `docker-compose.staging.yml`'in kendi healthcheck'i
zaten `/api/health` (liveness) kullanıyor, `/api/health/ready` değil
(§8 doktrini), ve `smoke:staging` bunu doğru şekilde WARN (FAIL değil)
olarak sınıflandırdı. Restore prosedürüne yeni bir adım
GEREKTİRMİYOR — ama gerek restore sonrası gerekse sıradan bir
`staging:up` sonrası ilk ~10-15 saniyede `workerHeartbeat`'in geçici
olarak `degraded` görünebileceği, "her şey yeşil" beklentisine karşı
dokümante edilmesi gereken bir bulgu.

**Simülasyon/placeholder olarak kalan kısımlar (dürüstçe restate):**

- **Object storage restore'u** gerçek bir otomatik backup mekanizmasıyla
  DEĞİL, bu drill'in kendisinin aldığı MANUEL bir host-side kopya ile
  egzersiz edildi (`docker compose exec ... cat <path> > host-file`,
  sonra restore'da tersi) — bu, §1d/§2'nin zaten belirttiği "local modda
  otomatik backup yok" gerçeğini DEĞİŞTİRMEDİ, yalnızca RESTORE
  MEKANİĞİNİN (bir backup koyulursa geri yüklenebildiğinin) çalıştığını
  kanıtladı. `STORAGE_PROVIDER=s3` modu bu skeleton'da hiç kurulu değil
  (§2), o yüzden gerçek bir S3/MinIO restore'u bu drill'in kapsamı
  dışında kaldı.
- **Tek bir sentetik `brand_assets` satırı** kullanıldı —
  `design-references`/`generated-outputs` ayrı test edilmedi (aynı
  `storage/file-service.ts` kod yolunu paylaştıkları için düşük risk,
  ama doğrulanmamış varsayım).
- **Gerçek production verisi/managed Postgres/S3 hiç kullanılmadı** —
  bu, senkron/staging'de sentetik veriyle bir egzersizdi, gerçek bir
  felaket kurtarma testi değil.
- **`docker compose exec` yaklaşımı, §4'ün önceki halinin öngördüğü
  host-side `pg_dump`/`pg_restore` kurulumu gereksinimini FİİLEN
  gevşetiyor** — bu drill hiçbir host-side Postgres client tool'u
  kurmadan, tüm `pg_dump`/`pg_restore`'u zaten çalışan `postgres`
  container'ının İÇİNDE çalıştırarak yaptı. §4 bu gözlemle güncellendi
  (küçük bir doküman düzeltmesi, restore mekaniğini değiştirmiyor).
- **Idempotent/tekrar-çalıştırılabilirlik doğrulandı:** script iki kez
  art arda (biri başarısız, biri başarılı) çalıştı, ikisi de temiz
  başladı/bitti — ikinci koşum birincinin bıraktığı hiçbir kalıntıdan
  etkilenmedi.

## 13. Managed Infrastructure Requirements (Production Step 11)

> **Status: GEREKSİNİM TARİFİ — bu bölümdeki drill bu adımda
> ÇALIŞTIRILMADI.** §12'nin drill'i sentetik veriyle, LOCAL Docker
> ortamına karşıydı. Bu bölüm o drill'in managed Postgres/S3 karşılığının
> NE gerektirdiğini tarif ediyor — kendisi bir egzersiz değil. Karar
> kriterleri (hangi sağlayıcı seçilecek) için bkz.
> [`docs/managed-infrastructure-plan.md`](./managed-infrastructure-plan.md) —
> burada TEKRARLANMIYOR.

### 13a. §12'nin drill'i ile managed-altyapı drill'i arasındaki fark

| Boyut | §12'nin drill'i (Production Step 10) | Managed-altyapı drill'i (gerekli, henüz yapılmadı) |
|---|---|---|
| Postgres | `postgres:16-alpine` container, local Docker volume | Gerçek managed Postgres instance (sağlayıcı seçildikten sonra) |
| Object storage | Local disk (`STORAGE_PROVIDER=local`, manuel host-side kopya) | Gerçek S3-uyumlu bucket, `STORAGE_PROVIDER=s3`, versioning açık |
| Veri | Sentetik (drill'in kendi ürettiği tek `brand_assets` satırı) | Yine sentetik/test verisi ÖNERİLİR (gerçek müşteri verisi girmeden önce en az bir kez) — ASLA gerçek production verisiyle "ilk deneme" yapılmamalı |
| Backup mekanizması | Manuel `pg_dump`/host-side kopya (script'in kendisi) | Sağlayıcının OTOMATİK snapshot/PITR mekanizmasından bir restore (script'in `pg_dump`/`pg_restore` adımları managed sağlayıcının restore CLI'ına/konsoluna uyarlanmalı) |
| Amaç | Restore MEKANİĞİNİN (script/prosedür) doğru olduğunu kanıtlamak | Aynı prosedürün SEÇİLEN GERÇEK sağlayıcıda da çalıştığını kanıtlamak — sağlayıcıya özgü farklar (CLI syntax'ı, IAM/erişim modeli, snapshot restore akışı) burada ilk kez ortaya çıkar |

**Net gate, tekrar altı çizilerek:** managed sağlayıcı seçilip
provizyonlanmadan (bkz. `docs/managed-infrastructure-plan.md` §3a/§3b,
`docs/deployment-runbook.md` §17) bu drill hiç başlatılamaz — bu bir
sıralama sorunu, atlanabilir bir adım değil. **Managed sağlayıcı
seçilmeden VE bu drill managed altyapıda tekrar edilip PASS almadan
production deploy YOK.**

### 13b. Managed-altyapı drill'inin beklenen adımları (taslak — sağlayıcı seçilince kesinleşir)

Aşağıdaki adımlar §7'nin/`scripts/restore-drill-staging.sh`'ın yapısını
İZLİYOR, ama sağlayıcıya özgü komutlar seçim yapılmadan YAZILAMAZ — bu
yüzden burada yalnız placeholder'lı bir taslak var, gerçek sağlayıcı CLI
syntax'ı değil:

1. Managed Postgres'te sentetik/test verisiyle bir "before" snapshot al
   (sağlayıcının kendi manuel/on-demand snapshot tetikleyicisi ile, otomatik
   günlük snapshot'ı BEKLEMEDEN).
2. Aynı test verisini S3-uyumlu bucket'a da yaz (bir `brand_assets`
   satırının işaret ettiği gerçek bir obje).
3. Yeni/boş bir Postgres instance'ına (AYNI sağlayıcıda, ayrı bir
   instance/database) snapshot'tan restore et — §5'in `pg_restore`
   adımlarının sağlayıcıya özel restore akışına (konsol/CLI) karşılığı.
4. Bucket'ın versioning'i üzerinden aynı objenin önceki versiyonunu geri
   getir (§6'nın `aws s3api copy-object` örneğinin gerçek sağlayıcı
   karşılığı).
5. §9'un verification checklist'ini AYNEN uygula (`schema_migrations`
   eşleşmesi, `GET /api/health`/`/api/health/ready`, checksum doğrulaması,
   `smoke:staging` veya production'a uyarlanmış eşdeğeri).
6. Sonucu bu bölüme (13c) EKLE — üzerine yazma, §12'nin formatını izle
   (tarih, ortam, komut, PASS/FAIL, bulunan varsa bug).

### 13c. Sonuç kaydı

**Henüz çalıştırılmadı.** Bu alt bölüm, drill gerçekten managed altyapıya
karşı çalıştırıldığında §12'nin formatıyla (tarih/ortam/komut/sonuç
tablosu) doldurulacak — bugün için boş, ve bu doğrudan
`docs/production-readiness-review.md`'nin Step 11 güncellemesinde
"planned, not provisioned" olarak da işaretleniyor.

---

## 14. Managed Staging Restore Drill — Net Gate (Production Step 12)

> **Status: GATE NETLEŞTİRMESİ — bu adımda hiçbir drill çalıştırılmadı,
> §13c hâlâ boş.** Kullanıcı Option A'yı (düşük operasyon / hızlı MVP)
> seçti (`docs/managed-infrastructure-plan.md` §7) ve provider
> short-list'i hazırlandı (aynı belge §8) — ama somut bir sağlayıcı hâlâ
> SEÇİLMEDİ, bu yüzden §13b'nin taslak adımları hâlâ placeholder'lı, hâlâ
> yürütülemez durumda.

**Net gate, Production Step 13 veya 14'e ertelendi — burada AÇIKÇA
yazılı:**

- **§7'nin local/staging drill'i (Production Step 10) PASS aldı** — bu
  hâlâ geçerli, restore MEKANİĞİNİN doğru olduğunu kanıtlıyor.
- **Managed staging drill'i (§13'ün tarif ettiği) HENÜZ YAPILMADI** — bu,
  bir sonraki somut altyapı adımının (sağlayıcı seçimi + staging
  provisioning, muhtemelen Production Step 13) parçası olarak
  planlanıyor; gerçekten çalıştırılıp PASS alması Production Step 13 VEYA
  14'te beklenıyor — hangisi olacağı, sağlayıcı seçiminin ne kadar
  sürdüğüne bağlı, bu belge bunu ÖNCEDEN İDDİA ETMİYOR.
- **Local/staging drill PASS olması, managed staging drill'in YERİNE
  GEÇMEZ** — ikisi ayrı ayrı gate'ler (§13a'nın tablosu zaten bu farkı
  netleştiriyor: farklı Postgres/storage, farklı backup mekanizması).
- **Bu iki gate'in İKİSİ DE karşılanmadan production deploy YOK** —
  §13a'nın zaten koyduğu ilke burada TEKRAR, daha açık şekilde altı
  çiziliyor: local/staging drill PASS + managed staging drill PASS,
  ikisi birlikte, tek biri yeterli DEĞİL.

---

## 15. Render + R2 Managed Staging Restore Drill (Production Step 13)

> **Status: PROSEDÜR TARİFİ — bu adımda hiçbir drill çalıştırılmadı,
> "pending provider provisioning" olarak işaretli.** Kullanıcı somut
> sağlayıcıları seçti (Render Postgres + Cloudflare R2,
> `docs/managed-infrastructure-plan.md` §9) — §14'ün "managed staging
> drill'i henüz yapılamaz" durumu artık DAHA SOMUT bir prosedürle
> tarif edilebiliyor, ama **gerçek Render/R2 servisleri kurulmadan bu
> drill ÇALIŞTIRILAMAZ.**

### 15a. Bu drill'in §7/§12'nin local drill'inden farkı

| Aşama | §7/§12'nin local drill'i (`scripts/restore-drill-staging.sh`) | Render + R2 drill'i (bu bölüm, henüz yapılamaz) |
|---|---|---|
| Postgres | `postgres:16-alpine` container, local Docker volume | Render Postgres (staging instance) |
| Dump/restore mekanizması | `docker compose exec postgres pg_dump/pg_restore` | `pg_dump`/`pg_restore` DOĞRUDAN Render Postgres'in dışa açık connection string'ine karşı (host'ta `psql`/`pg_dump` client araçları KURULU olmalı — §4'ün "container-dışı bir Postgres'e doğrudan bağlanmak host-side kurulum gerektirir" notu burada GEÇERLİ, local drill'in aksine) |
| Object storage | Local disk (`STORAGE_PROVIDER=local`, manuel host-side kopya) | Cloudflare R2 (gerçek `S3_ENDPOINT`/bucket'a karşı, `STORAGE_PROVIDER=s3`) |
| Backup mekanizması | Manuel `pg_dump`/host-side kopya | Render Postgres'in kendi otomatik snapshot'ından bir restore (§20e'nin doğrulanmamış PITR notuyla tutarlı — snapshot restore akışı Render'a özgü, henüz test edilmedi) |
| Veri koruması | N/A (local, disposable) | R2 Bucket Locks + lifecycle rules (§9c'nin düzeltilmiş mekanizması — versioning DEĞİL) |

### 15b. Beklenen adımlar (taslak — Render/R2 gerçekten provizyonlanınca kesinleşir)

1. Render Postgres staging instance'ında sentetik/test verisiyle bir
   "before" durumu oluştur (`db:seed`/`db:seed-demo` ile, PRODUCTION
   VERİSİ DEĞİL — `docs/deployment-runbook.md` §3'ün zaten koyduğu
   "db:seed-demo yalnız staging/local" ilkesi).
2. Render Postgres'in kendi manuel/on-demand snapshot mekanizmasını
   tetikle (otomatik günlük snapshot'ı BEKLEMEDEN) — tam mekanizma
   Render'ın kendi dokümantasyonundan provizyonlama sırasında teyit
   edilmeli, bu belge bir komut UYDURMUYOR.
3. R2 staging bucket'ına aynı test verisiyle ilişkili bir obje yaz (bir
   `brand_assets` satırının işaret ettiği gerçek bir dosya).
4. Yeni/boş bir Render Postgres instance'ına (AYNI staging ortamında,
   ayrı bir database) snapshot'tan restore et.
5. R2'de Bucket Locks aktifse, kilit süresi İÇİNDE bir objenin
   silinemediğini/üzerine yazılamadığını doğrula (§9c'nin "versioning
   DEĞİL, WORM-tarzı" ayrımının pratik doğrulaması) — bu, S3 versioning
   testinin YERİNE geçen, R2'ye özgü bir doğrulama adımı.
6. §9'un verification checklist'ini AYNEN uygula (`schema_migrations`
   eşleşmesi, `GET /api/health`/`/api/health/ready` Render staging
   URL'ine karşı, R2'den geri okunan objenin checksum'ı, `smoke:staging`
   Render staging'e karşı).
7. Sonucu §15c'ye (aşağı) EKLE — §12'nin formatını izle (tarih, ortam,
   komut, PASS/FAIL, bulunan varsa bug).

### 15c. Sonuç kaydı

**Henüz çalıştırılmadı — "pending provider provisioning".** Render
Postgres + Cloudflare R2 gerçekten kurulmadan bu bölüm boş kalacak. Bu,
`docs/production-readiness-review.md`'nin Step 13 güncellemesinde de
aynı şekilde "managed staging restore drill henüz yapılmadı" olarak
işaretleniyor.

### 15d. Tetikleme kriterleri (preflight, Production Step 14)

> **Bu alt bölüm drill'i ÇALIŞTIRMIYOR** — Render/R2 hâlâ provizyonlanmadı
> (`docs/deployment-runbook.md` §21/§22'nin live setup checklist'leri hâlâ
> tamamlanmadı). Amacı, provizyonlama bittiğinde "şimdi mi çalıştırabilir
> miyiz" sorusuna kullanıcının kendi başına, tek tek madde işaretleyerek
> cevap verebileceği somut bir ön-koşul listesi vermek — §15b'nin
> "beklenen adımlar" taslağını YENİDEN YAZMIYOR, ondan ÖNCE gelen bir
> hazır-mı kontrolü.

Aşağıdaki maddelerin **HEPSİ** işaretlenmeden §15b'nin adımlarına
başlanmamalı:

- [ ] `docs/deployment-runbook.md` §21'in Render checklist'i tamamlandı
      (Postgres + API service + dashboard service ayakta, health check
      PASS).
- [ ] `docs/deployment-runbook.md` §22'nin R2 checklist'i tamamlandı
      (bucket + access key + endpoint doğrulandı).
- [ ] `docs/deployment-runbook.md` §23'ün env/secrets'ı Render panelinde
      girildi — `GET /api/health/ready`'nin `database`/`storage`
      check'leri `ok` dönüyor (gerçek staging URL'ine karşı, local'e
      değil).
- [ ] Drill için kullanılacak veri **sentetik/test verisi** olacak
      şekilde netleşti — `db:seed`/`db:seed-demo` ile, GERÇEK müşteri
      verisiyle değil (§15b adım 1'in zaten koyduğu ilke, burada
      tekrar altı çiziliyor: bu, gerçek müşteri verisi girmeden ÖNCE en
      az bir kez çalıştırılmalı).
- [ ] Drill'in hedef alacağı Postgres/R2 instance'ının **staging**
      olduğu (production DEĞİL) iki kişi tarafından teyit edildi — §5/§8
      "DESTRUCTIVE" uyarısının managed altyapı karşılığı: yanlış
      instance'a karşı çalıştırmak gerçek veri kaybına yol açabilir.
- [ ] Drill sonucu §15c'ye §12'nin formatıyla (tarih, ortam, komut,
      PASS/FAIL, bulunan varsa bug) eklenecek şekilde bir zaman/sorumlu
      ayrıldı — drill'in kendisi bu belgeyi güncellemeyecek, çalıştıran
      kişi güncellemeli.

**Bu liste tamamlanmadan §15c boş kalmaya devam edecek — bu Step 14'ün
kendi bulgusu değil, §14'ün zaten koyduğu gate'in doğrudan devamı.**

---

## İlgili dokümanlar

- [`docs/managed-infrastructure-plan.md`](./managed-infrastructure-plan.md) —
  Production Step 11: managed Postgres/S3/hosting/secrets/monitoring/backup
  karar matrisi, env/secrets matrisi, §13'ün doğrudan kaynağı. Production
  Step 12: §7/§8 — Option A seçimi ve provider short-list'i, §14'ün
  doğrudan girdisi. Production Step 13: §9 — Render + R2 somut seçimi,
  §9c'nin R2 versioning düzeltmesi, §15'in doğrudan kaynağı.
- [`docs/deployment-runbook.md`](./deployment-runbook.md) §18 — Production
  Step 12: Staging Deployment Gate checklist'i, §14'ün "managed staging
  drill" adımının restore-drill maddesiyle eşleştiği yer. §19/§20 —
  Production Step 13: Cloudflare R2 ve Render Postgres staging setup,
  §15'in doğrudan girdisi.
- `scripts/restore-drill-staging.sh` — §12'nin tam otomasyonu, §7'nin
  kod hali. Güvenlik guard'ları (NODE_ENV/DATABASE_URL kontrolü),
  aşama-aşama loglama (setup/seed/backup/reset/restore/verify/cleanup),
  re-runnable tasarım.
- [`docs/production-readiness-review.md`](./production-readiness-review.md)
  §10, §16 — bu dokümanın doğrudan kaynağı olan backup/restore boşluğu
  tespiti.
- [`docs/deployment-runbook.md`](./deployment-runbook.md) §6, §11 —
  migration/rollback stratejisi ve bu dokümanla birlikte güncellenen
  restore-drill gate'i.
- [`docs/ci-stable-profile.md`](./ci-stable-profile.md) — CI gate'inin
  (candidate merge gate) bu dokümandaki data-safety gate'ten AYRI bir
  şey olduğuna dair netlik.
- [`docs/staging-compose.md`](./staging-compose.md) — staging skeleti'nin
  local-storage-disposable tasarım kararı, §1d'nin kaynağı.
- `apps/api/src/storage/factory.ts`, `apps/api/src/storage/types.ts` —
  storage provider soyutlamasının kod kaynağı, §2'nin "sıfır kod
  değişikliği" iddiasının doğrudan kanıtı.
- `apps/api/src/db/migrate.ts`, `apps/api/src/scripts/db-migrate.ts` —
  migration runner'ın kod kaynağı, §5 adım 3-4'ün dayandığı mekanizma.
