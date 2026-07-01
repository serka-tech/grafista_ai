/**
 * Grafista AI Studio — Storage Provider Factory
 *
 * Deliberately reads process.env directly on every call instead of caching
 * a singleton at process startup (unlike ../config/env.ts). Two reasons:
 *  1. A stored file's provider (recorded in Postgres at upload time) can
 *     differ from whatever STORAGE_PROVIDER is configured *right now* — the
 *     download path must always be able to build the provider a given file
 *     actually lives on, not just "today's default".
 *  2. It keeps STORAGE_PROVIDER=s3 failures isolated to the request that
 *     needs S3, rather than crashing the whole process at boot if S3 env
 *     vars are temporarily incomplete — the requirement is "surface a clear
 *     error", not "the API cannot start".
 *
 * STORAGE_PROVIDER defaults to 'local' when unset (dev-friendly), but once
 * it is explicitly set to 's3', local is never used as a silent fallback —
 * see getStorageProvider() below and the S3 provider itself, which throws
 * instead of degrading on any failure.
 */

import { LocalStorageProvider } from './local-provider.js';
import { S3StorageProvider } from './s3-provider.js';
import { StorageError, type StorageProvider, type StorageProviderName } from './types.js';

export function resolveActiveProviderName(): StorageProviderName {
  const raw = (process.env.STORAGE_PROVIDER ?? 'local').trim().toLowerCase();
  if (raw !== 's3' && raw !== 'local') {
    throw new StorageError(`Invalid STORAGE_PROVIDER "${raw}" — must be "s3" or "local"`, 500);
  }
  return raw;
}

/** Builds the provider for a specific, known provider name (used for downloads of pre-existing files). */
export function getStorageProviderByName(name: StorageProviderName): StorageProvider {
  if (name === 'local') {
    return new LocalStorageProvider();
  }

  const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE } = process.env;

  const missing = (
    [
      ['S3_REGION', S3_REGION],
      ['S3_BUCKET', S3_BUCKET],
      ['S3_ACCESS_KEY_ID', S3_ACCESS_KEY_ID],
      ['S3_SECRET_ACCESS_KEY', S3_SECRET_ACCESS_KEY],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([envVar]) => envVar);

  if (missing.length > 0) {
    throw new StorageError(
      `STORAGE_PROVIDER=s3 but required env var(s) missing: ${missing.join(', ')}. See .env.example.`,
      500
    );
  }

  return new S3StorageProvider({
    endpoint: S3_ENDPOINT,
    region: S3_REGION!,
    bucket: S3_BUCKET!,
    accessKeyId: S3_ACCESS_KEY_ID!,
    secretAccessKey: S3_SECRET_ACCESS_KEY!,
    forcePathStyle: S3_FORCE_PATH_STYLE === 'true',
  });
}

/** Builds the provider currently configured via STORAGE_PROVIDER — used for new uploads. */
export function getStorageProvider(): StorageProvider {
  return getStorageProviderByName(resolveActiveProviderName());
}
