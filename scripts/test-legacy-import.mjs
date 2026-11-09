import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,chmodSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {Client} from 'pg';
import {DatabaseSync} from 'node:sqlite';
import {readLegacy,importLegacy,summary,targetSummary} from './migration/import-sqlite.mjs';
import {isolatedDatabaseUrl} from './lib/test-database.mjs';
assert.equal(process.env.ELO_TEST_DATABASE,'1');
const connection=isolatedDatabaseUrl(process.env.DATABASE_URL);
let fixture=process.env.LEGACY_SQLITE_COPY;
const client=new PrismaClient();
const admin=new Client({connectionString:connection});
const restoreName=`elo_test_restore_${randomBytes(6).toString('hex')}`;
const directory=mkdtempSync(join(tmpdir(),'elo-migration-'));chmodSync(directory,0o700);
const backup=join(directory,'backup.dump');
if(!fixture){
 fixture=join(directory,'fixture.db');
 const sqlite=new DatabaseSync(fixture);
 sqlite.exec(readFileSync('prisma/legacy-sqlite/migrations/20261108000000_initial/migration.sql','utf8'));
 sqlite.exec(`INSERT INTO Player (id,name,createdAt,lastSeen) VALUES ('preserved-1','Same legacy name',1700000000000,1700000000001),('preserved-2','Same legacy name',1700000000000,1700000000002);
 INSERT INTO Session (id,playerId,hands,finalStack,net,place,ratingBefore,ratingAfter,createdAt) VALUES ('old-result','preserved-1',10,1700,200,1,1200,1220,1700000000000);`);
 sqlite.close();chmodSync(fixture,0o600);
}
const url=new URL(connection);
const pgEnv={...process.env,PGHOST:url.hostname,PGPORT:url.port,PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1))};
let restored;
let adminConnected=false;
try{
 const data=readLegacy(fixture);const expected=summary(data);
 assert.deepEqual(await importLegacy(client,data),expected);
 await assert.rejects(importLegacy(client,data),/empty/);
 assert.deepEqual(await targetSummary(client),expected,'repeated import must not overwrite or duplicate history');
 const container=process.env.ELO_TEST_POSTGRES_CONTAINER;
 const dump=container?spawnSync('docker',['exec','-e','PGPASSWORD',container,'pg_dump','--username',pgEnv.PGUSER,'--dbname',pgEnv.PGDATABASE,'--format=custom','--no-owner'],{env:pgEnv,maxBuffer:64*1024*1024}):spawnSync('pg_dump',['--format=custom','--no-owner','--file',backup],{env:pgEnv,encoding:'utf8'});
 if(container&&dump.status===0)writeFileSync(backup,dump.stdout,{mode:0o600});
 assert.equal(dump.status,0,'pg_dump failed; ensure a compatible PostgreSQL client is installed');chmodSync(backup,0o600);
 await admin.connect();adminConnected=true;await admin.query(`CREATE DATABASE "${restoreName}"`);
 const restore=container?spawnSync('docker',['exec','-i','-e','PGPASSWORD',container,'pg_restore','--username',pgEnv.PGUSER,'--no-owner','--no-acl','--exit-on-error','--dbname',restoreName],{env:pgEnv,input:readFileSync(backup),maxBuffer:64*1024*1024}):spawnSync('pg_restore',['--no-owner','--no-acl','--exit-on-error','--dbname',restoreName,backup],{env:{...pgEnv,PGDATABASE:restoreName},encoding:'utf8'});
 assert.equal(restore.status,0,'pg_restore into fresh isolated database failed');
 const restoredUrl=new URL(connection);restoredUrl.pathname=`/${restoreName}`;
 isolatedDatabaseUrl(restoredUrl.toString());
 restored=new PrismaClient({datasourceUrl:restoredUrl.toString()});
 assert.deepEqual(await targetSummary(restored),expected,'fresh restore must preserve all IDs, values, timestamps and history hashes');
 console.log(`PASS — SQLite copy import and fresh Postgres restore; players=${expected.players.count}, history=${expected.sessions.count}, rooms=${expected.rooms.count}; exact hashes match`);
}finally{
 await restored?.$disconnect();await client.$disconnect();
 if(adminConnected){await admin.query(`DROP DATABASE IF EXISTS "${restoreName}" WITH (FORCE)`);await admin.end();}
 rmSync(directory,{recursive:true,force:true});
}
