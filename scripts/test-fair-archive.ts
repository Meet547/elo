import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {db} from '../backend/src/lib/db';
import {createLiveRoom,commandLiveRoom,readLiveRoom} from '../backend/src/lib/live-rooms';
import {GET} from '../backend/src/app/api/verify/[handId]/route';
import {verifyFairAudit} from '../backend/src/lib/fair-audit';
import {verifyCardProof} from '../src/lib/poker/fair-deck';
import {completeFairExchange} from './fixtures/complete-fair-exchange';
import {isolatedDatabaseUrl} from './lib/test-database.mjs';
import type {LiveTable} from '../src/lib/poker/live-table';
assert.equal(process.env.ELO_TEST_DATABASE,'1');isolatedDatabaseUrl(process.env.DATABASE_URL);
const actualNow=Date.now;let clock=actualNow();Date.now=()=>clock;
try{
 const players=await Promise.all([0,1,2].map(index=>db.player.create({data:{id:randomUUID(),name:`Fair archive ${index}`}})));
 let room=(await createLiveRoom(players[0].id))!;const code=room.code;
 for(const player of players.slice(1)){
  room=(await readLiveRoom(code,player.id))!;assert.equal((await commandLiveRoom(code,player.id,room.revision,{type:'join'})).status,200);
 }
 room=(await readLiveRoom(code,players[0].id))!;
 assert.equal((await commandLiveRoom(code,players[0].id,room.revision,{type:'start'})).status,200);
 await completeFairExchange(code,players,async(id,revision,command)=>{
  if(command.type==='seed-reveal'&&id===players.at(-1)!.id){
   await assert.rejects(db.$transaction(async tx=>{
    assert.equal((await commandLiveRoom(code,id,revision,command,tx)).status,200);
    assert.equal(await tx.fairHand.count({where:{roomCode:code}}),1);
    throw new Error('rollback before deal acknowledgement');
   }),/rollback before deal acknowledgement/);
   assert.equal(await db.fairHand.count({where:{roomCode:code}}),0,'hand root/archive must roll back with its unacknowledged deal');
   assert.equal((await readLiveRoom(code,id))!.game,null);
  }
  return (await commandLiveRoom(code,id,revision,command)).status;
 });
 room=(await readLiveRoom(code,players[0].id))!;const handId=room.game!.fairProof!.handId;
 const archived=await db.fairHand.findUniqueOrThrow({where:{handId}});assert.equal(archived.completedAt,null);assert(verifyFairAudit(archived.auditData,room.game!.deckCommit));
 const badDeal=JSON.parse(JSON.stringify(archived.auditData));badDeal.game.seats[0].cards[0]=badDeal.hand.deck[0];assert(!verifyFairAudit(badDeal,room.game!.deckCommit),'trusted audit must check actual deal order');
 const changed=JSON.parse(JSON.stringify(archived.auditData));changed.round.serverSeed='f'.repeat(64);assert(!verifyFairAudit(changed,room.game!.deckCommit));
 const read=async()=>{const response=await GET(new NextRequest(`https://fixture.example/api/verify/${handId}`),{params:Promise.resolve({handId})});assert.equal(response.status,200);return response.json();};
 const publicBefore=await read();assert.equal(publicBefore.hand.cards.length,0);
 const privateState=JSON.parse((await db.liveRoom.findUniqueOrThrow({where:{code}})).state) as LiveTable;
 const encoded=JSON.stringify(publicBefore);assert(!encoded.includes(privateState.fair!.round.serverSeed));for(const value of Object.values(privateState.fair!.round.reveals))assert(!encoded.includes(value));
 while(room.game!.phase==='betting'){
  assert.equal((await commandLiveRoom(code,players[room.game!.toAct].id,room.revision,{type:'act',action:{type:'fold'}})).status,200);
  room=(await readLiveRoom(code,players[0].id))!;
 }
 const complete=await db.fairHand.findUniqueOrThrow({where:{handId}});assert(complete.completedAt);assert.equal((await read()).hand.cards.length,0,'folded cards never enter the public archive');
 const row=await db.liveRoom.findUniqueOrThrow({where:{code}}),tampered=JSON.parse(row.state) as LiveTable;
 tampered.fair!.hand!.root='f'.repeat(64);tampered.fair!.evidence!.root='f'.repeat(64);tampered.game!.deckCommit='f'.repeat(64);
 await assert.rejects(db.liveRoom.update({where:{code},data:{state:JSON.stringify(tampered),revision:{increment:1}}}),/commitment cannot be replaced/);
 assert.equal((await db.liveRoom.findUniqueOrThrow({where:{code}})).revision,row.revision,'archive/root mutation must roll back room state too');
 clock=room.nextAt!;room=(await readLiveRoom(code,players[0].id))!;assert.equal(room.game!.handNo,2);assert.notEqual(room.game!.fairProof!.handId,handId);
 assert.equal(await db.fairHand.count({where:{roomCode:code}}),2);
 assert.deepEqual((await db.fairHand.findUniqueOrThrow({where:{handId}})).auditData,complete.auditData,'completed hand evidence is immutable');
 await db.liveRoom.delete({where:{code}});assert.equal((await read()).hand.handId,handId,'verification survives room expiry/deletion');
 assert.equal((await GET(new NextRequest('https://fixture.example/api/verify/invalid'),{params:Promise.resolve({handId:'invalid'})})).status,404);
 let showdown=(await createLiveRoom(players[0].id))!;const showdownCode=showdown.code;
 await commandLiveRoom(showdownCode,players[1].id,showdown.revision,{type:'join'});
 showdown=(await readLiveRoom(showdownCode,players[0].id))!;await commandLiveRoom(showdownCode,players[0].id,showdown.revision,{type:'start'});
 await completeFairExchange(showdownCode,players.slice(0,2));showdown=(await readLiveRoom(showdownCode,players[0].id))!;
 const raiser=showdown.game!.toAct;await commandLiveRoom(showdownCode,players[raiser].id,showdown.revision,{type:'act',action:{type:'raise',to:1500}});
 showdown=(await readLiveRoom(showdownCode,players[0].id))!;await commandLiveRoom(showdownCode,players[showdown.game!.toAct].id,showdown.revision,{type:'act',action:{type:'call'}});
 showdown=(await readLiveRoom(showdownCode,players[0].id))!;
 const publicShowdown=(await GET(new NextRequest('https://fixture.example/api/verify'),{params:Promise.resolve({handId:showdown.game!.fairProof!.handId})}));
 const proof=(await publicShowdown.json()).hand;assert.equal(proof.cards.length,9);assert(proof.cards.every((card:Parameters<typeof verifyCardProof>[1])=>verifyCardProof(proof.root,card)));
 const audit=await db.fairHand.findUniqueOrThrow({where:{handId:proof.handId}});assert(verifyFairAudit(audit.auditData,proof.root));
 console.log('PASS — atomic private/public hand archive, trusted seed replay, tamper rollback, immutable completion, per-hand contexts and verification after room deletion');
}finally{Date.now=actualNow;await db.$disconnect();}
