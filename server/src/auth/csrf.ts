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

function normalizeOrigin(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.trim().replace(/\/+$/, '');
}

export const sameOriginGuard: RequestHandler = (request, _response, next) => {
  if (SAFE_METHODS.has(request.method)) {
    next();
    return;
  }

  const origin = normalizeOrigin(request.get('origin'));
  const configured = normalizeOrigin(env.CLIENT_ORIGIN);
  const host = request.get('host');
  const proto = request.protocol;
  const hostOrigin = host ? normalizeOrigin(`${proto}://${host}`) : undefined;

  const fetchSite = request.get('sec-fetch-site');
  const loopbackAlias = isDevelopmentLoopbackAlias(origin);

  const matchesConfigured = Boolean(origin && configured && origin === configured);
  const matchesHost = Boolean(origin && hostOrigin && origin === hostOrigin);

  if ((!matchesConfigured && !matchesHost && !loopbackAlias) || (fetchSite === 'cross-site' && !loopbackAlias)) {
    next(new AppError(403, 'CSRF_REJECTED', 'This request did not come from the configured application origin.'));
    return;
  }
  next();
};
