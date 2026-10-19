import { z } from 'zod';

const id = z.string().min(1).max(64);
const filterSchema = z.object({
  dateRange: z.object({ columnId: id, from: z.string().date().optional(), to: z.string().date().optional() }).strict().optional(),
  categories: z.array(z.object({ columnId: id, values: z.array(z.string().max(500)).max(100) }).strict()).max(20).default([]),
}).strict();
const base = z.object({ id, title: z.string().trim().min(1).max(100) });
const block = z.discriminatedUnion('type', [
  base.extend({ type: z.literal('metric'), columnId: id, operation: z.enum(['sum','average','count','min','max']), groupByColumnId: id.optional() }).strict(),
  base.extend({ type: z.literal('chart'), chartType: z.enum(['bar','line']), dimensionColumnId: id, measureColumnId: id, operation: z.enum(['sum','average','count','min','max']) }).strict(),
  base.extend({ type: z.literal('table'), orderByColumnId: id, direction: z.enum(['asc','desc']), limit: z.number().int().min(1).max(100) }).strict(),
  base.extend({ type: z.literal('note'), text: z.string().max(5000) }).strict(),
]);
export const reportDefinitionSchema = z.object({ version: z.literal(1), filters: filterSchema, blocks: z.array(block).max(30) }).strict().superRefine((definition, ctx) => {
  const ids = definition.blocks.map((item) => item.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Block IDs must be unique.' });
  if (definition.filters.dateRange?.from && definition.filters.dateRange.to && definition.filters.dateRange.from > definition.filters.dateRange.to) ctx.addIssue({ code: 'custom', path: ['filters','dateRange'], message: 'Date range start must not be after its end.' });
});
export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;
export type ReportBlock = ReportDefinition['blocks'][number];
export const emptyDefinition: ReportDefinition = { version: 1, filters: { categories: [] }, blocks: [] };
