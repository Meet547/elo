import assert from 'node:assert/strict';
import {postGameCommand} from '../src/lib/game-command';
const seen:{key:string|null;body:unknown}[]=[];
const response=await postGameCommand('/fixture',{command:'join'},{fetcher:(async(_,options)=>{
 seen.push({key:new Headers(options?.headers).get('idempotency-key'),body:options?.body});
 if(seen.length===1)throw new Error('response dropped after application');
 return Response.json({ok:true});
}) as typeof fetch});
assert.equal(response.status,200);assert.equal(seen.length,2);assert(seen[0].key);assert.deepEqual(seen[0],seen[1]);
let attempts=0;
assert.equal((await postGameCommand('/fixture',{}, {fetcher:(async()=>{attempts++;return new Response(null,{status:409});}) as typeof fetch})).status,409);
assert.equal(attempts,1);
console.log('PASS — dropped-response retry reuses key/body; rejected intents are not automatically repeated');

const stopped=new AbortController();stopped.abort();
await assert.rejects(postGameCommand('/fixture',{}, {signal:stopped.signal,fetcher:(async()=>{throw new Error('must not request');}) as typeof fetch}),/Aborted/);
const unknownKeys:(string|null)[]=[];
const unknownFetcher=(async(_:unknown,options?:RequestInit)=>{
 unknownKeys.push(new Headers(options?.headers).get('idempotency-key'));
 if(unknownKeys.length<=2)throw new Error('both responses lost');
 return Response.json({ok:true});
}) as typeof fetch;
await assert.rejects(postGameCommand('/unknown-intent',{command:'create'},{fetcher:unknownFetcher}));
await postGameCommand('/unknown-intent',{command:'create'},{fetcher:unknownFetcher});
assert.equal(unknownKeys[0],unknownKeys[2],'manual retry after an unknown result must preserve the original intent key');
const partialKeys:(string|null)[]=[];
const partial=await postGameCommand('/partial-body',{command:'create'},{fetcher:(async(_:unknown,options?:RequestInit)=>{
 partialKeys.push(new Headers(options?.headers).get('idempotency-key'));
 return partialKeys.length===1?new Response('{truncated',{status:201}):Response.json({ok:true});
}) as typeof fetch});
assert.deepEqual(await partial.json(),{ok:true},'a truncated response body must not acknowledge an intent');
assert.equal(partialKeys[0],partialKeys[1]);
