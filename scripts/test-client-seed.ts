import assert from 'node:assert/strict';
import {newFairRound,publicFairRound,freezeFairParticipants,commitClientSeed,revealClientSeed} from '../src/lib/poker/fair-round';
import {nextClientSeedCommand} from '../src/lib/poker/client-seed';
const rows=new Map<string,string>(),storage={getItem:(key:string)=>rows.get(key)??null,setItem:(key:string,value:string)=>{rows.set(key,value);}};
const round=newFairRound();
assert.equal(nextClientSeedCommand(publicFairRound(round),'a',storage),null);assert.equal(rows.size,1,'pin the server commitment before preparation starts');
freezeFairParticipants(round,['a','b']);
for(const id of round.participants){
 const view=publicFairRound(round),command=nextClientSeedCommand(view,id,storage)!;assert.equal(command.type,'seed-commit');
 assert.deepEqual(nextClientSeedCommand(view,id,storage),command,'same private seed across rerenders/retries');
 if(command.type==='seed-commit')commitClientSeed(round,id,command.commitment);
}
for(const id of round.participants){
 const command=nextClientSeedCommand(publicFairRound(round),id,storage)!;assert.equal(command.type,'seed-reveal');
 if(command.type==='seed-reveal')revealClientSeed(round,id,command.seed);
}
assert.equal(round.phase,'ready');assert.equal(nextClientSeedCommand(publicFairRound(round),'a',storage),null);
const fresh=newFairRound();nextClientSeedCommand(publicFairRound(fresh),'a',storage);fresh.serverCommitment='f'.repeat(64);
assert.throws(()=>nextClientSeedCommand(publicFairRound(fresh),'a',storage),/commitment changed/);
const lost=newFairRound();freezeFairParticipants(lost,['a','b']);commitClientSeed(lost,'a','c'.repeat(64));
assert.throws(()=>nextClientSeedCommand(publicFairRound(lost),'a',{getItem:()=>null,setItem:()=>{}}),/restore/);
console.log('PASS — early commitment pin, private seed persistence, stable retry, complete exchange and fail-closed lost/mismatched browser secrets');
const unsupported=Object.assign(publicFairRound(newFairRound()),{version:2});
assert.throws(()=>nextClientSeedCommand(unsupported as ReturnType<typeof publicFairRound>,'a',storage),/newer page/);
