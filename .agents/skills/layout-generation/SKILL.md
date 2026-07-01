---
name: layout-generation
description: "Tasarım brief'inden katman bazlı layout JSON oluşturur. Photoshop/Figma talimatları için kullanılır. Tetikleyici: 'layout oluştur', 'katman planı', 'layout JSON'"
---

# Layout Generation

DesignBrief → LayoutPlan JSON (katmanlar, pozisyonlar, tipografi, renkler).

## When to Use
- Design brief tamamlandıktan sonra
- Photoshop/Figma üretimi öncesi

## Input Expectations
- DesignBrief ID
- Canvas boyutları
- Brand assets (logo URL, renk paleti, fontlar)

## Output Expectations
- LayoutPlan JSON: canvas settings, layers array, export settings
- Her layer: id, name, type, position, zIndex, type-specific properties

## Checklist
- [ ] Brief mevcut ve geçerli
- [ ] Canvas boyutları doğru
- [ ] Background layer ilk sırada
- [ ] Logo layer brand rules'a uygun pozisyonda
- [ ] Text layer'lar tipografi specs içeriyor
- [ ] Export settings tanımlı
- [ ] LayoutPlan schema validasyonundan geçti

## Failure Conditions
- Brief bulunamadı
- Canvas boyutları geçersiz
- AI provider yanıt vermedi
- Üretilen layout schema'ya uymuyor
