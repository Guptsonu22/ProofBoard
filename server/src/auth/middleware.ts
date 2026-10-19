import type { RequestHandler } from 'express';
import { prisma } from '../db/client.js';
import { AppError } from '../lib/errors.js';

export const requireAuth: RequestHandler = async (request, response, next) => {
  const userId = request.session.userId;
  if (!userId) {
    next(new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.'));
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, createdAt: true },
    });
    if (!user) {
      request.session.destroy(() => undefined);
      next(new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.'));
      return;
    }
    response.locals.user = user;
    next();
  } catch (error) {
    next(error);
  }
};
