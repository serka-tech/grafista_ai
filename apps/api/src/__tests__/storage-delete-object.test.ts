/**
 * Grafista AI Studio — StorageProvider.deleteObject (Production Step 17)
 *
 * deleteObject was added so the storage roundtrip smoke
 * (scripts/smoke-real-providers.ts) can clean up its temporary probe object
 * against the ACTUALLY-configured provider (real S3/R2 on staging), instead of
 * the previous local-disk-only `fs.unlink` hack. These are pure provider unit
 * tests — no DB/app/HTTP — covering both implementations and the shared
 * idempotency contract (deleting a missing key is a no-op, matching S3).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { LocalStorageProvider } from '../storage/local-provider.js';
import { S3StorageProvider } from '../storage/s3-provider.js';
import { StorageError } from '../storage/types.js';

describe('LocalStorageProvider.deleteObject', () => {
  const local = new LocalStorageProvider();

  it('removes an object so a subsequent read fails, completing a put/get/delete roundtrip', async () => {
    const key = `_smoke-test/local-delete-${Date.now()}.txt`;
    const body = Buffer.from('delete-me');
    await local.putObject({ key, body, contentType: 'text/plain' });

    // present before delete
    const readBack = await local.getObjectBuffer({ key });
    expect(readBack.equals(body)).toBe(true);

    await expect(local.deleteObject({ key })).resolves.toBeUndefined();

    // gone after delete
    await expect(local.getObjectBuffer({ key })).rejects.toThrow();
  });

  it('is idempotent — deleting a key that does not exist is a no-op, not an error', async () => {
    const missingKey = `_smoke-test/never-written-${Date.now()}.txt`;
    await expect(local.deleteObject({ key: missingKey })).resolves.toBeUndefined();
  });

  it('rejects a path-traversal key before touching the filesystem', async () => {
    await expect(local.deleteObject({ key: '../../etc/passwd' })).rejects.toBeInstanceOf(StorageError);
  });
});

describe('S3StorageProvider.deleteObject', () => {
  const s3Mock = mockClient(S3Client);
  const provider = new S3StorageProvider({
    region: 'us-east-1',
    bucket: 'test-bucket',
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
  });

  afterEach(() => s3Mock.reset());

  it('sends a DeleteObjectCommand for the given key against the configured bucket', async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});

    await expect(provider.deleteObject({ key: 'foo/bar.txt' })).resolves.toBeUndefined();

    const calls = s3Mock.commandCalls(DeleteObjectCommand);
    expect(calls.length).toBe(1);
    expect(calls[0].args[0].input).toMatchObject({ Bucket: 'test-bucket', Key: 'foo/bar.txt' });
  });

  it('wraps an underlying SDK failure in a clear StorageError (no secret leak)', async () => {
    s3Mock.on(DeleteObjectCommand).rejects(new Error('Simulated S3 delete outage'));

    await expect(provider.deleteObject({ key: 'foo/bar.txt' })).rejects.toThrow(/S3 delete failed/i);
    await expect(provider.deleteObject({ key: 'foo/bar.txt' })).rejects.toThrow(/Simulated S3 delete outage/i);
  });
});
