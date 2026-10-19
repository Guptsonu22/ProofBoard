import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../db/client.js';
import { AppError } from '../lib/errors.js';
import { validateBody } from '../lib/validate.js';
import { requireAuth } from './middleware.js';
import { hashPassword, MAX_PASSWORD_BYTES, verifyPassword } from './password.js';

const credentialsSchema = z.object({
  email: z.email().trim().toLowerCase().max(254),
  password: z.string().min(1).refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_PASSWORD_BYTES, 'Password must be 72 bytes or fewer.'),
}).strict();

const registrationSchema = credentialsSchema.extend({
  password: z.string().min(12, 'Password must contain at least 12 characters.')
    .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_PASSWORD_BYTES, 'Password must be 72 bytes or fewer.'),
});

type PublicUser = { id: string; email: string; createdAt: Date };
const publicUserSelect = { id: true, email: true, createdAt: true } as const;
export const authRouter = Router();

function regenerateSession(request: Parameters<Parameters<typeof authRouter.post>[1]>[0], userId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => {
      if (error) return reject(error);
      request.session.userId = userId;
      request.session.save((saveError) => saveError ? reject(saveError) : resolve());
    });
  });
}

authRouter.post('/register', validateBody(registrationSchema), async (request, response, next) => {
  try {
    const { email, password } = request.body as z.infer<typeof registrationSchema>;
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({ data: { email, passwordHash }, select: publicUserSelect });
    await regenerateSession(request, user.id);
    response.status(201).json({ user });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      next(new AppError(409, 'EMAIL_UNAVAILABLE', 'An account cannot be created with these details.'));
      return;
    }
    next(error);
  }
});

authRouter.post('/login', validateBody(credentialsSchema), async (request, response, next) => {
  try {
    const { email, password } = request.body as z.infer<typeof credentialsSchema>;
    const userWithHash = await prisma.user.findUnique({ where: { email }, select: { ...publicUserSelect, passwordHash: true } });
    const isValid = await verifyPassword(password, userWithHash?.passwordHash ?? null);
    if (!userWithHash || !isValid) {
      next(new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.'));
      return;
    }
    const { passwordHash: _passwordHash, ...user } = userWithHash;
    await regenerateSession(request, user.id);
    response.json({ user });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout', (request, response, next) => {
  request.session.destroy((error) => {
    if (error) {
      next(error);
      return;
    }
    response.clearCookie('proofboard.sid', {
      path: '/',
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    response.status(204).end();
  });
});

authRouter.get('/me', requireAuth, (_request, response) => {
  response.json({ user: response.locals.user as PublicUser });
});
