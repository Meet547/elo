// ---------------------------------------------------------------------------
// Felt — evaluator.ts : 5 & 7 card hand evaluation
//
// Score layout:  cat * 15^5 + r1*15^4 + r2*15^3 + r3*15^2 + r4*15 + r5
// where r1..r5 are tiebreaker ranks in importance order (0 when absent).
// Higher score always wins. Integer-safe (< 2^31).
// ---------------------------------------------------------------------------

import { Card, RANK_PLURAL, RANK_WORDS } from "./cards";

export const CAT_NAMES = [
  "High Card",
  "One Pair",
  "Two Pair",
  "Three of a Kind",
  "Straight",
  "Flush",
  "Full House",
  "Four of a Kind",
  "Straight Flush",
] as const;

export interface HandValue {
  score: number;
  cat: number;
  /** tiebreaker ranks, importance order */
  tb: number[];
  name: string;
}

function scoreFive(cards: Card[]): HandValue {
  const counts = new Map<number, number>();
  const suitCount = new Map<string, number>();
  for (const c of cards) {
    counts.set(c.r, (counts.get(c.r) ?? 0) + 1);
    suitCount.set(c.s, (suitCount.get(c.s) ?? 0) + 1);
  }

  const flush = [...suitCount.values()].includes(5);

  // groups sorted by (size desc, rank desc)
  const groups = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]));

  // straight detection on unique ranks (incl. wheel)
  const uniq = [...counts.keys()].sort((a, b) => b - a);
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) {
      straightHigh = uniq[0];
    } else if (uniq[0] === 14 && uniq[1] === 5 && uniq[1] - uniq[4] === 3) {
      straightHigh = 5; // wheel A-2-3-4-5
    }
  }

  let cat: number;
  let tb: number[];

  if (flush && straightHigh) {
    cat = 8;
    tb = [straightHigh];
  } else if (groups[0][1] === 4) {
    cat = 7;
    tb = [groups[0][0], groups[1][0]];
  } else if (groups[0][1] === 3 && groups[1][1] === 2) {
    cat = 6;
    tb = [groups[0][0], groups[1][0]];
  } else if (flush) {
    cat = 5;
    tb = uniq;
  } else if (straightHigh) {
    cat = 4;
    tb = [straightHigh];
  } else if (groups[0][1] === 3) {
    cat = 3;
    tb = [groups[0][0], groups[1][0], groups[2][0]];
  } else if (groups[0][1] === 2 && groups[1][1] === 2) {
    cat = 2;
    tb = [groups[0][0], groups[1][0], groups[2][0]];
  } else if (groups[0][1] === 2) {
    cat = 1;
    tb = [groups[0][0], groups[1][0], groups[2][0], groups[3][0]];
  } else {
    cat = 0;
    tb = uniq;
  }

  let score = cat;
  for (let i = 0; i < 5; i++) {
    score = score * 15 + (tb[i] ?? 0);
  }
  return { score, cat, tb, name: describe(cat, tb) };
}

export function describe(cat: number, tb: number[]): string {
  const w = (r: number) => RANK_WORDS[r] ?? "?";
  const p = (r: number) => RANK_PLURAL[r] ?? "?";
  switch (cat) {
    case 8:
      return tb[0] === 14 ? "Royal Flush" : `Straight Flush, ${w(tb[0])} High`;
    case 7:
      return `Four of a Kind, ${p(tb[0])}`;
    case 6:
      return `Full House, ${p(tb[0])} over ${p(tb[1])}`;
    case 5:
      return `Flush, ${w(tb[0])} High`;
    case 4:
      return `Straight, ${w(tb[0])} High`;
    case 3:
      return `Three of a Kind, ${p(tb[0])}`;
    case 2:
      return `Two Pair, ${p(tb[0])} and ${p(tb[1])}`;
    case 1:
      return `Pair of ${p(tb[0])}`;
    default:
      return `High Card ${w(tb[0])}`;
  }
}

const C5 = [
  [0, 1, 2, 3, 4], [0, 1, 2, 3, 5], [0, 1, 2, 3, 6], [0, 1, 2, 4, 5], [0, 1, 2, 4, 6],
  [0, 1, 2, 5, 6], [0, 1, 3, 4, 5], [0, 1, 3, 4, 6], [0, 1, 3, 5, 6], [0, 1, 4, 5, 6],
  [0, 2, 3, 4, 5], [0, 2, 3, 4, 6], [0, 2, 3, 5, 6], [0, 2, 4, 5, 6], [0, 3, 4, 5, 6],
  [1, 2, 3, 4, 5], [1, 2, 3, 4, 6], [1, 2, 3, 5, 6], [1, 2, 4, 5, 6], [1, 3, 4, 5, 6],
  [2, 3, 4, 5, 6],
];

/** Best 5-of-N evaluation (N = 5, 6 or 7). */
export function evaluate(cards: Card[]): HandValue {
  if (cards.length < 5) throw new Error("need at least 5 cards");
  if (cards.length === 5) return scoreFive(cards);
  const combos = combinations(cards.length, 5);
  const pick = (combo: number[]) => combo.map((ix) => cards[ix]);
  let best = scoreFive(pick(combos[0]));
  for (let k = 1; k < combos.length; k++) {
    const v = scoreFive(pick(combos[k]));
    if (v.score > best.score) best = v;
  }
  return best;
}

/** All 5-index combinations of n items (memoised for n = 6, 7). */
const comboCache = new Map<number, number[][]>();
function combinations(n: number, k: number): number[][] {
  const key = n;
  const cached = comboCache.get(key);
  if (cached) return cached;
  const out: number[][] = [];
  const rec = (start: number, cur: number[]) => {
    if (cur.length === k) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i < n; i++) {
      cur.push(i);
      rec(i + 1, cur);
      cur.pop();
    }
  };
  rec(0, []);
  comboCache.set(key, out);
  return out;
}

/**
 * Strength estimate for AI: normalises a hand value to 0..1 within the
 * space of made hands, blending category dominance and tiebreakers.
 */
export function strengthOf(v: HandValue): number {
  const base = v.cat / 8;
  const tb = (v.tb[0] ?? 2) / 14;
  return Math.min(1, base * 0.82 + tb * 0.18);
}

/** Chen formula score for a 2-card start hand (raw, typical range 5..20). */
function chenScore(hole: Card[]): number {
  const [a, b] = [...hole].sort((x, y) => y.r - x.r);
  const hiPts = a.r === 14 ? 10 : a.r === 13 ? 8 : a.r === 12 ? 7 : a.r === 11 ? 6 : a.r / 2;
  let s = hiPts;
  if (a.r === b.r) {
    s = Math.max(5, hiPts * 2);
  } else {
    const gap = a.r - b.r - 1;
    if (gap === 1) s -= 1;
    else if (gap === 2) s -= 2;
    else if (gap === 3) s -= 4;
    else if (gap >= 4) s -= 5;
    if (gap <= 1 && a.r < 12) s += 1;
    if (a.s === b.s) s += 2;
  }
  return Math.max(0, s);
}

/** Shared-card equity approximation for AI decisions (hole + known board). */
export function quickEquity(hole: Card[], board: Card[]): number {
  const known = [...hole, ...board];
  if (known.length < 5) {
    // preflop: normalised Chen score
    return Math.min(1, chenScore(hole) / 20);
  }
  const v = evaluate(known);
  const made = strengthOf(v);
  let draws = 0;
  if (board.length <= 4) {
    // flush draw
    const suitCount = new Map<string, number>();
    for (const c of known) suitCount.set(c.s, (suitCount.get(c.s) ?? 0) + 1);
    for (const n of suitCount.values()) if (n === 4) draws += 0.28;
    // open-ended straight draw (rough)
    const uniq = [...new Set(known.map((c) => c.r))].sort((a, b) => a - b);
    let run = 1;
    for (let i = 1; i < uniq.length; i++) {
      run = uniq[i] === uniq[i - 1] + 1 ? run + 1 : 1;
      if (run >= 4) { draws += 0.18; break; }
    }
    // overcard pair potential preflop handled by made already
  }
  return Math.min(1, made + draws * (board.length === 3 ? 1 : 0.55));
}
