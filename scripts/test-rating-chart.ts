import assert from "node:assert/strict";
import { pullDistance, ratingCurve, ratingIndex, ratingReading, ratingWindow, REFRESH_THRESHOLD } from "../src/lib/rating-chart";
import { useFelt, type Profile, type SessionRow } from "../src/store/game";

const history = Array.from({ length: 41 }, (_, index) => ({
  value: 1200 + index * 10,
  at: new Date(Date.UTC(2026, 10, 1, index)).toISOString(),
  label: `session ${index}`,
}));
for (const count of [10, 30, null]) {
  const series = ratingWindow(history, count);
  const end = ratingReading(series, null)!;
  assert.equal(end.point.value, 1600, "all windows end at the same recorded rating");
  assert.equal(series.length, (count ?? 40) + 1);
  assert.equal(end.change, (count ?? 40) * 10, "gain includes the first session in the window");
  assert.equal(ratingReading(series, 0)!.change, 0);
}
for (const scale of [0.7, 1, 1.5]) {
  assert.equal(ratingIndex(100 + 150 * scale, 100, 300 * scale, 41), 20, "scrub is invariant to zoom");
}
assert.equal(ratingIndex(-50, 0, 300, 41), 0);
assert.equal(ratingIndex(500, 0, 300, 41), 40);
assert.equal(ratingIndex(75, 0, 300, 1), 0);
assert.equal(ratingReading([], null), null);
assert.equal(ratingReading([{ value: 0, at: history[0].at }], null)!.percent, 0);
assert.equal(ratingReading([{ value: 1500, at: history[0].at }, { value: 1200, at: history[1].at }], null)!.percent, -20);
const snap = ratingIndex(134, 0, 300, history.length);
assert.equal(ratingReading(history, snap)!.point, history[snap], "scrub never reports an invented measurement");
assert.equal(pullDistance(-10), 0);
assert(pullDistance(64) < REFRESH_THRESHOLD);
assert(pullDistance(67) > REFRESH_THRESHOLD);
assert(pullDistance(120) - pullDistance(100) < pullDistance(40) - pullDistance(20), "later travel has more resistance");

for (const values of [[], [1200], [1200, 1200], [1200, 1500, 1210, 1210, 1550, 1490]]) {
  const curve = ratingCurve(values);
  assert.equal(curve.points.length, values.length);
  assert(!/NaN|Infinity/.test(curve.path));
  const parts = curve.path.match(/C[^C]+/g) ?? [];
  parts.forEach((part, index) => {
    const [, c1y, , c2y, , endY] = part.slice(1).trim().split(/\s+/).map(Number);
    const startY = curve.points[index].y;
    const low = Math.min(startY, endY) - 0.01;
    const high = Math.max(startY, endY) + 0.01;
    for (let step = 0; step <= 100; step++) {
      const t = step / 100;
      const at = (1 - t) ** 3 * startY + 3 * (1 - t) ** 2 * t * c1y + 3 * (1 - t) * t ** 2 * c2y + t ** 3 * endY;
      assert(at >= low && at <= high, "curve cannot create a peak or dip between real readings");
    }
  });
}

// A failed refresh must preserve both parts of the last good snapshot.
const originalFetch = globalThis.fetch;
const profile: Profile = { id: "chart-test", name: "Chart test", rating: 1200, rd: 110, rated: 0, peak: 1200, hands: 0, cashes: 0, netChips: 0, biggestPot: 0, streak: 0 };
const sessions: SessionRow[] = [{ id: "test-session", hands: 10, net: 100, place: 1, seats: 2, ratingBefore: 1200, ratingAfter: 1220, biggestPot: 100, potsWon: 1, bestHand: null, exit: null, createdAt: history[0].at }];
try {
  useFelt.setState({ profile, sessions: [] });
  globalThis.fetch = (async (input: string | URL | Request) => String(input).includes("history")
    ? Response.json({ sessions, ownerId: profile.id, statistics: null, ratingHistory: [] }) : Response.json({ player: { ...profile, rating: 1220 } })) as typeof fetch;
  await useFelt.getState().fetchSessions();
  assert.equal(useFelt.getState().profile!.rating, 1220);
  assert.equal(useFelt.getState().sessions[0].ratingAfter, 1220);
  assert.equal(useFelt.getState().sessionsLoading, false);
  for (const failedRoute of ["history", "profile"]) {
    globalThis.fetch = (async (input: string | URL | Request) => String(input).includes(failedRoute)
      ? new Response("unavailable", { status: 503 })
      : Response.json({ sessions: [], player: { ...profile, rating: 900 } })) as typeof fetch;
    await assert.rejects(useFelt.getState().fetchSessions());
    assert.equal(useFelt.getState().profile!.rating, 1220);
    assert.equal(useFelt.getState().sessions[0].ratingAfter, 1220);
    assert.equal(useFelt.getState().sessionsLoading, false);
  }
} finally {
  globalThis.fetch = originalFetch;
}
console.log("ALL PASS — rating windows, real readings, zoom, resistance, curve bounds, atomic refresh, and failure recovery");
