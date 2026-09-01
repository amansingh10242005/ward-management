/**
 * error-handler.middleware.js — Centralized Express error-handling middleware.
 *
 * Responsibilities:
 *  - Catch any error passed via next(err) from route handlers or service calls.
 *  - Map known error types to appropriate HTTP status codes.
 *  - Return a consistent JSON error envelope to the client.
 *  - Avoid leaking internal stack traces to the client in production.
 *
 * Usage: register this as the LAST middleware in index.js, after all routers.
 *
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  // Map known PostgreSQL error codes to 400 Bad Request
  if (err.code === '23502') { // NOT NULL violation
    err.statusCode = 400;
    err.message = 'Database constraint violation: missing required field';
  } else if (err.code === '22023') { // invalid_parameter_value (e.g., invalid geometry)
    err.statusCode = 400;
    err.message = 'Database constraint violation: invalid geometry or parameter';
  } else if (err.code === '23503') { // foreign_key_violation
    err.statusCode = 409;
    err.message = 'Database constraint violation: Feature is referenced by other records (e.g. Zone contains Roads, Road contains Streetlights) and cannot be deleted.';
  }

  // Contract: Custom error classes like NotFoundError should set this.statusCode.
  // This fallback checks err.statusCode ?? err.status ?? 500.
  const status = err.statusCode ?? err.status ?? 500;
  const message = err.message || 'Internal server error';

  if (status >= 500) {
    console.error('[error-handler]', err);
  }

  if (err.name === 'GeometryValidationError') {
    return res.status(400).json({
      error: err.error,
      reason: err.reason
    });
  }

  res.status(status).json({
    error: {
      message,
      // Only expose the stack trace during development
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
    },
  });
}
