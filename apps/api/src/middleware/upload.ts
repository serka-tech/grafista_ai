import multer from 'multer';

/**
 * Buffers the upload in memory instead of writing straight to disk — the
 * storage provider abstraction (see ../storage/) decides where the bytes
 * actually land (local disk or S3-compatible), and only after that succeeds
 * does the route handler persist a Postgres metadata row. This is what makes
 * "no fallback, no partial row on storage failure" possible: multer no
 * longer has an opinion about where files live.
 */

const MAX_SIZE = parseInt(process.env.UPLOAD_MAX_SIZE_MB ?? '50') * 1024 * 1024;

const DEFAULT_ALLOWED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'application/x-photoshop',
  'image/vnd.adobe.photoshop',
  'application/zip',
  'application/x-zip-compressed',
].join(',');

const fileFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowed = (process.env.ALLOWED_FILE_TYPES ?? DEFAULT_ALLOWED_TYPES).split(',');
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    const err = new Error(`File type ${file.mimetype} not allowed. Allowed types: ${allowed.join(', ')}`) as Error & { status?: number };
    err.status = 400;
    cb(err);
  }
};

export const upload = multer({ storage: multer.memoryStorage(), fileFilter, limits: { fileSize: MAX_SIZE } });
