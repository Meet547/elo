import type { BotView } from './ai';
import { cardId, SUITS, type Card } from './cards';
import { evaluate } from './evaluator';

/** Sample only UNKNOWN cards, never the actual deck or opponents' hole cards.
 * Equity is an estimate against random hands, not a substitute for range reading.
 * A repeatable seed makes the same visible situation produce the same estimate.
 */
export function estimateBotEquity(view: BotView, samples = 128) {
  const known = new Set([...view.hole, ...view.board].map(card => cardId(card.r, card.s)));
  const unseen: Card[] = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) {
    const id = cardId(r, s);
    if (!known.has(id)) unseen.push({r, s, id});
  }
  let seed = 2166136261;
  for (const char of [...known].sort().join('') + view.playersIn) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  let equity = 0;
  const count = Math.max(1, samples);
  for (let iteration = 0; iteration < count; iteration++) {
    const cards = [...unseen];
    const need = 5 - view.board.length + (view.playersIn - 1) * 2;
    for (let index = 0; index < need; index++) {
      const pick = index + Math.floor(random() * (cards.length - index));
      [cards[index], cards[pick]] = [cards[pick], cards[index]];
    }
    const board = [...view.board, ...cards.slice(0, 5 - view.board.length)];
    const hero = evaluate([...view.hole, ...board]).score;
    let tied = 1;
    let beat = false;
    for (let opponent = 0; opponent < view.playersIn - 1; opponent++) {
      const index = 5 - view.board.length + opponent * 2;
      const score = evaluate([...cards.slice(index, index + 2), ...board]).score;
      if (score > hero) { beat = true; break; }
      if (score === hero) tied++;
    }
    if (!beat) equity += 1 / tied;
  }
  return equity / count;
}
