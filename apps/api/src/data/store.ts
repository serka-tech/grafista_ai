/**
 * Grafista AI Studio — In-Memory Data Store (MVP)
 *
 * Replaces PostgreSQL in MVP phase.
 * All data is stored in memory and reset on restart.
 * Pre-loaded with sample Flavora Organic client data.
 */

import { v4 as uuid } from 'uuid';

export interface StoreClient {
  id: string;
  name: string;
  slug: string;
  industry?: string;
  website?: string;
  contactName?: string;
  contactEmail?: string;
  status: 'active' | 'paused' | 'archived';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoreBrandAsset {
  id: string;
  clientId: string;
  type: string;
  name: string;
  fileUrl?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface StoreDesignReference {
  id: string;
  clientId: string;
  name: string;
  description?: string;
  fileUrl?: string;
  thumbnailUrl?: string;
  tags: string[];
  isApproved: boolean;
  analysisId?: string;
  uploadedAt: string;
}

export interface StoreContentIdea {
  id: string;
  clientId: string;
  campaignName?: string;
  title: string;
  description: string;
  platform: string;
  format: string;
  hook?: string;
  caption?: string;
  hashtags: string[];
  callToAction?: string;
  toneOfVoice?: string;
  visualDirection?: string;
  aiImagePrompt?: string;
  status: string;
  generatedBy: string;
  approvalId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoreApproval {
  id: string;
  entityType: string;
  entityId: string;
  clientId: string;
  status: string;
  reviewerRole?: string;
  reviewerName?: string;
  notes?: string;
  revisionNotes?: string;
  approvedAt?: string;
  rejectedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoreDesignBrief {
  id: string;
  clientId: string;
  contentIdeaId: string;
  approvalId: string;
  title: string;
  objective: string;
  platform: string;
  format: string;
  dimensions: { width: number; height: number; unit: string };
  contentElements: Record<string, unknown>;
  visualDirection: Record<string, unknown>;
  brandConstraints: Record<string, unknown>;
  aiImagePrompts: unknown[];
  designerNotes?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

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

class DataStore {
  clients: Map<string, StoreClient> = new Map();
  brandAssets: Map<string, StoreBrandAsset> = new Map();
  designReferences: Map<string, StoreDesignReference> = new Map();
  contentIdeas: Map<string, StoreContentIdea> = new Map();
  approvals: Map<string, StoreApproval> = new Map();
  designBriefs: Map<string, StoreDesignBrief> = new Map();
  designDNA: Map<string, StoreDesignDNA> = new Map();

  constructor() {
    this.loadSampleData();
  }

  private loadSampleData() {
    const now = new Date().toISOString();
    const clientId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    // Sample client
    this.clients.set(clientId, {
      id: clientId,
      name: 'Flavora Organic',
      slug: 'flavora-organic',
      industry: 'Organic Food & Beverage',
      website: 'https://flavora-organic.com',
      contactName: 'Ayşe Kaya',
      contactEmail: 'ayse@flavora-organic.com',
      status: 'active',
      notes: 'Premium organic food brand. Focus on healthy, sustainable living.',
      createdAt: now,
      updatedAt: now,
    });

    // Brand assets
    const assets = [
      { type: 'logo', name: 'Flavora Primary Logo' },
      { type: 'logo_variant', name: 'Flavora Icon Only' },
      { type: 'color_palette', name: 'Primary Color Palette' },
      { type: 'font', name: 'Playfair Display' },
      { type: 'font', name: 'Inter' },
    ];
    for (const asset of assets) {
      const id = uuid();
      this.brandAssets.set(id, { id, clientId, ...asset, createdAt: now });
    }

    // Design references
    const refs = [
      { name: 'Instagram Post — Summer Harvest', description: 'Square post featuring fresh vegetables', tags: ['instagram', 'summer'] },
      { name: 'Instagram Story — Recipe Tips', description: 'Vertical story with recipe overlay', tags: ['instagram', 'story'] },
      { name: 'Instagram Carousel — Farm to Table', description: '5-slide carousel', tags: ['instagram', 'carousel'] },
    ];
    for (const ref of refs) {
      const id = uuid();
      this.designReferences.set(id, { id, clientId, ...ref, isApproved: true, uploadedAt: now });
    }

    // Content ideas
    const ideas = [
      {
        id: 'e1a1a1a1-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        title: 'Fresh From the Farm — Summer Edition',
        description: 'Showcase summer seasonal products with vibrant photography',
        platform: 'instagram_post',
        format: 'single_image',
        hook: 'The freshest flavors of summer are here 🌿',
        status: 'approved',
        campaignName: 'Summer Harvest Campaign',
      },
      {
        id: 'e2b2b2b2-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        title: 'Behind the Scenes — Our Organic Farm',
        description: 'Visual journey through organic farming process',
        platform: 'instagram_carousel',
        format: 'carousel',
        hook: 'Ever wondered where your food really comes from? 🌱',
        status: 'pending_approval',
        campaignName: 'Summer Harvest Campaign',
      },
      {
        id: 'e3c3c3c3-cccc-cccc-cccc-cccccccccccc',
        title: 'Quick Recipe — Summer Smoothie Bowl',
        description: 'Short recipe story showing healthy smoothie bowl',
        platform: 'instagram_story',
        format: 'story',
        hook: '2 minutes to your healthiest breakfast 🥤',
        status: 'draft',
      },
    ];
    for (const idea of ideas) {
      this.contentIdeas.set(idea.id, {
        ...idea,
        clientId,
        hashtags: ['FlavoraOrganic'],
        generatedBy: 'ai',
        createdAt: now,
        updatedAt: now,
      });
    }

    // Design DNA
    const dnaId = uuid();
    this.designDNA.set(dnaId, {
      id: dnaId,
      clientId,
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
}

export const store = new DataStore();
