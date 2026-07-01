import { Request, Response, NextFunction } from 'express';
import multer from 'multer';

/** Postgres error codes we recognize and map to a specific HTTP status. */
const PG_ERROR_STATUS: Record<string, number> = {
  '22P02': 400, // invalid_text_representation (e.g. malformed UUID)
  '23505': 409, // unique_violation
  '23503': 409, // foreign_key_violation
  '23514': 409, // check_violation
};

const STATUS_LABELS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  500: 'Internal Server Error',
};

export function errorHandler(err: Error & { status?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) {
  console.error('[API Error]', err);

  let status: number;
  if (err instanceof multer.MulterError) {
    status = 400;
  } else if (err.code && err.code in PG_ERROR_STATUS) {
    // Any recognized Postgres error code (thrown by the `pg` driver on constraint
    // violations / malformed input) — this is the previously-unhandled crash path.
    status = PG_ERROR_STATUS[err.code];
  } else if (err.code && /^[0-9A-Z]{5}$/.test(err.code)) {
    // Any other Postgres error code we don't specifically recognize.
    status = 500;
  } else {
    status = err.status ?? 500;
  }

  const label = STATUS_LABELS[status] ?? (status === 400 ? 'Bad Request' : 'Internal Server Error');

  res.status(status).json({
    error: label,
    message: err.message,
    timestamp: new Date().toISOString(),
  });
}
