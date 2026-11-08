import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Configuration-only test: never opens a database socket or reads a real .env.
const result = spawnSync(process.execPath, ['-e', 'const {db}=await import("./backend/src/lib/db"); await db.$disconnect();'], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: 'postgresql://fixture@127.0.0.1:1/elo_test_configuration', DIRECT_DATABASE_URL: 'postgresql://fixture@127.0.0.1:1/elo_test_configuration' },
  encoding: 'utf8',
});
assert.equal(result.status, 0, `Postgres configuration must be accepted without opening a connection:\n${result.stderr}`);
console.log('PASS — Postgres configuration accepted without database access');
