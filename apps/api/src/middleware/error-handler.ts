import { Request, Response, NextFunction } from 'express';
import multer from 'multer';

export function errorHandler(err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) {
  console.error('[API Error]', err.message);
  const status = err instanceof multer.MulterError ? 400 : err.status ?? 500;
  res.status(status).json({
    error: status === 400 ? 'Bad Request' : 'Internal Server Error',
    message: err.message,
    timestamp: new Date().toISOString(),
  });
}
