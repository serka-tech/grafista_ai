# RF Same Page Log — DNA2 (vision routing + brand-truth grounding)

Plan: RF-PLAN-DNA2.md · Issues: RF-ISSUES-DNA2.md · Core Focus: DNA marka gerçeğinden türesin,
hiçbir tasarım/vision görevi görsele bakmadan halüsine etmesin, renk/logo tek kanonik kaynaktan tutarlı.

## Round 1
### Integrator findings (Codex, verbatim)
- [FIX] Rock 1 breaks Claude-backed creative QA because `creative_qa` is implemented as a text-only structural review but routing incorrectly requires `['text','vision']` -> Change that route to `['text']`, or actually attach rendered pixels before retaining the vision requirement.
- [FIX] Capability filtering trusts Gemini's declared vision capability even though its adapter is an unimplemented placeholder that always fails -> Do not mark placeholder adapters capable/available, or add an explicit operational-readiness check.
- [FIX] Rock 1 silently substitutes a different provider without recording why, so configuration errors can masquerade as successful routing -> Log and return metadata for requested provider, selected provider, and capability-mismatch reason.
- [FIX] Rock 1 can pass its proposed adapter-capability assertion while the selected adapter still cannot execute vision, as demonstrated by Gemini -> Test `router.complete()` with executable stubs and assert that image content reaches the selected adapter, not merely that its capability array contains `vision`.
- [FIX] Explicit-provider fallback can carry a provider-specific `model` into another adapter after a capability mismatch -> Clear or translate `request.model` when changing providers, and add a cross-provider model test.
- [FIX] Rock 2 corrupts stage-1 evidence by ordering the vision model to make observed `dominantColors` agree with the authoritative palette even when the reference genuinely differs -> Keep stage 1 as pure pixel observation and apply the palette only during synthesis while preserving discrepancies as evidence.
- [FIX] Prompting synthesis to honor the palette does not guarantee that persisted `colorUsageRules` contain only palette colors -> Deterministically validate or normalize synthesized color hexes against the parsed palette before persistence.
- [FIX] Rock 2's proposed proof only checks prompt text and would pass even if the model returns and the database persists the conflicting fake green -> Add an adversarial synthesis response test asserting persisted DNA colors, plus a real routing test proving stage 1 received image bytes.
- [FIX] `loadBrandPaletteText()` treats every palette with fewer than two distinct colors as absent, discarding valid monochrome brand truth -> Define palette validity independently of color count and accept a single schema-valid swatch.
- [FIX] Selecting the newest usable palette by silently skipping a newer malformed palette can resurrect stale brand colors without visibility -> Emit a warning/status for malformed latest palette metadata and define whether older versions may be used.
- [FIX] Rock 3 removes `colorUsageRules` only from layout prompt context while approved DNA, creative QA, and production-package output still expose stale conflicting colors -> Preserve the field for provenance but derive one canonical effective palette/DNA color policy shared by synthesis, layout, QA, visual generation, and production export.
- [FIX] Rock 3's palette prompt requires every emitted color to be an exact palette member, which can force unreadable text/background combinations when roles are missing or malformed -> Add deterministic contrast validation and a documented fallback policy rather than relying solely on prompt compliance.
- [KILL] Rock 3's proposed logo softening is non-testable prose that does not establish brand truth and is likely a no-op -> Remove it from this rock until logo-position provenance and confidence have an enforceable representation.
- [FIX] Logo position is inferred only from optional per-reference observations, yet synthesis can emit unrestricted `preferredPosition` strings without recurrence or provenance constraints -> Derive logo placement deterministically from observed positions with a minimum evidence threshold, otherwise omit it.
- [FIX] Rock 3's proof inspects prompt text but never validates generated layer colors or logo placement, so it can pass while layouts still violate brand truth -> Assert every generated layout color against the effective palette and test logo omission/placement from grounded observations.
- [FIX] "No migration needed" ignores existing fake/stale approved DNA, which remains active downstream because a rerun creates a new unapproved version -> Add an audit/backfill or invalidation strategy and require reanalysis plus approval for affected clients.
- [FIX] The plan lacks provenance showing which provider/model and palette version produced each analysis and DNA version, preventing reliable stale-data detection or remediation -> Persist routing/provider/model and palette-asset/version provenance with DNA generation, which may require a schema migration.
- [CLARIFY] The plan assumes the uploaded edited kartela is always authoritative even when it conflicts with historical references -> Define whether the palette represents current brand truth, reference-era truth, or an override explicitly confirmed by the client.
VERDICT: NOT YET

### Visionary response (Claude)
Koddan doğrulandı: creative-qa.ts:12 görsel göndermiyor; gemini.ts complete() hep fail + caps ['text','vision']; DNA çağrıları model set etmiyor (defansif kabul).
- ACCEPTED (creative_qa) -> Rock 1'e madde: route `['text','vision']`→`['text']`.
- ACCEPTED (gemini placeholder) -> Rock 1: `gemini.isAvailable()`→false (aktif olana kadar).
- ACCEPTED (substitution logging) -> Rock 1: takasta requested/selected/neden logu.
- ACCEPTED (executable-stub proof) -> Rock 1 proof: stub adapter, görsel byte adapter'a ulaşıyor mu assert.
- ACCEPTED (model leak) -> Rock 1: sağlayıcı takasında request.model temizle + test.
- ACCEPTED (stage-1 evidence corruption) -> Rock 2: stage 1 SAF gözlem, palet zorlaması YOK; çapa yalnız synthesis.
- ACCEPTED (deterministic color normalize) -> Rock 2: synthesis sonrası persist öncesi colorUsageRules hex'leri palete snap/normalize.
- ACCEPTED (Rock 2 proof zayıf) -> Rock 2 proof: adversarial persisted-DNA renk + stage-1 image-bytes testi.
- ACCEPTED (monochrome palette) -> Rock 2: loadBrandPaletteText ≥1 şema-geçerli swatch kabul.
- ACCEPTED (malformed latest palette) -> Rock 2: bozuk en-yeni palette uyarı logla, sessiz eskiye düşme.
- ACCEPTED (single canonical color policy) -> Rock 3 (scoped): downstream tek kaynak loadBrandPaletteText; QA reviewer/production export layout'tan miras alır (scope: layout+visual-gen).
- ACCEPTED (contrast) -> Rock 3: katı üyelik dayatma yok, mevcut F9 kontrast QA guard; yeni contrast motoru DEFER.
- ACCEPTED (KILL logo softening prose) -> Rock 3'ten belirsiz prose çıkarıldı.
- ACCEPTED (deterministic logo position) -> Rock 2: preferredPosition gözlemlerden çoğunluk+eşik, altında omit.
- ACCEPTED (Rock 3 proof zayıf) -> Rock 3 proof: palet doluyken layout renk kaynağı palet, çelişki yok assert.
- DEFERRED (stale DNA backfill) -> RF-ISSUES-DNA2 + genel proof'a operasyonel adım (rerun+approve, canlı doğrula).
- DEFERRED (provenance persistligi) -> RF-ISSUES-DNA2 (migration ister).
- RESOLVED (CLARIFY) -> Palet = güncel yetkili marka gerçeği; tarihsel referans renklerini ezer (plana yazıldı).

## Round 2
### Integrator findings (Codex, verbatim)
- [FIX] Rock 2's normalization remains ambiguous (nearest palette member / replace) defines neither distance metric, tie-breaking, casing, duplicate handling, nor missing/empty colors -> Specify one pure normalization function with exact inputs, outputs, distance algorithm, tie-break order, and tests for every edge case.
- [FIX] Normalizing only hex values cannot guarantee persisted DNA "contains palette blue" when synthesis returns empty colorUsageRules or rules without colors -> Define a deterministic fallback that constructs at least one palette-derived rule when usable palette data exists.
- [FIX] Logo evidence threshold >=2 observations OR >=50% accepts a single observation at 100% -> Require explicit minimum observation count plus a majority threshold, and define ties and the denominator.
- [FIX] Logo post-processing does not specify whether synthesized positions are replaced, removed, or applied across multiple logoUsageRules -> Define one canonical derived position and deterministically overwrite or omit every synthesized preferredPosition.
- [FIX] Malformed-latest-palette handling still says only "log a warning" without deciding whether processing stops or falls back to an older palette -> Specify fail-closed, palette-absent, or older-version fallback explicitly and test it.
- [FIX] loadBrandPaletteText is not a single canonical downstream color source because creative QA and production-package generation still read persisted DNA colors directly -> Introduce a shared effective-color resolver used in every consumer, or prove persisted DNA and current palette cannot diverge.
- [FIX] Editing the authoritative palette after DNA generation changes layout/visual prompts but leaves creative QA and production-package colors stale -> Resolve current palette at every consumer or invalidate/re-run DNA on palette change.
- [FIX] Rock 3's proof still asserts prompt contents rather than generated layout colors -> Validate/normalize every generated layer/canvas color against the effective palette before persistence and assert the persisted layout.
- [DEFER] Provenance persistence correctly captured but remains necessary for reliable stale/fake DNA detection -> Keep as migration-backed follow-up rock.
- [FIX] Operational stale-DNA proof names only Yenisehir and does not define how all affected clients are identified without provenance -> Add a bounded deployment checklist identifying the complete affected-client set and recording rerun+approval.
- [DEFER] Dedicated contrast engine and render-image vision QA correctly separated -> Keep the QA limitation explicit; do not claim deterministic legibility is "preserved."
VERDICT: NOT YET

### Visionary response (Claude)
- ACCEPTED (normalization ambiguity) -> Plana "DETERMİNİSTİK SPEC" bölümü: color-normalize.ts saf modül (normalizeHex/colorDistance sRGB Öklid/nearestPaletteHex beraberlik=palet-order/normalizeColorsToPalette), tüm edge case unit-test.
- ACCEPTED (empty colorUsageRules fallback) -> Rock 2 adım 4: işlem sonrası palet rengi yoksa/boşsa başa "Marka ana renkleri (paletten)" fallback kuralı → ≥1 palet kuralı garanti.
- ACCEPTED (logo threshold çelişki) -> LOGO KONUM SPEC: |O|>=2 VE modal/|O|>0.5 (tek kazanan), denominator=logo bildiren referanslar, none/omit hariç.
- ACCEPTED (logo canonical/overwrite) -> SPEC: tek kanonik konum, tüm logoUsageRules preferredPosition üzerine yaz; güven yoksa hepsinde omit.
- ACCEPTED (malformed palette) -> Rock 2 adım 2: fail-closed palet-YOK (uyarı log), eskiye sessiz düşme yok.
- ACCEPTED (single canonical source) -> Rock 3: palet ÜRETİM ANINDA layout layer renklerine deterministik pişirilir + Rock 2 DNA'ya pişirir → persist edilen artefaktları okuyan downstream (QA/production/render) inşa gereği tutarlı; runtime resolver gerekmez.
- ACCEPTED (palette-edit staleness) -> operasyonel rerun (checklist); otomatik palet-edit invalidation → RF-ISSUES-DNA2.
- ACCEPTED (Rock 3 proof) -> Rock 3 proof: model off-palette hex döner → PERSIST edilen layout renkleri palete snap assert (prompt değil).
- DEFERRED (provenance) -> RF-ISSUES-DNA2 (Codex hemfikir).
- ACCEPTED (affected-client set) -> Plana "Stale/fake DNA deployment checklist": tüm design_dna client'ları listele + aktif küçük küme (Yenişehir/Turyap) rerun+approve kaydı.
- ACCEPTED (legibility dili) -> Rock 3: "preserved" iddiası kaldırıldı; F9 QA yalnız UYARI, tam contrast ENFORCE DEFER.

## Round 3
### Integrator findings (Codex, verbatim)
- [FIX] The shared color helpers do not define behavior when paletteHexes contains lowercase, shorthand, duplicate, or invalid entries -> Require palette canonicalization via normalizeHex, discard invalid, stable-deduplicate, define behavior when canonicalization leaves palette empty.
- [FIX] The fallback rule's "palette hexes in role order" is ambiguous (role precedence + within-role ordering unspecified) -> Define exact role order and preserve original asset order as within-role tie-break.
- [FIX] Rock 3 normalizes persisted layer colors but does not enumerate/traverse actual color-bearing fields, especially nested children -> Specify a pure recursive layout normalizer covering canvas.backgroundColor, textProperties.color, shapeProperties.fillColor, shapeProperties.strokeColor at every depth.
- [FIX] The logo spec loses a confidently derived position when synthesis returns empty logoUsageRules (no rule to overwrite) -> When threshold passes and no rule exists, deterministically add one canonical logo-position rule.
VERDICT: NOT YET

### Visionary response (Claude)
Layout renk alanları koddan doğrulandı (layout.ts:37 color, 59 fillColor, 60 strokeColor, 80 children z.lazy, 130 canvas.backgroundColor) — Codex alan adları birebir doğru.
- ACCEPTED (palette canonicalization) -> SPEC: canonicalizePalette(normalizeHex+invalid-drop+stable-dedupe); nearest/normalize her çağrıda önce kanonikleştirir; kanonik boş → no-op.
- ACCEPTED (fallback role order) -> SPEC: rol sırası primary→secondary→accent→background→text→other; aynı rolde orijinal asset sırası.
- ACCEPTED (recursive layout normalizer) -> "LAYOUT RENK NORMALİZER SPEC": saf recursive normalizeLayoutColors, canvas.backgroundColor + textProperties.color + shapeProperties.fill/strokeColor + children her derinlikte.
- ACCEPTED (logo empty rules) -> LOGO SPEC: güven varsa ve logoUsageRules boşsa tek kanonik kural EKLE.

## Round 4
### Integrator findings (Codex, verbatim)
All four Round-3 findings are closed with implementable, deterministic specifications. I found no genuinely new blocking issue; remaining gaps are appropriately recorded in RF-ISSUES-DNA2.md.
VERDICT: SAME PAGE

### Visionary response (Claude)
Meeting KAPANDI — SAME PAGE round 4 (4 tur, Codex toplam 33 bulgu: 28 kabul/işlendi, 3 defer RF-ISSUES-DNA2, 1 CLARIFY yanıtlandı, 1 KILL uygulandı). Plan implementable. BUILD A ROCK'a geç.
