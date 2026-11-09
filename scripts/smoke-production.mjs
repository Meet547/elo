import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { isolatedDatabaseUrl } from './lib/test-database.mjs';
const require=createRequire(import.meta.url);
assert.equal(process.env.ELO_TEST_DATABASE,'1','run smoke checks through the isolated Postgres harness');
const databaseUrl=isolatedDatabaseUrl(process.env.TEST_DATABASE_URL);
const directory=await mkdtemp(join(tmpdir(),'elo-smoke-'));
const backendPort=Number(process.env.SMOKE_BACKEND_PORT || 4311);
const frontendPort=Number(process.env.SMOKE_FRONTEND_PORT || 4312);
const frontend=`http://127.0.0.1:${frontendPort}`;
const backend=`http://127.0.0.1:${backendPort}`;
const env={...process.env,NODE_ENV:'production',DATABASE_URL:databaseUrl,DIRECT_DATABASE_URL:databaseUrl,SESSION_SECRET:'smoke-test-signing-secret-not-a-real-secret',BACKEND_PROXY_SECRET:'smoke-test-proxy-secret-not-a-real-secret',BACKEND_ORIGIN:backend,PORT:String(backendPort)};
const children=[];
let logs='';
function run(file,args,extra={}) {
 const child=spawn(process.execPath,[file,...args],{env:{...env,...extra},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',chunk=>{logs+=chunk.toString();});child.stderr.on('data',chunk=>{logs+=chunk.toString();});children.push(child);return child;
}
async function ready(url) {
 const end=Date.now()+60000;
 while(Date.now()<end) {
  try { const response=await fetch(url); if(response.ok)return; } catch {}
  await new Promise(resolve=>setTimeout(resolve,300));
 }
 throw new Error(`Not ready: ${url}\n${logs}`);
}
async function request(path,{cookie,...options}={}) {
 const response=await fetch(`${frontend}${path}`,{...options,headers:{'Content-Type':'application/json','Idempotency-Key':randomUUID(),Origin:frontend,...(cookie?{Cookie:cookie}:{}),...options.headers}});
 return {response,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
try {
 const backendProcess = run('scripts/start-backend.mjs',[]);
 run(require.resolve('next/dist/bin/next'),['start','--hostname','127.0.0.1','--port',String(frontendPort)],{PORT:String(frontendPort)});
 await Promise.all([ready(`${backend}/api/health`),ready(frontend)]);
 assert.equal((await fetch(`${backend}/api/profile`)).status,403,'direct backend access blocked');
 const host=await request('/api/profile',{method:'POST',body:JSON.stringify({name:'Smoke host'})});
 assert.equal(host.response.status,200,JSON.stringify(host.data));assert(host.cookie);
 const guest=await request('/api/profile',{method:'POST',body:JSON.stringify({name:'Smoke guest'})});
 assert.equal((await request('/api/profile',{cookie:host.cookie})).data.player.name,'Smoke host');
 const created=await request('/api/live',{method:'POST',cookie:host.cookie});
 assert.equal(created.response.status,201);
 const code=created.data.room.code;assert.match(code,/^[A-Z0-9]{6}$/);
 const joined=await request(`/api/live/${code}`,{method:'POST',cookie:guest.cookie,body:JSON.stringify({revision:created.data.room.revision,command:{type:'join'}})});
 assert.equal(joined.response.status,200);
 let started;
 if(process.argv.includes('--browser')){
  const {chromium,expect}=await import('@playwright/test');
  const browser=await chromium.launch();
  try{
   const contexts=await Promise.all([host,guest].map(async participant=>{
    const context=await browser.newContext();const split=participant.cookie.indexOf('=');
    await context.addCookies([{name:participant.cookie.slice(0,split),value:participant.cookie.slice(split+1),url:frontend,httpOnly:true,sameSite:'Lax'}]);
    return context;
   }));
   const pages=await Promise.all(contexts.map(context=>context.newPage()));
   await Promise.all(pages.map(page=>page.goto(`${frontend}/live/${code}`)));
   await expect(pages[0].getByRole('button',{name:'Start game',exact:true})).toBeVisible();
   await expect(pages[1].getByText('Waiting for the host to start the game.')).toBeVisible();
   await pages[0].getByRole('button',{name:'Start game',exact:true}).click();
   await expect.poll(async()=>(await request(`/api/live/${code}`,{cookie:host.cookie})).data.room.status,{timeout:12_000}).toBe('playing');
   started=await request(`/api/live/${code}`,{cookie:host.cookie});
   const secrets=await pages[0].evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('elo:private-seed:v1:')).map(key=>sessionStorage.getItem(key)));
   assert.equal(secrets.length,1,'browser must keep one private seed for this room');
   await pages[0].reload();
   assert.deepEqual(await pages[0].evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('elo:private-seed:v1:')).map(key=>sessionStorage.getItem(key))),secrets,'same-tab reload must retain the original seed');
   await pages[1].goto(`${frontend}/verify/${started.data.room.game.fairProof.handId}`);
   await expect(pages[1].getByText('Commitment recorded; no cards were publicly disclosed.')).toBeVisible();
   await expect(pages[1].getByText('Complete deck replay is an internal audit, because publishing its inputs would reveal hidden cards.',{exact:false})).toBeVisible();
   console.log('PASS — two actual browser contexts complete the automatic private seed exchange, retain seeds across reload and render public membership verification');
  }finally{await browser.close();}
 }else{
 started=await request(`/api/live/${code}`,{method:'POST',cookie:host.cookie,body:JSON.stringify({revision:joined.data.room.revision,command:{type:'start'}})});
 assert.equal(started.response.status,200);
 const participants=[host,guest],seeds=participants.map(()=>randomBytes(32).toString('hex'));
 for(const [index,participant] of participants.entries()){
  const current=(await request(`/api/live/${code}`,{cookie:participant.cookie})).data.room;
  const commitment=createHash('sha256').update(JSON.stringify(['elo-seed-v1','client',`${current.fair.context}:${participant.data.player.id}`,seeds[index]])).digest('hex');
  assert.equal((await request(`/api/live/${code}`,{method:'POST',cookie:participant.cookie,body:JSON.stringify({revision:current.revision,command:{type:'seed-commit',commitment}})})).response.status,200);
 }
 for(const [index,participant] of participants.entries()){
  const current=(await request(`/api/live/${code}`,{cookie:participant.cookie})).data.room;
  started=await request(`/api/live/${code}`,{method:'POST',cookie:participant.cookie,body:JSON.stringify({revision:current.revision,command:{type:'seed-reveal',seed:seeds[index]}})});
  assert.equal(started.response.status,200);
 }
 assert(started.data.room.game,'all client commitments and reveals must precede the deal');
 const evidence=await request(`/api/verify/${started.data.room.game.fairProof.handId}`);
 assert.equal(evidence.response.status,200);assert.equal(evidence.data.hand.cards.length,0,'public archive must not disclose private hole cards');

 }
 started=await request(`/api/live/${code}`,{cookie:host.cookie});
 assert.equal(started.data.room.seats[1].cards.length,0,'opponent cards stay private');
 const controller=new AbortController();
 const events=await fetch(`${frontend}/api/live/${code}/events`,{headers:{Cookie:host.cookie},signal:controller.signal});
 assert.equal(events.status,200);assert(events.headers.get('content-type').includes('text/event-stream'));
 const reader=events.body.getReader();assert(new TextDecoder().decode((await reader.read()).value).includes('data:'));
 await reader.cancel();controller.abort();
 const workerDb=new PrismaClient();
 // No room GET or SSE remains open: only the launched worker may advance this deadline.
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,started.data.room.nextAt-Date.now()+1500)));
 const advanced=await workerDb.liveRoom.findUniqueOrThrow({where:{code}});
 assert(advanced.revision>started.data.room.revision,'the actual worker must advance an untouched room without browser requests');
 await workerDb.$disconnect();
 assert.equal((await request('/api/internal/tick',{method:'POST',cookie:host.cookie,body:'{}'})).response.status,403,'browser proxy cannot invoke the internal worker');
 const denied=await request('/api/ranked',{method:'POST',cookie:host.cookie,body:JSON.stringify({command:'join'})});
 assert.equal(denied.response.status,403,'guests cannot queue for ranked');
 const fixtureDb=new PrismaClient();
 await fixtureDb.externalIdentity.create({data:{provider:'google',subject:'smoke-verified-host',email:'smoke@fixture.example',playerId:host.data.player.id}});
 await fixtureDb.$disconnect();
 const queued=await request('/api/ranked',{method:'POST',cookie:host.cookie,body:JSON.stringify({command:'join'})});
 assert.equal(queued.data.status,'searching');
 assert.equal((await request('/api/ranked',{method:'POST',cookie:host.cookie,body:JSON.stringify({command:'cancel'})})).data.status,'idle');
 const verifiedDb=new PrismaClient();
 await verifiedDb.externalIdentity.create({data:{provider:'google',subject:'smoke-verified-guest',email:'guest@fixture.example',playerId:guest.data.player.id}});
 await verifiedDb.$disconnect();
 assert.equal((await request('/api/ranked',{method:'POST',cookie:host.cookie,body:JSON.stringify({command:'join'})})).data.status,'searching');
 const queueEvents=await fetch(`${frontend}/api/ranked/events`,{headers:{Cookie:host.cookie},signal:AbortSignal.timeout(8000)});
 assert.equal(queueEvents.status,200);
 const queueReader=queueEvents.body.getReader();
 const queueFrame=async()=>JSON.parse(new TextDecoder().decode((await queueReader.read()).value).match(/data: (.+)/)[1]);
 assert.equal((await queueFrame()).status,'searching');
 const matched=await request('/api/ranked',{method:'POST',cookie:guest.cookie,body:JSON.stringify({command:'join'})});
 assert.equal(matched.data.status,'matched');
 assert.deepEqual(await queueFrame(),matched.data);
 await queueReader.cancel();
 console.log('PASS — ranked match assignments reach the waiting player through the production SSE proxy');
 const oldBotRoute=await fetch(`${frontend}/api/bots/decide`,{method:'POST',headers:{Cookie:host.cookie,'content-type':'application/json'},body:'{}'});
 assert.equal(oldBotRoute.status,404);
 const csrf=await request('/api/profile',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'});assert.equal(csrf.response.status,403);
 backendProcess.kill('SIGTERM');
 await once(backendProcess,'exit');
 run('scripts/start-backend.mjs',[]);
 await ready(`${backend}/api/health`);
 assert.equal((await request('/api/profile',{cookie:host.cookie})).data.player.name,'Smoke host','identity persists after backend restart');
 assert.equal((await request(`/api/live/${code}`,{cookie:host.cookie})).data.room.code,code,'live state persists after backend restart');
 console.log('PASS — restart persistence, two production services, migrations, proxy gate, profile cookies, private room create/join/start, card privacy, SSE, autonomous deadline worker, ranked queue/cancel, closed Cloud bot endpoint and CSRF');
} catch(error) { console.error(logs);throw error; }
finally {
 for(const child of children)child.kill('SIGTERM');
 await Promise.all(children.map(child=>child.exitCode!==null?Promise.resolve():Promise.race([once(child,'exit'),new Promise(resolve=>setTimeout(()=>{child.kill('SIGKILL');resolve();},5000))])));
 await rm(directory,{recursive:true,force:true});
}
