import type { CookieOptions } from 'express-session';

export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export function sessionCookieOptions(nodeEnvironment: string): CookieOptions {
  return {
    path: '/',
    httpOnly: true,
    secure: nodeEnvironment === 'production',
    sameSite: 'lax',
    maxAge: SESSION_LIFETIME_MS,
  };
}
