import {seedCommitment,deriveFairSeed,type SeedTranscript} from './fair-deck';
import {randomSeedHex} from './rng';

export interface FairRound {
 version:1;
 context:string;
 serverSeed:string;
 serverCommitment:string;
 phase:'waiting'|'committing'|'revealing'|'ready'|'aborted';
 participants:string[];
 commitments:Record<string,string>;
 reveals:Record<string,string>;
}
/** Create and persist this before accepting any client commitment. */
export function newFairRound():FairRound{
 const context=randomSeedHex(),serverSeed=randomSeedHex();
 return {version:1,context,serverSeed,serverCommitment:seedCommitment('server',context,serverSeed),phase:'waiting',participants:[],commitments:{},reveals:{}};
}
export function freezeFairParticipants(round:FairRound,participants:string[]){
 if(round.phase!=='waiting')throw new Error('Fairness participants are already frozen.');
 if(participants.length<2||participants.length>6||new Set(participants).size!==participants.length||participants.some(id=>!/^[a-zA-Z0-9_-]{1,80}$/.test(id)))throw new Error('Invalid fairness participants.');
 round.participants=[...participants];round.phase='committing';
}
const own=(record:Record<string,string>,id:string)=>Object.hasOwn(record,id)?record[id]:undefined;
const put=(record:Record<string,string>,id:string,value:string)=>Object.defineProperty(record,id,{value,enumerable:true,writable:true,configurable:true});
function participant(round:FairRound,id:string){
 if(!round.participants.includes(id))throw new Error('Not a fairness participant.');
 if(round.phase==='aborted')throw new Error('The fairness round was aborted.');
}
export function commitClientSeed(round:FairRound,id:string,commitment:string){
 participant(round,id);
 if(!/^[a-f0-9]{64}$/.test(commitment))throw new Error('Invalid client commitment.');
 if(own(round.commitments,id)){
  if(own(round.commitments,id)!==commitment)throw new Error('A client commitment cannot be replaced.');
  return;
 }
 if(round.phase!=='committing')throw new Error('The commitment phase is closed.');
 put(round.commitments,id,commitment);
 if(round.participants.every(player=>own(round.commitments,player)))round.phase='revealing';
}
export function revealClientSeed(round:FairRound,id:string,value:string){
 participant(round,id);
 if(own(round.reveals,id)){
  if(own(round.reveals,id)!==value)throw new Error('A revealed seed cannot be replaced.');
  return;
 }
 if(round.phase!=='revealing')throw new Error('All clients must commit before any reveal.');
 if(seedCommitment('client',`${round.context}:${id}`,value)!==own(round.commitments,id))throw new Error('Client seed does not match its commitment.');
 put(round.reveals,id,value);
 if(round.participants.every(player=>own(round.reveals,player)))round.phase='ready';
}
export function abortFairRound(round:FairRound){round.phase='aborted';}
/** Private trusted replay input, never a public response. No replacement seed on abort. */
export function fairTranscript(round:FairRound):SeedTranscript{
 if(round.version!==1)throw new Error('Unsupported fairness version.');
 if(round.phase!=='ready')throw new Error('The fairness exchange is incomplete.');
 const transcript={roomId:round.context,serverSeed:round.serverSeed,serverCommitment:round.serverCommitment,clients:round.participants.map(playerId=>({playerId,commitment:own(round.commitments,playerId)!,seed:own(round.reveals,playerId)!}))};
 // Recheck persisted commitment/reveal data before any hand can use it.
 deriveFairSeed(transcript,'transcript-validation');return transcript;
}
export function publicFairRound(round:FairRound){
 return {version:round.version,context:round.context,serverCommitment:round.serverCommitment,phase:round.phase,participants:round.participants.map(playerId=>({playerId,commitment:own(round.commitments,playerId)??null,revealed:Boolean(own(round.reveals,playerId))}))};
}
