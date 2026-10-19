import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

const COST = 12;
export const MAX_PASSWORD_BYTES = 72;
const dummyHashPromise = bcrypt.hash(randomBytes(32).toString('hex'), COST);

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export async function verifyPassword(password: string, encodedHash: string | null): Promise<boolean> {
  return bcrypt.compare(password, encodedHash ?? await dummyHashPromise);
}
