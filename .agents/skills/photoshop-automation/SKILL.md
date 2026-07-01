---
name: photoshop-automation
description: "LayoutPlan JSON'ı alıp Photoshop UXP üzerinden düzenlenebilir PSD dosyası üretir. Phase 2 — şu an placeholder. Tetikleyici: 'PSD üret', 'Photoshop automation', 'PSD oluştur'"
---

# Photoshop Automation (Phase 2)

LayoutPlan JSON → Adobe Photoshop UXP → editable PSD file.

## When to Use
- Layout plan onaylandıktan sonra
- Tasarımcı düzenlenebilir PSD istediğinde

## Input Expectations
- LayoutPlan JSON
- Client ID, DesignBrief ID
- Export settings (format, quality, scale)

## Output Expectations
- PSDGenerationResult:
  - success: boolean
  - status: completed/failed/pending/not_implemented
  - psdFileUrl
  - previewImageUrl
  - exportFileUrls
  - errorReport

## Checklist
- [ ] LayoutPlan geçerli
- [ ] Photoshop UXP bağlantısı aktif (Phase 2)
- [ ] Document boyutları doğru
- [ ] Tüm layer'lar oluşturuldu
- [ ] Export formatları üretildi

## Failure Conditions
- Photoshop UXP bağlantısı yok (Phase 2 placeholder döner)
- LayoutPlan schema'ya uymuyor
- Photoshop script hatası
