---
name: content-strategy
description: "Müşterinin Design DNA'sı ve marka profiline uygun içerik fikirleri üretir. Tetikleyici: 'içerik fikri üret', 'content strategy', 'kampanya önerisi'"
---

# Content Strategy

Brand DNA ve marka profiline dayalı platform-spesifik içerik fikirleri üretir.

## When to Use
- Yeni kampanya planlanırken
- Düzenli içerik takvimi oluştururken
- Belirli bir platform için fikir gerektiğinde

## Input Expectations
- Client ID
- Platform (instagram_post, story, carousel, vb.)
- Opsiyonel: konu, kampanya adı, hedef kitle, mood
- Kaç seçenek üretileceği (varsayılan: 3)

## Output Expectations
- ContentOption[] dizisi (her biri ContentIdea + reasoning + brand alignment score)
- Her fikir: başlık, açıklama, hook, caption, hashtag'ler, CTA, visual direction, AI image prompt
- Fikirler birbirinden farklı açılar/yaklaşımlar sunmalı

## Checklist
- [ ] Design DNA yüklendi
- [ ] Brand profili kontrol edildi
- [ ] Platform boyutları ve kuralları uygulandı
- [ ] İstenen sayıda seçenek üretildi
- [ ] Her seçenek marka kurallarına uygun
- [ ] Yasaklı öğeler kullanılmadı
- [ ] Fikirler pending_approval olarak kaydedildi

## Failure Conditions
- Müşteri bulunamadı
- Design DNA yok (uyarı ver, yine de üret)
- AI provider yanıt vermedi
- Üretilen fikirler schema validasyonundan geçmedi
