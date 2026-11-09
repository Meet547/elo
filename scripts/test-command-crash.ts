import assert from 'node:assert/strict';
import {randomInt,randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Client} from 'pg';
import {NextRequest} from 'next/server';
import {db} from '../backend/src/lib/db';
import {POST} from '../backend/src/app/api/live/route';
import {signSession,SESSION_COOKIE} from '../backend/src/lib/session';
import {isolatedDatabaseUrl} from './lib/test-database.mjs';
assert.equal(process.env.ELO_TEST_DATABASE,'1');const url=isolatedDatabaseUrl(process.env.DATABASE_URL);process.env.SESSION_SECRET=randomBytes(32).toString('hex');
const control=new Client({connectionString:url});await control.connect();
const lock=randomInt(1,2_000_000_000),key=randomUUID(),trigger=`elo_test_command_${randomBytes(8).toString('hex')}`;
let child:ReturnType<typeof spawn>|undefined,locked=false;
try{
 const actor=await db.player.create({data:{name:'Command crash fixture'}});
 await control.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${lock}::bigint); RETURN NEW; END $$`);
 await control.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON "CommandReceipt" FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
 await control.query('SELECT pg_advisory_lock($1::bigint)',[lock]);locked=true;
 child=spawn(process.execPath,['--conditions=react-server','scripts/fixtures/command-crash-child.ts',actor.id,key],{env:process.env,stdio:'ignore'});
 let paused=false;
 for(let attempt=0;attempt<100;attempt++){
  const waits=await control.query("SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND objid=$1::oid AND NOT granted",[lock]);
  if(waits.rows[0].count){paused=true;break;}
  if(child.exitCode!==null)break;
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 assert(paused,'child must pause after room creation before command receipt insertion');
 assert.equal(await db.liveRoom.count(),0);assert.equal(await db.commandReceipt.count(),0);
 const exited=once(child,'exit');child.kill('SIGKILL');await exited;
 await control.query('SELECT pg_advisory_unlock($1::bigint)',[lock]);locked=false;
 await control.query(`DROP TRIGGER ${trigger} ON "CommandReceipt"`);await control.query(`DROP FUNCTION ${trigger}()`);
 assert.equal(await db.liveRoom.count(),0);assert.equal(await db.rateWindow.count(),0);
 const request=()=>new NextRequest('https://fixture.example/api/live',{method:'POST',headers:{cookie:`${SESSION_COOKIE}=${signSession(actor.id)}`,'idempotency-key':key,'x-elo-client-ip':'command-crash'}});
 const first=await POST(request());assert.equal(first.status,201);const result=await first.json();
 assert.deepEqual(await (await POST(request())).json(),result);assert.equal(await db.liveRoom.count(),1);assert.equal(await db.commandReceipt.count(),1);
 console.log('PASS — SIGKILL between game write and command receipt rolls back both, then retry applies once');
}finally{
 if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
 if(locked)await control.query('SELECT pg_advisory_unlock($1::bigint)',[lock]);
 await control.query(`DROP TRIGGER IF EXISTS ${trigger} ON "CommandReceipt"`);await control.query(`DROP FUNCTION IF EXISTS ${trigger}()`);
 await control.end();await db.$disconnect();
}
