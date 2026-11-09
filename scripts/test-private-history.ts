import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { GET } from "../backend/src/app/api/match/[id]/route";
import { db } from "../backend/src/lib/db";
import { commandLiveRoom, readLiveRoom, roomRecord } from "../backend/src/lib/live-rooms";
import { SESSION_COOKIE, signSession } from "../backend/src/lib/session";
import { newSession, startHand } from "../src/lib/poker/engine";
import { newLiveTable, applyLiveCommand } from "../src/lib/poker/live-table";
import { isolatedDatabaseUrl } from "./lib/test-database.mjs";

assert.equal(process.env.ELO_TEST_DATABASE, "1");
isolatedDatabaseUrl(process.env.DATABASE_URL);
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
const realNow = Date.now;
let now = realNow();
Date.now = () => now;
try {
  const players = await Promise.all(["Host", "Guest", "Unrelated"].map(name => db.player.create({ data: { name } })));
  const table = newLiveTable(players[0]);
  assert.equal(applyLiveCommand(table, players[1], { type: "join" }, now), null);
  assert.equal(applyLiveCommand(table, players[0], { type: "start" }, now), null);
  const game = newSession(players.slice(0, 2).map(player => ({ ...player, isHuman: true })));
  game.button = 0;
  startHand(game, "0".repeat(64));
  table.game = game;
  const room = await db.liveRoom.create({ data: roomRecord(table) });
  let view = (await readLiveRoom(room.code, players[0].id))!;
  assert.equal((await commandLiveRoom(room.code, players[view.game!.toAct].id, view.revision, { type: "act", action: { type: "raise", to: 1500 } })).status, 200);
  view = (await readLiveRoom(room.code, players[0].id))!;
  assert.equal((await commandLiveRoom(room.code, players[view.game!.toAct].id, view.revision, { type: "act", action: { type: "call" } })).status, 200);
  view = (await readLiveRoom(room.code, players[0].id))!;
  now = view.nextAt!;
  await Promise.all([readLiveRoom(room.code, players[0].id), readLiveRoom(room.code, players[1].id)]);
  const results = await db.session.findMany({ where: { privateRoomId: room.instanceId } });
  assert.equal(results.length, 2);
  assert.equal(results.reduce((total, row) => total + row.net, 0), 0);
  assert(results.every(row => row.mode === "PRIVATE" && row.ratingBefore === row.ratingAfter));
  const own = results.find(result => result.playerId === players[0].id)!;
  await db.liveRoom.delete({ where: { code: room.code } });
  const request = (id: string) => new NextRequest(`https://fixture.example/api/match/${own.id}`, {
    headers: { cookie: `${SESSION_COOKIE}=${signSession(id)}` },
  });
  const params = Promise.resolve({ id: own.id });
  assert.equal((await GET(request(players[2].id), { params })).status, 404);
  const record = await GET(request(players[0].id), { params });
  assert.equal(record.status, 200);
  assert.equal((await record.json()).results.length, 1);
  console.log("PASS — concurrent private completion writes one unrated result per owner, and records survive room expiry");
} finally {
  Date.now = realNow;
  await db.$disconnect();
}
