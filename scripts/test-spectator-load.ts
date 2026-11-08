import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {db} from '../backend/src/lib/db';
import {newLiveTable,applyLiveCommand} from '../src/lib/poker/live-table';
import {roomRecord} from '../backend/src/lib/live-rooms';
import {signSession,SESSION_COOKIE} from '../backend/src/lib/session';
import {isolatedDatabaseUrl} from './lib/test-database.mjs';
assert.equal(process.env.ELO_TEST_DATABASE,'1');isolatedDatabaseUrl(process.env.DATABASE_URL);
assert(process.env.K6_BINARY,'Provide the local k6 binary; this test never uses k6 Cloud.');
process.env.SESSION_SECRET=randomBytes(32).toString('hex');
const proxySecret=randomBytes(32).toString('hex');
const directory=await mkdtemp(join(tmpdir(),'elo-spectator-load-'));
const origin='http://127.0.0.1:4321';
const ready=new Set<string>();let startedAt=0;let failure:unknown;let child:ReturnType<typeof spawn>|undefined;
let logs='';
const coordinator=createServer((req,res)=>{
 if(req.url?.startsWith('/ready/')){ready.add(req.url.slice(7));res.end('{}');if(ready.size===500&&!startedAt){startedAt=-1;setTimeout(()=>{void act().catch(error=>{failure=error;});},100);}return;}
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({startedAt}));
});
let act=async()=>{};
try{
 const players=await Promise.all(Array.from({length:506},(_,i)=>db.player.create({data:{id:randomUUID(),name:`Load ${i}`}})));
 const table=newLiveTable(players[0]);for(const player of players.slice(1,6))applyLiveCommand(table,player,{type:'join'},Date.now());applyLiveCommand(table,players[0],{type:'start'},Date.now());
 // Extension resolution can download a binary before subscribers start; exclude setup from the decision clock.
 table.nextAt=Date.now()+120_000;
 const row=await db.liveRoom.create({data:roomRecord(table)});
 act=async()=>{
  startedAt=Date.now();
  const response=await fetch(`${origin}/api/live/${row.code}`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','x-elo-proxy-secret':proxySecret,'Idempotency-Key':randomUUID(),Cookie:`${SESSION_COOKIE}=${signSession(players[table.game!.toAct].id)}`},body:JSON.stringify({revision:0,command:{type:'act',action:{type:'fold'}}})});
  assert.equal(response.status,200,await response.text());
 };
 await new Promise<void>(resolve=>coordinator.listen(4322,'127.0.0.1',resolve));
 child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','backend/.app','--hostname','127.0.0.1','--port','4321'],{env:{...process.env,NODE_ENV:'production',BACKEND_PROXY_SECRET:proxySecret},stdio:['ignore','pipe','pipe']});
 child.stdout!.on('data',data=>{logs+=data;});child.stderr!.on('data',data=>{logs+=data;});
 for(let i=0;i<100;i++){try{if((await fetch(`${origin}/api/health/live`)).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,200));}
 const path=join(directory,'fixture.json');await writeFile(path,JSON.stringify({origin,code:row.code,cookies:players.slice(6).map(player=>`${SESSION_COOKIE}=${signSession(player.id)}`),proxySecret,coordinator:'http://127.0.0.1:4322'}),{mode:0o600});
 const load=spawn(process.env.K6_BINARY,['run','scripts/load/spectators.js'],{env:{...process.env,ELO_LOAD_FIXTURE:path},stdio:'inherit'});
 const exit=await new Promise(resolve=>load.on('exit',resolve));
 if(failure)throw failure;assert.equal(ready.size,500);assert.equal(exit,0,'k6 acceptance thresholds must pass');
 console.log('PASS — 500 isolated HTTP SSE spectators, one real HTTP action, p95 <=1 second, errors <1%');
}catch(error){console.error(logs);throw error;}
finally{coordinator.closeAllConnections();coordinator.close();child?.kill('SIGTERM');await db.$disconnect();await rm(directory,{recursive:true,force:true});}
