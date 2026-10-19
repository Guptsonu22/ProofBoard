import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { prisma } from '../db/client.js';
import { AppError } from '../lib/errors.js';
import { validateBody, validateParams } from '../lib/validate.js';
import { emptyDefinition, reportDefinitionSchema } from './definition.js';
import { evaluateReport, type EvaluationDataset, type EvaluationRow } from './evaluate.js';

const paramsSchema = z.object({ reportId: z.string().min(1).max(64) });
const createSchema = z.object({ datasetId: z.string().min(1).max(64), name: z.string().trim().min(1).max(100) }).strict();
const updateSchema = z.object({ name: z.string().trim().min(1).max(100).optional(), definition: reportDefinitionSchema.optional() }).strict().refine((value) => value.name !== undefined || value.definition !== undefined, 'Provide a report name or definition.');
const evaluateSchema = z.object({ definition: reportDefinitionSchema.optional() }).strict();
function owner(response: Response): string { const user = response.locals.user as {id:string}|undefined; if(!user) throw new AppError(401,'UNAUTHENTICATED','Authentication is required.'); return user.id; }
function missing(): AppError { return new AppError(404,'NOT_FOUND','The requested resource was not found.'); }

export const reportsRouter = Router();
reportsRouter.use(requireAuth);
reportsRouter.get('/', async (_request,response,next)=>{try{const reports=await prisma.report.findMany({where:{userId:owner(response)},orderBy:{updatedAt:'desc'},select:{id:true,name:true,datasetId:true,createdAt:true,updatedAt:true,dataset:{select:{name:true}}}});response.json({reports});}catch(error){next(error);}});
reportsRouter.post('/',validateBody(createSchema),async(request,response,next)=>{try{const userId=owner(response);const {datasetId,name}=request.body as z.infer<typeof createSchema>;const dataset=await prisma.dataset.findFirst({where:{id:datasetId,userId},select:{id:true}});if(!dataset)throw missing();const report=await prisma.report.create({data:{userId,datasetId,name,definition:emptyDefinition as unknown as Prisma.InputJsonValue},select:{id:true,name:true,datasetId:true,definition:true,createdAt:true,updatedAt:true}});response.status(201).json({report});}catch(error){next(error);}});
reportsRouter.get('/:reportId',validateParams(paramsSchema),async(request,response,next)=>{try{const report=await prisma.report.findFirst({where:{id:(request.params as z.infer<typeof paramsSchema>).reportId,userId:owner(response)},select:{id:true,name:true,datasetId:true,definition:true,createdAt:true,updatedAt:true}});if(!report)throw missing();response.json({report});}catch(error){next(error);}});
reportsRouter.patch('/:reportId',validateParams(paramsSchema),validateBody(updateSchema),async(request,response,next)=>{try{const reportId=(request.params as z.infer<typeof paramsSchema>).reportId,userId=owner(response),body=request.body as z.infer<typeof updateSchema>;const data:Prisma.ReportUpdateManyMutationInput={};if(body.name!==undefined)data.name=body.name;if(body.definition!==undefined)data.definition=body.definition as unknown as Prisma.InputJsonValue;const changed=await prisma.report.updateMany({where:{id:reportId,userId},data});if(!changed.count)throw missing();const report=await prisma.report.findFirst({where:{id:reportId,userId},select:{id:true,name:true,datasetId:true,definition:true,createdAt:true,updatedAt:true}});if(!report)throw missing();response.json({report});}catch(error){next(error);}});
reportsRouter.delete('/:reportId',validateParams(paramsSchema),async(request,response,next)=>{try{const deleted=await prisma.report.deleteMany({where:{id:(request.params as z.infer<typeof paramsSchema>).reportId,userId:owner(response)} });if(!deleted.count)throw missing();response.status(204).end();}catch(error){next(error);}});
reportsRouter.post('/:reportId/evaluate',validateParams(paramsSchema),validateBody(evaluateSchema),async(request,response,next)=>{try{const report=await prisma.report.findFirst({where:{id:(request.params as z.infer<typeof paramsSchema>).reportId,userId:owner(response)},select:{id:true,datasetId:true,definition:true}});if(!report)throw missing();const dataset=await prisma.dataset.findFirst({where:{id:report.datasetId,userId:owner(response)},select:{id:true,columns:true}});if(!dataset)throw missing();const rows=await prisma.datasetRow.findMany({where:{datasetId:dataset.id,userId:owner(response)},orderBy:{ordinal:'asc'},select:{ordinal:true,sourceRow:true,values:true,rejected:true,rejectionReason:true}});const evaluationDataset:EvaluationDataset={id:dataset.id,columns:dataset.columns as unknown as EvaluationDataset['columns'],rows:rows as unknown as EvaluationRow[]};const definition=(request.body as z.infer<typeof evaluateSchema>).definition??report.definition??emptyDefinition;response.json({evaluation:evaluateReport(definition,evaluationDataset)});}catch(error){next(error);}});
