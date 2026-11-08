import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../backend/src/lib/db';
import { updateRankedQueue } from '../backend/src/lib/ranked-queue';
import { commandLiveRoom, readLiveRoom } from '../backend/src/lib/live-rooms';
import { transitionMatch } from '../backend/src/lib/match-state';
import type { LiveCommand } from '../src/lib/poker/live-table';
import { isolatedDatabaseUrl } from './lib/test-database.mjs';
assert.equal(process.env.ELO_TEST_DATABASE, '1');
isolatedDatabaseUrl(process.env.DATABASE_URL);
const now = Date.now;
let clock = now();
Date.now = () => clock;
try {
  const players = await Promise.all(['A','B'].map(name => db.player.create({ data: { id: randomUUID(), name: `Replay fixture ${name}`, nameKey: `replay fixture ${name.toLowerCase()}`, identities: {create:{provider:"google",subject:randomUUID(),email:`${name}@fixture.example`}} } })));
  await updateRankedQueue(players[0].id, 'join');
  const matched = await updateRankedQueue(players[1].id, 'join');
  assert.equal(matched?.status, 'matched');
  if (matched?.status !== 'matched') throw new Error('Fixture did not match');
  const code = matched.code;
  let room = (await readLiveRoom(code, players[0].id))!;
  const hostSeat = room.me;
  for (let step = 0; room.status !== 'finished' && step < 100; step++) {
    if (room.game!.phase === 'betting') {
      const hostActing = room.game!.toAct === hostSeat;
      const result = await commandLiveRoom(code, players[hostActing ? 0 : 1].id, room.revision, {
        type: 'act', action: hostActing ? { type: 'raise', to: room.game!.legal!.maxRaiseTo } : { type: 'fold' },
      });
      assert.equal(result.status, 200);
    } else { clock = room.nextAt!; }
    room = (await readLiveRoom(code, players[0].id))!;
  }
  assert.equal(room.ranked!.completedHands, 10);
  assert.equal(room.status, 'finished');
  const before = await db.player.findUniqueOrThrow({ where: { id: players[0].id } });
  const beforeHistory = await db.session.count({ where: { playerId: players[0].id } });
  assert.equal(before.rankedPlacements, 1); assert.equal(before.rated, 1); assert.equal(beforeHistory, 1);
  const replay = await commandLiveRoom(code, players[0].id, room.revision, { type: 'join' });
  const after = await db.player.findUniqueOrThrow({ where: { id: players[0].id } });
  assert.equal(after.rankedPlacements, before.rankedPlacements);
  assert.equal(after.rated, before.rated, 'F1: a completed match must not increment rated count on join replay');
  assert.equal(after.rating, before.rating, 'F1: a completed match must not apply rating again');
  assert.equal(await db.session.count({ where: { playerId: players[0].id } }), beforeHistory);
  assert.equal(replay.status, 409, 'terminal commands must reject without mutation');
  const matchId = room.ranked!.matchId!;
  assert(matchId);
  assert.equal((await db.match.findUniqueOrThrow({where:{id:matchId}})).state,'SETTLED');
  const commands: LiveCommand[] = [{type:'join'},{type:'leave'},{type:'start'},{type:'act',action:{type:'fold'}},{type:'act',action:{type:'raise',to:1500}}];
  // Mix current/stale revisions, both participants and parallel commands.
  for(let batch=0;batch<10;batch++){
    const responses=await Promise.all(Array.from({length:100},(_,i)=>commandLiveRoom(code,players[i%2].id,i%2?room.revision:0,commands[i%commands.length])));
    assert(responses.every(response=>response.status===409));
  }
  const final = await db.player.findUniqueOrThrow({where:{id:players[0].id}});
  assert.equal(final.rated,before.rated);assert.equal(final.rating,before.rating);
  assert.equal(await db.session.count({where:{matchId}}),2);
  assert.equal(await db.matchSettlement.count({where:{matchId}}),1);
  assert.equal((await db.liveRoom.findUniqueOrThrow({where:{code}})).revision,room.revision);
  const history=await db.session.findFirstOrThrow({where:{matchId}});
  await assert.rejects(db.session.create({data:{...history,id:randomUUID()}}),error=>(error as {code?:string}).code==='P2002');
  await assert.rejects(db.matchSettlement.create({data:{matchId,algorithmVersion:'duplicate',result:{duplicate:true}}}),error=>(error as {code?:string}).code==='P2002');
  await assert.rejects(db.$transaction(tx=>transitionMatch(tx,matchId,'SETTLED','ACTIVE')),/Invalid match transition/);
  assert.equal(await db.$transaction(tx=>transitionMatch(tx,matchId,'ACTIVE','SETTLING')),false);
  assert.equal(await db.matchTransition.count({where:{matchId}}),5);
  console.log('PASS — reviewed ranked fixture, 1,000 terminal replays, conditional states and unique settlement/history');
} finally { Date.now = now; await db.$disconnect(); }
