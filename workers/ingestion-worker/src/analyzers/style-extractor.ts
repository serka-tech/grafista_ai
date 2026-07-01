import { ImageAnalysisResult } from './image-analyzer.js';

export class StyleExtractor {
  async extract(analysis: ImageAnalysisResult): Promise<unknown> {
    console.log('[StyleExtractor] Extracting style rules from analysis');
    return {
      dominantColors: analysis.dominantColors,
      layoutPattern: analysis.layoutPattern,
      visualMood: analysis.visualMood,
      extractedRules: [
        'Use centered layout composition',
        `Primary color: ${analysis.dominantColors[0]?.hex}`,
      ],
    };
  }
}
