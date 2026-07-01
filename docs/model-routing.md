# Grafista AI Studio — Model Routing

## Provider Matrix

| Provider | Capabilities | Default Tasks | API Key Env |
|----------|-------------|---------------|-------------|
| OpenAI | text, vision, image_gen | brand_intake, style_analysis, content_ideation, design_brief, layout_generation, creative_qa, image_generation | `OPENAI_API_KEY` |
| Claude | text | tone_extraction, caption_generation, revision_learning | `ANTHROPIC_API_KEY` |
| Gemini | text, vision | (fallback for text/vision tasks) | `GEMINI_API_KEY` |
| KIE AI | video_generation | video_generation | `KIE_AI_API_KEY` |
| Higgsfield | video_generation | (fallback for video) | `HIGGSFIELD_API_KEY` |

## Routing Strategy

### Primary + Fallback Chains

```
brand_intake:     OpenAI → Claude → Gemini
style_analysis:   OpenAI → Gemini → Claude   (requires vision)
tone_extraction:  Claude → OpenAI → Gemini
content_ideation: OpenAI → Claude → Gemini
caption_gen:      Claude → OpenAI → Gemini
design_brief:     OpenAI → Claude → Gemini
layout_gen:       OpenAI → Claude
creative_qa:      OpenAI → Claude → Gemini   (benefits from vision)
revision_learning: Claude → OpenAI → Gemini
image_generation: OpenAI → KIE AI
video_generation: KIE AI → Higgsfield
```

### Selection Algorithm

1. If explicit provider specified in request → use it (if available)
2. Check routing table for task type → try primary provider
3. If primary unavailable → iterate fallback chain
4. If all unavailable → return mock response (MVP mode)

## Cost Optimization

- Use `gpt-4o-mini` for simpler tasks (caption, tone extraction)
- Use `gpt-4o` for complex analysis (style analysis, QA review)
- Use `claude-sonnet` for nuanced text generation
- Track usage via `AIResponse.usage` field
- Log cost estimates per request for budget monitoring

## Adding a New Provider

1. Create adapter in `packages/model-router/src/providers/`
2. Implement `ProviderAdapter` interface
3. Register in `ModelRouter` constructor
4. Add routing entry in `DEFAULT_ROUTING`
5. Add env variable to `.env.example`
