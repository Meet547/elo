import 'server-only';
import type {Prisma} from '@prisma/client';
import {fairTranscript,type FairRound} from '@/lib/poker/fair-round';
import type {Card} from '@/lib/poker/cards';
import type {GameState} from '@/lib/poker/engine';
import {deriveFairSeed,sealFairDeck,type SealedFairDeck} from '@/lib/poker/fair-deck';
/** Trusted/private audit input only; never expose this transcript through a public route. */
const cardKey=(card:Card|undefined)=>card?`${card.r}:${card.s}:${card.id}`:'';
export function verifyFairAudit(value:Prisma.JsonValue,expectedRoot:string):boolean{
 try{
  const audit=value as unknown as {round:FairRound;hand:SealedFairDeck;game:GameState};
  const transcript=fairTranscript(audit.round);
  const replay=sealFairDeck(transcript,audit.hand.handId,audit.hand.salts);
  const game=audit.game,remaining=[...replay.deck];
  const dealt=game.seats.filter(seat=>seat.cards.length>0);
  const order=[...game.seats.slice(game.button+1),...game.seats.slice(0,game.button+1)].filter(seat=>seat.cards.length>0);
  if(dealt.length<2||dealt.some(seat=>seat.cards.length!==2))return false;
  for(let pass=0;pass<2;pass++)for(const seat of order)if(cardKey(seat.cards[pass])!==cardKey(remaining.pop()))return false;
  const board:string[]=[];
  for(const count of [3,1,1]){
   if(board.length>=game.board.length)break;
   remaining.pop();for(let index=0;index<count;index++)board.push(remaining.pop()!.id);
  }
  if(JSON.stringify(board)!==JSON.stringify(game.board.map(card=>card.id))||JSON.stringify(remaining.map(cardKey))!==JSON.stringify(game.deck.map(cardKey)))return false;
  return replay.root===expectedRoot&&audit.hand.root===expectedRoot&&audit.game.deckCommit===expectedRoot&&
    audit.game.deckSeed===deriveFairSeed(transcript,audit.hand.handId)&&
    JSON.stringify(replay.deck.map(cardKey))===JSON.stringify(audit.hand.deck.map(cardKey));
 }catch{return false;}
}
