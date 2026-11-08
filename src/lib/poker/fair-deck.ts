import {cardId,deckFromSeed,type Card,SUITS} from './cards';
import {randomSeedHex,sha256Hex} from './rng';

const hex=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const hash=(...parts:unknown[])=>sha256Hex(JSON.stringify(parts));
function context(value:string){if(typeof value!=='string'||!value||value.length>160)throw new Error('Invalid fairness context.');}
function seed(value:string){if(!hex(value))throw new Error('Invalid fairness seed.');}
export function seedCommitment(scope:'server'|'client',roomId:string,value:string){
 context(roomId);seed(value);return hash('elo-seed-v1',scope,roomId,value);
}
export interface ClientReveal {playerId:string;commitment:string;seed:string}
export interface SeedTranscript {roomId:string;serverSeed:string;serverCommitment:string;clients:ClientReveal[]}
/** Trusted audit input only: publishing this transcript would reveal folded cards. */
export function deriveFairSeed(input:SeedTranscript,handId:string){
 context(handId);context(input.roomId);seed(input.serverSeed);
 if(input.serverCommitment!==seedCommitment('server',input.roomId,input.serverSeed))throw new Error('Server seed does not match its commitment.');
 if(input.clients.length<2||input.clients.length>6)throw new Error('Two to six client reveals are required.');
 const clients=[...input.clients].sort((a,b)=>a.playerId<b.playerId?-1:a.playerId>b.playerId?1:0);
 if(new Set(clients.map(client=>client.playerId)).size!==clients.length)throw new Error('Duplicate fairness participant.');
 for(const client of clients){
  context(client.playerId);seed(client.seed);
  if(client.commitment!==seedCommitment('client',`${input.roomId}:${client.playerId}`,client.seed))throw new Error('Client seed does not match its commitment.');
 }
 return hash('elo-combined-deck-v1',input.roomId,handId,input.serverSeed,clients.map(client=>[client.playerId,client.seed]));
}
export interface CardProof {handId:string;index:number;card:Card;salt:string;siblings:string[]}
export interface SealedFairDeck {handId:string;root:string;deck:Card[];salts:string[];levels:string[][]}
function leaf(handId:string,index:number,card:Card,salt:string){return hash('elo-card-leaf-v1',handId,index,card.id,salt);}
function branch(left:string,right:string){return hash('elo-card-branch-v1',left,right);}
/** Independent random salts keep 52 possible card identities from being brute-forced. */
export function sealFairDeck(input:SeedTranscript,handId:string,salts:string[]=Array.from({length:52},randomSeedHex)):SealedFairDeck{
 const deck=deckFromSeed(deriveFairSeed(input,handId));
 if(salts.length!==52||!salts.every(hex)||new Set(salts).size!==52)throw new Error('52 unique secret salts are required.');
 const levels=[Array.from({length:64},(_,index)=>index<52?leaf(handId,index,deck[index],salts[index]):hash('elo-card-padding-v1',handId,index))];
 while(levels.at(-1)!.length>1){const previous=levels.at(-1)!;levels.push(Array.from({length:previous.length/2},(_,index)=>branch(previous[index*2],previous[index*2+1])));}
 return {handId,root:levels.at(-1)![0],deck,salts:[...salts],levels};
}
/** Callers authorize positions before selecting proofs. This never selects visibility itself. */
export function cardProof(sealed:SealedFairDeck,index:number):CardProof{
 if(!Number.isInteger(index)||index<0||index>=52)throw new Error('Invalid deck position.');
 let position=index;
 const siblings=sealed.levels.slice(0,-1).map(level=>{const sibling=level[position^1];position>>=1;return sibling;});
 return {handId:sealed.handId,index,card:{...sealed.deck[index]},salt:sealed.salts[index],siblings};
}
/** Proves membership at a committed position, not unbiased shuffle or undisclosed cards. */
export function verifyCardProof(root:string,proof:CardProof):boolean{
 try{
  context(proof.handId);
  if(!hex(root)||!hex(proof.salt)||!Number.isInteger(proof.index)||proof.index<0||proof.index>=52||proof.siblings.length!==6||!proof.siblings.every(hex))return false;
  const card=proof.card;
  if(!Number.isInteger(card.r)||card.r<2||card.r>14||!SUITS.includes(card.s)||card.id!==cardId(card.r,card.s))return false;
  let current=leaf(proof.handId,proof.index,card,proof.salt),position=proof.index;
  for(const sibling of proof.siblings){current=position&1?branch(sibling,current):branch(current,sibling);position>>=1;}
  return current===root;
 }catch{return false;}
}
