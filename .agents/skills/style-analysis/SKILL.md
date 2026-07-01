---
name: style-analysis
description: "Yüklenen referans tasarımları AI ile analiz edip stil özelliklerini çıkarır (renk, tipografi, layout, mood). Tetikleyici: 'tasarımı analiz et', 'stil çıkar', 'referans analizi'"
---

# Style Analysis

Her yüklenen referans tasarımın görsel özelliklerini AI vision modeli ile analiz eder.

## When to Use
- Yeni referans tasarım yüklendiğinde
- Design DNA güncellenmesi gerektiğinde
- Müşterinin stil tercihlerini anlamak için

## Input Expectations
- Tasarım görseli (PNG/JPG)
- Müşteri bağlamı (marka profili)
- Opsiyonel: tasarım açıklaması ve etiketler

## Output Expectations
- StyleAnalysis JSON: format, aspect ratio, dominant colors, typography hierarchy, logo position, image treatment, background style, text density, CTA style, layout pattern, visual mood, brand consistency notes, reusable design rules

## Checklist
- [ ] Görsel dosya erişilebilir
- [ ] AI vision modeli çağrıldı
- [ ] En az 3 dominant renk çıkarıldı
- [ ] Layout pattern sınıflandırıldı
- [ ] Tipografi hiyerarşisi belirlendi
- [ ] Confidence score atandı
- [ ] StyleAnalysis schema'dan geçti

## Failure Conditions
- Görsel dosya okunamıyor
- AI vision modeli erişilemez
- Analiz sonucu schema'ya uymuyor
- Confidence < 0.3 (çok düşük güven — uyar)
