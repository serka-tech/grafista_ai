---
name: approval-gate
description: "İçerik fikirlerinin ve tasarım çıktılarının onay sürecini yönetir. Onay olmadan brief üretilemez. Tetikleyici: 'onayla', 'reddet', 'approve', 'reject'"
---

# Approval Gate

Onay akışını yönetir. Sistem, onaylanmamış içerik fikri için tasarım brief'i oluşturmaz.

## When to Use
- İçerik fikri üretildikten sonra
- Tasarım brief'i tamamlandıktan sonra
- Final çıktı review'dan önce

## Input Expectations
- Entity type (content_idea / design_brief / generated_output)
- Entity ID
- Aksiyon: approve / reject / revision_requested
- Reviewer role ve notes

## Output Expectations
- ApprovalRecord JSON
- Entity status güncellenmesi
- Rejection durumunda: revisionNotes

## Checklist
- [ ] Entity mevcut ve doğru tipte
- [ ] Onay/red aksiyonu geçerli
- [ ] Reviewer bilgisi kaydedildi
- [ ] Entity status güncellendi
- [ ] Brief oluşturma için approved kontrol edildi
- [ ] Final output için QA + approval kontrol edildi

## Failure Conditions
- Entity bulunamadı
- Zaten onaylanmış entity tekrar onaylanmaya çalışılıyor
- Brief oluşturma, onaylanmamış fikir için denenirse → 403
