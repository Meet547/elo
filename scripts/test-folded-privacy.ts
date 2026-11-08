import assert from 'node:assert/strict';
import {newLiveTable,applyLiveCommand,publicLiveTable} from '../src/lib/poker/live-table';
const players=[{id:'a',name:'A',rating:1200},{id:'b',name:'B',rating:1200}];
const table=newLiveTable(players[0]),now=Date.now();
applyLiveCommand(table,players[1],{type:'join'},now);applyLiveCommand(table,players[0],{type:'start'},now);
const folded=table.game!.toAct;applyLiveCommand(table,players[folded],{type:'act',action:{type:'fold'}},now);
assert.notEqual(table.game!.phase,'betting');
for(const viewer of [...players,{id:'spectator',name:'Spectator',rating:1200}]){
 const snapshot=publicLiveTable(table,viewer.id,'FIXTURE',1);
 assert.equal(snapshot.game!.deckSeed,null,'selective reveal cannot publish a full-shuffle seed after a fold');
 assert(!JSON.stringify(snapshot).includes(table.game!.deckSeed));
 assert.equal(snapshot.seats[folded].cards.length,viewer.id===players[folded].id?2:0);
}
console.log('PASS — settled folds remain private to other seats and spectators; full-shuffle seed never leaves live serializer');
