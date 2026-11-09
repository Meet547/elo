import {completeFairExchange} from './fixtures/complete-fair-exchange';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {db} from '../backend/src/lib/db';
import {updateRankedQueue} from '../backend/src/lib/ranked-queue';
import {readLiveRoom,commandLiveRoom} from '../backend/src/lib/live-rooms';
import {isolatedDatabaseUrl} from './lib/test-database.mjs';
assert.equal(process.env.ELO_TEST_DATABASE,'1');isolatedDatabaseUrl(process.env.DATABASE_URL);
try{
 const create=async()=>{const id=randomUUID();return db.player.create({data:{id,name:'Ready fixture',nameKey:id,identities:{create:{provider:'google',subject:id,email:`${id}@fixture.example`}}}});};
 const a=await create(),b=await create();await updateRankedQueue(a.id,'join');const match=await updateRankedQueue(b.id,'join');assert.equal(match?.status,'matched');
 if(match?.status!=='matched')throw new Error('fixture did not match');
 const room=await readLiveRoom(match.code,a.id);assert(room);
 assert.equal(room.game,null,'F6: proposing a match must not deal cards before both players confirm');
 console.log('PASS — ranked proposal deals no cards before readiness');
 const first=await commandLiveRoom(match.code,a.id,room.revision,{type:'ready',accept:true});assert.equal(first.status,200);
 const accepted=await readLiveRoom(match.code,b.id);assert(accepted);assert.equal(accepted.game,null);
 const realReadyNow=Date.now,lateConfirmation=accepted.ranked!.proposal!.deadline-1;
 try{
  Date.now=()=>lateConfirmation;
  const second=await commandLiveRoom(match.code,b.id,accepted.revision,{type:'ready',accept:true});assert.equal(second.status,200);
  const preparing=(await readLiveRoom(match.code,a.id))!;assert.equal(preparing.game,null);
  assert.equal(preparing.nextAt,lateConfirmation+15000,'a timely last confirmation gets a full independent seed-exchange window');
 }finally{Date.now=realReadyNow;}
 await completeFairExchange(match.code,[a,b]);
 const started=await readLiveRoom(match.code,a.id);assert(started?.game);assert.equal(started.game.handNo,1);
 const record=await db.liveRoom.findUniqueOrThrow({where:{code:match.code}});
 assert.equal((await db.match.findUniqueOrThrow({where:{id:record.matchId!}})).state,'ACTIVE');
 await db.rankedSeat.deleteMany();
 const c=await create(),d=await create();await updateRankedQueue(c.id,'join');const declined=await updateRankedQueue(d.id,'join');
 if(declined?.status!=='matched')throw new Error('decline fixture did not match');
 const original=await db.rankedSeat.findUniqueOrThrow({where:{playerId:c.id}});
 const before=await readLiveRoom(declined.code,d.id);assert(before);
 assert.equal((await commandLiveRoom(declined.code,d.id,before.revision,{type:'ready',accept:false})).status,200);
 const returned=await db.rankedSeat.findUniqueOrThrow({where:{playerId:c.id}});assert.equal(returned.roomCode,null);assert.equal(returned.joinedAt.getTime(),original.joinedAt.getTime());
 assert.equal(await db.rankedSeat.findUnique({where:{playerId:d.id}}),null);
 assert.equal((await db.player.findUniqueOrThrow({where:{id:c.id}})).rated,0);assert.equal(await db.session.count(),0);
 await db.rankedSeat.deleteMany();
 const e=await create(),f=await create();await updateRankedQueue(e.id,'join');const expiring=await updateRankedQueue(f.id,'join');
 if(expiring?.status!=='matched')throw new Error('timeout fixture did not match');
 let pending=(await readLiveRoom(expiring.code,e.id))!;
 await commandLiveRoom(expiring.code,e.id,pending.revision,{type:'ready',accept:true});
 pending=(await readLiveRoom(expiring.code,e.id))!;
 const realNow=Date.now;
 try{
  Date.now=()=>pending.ranked!.proposal!.deadline+1;
  const expired=await readLiveRoom(expiring.code,e.id);assert.equal(expired?.status,'closed');
 }finally{Date.now=realNow;}
 assert.equal((await db.rankedSeat.findUniqueOrThrow({where:{playerId:e.id}})).roomCode,null);
 assert.equal(await db.rankedSeat.findUnique({where:{playerId:f.id}}),null);
 assert.equal(await db.session.count(),0);
 await db.rankedSeat.deleteMany();
 const g=await create(),h=await create();await updateRankedQueue(g.id,'join');const cancelling=await updateRankedQueue(h.id,'join');
 assert.equal(cancelling?.status,'matched');assert.equal((await updateRankedQueue(h.id,'cancel'))?.status,'idle');
 assert.equal((await db.rankedSeat.findUniqueOrThrow({where:{playerId:g.id}})).roomCode,null);
 console.log('PASS — both confirmations are required; decline voids without ratings and preserves opponent queue priority');
}finally{await db.$disconnect();}
