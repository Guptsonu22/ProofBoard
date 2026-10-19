import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1).default('file:./dev.db'),
  SESSION_SECRET: z.string().min(32),
}).superRefine((values, context) => {
  if (values.NODE_ENV === 'production' && values.SESSION_SECRET.startsWith('proofboard-local-development-placeholder-')) {
    context.addIssue({ code: 'custom', path: ['SESSION_SECRET'], message: 'Set a unique production session secret.' });
  }
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error('Invalid environment configuration:', result.error.flatten().fieldErrors);
  throw new Error('Server configuration is invalid. Check the environment variables.');
}

export const env = result.data;
