import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const sameOriginGuard: RequestHandler = (request, _response, next) => {
  if (SAFE_METHODS.has(request.method)) {
    next();
    return;
  }

  const origin = request.get('origin');
  const fetchSite = request.get('sec-fetch-site');
  if (origin !== env.CLIENT_ORIGIN || fetchSite === 'cross-site') {
    next(new AppError(403, 'CSRF_REJECTED', 'This request did not come from the configured application origin.'));
    return;
  }
  next();
};
