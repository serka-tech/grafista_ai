# Grafista AI Studio — Backup/Restore Runbook (Production Step 9)

> **Durum:** PROSEDÜR + KARAR DOKÜMANI. Bu adımda hiçbir production deploy
> yapılmadı, hiçbir yeni ürün özelliği eklenmedi, hiçbir migration
> eklenmedi. Aşağıdaki backup/restore prosedürü **staging'de bir dry-run
> restore drill ile egzersiz edilmedi** — bugüne kadar hiçbir gerçek
> production verisi/yedeği yok (`docs/production-readiness-review.md` §16:
> "Gerçek production ortamına HİÇ deploy yapılmadı"), dolayısıyla
> aşağıdaki adımların hiçbiri gerçek bir yedekten gerçek bir restore ile
> doğrulanmadı. Bu doküman, `docs/production-readiness-review.md` §10 ve
> `docs/deployment-runbook.md` §11'in ikisinin de tespit ettiği aynı boşluğu
> ("backup/restore prosedürü hiçbir yerde yazılı değil") kapatmak için
> yazıldı — **prosedür artık yazılı, ama henüz gerçek veriye karşı
> egzersiz edilmiş değil.**

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
  lifecycle ile.
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
  sayesinde geri getirilebilir.
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

| Metrik | Postgres | Object storage |
|---|---|---|
| RPO (MVP, gerçek müşteri verisi yokken) | ≤ 24 saat (günlük snapshot) | Sürekli (her yazma kendi versiyonu) |
| RPO (gerçek müşteri verisi girdikten sonra) | ≤ 1 saat (PITR) | Sürekli (değişmez) |
| RTO | ≤ 4 saat (staging'de doğrulanmış tam restore) | ≤ 2 saat (tek obje veya tam bucket senkronizasyonu) |
| Backup frequency | Günlük otomatik snapshot + haftalık logical dump | Sürekli (versioning) |
| Restore drill frequency | Production öncesi 1×, sonra 3 ayda 1 | Postgres drill'iyle birlikte |

## 4. Restore ön koşulları

- Hedef ortamın (staging veya production-acil-durum) `DATABASE_URL`'i
  restore edilecek Postgres instance'ına işaret etmeli — **canlı
  production instance'ına DOĞRUDAN restore YAPMAYIN**, önce yeni/boş bir
  instance'a restore edip doğrulayın, sonra trafiği yönlendirin (bkz. §6).
  Bu doğrudan repo koduna bir hüküm değildir, standart bir güvenli-restore
  disiplinidir.
- `pg_dump`/`pg_restore` (PostgreSQL 16 client tools — repo `postgres:16-alpine`
  kullanıyor, `docker-compose.staging.yml`) ve seçilen S3-uyumlu sağlayıcının
  CLI'ı (`aws` CLI veya eşdeğeri) yerel makinede kurulu olmalı.
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

- [ ] Postgres restore hatasız tamamlandı (exit code 0).
- [ ] `schema_migrations` tablosu `database/migrations/`'daki tüm
      dosyaları içeriyor (eksikse `db:migrate` ile tamamlandı).
- [ ] `GET /api/health` → 200.
- [ ] `GET /api/health/ready` → `database` check `ok`, `storage` check
      `ok` (veya en azından `degraded` değil).
- [ ] Örnek bir kalıcı-tier objesi (`brand-assets/`, `design-references/`,
      veya `generated-outputs/`) `getObjectBuffer()`/CLI ile geri okunup
      checksum'ı doğrulandı.
- [ ] Rastgele seçilmiş birkaç Postgres satırının storage referansı
      (`storage_provider`/`storage_bucket`/`storage_key`) gerçekten
      erişilebilir bir objeye işaret ediyor (orphan referans yok).
- [ ] `pnpm run ci:staging` (staging drill için) veya eşdeğer bir smoke
      test PASS.

## 10. Rollback checklist

Bir restore denemesi BAŞARISIZ olursa veya beklenmeyen bir veri
tutarsızlığı ortaya çıkarsa:

- [ ] Yeni/hedef instance'ı SİLMEYİN — teşhis için saklayın.
- [ ] Trafiği (yönlendirilmişse) eski/orijinal instance'a geri alın.
- [ ] Kullanılan backup dosyasının/snapshot'ın bütünlüğünü doğrulayın
      (bozuk bir dump dosyası mı, yoksa restore prosedüründeki bir adım
      mı hatalı — ayırt edin).
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

## İlgili dokümanlar

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
