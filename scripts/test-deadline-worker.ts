import {completeFairExchange} from './fixtures/complete-fair-exchange';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import type {LiveSnapshot} from '../src/lib/poker/live-table';
import {db} from '../backend/src/lib/db';
import {updateRankedQueue} from '../backend/src/lib/ranked-queue';
import {commandLiveRoom,readLiveRoom} from '../backend/src/lib/live-rooms';
import {processDeadlineBatch} from '../backend/src/lib/deadline-worker';
import {POST as tick} from '../backend/src/app/api/internal/tick/route';
import {workerSecret} from '../src/lib/server/worker-auth.mjs';
import {isolatedDatabaseUrl} from './lib/test-database.mjs';
assert.equal(process.env.ELO_TEST_DATABASE,'1');isolatedDatabaseUrl(process.env.DATABASE_URL);process.env.SESSION_SECRET=randomBytes(32).toString('hex');
async function start(){
 const players=await Promise.all([0,1].map(async()=>{const id=randomUUID();return db.player.create({data:{id,name:'Worker fixture',nameKey:id,identities:{create:{provider:'google',subject:id,email:`${id}@fixture.example`}}}});}));
 await updateRankedQueue(players[0].id,'join');const queue=await updateRankedQueue(players[1].id,'join');
 if(queue?.status!=='matched')throw new Error('Worker fixture did not match');
 for(const player of players){const room:LiveSnapshot=(await readLiveRoom(queue.code,player.id))!;assert.equal((await commandLiveRoom(queue.code,player.id,room.revision,{type:'ready',accept:true})).status,200);}
 await completeFairExchange(queue.code,players);
 const row=await db.liveRoom.findUniqueOrThrow({where:{code:queue.code}});
 const table=JSON.parse(row.state);table.nextAt=Date.now()-30*60_000;
 await db.liveRoom.update({where:{code:row.code},data:{state:JSON.stringify(table),nextDeadlineAt:new Date(table.nextAt)}});
 return {players,row,table};
}
try{
 const both=await start();await db.matchParticipant.updateMany({where:{matchId:both.row.matchId!},data:{lastSeenAt:new Date(Date.now()-30*60_000)}});
 await processDeadlineBatch();
 assert.equal((await db.match.findUniqueOrThrow({where:{id:both.row.matchId!}})).state,'VOID');
 assert.equal(await db.session.count({where:{matchId:both.row.matchId!}}),0);
 assert.equal(await db.rankedSeat.count({where:{roomCode:both.row.code}}),0);
 const single=await start();await db.matchParticipant.updateMany({where:{matchId:single.row.matchId!,playerId:single.players[0].id},data:{lastSeenAt:new Date(Date.now()-30*60_000)}});
 await Promise.all([processDeadlineBatch(),processDeadlineBatch()]);
 assert.equal((await db.match.findUniqueOrThrow({where:{id:single.row.matchId!}})).state,'FORFEIT');
 assert.equal(await db.session.count({where:{matchId:single.row.matchId!}}),2);
 assert.equal(await db.matchSettlement.count({where:{matchId:single.row.matchId!}}),1);
 assert.equal((await db.session.findFirstOrThrow({where:{matchId:single.row.matchId!,playerId:single.players[0].id}})).place,2);
 assert.equal((await db.player.findUniqueOrThrow({where:{id:single.players[1].id}})).rankedPlacements,1);
 await processDeadlineBatch();assert.equal(await db.session.count({where:{matchId:single.row.matchId!}}),2);
 const reconnect=await start();await db.matchParticipant.updateMany({where:{matchId:reconnect.row.matchId!},data:{lastSeenAt:new Date(Date.now()-30*60_000)}});
 assert.equal((await readLiveRoom(reconnect.row.code,reconnect.players[0].id))?.status,'closed','waking the host cannot turn a both-absent void into a win');
 const stale=await db.player.create({data:{name:'Stale queue'}});await db.rankedSeat.create({data:{playerId:stale.id,rating:1200,joinedAt:new Date(0),seenAt:new Date(0)}});
 await db.rateWindow.create({data:{key:'fixture-expired',count:1,resetAt:new Date(0)}});
 await processDeadlineBatch();assert.equal(await db.rankedSeat.findUnique({where:{playerId:stale.id}}),null);assert.equal(await db.rateWindow.findUnique({where:{key:'fixture-expired'}}),null);
 assert.equal((await tick(new NextRequest('https://fixture.example/api/internal/tick',{method:'POST'}))).status,403);
 assert.equal((await tick(new NextRequest('https://fixture.example/api/internal/tick',{method:'POST',headers:{'x-elo-worker-secret':workerSecret(process.env.SESSION_SECRET)}}))).status,200);
 console.log('PASS — one-cycle 30-minute absence void, concurrent single-player forfeit once, reconnect precedence, TTL cleanup and worker authorization');
}finally{await db.$disconnect();}
