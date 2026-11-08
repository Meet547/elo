import { botDecide, type BotView } from './ai';
import type { BotAction } from './engine';
import { BOT_REQUEST_TIMEOUT_MS } from './turn-timing';

/** Start inference immediately. A missing decision at the hard deadline folds. */
export async function requestBotDecision(view: BotView): Promise<BotAction> {
  try {
    const response = await fetch('/api/bots/decide', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(view), signal: AbortSignal.timeout(BOT_REQUEST_TIMEOUT_MS),
    });
    if (response.ok) {
      const candidate = (await response.json()).action as BotAction;
      if (candidate && (candidate.type === 'fold' || (candidate.type === 'check' && view.canCheck) ||
        (candidate.type === 'call' && view.toCall > 0) || (candidate.type === 'raise' && view.canRaise &&
        Number.isInteger(candidate.to) && candidate.to >= view.minRaiseTo && candidate.to <= view.maxRaiseTo))) return candidate;
    }
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return {type:'fold'};
  }
  // An explicit unavailable/invalid response is handled before the deadline.
  return botDecide(view);
}
