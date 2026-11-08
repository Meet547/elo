/** Explicit, opt-in Cloud acceptance check. Never run this from CI or npm test.
 * Supply OLLAMA_API_KEY, or --key-file=/an/untracked/file. No key is logged.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { ROSTER, type BotView } from '../src/lib/poker/ai';
import { cloudDecision, DEFAULT_BOT_MODEL, legalBotAction } from '../backend/src/lib/ollama';
import type { Card } from '../src/lib/poker/cards';
const keyFile=process.argv.find(arg=>arg.startsWith('--key-file='))?.slice(11);
if(keyFile)process.env.OLLAMA_API_KEY=(await readFile(keyFile,'utf8')).trim();
if(!process.env.OLLAMA_API_KEY)throw new Error('Set OLLAMA_API_KEY or provide --key-file.');
const cards=(text:string):Card[]=>text.split(' ').map(id=>({id,r:'23456789TJQKA'.indexOf(id[0])+2,s:id[1] as Card['s']}));
const common:BotView={hole:cards('7c 2d'),board:cards('As Kh Qh Js 9s'),street:'river',playersIn:3,bettors:1,pot:1350,toCall:1200,currentBet:1200,bb:20,stack:1500,position:0.5,canCheck:false,canRaise:false,minRaiseTo:1500,maxRaiseTo:1500,persona:ROSTER[0].persona};
const scenarios=[
 {name:'fold weak hand versus large bet',expected:'fold',view:common},
 {name:'take free check',expected:'check',view:{...common,pot:200,toCall:0,currentBet:0,canCheck:true}},
 {name:'call strong full house when raising unavailable',expected:'call',view:{...common,hole:cards('Ah Ad'),board:cards('As Kd Kc 7h 2s'),playersIn:2,pot:500,toCall:50,currentBet:50}},
 {name:'value raise royal flush',expected:'raise',view:{...common,hole:cards('As Ks'),board:cards('Qs Js Ts'),street:'flop' as const,playersIn:2,pot:200,toCall:20,currentBet:20,canRaise:true,minRaiseTo:40}},
];
const jobs=ROSTER.flatMap(bot=>scenarios.map(scenario=>({bot,scenario})));
const results:{bot:string;scenario:string;expected:string;action:unknown;provider:string;ms:number;passed:boolean}[]=[];
let next=0;
await Promise.all(Array.from({length:3},async()=>{
 while(next<jobs.length){
  const {bot,scenario}=jobs[next++];
  const view={...scenario.view,persona:bot.persona};
  const start=performance.now();const reply=await cloudDecision(view);const ms=Math.round(performance.now()-start);
  const passed=reply.provider==='ollama' && reply.action.type===scenario.expected && legalBotAction(reply.action,view)!==null && ms<10000;
  results.push({bot:bot.slug,scenario:scenario.name,expected:scenario.expected,action:reply.action,provider:reply.provider,ms,passed});
  console.log(`${passed?'PASS':'FAIL'} ${bot.slug}: ${scenario.expected} → ${reply.action.type}, ${reply.provider}, ${ms}ms`);
 }
}));
const times=results.map(r=>r.ms).sort((a,b)=>a-b);
const report={testedAt:new Date().toISOString(),model:process.env.OLLAMA_MODEL||DEFAULT_BOT_MODEL,botCount:ROSTER.length,decisions:results.length,passed:results.filter(r=>r.passed).length,medianMs:times[Math.floor(times.length/2)],p95Ms:times[Math.floor(times.length*.95)],maxMs:times.at(-1),scope:'Four controlled tactical situations per persona. This checks API operation, legal actions and baseline decisions; it does not establish optimal poker play or a universal best model.',results};
await writeFile('docs/validation/ollama-bots.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,results:undefined}));
assert.equal(report.passed,report.decisions,'Inspect docs/validation/ollama-bots.json for failures.');
