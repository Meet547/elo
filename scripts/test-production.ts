import assert from 'node:assert/strict';
import { waitForRoomReady } from '../src/lib/room-ready';
import { forwardApi } from '../src/lib/server/api-proxy';
import { botDecide, botView } from '../src/lib/poker/ai';
import { newSession, startHand } from '../src/lib/poker/engine';
import { parseRoomCode } from '../src/lib/room-code';
const originalFetch=globalThis.fetch;
const env={...process.env};
try {
  process.env.BACKEND_ORIGIN='https://backend.example'; process.env.BACKEND_PROXY_SECRET='proxy-secret';
  let seen:Request | undefined;
  globalThis.fetch=(async (url: string | URL | Request, init?:RequestInit)=>{
    seen=new Request(url,init);
    return new Response('data: {"ok":true}\n\n',{headers:{'content-type':'text/event-stream','set-cookie':'showdown_session=signed; HttpOnly; Secure; Path=/','retry-after':'2'}});
  }) as typeof fetch;
  const response=await forwardApi(new Request('https://frontend.example/api/live/ABC123/events',{headers:{cookie:'showdown_session=signed'}}),['live','ABC123','events']);
  assert.equal(seen!.url,'https://backend.example/api/live/ABC123/events');
  assert.equal(seen!.headers.get('x-elo-proxy-secret'),'proxy-secret');
  assert.equal(seen!.headers.get('cookie'),'showdown_session=signed');
  assert(response.headers.get('set-cookie')!.includes('HttpOnly'));
  assert.equal(await response.text(),'data: {"ok":true}\n\n');
  assert.equal((await forwardApi(new Request('https://frontend.example/api/profile',{method:'POST',headers:{origin:'https://evil.example'}}),['profile'])).status,403);
  assert.equal((await forwardApi(new Request('https://frontend.example/api/x'),['..'])).status,400);
  assert.equal((await forwardApi(new Request('http://localhost:3000/api/profile', {method:'POST',headers:{host:'frontend.example','x-forwarded-proto':'https',origin:'https://frontend.example'},body:'{}'}),['profile'])).status,200,'public origin survives the framework internal hostname');
  let probes=0;
  globalThis.fetch=(async (url: string | URL | Request, init?:RequestInit)=>{
    assert.equal(String(url),'/api/health'); assert.notEqual(init?.method,'POST');
    probes++;
    return probes === 1 ? new Response('<html>host waking</html>',{status:502}) : probes === 2 ? Response.json({ok:false},{status:503}) : Response.json({ok:true});
  }) as typeof fetch;
  await waitForRoomReady({timeoutMs:1000,pauseMs:1});assert.equal(probes,3,'a sleeping host recovers before a profile mutation');
  globalThis.fetch=(async ()=>Response.json({error:'Backend is not configured.'},{status:503})) as typeof fetch;
  await assert.rejects(waitForRoomReady({timeoutMs:1000,pauseMs:1}),/has not been configured/);
  globalThis.fetch=(async ()=>Response.json({ok:false},{status:502})) as typeof fetch;
  await assert.rejects(waitForRoomReady({timeoutMs:15,pauseMs:1}),/try again in a minute/);
  const state=newSession(Array.from({length:2},(_,i)=>({id:String(i),name:'Bot',rating:1200,isHuman:i===0})));
  startHand(state);
  const view=botView(state,state.toAct);
  globalThis.fetch=(async ()=>{throw new Error('Practice decisions must not use the network.');}) as typeof fetch;
  assert(!('deck' in view));
  assert(!('seats' in view));
  const action=botDecide(view);
  if(action.type==='raise')assert(view.canRaise&&action.to>=view.minRaiseTo&&action.to<=view.maxRaiseTo);
  if(action.type==='check')assert(view.canCheck);
  if(action.type==='call')assert(view.toCall>0);
  assert.equal(parseRoomCode('z9y8x7'),'Z9Y8X7');
  assert.equal(parseRoomCode('ABC!23'),null);
} finally { globalThis.fetch=originalFetch; process.env=env; }
console.log('ALL PASS — API proxy, cookies, SSE, CSRF, local bot actions, private information boundary, outage fallback, room codes');
