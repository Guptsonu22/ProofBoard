import { app } from './app.js';
import { env } from './config/env.js';

const server = app.listen(env.PORT, '127.0.0.1', () => {
  console.info(`ProofBoard API listening at http://127.0.0.1:${env.PORT}`);
});

function shutDown(signal: string) {
  console.info(`${signal} received; closing HTTP server.`);
  server.close((error) => {
    if (error) {
      console.error('Could not close HTTP server cleanly:', error);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', () => shutDown('SIGINT'));
process.on('SIGTERM', () => shutDown('SIGTERM'));
