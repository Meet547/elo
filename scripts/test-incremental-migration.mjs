import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { isolatedDatabaseUrl } from './lib/test-database.mjs';

assert.equal(process.env.ELO_TEST_DATABASE, '1');
const client = new Client({ connectionString: isolatedDatabaseUrl(process.env.DATABASE_URL) });
const schema = `elo_upgrade_${randomBytes(8).toString('hex')}`;
await client.connect();
try {
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  const migrations = (await readdir('prisma/migrations', { withFileTypes: true }))
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  const latest = migrations.pop();
  assert.equal(latest, '20261108160000_private_history');
  const apply = async directory => client.query(await readFile(`prisma/migrations/${directory}/migration.sql`, 'utf8'));
  for (const migration of migrations) await apply(migration);

  await client.query(`INSERT INTO "Player" ("id","name","rating") VALUES ('existing-player','Preserved player',1325)`);
  const state = JSON.stringify({ fair: { round: { context: "upgrade-context" } } });
  await client.query(`INSERT INTO "LiveRoom" ("code","state","expiresAt") VALUES ('UPGRAD',$1,NOW()+interval '1 hour')`, [state]);
  await client.query(`INSERT INTO "FairHand" ("handId","roomCode","handNo","publicData","auditData")
    VALUES ('old-hand','UPGRAD',1,'{}','{"round":{"context":"upgrade-context"}}')`);
  await client.query(`INSERT INTO "Session" ("id","playerId","hands","finalStack","net","place","ratingBefore","ratingAfter")
    VALUES ('old-result','existing-player',10,1550,50,1,1300,1325)`);
  await apply(latest);
  const { rows: [record] } = await client.query(`SELECT room."instanceId",hand."roomInstanceId",player."rating",history."ratingAfter"
    FROM "LiveRoom" room JOIN "FairHand" hand ON hand."roomCode"=room."code"
    CROSS JOIN "Player" player JOIN "Session" history ON history."playerId"=player."id"`);
  assert.match(record.instanceId, /^[a-f0-9-]{36}$/);
  assert.equal(record.roomInstanceId, record.instanceId);
  assert.equal(record.rating, 1325);
  assert.equal(record.ratingAfter, 1325);
  console.log('PASS — previous Postgres schema upgrades with existing hand, room and rating history intact');
} finally {
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.end();
}
