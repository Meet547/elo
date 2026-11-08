import { z } from 'zod';
import { botDecide, type BotView } from '@/lib/poker/ai';
import type { BotAction } from '@/lib/poker/engine';
const card = z.object({r:z.int().min(2).max(14),s:z.enum(['s','h','d','c']),id:z.string().max(3)});
export const botViewSchema = z.object({
  hole:z.array(card).length(2),board:z.array(card).max(5),street:z.enum(['preflop','flop','turn','river']),
  playersIn:z.int().min(2).max(6),bettors:z.int().min(0).max(5),pot:z.int().min(0).max(100000),
  toCall:z.int().min(0).max(100000),currentBet:z.int().min(0).max(100000),bb:z.int().min(1).max(100000),
  stack:z.int().min(0).max(100000),position:z.number().min(0).max(1),canCheck:z.boolean(),canRaise:z.boolean(),
  minRaiseTo:z.int().min(0).max(100000),maxRaiseTo:z.int().min(0).max(100000),
  persona:z.object({tightness:z.number().min(0).max(1),aggression:z.number().min(0).max(1),bluff:z.number().min(0).max(1)}),
});
const decision = z.discriminatedUnion('type',[
  z.object({type:z.literal('check')}),z.object({type:z.literal('fold')}),z.object({type:z.literal('call')}),
  z.object({type:z.literal('raise'),to:z.int().positive()}),
]);
export function legalBotAction(value: unknown, view: BotView): BotAction | null {
  const result=decision.safeParse(value);
  if (!result.success) return null;
  const action=result.data;
  if (action.type==='check' && !view.canCheck) return null;
  if (action.type==='call' && view.toCall<=0) return null;
  if (action.type==='raise' && (!view.canRaise || action.to<view.minRaiseTo || action.to>view.maxRaiseTo)) return null;
  return action;
}
let inFlight=0;
let windowStart=0;
let used=0;
export async function cloudDecision(view: BotView): Promise<{action:BotAction;provider:string}> {
  const fallback=()=>({action:botDecide(view),provider:'heuristic'});
  if (Date.now()-windowStart>=60000) { windowStart=Date.now(); used=0; }
  if (!process.env.OLLAMA_API_KEY || inFlight>=4 || used>=900) return fallback();
  used++;
  inFlight++;
  try {
    const response=await fetch('https://ollama.com/api/chat',{
      method:'POST',headers:{Authorization:`Bearer ${process.env.OLLAMA_API_KEY}`,'Content-Type':'application/json'},
      signal:AbortSignal.timeout(5500),
      body:JSON.stringify({model:process.env.OLLAMA_MODEL || 'gemma4:31b',stream:false,think:false,
        options:{temperature:0.5,num_predict:100},messages:[
          {role:'system',content:'You play no-limit Texas Holdem with virtual chips. Use only your own hole cards and public information supplied. Respect persona and the legal action bounds. Return ONLY JSON: {"type":"fold"|"check"|"call"|"raise","to":integer only for raise}. Never raise outside minRaiseTo/maxRaiseTo; check only when canCheck, call only when toCall>0.'},
          {role:'user',content:JSON.stringify(view)},
        ]}),
    });
    if (!response.ok) return fallback();
    const data=await response.json();
    // Cloud does not support the local API's structured-output format option.
    const text = String(data.message?.content || '{}').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const action=legalBotAction(JSON.parse(text),view);
    return action ? {action,provider:'ollama'} : fallback();
  } catch { return fallback(); }
  finally { inFlight--; }
}
