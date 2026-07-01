---
name: model-routing
description: "AI görevlerini uygun provider'a yönlendirir (OpenAI, Gemini, Claude, KIE AI, Higgsfield). Fallback zincirleri ve maliyet optimizasyonu. Tetikleyici: 'AI model seç', 'provider yönlendir', 'model routing'"
---

# Model Routing

AI görevlerini capability ve availability'ye göre en uygun provider'a yönlendirir.

## When to Use
- Her AI çağrısında otomatik çalışır
- Provider ekleme/çıkarma yapıldığında
- Maliyet optimizasyonu gerektiğinde

## Input Expectations
- AIRequest: taskType, provider (opsiyonel), model (opsiyonel), prompts, outputFormat
- Mevcut provider konfigürasyonları

## Output Expectations
- AIResponse: provider, model, content, usage stats, latency, error
- Otomatik fallback zinciri denemesi

## Checklist
- [ ] Task type routing tablosunda var
- [ ] Primary provider kontrol edildi
- [ ] Available değilse fallback'e geçildi
- [ ] Max retry uygulandı
- [ ] Usage/maliyet loglandı
- [ ] Response schema validasyonundan geçti

## Failure Conditions
- Hiçbir provider erişilemez (mock response döner)
- Tüm retry'lar başarısız
- Timeout (30s varsayılan)
