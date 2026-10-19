import { AppError } from '../lib/errors.js';
import { reportDefinitionSchema, type ReportDefinition, type ReportBlock } from './definition.js';
import type { ColumnProfile } from '../datasets/csv-ingestion.js';

export type EvaluationRow = { ordinal: number; sourceRow: number; values: unknown; rejected: boolean; rejectionReason: string | null };
export type EvaluationDataset = { id: string; columns: ColumnProfile[]; rows: EvaluationRow[] };
type ReasonCounts = Record<string, number>;

function fail(message: string): never { throw new AppError(400, 'REPORT_VALIDATION', message); }
function column(columns: ColumnProfile[], id: string): ColumnProfile {
  const result = columns.find((item) => item.id === id);
  if (!result) return fail('A selected column is not part of this dataset. Refresh the report and choose an available column.');
  return result;
}
function raw(row: EvaluationRow, index: number): string {
  const values = Array.isArray(row.values) ? row.values : [];
  return typeof values[index] === 'string' ? values[index] as string : '';
}
function typed(value: string, type: ColumnProfile['type']): number | string | null {
  const input = value.trim();
  if (!input) return null;
  if (type === 'number') return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(input) && Number.isFinite(Number(input)) ? Number(input) : null;
  if (type === 'date') return /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/.test(input) && Number.isFinite(Date.parse(input)) && new Date(input).toISOString().slice(0,10) === input.slice(0,10) ? input.slice(0,10) : null;
  return input;
}
function counted(reason: string, map: ReasonCounts): void { map[reason] = (map[reason] ?? 0) + 1; }

export function evaluateReport(input: unknown, dataset: EvaluationDataset) {
  const parsed = reportDefinitionSchema.safeParse(input);
  if (!parsed.success) throw new AppError(400, 'REPORT_VALIDATION', 'The report definition is invalid.', parsed.error.issues);
  const definition: ReportDefinition = parsed.data;
  const metadata = dataset.columns;
  const indexOf = (item: ColumnProfile) => metadata.findIndex((candidate) => candidate.id === item.id);
  const dateFilter = definition.filters.dateRange;
  const dateColumn = dateFilter ? column(metadata, dateFilter.columnId) : undefined;
  if (dateColumn && dateColumn.type !== 'date') fail('Date range filters require a date column.');
  const categoryFilters = definition.filters.categories.map((filter) => {
    const selected = column(metadata, filter.columnId);
    if (selected.type !== 'category') fail('Categorical filters require a category column.');
    return { selected, values: new Set(filter.values) };
  });
  const accepted: EvaluationRow[] = [];
  const filterExclusions: ReasonCounts = {};
  let rejectedCount = 0;
  for (const row of dataset.rows) {
    if (row.rejected) { rejectedCount++; continue; }
    if (dateFilter && dateColumn) {
      const value = typed(raw(row, indexOf(dateColumn)), 'date');
      if (value === null) { counted('Missing or invalid date filter value', filterExclusions); continue; }
      if ((dateFilter.from && value < dateFilter.from) || (dateFilter.to && value > dateFilter.to)) { counted('Outside report date range', filterExclusions); continue; }
    }
    let excluded = false;
    for (const filter of categoryFilters) {
      const value = typed(raw(row, indexOf(filter.selected)), 'category');
      if (value === null) { counted(`Missing category filter value: ${filter.selected.displayName}`, filterExclusions); excluded = true; break; }
      if (filter.values.size && !filter.values.has(String(value))) { counted(`Outside selected category values: ${filter.selected.displayName}`, filterExclusions); excluded = true; break; }
    }
    if (!excluded) accepted.push(row);
  }
  const filterConfig = definition.filters;
  const blocks = definition.blocks.map((item) => evaluateBlock(item, metadata, accepted, dataset, filterConfig, filterExclusions, rejectedCount));
  const summary = `In-memory evaluation of ${dataset.rows.length} stored source records; ${rejectedCount} rejected during CSV ingestion and ${Object.values(filterExclusions).reduce((a,b)=>a+b,0)} excluded by report filters.`;
  return { datasetId: dataset.id, summary, blocks, reportFilterExclusions: filterExclusions, rejectedSourceRows: rejectedCount };
}

function evaluateBlock(block: ReportBlock, columns: ColumnProfile[], rows: EvaluationRow[], dataset: EvaluationDataset, filters: ReportDefinition['filters'], filterReasons: ReasonCounts, rejectedCount: number) {
  const filterExcluded = Object.values(filterReasons).reduce((total, count) => total + count, 0);
  const index = (item: ColumnProfile) => columns.findIndex((candidate) => candidate.id === item.id);
  const basePlan = { engine: 'in-memory' as const, statement: 'No SQL was executed. DatasetRow values were loaded with Prisma ownership-scoped queries, then evaluated in memory.', datasetId: dataset.id, source: 'DatasetRow', sourceOrder: 'ordinal ascending', filters, block: block.type };
  if (block.type === 'note') return { id: block.id, type: block.type, title: block.title, result: { text: block.text }, explanation: 'Plain-text note; no rows were evaluated.', operation: { type: 'note', text: block.text }, selectedColumns: [], filters, queryPlan: basePlan, sourceRowsConsidered: dataset.rows.length, rowsIncluded: 0, rowsExcluded: dataset.rows.length, exclusionReasons: { ...filterReasons, ...(rejectedCount ? { 'Rejected during CSV ingestion': rejectedCount } : {}), 'Data blocks only': rows.length - filterExcluded }, nullAndInvalidPolicy: 'Not applicable.', };
  const plan: Record<string, unknown> = { ...basePlan };
  const reasons: ReasonCounts = {};
  const considered = rows.length;
  const finish = (included: number, result: unknown, operation: unknown, selected: ColumnProfile[], explanation: string, excludedRows: number) => ({ id: block.id, type: block.type, title: block.title, result, explanation, operation, selectedColumns: selected.map(({id,originalName,type})=>({id,originalName,type})), filters, queryPlan: { ...plan, operation }, sourceRowsConsidered: dataset.rows.length, rowsIncluded: included, rowsExcluded: excludedRows + filterExcluded + rejectedCount, exclusionReasons: { ...reasons, ...filterReasons, ...(rejectedCount ? { 'Rejected during CSV ingestion': rejectedCount } : {}) }, nullAndInvalidPolicy: 'Blank values and invalid values for inferred number/date columns are excluded, never replaced with zero. Duplicate records remain separate rows; negative numbers are included normally.' });
  const addInvalid = (reason: string) => counted(reason, reasons);

  if (block.type === 'metric') {
    const measure = column(columns, block.columnId);
    if (block.operation !== 'count' && measure.type !== 'number') fail(`${block.operation} requires a numeric column.`);
    const group = block.groupByColumnId ? column(columns, block.groupByColumnId) : undefined;
    if (group && group.type !== 'category') fail('Metric grouping requires a category column.');
    plan.operation = { type: 'metric', operation: block.operation, columnId: measure.id, groupByColumnId: group?.id ?? null };
    const values = new Map<string, number[]>();
    const keys = new Map<string, string>();
    let included = 0;
    for (const row of rows) {
      const value = typed(raw(row, index(measure)), measure.type);
      if (value === null) { addInvalid(raw(row,index(measure)).trim() ? `Invalid ${measure.type} value: ${measure.displayName}` : `Missing value: ${measure.displayName}`); continue; }
      let key = '';
      if (group) {
        const groupValue = typed(raw(row,index(group)), 'category');
        if (groupValue === null) { addInvalid(`Missing group value: ${group.displayName}`); continue; }
        key = String(groupValue); keys.set(key,key);
      }
      const collection = values.get(key) ?? []; collection.push(typeof value === 'number' ? value : 1); values.set(key, collection); included++;
    }
    const calculate = (input: number[]) => block.operation === 'count' ? input.length : block.operation === 'sum' ? input.reduce((a,b)=>a+b,0) : block.operation === 'average' ? input.reduce((a,b)=>a+b,0)/input.length : block.operation === 'min' ? Math.min(...input) : Math.max(...input);
    const result = group ? [...values].map(([key, input]) => ({ group: keys.get(key), value: calculate(input), count: input.length })) : { value: values.size ? calculate(values.get('') ?? []) : null, count: values.get('')?.length ?? 0 };
    return finish(included, result, { type: 'metric', operation: block.operation, columnId: measure.id, groupByColumnId: group?.id ?? null }, [measure,...(group?[group]:[])], `${block.operation} of ${measure.displayName}${group?` grouped by ${group.displayName}`:''}. Count counts valid, nonblank values; other operations require a numeric column.`, considered-included);
  }

  if (block.type === 'chart') {
    const dimension = column(columns, block.dimensionColumnId); const measure = column(columns, block.measureColumnId);
    if (!['category','date'].includes(dimension.type)) fail('Chart dimensions must be category or date columns.');
    if (measure.type !== 'number') fail('Chart measures must be numeric columns.');
    plan.operation = { type: 'chart', chartType: block.chartType, operation: block.operation, dimensionColumnId: dimension.id, measureColumnId: measure.id, order: dimension.type === 'date' ? 'date ascending' : 'first-seen dimension order' };
    const groups = new Map<string, number[]>(); let included=0;
    for(const row of rows){const dim=typed(raw(row,index(dimension)),dimension.type);if(dim===null){addInvalid(`Missing or invalid dimension: ${dimension.displayName}`);continue;}const value=typed(raw(row,index(measure)),'number');if(value===null){addInvalid(raw(row,index(measure)).trim()?`Invalid number: ${measure.displayName}`:`Missing value: ${measure.displayName}`);continue;}const list=groups.get(String(dim))??[];list.push(value as number);groups.set(String(dim),list);included++;}
    const series=[...groups].map(([label,input])=>({label,value:block.operation==='count'?input.length:block.operation==='sum'?input.reduce((a,b)=>a+b,0):block.operation==='average'?input.reduce((a,b)=>a+b,0)/input.length:block.operation==='min'?Math.min(...input):Math.max(...input),count:input.length}));
    if (dimension.type === 'date') series.sort((a,b)=>a.label.localeCompare(b.label));
    return finish(included,{series}, {type:'chart',chartType:block.chartType,operation:block.operation,dimensionColumnId:dimension.id,measureColumnId:measure.id},[dimension,measure],`${block.operation} of ${measure.displayName} by ${dimension.displayName}. Dates are chronological; categories follow their first source occurrence.`,considered-included);
  }

  const orderColumn=column(columns,block.orderByColumnId); plan.operation={type:'table',orderByColumnId:orderColumn.id,direction:block.direction,limit:block.limit};
  const sortable:Array<{row:EvaluationRow;value:number|string}>=[];
  for(const row of rows){const value=typed(raw(row,index(orderColumn)),orderColumn.type);if(value===null){addInvalid(`Missing or invalid sort value: ${orderColumn.displayName}`);continue;}sortable.push({row,value});}
  sortable.sort((a,b)=>{const diff=typeof a.value==='number'&&typeof b.value==='number'?a.value-b.value:String(a.value).localeCompare(String(b.value));return (block.direction==='asc'?diff:-diff)||a.row.ordinal-b.row.ordinal;});
  const output=sortable.slice(0,block.limit).map(({row},rank)=>({rank:rank+1,sourceRow:row.sourceRow,values:row.values}));
  if (sortable.length > output.length) counted('Outside top N limit', reasons);
  return finish(output.length,{rows:output,totalRankableRows:sortable.length}, {type:'table',orderByColumnId:orderColumn.id,direction:block.direction,limit:block.limit},[orderColumn],`Top ${block.limit} rankable records ordered ${block.direction} by ${orderColumn.displayName}; rank is separate from source row number.`,considered-output.length);
}
