/* Rating + matchmaking verification.
 *
 * Checks the properties the ladder promises:
 *   • symmetry      equal seats trade equal and opposite points
 *   • monotonicity  a better finish always pays more, a stronger field always
 *                   pays more for the same finish
 *   • boundedness   no session can move a rating past the exposure limit
 *   • confidence    rd shrinks with play and never leaves its bounds
 *   • matchmaking   five unique seats, a straddling field, a real spread, a
 *                   stable ticket, and no systematic bias toward the player
 */
import {
  applySession,
  CAP_ELITE,
  CAP_PROVISIONAL,
  CAP_SETTLED,
  CAP_VETERAN,
  exposureCap,
  MIN_RD,
  MAX_RD,
  PROVISIONAL_SESSIONS,
  START_RATING,
  START_RD,
  START_VOLATILITY,
  tierOf,
  tierProgress,
} from "../src/lib/rating";
import { buildTableOffer } from "../src/lib/matchmaking";

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log("FAIL:", msg);
};
const snap = (rating: number, rd = START_RD, rated = 40) => ({
  rating,
  rd,
  volatility: START_VOLATILITY,
  rated,
});
const field = (ratings: number[], places: number[], rd = 90) =>
  ratings.map((rating, i) => ({ rating, rd, place: places[i] }));

// ---------------------------------------------------------------- symmetry --
{
  const a = applySession(snap(1200), [{ rating: 1200, rd: START_RD, place: 2 }], 1);
  const b = applySession(snap(1200), [{ rating: 1200, rd: START_RD, place: 1 }], 2);
  if (a.delta + b.delta !== 0) fail(`symmetry: +${a.delta} / ${b.delta}`);
  if (a.rd >= START_RD || b.rd >= START_RD) fail("rd did not shrink after a session");
}

// ------------------------------------------------------------ monotonicity --
{
  const ratings = [1400, 1350, 1300, 1250, 1200];
  const deltas = [1, 2, 3, 4, 5, 6].map((place) => {
    const places = [1, 2, 3, 4, 5, 6].filter((p) => p !== place);
    const others = ratings.map((rating, i) => ({ rating, rd: 80, place: places[i] }));
    return applySession(snap(1300), others, place).delta;
  });
  for (let i = 1; i < deltas.length; i++) {
    if (deltas[i] > deltas[i - 1]) fail(`place ${i + 1} paid more than place ${i}: ${deltas}`);
  }
  if (deltas[0] <= 0 || deltas[5] >= 0) fail(`sweep/loss signs wrong: ${deltas.join(",")}`);

  // same finish, stronger field → bigger gain
  const weak = applySession(snap(1300), field([1050, 1080, 1100, 1120, 1150], [2, 3, 4, 5, 6]), 1);
  const strong = applySession(snap(1300), field([1750, 1780, 1800, 1820, 1850], [2, 3, 4, 5, 6]), 1);
  if (strong.delta <= weak.delta) fail(`field strength ignored: weak ${weak.delta}, strong ${strong.delta}`);
}

// ------------------------------------------------------------ boundedness --
{
  const extreme = [
    applySession(snap(1200, 350, PROVISIONAL_SESSIONS + 5), field([2600, 2600, 2600, 2600, 2600], [2, 3, 4, 5, 6], 60), 1),
    applySession(snap(1200, 110, 0), field([600, 600, 600, 600, 600], [1, 2, 3, 4, 5], 350), 6),
    applySession(snap(2400, 60, 80), field([600, 600, 600, 600, 600], [2, 3, 4, 5, 6], 60), 1),
  ];
  for (const r of extreme) {
    if (Math.abs(r.delta) > exposureCap(r.rated, r.rating)) {
      fail(`delta ${r.delta} exceeded the exposure cap`);
    }
  }
  const settled = applySession(snap(1200, 60, 40), field([1190, 1200, 1210, 1220, 1230], [2, 3, 4, 5, 6], 70), 1);
  if (Math.abs(settled.delta) > CAP_SETTLED) fail(`delta ${settled.delta} exceeded the settled cap`);
}

// ------------------------------------------------------- new-player grace --
{
  // same rough finish, same field: a new seat must lose materially less than
  // an established one, and a top-of-ladder seat must carry the most weight
  const roughField = field([900, 920, 940, 960, 980], [1, 2, 3, 4, 5], 70);
  const rookie = applySession(snap(1400, 110, 0), roughField, 6);
  const established = applySession(snap(1400, 60, 40), roughField, 6);
  const elite = applySession(snap(1950, 60, 80), field([1700, 1720, 1740, 1760, 1780], [1, 2, 3, 4, 5], 70), 6);

  if (Math.abs(rookie.delta) > CAP_PROVISIONAL) fail(`rookie loss ${rookie.delta} exceeded grace cap`);
  if (Math.abs(rookie.delta) >= Math.abs(established.delta)) {
    fail(`rookie loss ${rookie.delta} not softer than established ${established.delta}`);
  }
  if (Math.abs(rookie.delta) > Math.abs(established.delta) * 0.8) {
    fail(`rookie loss ${rookie.delta} is not ~50% softer than ${established.delta}`);
  }
  if (Math.abs(elite.delta) <= CAP_SETTLED) fail(`elite loss ${elite.delta} was not harsher`);

  if (exposureCap(0, 1200) !== CAP_PROVISIONAL) fail("new seat did not get the grace cap");
  if (exposureCap(40, 1400) !== CAP_SETTLED) fail("established seat did not get the settled cap");
  if (exposureCap(40, 1700) !== CAP_VETERAN) fail("veteran seat did not get the veteran cap");
  if (exposureCap(40, 2000) !== CAP_ELITE) fail("elite seat did not get the elite cap");
}

// ------------------------------------------------------------- confidence --
{
  let state = snap(START_RATING, START_RD, 0);
  let previous = state.rd;
  const seen: number[] = [];
  for (let i = 0; i < 30; i++) {
    const next = applySession(state, field([1250, 1240, 1230, 1220, 1210], [2, 3, 4, 5, 6], 90), 1);
    if (next.rd > previous && i > 0) fail(`rd grew at session ${i}: ${previous} → ${next.rd}`);
    if (next.rd < MIN_RD || next.rd > MAX_RD) fail(`rd out of bounds: ${next.rd}`);
    previous = next.rd;
    seen.push(next.rd);
    state = { rating: next.rating, rd: next.rd, volatility: next.volatility, rated: next.rated };
  }
  if (state.rated !== 30) fail(`rated counter wrong: ${state.rated}`);
  if (state.rd > MIN_RD + 6) fail(`rd never settled: ${state.rd}`);
  console.log(`confidence: rd ${START_RD} → ${seen[0]} → ${seen[9]} → ${seen[29]} over 30 sessions`);
}

// ------------------------------------------------------------ matchmaking --
{
  let straddleMisses = 0;
  let straddleSamples = 0;
  let worstMean = 0;
  let worstEdgeDrift = 0;
  let spreadSum = 0;
  let resolvedRecent = 0;
  let avoidSamples = 0;
  let samples = 0;

  for (let rating = 900; rating <= 2100; rating += 50) {
    for (let k = 0; k < 40; k++) {
      const avoid = k % 3 === 0 ? ["osipenko", "knuckleball", "ferreira"] : [];
      if (avoid.length) avoidSamples++;
      const offer = buildTableOffer({ rating, rd: 110, avoid });
      samples++;
      if (offer.opponents.length !== 5) fail(`offer has ${offer.opponents.length} seats`);
      if (new Set(offer.opponents.map((o) => o.slug)).size !== 5) fail("offer has duplicate seats");
      if (offer.tableNo < 1 || offer.tableNo > 9) fail(`bad table number ${offer.tableNo}`);
      // recency must win ties in the dense band; at the ladder's edge the
      // only fair field may be the one you just left, which is correct
      if (rating <= 1700 && offer.opponents.some((o) => avoid.includes(o.slug))) resolvedRecent++;
      const above = offer.opponents.some((o) => o.rating > rating + 12);
      const below = offer.opponents.some((o) => o.rating < rating - 12);
      const drift = Math.abs(offer.fieldAvg - offer.target);
      // the roster has edges: inside them the field must straddle the player
      if (rating >= 1250 && rating <= 1930) {
        straddleSamples++;
        if (!(above && below)) straddleMisses++;
      }
      // the roster is dense through the middle of the ladder; out at the
      // edges the closest available field is all the room can offer
      if (rating >= 1250 && rating <= 1750) worstMean = Math.max(worstMean, drift);
      else worstEdgeDrift = Math.max(worstEdgeDrift, drift);
      spreadSum += offer.spread;

      // the same seed must reproduce the exact table
      const twin = buildTableOffer({ rating, rd: 110, avoid, seed: offer.seed });
      if (twin.opponents.map((o) => o.slug).join() !== offer.opponents.map((o) => o.slug).join()) {
        fail("offer is not deterministic from its seed");
      }
    }
  }
  // no systematic soft tables: across seeds the field average should centre
  // on the target, not below it
  let bias = 0;
  const B = 600;
  for (let i = 0; i < B; i++) {
    // settled players get a level field — no upward or downward tilt
    const offer = buildTableOffer({ rating: 1400, rd: 55 });
    bias += offer.fieldAvg - 1400;
  }
  const meanBias = bias / B;
  if (Math.abs(meanBias) > 12) fail(`matchmaking bias: mean field ${meanBias.toFixed(1)} vs player`);

  const straddleRate = 1 - straddleMisses / straddleSamples;
  if (straddleRate < 0.99) fail(`straddle rate ${(straddleRate * 100).toFixed(1)}%`);
  if (worstMean > 40) fail(`field mean drifted ${worstMean.toFixed(1)} from target`);
  if (worstEdgeDrift > 130) fail(`field mean at the roster edge drifted ${worstEdgeDrift.toFixed(1)}`);
  const avgSpread = spreadSum / samples;
  if (avgSpread < 45) fail(`fields too flat: avg spread ${avgSpread.toFixed(1)}`);
  // recency is a preference, not a guarantee: it may yield to a fairer field.
  // In the dense middle of the ladder it should almost never happen.
  const reseatRate = resolvedRecent / Math.max(1, avoidSamples);
  if (reseatRate > 0.1) fail(`recent opponent re-seated ${(reseatRate * 100).toFixed(1)}% of the time`);

  console.log(
    `matchmaking: ${samples} tickets · straddle ${(straddleRate * 100).toFixed(1)}% · avg spread ${avgSpread.toFixed(0)} · worst mean drift ${worstMean.toFixed(0)} · edge drift ${worstEdgeDrift.toFixed(0)} · bias ${meanBias.toFixed(1)}`,
  );
}

// ---------------------------------------------------- humans first, bots fill --
{
  const humans = [
    { id: "h1", name: "H1", rating: 1455 },
    { id: "h2", name: "H2", rating: 1470 },
  ];
  const offer = buildTableOffer({ rating: 1450, humans });
  if (offer.opponents.length !== 5) fail(`human table has ${offer.opponents.length} seats`);
  if (offer.humans !== 2) fail(`human table seated ${offer.humans} real players, expected 2`);
  if (offer.opponents.filter((o) => o.human).length !== 2) fail("human seats were not flagged");
  if (new Set(offer.opponents.map((o) => o.slug)).size !== 5) fail("human table has duplicate seats");
  const seatedHumans = offer.opponents.filter((o) => o.human).map((o) => o.rating).sort((a, b) => a - b);
  if (seatedHumans.join() !== "1455,1470") fail(`humans were not seated faithfully: ${seatedHumans}`);

  const twin = buildTableOffer({ rating: 1450, humans, seed: offer.seed });
  if (twin.opponents.map((o) => o.slug).join() !== offer.opponents.map((o) => o.slug).join()) {
    fail("a table with humans is not deterministic from its seed");
  }

  // more humans than chairs: the five closest take the table, no bots
  const crowd = Array.from({ length: 7 }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    rating: 1400 + i * 20,
  }));
  const full = buildTableOffer({ rating: 1450, humans: crowd });
  if (full.humans !== 5) fail(`all-human table seated ${full.humans} humans, expected 5`);
  if (full.opponents.length !== 5) fail(`all-human table has ${full.opponents.length} seats`);

  // all-human field that cannot straddle on its own: the repair must never
  // bump a real player for a bot, even though a bot would fix the shape
  const aboveOnly = Array.from({ length: 5 }, (_, i) => ({
    id: `a${i}`,
    name: `A${i}`,
    rating: 1620 + i * 20,
  }));
  const lopsided = buildTableOffer({ rating: 1450, humans: aboveOnly });
  if (lopsided.humans !== 5) fail(`straddle repair dropped a human: ${lopsided.humans} seated`);
  if (lopsided.opponents.some((o) => !o.human)) fail("straddle repair replaced a human with a bot");
}

// -------------------------------------------------------------------- tiers --
{
  if (tierOf(1200).label !== "Paper") fail(`tier at 1200: ${tierOf(1200).label}`);
  const p = tierProgress(1250);
  if (p <= 0 || p > 1) fail(`tier progress out of range: ${p}`);
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
