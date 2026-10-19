import { Router } from 'express';
import { z } from 'zod';
import type { Response } from 'express';
import { prisma } from '../db/client.js';
import { AppError } from '../lib/errors.js';
import { validateBody, validateParams } from '../lib/validate.js';
import { requireAuth } from '../auth/middleware.js';

const datasetParams = z.object({ datasetId: z.string().min(1).max(64) });
const reportParams = z.object({ reportId: z.string().min(1).max(64) });
const renameSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();

function ownerId(response: Response): string {
  const user = response.locals.user as { id: string } | undefined;
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.');
  return user.id;
}

function missingResource(): AppError {
  return new AppError(404, 'NOT_FOUND', 'The requested resource was not found.');
}

export const resourcesRouter = Router();

resourcesRouter.get('/datasets/:datasetId', requireAuth, validateParams(datasetParams), async (request, response, next) => {
  try {
    const { datasetId } = request.params as z.infer<typeof datasetParams>;
    const dataset = await prisma.dataset.findFirst({
      where: { id: datasetId, userId: ownerId(response) },
      select: { id: true, name: true, originalFileName: true, createdAt: true, updatedAt: true, sourceRecordCount: true, parsedRowCount: true, rejectedRowCount: true, columns: true },
    });
    if (!dataset) throw missingResource();
    response.json({ dataset });
  } catch (error) { next(error); }
});

resourcesRouter.patch('/datasets/:datasetId', requireAuth, validateParams(datasetParams), validateBody(renameSchema), async (request, response, next) => {
  try {
    const { datasetId } = request.params as z.infer<typeof datasetParams>;
    const { name } = request.body as z.infer<typeof renameSchema>;
    const userId = ownerId(response);
    const changed = await prisma.dataset.updateMany({ where: { id: datasetId, userId }, data: { name } });
    if (!changed.count) throw missingResource();
    const dataset = await prisma.dataset.findFirst({ where: { id: datasetId, userId }, select: { id: true, name: true, originalFileName: true, createdAt: true, updatedAt: true, sourceRecordCount: true, parsedRowCount: true, rejectedRowCount: true, columns: true } });
    if (!dataset) throw missingResource();
    response.json({ dataset });
  } catch (error) { next(error); }
});

resourcesRouter.delete('/datasets/:datasetId', requireAuth, validateParams(datasetParams), async (request, response, next) => {
  try {
    const { datasetId } = request.params as z.infer<typeof datasetParams>;
    const deleted = await prisma.dataset.deleteMany({ where: { id: datasetId, userId: ownerId(response) } });
    if (!deleted.count) throw missingResource();
    response.status(204).end();
  } catch (error) { next(error); }
});

resourcesRouter.get('/reports/:reportId', requireAuth, validateParams(reportParams), async (request, response, next) => {
  try {
    const { reportId } = request.params as z.infer<typeof reportParams>;
    const report = await prisma.report.findFirst({
      where: { id: reportId, userId: ownerId(response) },
      select: { id: true, name: true, datasetId: true, definition: true, createdAt: true, updatedAt: true },
    });
    if (!report) throw missingResource();
    response.json({ report });
  } catch (error) { next(error); }
});

resourcesRouter.patch('/reports/:reportId', requireAuth, validateParams(reportParams), validateBody(renameSchema), async (request, response, next) => {
  try {
    const { reportId } = request.params as z.infer<typeof reportParams>;
    const { name } = request.body as z.infer<typeof renameSchema>;
    const userId = ownerId(response);
    const changed = await prisma.report.updateMany({ where: { id: reportId, userId }, data: { name } });
    if (!changed.count) throw missingResource();
    const report = await prisma.report.findFirst({ where: { id: reportId, userId }, select: { id: true, name: true, datasetId: true, definition: true, createdAt: true, updatedAt: true } });
    if (!report) throw missingResource();
    response.json({ report });
  } catch (error) { next(error); }
});

resourcesRouter.delete('/reports/:reportId', requireAuth, validateParams(reportParams), async (request, response, next) => {
  try {
    const { reportId } = request.params as z.infer<typeof reportParams>;
    const deleted = await prisma.report.deleteMany({ where: { id: reportId, userId: ownerId(response) } });
    if (!deleted.count) throw missingResource();
    response.status(204).end();
  } catch (error) { next(error); }
});

