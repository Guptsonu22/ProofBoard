import session from 'express-session';
import type { PrismaClient } from '@prisma/client';

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export class PrismaSessionStore extends session.Store {
  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  get(sid: string, callback: (error: unknown, session?: session.SessionData | null) => void): void {
    void this.prisma.authSession.findUnique({ where: { sid } })
      .then(async (record) => {
        if (!record) return callback(null, null);
        if (record.expiresAt <= new Date()) {
          await this.prisma.authSession.deleteMany({ where: { sid } });
          return callback(null, null);
        }
        callback(null, JSON.parse(record.data) as session.SessionData);
      })
      .catch((error: unknown) => callback(error));
  }

  set(sid: string, value: session.SessionData, callback?: (error?: unknown) => void): void {
    const expiresAt = value.cookie.expires ? new Date(value.cookie.expires) : new Date(Date.now() + SESSION_LIFETIME_MS);
    const userId = value.userId ?? null;
    const data = JSON.stringify(value);
    void this.prisma.authSession.upsert({
      where: { sid },
      create: { sid, data, userId, expiresAt },
      update: { data, userId, expiresAt },
    }).then(() => callback?.()).catch((error: unknown) => callback?.(error));
  }

  destroy(sid: string, callback?: (error?: unknown) => void): void {
    void this.prisma.authSession.deleteMany({ where: { sid } })
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  touch(sid: string, value: session.SessionData, callback?: (error?: unknown) => void): void {
    const expiresAt = value.cookie.expires ? new Date(value.cookie.expires) : new Date(Date.now() + SESSION_LIFETIME_MS);
    void this.prisma.authSession.updateMany({ where: { sid }, data: { expiresAt } })
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }
}
