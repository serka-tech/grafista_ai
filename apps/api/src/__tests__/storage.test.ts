import { describe, it, expect, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { app } from '../app.js';
import { startTestServer } from '../test/http-test-server.js';
import { pool } from '../db/pool.js';
import { TEST_USERS, TEST_USER_PASSWORD } from '../test/global-setup.js';

const testServer = startTestServer(app);
afterAll(() => testServer.close());

const SEED_CLIENT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

const s3Mock = mockClient(S3Client);

const DUMMY_S3_ENV = {
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'test-bucket',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
};

function activateS3(): void {
  process.env.STORAGE_PROVIDER = 's3';
  Object.assign(process.env, DUMMY_S3_ENV);
}

function resetStorageEnv(): void {
  process.env.STORAGE_PROVIDER = 'local';
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_REGION;
  delete process.env.S3_BUCKET;
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;
  delete process.env.S3_FORCE_PATH_STYLE;
}

async function loginAs(email: string) {
  const agent = request.agent(testServer.server);
  const res = await agent.post('/api/auth/login').send({ email, password: TEST_USER_PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

afterEach(() => {
  s3Mock.reset();
  resetStorageEnv();
});

describe('Phase 2 Step 3 — S3-compatible storage', () => {
  describe('1. Unauthenticated upload is rejected', () => {
    it('rejects POST brand-assets with 401 when no session cookie is sent', async () => {
      const res = await request(testServer.server)
        .post(`/api/clients/${SEED_CLIENT_ID}/brand-assets`)
        .field('type', 'logo')
        .field('name', 'Anonymous Upload Attempt');
      expect(res.status).toBe(401);
    });
  });

  describe('2. Missing brand_assets:upload permission', () => {
    it('rejects CONTENT_MANAGER (no brand_assets:upload) with 403 and does not create a row', async () => {
      const agent = await loginAs(TEST_USERS.CONTENT_MANAGER);
      const res = await agent
        .post(`/api/clients/${SEED_CLIENT_ID}/brand-assets`)
        .field('type', 'logo')
        .field('name', 'Should Be Blocked By Permission')
        .attach('file', Buffer.from('fake-png-bytes'), { filename: 'blocked.png', contentType: 'image/png' });
      expect(res.status).toBe(403);
      expect(res.body.requiredPermission).toBe('brand_assets:upload');

      const { rows } = await pool.query('SELECT 1 FROM brand_assets WHERE name = $1', ['Should Be Blocked By Permission']);
      expect(rows.length).toBe(0);
    });
  });

  describe('3. Missing design_references:upload permission', () => {
    it('rejects CONTENT_MANAGER (no design_references:upload) with 403', async () => {
      const agent = await loginAs(TEST_USERS.CONTENT_MANAGER);
      const res = await agent
        .post(`/api/clients/${SEED_CLIENT_ID}/design-references`)
        .field('name', 'Should Be Blocked Reference')
        .attach('file', Buffer.from('fake-png-bytes'), { filename: 'blocked-ref.png', contentType: 'image/png' });
      expect(res.status).toBe(403);
      expect(res.body.requiredPermission).toBe('design_references:upload');
    });
  });

  describe('4. Authorized brand asset upload (local storage)', () => {
    it('uploads successfully and returns a protected fileUrl', async () => {
      const agent = await loginAs(TEST_USERS.DESIGNER);
      const res = await agent
        .post(`/api/clients/${SEED_CLIENT_ID}/brand-assets`)
        .field('type', 'logo')
        .field('name', 'Storage Test Logo')
        .attach('file', Buffer.from('fake-png-bytes-for-logo'), { filename: 'test-logo.png', contentType: 'image/png' });

      expect(res.status).toBe(201);
      expect(res.body.data.storageProvider).toBe('local');
      expect(res.body.data.originalFilename).toBe('test-logo.png');
      expect(res.body.data.fileUrl).toBe(`/api/clients/${SEED_CLIENT_ID}/brand-assets/${res.body.data.id}/file`);
    });
  });

  describe('5. Authorized design reference upload (local storage)', () => {
    it('uploads successfully and returns a protected fileUrl', async () => {
      const agent = await loginAs(TEST_USERS.DESIGNER);
      const res = await agent
        .post(`/api/clients/${SEED_CLIENT_ID}/design-references`)
        .field('name', 'Storage Test Reference')
        .attach('file', Buffer.from('fake-png-bytes-for-reference'), { filename: 'test-ref.png', contentType: 'image/png' });

      expect(res.status).toBe(201);
      expect(res.body.data.storageProvider).toBe('local');
      expect(res.body.data.fileUrl).toBe(`/api/clients/${SEED_CLIENT_ID}/design-references/${res.body.data.id}/file`);
    });
  });

  describe('6 & 7. File metadata is persisted in Postgres with the correct fields, including storage provider', () => {
    it('persists original filename, mime type, size, provider, key, bucket, uploader and client id', async () => {
      const agent = await loginAs(TEST_USERS.DESIGNER);
      const meRes = await agent.get('/api/auth/me');
      const designerId = meRes.body.data.user.id;

      const res = await agent
        .post(`/api/clients/${SEED_CLIENT_ID}/brand-assets`)
        .field('type', 'icon')
        .field('name', 'Metadata Check Asset')
        .attach('file', Buffer.from('metadata-check-bytes'), { filename: 'metadata-check.png', contentType: 'image/png' });
      expect(res.status).toBe(201);

      const { rows } = await pool.query('SELECT * FROM brand_assets WHERE id = $1', [res.body.data.id]);
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row.client_id).toBe(SEED_CLIENT_ID);
      expect(row.original_filename).toBe('metadata-check.png');
      expect(row.mime_type).toBe('image/png');
      expect(Number(row.file_size_bytes)).toBe(Buffer.from('metadata-check-bytes').length);
      expect(row.storage_provider).toBe('local');
      expect(typeof row.storage_key).toBe('string');
      expect(row.storage_key.length).toBeGreaterThan(0);
      expect(row.storage_bucket).toBe('local-disk');
      expect(row.uploaded_by).toBe(designerId);
    });
  });

  describe('8. Invalid file type is rejected', () => {
    it('rejects a text/plain upload with 400', async () => {
      const agent = await loginAs(TEST_USERS.DESIGNER);
      const res = await agent
        .post(`/api/clients/${SEED_CLIENT_ID}/brand-assets`)
        .field('type', 'logo')
        .field('name', 'Bad Type Upload')
        .attach('file', Buffer.from('not an allowed type'), { filename: 'notes.txt', contentType: 'text/plain' });
      expect(res.status).toBe(400);

      const { rows } = await pool.query('SELECT 1 FROM brand_assets WHERE name = $1', ['Bad Type Upload']);
      expect(rows.length).toBe(0);
    });
  });

  describe('9. Oversized file is rejected', () => {
    it('rejects a file above UPLOAD_MAX_SIZE_MB with 400', async () => {
      const agent = await loginAs(TEST_USERS.DESIGNER);
      const limitMb = Number(process.env.UPLOAD_MAX_SIZE_MB ?? '2');
      const oversized = Buffer.alloc(limitMb * 1024 * 1024 + 1024, 1);
      const res = await agent
        .post(`/api/clients/${SEED_CLIENT_ID}/brand-assets`)
        .field('type', 'logo')
        .field('name', 'Oversized Upload')
        .attach('file', oversized, { filename: 'huge.png', contentType: 'image/png' });
      expect(res.status).toBe(400);

      const { rows } = await pool.query('SELECT 1 FROM brand_assets WHERE name = $1', ['Oversized Upload']);
      expect(rows.length).toBe(0);
    });
  });

  describe('10. Protected file download requires authentication', () => {
    it('rejects an unauthenticated GET of the file route with 401', async () => {
      const agent = await loginAs(TEST_USERS.DESIGNER);
      const upload = await agent
        .post(`/api/clients/${SEED_CLIENT_ID}/brand-assets`)
        .field('type', 'logo')
        .field('name', 'Download Auth Test')
        .attach('file', Buffer.from('some-file-bytes'), { filename: 'dl.png', contentType: 'image/png' });
      expect(upload.status).toBe(201);

      const res = await request(testServer.server).get(upload.body.data.fileUrl);
      expect(res.status).toBe(401);
    });

    it('allows an authenticated, authorized user to download the uploaded file', async () => {
      const agent = await loginAs(TEST_USERS.OWNER);
      const upload = await agent
        .post(`/api/clients/${SEED_CLIENT_ID}/brand-assets`)
        .field('type', 'logo')
        .field('name', 'Download Success Test')
        .attach('file', Buffer.from('actual-file-bytes'), { filename: 'dl-ok.png', contentType: 'image/png' });
      expect(upload.status).toBe(201);

      const res = await agent.get(upload.body.data.fileUrl);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/png');
      expect(res.headers['content-disposition']).toContain('dl-ok.png');
    });
  });

  describe('11. Simulated S3 failure returns a clear error and creates no metadata row', () => {
    it('returns a 5xx with a clear message, and no brand_assets row is created', async () => {
      activateS3();
      s3Mock.on(PutObjectCommand).rejects(new Error('Simulated S3 outage'));

      const agent = await loginAs(TEST_USERS.DESIGNER);
      const uniqueName = `S3 Failure Probe ${Date.now()}`;
      const res = await agent
        .post(`/api/clients/${SEED_CLIENT_ID}/brand-assets`)
        .field('type', 'logo')
        .field('name', uniqueName)
        .attach('file', Buffer.from('doomed-upload-bytes'), { filename: 'doomed.png', contentType: 'image/png' });

      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(res.body.message).toMatch(/S3 upload failed/i);
      expect(res.body.message).toMatch(/Simulated S3 outage/i);

      const { rows } = await pool.query('SELECT * FROM brand_assets WHERE name = $1', [uniqueName]);
      expect(rows.length).toBe(0);
    });
  });

  describe('12. Local is never a silent fallback when STORAGE_PROVIDER=s3 is explicitly configured', () => {
    it('records storageProvider "s3" (not "local") when the S3 call succeeds', async () => {
      activateS3();
      s3Mock.on(PutObjectCommand).resolves({});

      const agent = await loginAs(TEST_USERS.DESIGNER);
      const res = await agent
        .post(`/api/clients/${SEED_CLIENT_ID}/brand-assets`)
        .field('type', 'logo')
        .field('name', 'S3 Success Probe')
        .attach('file', Buffer.from('s3-stored-bytes'), { filename: 's3-ok.png', contentType: 'image/png' });

      expect(res.status).toBe(201);
      expect(res.body.data.storageProvider).toBe('s3');
      expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(1);

      const { rows } = await pool.query('SELECT storage_provider, storage_bucket FROM brand_assets WHERE id = $1', [
        res.body.data.id,
      ]);
      expect(rows[0].storage_provider).toBe('s3');
      expect(rows[0].storage_bucket).toBe(DUMMY_S3_ENV.S3_BUCKET);
    });

    it('uses local storage when STORAGE_PROVIDER is left unset (dev-friendly default, not an override of an explicit s3 setting)', async () => {
      delete process.env.STORAGE_PROVIDER;
      const agent = await loginAs(TEST_USERS.DESIGNER);
      const res = await agent
        .post(`/api/clients/${SEED_CLIENT_ID}/brand-assets`)
        .field('type', 'logo')
        .field('name', 'Default Provider Probe')
        .attach('file', Buffer.from('default-provider-bytes'), { filename: 'default.png', contentType: 'image/png' });

      expect(res.status).toBe(201);
      expect(res.body.data.storageProvider).toBe('local');
    });
  });
});
