import {seedCommitment} from './fair-deck';
import {randomSeedHex} from './rng';
import type {publicFairRound} from './fair-round';
import type {LiveCommand} from './live-table';
type PublicRound=ReturnType<typeof publicFairRound>;
type StorageLike=Pick<Storage,'getItem'|'setItem'>;
const memory=new Map<string,{seed:string;serverCommitment:string}>();
/** Browser-only secret: never put this in a room DTO, URL, log or public proof. */
export function nextClientSeedCommand(round:PublicRound,owner:string,storage?:StorageLike):LiveCommand|null{
 if(round.version!==1)throw new Error('This room needs a newer page. Reload before continuing.');
 if(!['waiting','committing','revealing'].includes(round.phase))return null;
 const participant=round.participants.find(player=>player.playerId===owner);if(round.phase!=='waiting'&&!participant)return null;
 const key=`elo:private-seed:v1:${round.context}:${owner}`;
 let saved=memory.get(key);
 if(!saved&&storage){try{const raw=storage.getItem(key);if(raw){const value=JSON.parse(raw);if(typeof value.seed==='string'&&/^[a-f0-9]{64}$/.test(value.seed)&&typeof value.serverCommitment==='string')saved=value;}}catch{}}
 if(saved&&saved.serverCommitment!==round.serverCommitment)throw new Error('The room commitment changed. Leave this room and start again.');
 if(!saved){
  if(participant?.commitment)throw new Error('This browser cannot restore its private deal seed. Leave this room and start again.');
  saved={seed:randomSeedHex(),serverCommitment:round.serverCommitment};
  if(storage){try{storage.setItem(key,JSON.stringify(saved));}catch{}}
 }
 if(memory.size>=100&&!memory.has(key))memory.delete(memory.keys().next().value!);
 memory.set(key,saved);
 if(round.phase==='waiting'||!participant)return null;
 const commitment=seedCommitment('client',`${round.context}:${owner}`,saved.seed);
 if(participant.commitment&&participant.commitment!==commitment)throw new Error('The private deal seed does not match this seat. Leave this room and start again.');
 if(round.phase==='committing'&&!participant.commitment)return {type:'seed-commit',commitment};
 if(round.phase==='revealing'&&!participant.revealed)return {type:'seed-reveal',seed:saved.seed};
 return null;
}
