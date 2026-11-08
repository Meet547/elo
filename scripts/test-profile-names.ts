import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {NextRequest} from 'next/server';
import {db} from '../backend/src/lib/db';
import {POST,PATCH} from '../backend/src/app/api/profile/route';
import {signSession,SESSION_COOKIE} from '../backend/src/lib/session';
import {isolatedDatabaseUrl} from './lib/test-database.mjs';
assert.equal(process.env.ELO_TEST_DATABASE,'1');isolatedDatabaseUrl(process.env.DATABASE_URL);process.env.SESSION_SECRET=randomBytes(32).toString('hex');
const request=(name:string,ip:string)=>new NextRequest('https://fixture.example/api/profile',{method:'POST',headers:{'content-type':'application/json','x-elo-client-ip':ip},body:JSON.stringify({name})});
try{
 const first=await POST(request('Table Player','fixture-1'));assert.equal(first.status,200);
 const duplicate=await POST(request('Ｔａｂｌｅ  PLAYER','fixture-2'));
 assert.equal(duplicate.status,409,'A4: case/compatibility/whitespace variants must not create duplicate table names');
 const parallel=await Promise.all([POST(request('Concurrent','fixture-3')),POST(request('concurrent','fixture-4'))]);
 assert.deepEqual(parallel.map(response=>response.status).sort(),[200,409]);
 assert.equal(await db.player.count(),2);
 const invalid=await POST(request('Admin','fixture-admin'));assert.equal(invalid.status,400);
 const legacy=await db.player.create({data:{name:'Legacy Name'}});
 const rename=(name:string)=>new NextRequest('https://fixture.example/api/profile',{method:'PATCH',headers:{cookie:`${SESSION_COOKIE}=${signSession(legacy.id)}`,'content-type':'application/json','x-elo-client-ip':'rename-fixture'},body:JSON.stringify({name})});
 const claim=await PATCH(rename('Legacy Name'));assert.equal(claim.status,200);
 assert.equal((await claim.json()).player.id,legacy.id,'legacy name claim must preserve identity');
 assert.equal((await PATCH(rename('TABLE player'))).status,409);
 console.log('PASS — canonical display-name uniqueness and concurrent claims');
}finally{await db.$disconnect();}
