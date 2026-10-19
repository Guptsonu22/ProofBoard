import { afterAll,beforeEach,describe,expect,it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { prisma } from '../db/client.js';
import { clearTestDatabase,createUserFixture,fixturePassword } from '../test/fixtures.js';

const origin=env.CLIENT_ORIGIN;
const csv=readFileSync(new URL('../reports/fixtures/sample-sales.csv',import.meta.url));
async function signed(email:string){const user=await createUserFixture(email);const agent=request.agent(app);await agent.post('/api/auth/login').set('Origin',origin).send({email,password:fixturePassword});return{user,agent};}

describe('immutable secure report sharing',()=>{
 beforeEach(clearTestDatabase);afterAll(async()=>{await prisma.$disconnect();});

 it('shares a frozen, sanitized snapshot and rejects public access after immediate revocation',async()=>{
  const owner=await signed('share-owner@example.com');const viewer=await signed('share-viewer@example.com');const outsider=await signed('share-outsider@example.com');
  const upload=await owner.agent.post('/api/datasets').set('Origin',origin).attach('file',Buffer.from(csv),{filename:'sample-sales.csv',contentType:'text/csv'});
  expect(upload.status).toBe(201);const dataset=upload.body.dataset;
  const create=await owner.agent.post('/api/reports').set('Origin',origin).send({datasetId:dataset.id,name:'Quarterly sales'});expect(create.status).toBe(201);const report=create.body.report;
  const revenue=dataset.columns.find((column:{originalName:string})=>column.originalName==='revenue').id;
  const definition={version:1,filters:{categories:[]},blocks:[{id:'revenue-total',type:'metric',title:'Revenue total',columnId:revenue,operation:'sum'}]};
  expect((await owner.agent.patch(`/api/reports/${report.id}`).set('Origin',origin).send({definition})).status).toBe(200);

  const otherDataset=await prisma.dataset.create({data:{userId:outsider.user.id,name:'Other private data'}});
  const otherReport=await prisma.report.create({data:{userId:outsider.user.id,datasetId:otherDataset.id,name:'Other private report',definition:{version:1,filters:{categories:[]},blocks:[]}}});
  expect((await owner.agent.get(`/api/reports/${otherReport.id}`)).status).toBe(404);
  expect((await owner.agent.patch(`/api/reports/${otherReport.id}`).set('Origin',origin).send({name:'stolen'})).status).toBe(404);
  expect((await owner.agent.post(`/api/reports/${otherReport.id}/shares`).set('Origin',origin).send({})).status).toBe(404);

  const created=await owner.agent.post(`/api/reports/${report.id}/shares`).set('Origin',origin).send({expiresAt:new Date(Date.now()+7*86400000).toISOString()});
  expect(created.status).toBe(201);const share=created.body.share;expect(share.token).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(share.url).toContain(`/share/${share.token}`);expect(share.status).toBe('active');
  const stored=await prisma.shareLink.findUnique({where:{id:share.id}});expect(stored?.tokenHash).toBe(createHash('sha256').update(share.token as string).digest('hex'));expect(stored?.tokenHash).not.toBe(share.token);
  const list=(await owner.agent.get(`/api/reports/${report.id}/shares`)).body.shares;expect(list[0].status).toBe('active');expect(list[0]).not.toHaveProperty('token');

  const publicAgent=request.agent(app);
  const response=await publicAgent.get(`/api/share/${share.token}`);
  expect(response.status).toBe(200);expect(response.headers['cache-control']).toContain('no-store');expect(response.headers['referrer-policy']).toBe('no-referrer');
  expect(response.body.report.title).toBe('Quarterly sales');expect(response.body.report.blocks[0].result.value).toBe(200);expect(response.body.report.blocks[0].rowsIncluded).toBe(11);
  const exposed=JSON.stringify(response.body);
  for(const privateIdentifier of [dataset.id,report.id,owner.user.id,owner.user.email])expect(exposed).not.toContain(privateIdentifier);
  expect(exposed).not.toContain(csv.toString());expect(exposed).not.toContain('tokenHash');expect(exposed).not.toContain('passwordHash');
  expect((await publicAgent.get(`/api/reports/${report.id}`)).status).toBe(401);
  expect((await publicAgent.get(`/api/datasets/${dataset.id}`)).status).toBe(401);
  expect((await publicAgent.get(`/api/share/${share.token}/reports/${otherReport.id}`)).status).toBe(404);
  expect((await publicAgent.get(`/api/share/${'x'.repeat(43)}`)).status).toBe(404);

  const updatedDefinition={version:1,filters:{categories:[]},blocks:[{id:'unit-total',type:'metric',title:'Units total',columnId:dataset.columns.find((column:{originalName:string})=>column.originalName==='units').id,operation:'sum'}]};
  await owner.agent.patch(`/api/reports/${report.id}`).set('Origin',origin).send({name:'Edited private report',definition:updatedDefinition});
  const frozen=await publicAgent.get(`/api/share/${share.token}`);expect(frozen.body.report.title).toBe('Quarterly sales');expect(frozen.body.report.blocks[0].result.value).toBe(200);

  const revoked=await owner.agent.delete(`/api/reports/${report.id}/shares/${share.id}`).set('Origin',origin);
  expect(revoked.status).toBe(200);expect(revoked.body.share.status).toBe('revoked');
  expect((await publicAgent.get(`/api/share/${share.token}`)).status).toBe(404);
  expect((await owner.agent.get(`/api/reports/${report.id}/shares`)).body.shares[0].status).toBe('revoked');
 });

 it('rejects an expired link on every request and rejects expiry values in the past',async()=>{
  const owner=await signed('share-expiry@example.com');
  const upload=await owner.agent.post('/api/datasets').set('Origin',origin).attach('file',Buffer.from(csv),{filename:'sample-sales.csv',contentType:'text/csv'});
  const report=(await owner.agent.post('/api/reports').set('Origin',origin).send({datasetId:upload.body.dataset.id,name:'Expiry test'})).body.report;
  const rejected=await owner.agent.post(`/api/reports/${report.id}/shares`).set('Origin',origin).send({expiresAt:new Date(Date.now()-60_000).toISOString()});expect(rejected.status).toBe(400);expect(rejected.body.error.code).toBe('INVALID_EXPIRY');
  const token=Buffer.alloc(32,7).toString('base64url');
  await prisma.shareLink.create({data:{reportId:report.id,userId:owner.user.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()-1000),snapshot:{version:1,title:'Expired',blocks:[]}}});
  const publicAgent=request.agent(app);expect((await publicAgent.get(`/api/share/${token}`)).status).toBe(404);expect((await publicAgent.get(`/api/share/${token}`)).status).toBe(404);
  const status=(await owner.agent.get(`/api/reports/${report.id}/shares`)).body.shares[0];expect(status.status).toBe('expired');
 });
});
