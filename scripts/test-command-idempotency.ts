import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {db} from '../backend/src/lib/db';
import {POST as act} from '../backend/src/app/api/live/[code]/route';
import {POST} from '../backend/src/app/api/live/route';
import {signSession,SESSION_COOKIE} from '../backend/src/lib/session';
import {isolatedDatabaseUrl} from './lib/test-database.mjs';
assert.equal(process.env.ELO_TEST_DATABASE,'1');isolatedDatabaseUrl(process.env.DATABASE_URL);process.env.SESSION_SECRET=randomBytes(32).toString('hex');
try{
 const player=await db.player.create({data:{name:'Idempotency fixture'}}),key=randomUUID();
 const request=()=>new NextRequest('https://fixture.example/api/live',{method:'POST',headers:{cookie:`${SESSION_COOKIE}=${signSession(player.id)}`,'idempotency-key':key,'x-elo-client-ip':'idempotency-fixture'}});
 const first=await POST(request());const original=await first.json();assert.equal(first.status,201);
 const retried=await POST(request());assert.equal(retried.status,201);
 assert.deepEqual(await retried.json(),original,'F6: a dropped create-room response must replay the stored result, not create another room');
 assert.equal(await db.liveRoom.count(),1);
 const parallel=await Promise.all(Array.from({length:16},()=>POST(request())));
 for(const response of parallel){assert.equal(response.status,201);assert.deepEqual(await response.json(),original);}
 assert.equal(await db.liveRoom.count(),1);assert.equal(await db.commandReceipt.count(),1);
 assert((await db.rateWindow.findMany()).every(row=>row.count===1),'replays must not consume another mutation quota');
 const missing=new NextRequest('https://fixture.example/api/live',{method:'POST',headers:{cookie:`${SESSION_COOKIE}=${signSession(player.id)}`}});
 assert.equal((await POST(missing)).status,400);
 const moveKey=randomUUID(),code=original.room.code;
 const move=(command:object)=>new NextRequest(`https://fixture.example/api/live/${code}`,{method:'POST',headers:{cookie:`${SESSION_COOKIE}=${signSession(player.id)}`,'idempotency-key':moveKey,'content-type':'application/json','x-elo-client-ip':'idempotency-fixture'},body:JSON.stringify({revision:0,command})});
 const context={params:Promise.resolve({code})};
 const joined=await act(move({type:'join'}),context);assert.equal(joined.status,200);const joinedBody=await joined.json();
 assert.deepEqual(await (await act(move({type:'join'}),context)).json(),joinedBody);
 assert.equal((await act(move({type:'leave'}),context)).status,409,'same key cannot carry a different intent');
 assert.equal((await db.liveRoom.findUniqueOrThrow({where:{code}})).revision,1);
 console.log('PASS — room creation retried after a dropped response has one durable result');
}finally{await db.$disconnect();}
