import cors from 'cors';
import express from 'express';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { sameOriginGuard } from './auth/csrf.js';
import { authRouter } from './auth/routes.js';
import { PrismaSessionStore } from './auth/session-store.js';
import { sessionCookieOptions } from './auth/session-options.js';
import { prisma } from './db/client.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { resourcesRouter } from './resources/routes.js';
import { datasetsRouter } from './datasets/routes.js';
import { reportsRouter } from './reports/routes.js';
import { publicShareRouter, sharingRouter } from './shares/routes.js';

export const app = express();
app.disable('x-powered-by');
app.use((_request, response, next) => {
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
  );
  next();
});
// The production server binds to loopback behind one TLS-terminating proxy.
// Trust only that proxy hop so Secure cookies work without trusting client headers directly.
if (env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(session({
  name: 'proofboard.sid',
  secret: env.SESSION_SECRET,
  store: new PrismaSessionStore(prisma),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: sessionCookieOptions(env.NODE_ENV),
}));
app.use(sameOriginGuard);

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/datasets', datasetsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/reports', sharingRouter);
app.use('/api/share', publicShareRouter);
app.use('/api', resourcesRouter);

if (env.NODE_ENV === 'production') {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const clientDist = path.resolve(here, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*splat', (_request, response, next) => {
    response.sendFile(path.join(clientDist, 'index.html'), (error) => { if (error) next(error); });
  });
}

app.use(notFoundHandler);
app.use(errorHandler);
