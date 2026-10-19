import { prisma } from '../db/client.js';
import { hashPassword } from '../auth/password.js';

export const fixturePassword = 'correct horse battery staple 2026';

export async function createUserFixture(email: string) {
  return prisma.user.create({
    data: { email, passwordHash: await hashPassword(fixturePassword) },
  });
}

export async function clearTestDatabase() {
  await prisma.shareLink.deleteMany();
  await prisma.authSession.deleteMany();
  await prisma.report.deleteMany();
  await prisma.datasetRow.deleteMany();
  await prisma.dataset.deleteMany();
  await prisma.user.deleteMany();
}
