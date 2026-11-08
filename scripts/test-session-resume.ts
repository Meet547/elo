import assert from 'node:assert/strict';
import { useFelt } from '../src/store/game';
const player={id:'returning-player',name:'Returning',rating:1200,rd:350,rated:0,peak:1200,hands:0,cashes:0,netChips:0,biggestPot:0,streak:0};
Object.assign(globalThis,{window:{localStorage:{getItem:()=>null}}});
const originalFetch=globalThis.fetch;
let profiles=0,posts=0;
globalThis.fetch=(async(input,options)=>{
 const url=String(input);
 if(options?.method==='POST')posts++;
 if(url==='/api/profile'){
  profiles++;return profiles===1?new Response('sleeping',{status:502}):Response.json({player});
 }
 return Response.json({ladder:[],wire:[]});
}) as typeof fetch;
try{
 await useFelt.getState().boot();
 assert.equal(useFelt.getState().profile?.id,player.id,'F2: cold-start 502 must retry resume instead of treating a returning player as anonymous');
 assert.equal(posts,0);assert(profiles>=2);
 console.log('PASS — returning identity survives a transient backend failure without profile creation');
}finally{globalThis.fetch=originalFetch;}

const {resumeProfile}=await import('../src/lib/session-resume');
let clock=0,attempts=0;
const recovered=await resumeProfile<typeof player>({now:()=>clock,sleep:async(ms)=>{clock+=ms;},fetcher:(async()=>{
 attempts++;if(clock<60_000)return new Response('host unavailable',{status:503});
 return Response.json({player});
}) as typeof fetch});
assert.equal(recovered?.id,player.id);assert(clock>=60_000);assert(attempts>1);
let requests=0;
assert.equal(await resumeProfile({fetcher:(async()=>{requests++;return new Response(null,{status:401});}) as typeof fetch}),null);
assert.equal(requests,1);
clock=0;
await assert.rejects(resumeProfile({now:()=>clock,sleep:async(ms)=>{clock+=ms;},timeoutMs:100,fetcher:(async()=>new Response('bad gateway',{status:502})) as typeof fetch}),/seat is preserved/);
await assert.rejects(resumeProfile({fetcher:(async()=>new Response(null,{status:403})) as typeof fetch}),/restore your seat/);
clock=0;
await assert.rejects(resumeProfile({now:()=>clock,sleep:async(ms)=>{clock+=ms;},timeoutMs:100,fetcher:(async()=>Response.json({wrong:'payload'})) as typeof fetch}),/seat is preserved/);
console.log('PASS — virtual 60-second outage, explicit anonymous response, timeout, forbidden and malformed payload boundaries');
// React Strict Mode and repeated callers share one pending resume operation.
useFelt.setState({profile:null,token:null});
profiles=0;globalThis.fetch=(async()=>{profiles++;await new Promise(resolve=>setTimeout(resolve,1));return Response.json({player});}) as typeof fetch;
await Promise.all([useFelt.getState().boot(),useFelt.getState().boot()]);
assert.equal(useFelt.getState().profile?.id,player.id);
// One identity request plus a read-only ladder refresh.
assert.equal(profiles,2);
globalThis.fetch=originalFetch;
console.log('PASS — duplicate boot callers share the same identity resume');
