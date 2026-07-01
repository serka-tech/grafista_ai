import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps an async Express handler so a rejected promise is forwarded to
 * `next(err)` instead of becoming an unhandled promise rejection.
 *
 * Express 4 does NOT do this automatically — any Postgres error (invalid
 * UUID, unique/check/foreign-key violation, etc.) thrown inside an
 * `async (req, res) => {...}` handler would otherwise crash the process.
 */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
