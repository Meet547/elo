// ---------------------------------------------------------------------------
// Felt — rating.ts : Glicko-2, adapted to six-max placement poker.
//
// WHY GLICKO-2
// A session is not one game. Six players produce five pairwise results: you
// finish above someone or below them. Glicko-2 is built for exactly this —
// a rating period containing several games against opponents whose own
// ratings are uncertain. It gives every player three numbers instead of one:
//
//   rating      the estimate                    (1200 = the middle of the ladder)
//   rd          rating deviation, ± confidence  (110 new → 55 settled)
//   volatility  how erratic recent results are  (starts at 0.06)
//
// Every opponent's rd enters the maths through g(φ), so beating a settled
// 1900 is worth more than beating a provisional 1200 — and beating a player
// the system barely knows yet moves you less than beating a proven one.
// The update is simultaneous: all six seats are rated from the same snapshot,
// so nobody's result depends on who was processed first.
//
// EXPOSURE
// A six-max sweep is five wins in one period, which raw Glicko-2 would price
// at 80–110 points for a new player. That is too much ladder movement for a
// single session, and it invites farming. So the session delta is passed
// through a soft limiter, cap · tanh(raw / cap): monotonic (a bigger result
// always pays more), bounded (no single session can run away), and applied
// identically to wins and losses. The rating deviation still updates from the
// full, unclipped maths — confidence in a player is never faked.
//
// The cap is not one number for everyone. A brand-new seat gets half the
// movement of an established one: two rough sessions should sting, not define
// you. Proven seats carry the full weight of a result, and the top of the
// ladder carries more — the higher you climb, the more a loss costs.
// ---------------------------------------------------------------------------

export const START_RATING = 1200;
/** How sure we are of a brand-new seat. Shrinks every session played. */
export const START_RD = 110;
export const START_VOLATILITY = 0.06;
export const MIN_RD = 55;
export const MAX_RD = 350;
/** Glicko-2 system constant: how much volatility may swing per period. */
export const TAU = 0.5;
/** Sessions before a rating stops being called provisional. */
export const PROVISIONAL_SESSIONS = 12;
/** Soft cap on a session's rating movement, in points. */
/** half the old 54: a new seat's first losses should not define them */
export const CAP_PROVISIONAL = 27;
export const CAP_SETTLED = 42;
export const CAP_VETERAN = 52;
export const CAP_ELITE = 60;
/** Sessions where a seat starts carrying a veteran's exposure. */
export const VETERAN_SESSIONS = 60;
/** Rating where every loss carries elite weight. */
export const ELITE_RATING = 1900;
/** Glicko-2 works on a 1500-centred / 173.7178-scaled axis. */
const SCALE = 173.7178;
const PI2 = Math.PI * Math.PI;

export interface RatingSnapshot {
  rating: number;
  rd: number;
  volatility: number;
  rated: number;
}

export interface OpponentResult {
  rating: number;
  rd: number;
  /** finishing place, 1 = best */
  place: number;
}

export interface SessionRating extends RatingSnapshot {
  /** the number the receipt prints — ratingAfter − ratingBefore */
  delta: number;
  /** what the model expected of you before the session, 0..1 per game */
  expected: number;
}

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / PI2);
const expected = (mu: number, muJ: number, phiJ: number) =>
  1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/**
 * Illinois-algorithm solve for the new volatility (Glickman's step 5).
 * Bounded iteration; converges in a handful of passes at ε = 1e-6.
 */
function newVolatility(phi: number, v: number, delta: number, sigma: number, tau = TAU): number {
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    const d2 = delta * delta;
    return (
      (ex * (d2 - phi * phi - v - ex)) / (2 * (phi * phi + v + ex) ** 2) - (x - a) / (tau * tau)
    );
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * tau) < 0 && k < 100) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > 1e-6; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  return Math.exp(A / 2);
}

/** The soft exposure limiter. Monotonic, odd, bounded by ±cap. */
export function softLimit(raw: number, cap: number): number {
  return cap * Math.tanh(raw / cap);
}

const DAY_MS = 86_400_000;

/** Standard Glicko-2 uncertainty growth over complete inactive periods. */
export function inactiveDeviation(rd: number, volatility: number, periods: number): number {
  return Math.hypot(rd, SCALE * volatility * Math.sqrt(Math.max(0, periods)));
}

export function currentDeviation(player: { rd: number; volatility: number; ratedAt?: Date | null; createdAt: Date }, now = Date.now()) {
  const periods = Math.floor((now - (player.ratedAt ?? player.createdAt).getTime()) / DAY_MS);
  return clamp(inactiveDeviation(player.rd, player.volatility, periods), MIN_RD, MAX_RD);
}

export function glickoPeriod(
  { rating, rd, volatility }: Pick<RatingSnapshot, "rating" | "rd" | "volatility">,
  results: { rating: number; rd: number; score: number }[],
  tau = TAU,
  boundVolatility = (sigma: number) => sigma,
) {
  if (!results.length) return { rating, rd: inactiveDeviation(rd, volatility, 1), volatility, expected: 0.5 };
  const mu = (rating - 1500) / SCALE;
  const phi = rd / SCALE;

  let vInv = 0;
  let dSum = 0;
  let eSum = 0;
  for (const o of results) {
    const muJ = (o.rating - 1500) / SCALE;
    const phiJ = o.rd / SCALE;
    const gj = g(phiJ);
    const E = expected(mu, muJ, phiJ);
    const s = o.score;
    vInv += gj * gj * E * (1 - E);
    dSum += gj * (s - E);
    eSum += E;
  }
  if (vInv <= 0) return { rating, rd, volatility, expected: eSum / results.length };

  const v = 1 / vInv;
  const delta = v * dSum;
  const sigmaPrime = boundVolatility(newVolatility(phi, v, delta, volatility, tau));
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * dSum;

  return { rating: muPrime * SCALE + 1500, rd: phiPrime * SCALE, volatility: sigmaPrime, expected: eSum / results.length };
}

/**
 * One rating period for one seat.
 * `field` are the other seats with their pre-session ratings and places.
 */
export function applySession(
  me: RatingSnapshot,
  field: OpponentResult[],
  myPlace: number,
): SessionRating {
  const base: RatingSnapshot = {
    rating: me.rating,
    rd: clamp(me.rd || START_RD, MIN_RD, MAX_RD),
    volatility: me.volatility || START_VOLATILITY,
    rated: Math.max(0, me.rated ?? 0),
  };
  if (field.length === 0) return { ...base, delta: 0, expected: 0.5 };

  const period = glickoPeriod(base, field.map(opponent => ({
    rating: clamp(opponent.rating, 100, 4000),
    rd: clamp(opponent.rd || START_RD, MIN_RD, MAX_RD),
    score: myPlace < opponent.place ? 1 : myPlace > opponent.place ? 0 : 0.5,
  })), TAU, sigma => clamp(sigma, 0.02, 0.2));
  const raw = period.rating - base.rating;
  const cap = exposureCap(base.rated, base.rating);
  const deltaOut = Math.round(softLimit(raw, cap));
  // the capped move is the new state: the printed delta, the stored rating and
  // the next session's starting point are always the same number
  const ratingOut = Math.round(clamp(base.rating + deltaOut, 400, 4000));

  return {
    rating: ratingOut,
    rd: Math.round(clamp(period.rd, MIN_RD, MAX_RD)),
    volatility: Number(period.volatility.toFixed(6)),
    rated: base.rated + 1,
    delta: ratingOut - base.rating,
    expected: period.expected,
  };
}

/**
 * The most one session may move this seat. New players are protected while
 * the ladder is still learning them; established players carry normal weight;
 * veterans and the elite carry more, because a proven rating is worth more and
 * a loss at the top is a real result.
 */
export function exposureCap(rated: number, rating: number): number {
  if (rated < PROVISIONAL_SESSIONS) return CAP_PROVISIONAL;
  if (rating >= ELITE_RATING || rated >= 120) return CAP_ELITE;
  if (rating >= 1600 || rated >= VETERAN_SESSIONS) return CAP_VETERAN;
  return CAP_SETTLED;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * What a field is likely to do to you, for the lobby ticket: the average
 * win probability against each seat (0..1) and the place that implies.
 */
export function sessionOutlook(
  me: { rating: number; rd: number },
  field: { rating: number; rd: number }[],
): { winProb: number; expectedPlace: number; fieldAvg: number } {
  if (field.length === 0) return { winProb: 0.5, expectedPlace: 1 + field.length / 2, fieldAvg: me.rating };
  const mu = (me.rating - 1500) / SCALE;
  let sum = 0;
  for (const o of field) {
    sum += expected(mu, (o.rating - 1500) / SCALE, clamp(o.rd || START_RD, MIN_RD, MAX_RD) / SCALE);
  }
  // a six-max seat takes it down about 1/6 of the time at parity; the edge
  // against this field scales that number up or down
  const edge = sum / field.length;
  const winProb = clamp(edge * (2 / (field.length + 1)), 0.02, 0.72);
  // expected place: 1 is best, so it runs from 1 to seats as your edge falls
  const expectedPlace = clamp(1 + (field.length - sum) * 0.9, 1, field.length + 1);
  const fieldAvg = Math.round(field.reduce((a, o) => a + o.rating, 0) / field.length);
  return { winProb, expectedPlace, fieldAvg };
}

// ---------------------------------------------------------------------------
// Tiers — the ladder's colour bands. They are cosmetic; the rating is the
// truth. Thresholds line up with the field the roster actually covers.
// ---------------------------------------------------------------------------

const TIERS: { label: string; min: number }[] = [
  { label: "Fresh", min: 0 },
  { label: "Paper", min: 1100 },
  { label: "Steel", min: 1300 },
  { label: "Ochre", min: 1450 },
  { label: "Emerald", min: 1650 },
  { label: "Carmine", min: 1900 },
];

export function tierOf(rating: number): { label: string; min: number } {
  let out = TIERS[0];
  for (const t of TIERS) if (rating >= t.min) out = t;
  return { label: out.label, min: out.min };
}

/** The tier above — null once you sit at Carmine. */
export function nextTierOf(rating: number): { label: string; at: number } | null {
  for (const t of TIERS) if (t.min > rating) return { label: t.label, at: t.min };
  return null;
}

/** 0..1 progress through the current tier (for the sidebar bar). */
export function tierProgress(rating: number): number {
  const tier = tierOf(rating);
  const next = nextTierOf(rating);
  if (!next) return 1;
  return clamp((rating - tier.min) / (next.at - tier.min), 0.02, 1);
}

export function isProvisional(rated: number): boolean {
  return rated < PROVISIONAL_SESSIONS;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
