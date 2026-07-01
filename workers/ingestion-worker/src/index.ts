/**
 * Grafista AI Studio — Ingestion Worker
 * Analyzes uploaded brand and design files
 */

import { ImageAnalyzer } from './analyzers/image-analyzer.js';
import { BrandNormalizer } from './analyzers/brand-normalizer.js';
import { StyleExtractor } from './analyzers/style-extractor.js';

export interface IngestionJob {
  id: string;
  type: 'brand_asset' | 'design_reference';
  clientId: string;
  fileUrl: string;
  mimeType: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
  createdAt: string;
}

class IngestionWorker {
  private queue: IngestionJob[] = [];
  private imageAnalyzer = new ImageAnalyzer();
  private brandNormalizer = new BrandNormalizer();
  private styleExtractor = new StyleExtractor();

  async processJob(job: IngestionJob): Promise<void> {
    console.log(`[Ingestion] Processing ${job.type} for client ${job.clientId}`);
    job.status = 'processing';

    try {
      if (job.type === 'brand_asset') {
        job.result = await this.brandNormalizer.normalize(job.fileUrl, job.mimeType);
      } else {
        const analysis = await this.imageAnalyzer.analyze(job.fileUrl);
        job.result = await this.styleExtractor.extract(analysis);
      }
      job.status = 'completed';
    } catch (err) {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
    }
  }

  enqueue(job: Omit<IngestionJob, 'status' | 'createdAt'>): IngestionJob {
    const fullJob: IngestionJob = { ...job, status: 'queued', createdAt: new Date().toISOString() };
    this.queue.push(fullJob);
    return fullJob;
  }

  getStatus(): { queueLength: number; jobs: IngestionJob[] } {
    return { queueLength: this.queue.length, jobs: this.queue };
  }
}

export const ingestionWorker = new IngestionWorker();
console.log('🔄 Ingestion Worker initialized (MVP mode)');
