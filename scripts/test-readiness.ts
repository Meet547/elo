import assert from 'node:assert/strict';
import {db} from '../backend/src/lib/db';
import {GET} from '../backend/src/app/api/health/route';
import {isolatedDatabaseUrl} from './lib/test-database.mjs';
assert.equal(process.env.ELO_TEST_DATABASE,'1');isolatedDatabaseUrl(process.env.DATABASE_URL);
try{
 const ready=await GET();assert.equal(ready.status,200);
 assert.equal((await ready.json()).mode,'postgresql','readiness must identify the actual persistence provider');
 await db.$executeRaw`UPDATE "_prisma_migrations" SET rolled_back_at = NOW() WHERE migration_name = '20261108120000_fair_hand_archive'`;
 assert.equal((await GET()).status,503,'missing required migration must fail readiness');
 await db.$executeRaw`UPDATE "_prisma_migrations" SET rolled_back_at = NULL WHERE migration_name = '20261108120000_fair_hand_archive'`;
 assert.equal((await GET()).status,200);
 console.log('PASS — Postgres readiness requires the committed schema and recovers after metadata restoration');
}finally{await db.$disconnect();}
