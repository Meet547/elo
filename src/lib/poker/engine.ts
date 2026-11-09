// ---------------------------------------------------------------------------
// Felt — engine.ts : no-limit hold'em table engine (mutable state + helpers)
//
// The engine is intentionally imperative: the UI driver plays one atomic
// "step" at a time and renders from the same object, so card/chip identity
// stays stable for animation. All money numbers are integers.
// ---------------------------------------------------------------------------

import { Card, secureDeck, deckFromSeed, commitOf } from "./cards";
import { evaluate, HandValue } from "./evaluator";

export type Street = "preflop" | "flop" | "turn" | "river";
export type Phase = "idle" | "betting" | "street-end" | "showdown" | "hand-end" | "session-end";

export interface Persona {
  tightness: number; // 0 loose .. 1 tight
  aggression: number; // 0 passive .. 1 aggressive
  bluff: number; // 0 .. 1
}

export interface Seat {
  idx: number;
  id: string; // db id or bot slug
  name: string;
  isHuman: boolean;
  rating: number;
  stack: number;
  bet: number; // committed on current street
  totalBet: number; // committed this hand
  folded: boolean;
  allIn: boolean;
  out: boolean; // busted for the session
  cards: Card[];
  actedAtBet?: number; // street bet level at the last action, never total hand contribution
  hasActed: boolean; // acted since last full raise this street
  lastAction: string; // display, e.g. "call 120"
  persona?: Persona;
  revealed?: HandValue; // set at showdown
}

export interface Award {
  seatIdx: number;
  amount: number;
  potIndex: number;
  hand?: HandValue;
}

export interface LogEntry {
  seq: number;
  kind: "hand" | "blind" | "action" | "street" | "result" | "info";
  text: string;
}

export interface GameState {
  handNo: number;
  level: number;
  sb: number;
  bb: number;
  button: number;
  seats: Seat[];
  deck: Card[];
  /** hash of the shuffled order, taken before the first card was dealt */
  deckCommit: string;
  /** the secret behind the commit — revealed only once the hand is over */
  deckSeed: string;
  board: Card[];
  street: Street;
  phase: Phase;
  toAct: number; // seat idx or -1
  minRaise: number; // raise increment
  currentBet: number;
  potTotal: number; // sum of all totalBet (display pot)
  collected: number; // chips already swept to the middle on earlier streets
  log: LogEntry[];
  logSeq: number;
  awards: Award[] | null;
  handStartStack: number; // human stack at hand start (for net display)
  fixedBlinds?: [number, number];
  levelMarker: boolean; // blinds went up this hand
}

export const START_STACK = 1500;
export const BLIND_LEVELS: [number, number][] = [
  [10, 20], [15, 30], [25, 50], [40, 80], [60, 120], [100, 200], [150, 300], [250, 500],
];
export const HANDS_PER_LEVEL = 8;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export function aliveSeats(s: GameState): Seat[] {
  return s.seats.filter((x) => !x.out);
}

export function activeSeats(s: GameState): Seat[] {
  // still eligible to win this hand
  return s.seats.filter((x) => !x.out && !x.folded);
}

export function nextAlive(s: GameState, from: number): number {
  const n = s.seats.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    if (!s.seats[idx].out) return idx;
  }
  return from;
}

function nextInHand(s: GameState, from: number): number {
  const n = s.seats.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    const st = s.seats[idx];
    if (!st.out && !st.folded && !st.allIn) return idx;
  }
  return from;
}

export function potTotal(s: GameState): number {
  return s.seats.reduce((acc, x) => acc + x.totalBet, 0);
}

function log(s: GameState, kind: LogEntry["kind"], text: string) {
  s.log.push({ seq: ++s.logSeq, kind, text });
  if (s.log.length > 90) s.log.splice(0, s.log.length - 90);
}

// ---------------------------------------------------------------------------
// session / hand setup
// ---------------------------------------------------------------------------

export function newSession(
  players: { id: string; name: string; isHuman: boolean; rating: number; persona?: Persona }[],
  options: { fixedBlinds?: [number, number] } = {},
): GameState {
  const s: GameState = {
    fixedBlinds: options.fixedBlinds,
    handNo: 0,
    level: 0,
    sb: BLIND_LEVELS[0][0],
    bb: BLIND_LEVELS[0][1],
    button: Math.floor(Math.random() * players.length),
    seats: players.map((p, idx) => ({
      idx,
      id: p.id,
      name: p.name,
      isHuman: p.isHuman,
      rating: p.rating,
      stack: START_STACK,
      bet: 0,
      totalBet: 0,
      folded: false,
      allIn: false,
      out: false,
      cards: [],
      hasActed: false,
      lastAction: "",
      persona: p.persona,
    })),
    deck: [],
    deckCommit: "",
    deckSeed: "",
    board: [],
    street: "preflop",
    phase: "idle",
    toAct: -1,
    minRaise: BLIND_LEVELS[0][1],
    currentBet: 0,
    potTotal: 0,
    collected: 0,
    log: [],
    logSeq: 0,
    awards: null,
    handStartStack: START_STACK,
    levelMarker: false,
  };
  return s;
}

export function humanSeat(s: GameState): Seat {
  return s.seats.find((x) => x.isHuman)!;
}

export function startHand(s: GameState, replaySeed?: string): void {
  s.handNo += 1;
  s.awards = null;
  s.board = [];
  s.potTotal = 0;
  s.collected = 0;
  s.street = "preflop";
  s.phase = "betting";
  s.currentBet = 0;
  s.minRaise = s.bb;
  s.handStartStack = humanSeat(s).stack;
  s.levelMarker = false;

  // busts settle in
  for (const seat of s.seats) {
    if (seat.stack <= 0 && !seat.out) seat.out = true;
  }

  // blinds level
  if (!s.fixedBlinds && s.handNo > 1 && (s.handNo - 1) % HANDS_PER_LEVEL === 0 && s.level < BLIND_LEVELS.length - 1) {
    s.level += 1;
    s.levelMarker = true;
  }
  [s.sb, s.bb] = s.fixedBlinds ?? BLIND_LEVELS[s.level];

  // rotate button among alive seats (after busts)
  if (s.handNo > 1) s.button = nextAlive(s, s.button);

  for (const seat of s.seats) {
    seat.bet = 0;
    seat.totalBet = 0;
    seat.folded = seat.out;
    seat.allIn = false;
    seat.cards = [];
    seat.hasActed = false;
    seat.actedAtBet = 0;
    seat.lastAction = seat.out ? "out" : "";
    seat.revealed = undefined;
  }

  const alive = aliveSeats(s);
  log(s, "hand", `— Hand #${s.handNo} · blinds ${s.sb}/${s.bb} —`);
  if (s.levelMarker) log(s, "info", `Blinds up. Level ${s.level + 1}.`);

  // deal — the deck is shuffled fresh and sealed before a single card moves:
  // the commit is public, the seed stays hidden until the hand is settled.
  // Cards are then delivered round the table starting left of the button, and
  // a burn card goes down before every street, exactly like a live game.
  const replayDeck = replaySeed ? deckFromSeed(replaySeed) : null;
  const sealed = replayDeck && replaySeed ? { deck: replayDeck, seed: replaySeed, commit: commitOf(replaySeed, replayDeck) } : secureDeck();
  s.deck = sealed.deck;
  s.deckSeed = sealed.seed;
  s.deckCommit = sealed.commit;
  log(s, "info", `deck sealed · commit ${s.deckCommit.slice(0, 12)}`);
  for (let round = 0; round < 2; round++) {
    let idx = nextAlive(s, s.button);
    for (let i = 0; i < alive.length; i++) {
      s.seats[idx].cards.push(s.deck.pop()!);
      idx = nextAlive(s, idx);
    }
  }

  // heads-up: button posts SB; otherwise button+1 SB, +2 BB
  const headsUp = alive.length === 2;
  const sbIdx = headsUp ? s.button : nextAlive(s, s.button);
  const bbIdx = nextAlive(s, sbIdx);
  postBlind(s, sbIdx, s.sb, "small blind");
  postBlind(s, bbIdx, s.bb, "big blind");

  s.currentBet = Math.max(...s.seats.map((x) => x.bet));
  s.minRaise = s.bb;

  // first to act preflop
  const sbSeat = s.seats[sbIdx];
  const bbSeat = s.seats[bbIdx];
  if (headsUp) {
    s.toAct = !sbSeat.allIn && !sbSeat.folded && !sbSeat.out ? sbIdx
      : !bbSeat.allIn ? bbIdx : -1;
  } else {
    s.toAct = nextInHand(s, bbIdx);
  }

  // everyone all-in from blinds → run it out immediately
  if (roundComplete(s) || countCanAct(s) <= 0 || (s.toAct >= 0 && !needsAction(s, s.seats[s.toAct]))) {
    s.toAct = -1;
    advanceStreet(s);
  }
}

function postBlind(s: GameState, idx: number, amount: number, label: string) {
  const seat = s.seats[idx];
  const post = Math.min(amount, seat.stack);
  seat.stack -= post;
  seat.bet += post;
  seat.totalBet += post;
  if (seat.stack === 0) seat.allIn = true;
  log(s, "blind", `${seat.name} posts ${label} ${post}`);
}

function countCanAct(s: GameState): number {
  return s.seats.filter((x) => !x.out && !x.folded && !x.allIn).length;
}

// ---------------------------------------------------------------------------
// betting round
// ---------------------------------------------------------------------------

export function needsAction(s: GameState, seat: Seat): boolean {
  return (
    !seat.out && !seat.folded && !seat.allIn &&
    (seat.bet < s.currentBet || !seat.hasActed)
  );
}

export function roundComplete(s: GameState): boolean {
  const active = activeSeats(s);
  if (active.length <= 1) return true;
  const inHand = s.seats.filter((x) => !x.out && !x.folded);
  const canAct = inHand.filter((x) => !x.allIn);
  if (canAct.length === 0) return true; // everyone all-in → run it out
  if (canAct.length === 1 && canAct[0].bet >= s.currentBet) return true;
  return !s.seats.some((x) => needsAction(s, x));
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
  isRaiseLocked: boolean; // short all-in happened: call/fold only
}

export function legalActions(s: GameState, idx: number): LegalActions {
  const seat = s.seats[idx];
  const toCall = Math.min(s.currentBet - seat.bet, seat.stack);
  const callAmount = toCall;
  const isRaiseLocked = seat.hasActed &&
    s.currentBet - (seat.actedAtBet ?? seat.bet) < s.minRaise;
  const canCheck = seat.bet >= s.currentBet;
  const maxRaiseTo = seat.stack + seat.bet;
  const minRaiseTo = Math.min(Math.max(s.currentBet + s.minRaise, s.bb), maxRaiseTo);
  return {
    canFold: true,
    canCheck,
    canCall: !canCheck && toCall > 0,
    callAmount,
    canRaise: maxRaiseTo > s.currentBet && !isRaiseLocked && !(callAmount >= seat.stack),
    minRaiseTo,
    maxRaiseTo,
    isRaiseLocked,
  };
}

export type BotAction =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  | { type: "raise"; to: number };

/** Applies an action for the seat currently to act. Mutates state. */
export function applyAction(s: GameState, idx: number, action: BotAction): void {
  const seat = s.seats[idx];
  const la = legalActions(s, idx);

  if (action.type === "fold") {
    seat.folded = true;
    seat.lastAction = "fold";
    log(s, "action", `${seat.name} folds`);
  } else if (action.type === "check") {
    seat.lastAction = "check";
    log(s, "action", `${seat.name} checks`);
  } else if (action.type === "call") {
    const pay = Math.min(la.callAmount, seat.stack);
    seat.stack -= pay;
    seat.bet += pay;
    seat.totalBet += pay;
    if (seat.stack === 0) seat.allIn = true;
    seat.lastAction = seat.allIn ? `all-in ${seat.bet}` : `call ${seat.bet}`;
    log(s, "action", `${seat.name} calls ${pay}${seat.allIn ? " (all-in)" : ""}`);
  } else {
    // raise / bet (action.to = street total)
    let to = Math.max(Math.min(action.to, la.maxRaiseTo), Math.min(la.minRaiseTo, la.maxRaiseTo));
    // if raising less than a full raise is only possible as all-in, allow it
    if (to < la.maxRaiseTo && to < s.currentBet + s.minRaise) to = la.maxRaiseTo;
    const pay = to - seat.bet;
    seat.stack -= pay;
    seat.bet = to;
    seat.totalBet += pay;
    if (seat.stack === 0) seat.allIn = true;
    const raiseSize = to - s.currentBet;
    const isOpen = s.currentBet === 0 || s.currentBet === s.bb;
    // full raise resets action
    if (raiseSize >= s.minRaise || s.currentBet === 0) {
      s.minRaise = Math.max(raiseSize, s.bb);
      for (const other of s.seats) {
        if (other.idx !== seat.idx && !other.out && !other.folded && !other.allIn) other.hasActed = false;
      }
    }
    s.currentBet = Math.max(s.currentBet, to);
    seat.lastAction = isOpen && s.currentBet === to && s.street === "preflop" && to > s.bb
      ? `raise to ${to}`
      : to === la.maxRaiseTo
        ? `all-in ${to}`
        : s.currentBet === s.bb && to > s.bb
          ? `raise to ${to}`
          : `bet ${to}`;
    log(s, "action", `${seat.name} ${seat.lastAction}`);
  }

  seat.hasActed = true;
  seat.actedAtBet = s.currentBet;

  // single player left → award immediately (fold win)
  if (activeSeats(s).length === 1) {
    s.phase = "hand-end";
    settleFoldWin(s);
    return;
  }
  // round done → advance street or showdown
  if (roundComplete(s)) {
    advanceStreet(s);
  } else {
    s.toAct = nextInHand(s, s.toAct);
  }
}

// ---------------------------------------------------------------------------
// streets, showdown, awards
// ---------------------------------------------------------------------------

function dealNextStreet(s: GameState) {
  const flop = s.board.length === 0;
  s.street = flop ? "flop" : s.board.length === 3 ? "turn" : "river";
  s.deck.pop(); // one burn per street, even when running out an all-in
  for (let i = 0; i < (flop ? 3 : 1); i++) s.board.push(s.deck.pop()!);
  log(s, "street", flop ? "Flop dealt." : s.street === "turn" ? "Turn dealt." : "River dealt.");
}

export function advanceStreet(s: GameState): void {
  // collect bets (bets stay in totalBet; visual layer animates them to pot)
  for (const seat of s.seats) {
    s.collected += seat.bet;
    seat.bet = 0;
    seat.hasActed = false;
    seat.actedAtBet = 0;
  }
  s.currentBet = 0;
  s.minRaise = s.bb;

  const inHand = activeSeats(s);
  const canAct = inHand.filter((x) => !x.allIn);
  const done = s.street === "river" || inHand.length <= 1 || canAct.length <= 1;

  if (done) {
    // Run out the remaining streets using the same burns as a normal hand.
    if (inHand.length > 1 && s.board.length < 5) {
      log(s, "info", "All-in — running it out.");
      while (s.board.length < 5) dealNextStreet(s);
    }
    s.phase = "showdown";
    s.toAct = -1;
    runShowdown(s);
    return;
  }

  dealNextStreet(s);
  s.phase = "betting";
  // first to act postflop: first non-folded, non-allin left of button
  s.toAct = nextInHand(s, s.button);
  if (!needsAction(s, s.seats[s.toAct])) {
    if (roundComplete(s)) advanceStreet(s);
    else s.toAct = nextInHand(s, s.toAct);
  }
}

function settleFoldWin(s: GameState): void {
  const winner = activeSeats(s)[0];
  // uncalled portion returns to the winner
  const others = s.seats.filter((x) => x.idx !== winner.idx);
  const maxOther = Math.max(0, ...others.map((x) => x.totalBet));
  const refund = Math.max(0, winner.totalBet - maxOther);
  const pot = potTotal(s) - refund;
  winner.stack += refund + pot;
  s.potTotal = pot;
  s.collected = refund + pot; // everything on the table goes to the winner
  s.awards = [{ seatIdx: winner.idx, amount: refund + pot, potIndex: 0 }];
  log(s, "result", `${winner.name} takes ${pot}${refund ? ` (uncalled ${refund} returned)` : ""}`);
  for (const seat of s.seats) {
    seat.bet = 0;
    seat.totalBet = 0;
  }
}

function runShowdown(s: GameState): void {
  const inHand = activeSeats(s);
  if (inHand.length === 1) {
    settleFoldWin(s);
    s.phase = "hand-end";
    return;
  }
  for (const seat of inHand) {
    seat.revealed = evaluate([...seat.cards, ...s.board]);
  }

  // An unmatched top contribution is returned, never recorded as a won pot.
  const committed = s.seats.filter(seat => seat.totalBet > 0).sort((a, b) => b.totalBet - a.totalBet);
  if (committed.length) {
    const refund = committed[0].totalBet - (committed[1]?.totalBet ?? 0);
    if (refund > 0) {
      committed[0].stack += refund;
      committed[0].totalBet -= refund;
      s.collected = Math.max(0, s.collected - refund);
      log(s, "info", `${committed[0].name} receives ${refund} uncalled chips back`);
    }
  }

  // side pots: cap levels at all-in amounts
  const contributors = s.seats.filter((x) => x.totalBet > 0);
  const levels = [...new Set(inHand.map((x) => x.totalBet))].sort((a, b) => a - b);
  const awards: Award[] = [];
  let claimed = 0;
  for (let li = 0; li < levels.length; li++) {
    const level = levels[li];
    let pot = 0;
    for (const c of contributors) pot += Math.max(0, Math.min(c.totalBet, level) - Math.min(c.totalBet, claimed));
    claimed = level;
    const eligible = inHand.filter((x) => x.totalBet >= level);
    if (pot <= 0 || eligible.length === 0) continue;
    const best = Math.max(...eligible.map((x) => x.revealed!.score));
    const n = s.seats.length;
    const fromButton = (seat: Seat) => (seat.idx - s.button - 1 + n) % n;
    const winners = eligible.filter((x) => x.revealed!.score === best)
      .sort((a, b) => fromButton(a) - fromButton(b));
    const share = Math.floor(pot / winners.length);
    const oddChips = pot % winners.length;
    for (const [index, w] of winners.entries()) {
      const amount = share + (index < oddChips ? 1 : 0);
      awards.push({ seatIdx: w.idx, amount, potIndex: li, hand: w.revealed });
    }
    if (winners.length > 1) {
      log(s, "result", `Split pot — ${winners.map((w) => w.name).join(" & ")} with ${winners[0].revealed!.name}`);
    } else {
      log(s, "result", `${winners[0].name} wins ${pot} with ${winners[0].revealed!.name}`);
    }
  }
  s.awards = awards;
  for (const a of awards) s.seats[a.seatIdx].stack += a.amount;
  // settle: bets are now in the pots and the pots have been paid out
  for (const seat of s.seats) {
    seat.bet = 0;
    seat.totalBet = 0;
  }
}

/** The pot as it should be displayed: swept chips plus live street bets. */
export function displayPot(s: GameState): number {
  return s.collected + s.seats.reduce((acc, x) => acc + x.bet, 0);
}

/** Called after the awards have rendered; clears the felt for the next hand. */
export function clearTable(s: GameState): void {
  s.collected = 0;
}

/** Called by the driver after awards render; rotates to next hand or ends session. */
export function handFinished(s: GameState): "next" | "session-over" {
  // the hand is over, so the seal can open: publish the seed and let anyone
  // replay the shuffle against the commit that was posted before the deal
  if (s.deckSeed) log(s, "info", `deck opened · seed ${s.deckSeed.slice(0, 12)}… · verify`);
  const alive = aliveSeats(s);
  if (alive.length <= 1 || humanSeat(s).out) {
    s.phase = "session-end";
    return "session-over";
  }
  s.phase = "idle";
  return "next";
}
