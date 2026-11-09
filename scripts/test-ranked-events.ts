import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { GET } from "../backend/src/app/api/ranked/events/route";
import { db } from "../backend/src/lib/db";
import { readLiveRoom, commandLiveRoom } from "../backend/src/lib/live-rooms";
import { rankedNetworkTag, updateRankedQueue } from "../backend/src/lib/ranked-queue";
import { shutdownRealtime } from "../backend/src/lib/realtime";
import { SESSION_COOKIE, signSession, revokePlayerSessions } from "../backend/src/lib/session";
import { isolatedDatabaseUrl } from "./lib/test-database.mjs";

assert.equal(process.env.ELO_TEST_DATABASE, "1");
isolatedDatabaseUrl(process.env.DATABASE_URL);
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
const createPlayer = (name: string) => {
  const id = randomUUID();
  return db.player.create({ data: { id, name, nameKey: id, identities: { create: {
    provider: "google", subject: id, email: `${id}@fixture.example`,
  } } } });
};
const request = (id?: string) => new NextRequest("https://fixture.example/api/ranked/events", {
  headers: id ? { cookie: `${SESSION_COOKIE}=${signSession(id)}` } : undefined,
});
async function read(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([reader.read(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Queue event timed out.")), 3000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
const decode = (frame: Uint8Array | undefined) =>
  JSON.parse(new TextDecoder().decode(frame).match(/data: (.+)/)![1]);
try {
  assert.equal((await GET(request())).status, 401);
  const a = await createPlayer("Queue Alice");
  const b = await createPlayer("Queue Bob");
  const tag = rankedNetworkTag("192.0.2.10")!;
  assert(tag && !tag.includes("192.0.2.10"));
  assert.equal(rankedNetworkTag("proxy"), undefined);
  assert.equal((await updateRankedQueue(a.id, "join", db, tag))?.status, "searching");
  const stream = (await GET(request(a.id))).body!.getReader();
  assert.equal(decode((await read(stream)).value).status, "searching");
  const result = await updateRankedQueue(b.id, "join", db, tag);
  assert(result?.status === "matched");
  assert.deepEqual(decode((await read(stream)).value), result);
  assert((await read(stream)).done);
  const room = await db.liveRoom.findUniqueOrThrow({ where: { code: result.code } });
  assert((await db.match.findUniqueOrThrow({ where: { id: room.matchId! } })).sharedNetwork);
  assert.equal(await db.rankedSeat.count({ where: { networkTag: { not: null } } }), 0);

  const proposal = await readLiveRoom(result.code, b.id);
  assert.equal((await commandLiveRoom(result.code, b.id, proposal!.revision, { type: "ready", accept: false })).status, 200);
  assert.equal((await updateRankedQueue(b.id, "join"))?.status, "searching", "recent pair cooldown prevents repeated proposal");
  const reopened = (await GET(request(b.id))).body!.getReader();
  assert.equal(decode((await read(reopened)).value).status, "searching");
  await revokePlayerSessions(b.id);
  assert((await read(reopened)).done, "session revocation closes a live queue stream");
  await db.rankedSeat.update({ where: { playerId: a.id }, data: { joinedAt: new Date(Date.now() - 180_001) } });
  assert.equal((await updateRankedQueue(a.id, "poll"))?.status, "expired");
  console.log("PASS — transactional match push, same-network eligibility, pair cooldown, expiration and session revocation");
} finally {
  await shutdownRealtime();
  await db.$disconnect();
}
