---
name: revision-learning
description: "Kullanıcı geri bildirimlerinden tasarım kuralları çıkarıp Design DNA'yı günceller. Tetikleyici: 'revizyondan öğren', 'feedback işle', 'revision learning'"
---

# Revision Learning

Kullanıcı geri bildirimlerinden kurallar çıkarıp müşterinin Design DNA'sını zenginleştirir.

## When to Use
- Bir içerik fikri reddedildiğinde (rejection reason'dan kural çıkar)
- Tasarım brief'e revizyon geldiğinde
- Onay notlarında preference belirtildiğinde

## Input Expectations
- Yeni feedback metni
- Entity type ve ID
- Client ID
- Mevcut RevisionMemory (varsa)

## Output Expectations
- Güncellenmiş RevisionMemory JSON
- Extracted rules (do/dont/prefer/avoid)
- Approval patterns güncelleme

## Checklist
- [ ] Feedback analiz edildi
- [ ] Kurallar çıkarıldı (rule type + confidence)
- [ ] Mevcut memory ile birleştirildi
- [ ] Çakışan kurallar flaglendi
- [ ] Design DNA'ya uygulandı (appliedToDNA: true)

## Failure Conditions
- Feedback boş
- AI provider erişilemez
- Çıkarılan kurallar schema'ya uymuyor
