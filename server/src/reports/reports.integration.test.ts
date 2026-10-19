import { afterAll,beforeEach,describe,expect,it } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { prisma } from '../db/client.js';
import { clearTestDatabase,createUserFixture,fixturePassword } from '../test/fixtures.js';

const origin=env.CLIENT_ORIGIN;
const sales=readFileSync(new URL('./fixtures/sample-sales.csv',import.meta.url));
async function signed(email:string){const user=await createUserFixture(email);const agent=request.agent(app);await agent.post('/api/auth/login').set('Origin',origin).send({email,password:fixturePassword});return{user,agent};}

describe('report ownership and evaluation API',()=>{
 beforeEach(clearTestDatabase);afterAll(async()=>{await prisma.$disconnect();});
 it('creates, lists, saves, evaluates and scopes reports to the dataset owner',async()=>{
  const owner=await signed('report-owner@example.com');const other=await signed('report-other@example.com');
  const uploaded=await owner.agent.post('/api/datasets').set('Origin',origin).attach('file',Buffer.from(sales),{filename:'sample-sales.csv',contentType:'text/csv'});
  expect(uploaded.status).toBe(201);const dataset=uploaded.body.dataset;
  const made=await owner.agent.post('/api/reports').set('Origin',origin).send({datasetId:dataset.id,name:'Sales totals'});
  expect(made.status).toBe(201);expect((await owner.agent.get('/api/reports')).body.reports).toHaveLength(1);expect((await other.agent.get('/api/reports')).body.reports).toHaveLength(0);
  const report=made.body.report;const revenue=dataset.columns.find((c:{originalName:string})=>c.originalName==='revenue').id;
  const definition={version:1,filters:{categories:[]},blocks:[{id:'sum',type:'metric',title:'Revenue total',columnId:revenue,operation:'sum'}]};
  const saved=await owner.agent.patch(`/api/reports/${report.id}`).set('Origin',origin).send({name:'January revenue',definition});expect(saved.status).toBe(200);
  const evaluated=await owner.agent.post(`/api/reports/${report.id}/evaluate`).set('Origin',origin).send({});
  expect(evaluated.status).toBe(200);expect(evaluated.body.evaluation.blocks[0].result.value).toBe(200);expect(evaluated.body.evaluation.blocks[0].rowsIncluded).toBe(11);
  expect(evaluated.body.evaluation.blocks[0].queryPlan.statement).toMatch(/No SQL was executed/);
  expect((await other.agent.get(`/api/reports/${report.id}`)).status).toBe(404);
  expect((await other.agent.get(`/api/datasets/${dataset.id}/categories/${dataset.columns.find((c:{originalName:string})=>c.originalName==='region').id}`)).status).toBe(404);
  expect((await other.agent.patch(`/api/reports/${report.id}`).set('Origin',origin).send({name:'stolen'})).status).toBe(404);
  expect((await other.agent.post(`/api/reports/${report.id}/evaluate`).set('Origin',origin).send({})).status).toBe(404);
  expect((await request(app).post(`/api/reports/${report.id}/evaluate`).set('Origin',origin).send({})).status).toBe(401);
  expect((await other.agent.post('/api/reports').set('Origin',origin).send({datasetId:dataset.id,name:'stolen'})).status).toBe(404);
 });
 it('validates report filters and requested fields using server dataset metadata',async()=>{
  const owner=await signed('report-valid@example.com');const uploaded=await owner.agent.post('/api/datasets').set('Origin',origin).attach('file',Buffer.from(sales),{filename:'sample-sales.csv',contentType:'text/csv'});const dataset=uploaded.body.dataset;
  const report=(await owner.agent.post('/api/reports').set('Origin',origin).send({datasetId:dataset.id,name:'Invalid'})).body.report;
  const result=await owner.agent.post(`/api/reports/${report.id}/evaluate`).set('Origin',origin).send({definition:{version:1,filters:{dateRange:{columnId:dataset.columns.find((c:{originalName:string})=>c.originalName==='revenue').id,from:'2026-01-01'},categories:[]},blocks:[]}});
  expect(result.status).toBe(400);expect(result.body.error.code).toBe('REPORT_VALIDATION');
 });
});
