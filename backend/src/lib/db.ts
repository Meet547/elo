import { PrismaClient } from '@prisma/client';
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const dbEnabled = true;
const configured = process.env.DATABASE_URL;
if (!configured || !/^postgres(?:ql)?:\/\//.test(configured)) throw new Error('DATABASE_URL must configure Postgres. SQLite is supported only by the isolated import tool.');
export const db = globalForPrisma.prisma ?? new PrismaClient({
  datasourceUrl: configured,
  log: ['error'],
});
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
