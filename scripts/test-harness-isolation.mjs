import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {isolatedDatabaseUrl} from './lib/test-database.mjs';
assert.equal(process.env.ELO_TEST_DATABASE,'1');
const base=isolatedDatabaseUrl(process.env.DATABASE_URL);
const harness=process.env.ELO_BASELINE_HARNESS??'scripts/with-test-postgres.mjs';
for(let i=0;i<2;i++){
 const result=spawnSync(process.execPath,[harness,process.execPath,'scripts/fixtures/harness-isolation-child.mjs'],{env:{...process.env,TEST_DATABASE_URL:base},encoding:'utf8'});
 assert.equal(result.status,0,`isolated command ${i+1} failed: ${result.stderr}`);
}
const db=new PrismaClient();
try{assert.equal(await db.player.count(),0,'shared CI service base must stay untouched');}finally{await db.$disconnect();}
console.log('PASS — successive commands on shared CI infrastructure use independent databases and leave the base untouched');
