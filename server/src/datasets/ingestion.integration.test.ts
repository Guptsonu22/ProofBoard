import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { prisma } from '../db/client.js';
import { clearTestDatabase, createUserFixture, fixturePassword } from '../test/fixtures.js';
import { parseCsv } from './csv-ingestion.js';

const origin = env.CLIENT_ORIGIN;
const messy = readFileSync(new URL('./fixtures/messy.csv', import.meta.url));

async function signedIn(email = 'csv@example.com') {
  const user = await createUserFixture(email);
  const agent = request.agent(app);
  await agent.post('/api/auth/login').set('Origin', origin).send({ email, password: fixturePassword });
  return { user, agent };
}

describe('server CSV ingestion and data-quality profiling', () => {
  beforeEach(clearTestDatabase);
  afterAll(async () => { await prisma.$disconnect(); });

  it('parses quoted commas, escaped quotes, and multiline fields; profiles missing and invalid typed values', () => {
    const csv = ['code,date,amount,note', '00123,2025-02-01,10,"said ""hello"""', '00124,2025-02-02,bad,"two, fields', 'continued"', '00125,not-a-date,12,', '00126,2025-02-04,13,tail'].join('\n');
    const result = parseCsv(Buffer.from(csv));
    expect(result.parsedRowCount).toBe(4);
    expect(result.rejectedRowCount).toBe(0);
    expect(result.rows[0]?.values[3]).toBe('said "hello"');
    expect(result.rows[1]?.values[3]).toBe('two, fields\ncontinued');
    expect(result.columns[0]?.type).toBe('category');
    expect(result.columns[1]?.type).toBe('date');
    expect(result.columns[1]?.invalidCount).toBe(1);
    expect(result.columns[2]?.type).toBe('number');
    expect(result.columns[2]?.invalidCount).toBe(1);
    expect(result.columns[3]?.missingCount).toBe(1);
    expect(result.rows[1]?.warnings).toHaveLength(1);
    expect(result.rows[2]?.warnings).toHaveLength(2);
  });

  it('renames duplicate and empty headers deterministically without losing source fields', () => {
    const result = parseCsv(Buffer.from('name,name,,\nAda,Grace,third,value'));
    expect(result.columns.map((column) => column.id)).toEqual(['column_1', 'column_2', 'column_3', 'column_4']);
    expect(result.columns.map((column) => column.displayName)).toEqual(['name', 'name (2)', 'Column 3 (unnamed)', 'Column 4 (unnamed)']);
    expect(result.rows[0]?.values).toEqual(['Ada', 'Grace', 'third', 'value']);
  });

  it('counts blank cells as missing without rejecting the record and preserves an empty physical record', () => {
    const result = parseCsv(Buffer.from('code,amount\n001,\n002,12\n\n003,15'));
    expect(result.sourceRecordCount).toBe(4);
    expect(result.parsedRowCount).toBe(3);
    expect(result.rejectedRowCount).toBe(1);
    expect(result.rows[0]?.rejected).toBe(false);
    expect(result.columns[0]?.type).toBe('category');
    expect(result.columns[1]?.missingCount).toBe(1);
  });

  it('keeps mostly unique integer identifiers categorical while measure columns remain numeric', () => {
    const result = parseCsv(Buffer.from('transaction,amount\n10001,10\n10002,12\n10003,14\n10004,16\n10005,18'));
    expect(result.columns[0]?.type).toBe('category');
    expect(result.columns[0]?.rationale).toMatch(/unique integer/i);
    expect(result.columns[1]?.type).toBe('number');
  });

  it('enforces the source-row and column limits with actionable errors', () => {
    let rowLimitError: unknown;
    try { parseCsv(Buffer.from(`id\n${Array.from({ length: 50_001 }, () => '1').join('\n')}`)); } catch (error) { rowLimitError = error; }
    expect(rowLimitError).toMatchObject({ status: 413, code: 'ROW_LIMIT' });

    const tooManyColumns = `${Array.from({ length: 101 }, (_, index) => `column_${index + 1}`).join(',')}\n${Array.from({ length: 101 }, () => 'x').join(',')}`;
    let columnLimitError: unknown;
    try { parseCsv(Buffer.from(tooManyColumns)); } catch (error) { columnLimitError = error; }
    expect(columnLimitError).toMatchObject({ status: 400, code: 'COLUMN_LIMIT' });
  });

  it('rejects empty, binary, invalid UTF-8, malformed EOF quoting, and oversized uploads with clear errors', async () => {
    const { agent } = await signedIn();
    const upload = (buffer: Buffer, fileName = 'upload.csv') => agent.post('/api/datasets').set('Origin', origin).attach('file', buffer, { filename: fileName, contentType: 'text/csv' });
    const empty = await upload(Buffer.from(''));
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('EMPTY_FILE');
    const binary = await upload(Buffer.from([0x00, 0x01, 0x02, 0xff]));
    expect(binary.status).toBe(400);
    expect(binary.body.error.code).toBe('UNSUPPORTED_FILE');
    const invalidUtf8 = await upload(Buffer.from([0x68, 0x65, 0x61, 0x64, 0x65, 0x72, 0x0a, 0xc3, 0x28]));
    expect(invalidUtf8.status).toBe(400);
    expect(invalidUtf8.body.error.code).toBe('INVALID_UTF8');
    const unclosed = await upload(Buffer.from('name,value\nAda,"not closed'));
    expect(unclosed.status).toBe(400);
    expect(['MALFORMED_CSV', 'EMPTY_FILE']).toContain(unclosed.body.error.code);
    const tooLarge = await upload(Buffer.alloc(5 * 1024 * 1024 + 1, 0x61));
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('reports recoverable malformed records separately and keeps subsequent rows', async () => {
    const { agent } = await signedIn();
    const csv = 'name,amount\nAda,10\nB"ob,11\nGrace,12';
    const response = await agent.post('/api/datasets').set('Origin', origin).attach('file', Buffer.from(csv), { filename: 'messy.csv', contentType: 'text/plain' });
    expect(response.status).toBe(201);
    expect(response.body.dataset.sourceRecordCount).toBe(3);
    expect(response.body.dataset.parsedRowCount).toBe(2);
    expect(response.body.dataset.rejectedRowCount).toBe(1);
    const detail = await agent.get(`/api/datasets/${response.body.dataset.id}/warnings`);
    expect(detail.body.total).toBe(1);
    expect(detail.body.warnings[0].rejectionReason).toMatch(/Malformed CSV/);
    expect(detail.body.warnings[0].sourceLine).toBe(3);
    const preview = await agent.get(`/api/datasets/${response.body.dataset.id}/preview`);
    expect(preview.body.rows).toHaveLength(3);
    expect(preview.body.rows[2].values).toEqual(['Grace', '12']);
  });

  it('accepts the messy CSV via multipart upload and exposes its profile and preview only to its owner', async () => {
    const { user: owner, agent: ownerAgent } = await signedIn('owner-csv@example.com');
    const { agent: otherAgent } = await signedIn('other-csv@example.com');
    const response = await ownerAgent.post('/api/datasets').set('Origin', origin).attach('file', Buffer.from(messy), { filename: 'quality.csv', contentType: 'text/csv' });
    expect(response.status).toBe(201);
    const dataset = response.body.dataset;
    expect(dataset.originalFileName).toBe('quality.csv');
    expect(dataset.columns.map((column: { type: string }) => column.type)).toEqual(['category', 'category', 'date', 'number', 'text', 'text']);
    expect(dataset.columns[0].rationale).toMatch(/identifier/i);
    expect(dataset.columns[2].invalidCount).toBe(1);
    expect(dataset.columns[3].invalidCount).toBe(1);
    expect(dataset.sourceRecordCount).toBe(7);
    expect(dataset.parsedRowCount).toBe(6);
    expect(dataset.rejectedRowCount).toBe(1);
    expect((await ownerAgent.get('/api/datasets')).body.datasets).toHaveLength(1);
    const preview = await ownerAgent.get(`/api/datasets/${dataset.id}/preview`);
    expect(preview.body.rows[0].values[4]).toBe('quoted, comma');
    expect(preview.body.rows[1].values[4]).toBe('line one\nline two');
    expect(preview.body.rows[0].values[0]).toBe('00123');
    expect((await ownerAgent.get(`/api/datasets/${dataset.id}/warnings`)).body.total).toBe(3);
    expect((await otherAgent.get('/api/datasets')).body.datasets).toHaveLength(0);
    expect((await otherAgent.get(`/api/datasets/${dataset.id}`)).status).toBe(404);
    expect((await otherAgent.get(`/api/datasets/${dataset.id}/preview`)).status).toBe(404);
    expect((await otherAgent.get(`/api/datasets/${dataset.id}/warnings`)).status).toBe(404);
    expect((await request(app).get(`/api/datasets/${dataset.id}/preview`)).status).toBe(401);
    const stored = await prisma.dataset.findFirst({ where: { id: dataset.id, userId: owner.id }, include: { rows: true } });
    expect(stored?.rows).toHaveLength(7);
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it('does not trust filename or browser MIME and rejects a text file that is not valid CSV', async () => {
    const { agent } = await signedIn();
    const response = await agent.post('/api/datasets').set('Origin', origin).attach('file', Buffer.from('one line only'), { filename: 'report.exe', contentType: 'application/octet-stream' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('EMPTY_FILE');
  });
});
