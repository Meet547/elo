import { PrismaClient } from '@prisma/client';
import { resolve } from 'node:path';
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const dbEnabled = true;
const configured = process.env.DATABASE_URL || 'file:./db/custom.db';
if (!configured.startsWith('file:')) throw new Error('This deployment requires a persistent SQLite file URL.');
const filename = configured.slice(5);
export const db = globalForPrisma.prisma ?? new PrismaClient({
  datasourceUrl: `file:${resolve(filename)}`,
  log: ['error'],
});
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
