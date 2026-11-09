import {completeFairExchange} from './fixtures/complete-fair-exchange';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {db} from '../backend/src/lib/db';
import {POST as queueApi} from '../backend/src/app/api/ranked/route';
import {POST as roomApi} from '../backend/src/app/api/live/[code]/route';
import {readLiveRoom} from '../backend/src/lib/live-rooms';
import {signSession,SESSION_COOKIE} from '../backend/src/lib/session';
import {isolatedDatabaseUrl} from './lib/test-database.mjs';
import type {LiveSnapshot} from '../src/lib/poker/live-table';
assert.equal(process.env.ELO_TEST_DATABASE,'1');isolatedDatabaseUrl(process.env.DATABASE_URL);process.env.SESSION_SECRET=randomBytes(32).toString('hex');
const realNow=Date.now;let clock=realNow();Date.now=()=>clock;
try{
 const players=await Promise.all([0,1].map(()=>{const id=randomUUID();return db.player.create({data:{id,name:`Pipeline ${id.slice(0,4)}`,nameKey:id,identities:{create:{provider:'google',subject:id,email:`${id}@fixture.example`}}}});}));
 const request=(id:string,path:string,body:object,key=randomUUID())=>new NextRequest(`https://fixture.example/api/${path}`,{method:'POST',headers:{cookie:`${SESSION_COOKIE}=${signSession(id)}`,'content-type':'application/json','idempotency-key':key,'x-elo-client-ip':'pipeline-fixture'},body:JSON.stringify(body)});
 assert.equal((await queueApi(request(players[0].id,'ranked',{command:'join'}))).status,200);
 const match=await (await queueApi(request(players[1].id,'ranked',{command:'join'}))).json();assert.equal(match.status,'matched');const code=match.code;
 const context={params:Promise.resolve({code})};
 for(const player of players){
  const pending=(await readLiveRoom(code,player.id))!,key=randomUUID();
  const intent=()=>request(player.id,`live/${code}`,{revision:pending.revision,command:{type:'ready',accept:true}},key);
  const response=await roomApi(intent(),context);assert.equal(response.status,200);const original=await response.json();
  assert.deepEqual(await (await roomApi(intent(),context)).json(),original);
 }
 await completeFairExchange(code,players,async(id,revision,command)=>(await roomApi(request(id,`live/${code}`,{revision,command}),context)).status);
 let snapshot:LiveSnapshot=(await readLiveRoom(code,players[0].id))!;
 const firstSeat=snapshot.me;
 for(let guard=0;guard<40;guard++){
  if(snapshot.game!.phase==='betting'){
   const player=players[snapshot.game!.toAct===firstSeat?0:1];
   const result=await roomApi(request(player.id,`live/${code}`,{revision:snapshot.revision,command:{type:'act',action:{type:'fold'}}}),context);
   assert.equal(result.status,200);snapshot=(await result.json()).room;
  }else{
   clock=snapshot.nextAt!;
   if(snapshot.ranked!.completedHands===9)break;
   snapshot=(await readLiveRoom(code,players[0].id))!;
  }
 }
 const finishKey=randomUUID();const finish=()=>request(players[0].id,`live/${code}`,{revision:snapshot.revision,command:{type:'join'}},finishKey);
 const result=await roomApi(finish(),context);assert.equal(result.status,409);const body=await result.json();assert.equal(body.room.status,'finished');
 assert.deepEqual(await (await roomApi(finish(),context)).json(),body);
 assert.equal(await db.session.count(),2);assert.equal(await db.matchSettlement.count(),1);
 for(const player of players)assert.equal((await db.player.findUniqueOrThrow({where:{id:player.id}})).rankedPlacements,1);
 console.log('PASS — HTTP queue/ready/action receipts share atomic ranked transactions, including timer settlement and terminal replay');
}finally{Date.now=realNow;await db.$disconnect();}
