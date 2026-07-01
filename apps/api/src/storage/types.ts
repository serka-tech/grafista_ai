/**
 * Grafista AI Studio — Object Storage Abstraction (Phase 2 Step 3)
 *
 * A single interface with two implementations (local disk, S3-compatible)
 * so route handlers never talk to `fs` or the AWS SDK directly. Selecting
 * which implementation backs a given operation is done by name (see
 * ./factory.ts) rather than always "whatever is currently configured" —
 * this matters for downloads, where a file may have been stored under a
 * different provider than the one currently active in STORAGE_PROVIDER.
 */

export type StorageProviderName = 's3' | 'local';

export interface StoredObjectRef {
  provider: StorageProviderName;
  bucket: string;
  key: string;
}

export type ObjectAccess =
  | { kind: 'redirect'; url: string }
  | { kind: 'stream'; stream: NodeJS.ReadableStream; contentType?: string; contentLength?: number };

export interface StorageProvider {
  readonly name: StorageProviderName;

  /** Writes a file's bytes to storage. Must throw StorageError (not silently degrade) on failure. */
  putObject(input: { key: string; body: Buffer; contentType: string }): Promise<StoredObjectRef>;

  /**
   * Produces a way for an already-authorized caller to fetch the file: either a
   * time-limited signed URL (S3) or a readable stream (local disk). Never returns
   * a permanent/public URL.
   */
  getObjectAccess(input: { key: string; filename: string; contentType?: string }): Promise<ObjectAccess>;
}

/**
 * Raised for any storage configuration or I/O failure. Carries an HTTP status so
 * the existing error-handler middleware (which reads `err.status`) renders a
 * clear 4xx/5xx instead of a generic 500 with no context.
 */
export class StorageError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = 'StorageError';
    this.status = status;
  }
}
