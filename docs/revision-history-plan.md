# Grafista AI Studio — Revision History Plan (Phase 3 Step 6B)

> Bu belge, [`docs/analytics-revision-history-plan.md`](./analytics-revision-history-plan.md)'nin
> (Step 6A teslimatı — `analytics_events`, `GET /api/clients/:id/analytics/summary`,
> `analytics-summary-panel.tsx`) doğrudan devamıdır. §1-§7'deki gap analizi,
> AnalyticsEvent/RevisionEntry karar matrisi ve erteleme gerekçesi ORADA
> yapıldı, burada TEKRAR EDİLMEZ — yalnızca referans verilir. Bu belge Step
> 6B'nin (o belgenin §8.2'sinde taslak bırakılan `revision_entries` tablosu)
> kendi planıdır: gerçek kod yollarına karşı doğrulanmış bir MVP kapsamı,
> veri modeli, kayıt akışı, dashboard/RBAC/test planı ve devredilebilir bir
> implementation prompt'u içerir.

Status: **PLANNING ONLY — no code, no migration, no dependency added in this step.**
`apps/api`, `apps/dashboard` veya `database/migrations` içinde HİÇBİR şey
değişmez.

---

## 1. Mevcut durum — Step 6A neyi kapsadı, RevisionEntry'yi neden kapsamadı

Step 6A'nın gerçekte teslim ettiği event seti, `analytics-revision-history-
plan.md`'nin §8.1 taslağından DAHA DAR çıktı (bu, o belgenin kendi "PLANLAMA
ONLY" doğasının beklenen bir sonucu — implementation sırasında kapsam
daraltıldı). Bugün `packages/schemas/src/analytics.ts`'teki
`AnalyticsEventTypeEnum` şu 11 değeri taşıyor:

```
creative_qa_approved, visual_generation_succeeded, visual_generation_failed,
production_package_created, production_job_approved, production_job_rejected,
render_job_queued, render_job_rendered, render_job_failed, render_job_cancelled,
export_artifact_downloaded
```

Dikkat: **`design_brief_created`, `design_dna_*`, `layout_*` ve
`creative_qa_rejected` event'leri BUGÜN yok** — ne `analytics_events`
tablosunda (`database/migrations/023_analytics_events.sql`'in CHECK
constraint'i aynı 11 değeri listeliyor), ne repository'de
(`apps/api/src/db/repositories/analytics-events.ts`), ne dashboard panelinde
(`analytics-summary-panel.tsx`'in `EVENT_TYPE_LABELS` sözlüğü de aynı 11
değeri kapsıyor). Bu, Step 6B'nin planlanması için önemli bir girdi: bugün
**DesignDNA'nın approve/revise döngüsü, LayoutPlan'ın approve/reject/needs_
revision döngüsü ve CreativeQA'nın reject'i (yalnız approve var) analytics
tarafında bile görünmüyor** — RevisionEntry bu boşluğu Analytics'in
GENİŞLETİLMESİYLE değil, kendi (farklı amaçlı) tablosuyla kapatacak (bkz §5).

Bu bulgu, aşağıdaki §2-§4'teki "hangi varlık gerçekten revizyon değeri
taşıyor" analizinin çıkış noktasıdır.

---

## 2. Varlık bazında gerçek revizyon değeri — kod yoluna karşı doğrulanmış

| Varlık | Gerçek approve/reject/revise kod yolu var mı? | Notlar/nedenler KALICI mı? | Revizyon değeri |
|---|---|---|---|
| `DesignBrief` | **Evet ama tek-yönlü** — `POST /design-briefs/:id/approve` ve `/reject` (`apps/api/src/routes/design-briefs.ts`), `designBriefsRepo.updateStatus()` (`apps/api/src/db/repositories/design-briefs.ts:97`) | Yok — brief İÇERİĞİ (title/objective/copyGuidelines/vb.) hiçbir zaman değişmiyor, yalnızca `status` `draft→approved｜rejected｜needs_revision` arası TEK BİR kez flip ediliyor. `needs_revision`'dan geri approve/tekrar-oluşturma için HİÇBİR kod yolu yok (yeni bir brief `createDesignBriefFromContentIdea()` ile SIFIRDAN yaratılır, aynı satır güncellenmez) | **Düşük** — tek karar, geri-dönüş döngüsü yok; bir RevisionEntry snapshot'ı her seferinde AYNI içeriği taşırdı (yalnız status farklı) — bunun değeri zaten `approved_by`/`status` kolonuyla eşit |
| `DesignDNAReport` (`design_dna`) | **Evet, gerçek bir döngü** — `POST /clients/:clientId/design-dna/approve` ve `/revise` (`apps/api/src/routes/design-dna.ts:57-95`), `designDnaRepo.approve()`/`.requestRevision()` (`apps/api/src/db/repositories/design-dna.ts:247-271`). **`approve()`'un WHERE'i `status IN ('generated','waiting_for_approval')` — `needs_revision`'ı KAPSAMIYOR**, yani revize istenen bir DNA doğrudan approve edilemiyor (önce hiçbir yeniden-generate kod yolu da yok — pratikte bu satır `needs_revision`'da KİLİTLENEBİLİR, bu Step 6B'nin de not etmesi gereken ayrı bir mevcut-davranış gözlemi) | **Tek alan, ÜZERİNE YAZILIR** — `revision_notes` (`requestRevision()`'ın `SET revision_notes = $2`'si) her yeni revize istemi ÖNCEKİ notu SİLİYOR | **Yüksek** — gerçek round-trip potansiyeli (approve edilmiş DNA bile tekrar `needs_revision`'a gönderilebiliyor, kod yorumuyla doğrulandı: "approved DNA CAN still be sent back for revision"), ve not KAYBI bugün GERÇEK bir veri kaybı |
| `LayoutPlan` | **Evet, gerçek bir döngü** — `POST /layout-plans/:id/approve` (`status IN ('generated','needs_revision')` — needs_revision'dan approve MÜMKÜN, `apps/api/src/db/repositories/layout-plans.ts:127-136`) ve `/reject` (yalnız `'generated'`'dan, `:144`) | **HİÇ SAKLANMIYOR** — `009_layout_plans.sql` şemasında `notes`/`revision_notes` kolonu YOK; `reject(id, notes?)` `notes` parametresini SADECE `status`'u seçmek için kullanıyor (`notes ? 'needs_revision' : 'rejected'`), sonra parametre TAMAMEN ATILIYOR, hiçbir kolona yazılmıyor | **En yüksek** — round-trip GERÇEK (approve, needs_revision'dan geri approve edilebiliyor) VE bugün notlar %100 kayıp (overwrite bile değil — hiç yazılmıyor) |
| `CreativeQAReport` | **Evet, gerçek bir döngü** — `POST /creative-qa/:id/approve` (`status IN ('generated','passed','failed','needs_revision')` — needs_revision'dan approve MÜMKÜN, `apps/api/src/db/repositories/creative-qa.ts:183-192`) ve `/reject` (yalnız `'generated','passed','failed'`'dan, `:200-209`) | **HİÇ SAKLANMIYOR** — `011_creative_qa_reports.sql` şemasında da `notes` kolonu YOK; `reject(id, rejectedBy, notes?)` aynı `layout_plans.reject()` deseniyle notu ATIYOR (yalnız `rejected_by`/`rejected_at` kalıcı, metin kaybolur). Ayrıca **`creative_qa_rejected` bugün analytics'te bile YOK** (§1) — reject akışının hiçbir kalıcı izi yok | **En yüksek** — LayoutPlan ile aynı gerekçe, üstelik `score`/`qa_json` alanları zaman içinde "bu rapor neden 3 kez reddedildi, skorlar nasıl değişti" trend sorusuna da cevap verebilir |
| `GeneratedOutput`/`VisualOutput` | `version`/`parent_output_id` kolonları var (`generated_outputs`) ama **doğrulandı: HÂLÂ kullanılmıyor** — `apps/api/src/db/repositories/generated-outputs.ts:59-60` bu kolonları yalnızca OKUYUP mapliyor, hiçbir INSERT/UPDATE `parent_output_id`'yi set etmiyor (grep tekrar doğruladı, Step 6A audit'inin bulgusuyla birebir aynı) | N/A | **Düşük, Step 6B kapsamı DIŞI** — bu, "yeniden üretim zinciri" (bir görsel reddedilince yeni bir görsel üretilmesi) kavramına ait, RevisionEntry'nin (bir SATIRIN kendi geçmişi) kapsamı değil — ayrı bir "generation lineage" özelliği, Step 6B'ye pad EDİLMEMELİ |
| `ProductionJob` | **Evet ama TERMİNAL, round-trip YOK** — `approve()`/`reject()` yalnız `'package_ready'`'den (`apps/api/src/db/repositories/production-jobs.ts:191-224`); reddedilen/başarısız/iptal bir job **KALICI OLARAK terminal** — kod yorumu doğruluyor: "a rejected job is terminal and a new job can be created instead" (`:205-206`). Zaten `approved_by/at`, `rejected_by/at/reason` (`018_production_jobs_review_audit.sql`) VAR ve analytics'e ZATEN bağlı (`production_job_approved`/`rejected`) | Kalıcı (`rejection_reason`, tek karar) | **Orta-düşük** — tek kararlık audit zaten `approved_by`/`rejected_by`/`rejection_reason` + analytics event'iyle KAPLI; RevisionEntry eklemenin marjinal değeri düşük (aynı bilginin ikinci bir tabloda tekrarı). Ayrıca `listByGeneratedOutput()` (`:109`) zaten "bir generated_output için TÜM job geçmişini" (yeni satırlar üzerinden) döndürüyor — çoklu-deneme geçmişi zaten doğal olarak var |
| `RenderJob` | Kullanıcı-tetikli tek gerçek aksiyon: `cancelRenderJob()` (`apps/api/src/services/render-worker.ts:251-290`, `POST /render-jobs/:id/cancel`). **Retry TAMAMEN otomatik/worker-tetikli** — `processRenderJob()`'un `retryable` dalı `markRetry()`'yi worker döngüsü içinden çağırıyor (`:177-182`); **manuel bir `/retry` route'u YOK** (grep doğrulandı, `routes/render-jobs.ts`'te yalnızca `/cancel` var) | `attempt_count`/`error_message` zaten (Step 5A) — SON hatayı tutar, önceki attempt'lerin mesajları kaybolur | **Düşük-orta** — cancel zaten analytics'e bağlı (`render_job_cancelled`), tek yönlü bir aksiyon (round-trip yok); retry'nin bir "revizyon" olarak modellenmesi YANLIŞ çerçeve — bu bir SİSTEM/worker davranışı, bir insan kararı değil, RevisionEntry'nin (aktör + neden içeren) modeline uymuyor |
| `ExportArtifact` | Değişmez, her render yeni bir satır (Step 6A'nın kendi tespiti, hâlâ doğru) | N/A | **Yok** — revizyon kavramı anlamsız |

**Sonuç:** Prompttaki önerilen 5'li liste (`DesignBrief, LayoutPlan,
CreativeQAReport, ProductionJob, RenderJob`) gerçek kod yoluna karşı
doğrulandığında **iki tanesi (`DesignBrief`, `ProductionJob`) ve kısmen
üçüncüsü (`RenderJob`'un "retry" ayağı) düşük/yanlış-çerçeveli** çıkıyor.
Gerçek MVP değeri **`DesignDNAReport` + `LayoutPlan` + `CreativeQAReport`**'ta
yoğunlaşıyor — üçü de gerçek `needs_revision`-round-trip'e sahip, ikisi
(`LayoutPlan`, `CreativeQAReport`) bugün notlarını **hiç saklamıyor** (en
büyük somut açık).

---

## 3. Önerilen MVP entity/action seti — Step 6B

| Entity | Action'lar | Gerekçe |
|---|---|---|
| `design_dna` | `design_dna_approved`, `design_dna_needs_revision` | Gerçek round-trip, tek-alan overwrite bugün gerçek veri kaybı |
| `layout_plan` | `layout_plan_approved`, `layout_plan_rejected`, `layout_plan_needs_revision` | Gerçek round-trip, notlar bugün HİÇ saklanmıyor (en yüksek marjinal değer) |
| `creative_qa_report` | `creative_qa_report_approved`, `creative_qa_report_rejected`, `creative_qa_report_needs_revision` | Aynı gerekçe + `reject` bugün analytics'te bile yok (§1) |

**MVP'den kasıtlı olarak DIŞLANAN/ERTELENEN:**
- **`DesignBrief`** — dışlandı (§2): tek-yönlü karar, içerik hiç değişmiyor,
  round-trip yok. İleride bir "brief'i düzenle" endpoint'i eklenirse
  (bugün yok) o zaman yeniden değerlendirilebilir.
- **`ProductionJob`** — ertelendi: zaten `approved_by/rejected_by/
  rejection_reason` + analytics event'iyle kaplı, terminal-tek-karar,
  marjinal değer düşük. İstenirse Step 6B'nin SONUNDA, kalan bütçe varsa,
  aynı `recordRevisionEntry()` fonksiyonuyla 10 dakikalık bir ek olarak
  eklenebilir (aşağıdaki §12 implementation prompt'u bunu "opsiyonel,
  küçük genişletme" olarak işaretler) — ama MVP'nin BAŞARI KRİTERİ buna
  bağlı değil.
- **`RenderJob` retry** — dışlandı: otomatik/worker-tetikli, aktör yok,
  "revizyon" çerçevesine uymuyor; `attempt_count`/`error_message` zaten
  var. `RenderJob` cancel de MVP'ye DAHIL EDİLMEDİ çünkü tek-yönlü
  (round-trip yok) ve zaten analytics'e bağlı — aynı gerekçeyle
  `ProductionJob`'a benzer düşük marjinal değer.
- **`GeneratedOutput.version`/`parent_output_id`** — Step 6B'nin kapsamı
  DIŞI, ayrı bir "generation lineage" konsepti (§2).

Bu, promptun önerdiği 5 varlıklı listeden **3 varlığa daralmış, ama üçü de
gerçek, doğrulanmış, ve bugün somut veri kaybı yaşayan** bir MVP.

---

## 4. Snapshot stratejisi

Dört seçenek karşılaştırması:

| Strateji | Açıklama | Bu repoda maliyeti |
|---|---|---|
| Before+after tam snapshot | Her revizyonda satırın TAMAMI (önce + sonra) JSONB olarak saklanır | `layout_json`/`qa_json` gibi alanlar için en pahalısı ama en eksiksizi |
| Yalnız after (sonuç) | Yalnızca yeni durum saklanır, önceki durum önceki satırdan (varsa) çıkarılır | Ucuz ama "ne değişti" sorusuna zayıf cevap — iki satırı manuel diff'lemek gerekir |
| `diffSummary` + `snapshotRef` | Yalnız değişen alanların özeti + ayrı bir tabloya/depoya referans | Bu repoda "ayrı bir snapshot deposu" hiç yok, gereksiz bir yeni kavram |
| Yalnız metadata (durum geçişi + not) | Hiç JSONB snapshot yok, yalnız `previousStatus`/`newStatus`/`reason` | En ucuz ama §2'nin bulduğu "not kaybı" sorununu ÇÖZER, "hangi alan değişti" sorusuna cevap VERMEZ |

**Öneri: Before+after snapshot, ama SEÇİCİ (tam satır değil, revizyona konu
olan alt-küme).** Gerekçe, gerçek çağrı yerlerine bakılarak:

- **"Before" verisi HER ZAMAN zaten route handler'ın elinde** — üç route da
  (`design-dna.ts:59-95`, `layout-plans.ts:53-89`, `creative-qa.ts:67-114`)
  `approve()`/`reject()`'i çağırmadan ÖNCE `getById()`/`getLatestByClientId()`
  ile satırı ZATEN çekiyor (`existing`/`latest` değişkeni) — bir revizyon
  kaydı için EK bir SELECT gerekmiyor, mevcut değişken doğrudan `beforeSnapshot`
  olarak kullanılabilir. "After" ise `approve()`/`.reject()`/`.
  requestRevision()`'ın `RETURNING *`'ı zaten döndürüyor.
- **Tam satır değil, seçici alan seti** öneriliyor çünkü `layout_json`
  (layer dizisi, her layer `content`≤2000/`aiPrompt`≤2000 karakter,
  `packages/schemas/src/layout.ts`) ve `qa_json` (`packages/schemas/src/
  qa.ts`, `summary`≤2000, `detectedIssues[]`≤500 her biri) TEORİDE onlarca
  KB'a çıkabilir — bunları HER revizyonda iki kez (before+after) tam
  kopyalamak, `revision_entries`'i hızla şişirir. Bunun yerine:
  - `beforeSnapshot`/`afterSnapshot` = `{ status, notes/revisionNotes,
    score? (yalnız creative_qa), approvedBy?/rejectedBy? }` — KÜÇÜK, sabit
    boyutlu bir alt-küme.
  - Tam `layout_json`/`qa_json` snapshot'ı SAKLANMAZ — zaten ayrı, kendi
    tablosunda (yeni bir satır YARATILMIYOR, aynı satır UPDATE edildiği
    için) hâlâ mevcut ve sorgulanabilir; RevisionEntry'nin işi "kim ne
    zaman neden onayladı/reddetti", var olan JSON'un birebir kopyasını
    tutmak DEĞİL.
- Bu, "yalnız metadata" ile "tam snapshot" arasında bir orta yol: §2'nin
  tespit ettiği GERÇEK boşluğu (notlar kayboluyor) doğrudan kapatıyor,
  ama büyük JSONB alanları çift saklamanın maliyetini almıyor.

---

## 5. AnalyticsEvent vs RevisionEntry sınırı

**Ölçüm/sayım/raporlama (AnalyticsEvent) — denetim/değişiklik-izi
(RevisionEntry) ayrımı, somut olarak:**

- `analytics_events` "NE OLDU, ne zaman, hangi provider/süre/boyut ile"
  sorusuna cevap verir — **append-only, çok sayıda satır, `COUNT(*)/
  GROUP BY` odaklı**, hiçbir satırın kendi başına "önceki durum neydi"
  bilgisi taşımasına gerek YOK (bir dashboard özet kartı için toplamlar
  yeterli).
- `revision_entries` "BU SATIRDA neden değişti, kim değiştirdi, önceki
  hal/not neydi" sorusuna cevap verir — **entity-bazlı, az sayıda satır
  (bir layout planının hayatında belki 2-4 revizyon), `WHERE entity_type=
  $1 AND entity_id=$2 ORDER BY created_at` odaklı**.
- **Somut test:** `render_job_failed` bir revizyon MU? **HAYIR, saf bir
  metrik.** Render job'ın kendisi bir "onay/red/revizyon döngüsü" YAŞAMIYOR
  — `pending→queued→rendering→rendered|failed|cancelled` tek yönlü bir
  pipeline geçişi, geri dönüşü yok (§2'de doğrulandı: retry otomatik/
  worker-tetikli, insan kararı değil). `render_job_failed` yalnızca
  "kaç render başarısız oldu, hangi providerlar" sorusuna hizmet eder —
  bu SAF ölçüm, RevisionEntry'ye TAŞINMAMALI.
- Aynı mantıkla `visual_generation_succeeded/failed`, `production_package_
  created`, `export_artifact_downloaded` de saf metrik — hiçbiri "bir
  önceki hale dönülebilen bir karar" değil, RevisionEntry'nin kapsamı
  DIŞINDA kalmaya devam ediyor.
- **Çakışan alan:** `production_job_approved`/`rejected` ve `render_job_
  cancelled` HEM analytics'te var (metrik: "kaç job onaylandı/reddedildi/
  iptal edildi") HEM DE potansiyel olarak bir revizyon-gibi görünüyor
  (insan kararı, `rejection_reason` var) — ama §2/§3'ün gerekçesiyle
  BİLİNÇLİ OLARAK RevisionEntry MVP'sine DAHİL EDİLMEDİ (terminal,
  round-trip yok, zaten kendi audit kolonlarıyla kaplı). Bu, "her onay/red
  bir revizyondur" gibi kestirme bir kural yerine, "round-trip var mı,
  bugün bir veri kaybı mı yaşanıyor" testinin SONUCU olarak alınmış bir
  karar.

---

## 6. Önerilen `RevisionEntry` şeması — promptun taslağına karşı doğrulama

Promptun önerdiği alanlar (`id, clientId, projectId, campaignId, entityType,
entityId, revisionType, actorUserId, beforeSnapshot, afterSnapshot,
diffSummary, reason, metadata, createdAt`) tek tek değerlendirildi:

| Alan | Tut / Düşür | Gerekçe |
|---|---|---|
| `id` | Tut | Standart |
| `clientId` | Tut, **NOT NULL** | Step 6A'nın (`analytics_events.client_id NOT NULL`) AYNI ilkesi — bu repo'da HER analytics-uygun tablonun ilk kolonu |
| **`projectId`** | **DÜŞÜR** | Step 6A'nın `023_analytics_events.sql` yorumu ZATEN doğruladı: "no projects/campaigns columns: this schema has no such entities today" — bu bulgu HÂLÂ geçerli (repo genelinde `projects` tablosu yok), spekülatif bir kolon eklemek Step 6A'nın kendi additive-only disiplinine aykırı |
| **`campaignId`** | **DÜŞÜR** | Aynı gerekçe |
| `entityType` | Tut, CHECK'li | `'design_dna' \| 'layout_plan' \| 'creative_qa_report'` (§3'ün MVP seti; `analytics_events.entity_type`'ın aynı polimorfik-referans deseni, `approvals` tablosuyla ORTAK kök) |
| `entityId` | Tut | Standart |
| `revisionType` | Tut, CHECK'li — promptun ismi yerine `revision_type` VARCHAR + CHECK, §3'teki 8 event (design_dna: approved/needs_revision; layout_plan: approved/rejected/needs_revision; creative_qa_report: approved/rejected/needs_revision) | `analytics_events.event_type`'ın AYNI VARCHAR+CHECK deseni (native ENUM değil, aynı gerekçe: yeni tip eklemek ALTER TYPE değil basit constraint drop/recreate) |
| `actorUserId` | Tut, nullable, `ON DELETE SET NULL` | `analytics_events.actor_user_id` ile AYNI desen — ama bu üç entity'nin approve/reject/revise'ı HER ZAMAN bir HTTP route'tan (insan kullanıcı) geliyor, worker-kaynaklı bir revizyon YOK bu MVP'de — yine de nullable bırakılıyor (ileride sistem-kaynaklı bir revizyon türü eklenirse kırılmasın diye, ekstra maliyeti yok) |
| `beforeSnapshot` | Tut, JSONB nullable | İlk revizyonda (örn. design_dna hiç `needs_revision` görmeden approve edilirse) `previousStatus`'un anlamı olsa da tam bir "önceki revizyon" YOK — nullable |
| `afterSnapshot` | Tut, JSONB NOT NULL | Her revizyon kaydının bir "sonuç"u olmalı |
| `diffSummary` | **DÜŞÜR (bu MVP'de)** | §4'ün seçtiği "seçici before+after" stratejisiyle (küçük, sabit alan seti) `diffSummary` fazladan bir hesaplama katmanı — `beforeSnapshot`/`afterSnapshot` zaten küçük olduğu için ikisini yan yana okumak dashboard'da yeterli, ayrı bir diff-hesaplama fonksiyonu (ki hangi alanların "önemli" olduğuna karar vermek gerekir) MVP'nin kapsamını büyütür |
| `reason` | Tut, TEXT nullable | `production_jobs.rejection_reason` ile AYNI fikir — §2'nin bulduğu boşluğu (layout_plans/creative_qa_reports'ta notların hiç saklanmaması) DOĞRUDAN kapatan alan |
| `metadata` | Tut, JSONB DEFAULT '{}' | Forward-compat serbest alan, Step 6A'nın AYNI ilkesi |
| `createdAt` | Tut | Standart |

**Sonuç:** Promptun taslağı `projectId`/`campaignId` DIŞINDA sağlam;
`diffSummary` bu MVP'nin seçtiği "küçük seçici snapshot" stratejisiyle
gereksiz hale geliyor (ileride tam-satır snapshot'a geçilirse yeniden
değerlendirilebilir, bu belgenin kapsamı dışında bir gelecek genişleme).

---

## 7. Snapshot sanitizasyonu

**Asla saklanmamalı:**
- Herhangi bir secret/API key/token — `analyticsEventsRepo`'nun
  `isDenylistedKey()` denylist'i (`apps/api/src/db/repositories/analytics-
  events.ts`, `secret`/`password`/`authorization`/`auth`/`api`+`key`/bare-
  veya-sonu-`token` kelimeleri) **AYNEN kopyalanmalı** — RevisionEntry'nin
  `beforeSnapshot`/`afterSnapshot`/`metadata` alanları da bu backstop'tan
  geçmeli (yeni bir sözlük İCAT EDİLMEZ, aynı fonksiyon import edilir/
  paylaşılır).
- Ham provider payload'ları — `AIResponse`'un tamamı ASLA snapshot'a
  gömülmez (bu zaten §6'nın "seçici alan seti" kararıyla imkansız hale
  geliyor — `beforeSnapshot`/`afterSnapshot` yalnızca `status`/`notes`/
  `score`/`approvedBy` gibi önceden BELİRLENMİŞ, dar bir alan seti).
- Büyük base64/image buffer'ları — bu üç entity'nin (`design_dna`,
  `layout_plans`, `creative_qa_reports`) hiçbirinde zaten böyle bir alan
  YOK (görsel veriler `generated_outputs`/`export_artifacts`'ta, storage
  key olarak tutulur, ham bayt olarak DEĞİL) — riskin kendisi bu üç
  entity için zaten düşük, ama gelecekte `ProductionJob`/`RenderJob`
  eklenirse (§3'ün ertelediği genişleme) bu kural AÇIKÇA hatırlanmalı.

**Saklamak güvenli/değerli:**
- `status`/`previousStatus`/`newStatus` — zaten kolon olarak var, gizli
  değil.
- `revisionNotes`/`reason` metni — insan tarafından yazılan kısa metin
  (bugün layout_plans/creative_qa_reports'ta hiç saklanmadığı için bu,
  Step 6B'nin ASIL kazanımı); `packages/schemas/src/*.ts`'teki gerçek
  alan boyutlarına bakılırsa (`design_dna.revision_notes` şemasız TEXT,
  ama karşılaştırma için `design_brief.designerNotes` ≤3000 karakter,
  `creative_qa`'nın `qa.ts`'teki `summary` ≤2000, `detectedIssues[]` her
  biri ≤500) — **`reason`/`revisionNotes` için 2000 karakter üst sınır**
  makul (mevcut şemalardaki benzer serbest-metin alanların üst sınırıyla
  aynı büyüklük mertebesinde, `production_jobs.rejection_reason`'ın zaten
  uyguladığı 2000 karakter cap'iyle BİREBİR tutarlı).
- `score` (yalnız `creative_qa_reports.score`, `DECIMAL(5,2)`, 0-100) —
  sayısal, gizli değil, trend analizi için değerli.
- `approvedBy`/`rejectedBy` user ID'leri — zaten `actorUserId` olarak
  tutuluyor, snapshot içine AYRICA gömülmesine gerek yok (tekrar
  olurdu).

---

## 8. Client isolation planı

Step 6A'nın `analytics_events` deseninin BİREBİR aynısı:

- `revision_entries.client_id NOT NULL REFERENCES clients(id) ON DELETE
  CASCADE` — yazma sırasında YENİDEN bir yetkilendirme kontrolü YOK,
  çünkü `recordRevisionEntry()` her zaman ZATEN `assertClientAccessible`
  ile gate'lenmiş bir route handler'ın İÇİNDEN (approve/reject/revise
  akışının SONUNDA, satır zaten UPDATE edildikten hemen sonra) çağrılır —
  design-dna.ts/layout-plans.ts/creative-qa.ts route'ları zaten
  `assertClientAccessible(req.user!.id, existing.clientId)`'i satır
  güncellenmeden ÖNCE çağırıyor (mevcut kod, değişmeyecek).
- Okuma sırasında (`GET /clients/:clientId/revisions/recent`) **guard
  VAR** — `requireAuth` → `requirePermission('revisions:read')` →
  `assertClientAccessible(req.user!.id, client.id)`, `apps/api/src/routes/
  analytics.ts`'in BİREBİR aynı sırası.
- `assertClientAccessible(userId: string, clientId: string | null |
  undefined): Promise<void>` imzası (`apps/api/src/auth/client-access.ts`)
  **DEĞİŞMİYOR** — Step 6B bu fonksiyonu OLDUĞU GİBİ import edip kullanır.
- Cross-client leak testi: mevcut `client-isolation.test.ts`'e (§10'da
  detaylandırılan) yeni bir blok — iki client'ın revizyonları aynı
  tabloda karışık sırada olsa bile `GET /clients/:idA/revisions/recent`
  YALNIZCA client A'nın satırlarını döndürür.

---

## 9. Dashboard UX planı — "Revizyon Geçmişi"

`analytics-summary-panel.tsx`'in AYNI stil/iskeletiyle, yeni bir küçük
bileşen — büyük bir redesign YOK:

- **YENİ bileşen:** `apps/dashboard/src/components/revision-history-
  panel.tsx` — `GET /clients/:id/revisions/recent`'i çağırır (loading/
  error/empty state'leri `analytics-summary-panel.tsx`'in `loading`/
  `error`/`summary===null` üçlüsüyle BİREBİR aynı desende: `<div
  className="card">Yükleniyor...</div>`, hata durumunda güvenli genel
  mesaj, `recentActivity.length === 0` durumunda "Henüz revizyon yok.").
- Son 10 revizyon, düz bir `<ul>` (analytics panelinin "Son Aktiviteler"
  listesiyle AYNI idiom, yeni bir zaman-çizelgesi bileşeni İCAT EDİLMEZ):
  her satır `"{entityLabel} {revisionTypeLabel} — {actorAdı veya 'Sistem'}
  — {reason kısaltılmış, varsa} — {createdAt, kısa Türkçe tarih}"`, örn.
  *"Layout planı revizyona gönderildi — Ayşe K. — 'Logo çok büyük' —
  5 Tem 14:20"*.
- `ENTITY_TYPE_LABELS`/`REVISION_TYPE_LABELS` Türkçe sözlükleri,
  `analytics-summary-panel.tsx`'in `EVENT_TYPE_LABELS` sözlüğüyle AYNI
  desen (düz `Record<string,string>`, yeni bir i18n kütüphanesi YOK).
- `apps/dashboard/src/app/clients/[id]/page.tsx`'e TEK bir ek satır:
  `<RevisionHistoryPanel clientId={params.id} />`, `AnalyticsSummaryPanel`
  çağrısının HEMEN altına — sayfanın geri kalanı DEĞİŞMEZ.
- `apps/dashboard/src/lib/api.ts`'e tek bir yeni fonksiyon:
  `getClientRecentRevisions(clientId: string)`.
- Grafik/tarih-aralığı seçici/diff-görünümü YOK — MVP'de düz bir liste
  yeterli (§4'ün seçtiği küçük before/after alan setiyle zaten tutarlı:
  gösterilecek veri az ve basit).

---

## 10. Test planı

Mevcut Vitest konvansiyonlarını (`apps/api/src/__tests__/analytics-events.
test.ts`, `client-isolation.test.ts` — embedded Postgres, gerçek pipeline
fixture, `vi.mock('@grafista/model-router')`) AYNEN kullanarak, yeni bir
`revision-entries.test.ts`:

- **Revizyon kaydı — design_dna:** `POST /clients/:id/design-dna/revise`
  çağrıldığında `revision_entries`'e `revision_type='design_dna_needs_
  revision'`, `reason`/`afterSnapshot.notes` doğru satırın yazıldığını
  doğrula; sonra `/approve` çağrıldığında `design_dna_approved` ikinci bir
  satır olarak eklendiğini (üzerine YAZILMADIĞINI, append-only olduğunu)
  doğrula.
- **`clientId` olmadan reddedilir:** `recordRevisionEntry()`'nin
  `clientId` eksik/boş çağrıldığında throw ettiğini doğrula (Step 6A'nın
  `assertMetadataSafe`'inin denylist testine benzer bir "guard testi").
- **Before/after snapshot sanitize edilir:** `beforeSnapshot`/
  `afterSnapshot`/`metadata` içinde `apiKey`/`token`/`password` gibi bir
  anahtar varsa `recordRevisionEntry()`'nin reddettiğini (analytics-
  events.ts'in `isDenylistedKey()`'ini PAYLAŞARAK) doğrula.
- **CreativeQA approve revizyon kaydeder:** `POST /creative-qa/:id/
  approve` sonrası `revision_entries`'te `entity_type='creative_qa_
  report', revision_type='creative_qa_report_approved'` satırının
  yazıldığını doğrula; aynı desen `reject` (`needs_revision` ve düz
  `rejected` iki alt-senaryo) için tekrarlanır.
- **LayoutPlan approve/reject/needs_revision revizyon kaydeder:** aynı
  üçlü senaryo, `layout_plans` için; ayrıca `needs_revision`'dan tekrar
  `approve` edildiğinde İKİNCİ bir revizyon satırının (round-trip)
  doğru sırada eklendiğini doğrula.
- **DesignDNA approve/revise revizyon kaydeder:** aynı desen,
  `approve()`'un `needs_revision`'ı KAPSAMADIĞINI (§2'nin bulgusu) — yani
  bir kez `needs_revision`'a düşen DNA'nın `approve()` ile
  KURTARILAMADIĞINI (409 döndüğünü) ve bunun bir revizyon kaydı
  ÜRETMEDİĞİNİ (başarısız çağrı kayıt yaratmaz) doğrulayan bir regression
  testi.
- **`GET /clients/:id/revisions/recent` client-scoped:** iki client'ın
  revizyonları karışık sırada olsa bile yalnız istenen client'ınkilerin
  döndüğünü doğrula.
- **Cross-client leak yok:** `client-isolation.test.ts`'e §8'de açıklanan
  yeni blok — membership-restricted bir kullanıcının başka client'ın
  revizyon endpoint'ine 404 aldığını doğrula (mevcut "not found ve not
  yours ayırt edilemez" ilkesiyle tutarlı).
- **AnalyticsEvent davranışı etkilenmedi:** mevcut `analytics-events.
  test.ts`'in TÜM testlerinin (11 event tipi, best-effort kayıt, secret
  sızdırmama) Step 6B sonrası da AYNEN geçtiğini doğrula — RevisionEntry
  eklemenin `analytics_events` tablosuna/repository'sine/route'una HİÇBİR
  DEĞİŞİKLİK getirmediğinin regresyon garantisi (yeni dosya, mevcut hiçbir
  dosya değişmiyor — bkz §12 implementation prompt'u).

---

## 11. Riskler

- **Üç route dosyasına (design-dna.ts, layout-plans.ts, creative-qa.ts)
  küçük ama sayıca dağılmış ekleme** — her approve/reject/revise
  handler'ına bir `recordRevisionEntry()` çağrısı eklenir; mevcut
  testlerin (`design-dna.test.ts`, `layout-plans.test.ts`, `creative-qa.
  test.ts`) KIRILMAMASI kritik kabul kriteri (Step 6A'nın §14'teki AYNI
  risk sınıfı).
- **`design_dna.approve()`'un `needs_revision`'ı kapsamaması** — bu Step
  6B'nin ürettiği bir sorun DEĞİL, mevcut bir davranış (§2) — ama
  RevisionEntry test planı bunu (409 → kayıt yok) AÇIKÇA doğrulamalı,
  aksi halde "neden DNA'nın needs_revision→approved geçişi hiç
  görünmüyor" sorusu yanlış yorumlanabilir. Bu davranışın kasıtlı mı bug
  mı olduğu Step 6B'nin kapsamı DIŞINDA, ayrı bir "hata düzeltme" konusu
  olarak not edilmeli — Step 6B bu davranışı DEĞİŞTİRMEZ, yalnızca doğru
  şekilde test eder.
- **`beforeSnapshot`/`afterSnapshot`'ın "seçici alan seti" kararı** (§4)
  ileride "hangi alan değişti" (tam diff) ihtiyacı ortaya çıkarsa
  yetersiz kalabilir — bu BİLİNÇLİ bir MVP kısıtı, `diffSummary`'nin
  ertelenmesiyle (§6) tutarlı; gerçek ihtiyaç ortaya çıkarsa additive bir
  genişleme (yeni nullable kolon) olarak eklenebilir.
- **`ProductionJob`/`RenderJob`'un MVP dışı bırakılması** bir eksiklik
  değil, §2/§3'ün gerekçeli kararı — ama kullanıcı beklentisi
  ("her onay/red bir revizyon geçmişinde görünsün") ile çelişebilir;
  dashboard panelinin İÇİNDE bir not/tooltip ("yalnız DNA/Layout/QA
  revizyonları gösterilir") ile bu netleştirilmeli.
- **`revisions:read` permission'ının rol dağılımı** — `analytics:read`
  ile AYNI roller (OWNER, CREATIVE_DIRECTOR, DESIGNER) makul bir varsayım
  ama Step 6B'nin implementasyonu bunu doğrulamalı (CONTENT_MANAGER'ın
  revizyon geçmişini görmesi zararsız mı zararlı mı — mevcut posture'a
  bakılırsa muhtemelen dışlanmalı, `analytics:read`'in AYNI gerekçesiyle).

---

## 12. Phase 3 Step 6B için hazır implementation promptu

Aşağıdaki prompt, bu plan onaylandıktan sonra Step 6B'yi başlatacak bir
sonraki konuşmaya doğrudan verilebilir:

```
Grafista AI Studio MVP — Phase 3 Step 6B — Revision History MVP Implementation

Çalışma dizini: /Users/sercanbingol/Desktop/Antigravity/Projeler/Grafista-AI-Studio
Branch: phase-2-checkpoint (Step 6B planning commit'i sonrası)
Referans dokümanlar: docs/revision-history-plan.md (bu planın TAMAMINI
uygula — özellikle §3 MVP kapsamı, §4 snapshot stratejisi, §6 veri modeli,
§8 client isolation, §9 dashboard UX, §10 test planı) ve
docs/analytics-revision-history-plan.md (§8.1/§9/§12/§14 — AnalyticsEvent'in
kurduğu desenler, `recordBestEffort`/`assertMetadataSafe`/`assertClient
Accessible` gibi PAYLAŞILAN altyapı buradan).

Hedef: `revision_entries` append-only tablosu + `recordRevisionEntry()`
servis fonksiyonu + üç gerçek round-trip'e sahip entity'nin (design_dna,
layout_plans, creative_qa_reports) approve/reject/revise akışlarına ekleme
+ client-scoped `GET /clients/:clientId/revisions/recent` + küçük bir
dashboard "Revizyon Geçmişi" paneli.

KAPSAM DIŞI (bilinçli, §2/§3'ün gerekçesiyle): DesignBrief (tek-yönlü karar,
içerik hiç değişmiyor), ProductionJob (terminal, zaten approved_by/
rejected_by/rejection_reason + analytics event'iyle kaplı), RenderJob retry
(otomatik/worker-tetikli, insan kararı değil — "revizyon" çerçevesine
uymuyor) ve cancel (tek-yönlü), GeneratedOutput.version/parent_output_id
(ayrı bir "generation lineage" konsepti, bu adımın kapsamı değil).

Kapsam:
1. Additive migration: `revision_entries` tablosu — id, client_id (NOT
   NULL, REFERENCES clients ON DELETE CASCADE), entity_type (CHECK IN
   ('design_dna','layout_plan','creative_qa_report')), entity_id,
   revision_type (CHECK IN ('design_dna_approved','design_dna_needs_
   revision','layout_plan_approved','layout_plan_rejected','layout_plan_
   needs_revision','creative_qa_report_approved','creative_qa_report_
   rejected','creative_qa_report_needs_revision')), actor_user_id
   (nullable, ON DELETE SET NULL), before_snapshot JSONB (nullable),
   after_snapshot JSONB NOT NULL, reason TEXT (nullable, 2000 karakter
   cap — §7), metadata JSONB DEFAULT '{}', created_at. İndeksler:
   (client_id, created_at DESC), revision_type, (entity_type, entity_id).
   NOT projectId/campaignId eklenmez (§6 — bu şemada yok). Yeni
   permission: `revisions:read` (OWNER + CREATIVE_DIRECTOR + DESIGNER,
   CONTENT_MANAGER hariç — 023_analytics_events.sql'in analytics:read
   grant deseniyle AYNI gerekçe formatı).
2. Yeni repository: `apps/api/src/db/repositories/revision-entries.ts`
   — `record(input)` (before/afterSnapshot + metadata + reason üzerinde
   analytics-events.ts'in `isDenylistedKey()`'ini PAYLAŞARAK/yeniden
   kullanarak sanitizasyon, §7) ve `getRecentByClientId(clientId, limit)`
   (client-scoped, `ORDER BY created_at DESC LIMIT $2`).
3. Servis/route katmanına ekleme — §4'ün "before zaten route'un elinde"
   gözlemini kullanarak: her handler zaten `getById()`/`getLatestByClientId
   ()` ile `existing`/`latest` satırını (before) elinde tutuyor,
   approve()/reject()/requestRevision() sonrası dönen satır (after) ile
   birlikte TEK bir `revisionEntriesRepo.record()` çağrısı eklenir:
   - `apps/api/src/routes/design-dna.ts` — approve ve revise route'ları.
   - `apps/api/src/routes/layout-plans.ts` — approve ve reject route'ları.
   - `apps/api/src/routes/creative-qa.ts` — approve ve reject route'ları
     (approve zaten analytics_events'e de yazıyor — İKİ ayrı çağrı,
     birbirine karışmaz, her ikisi de kalır).
   Kayıt best-effort DEĞİL, hard-fail olabilir (bu üç akış zaten senkron
   HTTP route'ları, Step 6A'nın worker-tabanlı best-effort gerekçesi
   burada aynı ağırlıkta geçerli değil) — ama uygulama sırasında
   docs/revision-history-plan.md §10'daki test planına göre KESİN karar
   verilmeli (best-effort mi hard-fail mi — her iki yönde de mevcut
   testler KIRILMAMALI).
4. Yeni route: `GET /clients/:clientId/revisions/recent` (`revisions:read`
   + `assertClientAccessible`, §8, mevcut `apps/api/src/routes/
   analytics.ts`'in guard sırasıyla BİREBİR aynı) — `apps/api/src/routes/
   analytics.ts`'e eklenebilir veya yeni bir `revisions.ts` route dosyası
   olarak, hangisi mevcut router mount deseniyle (`/api/clients` altında)
   daha temiz uyuyorsa.
5. Dashboard: yeni `apps/dashboard/src/components/revision-history-
   panel.tsx` (mevcut `analytics-summary-panel.tsx`'in loading/error/empty
   state ve `.card`/`<ul>` desenini kullan, yeni CSS icat etme) +
   `apps/dashboard/src/lib/api.ts`'e `getClientRecentRevisions()` +
   `apps/dashboard/src/app/clients/[id]/page.tsx`'e panel'i
   `AnalyticsSummaryPanel`'in altına ekleyen TEK bir ek (§9). Büyük
   redesign YOK.
6. Testler (§10): yeni `revision-entries.test.ts` (design_dna approve/
   revise round-trip, layout_plan approve/reject/needs_revision
   round-trip, creative_qa_report approve/reject/needs_revision
   round-trip, snapshot sanitizasyonu, client-scoped okuma) +
   `client-isolation.test.ts`'e yeni blok (§8) — mevcut TÜM testler
   (analytics-events.test.ts, design-dna.test.ts, layout-plans.test.ts,
   creative-qa.test.ts, production-jobs.test.ts, visual-generation.
   test.ts, render-jobs.test.ts, render-queue-worker.test.ts, demo-flow.
   test.ts) KIRILMAMALI — özellikle analytics-events.test.ts'in
   `creative_qa_approved` event testinin, artık İKİ kayıt (analytics +
   revision) üretilse bile DEĞİŞMEDEN geçtiği doğrulanmalı.

Kesinlikle yapılmayacaklar: DesignBrief/ProductionJob/RenderJob'a revizyon
kaydı ekleme (§3 — kapsam dışı, gerekçeli), `diffSummary` alanı/hesaplaması
(§6 — ertelendi), `projectId`/`campaignId` kolonları (§6 — bu şemada yok),
tam `layout_json`/`qa_json` snapshot'ı saklama (§4/§7 — yalnız seçici alan
seti), analytics_events tablosuna/repository'sine/route'una HERHANGİ bir
değişiklik (bu Step 6A'nın kapsamı, dokunulmaz), büyük dashboard "Revizyon"
sekmesi/diff-görünümü/grafik kütüphanesi.

Komutlar (hepsi geçmeden commit atma): pnpm run typecheck, pnpm run lint,
pnpm run test:stable, pnpm run build. Ayrıca yeni revision-entries
testlerini izole çalıştır.

Commit mesajı önerisi: "phase 3 step 6b: append-only revision entries for design-dna/layout/qa round-trips"
```

---

## İlgili dokümanlar

- [`docs/analytics-revision-history-plan.md`](./analytics-revision-history-plan.md)
  — Step 6A'nın planı ve teslimatı (bu belgenin §1-§7'si oradaki gap
  analizine/karar matrisine dayanır, tekrar etmez).
- [`docs/render-queue-worker-plan.md`](./render-queue-worker-plan.md) —
  Step 5'in planı; format/derinlik referansı, additive-only migration ve
  best-effort yan-etki ilkelerinin kaynağı.
- [`docs/phase-3-productization-roadmap.md`](./phase-3-productization-roadmap.md)
  — Step 6'nın orijinal kapsam tanımı (Step 6A + 6B'nin ortak üst dokümanı).
