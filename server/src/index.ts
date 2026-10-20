import { app } from './app.js';
import { env } from './config/env.js';

const host = process.env.HOST ?? (env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const server = app.listen(env.PORT, host, () => {
  console.info(`ProofBoard API listening at http://${host}:${env.PORT}`);
});

function shutDown(signal: string) {
  console.info(`${signal} received; closing HTTP server.`);
  server.close((error?: Error) => {
    if (error) {
      console.error('Could not close HTTP server cleanly:', error);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', () => shutDown('SIGINT'));
process.on('SIGTERM', () => shutDown('SIGTERM'));
