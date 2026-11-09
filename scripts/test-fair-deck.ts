import {verifyFairAudit} from '../backend/src/lib/fair-audit';
import {newSession,startHand} from '../src/lib/poker/engine';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {seedCommitment,deriveFairSeed,sealFairDeck,cardProof,verifyCardProof,type SeedTranscript} from '../src/lib/poker/fair-deck';
import {sha256Hex} from '../src/lib/poker/rng';
const secret=(value:string)=>createHash('sha256').update(value).digest('hex');
for(let i=0;i<10_000;i++){
 const roomId=`room-${i}`,handId=`${roomId}:hand-1`,serverSeed=secret(`server-${i}`);
 const transcript:SeedTranscript={roomId,serverSeed,serverCommitment:seedCommitment('server',roomId,serverSeed),clients:['a','b'].map(playerId=>{const seed=secret(`${playerId}-${i}`);return {playerId,seed,commitment:seedCommitment('client',`${roomId}:${playerId}`,seed)};})};
 const salts=Array.from({length:52},(_,index)=>secret(`test-salt-${i}-${index}`));
 const sealed=sealFairDeck(transcript,handId,salts),replay=sealFairDeck({...transcript,clients:[...transcript.clients].reverse()},handId,salts);
 const game=newSession(transcript.clients.map(client=>({id:client.playerId,name:client.playerId,isHuman:true,rating:1200})));
 startHand(game,deriveFairSeed(transcript,handId));game.deckCommit=sealed.root;
 const audit={round:{version:1,context:roomId,serverSeed,serverCommitment:transcript.serverCommitment,phase:'ready',participants:transcript.clients.map(client=>client.playerId),commitments:Object.fromEntries(transcript.clients.map(client=>[client.playerId,client.commitment])),reveals:Object.fromEntries(transcript.clients.map(client=>[client.playerId,client.seed]))},hand:sealed,game};
 assert(verifyFairAudit(JSON.parse(JSON.stringify(audit)),sealed.root),'trusted audit must reproduce the actual engine deal');
 assert.deepEqual(sealed.deck,replay.deck);assert.equal(sealed.root,replay.root);assert.equal(new Set(sealed.deck.map(card=>card.id)).size,52);
 const proof=cardProof(sealed,i%52);assert(verifyCardProof(sealed.root,proof));
 assert(!verifyCardProof(sealed.root,{...proof,salt:secret('tampered')}));
 assert(!verifyCardProof(sealed.root,{...proof,card:sealed.deck[(proof.index+1)%52]}));
 assert(!verifyCardProof(sealed.root,{...proof,index:(proof.index+1)%52}));
 assert(!verifyCardProof(sealed.root,{...proof,handId:`${handId}-other`}));
 assert(!verifyCardProof(sealed.root,{...proof,card:{...proof.card,r:proof.card.r===14?2:14}}));
 assert(!verifyCardProof(sealed.root,{...proof,siblings:[secret('tampered'),...proof.siblings.slice(1)]}));
 assert.throws(()=>deriveFairSeed({...transcript,serverSeed:secret('tampered')},handId),/commitment/);
 assert.throws(()=>deriveFairSeed({...transcript,clients:transcript.clients.map((client,index)=>index?client:{...client,seed:secret('tampered')})},handId),/commitment/);
 if(i===0){
  assert.equal(sha256Hex('known independent hash'),secret('known independent hash'));
  const independent=(...parts:unknown[])=>secret(JSON.stringify(parts));
  let level=Array.from({length:64},(_,index)=>index<52?independent('elo-card-leaf-v1',handId,index,sealed.deck[index].id,salts[index]):independent('elo-card-padding-v1',handId,index));
  while(level.length>1)level=Array.from({length:level.length/2},(_,index)=>independent('elo-card-branch-v1',level[index*2],level[index*2+1]));
  assert.equal(sealed.root,level[0],'independent Node crypto Merkle root');
  for(let position=0;position<52;position++)assert(verifyCardProof(sealed.root,cardProof(sealed,position)));
  const publicProof=JSON.stringify(proof);assert(!publicProof.includes(serverSeed));for(const client of transcript.clients)assert(!publicProof.includes(client.seed));
  assert(!verifyCardProof(sealed.root,{...proof,siblings:[]}));assert.throws(()=>sealFairDeck(transcript,handId,Array(52).fill(secret('same'))),/unique/);
 }
}
console.log('PASS — 10,000 deterministic internal deck/engine audit replays; selective proofs reject tampered seed/card/index/hand/salt/path; public proof contains no seed');
