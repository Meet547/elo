import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readLiveRoom,commandLiveRoom} from '../../backend/src/lib/live-rooms';
import {seedCommitment} from '../../src/lib/poker/fair-deck';
import type {LiveCommand} from '../../src/lib/poker/live-table';
export async function completeFairExchange(code:string,players:{id:string}[],submit?:(id:string,revision:number,command:LiveCommand)=>Promise<number>){
 const send=submit??(async(id,revision,command)=>(await commandLiveRoom(code,id,revision,command)).status);
 const seeds=players.map(player=>createHash('sha256').update(`isolated-fixture:${code}:${player.id}`).digest('hex'));
 for(const [index,player] of players.entries()){
  const room=(await readLiveRoom(code,player.id))!;assert(room.fair);assert.equal(room.game,null);
  assert.equal(await send(player.id,room.revision,{type:'seed-commit',commitment:seedCommitment('client',`${room.fair.context}:${player.id}`,seeds[index])}),200);
 }
 for(const [index,player] of players.entries()){
  const room=(await readLiveRoom(code,player.id))!;assert.equal(room.game,null);
  assert.equal(await send(player.id,room.revision,{type:'seed-reveal',seed:seeds[index]}),200);
 }
 assert((await readLiveRoom(code,players[0].id))?.game);
}
