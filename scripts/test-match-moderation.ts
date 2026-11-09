import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { GET, POST } from "../backend/src/app/api/admin/matches/route";
import { db } from "../backend/src/lib/db";
import { updateRankedQueue } from "../backend/src/lib/ranked-queue";
import { SESSION_COOKIE, signSession } from "../backend/src/lib/session";
import { isolatedDatabaseUrl } from "./lib/test-database.mjs";

assert.equal(process.env.ELO_TEST_DATABASE, "1");
isolatedDatabaseUrl(process.env.DATABASE_URL);
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
process.env.ADMIN_EMAILS = "moderator@fixture.example";
const create = (name: string, email: string, rating = 1200) => db.player.create({
  data: { name, nameKey: name.toLowerCase(), rating, identities: { create: { provider: "google", subject: randomUUID(), email } } },
});
const request = (actor: string, body?: object, key = randomUUID()) => new NextRequest("https://fixture.example/api/admin/matches", {
  method: body ? "POST" : "GET",
  headers: { cookie: `${SESSION_COOKIE}=${signSession(actor)}`, "idempotency-key": key, "content-type": "application/json" },
  body: body ? JSON.stringify(body) : undefined,
});
try {
  const admin = await create("Moderator", "moderator@fixture.example");
  const a = await create("First player", "first@fixture.example", 1260);
  const b = await create("Second player", "second@fixture.example", 1170);
  const match = await db.match.create({ data: {
    state: "SETTLED", handNumber: 10, sharedNetwork: true,
    startedAt: new Date(Date.now() - 20_000), finishedAt: new Date(),
    participants: { create: [a, b].map((player, seat) => ({ playerId: player.id, seat, ratingSnapshot: {} })) },
    settlement: { create: { algorithmVersion: "fixture", result: {} } },
    history: { create: [a, b].map((player, seat) => ({
      playerId: player.id, mode: "RANKED", hands: 10, net: seat ? -20 : 20, finalStack: seat ? 1480 : 1520,
      place: seat + 1, ratingBefore: 1200, ratingAfter: seat ? 1180 : 1220,
    })) },
  } });
  const body = { matchId: match.id, reason: "Fixture moderation reason" };
  assert.equal((await GET(request(a.id))).status, 403);
  assert.equal((await POST(request(a.id, body))).status, 403);
  const review = await (await GET(request(admin.id))).json();
  assert(review.matches[0].flags.includes("Shared network"));
  assert(review.matches[0].flags.includes("Fast completion"));
  const responses = await Promise.all([POST(request(admin.id, body)), POST(request(admin.id, body))]);
  assert(responses.every(response => response.status === 200));
  assert.equal(await db.matchModeration.count({ where: { matchId: match.id } }), 1);
  assert.equal(await db.ratingAdjustment.count({ where: { matchId: match.id } }), 2);
  assert.equal((await db.player.findUniqueOrThrow({ where: { id: a.id } })).rating, 1240);
  assert.equal((await db.player.findUniqueOrThrow({ where: { id: b.id } })).rating, 1190);
  assert.equal(await db.session.count({ where: { matchId: match.id } }), 2);
  assert.equal((await db.match.findUniqueOrThrow({ where: { id: match.id } })).state, "SETTLED");

  const c = await create("Third player", "third@fixture.example");
  const d = await create("Fourth player", "fourth@fixture.example");
  await updateRankedQueue(c.id, "join");
  const pair = await updateRankedQueue(d.id, "join");
  assert(pair?.status === "matched");
  const room = await db.liveRoom.findUniqueOrThrow({ where: { code: pair.code } });
  assert.equal((await POST(request(admin.id, { ...body, matchId: room.matchId! }))).status, 200);
  assert.equal((await db.match.findUniqueOrThrow({ where: { id: room.matchId! } })).state, "VOID");
  assert.equal(await db.rankedSeat.count({ where: { roomCode: room.code } }), 0);
  assert.equal(await db.ratingAdjustment.count({ where: { matchId: room.matchId! } }), 0);
  console.log("PASS — verified admin authorization, flags, concurrent compensating reversal and unrated proposal void");
} finally {
  await db.$disconnect();
}
