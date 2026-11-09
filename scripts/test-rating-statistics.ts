import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "../backend/src/lib/db";
import { GET } from "../backend/src/app/api/history/route";
import { captureRatingDay } from "../backend/src/lib/rating-audit";
import { SESSION_COOKIE, signSession } from "../backend/src/lib/session";
import { currentDeviation, glickoPeriod } from "../src/lib/rating";
import { ratingCurve, ratingTimeIndex } from "../src/lib/rating-chart";
import { isolatedDatabaseUrl } from "./lib/test-database.mjs";

assert.equal(process.env.ELO_TEST_DATABASE, "1");
isolatedDatabaseUrl(process.env.DATABASE_URL);
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
const initial = { rating: 1500, rd: 200, volatility: .06 };
const example = glickoPeriod(initial, [
  { rating: 1400, rd: 30, score: 1 },
  { rating: 1550, rd: 100, score: 0 },
  { rating: 1700, rd: 300, score: 0 },
]);
assert(Math.abs(example.rating - 1464.06) < .03);
assert(Math.abs(example.rd - 151.52) < .03);
assert(Math.abs(example.volatility - .05999) < .00001);
const start = new Date(0);
const day = 86_400_000;
const inactive = { ...initial, createdAt: start };
assert.equal(currentDeviation(inactive, day - 1), 200);
assert.equal(currentDeviation(inactive, day), glickoPeriod(initial, []).rd);
assert.equal(currentDeviation(inactive, day * 1_000_000), 350);
const curve = ratingCurve([1200, 1210, 1250, 1260], 160, [0, 0, day, day * 10]);
assert.deepEqual(curve.points.map(point => point.x), [0, 0, 10, 100]);
assert(!curve.path.includes("NaN"));
assert.equal(ratingTimeIndex(10, 0, 100, curve.points.map(point => point.x)), 2);
try {
  const owner = await db.player.create({ data: { name: "Statistics owner" } });
  const other = await db.player.create({ data: { name: "Statistics other" } });
  const row = { hands: 2, finalStack: 1505, net: 5, place: 1, ratingBefore: 1200, ratingAfter: 1200, potsWon: 1 };
  await db.session.createMany({ data: Array.from({ length: 80 }, (_, index) => ({
    ...row, playerId: owner.id, createdAt: new Date(index * day),
  })).concat([{ ...row, playerId: other.id, createdAt: new Date(0) }]) });
  const response = await GET(new NextRequest("https://fixture.example/api/history", {
    headers: { cookie: `${SESSION_COOKIE}=${signSession(owner.id)}` },
  }));
  const result = await response.json();
  assert.equal(result.ownerId, owner.id);
  assert.equal(result.sessions.length, 60);
  assert.equal(result.statistics.sessions, 80);
  assert.equal(result.statistics.hands, 160);
  assert.equal(result.statistics.firsts, 80);
  assert.equal(result.statistics.net, 400);

  const first = await captureRatingDay(day * 100);
  assert.equal(first?.unexplained, null);
  assert.equal(await captureRatingDay(day * 100 + 1), null);
  await db.$transaction([
    db.player.update({ where: { id: owner.id }, data: { rating: 1220 } }),
    db.session.create({ data: { ...row, mode: "LEGACY", playerId: owner.id, ratingAfter: 1220 } }),
    db.player.update({ where: { id: other.id }, data: { deletedAt: new Date() } }),
    db.player.create({ data: { name: "Statistics new player" } }),
  ]);
  assert.equal((await captureRatingDay(day * 101))?.unexplained, BigInt(0));
  await db.player.update({ where: { id: owner.id }, data: { rating: { increment: 8 } } });
  assert.equal((await captureRatingDay(day * 102))?.unexplained, BigInt(8));
  console.log("PASS — Glickman vector, inactive RD, real-time chart, lifetime owner statistics and ledger drift detection");
} finally {
  await db.$disconnect();
}
