export class BrandNormalizer {
  async normalize(fileUrl: string, mimeType: string): Promise<unknown> {
    console.log(`[BrandNormalizer] Normalizing: ${fileUrl} (${mimeType})`);
    return { normalized: true, fileUrl, mimeType, message: 'Mock normalization — connect AI for real processing' };
  }
}
