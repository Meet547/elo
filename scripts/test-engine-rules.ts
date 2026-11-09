import assert from 'node:assert/strict';
import {applyAction,legalActions,newSession,startHand,advanceStreet,type GameState} from '../src/lib/poker/engine';
import {newLiveTable,newRankedTable,applyLiveCommand,advanceLiveTable} from '../src/lib/poker/live-table';
import {evaluate} from '../src/lib/poker/evaluator';
import type {Card} from '../src/lib/poker/cards';
const selected=process.argv.find(arg=>arg.startsWith('--case='))?.slice(7)??'all';
const people=Array.from({length:4},(_,i)=>({id:String(i),name:`Seat ${i}`,rating:1200,isHuman:true}));
function turnFixture():GameState{
 const s=newSession(people);s.phase='betting';s.street='turn';s.currentBet=0;s.minRaise=100;s.bb=20;s.toAct=0;
 for(const seat of s.seats){seat.stack=1000;seat.bet=0;seat.totalBet=200;seat.hasActed=false;}
 return s;
}
if(selected==='raise'||selected==='all'){
 const s=turnFixture();applyAction(s,0,{type:'raise',to:100});s.seats[1].stack=150;
 applyAction(s,1,{type:'raise',to:150});applyAction(s,2,{type:'call'});applyAction(s,3,{type:'call'});
 assert.equal(legalActions(s,0).canRaise,false,'F4: previous-street contributions must not reopen a 100→150 short all-in');
 assert.equal(legalActions(s,0).callAmount,50);
 const c=turnFixture();applyAction(c,0,{type:'raise',to:100});c.seats[1].stack=150;c.seats[2].stack=200;
 applyAction(c,1,{type:'raise',to:150});applyAction(c,2,{type:'raise',to:200});applyAction(c,3,{type:'call'});
 assert.equal(legalActions(c,0).canRaise,true,'100→150→200 cumulative short all-ins reopen the original 100 bettor');
 assert.equal(legalActions(c,0).minRaiseTo,300,'cumulative shorts do not increase the last full raise increment');
 console.log('PASS — street-local single and cumulative short-all-in reopening');
}
if(selected==='timeout'||selected==='all'){
 const t=newLiveTable(people[0]);applyLiveCommand(t,people[1],{type:'join'},0);applyLiveCommand(t,people[0],{type:'start'},0);
 applyLiveCommand(t,people[t.game!.toAct],{type:'act',action:{type:'call'}},0);
 const actor=t.game!.toAct;assert(legalActions(t.game!,actor).canCheck);
 advanceLiveTable(t,t.nextAt!);assert.equal(t.game!.seats[actor].lastAction,'check','A2: free timeout must check');
 console.log('PASS — expired free decision checks');
}
if(selected==='blinds'||selected==='all'){
 const t=newRankedTable(people[0],people[1],0);
 for(let hand=1;hand<=10;hand++){
  assert.deepEqual([t.game!.sb,t.game!.bb],[10,20],`A3: ranked hand ${hand} must retain fixed blinds`);
  applyLiveCommand(t,people[t.game!.toAct],{type:'act',action:{type:'fold'}},0);advanceLiveTable(t,t.nextAt!);
 }
 console.log('PASS — ten ranked hands retain 10/20 blinds');
}
const cards=(value:string):Card[]=>value.split(' ').map(id=>({id,r:'23456789TJQKA'.indexOf(id[0])+2,s:id[1] as Card['s']}));
if(selected==='best'||selected==='all'){
 const t=newRankedTable(people[0],people[1],0);
 function showdown(board:string,first:string,second:string){
  const g=t.game!;g.phase='betting';g.street='river';g.board=cards(board);g.currentBet=0;g.toAct=0;g.minRaise=20;
  for(const seat of g.seats){seat.stack=1400;seat.bet=0;seat.totalBet=100;seat.hasActed=false;seat.folded=false;seat.allIn=false;seat.revealed=undefined;}
  g.seats[0].cards=cards(first);g.seats[1].cards=cards(second);
  assert.equal(applyLiveCommand(t,people[0],{type:'act',action:{type:'check'}},0),null);
  assert.equal(applyLiveCommand(t,people[1],{type:'act',action:{type:'check'}},0),null);
 }
 showdown('2s 4d 5h 9c Js','Ac Ad','Kc Qd');advanceLiveTable(t,t.nextAt!);
 showdown('Ah Ad 7s 7h 2d','Ac Kd','Qs Jc');
 const strongest=evaluate(cards('Ah Ad 7s 7h 2d Ac Kd'));
 assert.equal(t.players[0].bestHand,strongest.name,'F13: a stronger later winning hand replaces the first one');
 assert.equal(t.players[0].bestWinning?.score,strongest.score);
 assert.equal(t.players[0].bestSeen?.score,strongest.score);
 assert(!Boolean(t.players[1].bestWinning),'losing showdown cannot create a winning-hand record');
 assert.equal(t.players[1].bestSeen?.cat,2,'losing two-pair showdown still contributes to best seen');
 advanceLiveTable(t,t.nextAt!);
 showdown('Kh Kd Ks 2c 2d','Ac Ad','Kc Qd');
 assert.equal(t.players[0].bestWinning?.score,strongest.score,'a losing hand never replaces best winning');
 assert.equal(t.players[1].bestSeen?.cat,7,'seen hands include evaluated showdown losses and wins');
 assert.equal(t.players[1].bestWinning?.cat,7);
 advanceLiveTable(t,t.nextAt!);
 showdown('2s 4d 5h 9c Js','Ac Ad','Kc Qd');
 assert.equal(t.players[0].bestWinning?.score,strongest.score,'a weaker later win cannot downgrade the record');
 console.log('PASS — stronger later winning hand replaces earlier hand');
}

if(selected==='side'||selected==='all'){
 const p=Array.from({length:5},(_,i)=>({id:String(i),name:`Fixture ${i}`,rating:1200,isHuman:i===0}));
 const s=newSession(p);s.button=3;
 [1700,2688,4998,1451,2498].forEach((stack,i)=>{s.seats[i].stack=stack;});
 startHand(s,(644).toString(16).padStart(64,'0'));
 const sequence=[{type:'raise',to:2394},{type:'call'},{type:'call'},{type:'fold'},{type:'call'},{type:'check'},{type:'check'},{type:'fold'}] as const;
 for(const action of sequence)applyAction(s,s.toAct,action);
 assert.equal(s.phase,'showdown','with all other players all-in, the last side-pot contender must run out without another fold opportunity');
 assert.equal(s.seats.reduce((sum,seat)=>sum+seat.stack+seat.totalBet,0),13335,'all side-pot contributions must be awarded');
 console.log('PASS — uncontested side pot runs out and preserves every chip');
}

if(selected==='pots'||selected==='all'){
 function pots(contributions:number[],holes:string[],board:string,folded:number[]=[],button=0){
  const state=newSession(contributions.map((_,i)=>({id:String(i),name:`Pot ${i}`,rating:1200,isHuman:i===0})));
  state.phase='betting';state.street='river';state.board=cards(board);state.button=button;
  contributions.forEach((amount,i)=>{const seat=state.seats[i];seat.stack=0;seat.bet=0;seat.totalBet=amount;seat.allIn=true;seat.folded=folded.includes(i);seat.cards=cards(holes[i]);});
  advanceStreet(state);
  assert.equal(state.seats.reduce((sum,seat)=>sum+seat.stack,0),contributions.reduce((sum,n)=>sum+n,0));
  return state.seats.map(seat=>seat.stack);
 }
 assert.deepEqual(pots([100,200,300],['As Ad','Ks Kd','Qs Qd'],'2c 3d 5h 9s Tc'),[300,200,100],'main pot 300, side pot 200 and uncalled 100');
 assert.deepEqual(pots([100,100,1],['2c 3c','4d 5d','6h 7h'],'As Kd Qh Jc Ts',[2]),[100,101,0],'201-chip split gives the odd chip first left of the button');
 assert.deepEqual(pots([50,100,150,200],['As Ad','Ac Ah','Ks Kd','Qs Qd'],'2c 3d 5h 9s Tc'),[100,250,100,50],'four all-ins: split main, separate side-pot winners and refund');
 const state=newSession(people.slice(0,3));state.phase='betting';state.street='river';state.board=cards('2c 3d 5h 9s Tc');state.currentBet=100;state.toAct=2;
 ['Ks Kd','Qs Qd','As Ad'].forEach((hand,i)=>{const seat=state.seats[i];seat.cards=cards(hand);seat.bet=i===2?0:100;seat.totalBet=seat.bet;seat.stack=i===2?40:0;seat.allIn=i!==2;});
 assert.equal(legalActions(state,2).callAmount,40);applyAction(state,2,{type:'call'});
 assert.deepEqual(state.seats.map(seat=>seat.stack),[120,0,120],'short caller wins only 3×40; next best wins 2×60');
 console.log('PASS — hand-computed short calls, main/side pots, tied awards, odd chip and multiple all-ins');
}

if(selected==='refund'||selected==='all'){
 const state=newSession(people.slice(0,3));state.phase='betting';state.street='river';state.board=cards('2c 3d 5h 9s Tc');
 ['As Ad','Ks Kd','Qs Qd'].forEach((hand,i)=>{const seat=state.seats[i];seat.cards=cards(hand);seat.stack=0;seat.bet=0;seat.totalBet=(i+1)*100;seat.allIn=true;});
 advanceStreet(state);
 assert(!state.awards?.some(award=>award.seatIdx===2),'an uncalled excess is a refund, not a winning hand or pot');
 assert.deepEqual(state.seats.map(seat=>seat.stack),[300,200,100]);
 console.log('PASS — uncalled excess returns chips without inventing a pot win');
}
