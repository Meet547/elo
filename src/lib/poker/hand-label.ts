import { RANK_PLURAL, RANK_WORDS } from './cards';
import type { HandValue } from './evaluator';

/** Short, evaluated showdown labels. A fold win never claims an unseen hand. */
export function shortHandLabel(hand?: Pick<HandValue, 'cat' | 'tb'> | null): string {
  if (!hand) return 'Won by Fold';
  const rank = RANK_WORDS[hand.tb[0]];
  const plural = RANK_PLURAL[hand.tb[0]];
  switch (hand.cat) {
    case 8: return hand.tb[0] === 14 ? 'Royal Flush' : 'Straight Flush';
    case 7: return `Four ${plural}`;
    case 6: return 'Full House';
    case 5: return `${rank} High Flush`;
    case 4: return `${rank} High Straight`;
    case 3: return `Three ${plural}`;
    case 2: return 'Two Pair';
    case 1: return `Pair of ${plural}`;
    default: return `${rank} High`;
  }
}
