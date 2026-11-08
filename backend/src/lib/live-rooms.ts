import "server-only";

import { randomInt } from "node:crypto";
import type { LiveRoom, Prisma } from "@prisma/client";
import { db } from "./db";
import { applySession } from "@/lib/rating";
import {
  advanceLiveTable,
  applyLiveCommand,
  liveStandings,
  newLiveTable,
  publicLiveTable,
  type LiveCommand,
  type LiveTable,
} from "@/lib/poker/live-table";

import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, parseRoomCode } from "@/lib/room-code";

const ROOM_TTL = 24 * 60 * 60 * 1000;

export function roomRecord(table: LiveTable) {
  return {
    code: Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join(""),
    state: JSON.stringify(table),
    expiresAt: new Date(Date.now() + ROOM_TTL),
  };
}

export function roomCode(input: string) {
  return parseRoomCode(input, true);
}

export async function createLiveRoom(playerId: string) {
  const player = await db.player.findUnique({ where: { id: playerId, isRival: false } });
  if (!player) return null;

  await db.liveRoom.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  const table = newLiveTable(player);
  const row = await db.liveRoom.create({
    data: roomRecord(table),
  });
  return publicLiveTable(table, playerId, row.code, row.revision);
}

async function recordRatings(tx: Prisma.TransactionClient, table: LiveTable) {
  const standings = liveStandings(table);
  const players = await tx.player.findMany({ where: { id: { in: standings.map((seat) => seat.id) } } });
  const byId = new Map(players.map((p) => [p.id, p]));
  const hands = table.ranked!.completedHands;
  const results: { before: number; after: number }[] = [];
  for (const seat of standings) {
    const me = byId.get(seat.id)!;
    const field = standings.filter((other) => other.id !== seat.id).map((other) => ({
      rating: byId.get(other.id)!.rating, rd: byId.get(other.id)!.rd, place: other.place,
    }));
    const rating = applySession(me, field, seat.place);
    const streak = seat.place === 0 ? 0
      : seat.place === 1 ? Math.max(0, me.streak) + 1 : Math.min(0, me.streak) - 1;
    const net = seat.net;
    results[seat.idx] = { before: me.rating, after: rating.rating };
    await tx.player.update({
      where: { id: seat.id },
      data: {
        rating: rating.rating, rd: rating.rd, volatility: rating.volatility, rated: { increment: 1 },
        peak: Math.max(me.peak, rating.rating), hands: { increment: hands },
        cashes: { increment: seat.place === 1 ? 1 : 0 }, netChips: { increment: net },
        biggestPot: Math.max(me.biggestPot, seat.biggestPot), streak, lastSeen: new Date(),
      },
    });
    await tx.session.create({
      data: {
        playerId: seat.id, hands, seats: standings.length, finalStack: seat.stack, net, place: seat.place,
        ratingBefore: me.rating, ratingAfter: rating.rating, biggestPot: seat.biggestPot,
        potsWon: seat.potsWon, bestHand: seat.bestHand,
        exit: seat.place === 0 ? "Ranked draw · 10 hands" : `Ranked ${seat.place === 1 ? "win" : "loss"} · 10 hands · total chip profit`,
      },
    });
  }
  return results;
}

/** Compare and swap the room revision. Terminal ratings commit with the winning write. */
async function commit(row: LiveRoom, table: LiveTable) {
  const args = {
    where: { code: row.code, revision: row.revision },
    data: { state: JSON.stringify(table), revision: { increment: 1 }, expiresAt: new Date(Date.now() + ROOM_TTL) },
  };
  if (!table.ranked || table.status !== "finished") return (await db.liveRoom.updateMany(args)).count > 0;
  return db.$transaction(async (tx) => {
    if ((await tx.liveRoom.updateMany(args)).count === 0) return false;
    table.ranked!.ratings = await recordRatings(tx, table);
    await tx.liveRoom.update({ where: { code: row.code }, data: { state: JSON.stringify(table) } });
    await tx.rankedSeat.deleteMany({ where: { roomCode: row.code } });
    return true;
  });
}

async function currentRoom(code: string) {
  for (let i = 0; i < 4; i++) {
    const row = await db.liveRoom.findUnique({ where: { code } });
    if (!row || row.expiresAt.getTime() <= Date.now()) return null;
    const table = JSON.parse(row.state) as LiveTable;
    if (!advanceLiveTable(table, Date.now())) return { row, table };
    if (await commit(row, table)) return { row: { ...row, revision: row.revision + 1 }, table };
  }
  throw new Error("Concurrent room updates");
}

export async function readLiveRoom(code: string, playerId: string) {
  const room = await currentRoom(code);
  if (room?.table.ranked && !room.table.players.some((seat) => seat.id === playerId)) return null;
  return room && publicLiveTable(room.table, playerId, code, room.row.revision);
}

export async function commandLiveRoom(code: string, playerId: string, revision: number, command: LiveCommand) {
  const room = await currentRoom(code);
  if (!room) return { status: 404, error: "This room expired or does not exist." } as const;
  const { row, table } = room;
  if (table.ranked && !table.players.some((seat) => seat.id === playerId)) return { status: 404, error: "Room not found." } as const;
  const snapshot = () => publicLiveTable(table, playerId, code, row.revision);
  if (row.revision !== revision) return { status: 409, room: snapshot(), error: "The table moved. Try again." } as const;
  const player = await db.player.findUnique({ where: { id: playerId, isRival: false } });
  if (!player) return { status: 401, error: "Claim an Elo profile first." } as const;

  const error = applyLiveCommand(table, player, command, Date.now());
  if (error) return { status: 422, room: snapshot(), error } as const;
  if (await commit(row, table)) return { status: 200, room: publicLiveTable(table, playerId, code, row.revision + 1) } as const;
  return { status: 409, room: await readLiveRoom(code, playerId), error: "The table moved. Try again." } as const;
}
