/**
 * Grafista AI Studio — Local Disk Storage Provider
 *
 * This is the pre-Phase-2-Step-3 behavior (multer writing into apps/api/uploads/)
 * preserved behind the StorageProvider interface. It is only reachable when
 * STORAGE_PROVIDER=local is explicitly set (see ./factory.ts) — it is not a
 * silent fallback for a misconfigured or failing S3 provider.
 */

import fs from 'fs';
import path from 'path';
import { StorageError, type ObjectAccess, type StorageProvider, type StoredObjectRef } from './types.js';

export const LOCAL_UPLOAD_DIR = path.join(process.cwd(), 'uploads');

/** Rejects any key that could escape LOCAL_UPLOAD_DIR (defense in depth — keys are always server-generated). */
function resolveSafePath(key: string): string {
  const resolved = path.resolve(LOCAL_UPLOAD_DIR, key);
  if (!resolved.startsWith(path.resolve(LOCAL_UPLOAD_DIR) + path.sep)) {
    throw new StorageError('Invalid storage key', 400);
  }
  return resolved;
}

export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local' as const;
  private readonly bucket = 'local-disk';

  async putObject({ key, body }: { key: string; body: Buffer; contentType: string }): Promise<StoredObjectRef> {
    const dest = resolveSafePath(key);
    try {
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.writeFile(dest, body);
    } catch (err) {
      throw new StorageError(`Local storage write failed: ${(err as Error).message}`, 500);
    }
    return { provider: 'local', bucket: this.bucket, key };
  }

  async getObjectAccess({ key, contentType }: { key: string; filename: string; contentType?: string }): Promise<ObjectAccess> {
    const filePath = resolveSafePath(key);
    if (!fs.existsSync(filePath)) {
      throw new StorageError('File not found in local storage', 404);
    }
    const stat = fs.statSync(filePath);
    return { kind: 'stream', stream: fs.createReadStream(filePath), contentType, contentLength: stat.size };
  }
}
