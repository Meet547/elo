import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { isolatedDatabaseUrl } from './lib/test-database.mjs';
assert.equal(process.env.ELO_TEST_DATABASE, '1', 'run through the isolated test harness');
const url = isolatedDatabaseUrl(process.env.TEST_DATABASE_URL);
for (const rejected of ['file:/tmp/example.db', 'postgresql://example.com/elo_test', 'postgresql://localhost/production']) {
  assert.throws(() => isolatedDatabaseUrl(rejected));
}
const db = new PrismaClient({ datasourceUrl: url });
try {
  const migrations = await db.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
  assert(migrations.some(row => row.migration_name === '20261108010000_postgres_initial'));
  const id = 'fixture-' + randomUUID();
  await db.player.create({ data: { id, name: 'Isolated fixture' } });
  assert.equal((await db.player.findUniqueOrThrow({ where: { id } })).rating, 1200);
  const rolledBack = 'rolled-back-' + randomUUID();
  await assert.rejects(db.$transaction(async tx => {
    await tx.player.create({ data: { id: rolledBack, name: 'Rollback fixture' } });
    throw new Error('deliberate transaction rollback');
  }), /deliberate transaction rollback/);
  assert.equal(await db.player.findUnique({ where: { id: rolledBack } }), null);
  console.log('PASS — committed Postgres migration, isolated writes, transaction rollback and remote-database refusal');
} finally { await db.$disconnect(); }
