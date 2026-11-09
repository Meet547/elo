import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {NextRequest} from 'next/server';
import {db} from '../backend/src/lib/db';
import {shutdownRealtime,realtime} from '../backend/src/lib/realtime';
import {GET} from '../backend/src/app/api/live/[code]/events/route';
import {seedCommitment} from '../src/lib/poker/fair-deck';
import {newLiveTable,applyLiveCommand} from '../src/lib/poker/live-table';
import {roomRecord,readLiveRoom,commandLiveRoom} from '../backend/src/lib/live-rooms';
import {signSession,SESSION_COOKIE,revokePlayerSessions} from '../backend/src/lib/session';
import {isolatedDatabaseUrl} from './lib/test-database.mjs';
assert.equal(process.env.ELO_TEST_DATABASE,'1');isolatedDatabaseUrl(process.env.DATABASE_URL);process.env.SESSION_SECRET=randomBytes(32).toString('hex');
const readers:ReadableStreamDefaultReader<Uint8Array>[]=[];
const delegate=db.liveRoom,original=delegate.findUnique;
let reads=0;
try{
 const players=await Promise.all(Array.from({length:14},(_,i)=>db.player.create({data:{id:randomUUID(),name:`Fanout ${i}`}})));
 const table=newLiveTable(players[0],true);for(const player of players.slice(1,6))applyLiveCommand(table,player,{type:'join'},Date.now());applyLiveCommand(table,players[0],{type:'start'},Date.now());
 const seeds=players.slice(0,6).map(player=>createHash('sha256').update(player.id).digest('hex'));
 for(const [index,player] of players.slice(0,6).entries())assert.equal(applyLiveCommand(table,player,{type:'seed-commit',commitment:seedCommitment('client',`${table.fair!.round.context}:${player.id}`,seeds[index])},Date.now()),null);
 for(const [index,player] of players.slice(0,6).entries())assert.equal(applyLiveCommand(table,player,{type:'seed-reveal',seed:seeds[index]},Date.now()),null);

 const row=await db.liveRoom.create({data:roomRecord(table)});
 Reflect.set(delegate,'findUnique',(...args:unknown[])=>{reads++;return Reflect.apply(original,delegate,args);});
 for(const viewer of players){
  const response=await GET(new NextRequest(`https://fixture.example/api/live/${row.code}/events`,{headers:{cookie:`${SESSION_COOKIE}=${signSession(viewer.id)}`}}),{params:Promise.resolve({code:row.code})});
  assert.equal(response.status,200);const reader=response.body!.getReader();readers.push(reader);
  const frame=new TextDecoder().decode((await reader.read()).value);
  const snapshot=JSON.parse(frame.match(/data: (.+)/)![1]);
  assert.equal(snapshot.game.deckSeed,null);assert(!('deck' in snapshot.game));
  assert(!JSON.stringify(snapshot).includes(table.fair!.round.serverSeed));for(const seed of seeds)assert(!JSON.stringify(snapshot).includes(seed));
  assert.equal(snapshot.game.fairProof.cards.length,players.slice(0,6).some(player=>player.id===viewer.id)?2:0);
  for(const seat of snapshot.seats)assert.equal(seat.cards.length,players.slice(0,6).some((player,index)=>player.id===viewer.id&&seat.idx===index)?2:0);
 }
 await new Promise(resolve=>setTimeout(resolve,1050));
 assert(reads>0,'query instrumentation must observe the initial room read');
 assert(reads<=2,`WS7: idle room reads must be shared, not per-viewer loops; observed ${reads}`);
 console.log(`PASS — every seat/spectator private-card boundary; shared idle-room reads=${reads}`);
 const next=readers[0].read();
 await assert.rejects(db.$transaction(async tx=>{await tx.liveRoom.update({where:{code:row.code},data:{revision:{increment:1}}});throw new Error('rolled back fixture');}),/rolled back/);
 assert.equal(await Promise.race([next.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),150))]),false,'rolled-back room writes must not publish');
 async function fold(){
  const view=(await readLiveRoom(row.code,players[0].id))!;
  assert.equal((await commandLiveRoom(row.code,players[view.game!.toAct].id,view.revision,{type:'act',action:{type:'fold'}})).status,200);
 }
 await fold();
 const delivered=await Promise.race([next,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('notification missing')),2000))]);
 assert.match(new TextDecoder().decode(delivered.value),/id: 1/);
 await readers[0].cancel();
 await fold();await fold();
 const ownerResponse=await GET(new NextRequest(`https://fixture.example/api/live/${row.code}/events`,{headers:{cookie:`${SESSION_COOKIE}=${signSession(players[0].id)}`,'last-event-id':'1'}}),{params:Promise.resolve({code:row.code})});
 assert.equal(ownerResponse.status,200);const resumed=ownerResponse.body!.getReader();readers.push(resumed);
 const replayIds=[];
 for(let i=0;i<2;i++){const frame=new TextDecoder().decode((await resumed.read()).value);replayIds.push(Number(frame.match(/id: (\d+)/)![1]));}
 assert.deepEqual(replayIds,[2,3],'durable replay must resume after the last event ID');
 const revoked=resumed.read();await revokePlayerSessions(players[0].id);
 assert.equal((await Promise.race([revoked,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('revocation not delivered')),2000))])).done,true);
 assert.equal((await GET(new NextRequest(`https://fixture.example/api/live/${row.code}/events`,{headers:{cookie:`${SESSION_COOKIE}=${signSession(players[0].id)}`}}),{params:Promise.resolve({code:row.code})})).status,401);
 console.log('PASS — transactional notification rollback, ordered durable resume and live session revocation');
 const spectator=readers[6];
 // Drain previously published updates before forcing a real listener disconnect.
 let disconnected=false;
 const drain=(async()=>{while(!(await spectator.read()).done){}disconnected=true;})();
 await db.$queryRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'elo-realtime' AND datname = current_database()`;
 await Promise.race([drain,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('lost listener did not close clients')),2000))]);
 assert(disconnected);
 const recovered=await realtime.get(row.code);assert(recovered?.row);
 await db.liveRoom.delete({where:{code:row.code}});
 await new Promise(resolve=>setTimeout(resolve,150));
 assert.equal(await realtime.get(row.code),null,'deleted rooms must invalidate cached snapshots immediately');
 console.log('PASS — listener connection recovery and deleted-room cache invalidation');
 const slowRow=await db.liveRoom.create({data:roomRecord(newLiveTable(players[1]))});
 const slowResponse=await GET(new NextRequest(`https://fixture.example/api/live/${slowRow.code}/events`,{headers:{cookie:`${SESSION_COOKIE}=${signSession(players[1].id)}`}}),{params:Promise.resolve({code:slowRow.code})});
 const slow=slowResponse.body!.getReader();readers.push(slow);
 await slow.read();
 const slowHub=await realtime.get(slowRow.code);assert(slowHub);
 const observer=[...slowHub.observers][0];assert(observer);
 // Exercise the stream's slow-reader boundary without touching persisted game state.
 for(let revision=1;revision<=1000;revision++)observer.update({...slowRow,revision});
 let frames=0,last=0;
 while(last<1000){const chunk=await slow.read();assert(!chunk.done);last=Number(new TextDecoder().decode(chunk.value).match(/id: (\d+)/)![1]);frames++;}
 assert(frames<250,`slow viewers must retain a bounded queue and the latest snapshot, got ${frames}`);
 await slow.cancel();
 console.log(`PASS — bounded slow-reader queue delivers latest revision after ${frames} buffered frames`);

}finally{
 Reflect.set(delegate,'findUnique',original);
 await Promise.all(readers.map(reader=>reader.cancel()));await shutdownRealtime();await db.$disconnect();
}
