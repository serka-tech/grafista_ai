# RF-ISSUES-DNA2 — DNA vision rock'undan ertelenen bulgular

Same Page Meeting'de gerçek kabul edilen ama bu döngü DIŞI tutulan işler:

- **DEFER — Provenance persistligi:** her analysis + DNA sürümüne hangi provider/model + palet-asset/
  sürümü ürettiğini kaydet. Stale/fake veri tespitini güvenilir yapar ama şema migration ister →
  bu döngünün "migration yok" kısıtı dışında. Ayrı rock.
- **DEFER — Stale/fake onaylı DNA otomatik invalidation/backfill:** eski fake-üretilmiş onaylı DNA
  satırları kod düzelse de aktif kalıyor (rerun yeni ONAYSIZ sürüm yaratır). Bu döngüde OPERASYONEL
  çözülür (etkilenen müşteri için DNA rerun + yeni sürüm onayla, canlı doğrulamada yapılır); otomatik
  toplu invalidation/backfill aracı ayrı iş.
- **DEFER — Adanmış deterministik contrast/legibility motoru:** palet üyeliği zorlanınca okunmaz
  text/bg kombinasyonları olabilir. Bu döngüde mevcut F9 kontrast QA uyarısına güvenilir; tam
  deterministik contrast doğrulama + belgeli fallback politikası ayrı iş.
- **DEFER — Creative QA'nın render görseli üzerinde vision incelemesi:** creative_qa şu an render
  görseli göndermiyor (route bu döngüde `['text']`'e düzeltiliyor). Görsel-QA fazı gelince vision
  gereksinimi + gerçek render görseli birlikte geri eklenir.
- **DEFER — Palet-edit tetikli otomatik DNA/layout invalidation:** palet ÜRETİMDEN SONRA düzenlenince
  persist edilmiş DNA/layout renkleri eskir. Bu döngüde çözüm operasyonel (palet değişince DNA+layout
  rerun, deployment checklist). Palet metadata değişikliğinde otomatik invalidation/rerun tetikleyen
  mekanizma ayrı follow-up (muhtemelen provenance rock'uyla birlikte).
