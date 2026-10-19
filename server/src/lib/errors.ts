import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' } });
};

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'MulterError' && 'code' in error) {
    const code = error.code;
    const tooLarge = code === 'LIMIT_FILE_SIZE';
    response.status(tooLarge ? 413 : 400).json({ error: {
      code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'BAD_UPLOAD',
      message: tooLarge ? 'Upload exceeds the configured file-size limit. Choose a smaller CSV.' : 'Upload one CSV file using the file field.',
    } });
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed.', details: error.issues } });
    return;
  }
  if (error instanceof AppError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) } });
    return;
  }
  if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' && error.status >= 400 && error.status < 500) {
    const status = error.status;
    response.status(status).json({
      error: {
        code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
        message: status === 413 ? 'The request body is too large.' : 'The request could not be parsed.',
      },
    });
    return;
  }
  console.error('Unhandled request error:', error);
  response.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' } });
};
