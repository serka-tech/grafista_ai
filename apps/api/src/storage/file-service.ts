/**
 * Grafista AI Studio — Upload / Download Orchestration
 *
 * Thin layer between route handlers and the storage provider abstraction.
 * Route handlers must call storeUploadedFile() BEFORE writing any Postgres
 * metadata row, and only write that row if it resolves — a rejection here
 * must never result in a partial/broken metadata record.
 */

import path from 'path';
import { v4 as uuid } from 'uuid';
import { getStorageProvider, getStorageProviderByName } from './factory.js';
import type { ObjectAccess, StorageProviderName } from './types.js';

export type AssetKind = 'brand-assets' | 'design-references';

export interface UploadedFileMeta {
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  storageProvider: StorageProviderName;
  storageBucket: string;
  storageKey: string;
}

export interface StoredFileRef {
  storageProvider: StorageProviderName;
  storageKey: string;
  storageBucket: string;
}

/**
 * Uploads a single multer file to whichever provider STORAGE_PROVIDER
 * currently selects. Throws StorageError (never falls back to another
 * provider) if the write fails — callers must not persist a metadata row
 * when this rejects.
 */
export async function storeUploadedFile(params: {
  assetKind: AssetKind;
  clientId: string;
  file: Express.Multer.File;
}): Promise<UploadedFileMeta> {
  const provider = getStorageProvider();
  const ext = path.extname(params.file.originalname);
  const key = `${params.assetKind}/${params.clientId}/${uuid()}${ext}`;

  const stored = await provider.putObject({
    key,
    body: params.file.buffer,
    contentType: params.file.mimetype,
  });

  return {
    originalFilename: params.file.originalname,
    mimeType: params.file.mimetype,
    fileSizeBytes: params.file.size,
    storageProvider: stored.provider,
    storageBucket: stored.bucket,
    storageKey: stored.key,
  };
}

/**
 * Resolves access to a previously-stored file using the provider it was
 * actually stored on (`ref.storageProvider`), not today's default — a file
 * uploaded under STORAGE_PROVIDER=local must remain downloadable even if the
 * deployment later switches to s3, and vice versa.
 */
export async function getFileAccess(ref: StoredFileRef, filename: string, contentType?: string): Promise<ObjectAccess> {
  const provider = getStorageProviderByName(ref.storageProvider);
  return provider.getObjectAccess({ key: ref.storageKey, filename, contentType });
}

/**
 * Reads a previously-stored file's raw bytes into memory for server-side/in-process
 * use (e.g. base64-encoding an image before sending it to a vision AI provider).
 * Unlike getFileAccess, this is never wired to an HTTP response — it exists purely
 * for backend processing (see services/design-dna-analysis.ts).
 */
export async function getObjectBuffer(ref: StoredFileRef): Promise<Buffer> {
  const provider = getStorageProviderByName(ref.storageProvider);
  return provider.getObjectBuffer({ key: ref.storageKey });
}
