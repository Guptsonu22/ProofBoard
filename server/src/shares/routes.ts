import { createHash, randomBytes } from 'node:crypto';
import { Router, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { env } from '../config/env.js';
import { prisma } from '../db/client.js';
import { AppError } from '../lib/errors.js';
import { validateBody, validateParams } from '../lib/validate.js';
import type { ColumnProfile } from '../datasets/csv-ingestion.js';
import { evaluateReport, type EvaluationDataset, type EvaluationRow } from '../reports/evaluate.js';
import { emptyDefinition, reportDefinitionSchema, type ReportBlock, type ReportDefinition } from '../reports/definition.js';

const reportParams = z.object({ reportId: z.string().min(1).max(64) });
const shareParams = z.object({ reportId: z.string().min(1).max(64), shareId: z.string().min(1).max(64) });
const createSchema = z.object({ expiresAt: z.coerce.date().nullable().optional() }).strict();
const inactive = () => new AppError(404, 'SHARE_NOT_FOUND', 'This shared report is unavailable.');
function ownerId(response: Response): string { const user = response.locals.user as {id:string}|undefined; if (!user) throw new AppError(401,'UNAUTHENTICATED','Authentication is required.'); return user.id; }

function displayColumn(columns: ColumnProfile[], id: string): string {
  const selected = columns.find((column) => column.id === id);
  if (!selected) throw new AppError(400,'REPORT_VALIDATION','A report column is no longer available.');
  return selected.displayName;
}

function publicFilters(filters: ReportDefinition['filters'], columns: ColumnProfile[]) {
  return {
    dateRange: filters.dateRange ? { column: displayColumn(columns, filters.dateRange.columnId), from: filters.dateRange.from ?? null, to: filters.dateRange.to ?? null } : null,
    categories: filters.categories.map((filter) => ({ column: displayColumn(columns, filter.columnId), values: filter.values })),
  };
}

function publicOperation(block: ReportBlock, columns: ColumnProfile[]) {
  switch (block.type) {
    case 'metric': return { type: block.type, operation: block.operation, column: displayColumn(columns, block.columnId), groupBy: block.groupByColumnId ? displayColumn(columns, block.groupByColumnId) : null };
    case 'chart': return { type: block.type, chartType: block.chartType, operation: block.operation, dimension: displayColumn(columns, block.dimensionColumnId), measure: displayColumn(columns, block.measureColumnId) };
    case 'table': return { type: block.type, orderBy: displayColumn(columns, block.orderByColumnId), direction: block.direction, limit: block.limit };
    case 'note': return { type: block.type, text: block.text };
  }
}

function snapshotDefinition(definition: ReportDefinition, columns: ColumnProfile[]) {
  return {
    filters: publicFilters(definition.filters, columns),
    blocks: definition.blocks.map((block) => ({ title: block.title, ...publicOperation(block, columns) })),
  };
}

function makePublicSnapshot(title: string, sharedAt: Date, expiresAt: Date | null, definition: ReportDefinition, columns: ColumnProfile[], evaluation: ReturnType<typeof evaluateReport>) {
  const safeFilters = publicFilters(definition.filters, columns);
  const blocks = definition.blocks.map((definitionBlock, index) => {
    const calculated = evaluation.blocks[index]!;
    let result: unknown = calculated.result;
    if (definitionBlock.type === 'table' && calculated.type === 'table') {
      result = {
        ...calculated.result,
        rows: calculated.result.rows.map((row) => ({
          rank: row.rank,
          sourceRow: row.sourceRow,
          values: Object.fromEntries(columns.map((column, columnIndex) => [column.displayName, Array.isArray(row.values) ? row.values[columnIndex] ?? '' : ''])),
        })),
      };
    }
    const operation = publicOperation(definitionBlock, columns);
    return {
      type: calculated.type,
      title: calculated.title,
      result,
      explanation: calculated.explanation,
      operation,
      selectedColumns: calculated.selectedColumns.map((column) => ({ name: column.originalName, type: column.type })),
      filters: safeFilters,
      queryPlan: { engine: calculated.queryPlan.engine, algorithm: calculated.queryPlan.algorithm, parameters: { operation, filters: safeFilters } },
      sourceRowsConsidered: calculated.sourceRowsConsidered,
      rowsIncluded: calculated.rowsIncluded,
      rowsExcluded: calculated.rowsExcluded,
      exclusionReasons: calculated.exclusionReasons,
      nullAndInvalidPolicy: calculated.nullAndInvalidPolicy,
    };
  });
  return {
    version: 1,
    title,
    sharedAt: sharedAt.toISOString(),
    expiresAt: expiresAt?.toISOString() ?? null,
    definition: snapshotDefinition(definition, columns),
    blocks,
  };
}

export const sharingRouter = Router();
sharingRouter.use(requireAuth);

sharingRouter.get('/:reportId/shares', validateParams(reportParams), async (request,response,next) => {
  try {
    const reportId=(request.params as z.infer<typeof reportParams>).reportId;
    const shares=await prisma.shareLink.findMany({where:{reportId,userId:ownerId(response)},orderBy:{createdAt:'desc'},select:{id:true,expiresAt:true,revokedAt:true,createdAt:true}});
    // An inaccessible report and a report with no shares both return an empty list only if owned; verify it first.
    if(!await prisma.report.findFirst({where:{id:reportId,userId:ownerId(response)},select:{id:true}})) throw new AppError(404,'NOT_FOUND','The requested resource was not found.');
    const now=Date.now();
    response.json({shares:shares.map((share)=>({...share,status:share.revokedAt?'revoked':share.expiresAt&&share.expiresAt.getTime()<=now?'expired':'active'}))});
  } catch(error){next(error);}
});

sharingRouter.post('/:reportId/shares',validateParams(reportParams),validateBody(createSchema),async(request,response,next)=>{
  try {
    const reportId=(request.params as z.infer<typeof reportParams>).reportId;
    const userId=ownerId(response);
    const {expiresAt=null}=request.body as z.infer<typeof createSchema>;
    if(expiresAt && expiresAt.getTime()<=Date.now()) throw new AppError(400,'INVALID_EXPIRY','Choose an expiry time in the future.');
    const report=await prisma.report.findFirst({where:{id:reportId,userId},select:{id:true,name:true,datasetId:true,definition:true}});
    if(!report) throw new AppError(404,'NOT_FOUND','The requested resource was not found.');
    const dataset=await prisma.dataset.findFirst({where:{id:report.datasetId,userId},select:{id:true,columns:true}});
    if(!dataset) throw new AppError(404,'NOT_FOUND','The requested resource was not found.');
    const rows=await prisma.datasetRow.findMany({where:{datasetId:dataset.id,userId},orderBy:{ordinal:'asc'},select:{ordinal:true,sourceRow:true,values:true,rejected:true,rejectionReason:true}});
    const columns=dataset.columns as unknown as ColumnProfile[];
    const definition=report.definition??emptyDefinition;
    const parsed=reportDefinitionSchema.safeParse(definition);
    if(!parsed.success) throw new AppError(400,'REPORT_VALIDATION','Save a valid report definition before creating a share link.');
    const evaluated=evaluateReport(parsed.data,{id:dataset.id,columns,rows:rows as unknown as EvaluationRow[]} satisfies EvaluationDataset);
    const createdAt=new Date();
    const snapshot=makePublicSnapshot(report.name,createdAt,expiresAt,parsed.data,columns,evaluated);
    const token=randomBytes(32).toString('base64url');
    const tokenHash=createHash('sha256').update(token).digest('hex');
    const share=await prisma.shareLink.create({data:{reportId,userId,tokenHash,expiresAt,createdAt,snapshot:snapshot as unknown as Prisma.InputJsonValue},select:{id:true,expiresAt:true,revokedAt:true,createdAt:true}});
    const status=share.expiresAt&&share.expiresAt.getTime()<=Date.now()?'expired':'active';
    response.status(201).json({share:{...share,status,token,url:new URL(`/share/${token}`,env.CLIENT_ORIGIN).toString()}});
  }catch(error){next(error);}
});

sharingRouter.delete('/:reportId/shares/:shareId',validateParams(shareParams),async(request,response,next)=>{
  try{
    const {reportId,shareId}=request.params as z.infer<typeof shareParams>;
    const userId=ownerId(response);
    const link=await prisma.shareLink.findFirst({where:{id:shareId,reportId,userId},select:{id:true,expiresAt:true,revokedAt:true,createdAt:true}});
    if(!link) throw new AppError(404,'NOT_FOUND','The requested resource was not found.');
    if(!link.revokedAt) await prisma.shareLink.updateMany({where:{id:shareId,reportId,userId,revokedAt:null},data:{revokedAt:new Date()}});
    const updated=await prisma.shareLink.findFirst({where:{id:shareId,reportId,userId},select:{id:true,expiresAt:true,revokedAt:true,createdAt:true}});
    if(!updated) throw new AppError(404,'NOT_FOUND','The requested resource was not found.');
    response.json({share:{...updated,status:updated.revokedAt?'revoked':updated.expiresAt&&updated.expiresAt.getTime()<=Date.now()?'expired':'active'}});
  }catch(error){next(error);}
});

const publicLimiter=rateLimit({windowMs:60_000,limit:60,standardHeaders:true,legacyHeaders:false,handler:(_request,response)=>response.status(429).json({error:{code:'RATE_LIMITED',message:'Too many shared report requests. Please try again later.'}})});
export const publicShareRouter=Router();
publicShareRouter.use(publicLimiter,(request,response,next)=>{response.set({ 'Cache-Control':'private, no-store, no-cache, max-age=0, must-revalidate',Pragma:'no-cache',Expires:'0','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff' });next();});
publicShareRouter.get('/:token',async(request,response,next)=>{
  try{
    const token=request.params.token??'';
    if(!/^[A-Za-z0-9_-]{43}$/.test(token)) throw inactive();
    const tokenHash=createHash('sha256').update(token).digest('hex');
    const share=await prisma.shareLink.findUnique({where:{tokenHash},select:{snapshot:true,expiresAt:true,revokedAt:true}});
    const now=Date.now();
    if(!share||share.revokedAt||(share.expiresAt&&share.expiresAt.getTime()<=now)) throw inactive();
    const snapshot=share.snapshot as Record<string,unknown>;
    if(!snapshot||snapshot.version!==1||typeof snapshot.title!=='string'||!Array.isArray(snapshot.blocks)) throw inactive();
    response.json({report:snapshot});
  }catch(error){next(error);}
});
