---
name: brand-intake
description: "Müşterinin ham marka bilgilerini (logo, renkler, fontlar, notlar, kurallar) alıp normalize edilmiş bir BrandProfile oluşturur. Tetikleyici: 'marka bilgilerini normalize et', 'brand intake yap', 'marka profili oluştur'"
---

# Brand Intake

Müşteri marka varlıklarını ve bilgilerini alıp yapılandırılmış bir BrandProfile'a dönüştürür.

## When to Use
- Yeni müşteri eklendiğinde
- Marka bilgileri güncellendiğinde
- Logo, renk paleti, font veya marka kuralları yüklendiğinde

## Input Expectations
- Müşteri adı ve sektör bilgisi
- Ham marka notları (serbest metin)
- Logo dosyaları (PNG/SVG)
- Renk kodları (hex/RGB)
- Font isimleri ve kullanım alanları
- Marka kuralları ve yasaklar

## Output Expectations
- Yapılandırılmış BrandProfile JSON
- Normalize edilmiş renk paleti (hex + usage)
- Sınıflandırılmış font listesi (heading/body/accent)
- Marka kişilik özellikleri listesi
- Tone-of-voice anahtar kelimeleri
- Forbidden elements listesi

## Checklist
- [ ] Tüm renkler hex formatına çevrildi
- [ ] Fontlar kullanım alanlarıyla eşleştirildi
- [ ] Marka kişiliği en az 3 özellik içeriyor
- [ ] Yasaklı öğeler listesi oluşturuldu
- [ ] BrandProfile schema validasyonundan geçti

## Failure Conditions
- Müşteri adı boş
- Hiçbir renk veya font bilgisi yok
- Schema validasyonu başarısız
- AI provider erişilemez (fallback: manual normalization)
