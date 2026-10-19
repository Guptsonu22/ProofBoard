import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './app.js';

describe('HTTP foundation', () => {
  it('returns a timestamped health response', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(Number.isNaN(Date.parse(response.body.timestamp))).toBe(false);
  });

  it('returns consistent JSON for an unknown API route', async () => {
    const response = await request(app).get('/api/missing');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' } });
  });
});

afterAll(() => {
  // The test imports the app without opening a listening socket.
});
