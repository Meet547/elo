import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { db } from '../backend/src/lib/db';
import { GET } from '../backend/src/app/api/leaderboard/route';
import { GET as profileGet, POST as profilePost } from '../backend/src/app/api/profile/route';
import { signSession, SESSION_COOKIE } from '../backend/src/lib/session';
import { isolatedDatabaseUrl } from './lib/test-database.mjs';
assert.equal(process.env.ELO_TEST_DATABASE,'1');isolatedDatabaseUrl(process.env.DATABASE_URL);
process.env.SESSION_SECRET=randomBytes(32).toString('hex');
const selected=process.argv.find(arg=>arg.startsWith('--case='))?.slice(7)??'all';
const request=(id?:string)=>new NextRequest('https://fixture.example/api/leaderboard',{headers:id?{cookie:`${SESSION_COOKIE}=${signSession(id)}`}:{}});
const counts=async()=>({players:await db.player.count(),sessions:await db.session.count()});
try{
 if(selected==='readonly'||selected==='all'){
  const before=await counts();const response=await GET(request());assert.equal(response.status,200);
  assert.deepEqual(await counts(),before,'F5: GET leaderboard must not write players or results');
  console.log('PASS — leaderboard GET is read-only');
 }
 if(selected==='concurrency'||selected==='all'){
  const before=await counts();
  const replies=await Promise.allSettled(Array.from({length:8},()=>GET(request())));
  assert(replies.every(reply=>reply.status==='fulfilled'&&reply.value.status===200),'F10: concurrent first reads must never race rival insertion');
  assert.deepEqual(await counts(),before);
  console.log('PASS — concurrent fresh-database leaderboard reads do not seed or fail');
 }
 if(selected==='rank'||selected==='all'){
  const people=Array.from({length:70},(_,i)=>({id:randomUUID(),name:`Query fixture ${i}`,rating:2000-i,hands:i}));
  await db.player.createMany({data:people});const actor=people.at(-1)!;
  const response=await GET(request(actor.id));const data=await response.json();
  assert.equal(data.me?.id,actor.id,'F11: signed actor must be fetched independently of the top 60');
  assert.equal(data.me.rank,70);assert.equal(data.ladder.length,60);
  const identity=await (await profileGet(request(actor.id))).json();assert.equal(identity.player.rank,70,'identity refresh must retain the independent rank');
  assert(data.ladder.every((row:{provenance?:string;isSimulated?:boolean})=>row.provenance==='REAL'&&row.isSimulated===false));
  console.log('PASS — real-player provenance and signed actor rank below top 60');
 }
 if(selected==='all'){
  const { seedPracticeRoster }=await import('../backend/src/lib/practice-roster');
  const created=await Promise.all(Array.from({length:8},()=>seedPracticeRoster(db)));
  assert.equal(created.reduce((sum,item)=>sum+item.count,0),34);
  const before=await counts();
  const bot=await db.player.findFirstOrThrow({where:{isSimulated:true}});
  await db.player.update({where:{id:bot.id},data:{rating:bot.rating+7}});
  await seedPracticeRoster(db);assert.deepEqual(await counts(),before);
  assert.equal((await db.player.findUniqueOrThrow({where:{id:bot.id}})).rating,bot.rating+7,'seeding must not reset existing persona data');
  const response=await GET(request());const data=await response.json();
  assert(data.ladder.every((row:{id:string;isSimulated:boolean})=>!row.id.startsWith('rival_')&&!row.isSimulated));
  const real=await db.player.findFirstOrThrow({where:{isSimulated:false}});
  const session={hands:1,finalStack:1500,net:0,place:1,seats:2,ratingBefore:1200,ratingAfter:1200};
  await db.session.create({data:{...session,playerId:real.id,mode:'PRIVATE'}});
  await db.session.create({data:{...session,playerId:bot.id,mode:'LEGACY'}});
  const afterFixtures=await counts();
  const publicData=await (await GET(request())).json();assert.equal(publicData.wire.length,0,'unranked or simulated results must not leak into the ranked activity wire');
  assert.deepEqual(await counts(),afterFixtures);
  console.log('PASS — concurrent idempotent seed preserves existing data and excludes simulated/private results');
 }
}finally{await db.$disconnect();}
