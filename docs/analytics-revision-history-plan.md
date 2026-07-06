# Grafista AI Studio — Analytics + Revision History Plan (Phase 3 Step 6)

> **Step 6A implemented** (this commit): `analytics_events` table
> (`database/migrations/023_analytics_events.sql`), `analyticsEventsRepo`
> (`apps/api/src/db/repositories/analytics-events.ts`), `GET
> /api/clients/:id/analytics/summary`, and the dashboard
> `analytics-summary-panel.tsx`. Event set implemented: `creative_qa_approved`,
> `visual_generation_succeeded`, `visual_generation_failed`,
> `production_package_created`, `production_job_approved`,
> `production_job_rejected`, `render_job_queued`, `render_job_rendered`,
> `render_job_failed`, `render_job_cancelled`, `export_artifact_downloaded`
> (a slightly narrower set than §8.1's original draft list — no
> `projects`/`campaigns` dimension exists in this schema, so none was added).
> `RevisionEntry` (§8.2) is still deferred to Step 6B, untouched. Known
> limitations: `estimatedCost` in metadata is whatever `AIResponse.usage`
> already reports, not a real billing figure; there are no date-range
> filters or charts yet (summary is all-time); recording is best-effort and
> can silently no-op under a DB issue (see `recordBestEffort`'s
> `console.warn`, §9/§14 below).

Status: **PLANNING ONLY — no code, no migration, no dependency added in this step.**
Bu belge Phase 3 Step 6'nın teslimatıdır. `docs/render-queue-worker-plan.md`
ile aynı disiplinle: mevcut durum özeti, gap analizi, karar matrisi, veri
modeli, lifecycle, API/dashboard/RBAC/test planı ve devredilebilir bir Step
6A implementation prompt'u içerir. Bu adımda `apps/api`, `apps/dashboard`
veya `database/migrations` içinde HİÇBİR şey değişmez.

---

## 1. Mevcut durum özeti

Bugün pipeline'ın HİÇBİR aşamasında ayrı bir "olay/analitik" kaydı yok — her
tablo yalnızca **kendi güncel durumunu** tutuyor, geçmiş bir `updated_at`
trigger'ıyla ezilerek kayboluyor:

- **Lifecycle durumları zaten var ama olay-akışı olarak değil, satır-durumu
  olarak.** Örnek: `design_dna.status` (`draft → generated →
  waiting_for_approval → approved | needs_revision`,
  `006_design_dna_analysis.sql`), `layout_plans.status` (`generated →
  approved | rejected | needs_revision`, `009_layout_plans.sql`),
  `creative_qa_reports.status` (`generated → passed | failed → approved |
  rejected | needs_revision`, `011_creative_qa_reports.sql`),
  `generated_outputs.status` (`pending → generated | failed`,
  `014_visual_generation_extension.sql`), `production_jobs.status`
  (`pending → packaging → package_ready → approved | rejected | failed |
  cancelled`, `016_production_jobs.sql` + `018_production_jobs_review_
  audit.sql`), `render_jobs.status` (`pending → queued → rendering →
  rendered | failed | cancelled`, `019_render_jobs.sql` +
  `022_render_jobs_queue.sql`). Her satır BİR anlık durumu tutuyor — bir
  satırın `approved`'a giden yolculuğunda kaç kez `needs_revision`'a
  düştüğü, kim tarafından, ne zaman, hiçbir yerde kalıcı değil (kolon
  ezilir).
- **Audit alanları var ama parça parça, tabloya özgü.** `approved_by` /
  `approved_at` deseni `design_dna`, `layout_plans`, `creative_qa_reports`,
  `generated_outputs`, `production_jobs` tablolarının HEPSİNDE tekrarlanıyor;
  `production_jobs` ayrıca `rejected_by`/`rejected_at`/`rejection_reason`
  (`018_production_jobs_review_audit.sql`) taşıyor — ama bunlar hep "SON
  onaylayan/reddeden kim" bilgisi, "geçmişte kim ne yaptı" değil. Genel
  amaçlı bir `approvals` tablosu da var (`001_initial_schema.sql`) ama yalnız
  `content_idea` / `design_brief` / `generated_output` / `final_delivery`
  entity_type'larını kapsıyor — `layout_plans`, `creative_qa_reports`,
  `design_dna`, `production_jobs`, `render_jobs` bu genel tabloyu HİÇ
  kullanmıyor (kendi status/approved_by kolonlarını kullanıyorlar).
- **`audit_logs` tablosu var ama kullanılmıyor.** `001_initial_schema.sql`
  içinde `audit_logs (user_role, user_name, action, entity_type, entity_id,
  details, ip_address, created_at)` tanımlı — repo genelinde grep
  (`audit_logs`/`auditLogs`) hiçbir repository/servis/route dosyasında sıfır
  sonuç veriyor. Bu, "genel amaçlı bir olay tablosu MVP'de gerçekten
  KULLANILMADI, sadece şemada bekliyor" gerçeğinin en güçlü kanıtı — Step 6,
  bu boş tabloyu doldurmaya mı çalışmalı, yoksa yeni/daha dar bir tablo mu
  açmalı sorusunun doğrudan girdisi (bkz. §4).
- **Provider çağrı verisi zaten AIResponse şeklinde üretiliyor ama
  KALICI DEĞİL.** `packages/model-router/src/types.ts`'teki `AIResponse`
  her çağrıda `provider`, `model`, `usage.{inputTokens,outputTokens,
  totalTokens,estimatedCost}`, `latencyMs`, `errorKind`, `httpStatus`,
  `attempts` taşıyor; `apps/api/src/services/ai-call-helper.ts`'in
  `logAiResponse()`'u bunu HER çağrıda `console.log`/`console.error`'a
  yazıyor (`[logPrefix] context ok — provider=... tokens(in/out/total)=...
  estimatedCost=... latencyMs=...`) — ama sadece stdout'a, hiçbir tabloya
  DEĞİL. `visual-generation.ts` (211-222) bu response'un `provider`/
  `aiModel`/`generation_time_ms`'ini `generated_outputs` satırına
  denormalize ediyor (kalıcı olan TEK örnek) — ama `estimatedCost`,
  `inputTokens`/`outputTokens`, `attempts`, `errorKind` o satıra bile
  YAZILMIYOR, sadece log satırında kayboluyor.
- **Render/export tarafında da benzer bir boşluk.** `render_jobs`
  (`renderer_name`, `renderer_version`, `render_warnings`, ve Step 5A'nın
  `queued_at`/`started_at`/`finished_at`/`attempt_count` alanları) ve
  `export_artifacts` (`format`, `width`, `height`, `size_bytes`,
  `mime_type`, `checksum`) zaten "render/export analytics"in çoğu ham
  verisini TAŞIYOR — ama bunlardan `client` bazında/zaman bazında
  agregasyon üreten hiçbir kod yolu yok (ne bir repository metodu, ne bir
  route, ne bir dashboard bileşeni).
- **Dashboard'da "özet"/"geçmiş" kavramı sıfır.** `apps/dashboard/src/
  components/` içinde yalnızca `visual-outputs-panel.tsx` ve
  `creative-qa-report.tsx` var — ikisi de TEK bir varlığın (bir layout
  plan'ın visual output'ları / tek bir QA raporu) mevcut durumunu gösteriyor,
  "geçmiş"/"trend"/"özet" değil. `apps/dashboard/src/app/clients/[id]/
  page.tsx` bugün yalnızca `content_ideas` sayısını (`ideas.length`,
  `.filter(status==='approved')`, `.filter(status==='pending_approval')`)
  client-side'da sayan basit bir `stats-grid` içeriyor — bu, "AnalyticsEvent
  tablosu olmadan da basit sayaç gösterilebiliyor" göstergesi, ama render/
  export/production/QA'yı hiç kapsamıyor ve client-side N-tane-liste-çek +
  filtrele deseni (repo-taraflı agregasyon YOK) — ölçeklenmiyor.
  `apps/dashboard/src/lib/api.ts` içinde `summary`/`history`/`activity`
  adında sıfır fonksiyon var (yalnızca `pollRenderJob`, tekil kaynak
  fetch'leri).

**Sonuç:** Bugün analytics/revision-history kavramı MVP'de kasıtlı olarak
kapsam dışı bırakılmış (roadmap'in kendi ifadesiyle "Doğrudan bir Phase 2
borcu değil" — `docs/phase-3-productization-roadmap.md` Step 6). Ham veri
(status geçişleri, provider response'ları, render/export metadata'sı) zaten
büyük ölçüde ÜRETİLİYOR ama hiçbir yerde KALICI/SORGULANABİLİR bir "olay
akışı" veya "geçmiş" biçiminde toplanmıyor.

---

## 2. Gap analizi — hangi lifecycle olayları bugün gerçek bir kod yoluna sahip?

| Olay | Bugün gerçek bir kod yolu var mı? | Kanıt |
|---|---|---|
| `design_brief_created` | **Evet** | `design-brief-creation.ts` → `design_briefs` satırı `status:'draft'` ile yazılıyor |
| `design_dna_generated` | **Evet** | `design-dna-analysis.ts` → `design_dna` satırı `status:'generated'` |
| `design_dna_approved` / `needs_revision` | **Evet** | design-dna route'ları approve/revise, `approved_by`/`approved_at`/`revision_notes` set ediliyor |
| `layout_generated` | **Evet** | `layout-generation.ts` → 2-3 `layout_plans` satırı `status:'generated'` |
| `layout_approved` / `rejected` / `needs_revision` | **Evet** | layout-plans route'ları |
| `creative_qa_generated` | **Evet** | `creative-qa.ts` servis → `creative_qa_reports` satırı `passed`/`failed` |
| `creative_qa_approved` / `rejected` | **Evet** | creative-qa route'ları |
| `visual_generation_started` | **Kısmen** — DB'de ayrı bir "started" satırı YOK, yalnızca AI çağrısı öncesi kod yürüyor; ilk kalıcı iz BAŞARI/BAŞARISIZLIK anında yazılıyor | `visual-generation.ts` `runVisualGeneration()` |
| `visual_generation_succeeded` | **Evet** | `generated_outputs` satırı `status:'generated'`, `provider`/`aiModel`/`generation_time_ms` dolu |
| `visual_generation_failed` | **Evet** | `generated_outputs` satırı `status:'failed'`, `error_message` dolu (`recordRunFailure()`) |
| `production_package_created` | **Evet** | `production-package-builder.ts` → `production_jobs` satırı `package_ready` |
| `production_job_approved` / `rejected` | **Evet** | production-jobs route'ları, `018_production_jobs_review_audit.sql`'in `approved_by`/`rejected_by` alanları |
| `render_job_queued` | **Evet (Step 5A'dan itibaren)** | `render-engine.ts` + `render-jobs.ts` repo, `queued_at` |
| `render_job_rendered` | **Evet** | `render-worker.ts` / `render-engine.ts`, `export_artifacts` satırı yaratılıyor |
| `render_job_failed` | **Evet** | aynı kod yolu, `error_message` + `attempt_count` |
| `export_artifact_downloaded` | **HAYIR — bugün hiçbir kod yolu yok** | `GET /export-artifacts/:id/file` route'u dosyayı stream ediyor ama HİÇBİR "indirildi" olayı yazmıyor (grep: `export_artifacts` route'unda `download`/`event`/`log` kaydı yok) |
| `provider_call_failed` (genel, kategori bazında) | **Kısmen** — `ai-call-helper.ts` bunu `console.error`'a yazıyor ama HİÇBİR tabloya değil | `logAiResponse()` |

**Sonuç:** Listenin neredeyse tamamı ("brief_created" hariç zaten var
sayılan başlangıç adımları dahil) BUGÜN GERÇEKTEN OLUYOR — sadece kalıcı bir
olay tablosuna yazılmıyorlar, doğrudan ilgili varlığın `status` kolonuna
yazılıyor veya (provider çağrıları için) yalnız stdout'a. Tek gerçek
istisna: `export_artifact_downloaded` — bunun için BUGÜN sıfır kod yolu var,
Step 6A'da route'a yeni bir satır eklenmesi gerekecek (küçük, additive bir
değişiklik — mevcut dosya stream davranışı değişmez, sadece yanına bir kayıt
eklenir).

---

## 3. Revision history ihtiyacı — hangi varlıklar?

| Varlık | Bugünkü "geçmiş" durumu | Revision history değeri |
|---|---|---|
| `DesignBrief` | Tek `status` kolonu, geçmiş yok | Orta — brief nadiren revize edilir bugün (kod yolu yok, yalnız oluşturuluyor) |
| `DesignDNAReport` (`design_dna`) | `status` + `revision_notes` (TEK, en son notu tutar, ÜZERİNE YAZILIR) | **Yüksek** — `needs_revision` döngüsü gerçek bir kod yolu, ama önceki notlar kayboluyor |
| `LayoutPlan` | `status` + `alternative_index` (alternatifler zaten AYRI satırlar — bu kısmen "geçmiş"i doğal olarak koruyor) | Orta — alternatifler arasında geçiş zaten görünür, ama bir alternatifin `approved→needs_revision→approved` döngüsü görünmez |
| `CreativeQAReport` | `status` + `qa_json`/`recommendations` (anlık) | **Yüksek** — skor/durum geçmişi zaman içinde trend analizi için değerli |
| `GeneratedOutput`/`VisualOutput` | `version` + `parent_output_id` kolonları ZATEN VAR (`001_initial_schema.sql`) — versiyon zinciri şemada mevcut ama HİÇBİR kod yolu bunu set ETMİYOR (`parent_output_id` her yerde NULL kalıyor, grep doğrular) | Orta-yüksek, ama zaten kısmi bir iskelet var — Step 6B bunu doldurabilir, sıfırdan icat etmez |
| `ProductionJob` | `status` + `approved_by/at`, `rejected_by/at/reason` (SON karar, geçmiş değil) | Orta |
| `RenderJob` | `status` + `attempt_count`/`error_message` (Step 5A) — retry geçmişi KISMEN attempt_count ile görünür ama HER attempt'in kendi hata mesajı kaybolur (yalnız SON `error_message` kalır) | Orta |
| `ExportArtifact` | Değişmez (immutable dosya kaydı) — zaten "tek versiyon" | Düşük — revizyon kavramı burada anlamsız, zaten her render yeni bir satır |

**Sonuç:** En yüksek revision-history değeri `DesignDNAReport` ve
`CreativeQAReport`'ta (gerçek `needs_revision` döngüleri, tekrarlanan
skor/not kaybı) — ama `GeneratedOutput`'un ZATEN VAR olan `version`/
`parent_output_id` iskeleti, revision history'yi ONA bağlamayı ucuzlaştıran
somut bir emsal. Bu gözlem §11'de Step 6B'yi ayrı bir adıma ertelemenin
gerekçesinin parçası.

---

## 4. AnalyticsEvent / RevisionEntry model karar matrisi

| Kriter | Tek "audit_logs" tablosunu doldur (mevcut, boş) | **Ayrı `analytics_events` + `revision_entries` tabloları (önerilen)** | Mevcut status/log alanlarını genişlet (satır başına JSONB "history" kolonu) |
|---|---|---|---|
| Migration karmaşıklığı | Düşük — tablo zaten var, sadece kod eklenir | Düşük-orta — 2 yeni additive tablo, mevcut hiçbir tablo değişmez | Düşük ama YANILTICI — her ilgili tabloya (`design_dna`, `layout_plans`, `creative_qa_reports`, `production_jobs`, `render_jobs`) ayrı ayrı `history JSONB` eklemek gerekir; N tabloya N migration |
| Client isolation | Zayıf — `audit_logs`'ta `client_id` kolonu YOK (`001_initial_schema.sql`'e bakınca `user_role`/`user_name`/`entity_type`/`entity_id` var ama `client_id` yok) — retrofit gerekir | **Güçlü** — `client_id` ilk günden şemada, mevcut `assertClientAccessible` deseniyle bire bir uyumlu | Zayıf-orta — JSONB içine gömülü geçmişte client_id zaten sahibi satırdan miras alınır ama sorgulanabilirlik JSONB operator'larına bağımlı kalır |
| Dashboard query pattern'i | Orta — `entity_type`/`entity_id` genel-amaçlı, ama `action` alanı serbest metin (tip güvenliği zayıf) | **İyi** — `analytics_events.event_type` sabit bir enum/CHECK, `revision_entries.entity_type` da öyle; `client_id`/`created_at` üzerinde indexli agregasyon (`GROUP BY event_type`, `COUNT(*) WHERE client_id=$1`) doğal | Kötü — JSONB içindeki dizi elemanlarını agregasyon için `jsonb_array_elements` ile açmak gerekir, indexlenemez, ölçeklenmez |
| Gelecekteki cost/reporting ihtiyacı | Orta — `details JSONB` içine provider/cost gömülebilir ama şema disiplini yok | **İyi** — `analytics_events` üstüne ayrı, tip güvenli provider-usage alanları (bkz §7) eklenebilir, mevcut satırlar etkilenmez | Zayıf — cost verisi zaten hangi tabloya ait olduğu belirsiz bir JSONB yığınına gömülür |
| Test edilebilirlik | Orta — tek tablo, ama `action` string'lerinin testte "doğru yazıldığını" kanıtlamak zayıf tipli | **İyi** — sabit `event_type` enum'u + repository katmanı, mevcut `render-jobs.test.ts` deseniyle birebir test edilebilir | Zayıf — JSONB shape'inin regression'da sessizce bozulması riski (zod validation her JSONB'ye ayrı eklenmeli) |
| Mevcut konvansiyonla uyum | Orta — `audit_logs` şeması bu repo'nun genel "her ana varlık kendi client_id/status/created_at'ini taşır" desenine UYMUYOR (client_id yok) | **Yüksek** — `render_jobs`/`production_jobs`/`creative_qa_reports` ile AYNI şekil: `id, client_id, ..., created_at` | Düşük — bu repo'da hiçbir mevcut tablo "history JSONB dizisi" deseni kullanmıyor (en yakın emsal `render_warnings` ama o TEK render'a ait, zaman serisi değil) |

**Öneri: Ayrı `analytics_events` + `revision_entries` tabloları.**
Gerekçe:
1. **`audit_logs`'u doldurmak cazip görünüyor ama yanıltıcı** — tablo
   `client_id` taşımıyor, bu repo'nun "her satır kendi client'ını bilir"
   ilkesini (Step 4'ün tüm client-isolation mimarisinin dayandığı ilke)
   BAŞTAN ihlal ediyor. `client_id`'yi retrofit etmek (ALTER TABLE + backfill
   + NOT NULL) mevcut (boş olsa da) bir tabloyu riskli şekilde değiştirmek
   demek — Step 3/4'ün "additive-only" disiplinine aykırı. Sıfırdan, doğru
   şekilli yeni bir tablo açmak, var olan boş bir tabloyu sonradan
   "düzeltmekten" daha güvenli.
2. **JSONB "history" kolonu genişletme yaklaşımı çapraz-varlık
   sorgulamayı (dashboard'ın istediği "client bazında TÜM olaylar") imkansız
   yakınına getiriyor** — her tablo kendi JSONB'sinde gömülü kalır, "bu
   client'ta son 30 günün tüm olayları" sorgusu N tabloyu UNION'lamak
   gerektirir.
3. **Analytics (olay akışı, append-only, çok sayıda satır, zaman-serisi
   sorgular) ile Revision (varlık başına "önceki durum" anlık görüntüsü,
   nispeten az satır, varlık-bazlı sorgular) FARKLI erişim örüntüleri** —
   tek bir tabloya karıştırmak ("tek audit tablosu her şeyi tutar")
   ikisinin de sorgu planını bozar (analytics COUNT/GROUP BY ister,
   revision "bu varlığın son N snapshot'ı" ister). İki dar tablo, iki temiz
   repository (`analytics-events.ts`, `revision-entries.ts`) — render_jobs/
   export_artifacts'ın "parent-child ayrı tablo" desenine benzer.

---

## 5. MVP için en güvenli yaklaşım — Step 6A/6B ayrımı

Migration karmaşıklığı, client isolation, dashboard query pattern'i,
gelecekteki cost/reporting ihtiyacı ve test edilebilirlik hepsi aynı yöne
işaret ediyor: **AnalyticsEvent'i Step 6A'da küçük ve append-only olarak
teslim et; RevisionEntry'yi Step 6B'ye ERTELE.**

Gerekçe (§11'de implementation prompt'una da yansıyor):
- AnalyticsEvent tek bir append-only tablo + tek bir "kaydet" servis
  fonksiyonu + mevcut kod yollarına (zaten var olan status-yazma anlarına)
  TEK satırlık ek çağrılar — riski düşük, regresyon yüzeyi neredeyse sıfır
  (var olan hiçbir INSERT/UPDATE değişmiyor, yanına bir INSERT ekleniyor).
- RevisionEntry ise "hangi alanlar önceki/sonraki olarak saklanacak" +
  "diff nasıl hesaplanacak" (özellikle `layout_json`/`qa_json` gibi büyük
  JSONB alanlarında tam snapshot mu diff mi) kararlarını gerektiriyor — bu,
  §3'te tespit edilen `GeneratedOutput.version`/`parent_output_id`'nin HİÇ
  kullanılmayan iskeletiyle birleştiğinde, kendi başına bir tasarım kararı
  gerektiren AYRI bir iş. İkisini aynı adımda yapmak, Step 6A'nın "küçük,
  güvenli, hızlı teslim edilebilir" hedefini bozar.
- Analytics (§7 Provider Usage dahil) dashboard'a ANINDA somut değer katar
  (özet panel), revision history'nin dashboard UX'i (§9) daha büyük bir
  tasarım yüzeyi ister ("hangi alan değişti" diff görünümü) — bu da ayrı
  sıralamayı destekliyor.

---

## 6. Provider cost tracking planı

Bugün gerçekten yakalanabilir olan (AIResponse'tan doğrudan, hiçbir yeni
provider entegrasyonu gerektirmeden):

| Alan | Bugün var mı? | Kaynak |
|---|---|---|
| `provider` | **Evet** | `AIResponse.provider` |
| `model` | **Evet** | `AIResponse.model` |
| `operationType` (`taskType`) | **Evet** | `AIRequest.taskType` (`layout_generation`, `creative_qa`, `image_generation`, ...) |
| `tokenInput`/`tokenOutput`/`totalTokens` | **Evet** | `AIResponse.usage.{inputTokens,outputTokens,totalTokens}` |
| `estimatedCost` | **Kısmen** — alan var (`AIResponse.usage.estimatedCost`) ama HER adapter'ın bunu doldurup doldurmadığı doğrulanmalı; `ProviderConfig.costPerMToken`/`ModelConfig.costPer1kInput/Output` şemada var, hesaplamanın her adapter'da tutarlı uygulandığı Step 6A'da doğrulanacak bir varsayım, spekülatif DEĞİL ama "her zaman dolu" da garanti değil | `types.ts` |
| `durationMs` (`latencyMs`) | **Evet** | `AIResponse.latencyMs` |
| `attempts` | **Evet** | `AIResponse.attempts` (executeWithClassifiedRetry) |
| `status` (success/failure) | **Evet** | `AIResponse.success` |
| `errorKind` | **Evet** | `AIResponse.errorKind` (`provider-errors.ts`'in `ProviderErrorKind`'ı) |
| `imageCount` | **Kısmen** — `image_generation` task'ı için `generated_outputs.alternative_index`/toplam alternatif sayısı üzerinden türetilebilir, AMA `AIResponse` şemasında DOĞRUDAN bir `imageCount` alanı YOK — Step 6A bunu ya çağıran taraftan (visual-generation.ts zaten kaç görsel istediğini biliyor) parametre olarak geçirmeli, ya da MVP'de atlanmalı (spekülatif) |

**Sonuç:** `provider`, `model`, `operationType`, token sayıları, `durationMs`,
`attempts`, `status`, `errorKind` BUGÜN gerçek, doğrudan `AIResponse`'tan
yakalanabilir veri — spekülatif değil. `estimatedCost` "var ama her yerde
tutarlılığı doğrulanmamış" (Step 6A doğrulamalı, hesaplamıyorsa MVP'de
nullable bırakılmalı — provider adapter'larına dokunmak bu adımın kapsamı
DIŞI). `imageCount` gerçekten spekülatif — Step 6A'da atlanabilir veya
çağıran taraftan opsiyonel bir alan olarak geçirilebilir.

**Ayrı bir `provider_usage` tablosu Step 6A için gerekli mi?**
HAYIR — ertelenmeli. `analytics_events` tablosu zaten her olay için
`event_type`, `client_id`, `entity_type/entity_id`, `metadata JSONB` taşıyacak
(bkz §8); provider çağrı verisi (`provider`, `model`, `tokenInput/Output`,
`durationMs`, `estimatedCost`, `errorKind`) bu `metadata` JSONB'sinin İÇİNE,
`event_type IN ('visual_generation_succeeded','visual_generation_failed',
'layout_generated', ...)` olan satırlara gömülebilir — ayrı bir tablo AÇMADAN.
Gerekçe: provider-usage sorgu ihtiyacı bugün "hangi provider ne kadar
harcadı" seviyesinde basit bir toplam/rapor — bunun için `analytics_events.
metadata->>'estimatedCost'` üzerinden `SUM`/`GROUP BY metadata->>'provider'`
yeterli MVP kapsamında (Postgres JSONB operatörleri indexlenebilir GIN index
ile de desteklenir, ama Step 6A'da buna bile gerek yok — event hacmi MVP
ölçeğinde küçük). Gerçek hacim/performans ihtiyacı ortaya çıkarsa (örn.
binlerce provider çağrısı/gün), `provider_usage` ayrı bir tablo olarak
**Step 6B veya sonrası bir "cost reporting hardening"** adımında
normalize edilebilir — bu, mevcut `analytics_events` şemasını KIRMADAN
üstüne eklenebilecek bir genişleme (metadata'dan ayrı kolonlara migrate).

---

## 7. Render/export analytics planı

`render_jobs` (`019_render_jobs.sql` + `022_render_jobs_queue.sql`) ve
`export_artifacts` (`019_render_jobs.sql`) alanlarının render/export
analytics ihtiyacına haritalanması:

| İhtiyaç duyulan alan | Karşılığı | Kaynak tablo |
|---|---|---|
| `preset`/`format` | `requested_format` JSONB (`{ preset, exportFormat, width, height }` — bkz `RequestedFormatSchema`, `packages/schemas/src/render-job.ts`) | `render_jobs.requested_format` |
| `width`/`height` | `export_artifacts.width`/`.height` (gerçekleşen boyut, `requested_format`'tan farklı olabilir — örn. clamp/aspect-fit sonrası) | `export_artifacts` |
| `sizeBytes` | `export_artifacts.size_bytes` | `export_artifacts` |
| `renderDurationMs` | Step 5A'nın `started_at`/`finished_at` farkı (`finished_at - started_at`) — HENÜZ bir kod yolunda hesaplanmıyor ama alanlar mevcut | `render_jobs.started_at`/`.finished_at` |
| `warningCount` | `render_warnings` JSONB dizisinin `length`'i (`{code,message,layerId?}[]`) | `render_jobs.render_warnings` |
| `artifactDownloaded` | **Yok bugün** — §2'de tespit edildi, YENİ bir `export_artifact_downloaded` analytics event'i gerektirir (route'a bir satır eklenir) | YENİ — `GET /export-artifacts/:id/file` route'unda eklenecek |

**Sonuç:** `preset`/`format`/`width`/`height`/`sizeBytes`/`warningCount`
BUGÜN doğrudan var olan kolonlardan türetilebilir — hiçbir yeni ham veri
üretmeye gerek yok, sadece bu değerleri `analytics_events.metadata`'sına
kopyalamak (render_jobs/export_artifacts satırı yaratılırken) yeterli.
`renderDurationMs` hesaplaması Step 5A'nın zaten yazdığı zaman damgalarından
basit bir çıkarma. Tek gerçek yeni kod yolu `artifactDownloaded` — küçük,
izole bir ekleme (route handler'a bir `analyticsEvents.record(...)` çağrısı).

---

## 8. Önerilen veri modeli

### 8.1 `analytics_events` (Step 6A — YAZILACAK)

```sql
CREATE TABLE analytics_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  event_type VARCHAR(60) NOT NULL CHECK (event_type IN (
    'design_brief_created',
    'design_dna_generated', 'design_dna_approved', 'design_dna_needs_revision',
    'layout_generated', 'layout_approved', 'layout_rejected', 'layout_needs_revision',
    'creative_qa_generated', 'creative_qa_approved', 'creative_qa_rejected',
    'visual_generation_succeeded', 'visual_generation_failed',
    'production_package_created', 'production_job_approved', 'production_job_rejected',
    'render_job_queued', 'render_job_rendered', 'render_job_failed', 'render_job_cancelled',
    'export_artifact_downloaded'
  )),
  entity_type VARCHAR(30) NOT NULL,   -- 'design_brief' | 'design_dna' | 'layout_plan' |
                                        -- 'creative_qa_report' | 'generated_output' |
                                        -- 'production_job' | 'render_job' | 'export_artifact'
  entity_id UUID NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,  -- NULL: sistem/worker kaynaklı olay
  metadata JSONB NOT NULL DEFAULT '{}',  -- olay-tipine göre serbest ama disiplinli şekil, bkz aşağı
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_analytics_events_client_created ON analytics_events(client_id, created_at DESC);
CREATE INDEX idx_analytics_events_type ON analytics_events(event_type);
CREATE INDEX idx_analytics_events_entity ON analytics_events(entity_type, entity_id);
```

Neden bu şekil:
- `client_id NOT NULL` — bu repo'daki HER analytics-uygun tablonun ilk
  kolonu (`clients`, `design_dna`, `layout_plans`, `creative_qa_reports`,
  `production_jobs`, `render_jobs`, `export_artifacts` hepsi böyle) —
  `assertClientAccessible` guard'ının doğrudan uygulanabilmesi için ZORUNLU
  (bkz §9).
- `event_type` CHECK constraint — `render_jobs.status`/`production_jobs.
  status`'un VARCHAR+CHECK deseniyle aynı (native Postgres ENUM değil,
  `022_render_jobs_queue.sql`'in kendi gerekçesiyle aynı: yeni değer
  eklemek `ALTER TYPE` değil basit bir constraint drop/recreate).
- `entity_type`/`entity_id` çifti — `approvals` tablosunun ZATEN kullandığı
  polimorfik referans deseni (`001_initial_schema.sql`), yeni bir kavram
  icat edilmiyor.
- `actor_user_id` nullable + `ON DELETE SET NULL` — `production_jobs.
  approved_by`/`rejected_by` ile AYNI desen (kullanıcı silinirse geçmiş
  olay kaybolmaz, sadece "kim" bilgisi anonimleşir); render worker gibi
  insan-olmayan kaynaklı olaylarda NULL bırakılır (worker bir HTTP isteği
  değil, `assertClientAccessible`'ın §9'daki "worker yeniden yetkilendirme
  yapmaz" ilkesiyle tutarlı).
- `metadata JSONB DEFAULT '{}'` — bu repo'nun HER YERDE kullandığı
  forward-compat serbest alan deseni (`requested_format`, `render_warnings`,
  `package_manifest_snapshot`, ...). Olay-tipine göre önerilen (ama
  ŞEMA-zorunlu OLMAYAN) şekiller:
  - `visual_generation_succeeded`/`failed`: `{ provider, model, taskType,
    tokenInput, tokenOutput, totalTokens, durationMs, attempts,
    estimatedCost?, errorKind? }`
  - `render_job_rendered`/`failed`: `{ preset, format, width, height,
    sizeBytes?, renderDurationMs?, warningCount, attemptCount }`
  - `export_artifact_downloaded`: `{ format, sizeBytes, renderJobId }`
  - diğerleri (approve/reject/needs_revision): `{ previousStatus,
    newStatus, notes? }`

### 8.2 `revision_entries` (Step 6B — SONRAYA ERTELENDİ, taslak şekil)

```sql
-- Step 6B'de yazılacak, bu adımda YAZILMAZ. Referans için şekil taslağı:
CREATE TABLE revision_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  entity_type VARCHAR(30) NOT NULL,
  entity_id UUID NOT NULL,
  revision_number INTEGER NOT NULL,       -- generated_outputs.version'ın genellenmiş hali
  previous_snapshot JSONB,                 -- NULL ilk revizyonda
  new_snapshot JSONB NOT NULL,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  change_reason TEXT,                      -- production_jobs.rejection_reason ile aynı fikir
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 8.3 Ayrı `provider_usage` tablosu — Step 6A için DEĞERLENDİRİLDİ, ERTELENDİ

Bkz §6 — MVP'de `analytics_events.metadata` içine gömülü provider verisi
yeterli; ayrı normalize tablo yalnızca gerçek hacim/performans ihtiyacı
ortaya çıkarsa sonraki bir adımda eklenir (additive, mevcut şemayı kırmadan).

---

## 9. Lifecycle / kayıt akışı planı (Step 6A kapsamı)

```
Var olan kod yolu (DEĞİŞMEZ)          →  Yeni ek (additive, Step 6A)
──────────────────────────────────────────────────────────────────────
design-brief-creation.ts                  analyticsEvents.record({
  designBriefsRepo.create(...)              eventType:'design_brief_created', ... })

design-dna-analysis.ts                     analyticsEvents.record({
  designDnaRepo.create(status:'generated')   eventType:'design_dna_generated', ... })
routes/design-dna.ts (approve/revise)       analyticsEvents.record({
                                              eventType:'design_dna_approved'|
                                                         'design_dna_needs_revision', ... })

layout-generation.ts                       analyticsEvents.record({
  layoutPlansRepo.create(...) (×2-3)          eventType:'layout_generated', ... }) (×2-3)
routes/layout-plans.ts (approve/reject)     analyticsEvents.record({
                                              eventType:'layout_approved'|'layout_rejected'|
                                                         'layout_needs_revision', ... })

creative-qa.ts servis                      analyticsEvents.record({
  creativeQaRepo.create(...)                  eventType:'creative_qa_generated', ... })
routes/creative-qa.ts (approve/reject)      analyticsEvents.record({
                                              eventType:'creative_qa_approved'|
                                                         'creative_qa_rejected', ... })

visual-generation.ts runVisualGeneration() analyticsEvents.record({
  generatedOutputs.create(status:'generated'  eventType:'visual_generation_succeeded'|
    | 'failed')                                          'visual_generation_failed',
                                              metadata: { provider, model, tokenInput,
                                              tokenOutput, durationMs, attempts,
                                              estimatedCost?, errorKind? } })

production-package-builder.ts              analyticsEvents.record({
  productionJobsRepo (package_ready)          eventType:'production_package_created', ... })
routes/production-jobs.ts (approve/reject)  analyticsEvents.record({
                                              eventType:'production_job_approved'|
                                                         'production_job_rejected', ... })

render-engine.ts / render-worker.ts        analyticsEvents.record({
  render_jobs (queued/rendered/failed/         eventType:'render_job_queued'|'rendered'|
    cancelled)                                            'failed'|'cancelled',
                                              metadata: { preset, format, width, height,
                                              sizeBytes?, renderDurationMs?, warningCount,
                                              attemptCount } })

routes/export-artifacts (YENİ satır,        analyticsEvents.record({
  bugün ayrı bir route dosyası yok —          eventType:'export_artifact_downloaded',
  render-jobs.ts içindeki dosya-indirme         metadata: { format, sizeBytes, renderJobId } })
  handler'ına eklenir)
```

**Kural (Step 5A'nın §9 "worker yeniden yetkilendirme yapmaz" ilkesiyle
aynı ruhta):** `analyticsEvents.record()` çağrısı HER ZAMAN ilgili
domain-servis fonksiyonunun İÇİNDEN, satır zaten yazıldıktan HEMEN SONRA
yapılır — route handler'lardan DEĞİL (route'lar zaten servisi çağırıyor,
servis client_id'yi zaten biliyor). Bu, olay kaydının atlanmasını
(bir route'un servisi çağırmayı unutması riski yok çünkü zaten mevcut
kod yoluna ekleniyor) ve iki kez kaydedilmesini (yalnız bir yerden
çağrılıyor) engeller. Kayıt HER ZAMAN "best-effort, asla ana işlemi
BOZMAZ" olmalı — bir analytics-events INSERT'i başarısız olursa (ör. geçici
DB sorunu), ana domain işlemi (brief/layout/QA/render kaydı) BUNDAN
ETKİLENMEMELİ; bu, `try/catch` ile sarmalanmış, hatası sadece
`console.warn` edilen bir "fire and forget" çağrı olarak tasarlanmalı
(ai-call-helper.ts'in "hata mesajını persist et, asla yut" ilkesiyle
ÇELİŞMEZ çünkü burada yutulan hata analytics'in kendi hatası, ana işlemin
hatası değil).

---

## 10. API planı

- **YENİ:** `GET /clients/:id/analytics/summary` — `analytics:read`
  permission'ı (yeni), `assertClientAccessible(req.user.id, id)` guard'ı
  (Step 4 deseniyle birebir). Dönen şekil:
  ```json
  {
    "data": {
      "totals": {
        "briefsCreated": 12, "layoutsGenerated": 28, "qaReportsGenerated": 24,
        "visualsSucceeded": 20, "visualsFailed": 3,
        "productionPackagesCreated": 15, "renderJobsRendered": 14,
        "renderJobsFailed": 1, "exportArtifactsDownloaded": 9
      },
      "approvalRate": { "layout": 0.82, "creativeQa": 0.75, "productionJob": 0.90 },
      "failureRate": { "visualGeneration": 0.13, "renderJob": 0.07 },
      "providerErrorSummary": [
        { "provider": "openai", "errorKind": "rate_limit", "count": 2 },
        { "provider": "kie-ai", "errorKind": "timeout", "count": 1 }
      ],
      "recentActivity": [
        { "eventType": "render_job_rendered", "entityType": "render_job", "entityId": "...",
          "createdAt": "2026-07-05T14:03:00Z" }
      ]
    }
  }
  ```
  Sorgu, `analytics_events`'i `client_id = $1 AND created_at >= now() -
  interval '30 days'` ile filtreleyip `event_type`'a göre `COUNT(*)`
  gruplayan tek bir repository metodu (`analyticsEventsRepo.
  getClientSummary(clientId, sinceDate)`) — mevcut `render-jobs.ts`
  repo'sunun basit SQL agregasyon desenine benzer, ORM/karmaşık query
  builder YOK.
- **YENİ:** `GET /analytics/events?clientId=&entityType=&entityId=&limit=`
  — ham olay listesi ("bu job'da ne oldu" görünümü için), `analytics:read`
  permission'ı, `assertClientAccessible` (query param'daki `clientId`
  üzerinden; `entityId` verilirse ekstra bir "bu entity gerçekten bu
  client'a mı ait" kontrolüne gerek YOK çünkü kayıt zaten `client_id`
  taşıyor — sorgu doğrudan `WHERE client_id = $1` filtreler, cross-client
  bir entity_id verilse bile o client'ın olaylarına asla karışmaz).
- Diğer HER ŞEY (mevcut brief/DNA/layout/QA/visual/production/render/export
  route'ları) **DEĞİŞMEZ** — Step 6A yalnızca bu route'ların servis
  katmanına "yanına bir INSERT ekle" yapar, hiçbir mevcut response şeklini
  değiştirmez.

---

## 11. Dashboard UX planı (Step 6A — büyük redesign YOK)

Mevcut `apps/dashboard/src/app/clients/[id]/page.tsx`'in bugünkü
`stats-grid`'i (yalnız `content_ideas` sayan, client-side filtreleme yapan)
ÖRNEK ALINIR ama GENİŞLETİLMEZ — yerine, aynı sayfaya YENİ bir kart eklenir:

- **YENİ bileşen:** `apps/dashboard/src/components/analytics-summary-panel.tsx`
  — `GET /clients/:id/analytics/summary`'yi çağırır, `stat-card` deseniyle
  (mevcut `page.tsx`'teki `.stats-grid`/`.stat-card` CSS class'ları AYNEN
  kullanılır, yeni CSS icat edilmez) şu kutucukları gösterir: "Üretilen
  Görsel", "Render Tamamlanan", "Onay Oranı (Layout/QA/Prod.)", "Hata
  Oranı", "Son 30 Gün Provider Hataları" (kısa liste, `friendlyAiErrorMessage`
  ile AYNI Türkçe sözlük kullanılarak `errorKind` insan-diline çevrilir —
  yeni bir sözlük icat edilmez).
- **YENİ, küçük bir "Son Aktivite" listesi:** aynı panelin altına, en son
  10-15 `analytics_events` satırı (`GET /analytics/events?clientId=...
  &limit=15`), her satır tek bir Türkçe cümle olarak render edilir (örn.
  "Layout planı onaylandı", "Render işi başarısız oldu — 3. deneme").
  Karmaşık bir zaman-çizelgesi bileşeni DEĞİL, düz bir liste (`<ul>`).
- `apps/dashboard/src/app/clients/[id]/page.tsx`'e TEK bir ek
  `useEffect`/`api.getClientAnalyticsSummary(id)` çağrısı ve panel'in
  sayfaya eklenmesi — sayfanın geri kalanı (subPages kartları, hızlı iş
  akışları, notlar) DEĞİŞMEZ.
- `apps/dashboard/src/lib/api.ts`'e tek bir yeni fonksiyon:
  `getClientAnalyticsSummary(clientId: string)`.

Büyük bir "Analytics" sekmesi/sayfası, grafik kütüphanesi, tarih aralığı
seçici gibi YOK — MVP'de client profilinin ALTINA eklenen tek bir kart +
tek bir liste yeterli.

---

## 12. RBAC / client isolation planı

- **YENİ permission:** `analytics:read` — `database/migrations/005/007/
  010/012/015/017/020` deseniyle (yeni migration, OWNER + CREATIVE_DIRECTOR'a
  ver, DESIGNER/CONTENT_MANAGER için ayrı ayrı değerlendir — muhtemelen
  DESIGNER de `analytics:read` alabilir çünkü kendi ürettiği job'ların
  özetini görmesi zararsız, CONTENT_MANAGER önceki desenle tutarlı olarak
  DIŞLANIR).
- **Event yazma sırasında guard YOK, GEREKMİYOR** — `analyticsEvents.
  record()` her zaman ZATEN client_id'si bilinen (ve zaten
  `assertClientAccessible` ile doğrulanmış) bir servis çağrısının İÇİNDEN
  tetiklenir (bkz §9) — event insert'i kendi başına YENİDEN bir
  yetkilendirme kontrolü yapmaz, tıpkı Step 5A'nın "worker execution
  sırasında yeniden guard yok" ilkesiyle aynı mantık: yaratılış anında
  zaten gate'lendi.
- **Event okuma sırasında guard VAR** — `GET /clients/:id/analytics/
  summary` ve `GET /analytics/events` route'ları `assertClientAccessible`
  çağırır; `analytics_events.client_id` üzerinden WHERE filtresi zaten
  cross-client satırları sorgudan TAMAMEN dışlıyor (bir client'ın kaydını
  başka bir client'ın id'siyle sorgulamak boş sonuç döner, 404/403 değil —
  route seviyesinde `assertClientAccessible` zaten önce fırlatır).
- **Cross-client leakage önleme testi** — Step 4'ün `client-isolation.
  test.ts`'ine yeni bir blok: iki client'ın olayları aynı tabloda karışık
  sırada var olsa bile `GET /clients/:idA/analytics/summary`'nin
  YALNIZCA client A'nın sayaçlarını döndürdüğü, client B'ninkini asla
  sızdırmadığı kanıtlanır.

---

## 13. Test planı

Mevcut Vitest konvansiyonlarını (embedded Postgres, `apps/api/src/__tests__/
*.test.ts`, `render-jobs.test.ts`/`render-queue-worker.test.ts`/
`client-isolation.test.ts` deseni) AYNEN kullanarak, YENİ bir
`analytics-events.test.ts`:

- **Event kaydı — her lifecycle noktası:** `createDesignBrief()` →
  `design_brief_created` satırı yazıldığını doğrula; aynı desen `design_dna`
  approve/revise, `layout_plans` generate/approve/reject,
  `creative_qa_reports` generate/approve/reject, `visual-generation`
  succeeded/failed, `production_jobs` package_ready/approve/reject,
  `render_jobs` queued/rendered/failed için tekrarlanır (mevcut
  `createPackageReadyProductionJob` gibi test yardımcıları AYNEN
  kullanılır).
- **Provider hata olayı:** `visual-generation.test.ts`'in mevcut
  "provider fails" senaryosu genişletilir — `analytics_events`'te
  `visual_generation_failed` satırının `metadata.errorKind` alanının
  doğru sınıflandırmayı taşıdığı doğrulanır (provider-retry.test.ts'in
  `classifyProviderError` testleriyle aynı sınıflandırma sözlüğü).
  Ayrıca `console.error`'un secret/prompt İÇERMEDİĞİ (mevcut ai-call-
  helper.ts'in "asla prompt/secret loglama" sözleşmesi) — event
  `metadata`'sının da AYNI kısıtı taşıdığı (yalnız provider/model/kind,
  ASLA prompt/API key) ayrı bir assertion olarak eklenir.
- **Export artifact indirme olayı:** `render-jobs.test.ts`'e yeni bir
  test — dosya indirme route'u çağrıldığında `export_artifact_downloaded`
  satırının yazıldığını doğrula.
- **Client isolation:** §12'de açıklanan yeni blok, mevcut
  `client-isolation.test.ts`'e eklenir.
- **Dashboard summary agregasyonu:** `analyticsEventsRepo.
  getClientSummary()` için birim test — bilinen bir event seti insert
  edilip toplamların/oranların doğru hesaplandığı doğrulanır (embedded
  Postgres'e karşı gerçek SQL, mock DB değil — mevcut repo testlerinin
  hepsinin deseni).
- **Best-effort kaydın ana işlemi bozmadığı:** `analyticsEventsRepo.
  record()` bilerek throw eden bir sahte/mock ile çağrıldığında, ana
  servis çağrısının (örn. `createDesignBrief()`) YİNE DE başarıyla
  tamamlandığı doğrulanır — §9'daki "fire and forget, ana işlemi asla
  bozma" sözleşmesinin regresyon testi.
- **Secret sızdırmama:** genel bir assertion — hiçbir `analytics_events.
  metadata` alanının `apiKey`/`token`/`password` gibi bir anahtar İÇERMEDİĞİ
  (basit bir regex/anahtar-listesi kontrolü, mevcut `security.md`'nin
  ilkesiyle uyumlu).

---

## 14. Riskler

- **Event kaydının servis katmanına dağılması regresyon riski taşır** —
  8 farklı servis dosyasına (design-brief-creation, design-dna-analysis,
  layout-generation, creative-qa, visual-generation, production-package-
  builder, render-engine/render-worker, render-jobs route) küçük ama
  SAYICA çok ekleme yapılıyor; her birinin "mevcut testleri KIRMAMASI"
  Step 6A'nın en kritik kabul kriteri (render-queue-worker-plan.md'nin
  §12'sindeki AYNI risk sınıfı).
- **`estimatedCost`'un her adapter'da tutarlı doldurulmadığı ortaya
  çıkabilir** — §6'da not edildi, spekülatif alan; Step 6A bunu
  DOĞRULAMALI, doldurmuyorsa `metadata.estimatedCost` nullable/eksik
  bırakılmalı, adapter'lara dokunmak bu adımın kapsamı DIŞI.
- **`analytics_events` tablosunun büyümesi** — append-only, hiç
  silinmeyen bir tablo; MVP ölçeğinde (birkaç client, günlük onlarca
  olay) sorun değil ama uzun vadede retention/partition politikası
  gerekebilir — Step 6A'nın kapsamı DIŞI, ileride not edilecek bir borç.
- **Best-effort kayıt "sessizce hiç yazılmama" riskini taşır** — event
  insert'i her zaman try/catch'lenmiş olduğu için, DB'de gerçek bir sorun
  varsa hiçbir event kaydedilmeden domain işlemleri normal çalışmaya devam
  eder; bu BİLİNÇLİ bir tercih (ana iş asla event kaydına bağımlı
  olmamalı) ama demo/gözlemde "neden özet boş" sorusuna yol açabilir —
  Step 6A'nın loglama (`console.warn`) ile bunu görünür kılması gerekir.
- **RevisionEntry'nin ertelenmesi, "bir job'da ne değişti" sorusuna Step
  6A'da tam cevap vermez** — yalnızca "hangi olaylar oldu" (analytics)
  cevaplanır, "önceki JSON neydi" (revision) cevaplanmaz; bu bilinçli bir
  kapsam sınırı (§5), Step 6B'ye kadar geçici bir eksiklik olarak
  KAYDEDİLMELİ.

---

## 15. Phase 3 Step 6A için hazır implementation promptu

Aşağıdaki prompt, bu plan onaylandıktan sonra Step 6A'yı başlatacak bir
sonraki konuşmaya doğrudan verilebilir:

```
Grafista AI Studio MVP — Phase 3 Step 6A — Analytics Events MVP Implementation

Çalışma dizini: /Users/sercanbingol/Desktop/Antigravity/Projeler/Grafista-AI-Studio
Branch: phase-2-checkpoint (Step 6 planning commit'i sonrası)
Referans doküman: docs/analytics-revision-history-plan.md (bu planın
TAMAMINI uygula — özellikle §8.1 veri modeli, §9 lifecycle/kayıt akışı,
§10 API planı, §11 dashboard UX planı, §12 RBAC, §13 test planı).

Hedef: Append-only bir AnalyticsEvent kaydı + client-scoped özet endpoint'i
+ küçük bir dashboard "Özet/Son Aktivite" paneli. RevisionEntry BU ADIMIN
KAPSAMI DIŞI — Step 6B'ye ertelendi (gerekçe: §5, §3 — GeneratedOutput'un
zaten var olan ama hiç kullanılmayan version/parent_output_id iskeleti,
diff/snapshot tasarımı gerektiren ayrı bir karar; Analytics ise küçük,
append-only, düşük regresyon riskli bağımsız bir iş).

Kapsam:
1. Additive migration: `analytics_events` tablosu (§8.1) — id, client_id,
   event_type (CHECK'li sabit liste), entity_type, entity_id,
   actor_user_id (nullable), metadata JSONB, created_at. İndeksler:
   (client_id, created_at DESC), event_type, (entity_type, entity_id).
   Yeni permission: `analytics:read` (OWNER + CREATIVE_DIRECTOR +
   DESIGNER'a ver, CONTENT_MANAGER'a verme — 020_render_jobs_permissions.sql
   deseniyle aynı gerekçe formatı).
2. Yeni repository: `apps/api/src/db/repositories/analytics-events.ts`
   — `record(input)` (best-effort, iç try/catch, hata yutulur ama
   console.warn edilir — §9/§14) ve `getClientSummary(clientId, sinceDate)`
   (toplamlar + approval/failure rate + provider hata özeti + son N olay,
   §10'daki response şekli).
3. Servis katmanına ekleme (route'lara DEĞİL) — §9'daki tabloyu birebir
   uygula: design-brief-creation.ts, design-dna-analysis.ts (+ approve/
   revise route'ları), layout-generation.ts (+ approve/reject route'ları),
   creative-qa.ts servis (+ approve/reject route'ları), visual-
   generation.ts, production-package-builder.ts (+ approve/reject
   route'ları), render-engine.ts/render-worker.ts, ve YENİ export-artifact
   indirme event'i (render-jobs.ts route'undaki dosya-indirme handler'ı).
   HER ekleme mevcut kod yolunun SONUNA, satır zaten yazıldıktan sonra
   eklenir — mevcut davranış/response şekli DEĞİŞMEZ.
4. Yeni route: `GET /clients/:id/analytics/summary` (`analytics:read` +
   `assertClientAccessible`, §10, §12) ve `GET /analytics/events?clientId=
   &entityType=&entityId=&limit=` (aynı guard'lar).
5. Dashboard: yeni `apps/dashboard/src/components/analytics-summary-
   panel.tsx` (mevcut `.stats-grid`/`.stat-card` CSS class'larını kullan,
   yeni CSS icat etme) + `apps/dashboard/src/lib/api.ts`'e
   `getClientAnalyticsSummary()` + `apps/dashboard/src/app/clients/[id]/
   page.tsx`'e panel'i ekleyen TEK bir ek (§11). Büyük redesign YOK.
6. Testler (§13): yeni `analytics-events.test.ts` (her lifecycle
   noktasında event kaydı, provider hata sınıflandırması metadata'da
   doğru, export-artifact indirme event'i, best-effort kaydın ana işlemi
   bozmadığı, secret sızdırmama) + `client-isolation.test.ts`'e yeni blok
   (§12) — mevcut TÜM testler (render-jobs.test.ts, production-jobs.
   test.ts, visual-generation.test.ts, layout-plans.test.ts, creative-qa.
   test.ts, design-dna.test.ts, demo-flow.test.ts, render-queue-worker.
   test.ts) KIRILMAMALI.

Kesinlikle yapılmayacaklar: RevisionEntry tablosu/servisi (Step 6B'ye
bırak), ayrı provider_usage tablosu (§6 — metadata JSONB içinde kalsın),
audit_logs tablosunu doldurma (client_id yok, §4'te gerekçesiyle
reddedildi), büyük dashboard "Analytics" sekmesi/grafik kütüphanesi,
provider adapter'larına dokunma (estimatedCost hesaplaması mevcutsa
kullan, yoksa nullable bırak — adapter değişikliği kapsam dışı), route
seviyesinde event kaydı (yalnız servis katmanı, §9).

Komutlar (hepsi geçmeden commit atma): pnpm run typecheck, pnpm run lint,
pnpm run test:stable, pnpm run build. Ayrıca yeni analytics-events
testlerini izole çalıştır.

Commit mesajı önerisi: "phase 3 step 6a: append-only analytics events + client summary panel"
```

---

## İlgili dokümanlar

- [`docs/phase-3-productization-roadmap.md`](./phase-3-productization-roadmap.md)
  — Step 6'nın orijinal kapsam tanımı (bu belge onun teslimatıdır).
- [`docs/render-queue-worker-plan.md`](./render-queue-worker-plan.md) —
  Step 5'in planı; bu belgenin format/derinlik referansı, ayrıca Step 6A'nın
  bazı ilkelerinin (worker/servis katmanında yeniden yetkilendirme yok,
  best-effort yan-etki, additive-only migration) doğrudan kaynağı.
- [`docs/release-readiness.md`](./release-readiness.md) — mevcut kapsam
  dışı/borç kayıtlarının genel listesi.
