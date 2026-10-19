import { AppError } from '../lib/errors.js';
import { reportDefinitionSchema, type ReportDefinition, type ReportBlock } from './definition.js';
import type { ColumnProfile } from '../datasets/csv-ingestion.js';

export type EvaluationRow = { ordinal: number; sourceRow: number; values: unknown; rejected: boolean; rejectionReason: string | null };
export type EvaluationDataset = { id: string; columns: ColumnProfile[]; rows: EvaluationRow[] };
type ReasonCounts = Record<string, number>;
export type MetricValue = { value: number | null; count: number } | Array<{ group: string | undefined; value: number; count: number }>;
export type ChartValue = { series: Array<{ label: string; value: number; count: number }> };
export type TableValue = { rows: Array<{ rank: number; sourceRow: number; values: unknown }>; totalRankableRows: number };
export type EvaluationProvenance = {
  explanation: string;
  operation: unknown;
  selectedColumns: Array<{ id: string; originalName: string; type: ColumnProfile['type'] }>;
  filters: ReportDefinition['filters'];
  queryPlan: { engine: 'in-memory'; algorithm: string; parameters: Record<string, unknown> };
  sourceRowsConsidered: number;
  rowsIncluded: number;
  rowsExcluded: number;
  exclusionReasons: ReasonCounts;
  nullAndInvalidPolicy: string;
};
export type EvaluationBlockResult = EvaluationProvenance & (
  | { id: string; type: 'metric'; title: string; result: MetricValue }
  | { id: string; type: 'chart'; title: string; result: ChartValue }
  | { id: string; type: 'table'; title: string; result: TableValue }
  | { id: string; type: 'note'; title: string; result: { text: string } }
);

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
function aggregateNumbers(values: number[], operation: 'sum' | 'average' | 'count' | 'min' | 'max'): number {
  if (operation === 'count') return values.length;
  if (operation === 'min') return Math.min(...values);
  if (operation === 'max') return Math.max(...values);
  const scale = Math.max(...values.map(Math.abs));
  if (scale === 0) return 0;
  // Keep the ordinary path's established floating point results. Scale only when
  // average or sum magnitudes could overflow during accumulation.
  const useScaledPath = scale > Number.MAX_VALUE / values.length;
  let scaledSum = 0;
  let correction = 0;
  for (const value of values) {
    const term = useScaledPath ? value / scale : value;
    const adjusted = term - correction;
    const next = scaledSum + adjusted;
    correction = (next - scaledSum) - adjusted;
    scaledSum = next;
    if (!useScaledPath && !Number.isFinite(scaledSum)) fail('This calculation exceeds the supported numeric range. Narrow the data with report filters and try again.');
  }
  const result = useScaledPath
    ? (operation === 'average' ? (scaledSum / values.length) * scale : scaledSum * scale)
    : operation === 'average' ? scaledSum / values.length : scaledSum;
  if (!Number.isFinite(result)) fail('This calculation exceeds the supported numeric range. Narrow the data with report filters and try again.');
  return result;
}

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

function evaluateBlock(block: ReportBlock, columns: ColumnProfile[], rows: EvaluationRow[], dataset: EvaluationDataset, filters: ReportDefinition['filters'], filterReasons: ReasonCounts, rejectedCount: number): EvaluationBlockResult {
  const filterExcluded = Object.values(filterReasons).reduce((total, count) => total + count, 0);
  const index = (item: ColumnProfile) => columns.findIndex((candidate) => candidate.id === item.id);
  const basePlan = { engine: 'in-memory' as const, algorithm: 'Prisma loads rows scoped to the authenticated owner and dataset in ordinal order. The evaluator skips CSV-rejected rows, applies report filters, validates each selected cell against stored column metadata, then performs the block operation in memory. No SQL aggregation ran.', parameters: { datasetId: dataset.id, ownerScope: 'authenticated user (session-derived; identity is kept server-side)', filters } };
  if (block.type === 'note') return { id: block.id, type: block.type, title: block.title, result: { text: block.text }, explanation: 'Plain-text note; no rows were evaluated.', operation: { type: 'note', text: block.text }, selectedColumns: [], filters, queryPlan: basePlan, sourceRowsConsidered: dataset.rows.length, rowsIncluded: 0, rowsExcluded: dataset.rows.length, exclusionReasons: { ...filterReasons, ...(rejectedCount ? { 'Rejected during CSV ingestion': rejectedCount } : {}), 'Data blocks only': rows.length - filterExcluded }, nullAndInvalidPolicy: 'Not applicable.', };
  const plan: EvaluationProvenance['queryPlan'] = { ...basePlan, parameters: { ...basePlan.parameters, operation: {} } };
  const reasons: ReasonCounts = {};
  const considered = rows.length;
  const finish = (included: number, result: EvaluationBlockResult['result'], operation: unknown, selected: ColumnProfile[], explanation: string, excludedRows: number) => ({ id: block.id, type: block.type, title: block.title, result, explanation, operation, selectedColumns: selected.map(({id,originalName,type})=>({id,originalName,type})), filters, queryPlan: { ...plan, parameters: { ...plan.parameters, operation } }, sourceRowsConsidered: dataset.rows.length, rowsIncluded: included, rowsExcluded: excludedRows + filterExcluded + rejectedCount, exclusionReasons: { ...reasons, ...filterReasons, ...(rejectedCount ? { 'Rejected during CSV ingestion': rejectedCount } : {}) }, nullAndInvalidPolicy: 'Blank values and invalid values for inferred number/date columns are excluded, never replaced with zero. Duplicate records remain separate rows; negative numbers are included normally.' }) as EvaluationBlockResult;
  const addInvalid = (reason: string) => counted(reason, reasons);

  if (block.type === 'metric') {
    const measure = column(columns, block.columnId);
    if (block.operation !== 'count' && measure.type !== 'number') fail(`${block.operation} requires a numeric column.`);
    const group = block.groupByColumnId ? column(columns, block.groupByColumnId) : undefined;
    if (group && group.type !== 'category') fail('Metric grouping requires a category column.');
    const operation = { type: 'metric', operation: block.operation, columnId: measure.id, groupByColumnId: group?.id ?? null };
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
    const result = group ? [...values].map(([key, input]) => ({ group: keys.get(key), value: aggregateNumbers(input, block.operation), count: input.length })) : { value: values.size ? aggregateNumbers(values.get('') ?? [], block.operation) : null, count: values.get('')?.length ?? 0 };
    return finish(included, result, operation, [measure,...(group?[group]:[])], `${block.operation} of ${measure.displayName}${group?` grouped by ${group.displayName}`:''}. Count counts valid, nonblank values; other operations require a numeric column.`, considered-included);
  }

  if (block.type === 'chart') {
    const dimension = column(columns, block.dimensionColumnId); const measure = column(columns, block.measureColumnId);
    if (!['category','date'].includes(dimension.type)) fail('Chart dimensions must be category or date columns.');
    if (measure.type !== 'number') fail('Chart measures must be numeric columns.');
    const operation = { type: 'chart', chartType: block.chartType, operation: block.operation, dimensionColumnId: dimension.id, measureColumnId: measure.id, order: dimension.type === 'date' ? 'date ascending' : 'first-seen dimension order' };
    const groups = new Map<string, number[]>(); let included=0;
    for(const row of rows){const dim=typed(raw(row,index(dimension)),dimension.type);if(dim===null){addInvalid(`Missing or invalid dimension: ${dimension.displayName}`);continue;}const value=typed(raw(row,index(measure)),'number');if(value===null){addInvalid(raw(row,index(measure)).trim()?`Invalid number: ${measure.displayName}`:`Missing value: ${measure.displayName}`);continue;}const list=groups.get(String(dim))??[];list.push(value as number);groups.set(String(dim),list);included++;}
    const series=[...groups].map(([label,input])=>({label,value:aggregateNumbers(input,block.operation),count:input.length}));
    if (dimension.type === 'date') series.sort((a,b)=>a.label.localeCompare(b.label));
    return finish(included,{series}, operation,[dimension,measure],`${block.operation} of ${measure.displayName} by ${dimension.displayName}. Dates are chronological; categories follow their first source occurrence.`,considered-included);
  }

  const orderColumn=column(columns,block.orderByColumnId); const operation={type:'table',orderByColumnId:orderColumn.id,direction:block.direction,limit:block.limit};
  const sortable:Array<{row:EvaluationRow;value:number|string}>=[];
  for(const row of rows){const value=typed(raw(row,index(orderColumn)),orderColumn.type);if(value===null){addInvalid(`Missing or invalid sort value: ${orderColumn.displayName}`);continue;}sortable.push({row,value});}
  sortable.sort((a,b)=>{const diff=typeof a.value==='number'&&typeof b.value==='number'?a.value-b.value:String(a.value).localeCompare(String(b.value));return (block.direction==='asc'?diff:-diff)||a.row.ordinal-b.row.ordinal;});
  const output=sortable.slice(0,block.limit).map(({row},rank)=>({rank:rank+1,sourceRow:row.sourceRow,values:row.values}));
  if (sortable.length > output.length) reasons['Outside top N limit'] = sortable.length - output.length;
  return finish(output.length,{rows:output,totalRankableRows:sortable.length}, operation,[orderColumn],`Top ${block.limit} rankable records ordered ${block.direction} by ${orderColumn.displayName}; rank is separate from source row number.`,considered-output.length);
}
