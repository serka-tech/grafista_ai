import { ProviderAdapter, AICapability, AIRequest, AIResponse } from '../types.js';

/**
 * Fake Provider Adapter (offline demo mode)
 *
 * Returns deterministic, schema-valid canned responses for every AI task the
 * dashboard demo chain needs — zero network calls, zero API keys, zero
 * randomness. Exists so a new developer can run the full demo pipeline
 * (DesignDNA analyze -> content ideas -> layout generation -> Creative QA ->
 * visual generation -> production package -> render) on a laptop with no real
 * OpenAI/Anthropic/Kie credentials.
 *
 * Enabling: the SINGLE switch is `AI_DEFAULT_PROVIDER=fake`. isAvailable()
 * reads process.env at CALL time (not in the constructor, unlike the real
 * adapters) — deliberate, so the adapter stays dead in any environment that
 * didn't opt in regardless of module-load order, and so ModelRouter's
 * selection loop skips it cleanly everywhere else. When disabled, complete()
 * resolves to a structured { success: false } configuration error.
 *
 * Contract mirrors OpenAIAdapter/KieAIAdapter exactly: complete() NEVER
 * throws, `content` is a JSON string the calling service parses and validates
 * against the real @grafista/schemas zod schemas. The canned payloads below
 * are copied from the proven MockModelRouter fixtures in
 * apps/api/src/__tests__/render-jobs.test.ts (which the whole API test suite
 * validates end to end), with two demo-friendly adaptations: the creative_qa
 * verdict PASSES (score 88 >= the 75 threshold, no high-priority fixes) so
 * the chain proceeds without a human override, and image_generation returns
 * real, decodable PNG bytes instead of garbage.
 */

/** Constant latencyMs/usage so responses are fully deterministic (no Date math). */
const FAKE_LATENCY_MS = 5;
const FAKE_MODEL = 'fake-canned-v1';
const FAKE_USAGE = { inputTokens: 120, outputTokens: 60, totalTokens: 180, estimatedCost: 0 };

/**
 * A real 64x64 solid leaf-green (#6B9B37) PNG, base64-encoded (136 bytes) —
 * generated once with Node's zlib and embedded as a constant. It decodes to a
 * valid image (PNG magic header + IHDR/IDAT/IEND) so everything downstream of
 * visual generation (storage writes, previews, production packages) handles
 * genuine image bytes.
 */
const LEAF_GREEN_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAT0lEQVR42u3PQQkAAAgEsGtlKCNZ1gi+hcEKLD31WgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQELgtzt9Ee5/QCxAAAAABJRU5ErkJggg==';

/** Same construction, solid forest green (#2D5016), 64x64 (137 bytes) — second visual alternative. */
const FOREST_GREEN_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAUElEQVR42u3PQQkAAAgEsEthC7vYP40RfAuDFVh66rUICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICFwWncwwiHY52NAAAAAASUVORK5CYII=';

/** Parsed by design-dna-analysis.ts against StyleAnalysisSchema (after the service adds id/designReferenceId/analyzedAt). */
const STYLE_ANALYSIS_CONTENT = {
  format: 'square',
  aspectRatio: '1:1',
  dominantColors: [
    { hex: '#2D5016', percentage: 55 },
    { hex: '#FAF5EB', percentage: 45 },
  ],
  typographyHierarchy: { headingStyle: 'Playfair Display Bold, 36pt', bodyStyle: 'Inter Regular, 14pt' },
  logoPosition: 'top-left',
  imageTreatment: 'Sıcak doğal ışık, filtre yok',
  backgroundStyle: 'Düz krem arka plan',
  textDensity: 'low',
  ctaStyle: 'Yuvarlak hap buton, yaprak yeşili',
  layoutPattern: 'centered',
  visualMood: 'organic',
  brandConsistencyNotes: 'Referans boyunca tutarlı toprak tonu paleti',
  reusableDesignRules: ['Sıcak doğal ışık kullan', 'Metin yoğunluğunu düşük tut'],
  designCategory: 'post',
  confidence: 0.9,
};

/** Parsed by design-dna-analysis.ts against DesignDNAContentSchema. */
const DESIGN_DNA_CONTENT = {
  brandPersonality: ['özgün', 'sıcak', 'güvenilir'],
  preferredLayouts: ['centered'],
  visualRules: [{ rule: 'Tüm fotoğraflarda sıcak doğal ışık kullan', source: 'analysis', confidence: 0.9 }],
  typographyRules: [{ rule: 'Başlıklar: Playfair Display Bold', example: '36pt' }],
  colorUsageRules: [{ rule: 'Ana renk toprak yeşili', colors: ['#2D5016'] }],
  logoUsageRules: [{ rule: 'Logo sol üstte', preferredPosition: 'top-left' }],
  imageTreatmentRules: [{ rule: 'Yapay filtre yok, sadece doğal ışık' }],
  contentTone: { primary: 'samimi', secondary: 'bilgilendirici', keywords: ['taze', 'organik'], examples: [] },
  avoidList: ['neon renkler', 'jenerik stok fotoğraflar'],
  confidenceScore: 0.88,
};

/** Leniently mapped by content-ideation.ts (plain array of idea objects, no zod schema). */
const CONTENT_IDEATION_CONTENT = [
  {
    title: 'Taze Hasat Duyurusu',
    description: 'Yeni mevsim hasadını sıcak, doğal görsellerle duyur.',
    format: 'single_image',
    hook: 'Tarladan doğrudan sofranıza',
    caption: 'Yeni hasadımız geldi.',
    hashtags: ['#taze', '#yerel'],
    callToAction: 'Hemen al',
    toneOfVoice: 'samimi',
    visualDirection: 'parlak, doğal ışık',
  },
  {
    title: 'Üreticilerle Tanışın',
    description: 'Ürünün arkasındaki insanları tanıtarak özgün güven oluştur.',
    format: 'single_image',
    hook: 'Yemeğinizi yetiştiren eller',
    caption: 'Her sepet, özenle çalışan bir üreticiyle başlar.',
    hashtags: ['#organik', '#topluluk'],
    callToAction: 'Hikayelerini oku',
    toneOfVoice: 'sıcak',
    visualDirection: 'altın saat tarla ışığında portre',
  },
  {
    title: 'Sıfır Atık Mutfak İpuçları',
    description: 'Mevsimlik malzemelerle pratik sürdürülebilirlik ipuçları paylaş.',
    format: 'single_image',
    hook: 'Son yaprağa kadar değerlendir',
    caption: 'Bu hafta mutfağınızda daha az israf için üç basit yol.',
    hashtags: ['#sıfıratık', '#sürdürülebilir'],
    callToAction: 'Bu gönderiyi kaydet',
    toneOfVoice: 'bilgilendirici',
    visualDirection: 'krem arka planda sebzelerin düz çekimi',
  },
];

/** One layout alternative; each item is parsed against LayoutPlanContentSchema by layout-generation.ts. */
function layoutAlternative(index: number) {
  return {
    format: 'instagram_post',
    canvas: { width: 1080, height: 1080, backgroundColor: '#FFFFFF', dpi: 72 },
    layers: [
      {
        id: `bg-${index}`,
        name: 'Background',
        type: 'background',
        position: { x: 0, y: 0, width: 1080, height: 1080 },
        zIndex: 0,
      },
      {
        id: `headline-${index}`,
        name: 'Headline',
        type: 'text',
        position: { x: 80, y: 120, width: 920, height: 200 },
        zIndex: 10,
        textProperties: { content: 'Taze ve Doğal', fontFamily: 'Playfair Display', fontSize: 64, color: '#2D5016' },
      },
      {
        id: `logo-${index}`,
        name: 'Logo',
        type: 'logo',
        position: { x: 40, y: 40, width: 120, height: 120 },
        zIndex: 20,
      },
    ],
    gridStructure: { columns: 12, gutter: 24, description: '12-column grid' },
    safeZones: [],
    headlinePlacement: { layerId: `headline-${index}`, position: { x: 80, y: 120, width: 920, height: 200 } },
    logoPlacement: { layerId: `logo-${index}`, position: { x: 40, y: 40, width: 120, height: 120 } },
    colorUsageNotes: 'Krem arka plan üzerine toprak yeşili',
    typographyNotes: 'Başlıkta Playfair Display, gövdede Inter',
    exportSettings: { formats: ['png'], quality: 90, scaleFactor: 1 },
    referenceDesignIds: [],
    designDnaRulesUsed: index === 1 ? ['Tüm fotoğraflarda sıcak doğal ışık kullan'] : [],
    designerNotes: `Alternatif ${index}`,
  };
}

/** 2 alternatives — within layout-generation.ts's accepted 2-3 range. */
const LAYOUT_GENERATION_CONTENT = [layoutAlternative(1), layoutAlternative(2)];

function scoredCheck(category: string, checkName: string, score: number) {
  return {
    category,
    checkName,
    status: score >= 80 ? 'pass' : score >= 50 ? 'warn' : 'fail',
    score,
    details: `${checkName} gözlemleri`,
    ...(score < 80 ? { suggestion: `${checkName} iyileştir` } : {}),
  };
}

/**
 * Parsed by creative-qa.ts against CreativeQAReportContentSchema. Deliberately a
 * PASSING verdict (88 >= DEFAULT_PASS_THRESHOLD 75, zero high-priority fixes) so
 * the demo chain can proceed to production on 'passed' without a human override.
 */
const CREATIVE_QA_CONTENT = {
  overallScore: 88,
  overallStatus: 'passed',
  checks: [],
  brandConsistency: scoredCheck('brand', 'Brand Consistency', 88),
  readability: scoredCheck('text', 'Readability', 88),
  mobileLegibility: scoredCheck('text', 'Mobile Legibility', 88),
  visualHierarchy: scoredCheck('layout', 'Visual Hierarchy', 88),
  logoSafetyArea: scoredCheck('logo', 'Logo Safety Area', 88),
  colorContrast: scoredCheck('color', 'Color Contrast', 88),
  spelling: scoredCheck('text', 'Spelling', 100),
  designDnaMatch: scoredCheck('brand', 'DesignDNA Match', 88),
  exportReadiness: scoredCheck('export', 'Export Readiness', 88),
  typographyConsistency: scoredCheck('typography', 'Typography Consistency', 88),
  contentClarity: scoredCheck('content', 'Content Clarity', 88),
  summary: 'Deterministik demo incelemesi — yerleşim onaylı brief ve DesignDNA ile uyumlu.',
  detectedIssues: [],
  highPriorityFixes: [],
  mediumPriorityFixes: [],
  lowPriorityFixes: ['Başlık harf aralığını hafifçe sıkılaştırmayı düşün'],
  designerNotes: 'Genel kompozisyon sağlam.',
  finalRecommendation: 'Olduğu gibi onayla',
  designDnaReasons: ['Yerleşim, sıcak doğal ışık görsel kuralını izledi'],
  designBriefReasons: ['Başlık metni onaylı brief kancasıyla eşleşiyor'],
  risksBeforeProduction: [],
};

/** Parsed by visual-generation.ts against VisualGenerationPayloadSchema — two real 64x64 PNG alternatives. */
const IMAGE_GENERATION_CONTENT = {
  images: [
    { imageBase64: LEAF_GREEN_PNG_BASE64, mimeType: 'image/png', width: 64, height: 64 },
    { imageBase64: FOREST_GREEN_PNG_BASE64, mimeType: 'image/png', width: 64, height: 64 },
  ],
};

/** taskType -> canned payload. Anything not listed gets a structured "no canned response" failure. */
const CANNED_CONTENT: Partial<Record<AIRequest['taskType'], unknown>> = {
  style_analysis: STYLE_ANALYSIS_CONTENT,
  design_dna_synthesis: DESIGN_DNA_CONTENT,
  content_ideation: CONTENT_IDEATION_CONTENT,
  layout_generation: LAYOUT_GENERATION_CONTENT,
  creative_qa: CREATIVE_QA_CONTENT,
  image_generation: IMAGE_GENERATION_CONTENT,
};

export class FakeAIAdapter implements ProviderAdapter {
  name = 'fake' as const;
  // Covers every demo taskType (text prompts, vision-based style analysis, image
  // generation). Deliberately NOT video_generation — the demo chain doesn't need it.
  capabilities: AICapability[] = ['text', 'vision', 'image_generation'];

  /**
   * Read process.env at CALL time (not the constructor) so enablement never
   * depends on module-load order, and so production — where AI_DEFAULT_PROVIDER
   * is 'openai' or 'claude' — provably never selects this adapter.
   */
  isAvailable(): boolean {
    return process.env.AI_DEFAULT_PROVIDER === 'fake';
  }

  private failure(request: AIRequest, error: string): AIResponse {
    return {
      success: false,
      provider: 'fake',
      model: request.model ?? FAKE_MODEL,
      content: '',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: FAKE_LATENCY_MS,
      error,
    };
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    if (!this.isAvailable()) {
      return this.failure(
        request,
        'Provider configuration error: fake provider is not enabled (set AI_DEFAULT_PROVIDER=fake to use the offline demo mode)'
      );
    }

    const content = CANNED_CONTENT[request.taskType];
    if (content === undefined) {
      return this.failure(request, `Fake provider has no canned response for task type "${request.taskType}"`);
    }

    return {
      success: true,
      provider: 'fake',
      model: FAKE_MODEL,
      content: JSON.stringify(content),
      usage: { ...FAKE_USAGE },
      latencyMs: FAKE_LATENCY_MS,
    };
  }
}
