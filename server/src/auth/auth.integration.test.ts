import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { prisma } from '../db/client.js';
import { sessionCookieOptions } from './session-options.js';
import { clearTestDatabase, createUserFixture, fixturePassword } from '../test/fixtures.js';

const origin = env.CLIENT_ORIGIN;

describe('authentication and resource authorization', () => {
  beforeEach(clearTestDatabase);
  afterAll(async () => { await prisma.$disconnect(); });

  it('validates registration, stores only a password hash, and starts a cookie session', async () => {
    const agent = request.agent(app);
    const invalid = await agent.post('/api/auth/register').set('Origin', origin).send({ email: 'bad-email', password: 'short' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const response = await agent.post('/api/auth/register').set('Origin', origin).send({ email: 'New.User@example.com', password: fixturePassword });
    expect(response.status).toBe(201);
    expect(response.body.user.email).toBe('new.user@example.com');
    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Lax');

    const user = await prisma.user.findUnique({ where: { email: 'new.user@example.com' } });
    expect(user?.passwordHash).not.toBe(fixturePassword);
    expect(user?.passwordHash).toMatch(/^\$2[aby]\$/);
    expect((await agent.get('/api/auth/me')).body.user.id).toBe(user?.id);
  });

  it('uses the same generic login error for an unknown email and a wrong password', async () => {
    await createUserFixture('existing@example.com');
    const agent = request.agent(app);
    const unknown = await agent.post('/api/auth/login').set('Origin', origin).send({ email: 'missing@example.com', password: fixturePassword });
    const wrong = await agent.post('/api/auth/login').set('Origin', origin).send({ email: 'existing@example.com', password: 'this password is incorrect' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);

    const valid = await agent.post('/api/auth/login').set('Origin', origin).send({ email: 'EXISTING@example.com', password: fixturePassword });
    expect(valid.status).toBe(200);
    expect(valid.body.user).not.toHaveProperty('passwordHash');
  });

  it('persists sessions in SQLite and destroys them on logout', async () => {
    const fixture = await createUserFixture('session@example.com');
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').set('Origin', origin).send({ email: fixture.email, password: fixturePassword });
    expect(login.status).toBe(200);

    const storedSession = await prisma.authSession.findFirst({ where: { userId: fixture.id } });
    expect(storedSession).not.toBeNull();
    expect(storedSession?.data).toContain(fixture.id);

    const cookieHeader = String(login.headers['set-cookie'][0]).split(';', 1)[0];
    const restartedClient = request.agent(app);
    const restored = await restartedClient.get('/api/auth/me').set('Cookie', cookieHeader);
    expect(restored.status).toBe(200);
    expect(restored.body.user.id).toBe(fixture.id);

    const loggedOut = await agent.post('/api/auth/logout').set('Origin', origin);
    expect(loggedOut.status).toBe(204);
    expect(await prisma.authSession.count({ where: { userId: fixture.id } })).toBe(0);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('limits private resource reads, edits, deletes, and sharing to their owner', async () => {
    const owner = await createUserFixture('owner@example.com');
    const otherUser = await createUserFixture('other@example.com');
    const dataset = await prisma.dataset.create({ data: { userId: owner.id, name: 'Private dataset', originalFileName: 'private.csv' } });
    const report = await prisma.report.create({ data: { userId: owner.id, datasetId: dataset.id, name: 'Private report', definition: { groupBy: 'region' } } });
    const ownerAgent = request.agent(app);
    const otherAgent = request.agent(app);
    await ownerAgent.post('/api/auth/login').set('Origin', origin).send({ email: owner.email, password: fixturePassword });
    await otherAgent.post('/api/auth/login').set('Origin', origin).send({ email: otherUser.email, password: fixturePassword });

    expect((await ownerAgent.get(`/api/datasets/${dataset.id}`)).status).toBe(200);
    expect((await ownerAgent.get(`/api/reports/${report.id}`)).status).toBe(200);
    expect((await request(app).get(`/api/datasets/${dataset.id}`)).status).toBe(401);

    const datasetPath = `/api/datasets/${dataset.id}`;
    const reportPath = `/api/reports/${report.id}`;
    expect((await otherAgent.get(datasetPath)).status).toBe(404);
    expect((await otherAgent.patch(datasetPath).set('Origin', origin).send({ name: 'stolen' })).status).toBe(404);
    expect((await otherAgent.delete(datasetPath).set('Origin', origin)).status).toBe(404);
    expect((await otherAgent.get(reportPath)).status).toBe(404);
    expect((await otherAgent.patch(reportPath).set('Origin', origin).send({ name: 'stolen' })).status).toBe(404);
    expect((await otherAgent.delete(reportPath).set('Origin', origin)).status).toBe(404);
    expect((await otherAgent.post(`${reportPath}/share`).set('Origin', origin)).status).toBe(404);

    expect((await ownerAgent.get(datasetPath)).body.dataset.name).toBe('Private dataset');
    expect((await ownerAgent.get(reportPath)).body.report.name).toBe('Private report');
    expect(await prisma.shareLink.count()).toBe(0);
  });

  it('rejects state-changing requests that do not have the configured origin', async () => {
    const response = await request(app).post('/api/auth/login').send({ email: 'test@example.com', password: fixturePassword });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CSRF_REJECTED');
  });

  it('sets HTTP-only same-site cookies and enables Secure in production', () => {
    expect(sessionCookieOptions('test')).toMatchObject({ httpOnly: true, secure: false, sameSite: 'lax', path: '/' });
    expect(sessionCookieOptions('production')).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
  });
});
