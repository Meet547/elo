import "server-only";

import { randomInt } from "node:crypto";
import type { LiveRoom } from "@prisma/client";
import { db } from "./db";
import { commitRankedRoom } from "./ranked-settlement";
import {
  advanceLiveTable,
  applyLiveCommand,
  newLiveTable,
  publicLiveTable,
  type LiveCommand,
  type LiveTable,
} from "@/lib/poker/live-table";

import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, parseRoomCode } from "@/lib/room-code";

const ROOM_TTL = 24 * 60 * 60 * 1000;

export function roomRecord(table: LiveTable, matchId?: string) {
  return {
    code: Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join(""),
    ...(matchId ? { matchId } : {}),
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

/** Room revisions and ranked transitions are compared inside their database writes. */
async function commit(row: LiveRoom, table: LiveTable) {
  if (table.ranked) return commitRankedRoom(db, row, table);
  return (await db.liveRoom.updateMany({
    where: { code: row.code, revision: row.revision },
    data: { state: JSON.stringify(table), revision: { increment: 1 }, expiresAt: new Date(Date.now() + ROOM_TTL) },
  })).count > 0;
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
  if (table.status === "finished" || table.status === "closed") return { status: 409, room: snapshot(), error: "This room is finished. Commands cannot change its result." } as const;
  if (row.revision !== revision) return { status: 409, room: snapshot(), error: "The table moved. Try again." } as const;
  const player = await db.player.findUnique({ where: { id: playerId, isRival: false } });
  if (!player) return { status: 401, error: "Claim an Elo profile first." } as const;

  const error = applyLiveCommand(table, player, command, Date.now());
  if (error) return { status: 422, room: snapshot(), error } as const;
  if (await commit(row, table)) return { status: 200, room: publicLiveTable(table, playerId, code, row.revision + 1) } as const;
  return { status: 409, room: await readLiveRoom(code, playerId), error: "The table moved. Try again." } as const;
}
