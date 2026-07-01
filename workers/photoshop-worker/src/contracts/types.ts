export interface PSDGenerationRequest {
  layoutPlanId: string;
  layoutPlan: unknown; // LayoutPlan JSON
  clientId: string;
  designBriefId: string;
  exportSettings: {
    formats: string[];
    quality: number;
    scaleFactor: number;
  };
}

export interface PSDGenerationResult {
  success: boolean;
  status: 'completed' | 'failed' | 'pending' | 'not_implemented';
  psdFileUrl?: string;
  previewImageUrl?: string;
  exportFileUrls?: Record<string, string>;
  errorReport?: {
    code: string;
    message: string;
    details?: string;
  };
  generationTimeMs?: number;
}

export interface ExportConfig {
  format: 'png' | 'jpg' | 'webp' | 'pdf' | 'psd' | 'svg';
  quality: number;
  scaleFactor: number;
  colorProfile?: string;
}
