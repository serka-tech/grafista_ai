/**
 * Grafista AI Studio — S3-Compatible Storage Provider
 *
 * Works against real AWS S3 or any S3-compatible endpoint (MinIO, Cloudflare
 * R2, Backblaze B2, etc.) via the standard aws-sdk v3 client, configured
 * entirely from env vars (see ./factory.ts). Never falls back to local disk —
 * any failure here is surfaced as a StorageError with a clear message.
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageError, type ObjectAccess, type StorageProvider, type StoredObjectRef } from './types.js';

export interface S3ProviderConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

/** Time-limited signed download URL validity. */
const SIGNED_URL_EXPIRY_SECONDS = 300;

export class S3StorageProvider implements StorageProvider {
  readonly name = 's3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3ProviderConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint || undefined,
      forcePathStyle: config.forcePathStyle ?? false,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async putObject({ key, body, contentType }: { key: string; body: Buffer; contentType: string }): Promise<StoredObjectRef> {
    try {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType })
      );
    } catch (err) {
      throw new StorageError(`S3 upload failed: ${(err as Error).message}`, 502);
    }
    return { provider: 's3', bucket: this.bucket, key };
  }

  async getObjectAccess({ key, filename }: { key: string; filename: string; contentType?: string }): Promise<ObjectAccess> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, '')}"`,
      });
      const url = await getSignedUrl(this.client, command, { expiresIn: SIGNED_URL_EXPIRY_SECONDS });
      return { kind: 'redirect', url };
    } catch (err) {
      throw new StorageError(`S3 signed URL generation failed: ${(err as Error).message}`, 502);
    }
  }
}
