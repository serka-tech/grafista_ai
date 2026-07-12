/**
 * Grafista AI Studio — S3-Compatible Storage Provider
 *
 * Works against real AWS S3 or any S3-compatible endpoint (MinIO, Cloudflare
 * R2, Backblaze B2, etc.) via the standard aws-sdk v3 client, configured
 * entirely from env vars (see ./factory.ts). Never falls back to local disk —
 * any failure here is surfaced as a StorageError with a clear message.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageError, type ObjectAccess, type StorageProvider, type StoredObjectRef } from './types.js';

export interface S3ProviderConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  /** Signed download URL validity in seconds — see factory.ts (S3_SIGNED_URL_EXPIRY_SECONDS). */
  signedUrlExpirySeconds?: number;
}

/** Default signed download URL validity when S3_SIGNED_URL_EXPIRY_SECONDS is unset.
 * Kept short — the authenticated route re-mints a fresh URL on every request. */
const DEFAULT_SIGNED_URL_EXPIRY_SECONDS = 300;

export class S3StorageProvider implements StorageProvider {
  readonly name = 's3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly signedUrlExpirySeconds: number;

  constructor(config: S3ProviderConfig) {
    this.bucket = config.bucket;
    this.signedUrlExpirySeconds = config.signedUrlExpirySeconds ?? DEFAULT_SIGNED_URL_EXPIRY_SECONDS;
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
      const url = await getSignedUrl(this.client, command, { expiresIn: this.signedUrlExpirySeconds });
      return { kind: 'redirect', url };
    } catch (err) {
      throw new StorageError(`S3 signed URL generation failed: ${(err as Error).message}`, 502);
    }
  }

  /** Direct GetObject + buffer the body in-process (server-side use only — never exposed to clients). */
  async getObjectBuffer({ key }: { key: string }): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
      const response = await this.client.send(command);
      const body = response.Body;
      if (!body) {
        throw new Error('S3 GetObject returned an empty body');
      }
      return await streamToBuffer(body as NodeJS.ReadableStream);
    } catch (err) {
      throw new StorageError(`S3 object read failed: ${(err as Error).message}`, 502);
    }
  }

  async deleteObject({ key }: { key: string }): Promise<void> {
    // S3/R2 DeleteObject succeeds (204) even if the key does not exist, so this
    // is naturally idempotent — no pre-check needed.
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      throw new StorageError(`S3 delete failed: ${(err as Error).message}`, 502);
    }
  }
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
