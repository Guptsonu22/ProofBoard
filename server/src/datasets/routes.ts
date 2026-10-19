import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { env } from '../config/env.js';
import { prisma } from '../db/client.js';
import { AppError } from '../lib/errors.js';
import { validateParams, validateQuery } from '../lib/validate.js';
import { parseCsv } from './csv-ingestion.js';

const datasetParams = z.object({ datasetId: z.string().min(1).max(64) });
const previewQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(50_000).default(0) });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.CSV_MAX_UPLOAD_BYTES, files: 1, fields: 0, parts: 1 } });

function userId(response: Response): string {
  const user = response.locals.user as { id: string } | undefined;
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.');
  return user.id;
}
function notFound(): AppError { return new AppError(404, 'NOT_FOUND', 'The requested resource was not found.'); }
function filename(input: string): string {
  const cleaned = input.replace(/[\\/]/g, '/').split('/').pop()?.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (cleaned || 'upload.csv').slice(0, 255);
}

export const datasetsRouter = Router();
datasetsRouter.use(requireAuth);

datasetsRouter.get('/', async (_request, response, next) => {
  try {
    const datasets = await prisma.dataset.findMany({
      where: { userId: userId(response) }, orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, originalFileName: true, sourceRecordCount: true, parsedRowCount: true, rejectedRowCount: true, createdAt: true, columns: true },
    });
    response.json({ datasets });
  } catch (error) { next(error); }
});

datasetsRouter.post('/', upload.single('file'), async (request, response, next) => {
  try {
    if (!request.file) throw new AppError(400, 'FILE_REQUIRED', 'Choose a CSV file to upload.');
    if (!request.file.buffer.length) throw new AppError(400, 'EMPTY_FILE', 'The CSV is empty. Add a header row and data.');
    const parsed = parseCsv(request.file.buffer);
    const owner = userId(response);
    const originalFileName = filename(request.file.originalname);
    const dataset = await prisma.$transaction(async (tx) => {
      const created = await tx.dataset.create({ data: {
        userId: owner, name: originalFileName.replace(/\.csv$/i, '') || 'Untitled dataset', originalFileName,
        sourceRecordCount: parsed.sourceRecordCount, parsedRowCount: parsed.parsedRowCount, rejectedRowCount: parsed.rejectedRowCount,
        columns: parsed.columns as unknown as Prisma.InputJsonValue,
      } });
      for (let start = 0; start < parsed.rows.length; start += 500) {
        await tx.datasetRow.createMany({ data: parsed.rows.slice(start, start + 500).map((row) => ({
          datasetId: created.id, userId: owner, ordinal: row.ordinal, sourceRow: row.sourceRow, sourceLine: row.sourceLine,
          values: row.values as unknown as Prisma.InputJsonValue, warnings: row.warnings as unknown as Prisma.InputJsonValue,
          rejected: row.rejected, hasWarnings: row.warnings.length > 0, rejectionReason: row.rejectionReason,
        })) });
      }
      return created;
    });
    response.status(201).json({ dataset: {
      id: dataset.id, name: dataset.name, originalFileName: dataset.originalFileName, createdAt: dataset.createdAt,
      sourceRecordCount: dataset.sourceRecordCount, parsedRowCount: dataset.parsedRowCount, rejectedRowCount: dataset.rejectedRowCount, columns: parsed.columns,
    } });
  } catch (error) { next(error); }
});

datasetsRouter.get('/:datasetId/preview', validateParams(datasetParams), validateQuery(previewQuery), async (request, response, next) => {
  try {
    const owner = userId(response);
    const { datasetId } = request.params as z.infer<typeof datasetParams>;
    const { limit, offset } = response.locals.validatedQuery as z.infer<typeof previewQuery>;
    const exists = await prisma.dataset.findFirst({ where: { id: datasetId, userId: owner }, select: { id: true } });
    if (!exists) throw notFound();
    const [rows, total] = await Promise.all([
      prisma.datasetRow.findMany({ where: { datasetId, userId: owner }, orderBy: { ordinal: 'asc' }, skip: offset, take: limit, select: { ordinal: true, sourceRow: true, sourceLine: true, values: true, warnings: true, rejected: true, rejectionReason: true } }),
      prisma.datasetRow.count({ where: { datasetId, userId: owner } }),
    ]);
    response.json({ rows, total, offset, limit });
  } catch (error) { next(error); }
});

datasetsRouter.get('/:datasetId/warnings', validateParams(datasetParams), validateQuery(previewQuery), async (request, response, next) => {
  try {
    const owner = userId(response);
    const { datasetId } = request.params as z.infer<typeof datasetParams>;
    const { limit, offset } = response.locals.validatedQuery as z.infer<typeof previewQuery>;
    if (!await prisma.dataset.findFirst({ where: { id: datasetId, userId: owner }, select: { id: true } })) throw notFound();
    const rows = await prisma.datasetRow.findMany({
      where: { datasetId, userId: owner, hasWarnings: true },
      orderBy: { ordinal: 'asc' }, skip: offset, take: limit,
      select: { ordinal: true, sourceRow: true, sourceLine: true, warnings: true, rejected: true, rejectionReason: true },
    });
    const total = await prisma.datasetRow.count({ where: { datasetId, userId: owner, hasWarnings: true } });
    response.json({ warnings: rows, total, offset, limit });
  } catch (error) { next(error); }
});
