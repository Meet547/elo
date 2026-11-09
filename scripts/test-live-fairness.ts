import assert from 'node:assert/strict';
import {newLiveTable,applyLiveCommand,publicLiveTable,advanceLiveTable} from '../src/lib/poker/live-table';
import {seedCommitment,verifyCardProof} from '../src/lib/poker/fair-deck';
const people=Array.from({length:3},(_,i)=>({id:`player-${i}`,name:`P${i}`,rating:1200}));
const now=Date.now(),table=newLiveTable(people[0],true);
assert(table.fair,'new protected rooms must commit a server seed at creation');
const original=table.fair.round.serverCommitment;
assert.equal(applyLiveCommand(table,people[1],{type:'join'},now),null);
assert.equal(applyLiveCommand(table,people[0],{type:'start'},now),null);
assert.equal(table.game,null,'starting must not deal before clients commit and reveal');
assert.equal(applyLiveCommand(table,people[2],{type:'join'},now),'This game has already started.');
assert(applyLiveCommand(table,people[0],{type:'seed-reveal',seed:'a'.repeat(64)},now));
for(const [i,player] of people.slice(0,2).entries()){
 const value=(i?'b':'a').repeat(64);
 assert.equal(applyLiveCommand(table,player,{type:'seed-commit',commitment:seedCommitment('client',`${table.fair.round.context}:${player.id}`,value)},now),null);
 assert.equal(table.game,null);
}
assert.equal(applyLiveCommand(table,people[0],{type:'seed-reveal',seed:'a'.repeat(64)},now),null);assert.equal(table.game,null);
assert.equal(applyLiveCommand(table,people[1],{type:'seed-reveal',seed:'b'.repeat(64)},now),null);assert(table.game);
assert.equal(table.fair.round.serverCommitment,original);
for(const viewer of [...people,{id:'spectator',name:'Spectator',rating:1200}]){
 const snapshot=publicLiveTable(table,viewer.id,'FIXTURE',1),proof=snapshot.game!.fairProof!;
 assert.equal(snapshot.game!.deckSeed,null);assert(proof.cards.every(card=>verifyCardProof(proof.root,card)));
 assert.equal(proof.cards.length,people.slice(0,2).some(player=>player.id===viewer.id)?2:0);
 const encoded=JSON.stringify(snapshot);assert(!encoded.includes(table.fair.round.serverSeed));assert(!encoded.includes('a'.repeat(64)));assert(!encoded.includes('b'.repeat(64)));
}
const expired=newLiveTable(people[0],true);applyLiveCommand(expired,people[1],{type:'join'},now);applyLiveCommand(expired,people[0],{type:'start'},now);
assert(advanceLiveTable(expired,expired.nextAt!));assert.equal(expired.status,'closed');assert.equal(expired.fair!.round.phase,'aborted');assert.equal(expired.game,null);
console.log('PASS — live server commitment precedes client exchange/deal, frozen seats, selective own-card proofs, private seeds and fail-closed exchange timeout');
