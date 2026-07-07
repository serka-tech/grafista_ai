/**
 * Grafista AI Studio — S3_ENDPOINT validation (Production Step 17)
 *
 * Production Step 17's real R2 roundtrip smoke failed with a bare
 * "S3 upload failed: Invalid URL" — the AWS SDK's contextless error for a
 * malformed `endpoint`, thrown only at request time. The factory now
 * validates S3_ENDPOINT up front and fails with a message that names the var
 * and the expected shape, WITHOUT echoing the value (it carries the R2 account
 * id). These tests lock that behavior in.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getStorageProvider } from '../storage/factory.js';
import { StorageError } from '../storage/types.js';

const REQUIRED_S3_ENV = {
  S3_REGION: 'auto',
  S3_BUCKET: 'grafista-test-bucket',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
};

function setS3Env(endpoint?: string): void {
  process.env.STORAGE_PROVIDER = 's3';
  Object.assign(process.env, REQUIRED_S3_ENV);
  if (endpoint === undefined) {
    delete process.env.S3_ENDPOINT;
  } else {
    process.env.S3_ENDPOINT = endpoint;
  }
}

afterEach(() => {
  process.env.STORAGE_PROVIDER = 'local';
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_REGION;
  delete process.env.S3_BUCKET;
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;
});

describe('S3_ENDPOINT validation in the storage factory', () => {
  it('rejects a scheme-less endpoint (the real Step 17 R2 failure) with a clear, value-free error', () => {
    const badValue = 'abc123def456.r2.cloudflarestorage.com'; // missing https://
    setS3Env(badValue);

    let thrown: unknown;
    try {
      getStorageProvider();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(StorageError);
    const message = (thrown as StorageError).message;
    expect(message).toMatch(/S3_ENDPOINT/);
    expect(message).toMatch(/valid absolute URL/i);
    // must NOT leak the (account-id-bearing) endpoint value
    expect(message).not.toContain(badValue);
  });

  it('rejects a placeholder value still containing angle brackets', () => {
    setS3Env('<ACCOUNT_ID>.r2.cloudflarestorage.com');
    expect(() => getStorageProvider()).toThrow(StorageError);
  });

  it('rejects an unsupported scheme', () => {
    setS3Env('s3://abc123.r2.cloudflarestorage.com');
    expect(() => getStorageProvider()).toThrow(/unsupported scheme|valid absolute URL/i);
  });

  it('accepts a well-formed https R2 endpoint', () => {
    setS3Env('https://abc123def456.r2.cloudflarestorage.com');
    const provider = getStorageProvider();
    expect(provider.name).toBe('s3');
  });

  it('tolerates surrounding whitespace by trimming before validating', () => {
    setS3Env('  https://abc123def456.r2.cloudflarestorage.com  ');
    const provider = getStorageProvider();
    expect(provider.name).toBe('s3');
  });

  it('allows S3_ENDPOINT to be unset (real AWS S3 derives the endpoint from the region)', () => {
    setS3Env(undefined);
    const provider = getStorageProvider();
    expect(provider.name).toBe('s3');
  });
});
