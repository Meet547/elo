// ---------------------------------------------------------------------------
// Felt — matchmaking.ts : who gets the empty chairs.
//
// The old table was "five random regulars near your rating". This is a proper
// MMR seat-filler with four hard rules and one soft objective:
//
//   HARD  the field average sits within 70 points of your target wherever the
//         room has the chairs for it (the ladder's outer edges are thinner)
//   HARD  the table straddles you — at least one seat above and one below,
//         so there is always someone to chase and someone chasing you
//   HARD  the field is not flat: rating spread stays above ~45 points, which
//         is what makes a six-max table interesting instead of a coin flip
//   HARD  nobody you played in your last few sessions (soft, decays)
//
//   SOFT  prefer the closest available ratings, then vary the table: a small
//         weight against repeating the same personalities every session.
//
// Everything is seeded: the lobby's "tonight's table" ticket is the exact
// table you sit down at. The seed is generated with the same CSPRNG as the
// deck, so the offer cannot be quietly re-rolled for a softer field.
//
// HUMANS FIRST, BOTS TO FILL
// When real players are online they take the seats closest to yours, and the
// house roster fills whatever is left. With nobody online the table is all
// bots — the ladder still runs, and the lobby says so plainly rather than
// pretending a bot is a stranger. This is the one place presence enters
// matchmaking, so adding a real lobby later does not need a second algorithm.
// ---------------------------------------------------------------------------

import { ROSTER, type RosterBot } from "./poker/ai";
import type { Persona } from "./poker/engine";
import { randomSeedHex, streamFromSeedHex, uniformBelow } from "./poker/rng";

/** A regular as they stand on the ladder right now — rating and deviation. */
export type OfferOpponent = RosterBot & { rd: number; human?: boolean };

/** A real player who is online and free to take a seat right now. */
export interface HumanSeat {
  id: string;
  name: string;
  rating: number;
  rd?: number;
}

export interface TableOffer {
  seed: string;
  tableNo: number;
  opponents: OfferOpponent[];
  fieldAvg: number;
  /** standard deviation of the field's ratings */
  spread: number;
  /** the rating this table was built around */
  target: number;
  /** at least one opponent above and one below the player */
  straddles: boolean;
  /** how many of the five seats were real players rather than house bots */
  humans: number;
}

interface Scored {
  bot: RosterBot;
  score: number;
}

/** A seated opponent; `human` marks a real player rather than a house bot. */
type OfferSeat = RosterBot & { human?: boolean };

const FIELD = 5;
const MEAN_TOLERANCE = 70;
const MIN_SPREAD = 45;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const stdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

/** How recently you played someone — a real preference, not a ban. */
function recencyPenalty(bot: RosterBot, avoid: string[]): number {
  const at = avoid.indexOf(bot.slug);
  if (at < 0) return 0;
  // avoid[0] is the most recent table. The newest five carry a 700 → 420
  // penalty: heavy enough that a fresh face wins almost every tie, light
  // enough that the field is never distorted to dodge them.
  return 420 + 280 * (1 - at / Math.max(1, avoid.length));
}

function cost(
  chosen: RosterBot[],
  target: number,
  rating: number,
  requireStraddle: boolean,
  avoid: string[],
): number {
  const values = chosen.map((b) => b.rating);
  const m = mean(values);
  const sd = stdev(values);
  const straddle =
    chosen.some((b) => b.rating > rating + 12) && chosen.some((b) => b.rating < rating - 12);
  const aggression = stdev(chosen.map((b) => b.persona.aggression));
  // recency is a tie-breaker here, never a reason to move the field: 0.05
  // turns the whole penalty into at most ~35 points of preference
  const stale = chosen.reduce((a, b) => a + recencyPenalty(b, avoid), 0) * 0.05;
  return (
    Math.abs(m - target) +
    Math.max(0, MIN_SPREAD - sd) * 2.2 +
    Math.max(0, sd - 170) * 1.4 +
    (requireStraddle && !straddle ? 400 : 0) +
    stale +
    Math.max(0, 0.1 - aggression) * 320
  );
}

/** Weighted sample without replacement — close tables, varied ones. */
function pickWeighted(cands: Scored[], count: number, rand: () => number): RosterBot[] {
  const bag = [...cands];
  const picked: RosterBot[] = [];
  while (picked.length < count && bag.length) {
    const floor = Math.min(...bag.map((c) => c.score));
    const weights = bag.map((c) => Math.exp(-(c.score - floor) / 130));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rand() * total;
    let idx = bag.length - 1;
    for (let i = 0; i < bag.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    picked.push(bag.splice(idx, 1)[0].bot);
  }
  return picked;
}

/**
 * Build a table for a player. Deterministic given the seed, so the lobby
 * ticket, the receipts and a dispute can all be replayed.
 */
export function buildTableOffer(opts: {
  rating: number;
  rd?: number;
  avoid?: string[];
  seed?: string;
  /** the live roster; falls back to the static book when the ladder is cold */
  pool?: RosterBot[];
  /** real players currently free to sit; they are seated before any bot */
  humans?: HumanSeat[];
}): TableOffer {
  const seed = opts.seed ?? randomSeedHex();
  const stream = streamFromSeedHex(seed);
  const rand = () => uniformBelow(() => stream.nextU32(), 1_000_000) / 1_000_000;
  const rating = clamp(Math.round(opts.rating), 100, 4000);
  const rd = opts.rd ?? 110;
  const avoid = (opts.avoid ?? []).slice(0, 12);

  // never hard-filter a recent opponent: at the top of the ladder removing the
  // three best regulars would leave a materially softer table, which is the
  // exact thing matchmaking must not do. Recency is a preference, not a rule.
  const pool = opts.pool && opts.pool.length >= FIELD + 6 ? opts.pool : ROSTER;

  // Real seats are locked in first, closest rating first. They keep their own
  // identity and rating; the house roster only fills what is left.
  const seenHuman = new Set<string>();
  const humanSeats: OfferSeat[] = (opts.humans ?? [])
    .filter((h) => {
      if (!Number.isFinite(h.rating) || seenHuman.has(h.id)) return false;
      seenHuman.add(h.id);
      return true;
    })
    .sort(
      (a, b) =>
        Math.abs(a.rating - rating) - Math.abs(b.rating - rating) || a.id.localeCompare(b.id),
    )
    .slice(0, FIELD)
    .map((h) => ({
      slug: `human-${h.id}`,
      name: h.name,
      rating: clamp(Math.round(h.rating), 100, 4000),
      persona: { tightness: 0.55, aggression: 0.55, bluff: 0.1 },
      hands: 0,
      cashes: 0,
      rd: h.rd ?? 110,
      human: true,
    }));

  const botSlots = FIELD - humanSeats.length;
  const everyone = [...humanSeats, ...pool];

  const LO = Math.min(...everyone.map((b) => b.rating));
  const HI = Math.max(...everyone.map((b) => b.rating));
  // the room has edges: above the best regular, or below the cheapest one, the
  // closest available field is all anyone can be offered. Say so instead of
  // pretending a 2,100 player gets a 2,100 table.
  const canStraddle = rating > LO + 60 && rating < HI - 60;

  // A touch of upward pressure: the more uncertain your rating, the more the
  // room is willing to test you. Settled players get a level field.
  const target = clamp(
    rating + clamp(Math.round((rd - 55) * 0.12), 0, 18),
    LO + 40,
    HI - 40,
  );

  const scoreFor = (bot: RosterBot): number =>
    Math.abs(bot.rating - target) + recencyPenalty(bot, avoid) + rand() * 40;

  const scored = pool.map((bot) => ({ bot, score: scoreFor(bot) })).sort((a, b) => a.score - b.score);

  // a straddle is only promised when the roster can actually provide one
  const requireStraddle =
    canStraddle &&
    everyone.some((b) => b.rating > rating + 12) &&
    everyone.some((b) => b.rating < rating - 12);

  // A shortlist keeps the table in band while still letting the seed choose.
  const shortlist = scored.slice(0, Math.min(18, scored.length));
  let chosen: OfferSeat[] = botSlots > 0 ? [...humanSeats, ...pickWeighted(shortlist, botSlots, rand)] : [...humanSeats];

  const rest: OfferSeat[] = pool.filter((b) => !chosen.includes(b));
  const straddles = (xs: OfferSeat[]) =>
    xs.some((b) => b.rating > rating + 12) && xs.some((b) => b.rating < rating - 12);

  // repair the straddle first — it is the rule players feel
  if (requireStraddle && !straddles(chosen)) {
    const needAbove = !chosen.some((b) => b.rating > rating + 12);
    const fix = rest
      .filter((b) => (needAbove ? b.rating > rating + 12 : b.rating < rating - 12))
      .sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target))[0];
    if (fix) {
      // only a bot can be bumped: a real player keeps the seat they took.
      // -1 means every seat that could be replaced would break the straddle,
      // so the repair is skipped rather than silently swapping seat zero.
      let outIdx = -1;
      let worst = -Infinity;
      chosen.forEach((b, i) => {
        if (b.human) return;
        const others = chosen.filter((_, j) => j !== i);
        if (!straddles([...others, fix])) return;
        const d = Math.abs(b.rating - target);
        if (d > worst) {
          worst = d;
          outIdx = i;
        }
      });
      if (outIdx >= 0) chosen = chosen.map((b, i) => (i === outIdx ? fix : b));
    }
  }

  // then improve mean / spread with greedy swaps until the table is legal
  for (let iter = 0; iter < 12; iter++) {
    const base = cost(chosen, target, rating, requireStraddle, avoid);
    if (base < 1) break;
    let best: { out: RosterBot; inn: RosterBot; cost: number } | null = null;
    for (const out of chosen) {
      if (out.human) continue;
      for (const inn of rest) {
        if (chosen.includes(inn)) continue;
        const next = chosen.map((b) => (b === out ? inn : b));
        if (requireStraddle && !straddles(next)) continue;
        const c = cost(next, target, rating, requireStraddle, avoid);
        if (c < base - 0.5 && (!best || c < best.cost)) best = { out, inn, cost: c };
      }
    }
    if (!best) break;
    chosen = chosen.map((b) => (b === best!.out ? best!.inn : b));
    if (!rest.includes(best.out)) rest.push(best.out);
  }

  // the mean band is a hard promise, not a preference: near the ladder's
  // edges the cheap seats are scarce, so close the last few points of drift
  // with targeted swaps before the table is sealed
  for (let guard = 0; guard < 8; guard++) {
    const drift = Math.abs(mean(chosen.map((b) => b.rating)) - target);
    if (drift <= MEAN_TOLERANCE) break;
    let fix: { out: RosterBot; inn: RosterBot; drift: number } | null = null;
    for (const out of chosen) {
      if (out.human) continue;
      for (const inn of rest) {
        if (chosen.includes(inn)) continue;
        const next = chosen.map((b) => (b === out ? inn : b));
        if (requireStraddle && !straddles(next)) continue;
        if (stdev(next.map((b) => b.rating)) < MIN_SPREAD - 10) continue;
        const d = Math.abs(mean(next.map((b) => b.rating)) - target);
        if (d < drift - 0.5 && (!fix || d < fix.drift)) fix = { out, inn, drift: d };
      }
    }
    if (!fix) break;
    chosen = chosen.map((b) => (b === fix!.out ? fix!.inn : b));
    if (!rest.includes(fix.out)) rest.push(fix.out);
  }

  // seat order is part of the offer — shuffle it with the same seed
  const seated = [...chosen];
  for (let i = seated.length - 1; i > 0; i--) {
    const j = uniformBelow(() => stream.nextU32(), i + 1);
    [seated[i], seated[j]] = [seated[j], seated[i]];
  }

  const values = seated.map((b) => b.rating);
  return {
    seed,
    // the table number is a function of the seed: the ticket cannot change
    // after you have read it
    tableNo: (parseInt(seed.slice(0, 4), 16) % 9) + 1,
    opponents: seated.map((b) => ({ ...b, rd: (b as OfferOpponent).rd ?? 70 })),
    fieldAvg: Math.round(mean(values)),
    spread: Math.round(stdev(values)),
    target,
    straddles: straddles(seated),
    humans: seated.filter((b) => b.human).length,
  };
}

/** The persona spread of a table — used by the lobby ticket copy. */
export function tableTemperament(bots: RosterBot[]): string {
  const agg = mean(bots.map((b) => b.persona.aggression));
  if (agg > 0.66) return "loose & aggressive";
  if (agg > 0.52) return "balanced";
  return "tight & patient";
}

export type { Persona };
