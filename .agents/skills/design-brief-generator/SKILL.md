---
name: design-brief-generator
description: "Onaylanmış içerik fikrini ve müşterinin Design DNA'sını kullanarak yapılandırılmış tasarım brief'i üretir. Tetikleyici: 'brief oluştur', 'tasarım brief'i', 'design brief'"
---

# Design Brief Generator

Onaylanmış içerik fikri + Design DNA → yapılandırılmış DesignBrief.

## When to Use
- Bir content idea approved olduktan sonra
- Tasarımcıya talimat vermek gerektiğinde

## Input Expectations
- Onaylanmış ContentIdea ID
- Client'ın Design DNA'sı
- Brand Profile
- Platform boyut bilgisi

## Output Expectations
- DesignBrief JSON: title, objective, dimensions, contentElements, visualDirection, brandConstraints, aiImagePrompts, designerNotes

## Checklist
- [ ] Content idea approved mı? (Değilse → durdur)
- [ ] Design DNA yüklendi
- [ ] Platform boyutları doğru
- [ ] Tüm content elementleri dolduruldu
- [ ] Brand constraints uygulandı
- [ ] AI image prompt'ları oluşturuldu
- [ ] Brief draft olarak kaydedildi

## Failure Conditions
- Content idea approved değil
- Müşteri bulunamadı
- AI provider erişilemez (fallback: template-based brief)
