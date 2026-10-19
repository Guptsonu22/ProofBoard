import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../datasets/csv-ingestion.js';
import { evaluateReport, type EvaluationDataset } from './evaluate.js';
import { emptyDefinition } from './definition.js';

const parsed=parseCsv(readFileSync(new URL('./fixtures/sample-sales.csv',import.meta.url)));
const dataset:EvaluationDataset={id:'sales',columns:parsed.columns,rows:parsed.rows.map(row=>({...row}))};
const col=(name:string)=>parsed.columns.find(c=>c.originalName===name)!.id;
const def=(blocks:any[],filters:any={categories:[]})=>({version:1 as const,filters,blocks});

describe('independent report evaluation engine',()=>{
 it('computes sum, average, count, min and max from sample-sales.csv',()=>{
  const operations=['sum','average','count','min','max'] as const;
  const blocks=operations.map(operation=>({id:operation,type:'metric',title:operation,columnId:col('revenue'),operation}));
  const output=evaluateReport(def(blocks),dataset).blocks;
  expect(output.map(b=>b.result.value)).toEqual([200,200/11,11,-5,40]);
  expect(output[0]?.rowsIncluded).toBe(11);expect(output[0]?.exclusionReasons).toEqual({'Invalid number value: revenue':1});
  expect(output[0]?.queryPlan.statement).toContain('No SQL was executed');
 });
 it('groups, filters, keeps negative values and excludes invalid dates and numeric values',()=>{
  const result=evaluateReport(def([{id:'g',type:'metric',title:'Revenue by region',columnId:col('revenue'),operation:'sum',groupByColumnId:col('region')}],{dateRange:{columnId:col('order_date'),from:'2026-01-02',to:'2026-01-06'},categories:[]}),dataset).blocks[0]!;
  expect(result.result).toEqual([{group:'South',value:25,count:2},{group:'North',value:70,count:2},{group:'West',value:-5,count:1}]);
  expect(result.exclusionReasons['Outside report date range']).toBe(7);
 });
 it('returns chart points in source-first-seen order and stable top N rankings',()=>{
  const output=evaluateReport(def([
   {id:'c',type:'chart',title:'Sales',chartType:'line',dimensionColumnId:col('region'),measureColumnId:col('revenue'),operation:'sum'},
   {id:'t',type:'table',title:'Top sales',orderByColumnId:col('revenue'),direction:'desc',limit:2},
  ]),dataset).blocks;
  expect(output[0]?.result.series).toEqual([{label:'North',value:120,count:5},{label:'South',value:65,count:4},{label:'West',value:15,count:2}]);
  expect(output[1]?.result.rows.map((row:any)=>row.sourceRow)).toEqual([6,4]);
  expect(output[1]?.result.rows.map((row:any)=>row.rank)).toEqual([1,2]);
 });
 it('handles empty matches and explains missing/invalid exclusions',()=>{
  const result=evaluateReport(def([{id:'m',type:'metric',title:'Empty',columnId:col('revenue'),operation:'sum'}],{dateRange:{columnId:col('order_date'),from:'2030-01-01'},categories:[]}),dataset).blocks[0]!;
  expect(result.result.value).toBeNull();expect(result.rowsIncluded).toBe(0);expect(result.exclusionReasons['Outside report date range']).toBe(12);
 });
 it('excludes blank and invalid numeric values without coercing either to zero',()=>{
  const source=dataset.rows[0]!;
  const blank={...source,ordinal:dataset.rows.length+1,sourceRow:dataset.rows.length+2,values:['2026-01-13','North','Widget','1','','013']};
  const output=evaluateReport(def([{id:'m',type:'metric',title:'Revenue',columnId:col('revenue'),operation:'sum'}]),{...dataset,rows:[...dataset.rows,blank]}).blocks[0]!;
  expect(output.result.value).toBe(200);expect(output.rowsIncluded).toBe(11);expect(output.rowsExcluded).toBe(2);
  expect(output.exclusionReasons).toEqual({'Missing value: revenue':1,'Invalid number value: revenue':1});
 });
 it('rejects wrong operations and unsupported identifiers',()=>{
  expect(()=>evaluateReport(def([{id:'x',type:'metric',title:'Bad',columnId:col('region'),operation:'sum'}]),dataset)).toThrow(/requires a numeric column/);
  expect(()=>evaluateReport(def([{id:'x',type:'chart',title:'Bad',chartType:'bar',dimensionColumnId:col('product'),measureColumnId:col('customer_id'),operation:'sum'}]),dataset)).toThrow(/numeric columns/);
  expect(()=>evaluateReport(def([{id:'x',type:'metric',title:'Bad',columnId:'raw SQL',operation:'sum'}]),dataset)).toThrow(/not part of this dataset/);
 });
 it('uses the same returned result for output and proof, and treats duplicate rows as separate records',()=>{
  const duplicate={...dataset,rows:[...dataset.rows,...dataset.rows.slice(0,1)]};
  const result=evaluateReport(def([{id:'m',type:'metric',title:'Count',columnId:col('revenue'),operation:'count'}]),duplicate).blocks[0]!;
  expect(result.result.value).toBe(result.rowsIncluded);expect(result.rowsIncluded).toBe(12);expect(result.queryPlan.operation).toEqual(result.operation);
 });
 it('supports notes with no row calculations',()=>{expect(evaluateReport(emptyDefinition,dataset).blocks).toEqual([]);});
});
