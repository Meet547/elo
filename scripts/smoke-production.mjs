import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { once } from 'node:events';
const require=createRequire(import.meta.url);
const directory=await mkdtemp(join(tmpdir(),'elo-smoke-'));
const backendPort=Number(process.env.SMOKE_BACKEND_PORT || 4311);
const frontendPort=Number(process.env.SMOKE_FRONTEND_PORT || 4312);
const frontend=`http://127.0.0.1:${frontendPort}`;
const backend=`http://127.0.0.1:${backendPort}`;
const env={...process.env,NODE_ENV:'production',DATABASE_URL:`file:${directory}/test.db`,SESSION_SECRET:'smoke-test-signing-secret-not-a-real-secret',BACKEND_PROXY_SECRET:'smoke-test-proxy-secret-not-a-real-secret',OLLAMA_API_KEY:'test-only-no-inference',BACKEND_ORIGIN:backend,PORT:String(backendPort)};
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
 const response=await fetch(`${frontend}${path}`,{...options,headers:{'Content-Type':'application/json',Origin:frontend,...(cookie?{Cookie:cookie}:{}),...options.headers}});
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
 const started=await request(`/api/live/${code}`,{method:'POST',cookie:host.cookie,body:JSON.stringify({revision:joined.data.room.revision,command:{type:'start'}})});
 assert.equal(started.response.status,200);
 assert.equal(started.data.room.seats[1].cards.length,0,'opponent cards stay private');
 const controller=new AbortController();
 const events=await fetch(`${frontend}/api/live/${code}/events`,{headers:{Cookie:host.cookie},signal:controller.signal});
 assert.equal(events.status,200);assert(events.headers.get('content-type').includes('text/event-stream'));
 const reader=events.body.getReader();assert(new TextDecoder().decode((await reader.read()).value).includes('data:'));
 await reader.cancel();controller.abort();
 const queued=await request('/api/ranked',{method:'POST',cookie:host.cookie,body:JSON.stringify({command:'join'})});
 assert.equal(queued.data.status,'searching');
 assert.equal((await request('/api/ranked',{method:'POST',cookie:host.cookie,body:JSON.stringify({command:'cancel'})})).data.status,'idle');
 assert.equal((await request('/api/bots/decide',{method:'POST',body:'{}'})).response.status,401);
 assert.equal((await request('/api/bots/decide',{method:'POST',cookie:host.cookie,body:'{}'})).response.status,400);
 const csrf=await request('/api/profile',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'});assert.equal(csrf.response.status,403);
 backendProcess.kill('SIGTERM');
 await once(backendProcess,'exit');
 run('scripts/start-backend.mjs',[]);
 await ready(`${backend}/api/health`);
 assert.equal((await request('/api/profile',{cookie:host.cookie})).data.player.name,'Smoke host','identity persists after backend restart');
 assert.equal((await request(`/api/live/${code}`,{cookie:host.cookie})).data.room.code,code,'live state persists after backend restart');
 console.log('PASS — restart persistence, two production services, migrations, proxy gate, profile cookies, private room create/join/start, card privacy, SSE, ranked queue/cancel, bot authentication and CSRF');
} catch(error) { console.error(logs);throw error; }
finally {
 for(const child of children)child.kill('SIGTERM');
 await Promise.all(children.map(child=>child.exitCode!==null?Promise.resolve():Promise.race([once(child,'exit'),new Promise(resolve=>setTimeout(()=>{child.kill('SIGKILL');resolve();},5000))])));
 await rm(directory,{recursive:true,force:true});
}
