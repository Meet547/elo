import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Client } from 'pg';
import { db } from '../backend/src/lib/db';
import { createActiveRankedMatch } from '../backend/src/lib/match-state';
import { readLiveRoom, roomRecord } from '../backend/src/lib/live-rooms';
import { advanceLiveTable, applyLiveCommand, newRankedTable } from '../src/lib/poker/live-table';
import { isolatedDatabaseUrl } from './lib/test-database.mjs';
assert.equal(process.env.ELO_TEST_DATABASE, '1');
const url = isolatedDatabaseUrl(process.env.DATABASE_URL);
const control = new Client({ connectionString: url });
await control.connect();
const key = randomInt(1, 2_000_000_000);
const suffix = randomUUID().replaceAll('-', '');
const trigger = `elo_test_pause_${suffix}`;
let child: ReturnType<typeof spawn> | undefined;
let locked = false;
try {
  const players = await Promise.all(['A','B'].map(name => db.player.create({data:{id:randomUUID(),name:`Crash fixture ${name}`}})));
  let time = Date.now() - 120_000;
  const table = newRankedTable(players[0], players[1], time);
  for (let hand = 1; hand <= 10; hand++) {
    while (table.game!.phase === 'betting') {
      const actor = table.game!.toAct;
      const error = applyLiveCommand(table, players[actor], {type:'act',action:{type:'fold'}}, time);
      assert.equal(error,null);
    }
    if(hand<10){time=table.nextAt!;assert(advanceLiveTable(table,time));}
  }
  assert.equal(table.ranked!.completedHands,9);
  const matchId = await db.$transaction(async tx => {
    const id = await createActiveRankedMatch(tx,players,new Date(time));
    // Fixture arrangement at the tenth hand; production actions use guarded progression.
    await tx.match.update({where:{id},data:{handNumber:10}});
    return id;
  });
  table.ranked!.matchId=matchId;
  table.nextAt=Date.now()-1;
  const row=await db.liveRoom.create({data:roomRecord(table,matchId)});
  // A database trigger pauses the real settlement inside its first history insert.
  // No crash hooks or delays are added to application code.
  await control.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."matchId" = '${matchId}' THEN PERFORM pg_advisory_xact_lock(${key}::bigint); END IF; RETURN NEW; END $$`);
  await control.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON "Session" FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
  await control.query('SELECT pg_advisory_lock($1::bigint)',[key]);locked=true;
  child=spawn(process.execPath,['--conditions=react-server','scripts/fixtures/settlement-crash-child.ts',row.code,players[0].id],{env:process.env,stdio:['ignore','ignore','pipe']});
  let paused=false;
  for(let attempt=0;attempt<100;attempt++){
    const result=await control.query('SELECT count(*)::int AS count FROM pg_locks WHERE locktype = \'advisory\' AND objid = $1::oid AND NOT granted',[key]);
    if(result.rows[0].count>0){paused=true;break;}
    if(child.exitCode!==null)break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert(paused,'child must enter the real uncommitted settlement');
  const visible=await db.player.findUniqueOrThrow({where:{id:players[0].id}});
  assert.equal(visible.rankedPlacements,0);
  assert.equal(visible.rated,0,'uncommitted rating must not be visible to another connection');
  assert.equal(await db.session.count({where:{matchId}}),0);
  assert.equal(await db.matchSettlement.count({where:{matchId}}),0);
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  await control.query('SELECT pg_advisory_unlock($1::bigint)',[key]);locked=false;
  await control.query(`DROP TRIGGER ${trigger} ON "Session"`);
  await control.query(`DROP FUNCTION ${trigger}()`);
  assert.equal((await db.player.findUniqueOrThrow({where:{id:players[0].id}})).rankedPlacements,0);
  assert.equal((await db.player.findUniqueOrThrow({where:{id:players[0].id}})).rated,0);
  assert.equal((await db.match.findUniqueOrThrow({where:{id:matchId}})).state,'ACTIVE');
  assert.equal((await db.liveRoom.findUniqueOrThrow({where:{code:row.code}})).revision,row.revision);
  assert.equal(await db.session.count({where:{matchId}}),0);
  assert.equal(await db.matchSettlement.count({where:{matchId}}),0);
  const recovered=await readLiveRoom(row.code,players[0].id);
  assert.equal(recovered!.status,'finished');
  assert.equal(await db.session.count({where:{matchId}}),2);
  assert.equal(await db.matchSettlement.count({where:{matchId}}),1);
  assert.equal((await db.player.findUniqueOrThrow({where:{id:players[0].id}})).rankedPlacements,1);
  assert.equal((await db.player.findUniqueOrThrow({where:{id:players[0].id}})).rated,1);
  console.log('PASS — SIGKILL during real settlement exposes no partial writes; restart settles once');
} finally {
  if(child && child.exitCode===null && child.signalCode===null)child.kill('SIGKILL');
  if(locked)await control.query('SELECT pg_advisory_unlock($1::bigint)',[key]);
  await control.query(`DROP TRIGGER IF EXISTS ${trigger} ON "Session"`);
  await control.query(`DROP FUNCTION IF EXISTS ${trigger}()`);
  await control.end();await db.$disconnect();
}
