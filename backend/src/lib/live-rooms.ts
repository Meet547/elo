import "server-only";

import { randomInt } from "node:crypto";
import type { LiveRoom } from "@prisma/client";
import { db } from "./db";
import {inTransaction,type DatabaseClient} from "./unit-of-work";
import { commitRankedRoom } from "./ranked-settlement";
import {
  advanceLiveTable,
  refreshFairEvidence,
  applyLiveCommand,
  newLiveTable,
  liveStandings,
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
    nextDeadlineAt: table.nextAt === null ? null : new Date(table.nextAt),
    state: JSON.stringify(table),
    expiresAt: new Date(Date.now() + ROOM_TTL),
  };
}

export function roomCode(input: string) {
  return parseRoomCode(input, true);
}

export async function createLiveRoom(playerId: string, client:DatabaseClient=db) {
  const player = await client.player.findUnique({ where: { id: playerId, isSimulated: false, deletedAt:null } });
  if (!player) return null;

  await client.liveRoom.deleteMany({ where: { matchId:null, expiresAt: { lte: new Date() } } });
  const table = newLiveTable(player,true);
  const row = await client.liveRoom.create({
    data: roomRecord(table),
  });
  return publicLiveTable(table, playerId, row.code, row.revision);
}

/** Room revisions and ranked transitions are compared inside their database writes. */
async function commit(row: LiveRoom, table: LiveTable, client:DatabaseClient=db) {
  refreshFairEvidence(table);
  if (table.ranked) return commitRankedRoom(client, row, table);
  return inTransaction(client, async tx => {
    const updated = await tx.liveRoom.updateMany({
      where: { code: row.code, revision: row.revision },
      data: { nextDeadlineAt: table.nextAt === null ? null : new Date(table.nextAt), state: JSON.stringify(table), revision: { increment: 1 }, expiresAt: new Date(Date.now() + ROOM_TTL) },
    });
    if (!updated.count) return false;
    if (table.status === "finished" && table.game) {
      const standings = liveStandings(table);
      const players = await tx.player.findMany({
        where: { id: { in: standings.map(seat => seat.id) } }, select: { id: true, rating: true },
      });
      const ratings = new Map(players.map(player => [player.id, player.rating]));
      await tx.session.createMany({ data: standings.map(seat => {
        const rating = ratings.get(seat.id);
        if (rating === undefined) throw new Error("Missing private-room participant.");
        return {
          playerId: seat.id, privateRoomId: row.instanceId, mode: "PRIVATE",
          hands: table.game!.handNo, seats: standings.length, finalStack: seat.stack, net: seat.net,
          place: seat.place, ratingBefore: rating, ratingAfter: rating, biggestPot: seat.biggestPot,
          potsWon: seat.potsWon, bestHand: seat.bestHand,
          bestSeenHand: seat.bestSeen?.name, bestSeenScore: seat.bestSeen?.score,
          bestWinningHand: seat.bestWinning?.name, bestWinningScore: seat.bestWinning?.score,
          exit: "Private table complete",
        };
      }) });
    }
    return true;
  });
}

async function currentRoom(code: string, client:DatabaseClient=db) {
  for (let i = 0; i < 4; i++) {
    const row = await client.liveRoom.findUnique({ where: { code } });
    if (!row || row.expiresAt.getTime() <= Date.now()) return null;
    const table = JSON.parse(row.state) as LiveTable;
    if (row.matchId && table.ranked && table.status === "playing") {
      const presence = await client.matchParticipant.findMany({where:{matchId:row.matchId},select:{seat:true,lastSeenAt:true}});
      table.ranked.lastSeen = [0,1].map(seat=>presence.find(player=>player.seat===seat)?.lastSeenAt.getTime()??0);
    }
    if (!advanceLiveTable(table, Date.now())) return { row, table };
    if (await commit(row, table,client)) return { row: { ...row, revision: row.revision + 1 }, table };
  }
  throw new Error("Concurrent room updates");
}

export async function readLiveRoom(code: string, playerId: string, client:DatabaseClient=db) {
  const room = await currentRoom(code,client);
  if (room?.table.ranked && !room.table.players.some((seat) => seat.id === playerId)) return null;
  // Expire/forfeit first: reconnecting after the absence threshold cannot claim a win by waking the host.
  if (room?.row.matchId && room.table.status === "playing") await client.matchParticipant.updateMany({
    where:{matchId:room.row.matchId,playerId,lastSeenAt:{lt:new Date(Date.now()-5_000)}},data:{lastSeenAt:new Date()},
  });
  return room && publicLiveTable(room.table, playerId, code, room.row.revision);
}

export async function commandLiveRoom(code: string, playerId: string, revision: number, command: LiveCommand, client:DatabaseClient=db) {
  const room = await currentRoom(code,client);
  if (!room) return { status: 404, error: "This room expired or does not exist." } as const;
  const { row, table } = room;
  if (table.ranked && !table.players.some((seat) => seat.id === playerId)) return { status: 404, error: "Room not found." } as const;
  const snapshot = () => publicLiveTable(table, playerId, code, row.revision);
  if (table.status === "finished" || table.status === "closed") return { status: 409, room: snapshot(), error: "This room is finished. Commands cannot change its result." } as const;
  if (row.revision !== revision) return { status: 409, room: snapshot(), error: "The table moved. Try again." } as const;
  const player = await client.player.findUnique({ where: { id: playerId, isSimulated: false, deletedAt:null } });
  if (!player) return { status: 401, error: "Claim an Elo profile first." } as const;

  const error = applyLiveCommand(table, player, command, Date.now());
  if (error) return { status: 422, room: snapshot(), error } as const;
  if (await commit(row, table,client)) return { status: 200, room: publicLiveTable(table, playerId, code, row.revision + 1) } as const;
  return { status: 409, room: await readLiveRoom(code, playerId,client), error: "The table moved. Try again." } as const;
}

/** Worker entry point deliberately does not mark any player as present. */
export async function processRoomDeadline(code:string){
  const client=db;
  const before=await client.liveRoom.findUnique({where:{code},select:{revision:true}});
  if(!before)return false;
  const room=await currentRoom(code,client);
  return Boolean(room&&room.row.revision!==before.revision);
}
