import { z } from 'zod';
import { BOT_CLOUD_TIMEOUT_MS } from '@/lib/poker/turn-timing';
import { estimateBotEquity } from '@/lib/poker/bot-equity';
import { evaluate } from '@/lib/poker/evaluator';
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
export const DEFAULT_BOT_MODEL = 'gpt-oss:120b';
export async function cloudDecision(view: BotView): Promise<{action:BotAction;provider:string;model?:string}> {
  const fallback=()=>({action:botDecide(view),provider:'heuristic'});
  if (Date.now()-windowStart>=60000) { windowStart=Date.now(); used=0; }
  if (!process.env.OLLAMA_API_KEY || inFlight>=4 || used>=900) return fallback();
  used++;
  inFlight++;
  try {
    const started = performance.now();
    const model = process.env.OLLAMA_MODEL || DEFAULT_BOT_MODEL;
    const context = {
      ...view,
      madeHand: view.board.length >= 3 ? evaluate([...view.hole, ...view.board]).name : 'Preflop',
      boardHand: view.board.length === 5 ? evaluate(view.board).name : undefined,
      estimatedEquityVsRandom: Number(estimateBotEquity(view).toFixed(3)),
      requiredCallEquity: Number((view.toCall / Math.max(1, view.pot + view.toCall)).toFixed(3)),
      stackToPot: Number((view.stack / Math.max(1, view.pot)).toFixed(2)),
    };
    const response=await fetch('https://ollama.com/api/chat',{
      method:'POST',headers:{Authorization:`Bearer ${process.env.OLLAMA_API_KEY}`,'Content-Type':'application/json'},
      signal:AbortSignal.timeout(Math.max(1, Math.floor(BOT_CLOUD_TIMEOUT_MS - (performance.now() - started)))),
      body:JSON.stringify({model,stream:false,think:model.startsWith('gpt-oss') ? 'low' : false,
        options:{temperature:0.2,num_predict:512},messages:[
          {role:'system',content:'You are an expert no-limit Texas Holdem player using virtual chips. Use only the supplied own cards and public information. Consider made hand, board texture, opponent ranges, position, pot odds, effective stack and persona. Random-hand equity is approximate: discount it against strong betting ranges. Do not fold a free check. Do not pay large bets with weak high-card hands. Extract value with strong made hands and raise unbeatable hands when legal. Balance occasional sensible bluffs using persona, never blind aggression. If the best hand is on the board consider split-pot value. Briefly reason internally, then return ONLY one JSON object: {"type":"fold"|"check"|"call"|"raise","to":integer only for raise}. Check only when canCheck, call only when toCall>0, raise only when canRaise and minRaiseTo<=to<=maxRaiseTo. No markdown or explanation.'},
          {role:'user',content:JSON.stringify(context)},
        ]}),
    });
    if (!response.ok) return fallback();
    const data=await response.json();
    // Cloud does not support the local API's structured-output format option.
    const text = String(data.message?.content || '{}').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const action=legalBotAction(JSON.parse(text),view);
    return action ? {action,provider:'ollama',model} : fallback();
  } catch { return fallback(); }
  finally { inFlight--; }
}
