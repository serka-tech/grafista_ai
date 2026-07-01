import multer from 'multer';
import fs from 'fs';
import path from 'path';

export const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

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

export const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_SIZE } });
