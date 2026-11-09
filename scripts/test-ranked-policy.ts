import assert from "node:assert/strict";
import {
  chooseRankedOpponent, rankedRange, RANKED_MAX_RANGE, RANKED_SEARCH_MS,
} from "../src/lib/poker/ranked-match";

const base = 1_800_000_000_000;
const entry = (playerId: string, rating: number, rd: number, age = 0, networkTag?: string) =>
  ({ playerId, rating, rd, joinedAt: new Date(base - age), seenAt: new Date(base), networkTag });
assert.equal(rankedRange(base, base, 45), 75);
assert.equal(rankedRange(base, base, 350), 175);
assert.equal(rankedRange(base - 170_000, base, 350), RANKED_MAX_RANGE);
const player = entry("p", 1200, 350, 0, "shared");
const shared = entry("same", 1201, 350, 0, "shared");
const other = entry("other", 1220, 350);
assert.equal(chooseRankedOpponent(player, [shared, other], base), other);
assert.equal(chooseRankedOpponent(player, [shared], base), shared);
assert.equal(chooseRankedOpponent(player, [shared, other], base, new Set(["other"])), shared);
assert.equal(chooseRankedOpponent(player, [entry("narrow", 1280, 45)], base), undefined);
assert.equal(chooseRankedOpponent(player, [entry("late", 1300, 350, 150_000), other], base)?.playerId, "late");
assert.equal(chooseRankedOpponent(entry("late", 1200, 350, RANKED_SEARCH_MS), [other], base), undefined);

// Seeded arrivals across two pools with long-tail ratings and sparse compatible opponents.
let state = 0x35c82b19;
const random = () => {
  state = (Math.imul(1664525, state) + 1013904223) >>> 0;
  return state / 2 ** 32;
};
type Ticket = ReturnType<typeof entry> & { pool: number };
const active: Ticket[] = [];
const waits: number[] = [];
const gaps: number[] = [];
let expired = 0;
for (let second = 0; second <= 10_180; second++) {
  const now = base + second * 1000;
  if (second < 10_000) {
    const rating = 450 + Math.floor(random() * 3000);
    const rd = 60 + Math.floor(random() * 290);
    const pool = random() < .25 ? 0 : 1;
    active.push({ playerId: String(second), rating, rd, joinedAt: new Date(now), seenAt: new Date(now), networkTag: undefined, pool });
  }
  for (let index = active.length - 1; index >= 0; index--) {
    if (now - active[index].joinedAt.getTime() >= RANKED_SEARCH_MS) {
      assert.equal(now - active[index].joinedAt.getTime(), RANKED_SEARCH_MS);
      active.splice(index, 1);
      expired++;
    }
  }
  const renewing = active.filter(player => (now - player.joinedAt.getTime()) % 22_000 === 0);
  for (const player of renewing) player.seenAt = new Date(now);
  for (const player of renewing) {
    if (!active.includes(player)) continue;
    const opponent = chooseRankedOpponent(player, active.filter(ticket => ticket.pool === player.pool), now);
    if (!opponent) continue;
    waits.push(now - player.joinedAt.getTime(), now - opponent.joinedAt.getTime());
    gaps.push(Math.abs(player.rating - opponent.rating));
    active.splice(active.indexOf(player), 1);
    active.splice(active.indexOf(opponent), 1);
  }
}
assert.equal(waits.length + expired, 10_000);
assert.equal(active.length, 0);
assert(waits.every(wait => wait < RANKED_SEARCH_MS));
assert(gaps.every(gap => gap <= RANKED_MAX_RANGE));
const quantile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.ceil(p * values.length) - 1];
console.log(JSON.stringify({
  entries: 10_000, matched: waits.length, expired,
  waitMs: { median: quantile(waits, .5), p95: quantile(waits, .95), max: Math.max(...waits) },
  ratingGap: { median: quantile(gaps, .5), p95: quantile(gaps, .95), max: Math.max(...gaps) },
}));
