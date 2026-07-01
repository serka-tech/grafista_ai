/**
 * Grafista AI Studio — Design DNA (in-memory, intentionally NOT migrated)
 *
 * DesignDNA vision analysis and its persistence are explicitly out of scope
 * for this PostgreSQL migration step (Phase 2 Step 1). This module preserves
 * the exact Phase 1 in-memory behavior — reseeded on every process start —
 * so /design-dna and content-ideas prompt building keep working unchanged.
 */

import { v4 as uuid } from 'uuid';

export interface StoreDesignDNA {
  id: string;
  clientId: string;
  version: number;
  brandPersonality: string[];
  preferredLayouts: string[];
  visualRules: unknown[];
  typographyRules: unknown[];
  colorUsageRules: unknown[];
  logoUsageRules: unknown[];
  contentTone: Record<string, unknown>;
  avoidList: string[];
  sourceAnalysisCount: number;
  createdAt: string;
  lastUpdatedAt: string;
}

const SAMPLE_CLIENT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

export class DesignDnaStore {
  private byId: Map<string, StoreDesignDNA> = new Map();

  constructor() {
    this.seed();
  }

  private seed() {
    const now = new Date().toISOString();
    const dnaId = uuid();
    this.byId.set(dnaId, {
      id: dnaId,
      clientId: SAMPLE_CLIENT_ID,
      version: 1,
      brandPersonality: ['authentic', 'warm', 'earthy', 'trustworthy', 'fresh', 'premium'],
      preferredLayouts: ['centered', 'minimal', 'full-bleed'],
      visualRules: [
        { rule: 'Use natural, warm lighting in all photography', source: 'analysis', confidence: 0.9 },
        { rule: 'Maintain earthy color palette — greens, browns, cream', source: 'analysis', confidence: 0.95 },
        { rule: 'Typography: Playfair Display for headings, Inter for body', source: 'manual', confidence: 1.0 },
      ],
      typographyRules: [
        { rule: 'Headings: Playfair Display Bold, 24-48pt' },
        { rule: 'Body: Inter Regular, 14-16pt' },
        { rule: 'Maximum 2 font families per design' },
      ],
      colorUsageRules: [
        { rule: 'Primary: Forest Green #2D5016 for key elements', colors: ['#2D5016'] },
        { rule: 'Background: Cream White #FAF5EB', colors: ['#FAF5EB'] },
        { rule: 'CTA: Leaf Green #6B9B37', colors: ['#6B9B37'] },
      ],
      logoUsageRules: [
        { rule: 'Logo in top-left or bottom-center', preferredPosition: 'top-left' },
        { rule: 'Minimum clear space: 2x logo height' },
      ],
      contentTone: {
        primary: 'friendly',
        secondary: 'informative',
        keywords: ['fresh', 'organic', 'natural', 'sustainable', 'healthy'],
      },
      avoidList: ['neon colors', 'artificial food', 'generic stock photos', 'aggressive sales language'],
      sourceAnalysisCount: 3,
      createdAt: now,
      lastUpdatedAt: now,
    });
  }

  findByClientId(clientId: string): StoreDesignDNA | undefined {
    return Array.from(this.byId.values()).find((d) => d.clientId === clientId);
  }

  hasForClient(clientId: string): boolean {
    return this.findByClientId(clientId) !== undefined;
  }
}

export const designDnaStore = new DesignDnaStore();
