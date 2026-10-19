import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isDevelopmentLoopbackAlias(origin: string | undefined): boolean {
  if (!origin || env.NODE_ENV === 'production') return false;

  try {
    const received = new URL(origin);
    const configured = new URL(env.CLIENT_ORIGIN);
    const localHosts = new Set(['localhost', '127.0.0.1']);
    return received.origin !== configured.origin
      && received.protocol === configured.protocol
      && received.port === configured.port
      && localHosts.has(received.hostname)
      && localHosts.has(configured.hostname)
      && received.hostname !== configured.hostname;
  } catch {
    return false;
  }
}

export const sameOriginGuard: RequestHandler = (request, _response, next) => {
  if (SAFE_METHODS.has(request.method)) {
    next();
    return;
  }

  const origin = request.get('origin');
  const fetchSite = request.get('sec-fetch-site');
  const loopbackAlias = isDevelopmentLoopbackAlias(origin);
  if ((origin !== env.CLIENT_ORIGIN && !loopbackAlias) || (fetchSite === 'cross-site' && !loopbackAlias)) {
    next(new AppError(403, 'CSRF_REJECTED', 'This request did not come from the configured application origin.'));
    return;
  }
  next();
};
