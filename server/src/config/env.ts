import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1).default('file:./dev.db'),
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error('Invalid environment configuration:', result.error.flatten().fieldErrors);
  throw new Error('Server configuration is invalid. Check the environment variables.');
}

export const env = result.data;
