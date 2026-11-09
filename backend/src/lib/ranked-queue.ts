import "server-only";

import { currentDeviation, PROVISIONAL_SESSIONS } from "@/lib/rating";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import {inTransaction,ownsTransaction,type DatabaseClient} from "./unit-of-work";
import { roomRecord, commandLiveRoom } from "./live-rooms";
import { createProposedRankedMatch } from "./match-state";
import { newProposedRankedTable } from "@/lib/poker/live-table";
import { chooseRankedOpponent, rankedRange, sharesRankedNetwork, RANKED_MAX_RANGE, RANKED_PRESENCE_MS, RANKED_SEARCH_MS, RANKED_REMATCH_MS, RANKED_PROPOSAL_COOLDOWN_MS, type RankedQueueStatus } from "@/lib/poker/ranked-match";

export class RankedEligibilityError extends Error {}

export function rankedNetworkTag(address: string, now = Date.now()): string | undefined {
  const secret = process.env.SESSION_SECRET;
  if (!isIP(address) || !secret) return;
  return createHmac("sha256", secret).update(`ranked-network:${Math.floor(now / 86_400_000)}:${address}`).digest("hex");
}

export async function readRankedQueue(playerId: string): Promise<RankedQueueStatus | null> {
  const seat = await db.rankedSeat.findUnique({ where: { playerId } });
  if (!seat) {
    const player = await db.player.findUnique({
      where: { id: playerId, deletedAt: null, isSimulated: false }, select: { rating: true },
    });
    return player ? { status: "idle", rating: player.rating } : null;
  }
  if (seat.roomCode) return { status: "matched", code: seat.roomCode, rating: seat.rating };
  const joinedAt = seat.joinedAt.getTime();
  const now = Date.now();
  if (now - joinedAt >= RANKED_SEARCH_MS) return { status: "expired", rating: seat.rating };
  return { status: "searching", rating: seat.rating, joinedAt, range: rankedRange(joinedAt, now, seat.rd) };
}

export type QueueCommand = "join" | "poll" | "cancel";

export async function updateRankedQueue(playerId: string, command: QueueCommand, client:DatabaseClient=db, networkTag?: string): Promise<RankedQueueStatus | null> {
  // Cancel a proposal through the same revision-checked ready command as the room UI.
  if (command === "cancel") {
    const assigned = await client.rankedSeat.findUnique({where:{playerId}});
    const row = assigned?.roomCode ? await client.liveRoom.findUnique({where:{code:assigned.roomCode}}) : null;
    if (row) {
      const table = JSON.parse(row.state);
      if (table.status === "waiting" && table.ranked?.proposal) {
        const result = await commandLiveRoom(row.code,playerId,row.revision,{type:"ready",accept:false},client);
        if (result.status === 200) return {status:"idle",rating:assigned!.rating};
      }
    }
  }
  for (let attempt = 0; ; attempt++) {
    try {
      return await inTransaction(client,async (tx) => {
        const now = new Date();
        const cutoff = new Date(now.getTime() - RANKED_PRESENCE_MS);

        // Serializable isolation protects candidate selection and both assignments.
        await tx.rankedSeat.deleteMany({ where: { roomCode: null, seenAt: { lt: cutoff } } });
        const player = await tx.player.findUnique({
          where: { id: playerId, isSimulated: false, deletedAt: null },
          select: { id: true, name: true, rating: true, rd: true, volatility: true, ratedAt: true, createdAt: true, rated: true, rankedPlacements: true, nameKey: true, identities: { select: { provider: true } } },
        });
        if (!player) return null;
        player.rd = currentDeviation(player, now.getTime());
        if (command !== "cancel") {
          if (!player.identities.length) throw new RankedEligibilityError("Connect a verified account before joining ranked.");
          if (!player.nameKey) throw new RankedEligibilityError("Choose an available unique table name in your profile first.");
        }
        const poolName = player.rankedPlacements < PROVISIONAL_SESSIONS ? "PLACEMENT" : "ESTABLISHED";

        let seat = await tx.rankedSeat.findUnique({ where: { playerId } });
        if (seat?.roomCode) {
          const room = await tx.liveRoom.findUnique({ where: { code: seat.roomCode }, select: { expiresAt: true } });
          if (room && room.expiresAt > now) return { status: "matched", code: seat.roomCode, rating: seat.rating };
          await tx.rankedSeat.delete({ where: { playerId } });
          seat = null;
        }

        if (command === "cancel") {
          if (seat) await tx.rankedSeat.delete({ where: { playerId } });
          return { status: "idle", rating: player.rating };
        }
        if (seat && now.getTime() - seat.joinedAt.getTime() >= RANKED_SEARCH_MS) {
          await tx.rankedSeat.delete({ where: { playerId } });
          seat = null;
          if (command !== "join") return { status: "expired", rating: player.rating };
        }
        if (!seat && command !== "join") return { status: "idle", rating: player.rating };

        const waiting = await tx.rankedSeat.upsert({
          where: { playerId },
          update: { seenAt: now, rating: player.rating, rd: player.rd, pool: poolName, ...(networkTag ? { networkTag } : {}) },
          create: { playerId, seenAt: now, joinedAt: now, rating: player.rating, rd: player.rd, pool: poolName, networkTag },
        });
        const pool = await tx.rankedSeat.findMany({
          where: {
            playerId: { not: playerId },
            roomCode: null,
            pool: poolName,
            rating: { gte: player.rating - RANKED_MAX_RANGE, lte: player.rating + RANKED_MAX_RANGE },
          },
        });
        const opponents = await tx.player.findMany({
          where: {
            id: { in: pool.map(seat => seat.playerId) },
            isSimulated: false, deletedAt: null, nameKey: { not: null },
            identities: { some: {} },
            rankedPlacements: poolName === "PLACEMENT" ? { lt: PROVISIONAL_SESSIONS } : { gte: PROVISIONAL_SESSIONS },
          },
          select: { id: true, name: true, rating: true, rd: true, volatility: true, ratedAt: true, createdAt: true, rated: true },
        });
        const byId = new Map(opponents.map(opponent => [opponent.id, { ...opponent, rd: currentDeviation(opponent, now.getTime()) }]));
        const eligible = pool.flatMap(seat => {
          const opponent = byId.get(seat.playerId);
          return opponent ? [{ ...seat, rating: opponent.rating, rd: opponent.rd }] : [];
        });
        const recentPairs = eligible.length ? await tx.matchParticipant.findMany({
          where: {
            playerId: { in: eligible.map(seat => seat.playerId) },
            match: {
              participants: { some: { playerId } },
              OR: [
                { startedAt: { not: null }, finishedAt: { gte: new Date(now.getTime() - RANKED_REMATCH_MS) } },
                { createdAt: { gte: new Date(now.getTime() - RANKED_PROPOSAL_COOLDOWN_MS) } },
              ],
            },
          },
          select: { playerId: true },
        }) : [];
        const candidate = chooseRankedOpponent(waiting, eligible, now.getTime(), new Set(recentPairs.map(pair => pair.playerId)));
        if (candidate) {
          const opponent = byId.get(candidate.playerId)!;
          const matchId = await createProposedRankedMatch(tx, [player, opponent], now, sharesRankedNetwork(waiting, candidate));
          const table = newProposedRankedTable(player, opponent, now.getTime());
          table.ranked!.matchId = matchId;
          const room = await tx.liveRoom.create({ data: roomRecord(table, matchId) });
          await tx.rankedSeat.update({ where: { playerId }, data: { roomCode: room.code, networkTag: null } });
          await tx.rankedSeat.update({ where: { playerId: opponent.id }, data: { roomCode: room.code, rating: opponent.rating, rd: opponent.rd, networkTag: null } });
          return { status: "matched", code: room.code, rating: player.rating };
        }
        return {
          status: "searching", rating: player.rating, joinedAt: waiting.joinedAt.getTime(),
          range: rankedRange(waiting.joinedAt.getTime(), now.getTime(), waiting.rd),
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if(!ownsTransaction(client))throw error;
      if (attempt >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        !["P1008", "P2002", "P2028", "P2034"].includes(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
}
