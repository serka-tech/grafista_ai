---
name: creative-director-qa
description: "Tasarım çıktılarına kapsamlı kalite kontrolü uygular: brand consistency, readability, mobile legibility, color contrast, vb. Tetikleyici: 'QA kontrolü', 'kalite kontrol', 'creative QA'"
---

# Creative Director QA

Tasarım çıktılarına 9 kategorilik QA kontrolü uygular.

## When to Use
- Layout plan oluşturulduktan sonra
- Final çıktı onayından önce
- Herhangi bir revision sonrası

## Input Expectations
- DesignBrief
- LayoutPlan (opsiyonel)
- BrandProfile
- Design DNA
- Preview image (opsiyonel)

## Output Expectations
- CreativeQAReport JSON:
  - overallScore (0-100)
  - overallStatus (passed/needs_revision/failed)
  - 9 check item: brandConsistency, readability, mobileLegibility, visualHierarchy, logoSafetyArea, colorContrast, spelling, clientStyleMatch, exportReadiness
  - criticalIssues[]
  - recommendations[]

## Checklist
- [ ] 9 QA kategorisi kontrol edildi
- [ ] Her check'e score (0-100) atandı
- [ ] Overall score hesaplandı
- [ ] Kritik sorunlar listelendi
- [ ] Düzeltme önerileri eklendi
- [ ] Report schema validasyonundan geçti

## Failure Conditions
- Brief bulunamadı
- AI provider erişilemez
- Report schema'ya uymuyor
