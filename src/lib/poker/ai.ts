// ---------------------------------------------------------------------------
// Felt — ai.ts : opponent decisions
//
// FAIRNESS GUARANTEE — the bots do not cheat, and the type system makes sure
// they can't. A bot decides with a `BotView` and nothing else: its own two
// hole cards, the public board, and the betting math every player at the
// table can see. The view carries no other seat's cards and no reference to
// the deck, so "peeking" isn't a matter of discipline — it's impossible.
// What's left is a honest poker heuristic: a noisy equity estimate weighed
// against pot odds, position, and a personality.
// ---------------------------------------------------------------------------

import { BotAction, GameState, Persona, legalActions, displayPot } from "./engine";
import { Card } from "./cards";
import { quickEquity } from "./evaluator";

/** Everything a bot is allowed to know when it's their turn. */
export interface BotView {
  hole: Card[]; // the bot's own two cards
  board: Card[]; // community cards everyone can see
  street: GameState["street"];
  /** opponents still contesting the hand (never their cards) */
  playersIn: number;
  /** opponents who have put chips in on this street */
  bettors: number;
  pot: number;
  toCall: number;
  currentBet: number;
  bb: number;
  stack: number;
  position: number; // 0 = on the button … 1 = under the gun
  canCheck: boolean;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
  persona: Persona;
}

/** Distill the table down to what this seat legitimately knows. */
export function botView(state: GameState, idx: number): BotView {
  const seat = state.seats[idx];
  const la = legalActions(state, idx);
  const n = state.seats.length;
  return {
    hole: seat.cards,
    board: state.board,
    street: state.street,
    playersIn: state.seats.filter((x) => !x.out && !x.folded).length,
    bettors: state.seats.filter((x) => !x.out && !x.folded && x.idx !== idx && x.bet > 0).length,
    pot: displayPot(state),
    toCall: la.callAmount,
    currentBet: state.currentBet,
    bb: state.bb,
    stack: seat.stack,
    position: ((idx - state.button + n) % n) / n,
    canCheck: la.canCheck,
    canRaise: la.canRaise,
    minRaiseTo: la.minRaiseTo,
    maxRaiseTo: la.maxRaiseTo,
    persona: seat.persona ?? { tightness: 0.5, aggression: 0.5, bluff: 0.08 },
  };
}

const rnd = () => Math.random();

/** Sample a plausible "thinking time" in ms from the decision's difficulty. */
export function botThinkTime(v: BotView): number {
  const pressure = Math.min(1, v.toCall / Math.max(v.pot, 1));
  const hard = Math.abs(quickEquity(v.hole, v.board) - 0.5) < 0.18 ? 1 : 0.45;
  const base = 480 + pressure * 700 + hard * 620;
  return Math.round(base * (0.75 + rnd() * 0.6));
}

export function botDecide(v: BotView): BotAction {
  const p = v.persona;
  const toCall = v.toCall;

  // equity with noise — bots are good, not psychic
  const noise = (rnd() - 0.5) * 0.06;
  const eq = Math.max(0, Math.min(1, quickEquity(v.hole, v.board) + noise));
  const potOdds = toCall > 0 ? toCall / (v.pot + toCall) : 0;
  const position = v.position;

  // ------- preflop -------
  if (v.street === "preflop") {
    const hu = v.playersIn === 2;
    const shortStacked = v.stack <= v.bb * 9;
    const shove = () => ({ type: "raise" as const, to: v.maxRaiseTo });

    // short stack: push or fold (standard SNG endgame)
    if (shortStacked && toCall > 0) {
      if (eq > (hu ? 0.24 : 0.34) && v.canRaise) return shove();
      if (v.canCheck) return { type: "check" };
      return { type: "fold" };
    }

    const raiseThreshold = 0.5 + p.tightness * 0.16 - position * 0.06;
    const callThreshold = 0.26 + p.tightness * 0.2 - position * 0.05;

    if (hu) {
      // heads-up: widest ranges in poker
      if (v.canCheck) {
        if (eq > 0.52 && v.canRaise && rnd() < 0.45 + p.aggression * 0.3) {
          return { type: "raise", to: raiseSize(v, 2.7 + rnd()) };
        }
        return { type: "check" };
      }
      if (eq > 0.48 - p.tightness * 0.1 && v.canRaise && rnd() < 0.6) {
        return { type: "raise", to: raiseSize(v, 2.7 + rnd()) };
      }
      if (eq > 0.13 - (1 - p.tightness) * 0.05) return { type: "call" };
      return { type: "fold" };
    }

    if (v.canCheck) {
      // unraised pot, option to check or raise
      if (eq > raiseThreshold && v.canRaise) {
        return { type: "raise", to: raiseSize(v, 2.6 + rnd() * 1.2) };
      }
      return { type: "check" };
    }

    if (toCall <= v.bb) {
      // completing the blind
      if (eq > callThreshold) return { type: "call" };
      if (eq > 0.2 && rnd() < 0.25) return { type: "call" };
      return { type: "fold" };
    }

    // facing a raise
    if (eq > 0.68 + (1 - p.aggression) * 0.06 && v.canRaise && rnd() < 0.55 + p.aggression * 0.3) {
      return { type: "raise", to: raiseSize(v, 2.6 + rnd()) };
    }
    if (eq >= potOdds * (1.25 + p.tightness * 0.5)) return { type: "call" };
    if (rnd() < p.bluff * 0.3 && v.canRaise && eq > 0.4) {
      return { type: "raise", to: raiseSize(v, 3) };
    }
    return toCall >= v.stack * 0.5 && eq < 0.55 ? { type: "fold" } : { type: "call" };
  }

  // ------- postflop -------
  const dryBoard = v.board.length > 0 && !v.board.some((c) => c.r >= 11);

  if (toCall === 0) {
    const valueBet = eq > 0.6 - p.aggression * 0.07;
    const bluffBet = eq < 0.42 && rnd() < p.bluff * (dryBoard ? 1.6 : 0.7) && v.bettors === 0;
    if ((valueBet || bluffBet) && v.canRaise) {
      const frac = eq > 0.85 ? 0.8 : 0.45 + p.aggression * 0.35;
      return { type: "raise", to: raiseSize(v, frac * v.playersIn) };
    }
    return { type: "check" };
  }

  // facing a bet
  const committed = toCall >= v.stack * 0.6;
  if (eq > 0.74 && v.canRaise && rnd() < 0.35 + p.aggression * 0.4) {
    return { type: "raise", to: raiseSize(v, 2.4 + rnd() * 0.8) };
  }
  const margin = 1.06 + p.tightness * 0.22 + (committed ? 0.06 : 0);
  if (eq >= potOdds * margin) return { type: "call" };
  if (!committed && eq > potOdds * 0.94 && rnd() < 0.35) return { type: "call" };
  if (rnd() < p.bluff * 0.25 && v.canRaise && v.playersIn === 2) {
    return { type: "raise", to: raiseSize(v, 2.8) };
  }
  return { type: "fold" };
}

/** raise "to" amount: bbMultiple>0 means multiples of pot for postflop sizing. */
function raiseSize(v: BotView, bbMultiple: number): number {
  let to: number;
  if (v.street === "preflop") {
    to = Math.round(bbMultiple * v.bb / 5) * 5;
  } else {
    const frac = Math.min(1, bbMultiple / Math.max(2, v.playersIn));
    to = Math.round((v.pot * frac + v.currentBet * 1.1) / 5) * 5;
  }
  return Math.max(v.minRaiseTo, Math.min(to, v.maxRaiseTo));
}

// ---------------------------------------------------------------------------
// Roster — the ladder's regulars. Each plays their rating.
// ---------------------------------------------------------------------------

export interface RosterBot {
  slug: string;
  name: string;
  rating: number;
  persona: Persona;
  hands: number;
  cashes: number;
  /** live Glicko-2 deviation, filled in from the ladder when the table is built */
  rd?: number;
}

export const ROSTER: RosterBot[] = [
  { slug: "osipenko", name: "V. Osipenko", rating: 1987, persona: { tightness: 0.72, aggression: 0.78, bluff: 0.14 }, hands: 4120, cashes: 611 },
  { slug: "knuckleball", name: "knuckleball", rating: 1874, persona: { tightness: 0.6, aggression: 0.83, bluff: 0.19 }, hands: 3377, cashes: 455 },
  { slug: "ferreira", name: "M. Ferreira", rating: 1809, persona: { tightness: 0.66, aggression: 0.62, bluff: 0.1 }, hands: 2890, cashes: 372 },
  { slug: "henrik", name: "flat_henrik", rating: 1745, persona: { tightness: 0.55, aggression: 0.58, bluff: 0.12 }, hands: 2504, cashes: 301 },
  { slug: "june", name: "June K.", rating: 1712, persona: { tightness: 0.63, aggression: 0.5, bluff: 0.07 }, hands: 1988, cashes: 238 },
  { slug: "riverboat", name: "riverboatron", rating: 1668, persona: { tightness: 0.42, aggression: 0.71, bluff: 0.22 }, hands: 3510, cashes: 389 },
  { slug: "shirokov", name: "A. Shirokov", rating: 1631, persona: { tightness: 0.7, aggression: 0.55, bluff: 0.09 }, hands: 2731, cashes: 296 },
  { slug: "nakamura", name: "L. Nakamura", rating: 1587, persona: { tightness: 0.58, aggression: 0.64, bluff: 0.13 }, hands: 2215, cashes: 240 },
  { slug: "bodega", name: "bodega_cat", rating: 1553, persona: { tightness: 0.47, aggression: 0.66, bluff: 0.18 }, hands: 1980, cashes: 205 },
  { slug: "villanueva", name: "R. Villanueva", rating: 1519, persona: { tightness: 0.61, aggression: 0.52, bluff: 0.1 }, hands: 1766, cashes: 178 },
  { slug: "twelvefold", name: "twelve_fold", rating: 1488, persona: { tightness: 0.52, aggression: 0.59, bluff: 0.15 }, hands: 1543, cashes: 154 },
  { slug: "brennan", name: "M. Brennan", rating: 1462, persona: { tightness: 0.57, aggression: 0.47, bluff: 0.08 }, hands: 1391, cashes: 131 },
  { slug: "okonkwo", name: "T. Okonkwo", rating: 1437, persona: { tightness: 0.49, aggression: 0.62, bluff: 0.16 }, hands: 1288, cashes: 119 },
  { slug: "vasseur", name: "P. Vasseur", rating: 1415, persona: { tightness: 0.65, aggression: 0.44, bluff: 0.06 }, hands: 1102, cashes: 96 },
  { slug: "coldopen", name: "coldopen", rating: 1394, persona: { tightness: 0.44, aggression: 0.57, bluff: 0.21 }, hands: 1017, cashes: 88 },
  { slug: "tanaka", name: "Y. Tanaka", rating: 1376, persona: { tightness: 0.55, aggression: 0.53, bluff: 0.11 }, hands: 942, cashes: 79 },
  { slug: "helen", name: "helennn", rating: 1359, persona: { tightness: 0.4, aggression: 0.48, bluff: 0.17 }, hands: 866, cashes: 71 },
  { slug: "aiyar", name: "F. Aiyar", rating: 1343, persona: { tightness: 0.59, aggression: 0.5, bluff: 0.09 }, hands: 803, cashes: 64 },
  { slug: "polkdot", name: "polk_dot", rating: 1328, persona: { tightness: 0.46, aggression: 0.61, bluff: 0.19 }, hands: 745, cashes: 57 },
  { slug: "rumyantsev", name: "S. Rumyantsev", rating: 1314, persona: { tightness: 0.62, aggression: 0.42, bluff: 0.07 }, hands: 691, cashes: 50 },
  { slug: "matchbox", name: "matchbox_kid", rating: 1301, persona: { tightness: 0.51, aggression: 0.55, bluff: 0.13 }, hands: 640, cashes: 44 },
  { slug: "sorensen", name: "E. Sørensen", rating: 1289, persona: { tightness: 0.54, aggression: 0.49, bluff: 0.1 }, hands: 590, cashes: 39 },
  { slug: "tinroof", name: "tin_roof", rating: 1277, persona: { tightness: 0.43, aggression: 0.58, bluff: 0.2 }, hands: 545, cashes: 34 },
  { slug: "hallberg", name: "N. Hallberg", rating: 1266, persona: { tightness: 0.57, aggression: 0.46, bluff: 0.08 }, hands: 502, cashes: 29 },
  { slug: "quartzy", name: "quartzy", rating: 1255, persona: { tightness: 0.48, aggression: 0.52, bluff: 0.14 }, hands: 460, cashes: 25 },
  { slug: "mbeki", name: "J. Mbeki", rating: 1245, persona: { tightness: 0.56, aggression: 0.5, bluff: 0.11 }, hands: 419, cashes: 21 },
  { slug: "slowroller", name: "slowroller9", rating: 1235, persona: { tightness: 0.66, aggression: 0.38, bluff: 0.05 }, hands: 380, cashes: 18 },
  { slug: "petrova", name: "A. Petrova", rating: 1226, persona: { tightness: 0.52, aggression: 0.54, bluff: 0.12 }, hands: 343, cashes: 15 },
  { slug: "gingham", name: "gingham", rating: 1217, persona: { tightness: 0.45, aggression: 0.57, bluff: 0.18 }, hands: 307, cashes: 12 },
  { slug: "duarte", name: "C. Duarte", rating: 1209, persona: { tightness: 0.53, aggression: 0.48, bluff: 0.09 }, hands: 271, cashes: 9 },
  { slug: "fullringandy", name: "fullring_andy", rating: 1201, persona: { tightness: 0.6, aggression: 0.43, bluff: 0.06 }, hands: 235, cashes: 7 },
  { slug: "kovacs", name: "I. Kovács", rating: 1193, persona: { tightness: 0.49, aggression: 0.56, bluff: 0.15 }, hands: 199, cashes: 5 },
  { slug: "zhang", name: "W. Zhang", rating: 1186, persona: { tightness: 0.55, aggression: 0.5, bluff: 0.1 }, hands: 162, cashes: 3 },
  { slug: "virtanen", name: "H. Virtanen", rating: 1178, persona: { tightness: 0.5, aggression: 0.53, bluff: 0.13 }, hands: 124, cashes: 2 },
];
