"use client";

// ---------------------------------------------------------------------------
// Felt — game store. Owns the mutable engine state and drives it one "beat"
// at a time so every animation has a cause: cards dealt, chips pushed,
// pots swept, the receipt printed.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import {
  BotAction,
  GameState,
  LegalActions,
  applyAction,
  clearTable,
  handFinished,
  humanSeat,
  legalActions,
  newSession,
  startHand,
} from "@/lib/poker/engine";
import { ROSTER, botDecide, botThinkTime, botView, type RosterBot } from "@/lib/poker/ai";
import { buildTableOffer, type TableOffer } from "@/lib/matchmaking";
import {
  buildLocalLadder,
  createLocalProfile,
  loadLocalProfile,
  loadLocalSessions,
  localWire,
  saveLocalLadder,
  saveLocalProfile,
  settleLocally,
} from "@/lib/demo";
import {
  setMuted,
  playChip,
  playChipCascade,
  playCardFlick,
  playCheck,
  playFlip,
  playFold,
  playRaise,
  playShuffle,
  playSweep,
  playStamp,
  playTap,
  playTick,
  playWin,
  playYourTurn,
} from "@/lib/felt/sound";

export interface TableOpponent {
  id: string;
  name: string;
  rating: number;
}

export interface LadderRow {
  id: string;
  name: string;
  rating: number;
  rd?: number;
  rated?: number;
  /** Glicko-2 volatility — present on the browser-side demo ladder */
  volatility?: number;
  peak: number;
  hands: number;
  cashes: number;
  streak: number;
  isMe: boolean;
  rank: number;
}

export interface WireRow {
  id: string;
  name: string;
  place: number;
  hands: number;
  net: number;
  ratingBefore: number;
  ratingAfter: number;
  at: string;
}

export interface Profile {
  id: string;
  name: string;
  rating: number;
  /** Glicko-2 rating deviation — how sure the ladder is */
  rd: number;
  /** Glicko-2 volatility — used by the browser-side demo ladder */
  volatility?: number;
  /** rated sessions played */
  rated: number;
  peak: number;
  hands: number;
  cashes: number;
  netChips: number;
  biggestPot: number;
  streak: number;
}

/** One settled session from the ledger — the raw material of the profile. */
export interface SessionRow {
  id: string;
  hands: number;
  net: number;
  place: number;
  seats: number;
  ratingBefore: number;
  ratingAfter: number;
  biggestPot: number;
  potsWon: number;
  bestHand: string | null;
  exit: string | null;
  createdAt: string;
}

export interface SettleResult {
  tableNo: number;
  seat: number;
  hands: number;
  finalStack: number;
  place: number;
  seats: number;
  biggestPot: number;
  bestHand?: string;
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
  rankBefore: number;
  rankAfter: number;
  settledAt: Date;
  /** Glicko-2 deviation after this session — shrinks as the ladder learns you */
  rdAfter?: number;
  /** average win probability the model gave you against this field */
  expected?: number;
  /** mean rating of the five opponents, as the server rated them */
  fieldAvg?: number;
  provisional?: boolean;
}

export type View = "onboard" | "lobby" | "table" | "settle" | "profile";

/** The decision clock that every player at the table can see. */
export interface TurnClock {
  seat: number;
  duration: number; // ms the decision was given
  start: number; // epoch ms when the clock started
}

interface FeltState {
  view: View;
  booting: boolean;
  token: string | null;
  profile: Profile | null;
  ladder: LadderRow[];
  wire: WireRow[];
  ladderLoading: boolean;

  /** the table the lobby is offering — the exact seats you will sit in */
  offer: TableOffer | null;
  /** roster slugs played in the last few sessions, newest first */
  recent: string[];

  game: GameState | null;
  rev: number;
  awaitingHuman: boolean;
  legal: LegalActions | null;
  shotClock: number;
  turn: TurnClock | null;
  dealWave: number;
  /** true while the deck riffles between hands */
  shuffling: boolean;
  lastWinner: { name: string; amount: number; text?: string } | null;
  bustOrder: number[];
  /** the most recently settled deck — commit, revealed seed, hand number */
  lastProof: { handNo: number; seed: string; commit: string } | null;

  tableNo: number;
  opponents: TableOpponent[];
  /** hands completed at this table — gates the cash-out */
  completedHands: number;
  /** bumps when a locked cash-out is attempted, so the UI can say why */
  cashOutNudge: number;
  /** a cash-out is queued for the end of the hand in progress */
  cashOutQueued: boolean;
  sessionBiggestPot: number;
  sessionBestHand?: string;
  /** pots the human took down this session */
  sessionPotsWon: number;
  /** how the human's stack reached zero, if it did */
  humanBust: { hand: number; by?: string; pot?: number } | null;

  settleResult: SettleResult | null;
  settling: boolean;
  muted: boolean;
  wantsLeave: boolean;

  sessions: SessionRow[];
  sessionsLoading: boolean;
}

interface FeltActions {
  boot: () => Promise<void>;
  createProfile: (name: string) => Promise<void>;
  refreshLadder: () => Promise<void>;
  seatTable: () => void;
  reseedOffer: () => void;
  humanAct: (a: { type: "fold" | "check" | "call" | "raise"; to?: number }) => void;
  leaveTable: () => Promise<void>;
  cancelCashOut: () => void;
  playAgain: () => void;
  backToLobby: () => void;
  openProfile: () => void;
  fetchSessions: () => Promise<void>;
  toggleMute: () => void;
}

const RECENT_KEY = "felt_recent_tables";
const HUMAN_CLOCK_MS = 30000;

/** A seat must see this many full hands before the chips can leave the table. */
export const CASH_OUT_MIN_HANDS = 10;

function readRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(0, 10) : [];
  } catch {
    return [];
  }
}

function writeRecent(slugs: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(slugs.slice(0, 10)));
  } catch {
    // storage disabled — the table still works, it just forgets
  }
}

/**
 * The regulars as they stand on the ladder right now. Matchmaking must seat
 * the ratings the server will actually settle against — not the static book —
 * or the ticket would quote numbers that are minutes stale.
 */
function livePool(ladder: LadderRow[]): RosterBot[] | undefined {
  if (ladder.length === 0) return undefined;
  const book = new Map(ROSTER.map((b) => [b.slug, b]));
  const out: RosterBot[] = [];
  for (const row of ladder) {
    if (!row.id.startsWith("rival_")) continue;
    const base = book.get(row.id.slice(6));
    if (!base) continue;
    out.push({ ...base, rating: row.rating, rd: row.rd ?? 70 });
  }
  return out.length >= 10 ? out : undefined;
}

export const useFelt = create<FeltState & FeltActions>((set, get) => ({
  view: "onboard",
  booting: true,
  token: null,
  profile: null,
  ladder: [],
  wire: [],
  ladderLoading: true,
  offer: null,
  recent: [],

  game: null,
  rev: 0,
  awaitingHuman: false,
  legal: null,
  shotClock: -1,
  turn: null,
  dealWave: 0,
  shuffling: false,
  lastWinner: null,
  bustOrder: [],
  lastProof: null,

  tableNo: 1,
  opponents: [],
  completedHands: 0,
  cashOutNudge: 0,
  cashOutQueued: false,
  sessionBiggestPot: 0,
  sessionPotsWon: 0,
  humanBust: null,

  settleResult: null,
  settling: false,
  muted: false,
  wantsLeave: false,

  sessions: [],
  sessionsLoading: false,

  // ------------------------------------------------------------------ boot
  async boot() {
    if (typeof window === "undefined") return;
    const recent = readRecent();
    set({ muted: window.localStorage.getItem("felt_muted") === "1", recent });
    // identity lives in an httpOnly cookie; the client never holds a token
    try {
      const res = await fetch("/api/profile");
      if (res.ok) {
        const { player } = await res.json();
        set({ token: player.id, profile: player, view: "lobby" });
      }
    } catch {
      // offline — onboarding still works when the API returns
    }
    set({ booting: false });
    void get().refreshLadder();
  },

  async createProfile(name) {
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      if (res.status === 429) throw new Error("Too many attempts. Wait a moment and try again.");
      if (res.status === 400) throw new Error("Enter a valid table name.");
      throw new Error("The poker room is unavailable. Try again shortly.");
    }
    const { player } = await res.json();
    set({ token: player.id, profile: player, view: "lobby" });
    void get().refreshLadder();
    get().reseedOffer();
  },

  /** Build the next table offer from the current rating and recent history. */
  reseedOffer() {
    const { profile, recent } = get();
    if (!profile) {
      set({ offer: null });
      return;
    }
    set({
      offer: buildTableOffer({
        rating: profile.rating,
        rd: profile.rd,
        avoid: recent,
        pool: livePool(get().ladder),
      }),
    });
  },

  async refreshLadder() {
    set({ ladderLoading: true });
    try {
      const res = await fetch("/api/leaderboard");
      if (res.ok) {
        const data = await res.json();
        set({ ladder: data.ladder, wire: data.wire, ladderLoading: false });
        if (data.me) set({ profile: data.me });
        // the ticket always quotes the rating the ladder just confirmed
        get().reseedOffer();
      } else {
        set({ ladderLoading: false });
      }
    } catch {
      set({ ladderLoading: false });
    }
  },

  // ------------------------------------------------------------- the table
  seatTable() {
    const st = get();
    if (!st.profile) return;
    // the ticket on screen IS the table: same seats, same number, same seed.
    // Nothing is re-rolled at the moment you sit down.
    const offer =
      st.offer ??
      buildTableOffer({
        rating: st.profile.rating,
        rd: st.profile.rd,
        avoid: st.recent,
        pool: livePool(st.ladder),
      });
    const picked = offer.opponents;
    const opponents: TableOpponent[] = picked.map((b) => ({
      id: `rival_${b.slug}`,
      name: b.name,
      rating: b.rating,
    }));
    const game = newSession([
      { id: st.profile.id, name: st.profile.name, isHuman: true, rating: st.profile.rating },
      ...opponents.map((o, i) => ({
        id: o.id,
        name: o.name,
        isHuman: false,
        rating: o.rating,
        persona: picked[i].persona,
      })),
    ]);
    const recent = [...new Set([...picked.map((b) => b.slug), ...st.recent])].slice(0, 10);
    writeRecent(recent);
    resetDriver();
    // the deck riffles before the first hand too
    playShuffle();
    set({
      view: "table",
      game,
      opponents,
      awaitingHuman: false,
      legal: null,
      turn: null,
      shotClock: -1,
      lastWinner: null,
      bustOrder: [],
      sessionBiggestPot: 0,
      sessionBestHand: undefined,
      sessionPotsWon: 0,
      humanBust: null,
      lastProof: null,
      recent,
      tableNo: offer.tableNo,
      completedHands: 0,
      cashOutNudge: 0,
      cashOutQueued: false,
      dealWave: st.dealWave + 1,
      shuffling: true,
      wantsLeave: false,
      rev: st.rev + 1,
    });
    schedule(() => {
      const g = useFelt.getState().game;
      if (!g) return;
      startHand(g);
      scheduleDealSounds(g);
      useFelt.setState({ shuffling: false });
      bump();
      schedule(tick, 1150);
    }, 1600);
  },

  humanAct(a) {
    const st = get();
    const s = st.game;
    if (!s || !st.awaitingHuman || s.phase !== "betting") return;
    stopShotClock();
    const idx = humanSeat(s).idx;
    const act =
      a.type === "raise" ? ({ type: "raise", to: a.to ?? 0 } as const)
      : a.type === "call" ? ({ type: "call" } as const)
      : a.type === "check" ? ({ type: "check" } as const)
      : ({ type: "fold" } as const);
    applyAndSound(s, idx, act);
    set({ awaitingHuman: false, legal: null, shotClock: -1, turn: null, rev: st.rev + 1 });
    tick();
  },

  async leaveTable() {
    const st = get();
    const s = st.game;
    if (!s || st.settling || st.settleResult) return;

    const human = humanSeat(s);
    // during a betting round, a zero stack is an all-in, not a bust — they can
    // still win the pot, so only a finished hand can call someone out
    const busted = human.out || (s.phase !== "betting" && human.stack <= 0);

    // a funded seat owes the table ten hands; a busted seat owes nothing
    if (!busted && st.completedHands < CASH_OUT_MIN_HANDS) {
      playTap();
      set({ cashOutNudge: st.cashOutNudge + 1 });
      return;
    }

    // between hands (or already out) the chips can leave immediately
    if (busted || s.phase === "idle") {
      if (busted) recordBusts(s, false);
      resetDriver();
      set({
        wantsLeave: true,
        cashOutQueued: true,
        awaitingHuman: false,
        legal: null,
        shotClock: -1,
        turn: null,
      });
      await settleSession();
      return;
    }

    // a hand is live: queue the cash-out for the next boundary instead of
    // folding the player's hand out from under them. The button becomes
    // "cancel" until the hand settles.
    set({
      wantsLeave: true,
      cashOutQueued: true,
      cashOutNudge: st.cashOutNudge + 1,
    });
  },

  cancelCashOut() {
    const st = get();
    if (st.settling || st.settleResult) return;
    set({ wantsLeave: false, cashOutQueued: false });
  },

  playAgain() {
    get().reseedOffer();
    get().seatTable();
  },

  backToLobby() {
    set({ view: "lobby", settleResult: null, wantsLeave: false, cashOutQueued: false });
    void get().refreshLadder();
  },

  openProfile() {
    set({ view: "profile" });
    void get().fetchSessions().catch(() => {});
    void get().refreshLadder();
  },

  async fetchSessions() {
    set({ sessionsLoading: true });
    try {
      const [history, identity] = await Promise.all([
        fetch("/api/history", { cache: "no-store" }),
        fetch("/api/profile", { cache: "no-store" }),
      ]);
      if (!history.ok || !identity.ok) throw new Error("Could not refresh rating history.");
      const [{ sessions }, { player }] = await Promise.all([history.json(), identity.json()]);
      set({ sessions, profile: player });
    } finally {
      set({ sessionsLoading: false });
    }
  },

  toggleMute() {
    const muted = !get().muted;
    setMuted(muted);
    set({ muted });
    if (typeof window !== "undefined") {
      window.localStorage.setItem("felt_muted", muted ? "1" : "0");
    }
  },
}));

// ---------------------------------------------------------------------------
// driver
// ---------------------------------------------------------------------------

const bump = () => useFelt.setState((s) => ({ rev: s.rev + 1 }));

/** Stereo position of each seat — the deal sweeps left to right. */
const SEAT_PAN = [0, 0.68, 0.56, 0, -0.63, -0.68];

/** Dealing order: round-robin from the button, two cards each (75ms apart). */
function dealDelayMs(s: GameState, seatIdx: number, round: number): number {
  const n = s.seats.length;
  const offset = (seatIdx - s.button + n) % n;
  return offset * 75 + round * n * 75;
}

/** One papery flick per card as the deal travels round the table. */
function scheduleDealSounds(s: GameState) {
  for (const seat of s.seats) {
    if (seat.out || seat.cards.length < 2) continue;
    for (let round = 0; round < 2; round++) {
      schedule(() => playCardFlick(SEAT_PAN[seat.idx] ?? 0, 0.9), dealDelayMs(s, seat.idx, round) + 60);
    }
  }
}

/** Community cards: a flick as each leaves the deck, a snap as it turns. */
function playBoardSounds(count: number) {
  for (let i = 0; i < count; i++) {
    schedule(() => playCardFlick(0, 0.8), 40 + i * 90);
    schedule(() => playFlip(), 340 + i * 90);
  }
}

/** Foley for a betting action — the sound IS the action. */
function playForAction(
  act: { type: "fold" | "check" | "call" | "raise"; to?: number },
  strength = 0.5,
) {
  if (act.type === "fold") playFold();
  else if (act.type === "check") playCheck();
  else if (act.type === "call") {
    playChip();
    playChipCascade(2);
  } else {
    // the stack is counted, pressed, and set down — weight follows the raise
    playRaise(strength);
  }
}

/**
 * Apply an action with its full foley: the action itself, the sweep when a
 * street or hand turns, and flicks/flips for any board cards dealt.
 */
function applyAndSound(s: GameState, idx: number, act: BotAction) {
  const before = { street: s.street, phase: s.phase, board: s.board.length };
  // how much of a stack is going in — 0 = a feeler, 1 = the whole thing
  const raiseStrength =
    act.type === "raise"
      ? Math.max(0, Math.min(1, ((act.to ?? 0) - s.currentBet) / Math.max(s.bb * 6, s.potTotal, 1)))
      : 0.5;
  applyAction(s, idx, act);
  playForAction(act, raiseStrength);
  if (crossedStreet(before, s)) playSweep();
  const dealt = s.board.length - before.board;
  if (dealt > 0) playBoardSounds(dealt);
}

function crossedStreet(before: { street: string; phase: string }, s: GameState): boolean {
  return (
    before.street !== s.street ||
    (before.phase !== "showdown" && s.phase === "showdown") ||
    (before.phase !== "hand-end" && s.phase === "hand-end")
  );
}

let timers: ReturnType<typeof setTimeout>[] = [];
let shotInterval: ReturnType<typeof setInterval> | null = null;

function schedule(fn: () => void, ms: number) {
  const t = setTimeout(() => {
    timers = timers.filter((x) => x !== t);
    fn();
  }, ms);
  timers.push(t);
}

function resetDriver() {
  timers.forEach(clearTimeout);
  timers = [];
  stopShotClock();
}

function stopShotClock() {
  if (shotInterval) {
    clearInterval(shotInterval);
    shotInterval = null;
  }
}

function startShotClock() {
  stopShotClock();
  shotInterval = setInterval(() => {
    const left = useFelt.getState().shotClock;
    if (left <= 0) {
      stopShotClock();
      const st = useFelt.getState();
      const s = st.game;
      if (!s || !st.awaitingHuman) return;
      const la = st.legal;
      const act = la?.canCheck ? { type: "check" as const } : { type: "fold" as const };
      applyAndSound(s, humanSeat(s).idx, act);
      useFelt.setState({ awaitingHuman: false, legal: null, shotClock: -1, turn: null });
      bump();
      tick();
      return;
    }
    if (left <= 5) playTick(left <= 3);
    useFelt.setState({ shotClock: left - 1 });
  }, 1000);
}

function tick() {
  const st = useFelt.getState();
  const s = st.game;
  if (!s) return;

  if (s.phase === "betting") {
    const seat = s.seats[s.toAct];
    if (!seat) return;
    if (seat.isHuman) {
      const la = legalActions(s, s.toAct);
      const start = Date.now();
      useFelt.setState({
        awaitingHuman: true,
        legal: la,
        shotClock: HUMAN_CLOCK_MS / 1000,
        turn: { seat: seat.idx, duration: HUMAN_CLOCK_MS, start },
      });
      playYourTurn();
      startShotClock();
      return;
    }
    // the view is frozen now — the bot decides only from what it can see at
    // the moment the clock starts, never from anything that happens after
    const view = botView(s, s.toAct);
    const think = botThinkTime(view);
    useFelt.setState({ turn: { seat: seat.idx, duration: think, start: Date.now() } });
    const actor = s.toAct;
    const hand = s.handNo;
    schedule(() => {
      void (async () => {
        let action = botDecide(view);
        try {
          const response = await fetch("/api/bots/decide", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(view), signal: AbortSignal.timeout(6500),
          });
          if (response.ok) {
            const data = await response.json();
            const candidate = data.action as BotAction;
            if (candidate && (candidate.type === "fold" || (candidate.type === "check" && view.canCheck) || (candidate.type === "call" && view.toCall > 0) ||
              (candidate.type === "raise" && Number.isInteger(candidate.to) && candidate.to >= view.minRaiseTo && candidate.to <= view.maxRaiseTo && view.canRaise))) action = candidate;
          }
        } catch { /* Offline or Cloud timeout: the unranked practice hand continues. */ }
        const g = useFelt.getState().game;
        // Responses from a hand/table that was left must never act on a new one.
        if (g !== s || g.phase !== "betting" || g.handNo !== hand || g.toAct !== actor) return;
        applyAndSound(g, actor, action);
        useFelt.setState({ turn: null });
        bump();
        tick();
      })();
    }, think);
    return;
  }

  if (s.phase === "showdown") {
    playSweep();
    const awards = s.awards ?? [];
    if (awards.length) {
      const human = humanSeat(s);
      if (awards.some((a) => a.seatIdx === human.idx)) playWin();
      const a = awards[0];
      const humanPots = awards.filter((x) => s.seats[x.seatIdx].isHuman).map((x) => x.amount);
      const humanWins = humanPots.length;
      useFelt.setState({
        lastWinner: { name: s.seats[a.seatIdx].name, amount: a.amount, text: a.hand?.name },
        sessionBiggestPot: humanPots.length
          ? Math.max(useFelt.getState().sessionBiggestPot, ...humanPots)
          : useFelt.getState().sessionBiggestPot,
        sessionPotsWon: useFelt.getState().sessionPotsWon + humanWins,
      });
      for (const a of awards) {
        const seat = s.seats[a.seatIdx];
        if (seat.isHuman && a.hand && !useFelt.getState().sessionBestHand) {
          useFelt.setState({ sessionBestHand: a.hand.name });
        }
      }
    }
    bump();
    schedule(() => finishHand(), 3200);
    return;
  }

  if (s.phase === "hand-end") {
    playSweep();
    const awards = s.awards ?? [];
    if (awards.length) {
      const a = awards[0];
      const seat = s.seats[a.seatIdx];
      if (seat.isHuman) playWin();
      useFelt.setState({
        lastWinner: { name: seat.name, amount: a.amount },
        sessionBiggestPot: seat.isHuman
          ? Math.max(useFelt.getState().sessionBiggestPot, a.amount)
          : useFelt.getState().sessionBiggestPot,
        sessionPotsWon: seat.isHuman ? useFelt.getState().sessionPotsWon + 1 : useFelt.getState().sessionPotsWon,
      });
    }
    bump();
    schedule(() => finishHand(), 1500);
    return;
  }

  if (s.phase === "idle") {
    schedule(() => {
      const g = useFelt.getState().game;
      if (!g || g.phase !== "idle") return;
      recordBusts(g, false); // between hands — a bust here is a blinded-out bust
      playShuffle();
      useFelt.setState({ shuffling: true });
      bump();
      schedule(() => {
        const g2 = useFelt.getState().game;
        if (!g2 || g2.phase !== "idle") return;
        startHand(g2);
        scheduleDealSounds(g2);
        useFelt.setState({
          shuffling: false,
          dealWave: useFelt.getState().dealWave + 1,
          lastWinner: null,
        });
        bump();
        schedule(tick, 1150);
      }, 1600);
    }, 450);
  }
}

function recordBusts(g: GameState, fromHand: boolean) {
  const st = useFelt.getState();
  for (const seat of g.seats) {
    if (!seat.out && seat.stack <= 0 && !st.bustOrder.includes(seat.idx)) {
      st.bustOrder.push(seat.idx);
      // the human's exit story: who the last pot went to, if there was one
      if (seat.isHuman && !st.humanBust) {
        const lw = st.lastWinner;
        useFelt.setState({
          humanBust:
            fromHand && lw
              ? { hand: g.handNo, by: lw.name, pot: lw.amount }
              : { hand: g.handNo },
        });
      }
    }
  }
  useFelt.setState({ bustOrder: [...st.bustOrder] });
}

function finishHand() {
  const st = useFelt.getState();
  const s = st.game;
  if (!s) return;
  recordBusts(s, true); // busts inside a hand — the last pot has a winner
  const res = handFinished(s);
  const busted = humanSeat(s).out || humanSeat(s).stack <= 0;
  if (res === "next") clearTable(s); // pot has been pushed; the pill can fade
  // one more hand in the books — this is what unlocks the cash-out
  useFelt.setState({
    completedHands: useFelt.getState().completedHands + 1,
    // keep the sealed proof of the hand that just settled, so the fairness
    // panel can be audited at any moment, not just during the showdown
    lastProof: { handNo: s.handNo, seed: s.deckSeed, commit: s.deckCommit },
  });
  bump();
  // a stack of zero ends the session on its own — no ten-hand wait, no
  // watching the bots finish a tournament you are no longer in
  if (res === "session-over" || busted) {
    useFelt.setState({ wantsLeave: false, cashOutQueued: false });
    resetDriver();
    void settleSession();
    return;
  }
  if (st.wantsLeave) {
    useFelt.setState({ wantsLeave: false, cashOutQueued: false });
    resetDriver();
    void settleSession();
    return;
  }
  tick(); // phase idle → schedules the next hand
}

// ---------------------------------------------------------------------------
// settlement
// ---------------------------------------------------------------------------

async function settleSession() {
  const st = useFelt.getState();
  const s = st.game;
  const me = st.profile;
  if (!s || !me || st.settling) return;
  useFelt.setState({ settling: true });

  const human = humanSeat(s);
  const bust = st.bustOrder;
  const order = [...s.seats].sort((a, b) => {
    if (a.out && b.out) return bust.indexOf(b.idx) - bust.indexOf(a.idx);
    if (a.out) return 1;
    if (b.out) return -1;
    return b.stack - a.stack;
  });
  const place = order.findIndex((x) => x.isHuman) + 1;
  const oppIds = st.opponents.map((o) => o.id);
  const oppPlaces = oppIds.map((id) => order.findIndex((x) => x.id === id) + 1);

  // the "why" line: how the stack actually reached zero
  const hb = useFelt.getState().humanBust;
  const exit =
    human.stack <= 0 && hb
      ? hb.by
        ? `out in hand ${hb.hand} — the $${(hb.pot ?? 0).toLocaleString("en-US")} pot went to ${hb.by}`
        : `out in hand ${hb.hand} — blinded down to nothing`
      : null;

  const base = {
    tableNo: st.tableNo,
    seat: human.idx + 1,
    hands: Math.max(1, st.completedHands),
    finalStack: human.stack,
    place,
    seats: s.seats.length,
    biggestPot: useFelt.getState().sessionBiggestPot,
    bestHand: useFelt.getState().sessionBestHand,
    potsWon: useFelt.getState().sessionPotsWon,
    settledAt: new Date(),
  };

  try {
    const res = await fetch("/api/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hands: base.hands,
        finalStack: base.finalStack,
        place,
        seats: base.seats,
        biggestPot: base.biggestPot,
        bestHand: base.bestHand ?? null,
        exit,
        potsWon: base.potsWon,
        opponentIds: oppIds,
        places: oppPlaces,
        stacks: oppIds.map((id) => s.seats.find((x) => x.id === id)?.stack ?? 0),
      }),
    });
    if (res.ok) {
      const data = await res.json();
      useFelt.setState({
        settleResult: {
          ...base,
          ratingBefore: data.ratingBefore,
          ratingAfter: data.ratingAfter,
          delta: data.delta,
          rankBefore: data.rankBefore,
          rankAfter: data.rankAfter,
          rdAfter: data.rd,
          expected: data.expected,
          fieldAvg: data.fieldAvg,
          provisional: data.provisional,
        },
        profile: {
          ...me,
          rating: data.ratingAfter,
          peak: data.peak,
          rd: data.rd ?? me.rd,
          rated: data.rated ?? (me.rated ?? 0) + 1,
        },
        view: "settle",
        settling: false,
        humanBust: null,
        wantsLeave: false,
        cashOutQueued: false,
      });
      playStamp();
      return;
    }
  } catch {
    // offline fallback below
  }

  useFelt.setState({
    settleResult: {
      ...base,
      ratingBefore: me.rating,
      ratingAfter: me.rating,
      delta: 0,
      rankBefore: 0,
      rankAfter: 0,
    },
    view: "settle",
    settling: false,
    wantsLeave: false,
    cashOutQueued: false,
  });
  playStamp();
}
