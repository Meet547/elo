import assert from 'node:assert/strict';
import {newSession,startHand,legalActions,applyAction,type BotAction} from '../src/lib/poker/engine';
let randomState=0x547e10;
const random=()=>{randomState^=randomState<<13;randomState^=randomState>>>17;randomState^=randomState<<5;return randomState>>>0;};
const hands=Number(process.env.INVARIANT_HANDS??100000);
const started=Date.now();
for(let index=0;index<hands;index++){
 const count=2+random()%5;
 const state=newSession(Array.from({length:count},(_,i)=>({id:String(i),name:`Fixture ${i}`,isHuman:i===0,rating:1200})));
 state.button=random()%count;
 for(const seat of state.seats)seat.stack=1+random()%5000;
 const initial=structuredClone(state);
 const seed=index.toString(16).padStart(64,'0');
 startHand(state,seed);
 const replay=structuredClone(initial);startHand(replay,seed);
 const chips=initial.seats.reduce((sum,seat)=>sum+seat.stack,0);
 const actions:{actor:number;action:BotAction}[]=[];
 const invariant=()=>{
  if(state.seats.reduce((sum,seat)=>sum+seat.stack+seat.totalBet,0)!==chips)console.error(JSON.stringify({index,initial,state,actions}));
  assert.equal(state.seats.reduce((sum,seat)=>sum+seat.stack+seat.totalBet,0),chips,`chip conservation at fixture ${index}`);
  assert(state.seats.every(seat=>Number.isInteger(seat.stack)&&seat.stack>=0&&Number.isInteger(seat.totalBet)&&seat.totalBet>=0));
  const cards=[...state.deck,...state.board,...state.seats.flatMap(seat=>seat.cards)].map(card=>card.id);
  assert.equal(new Set(cards).size,cards.length,`repeated card at fixture ${index}`);
 };
 invariant();
 while(state.phase==='betting'){
  if(actions.length>=10000)throw new Error(`Nontermination fixture=${index} actions=${JSON.stringify(actions)}`);
  const actor=state.toAct;const legal=legalActions(state,actor);const roll=random()%100;
  const action:BotAction=roll<12?{type:'fold'}:roll>=65&&legal.canRaise?{type:'raise',to:legal.minRaiseTo+random()%(legal.maxRaiseTo-legal.minRaiseTo+1)}:legal.canCheck?{type:'check'}:{type:'call'};
  actions.push({actor,action});applyAction(state,actor,action);applyAction(replay,actor,action);invariant();
 }
 assert(['showdown','hand-end'].includes(state.phase));
 assert.deepEqual(state,replay,`seed and action replay diverged for fixture ${index}`);
 if((index+1)%10000===0)console.log(`Validated ${index+1} deterministic hands`);
}
console.log(`PASS — ${hands} seeded hands: chip conservation, card uniqueness, nonnegative integer stacks, exact action replay and termination (${Date.now()-started}ms)`);
