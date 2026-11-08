import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "./db";
import { roomRecord } from "./live-rooms";
import { createActiveRankedMatch } from "./match-state";
import { newRankedTable } from "@/lib/poker/live-table";
import { chooseRankedOpponent, rankedRange, RANKED_MAX_RANGE, RANKED_PRESENCE_MS, type RankedQueueStatus } from "@/lib/poker/ranked-match";

export type QueueCommand = "join" | "poll" | "cancel";

export async function updateRankedQueue(playerId: string, command: QueueCommand): Promise<RankedQueueStatus | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const now = new Date();
        const cutoff = new Date(now.getTime() - RANKED_PRESENCE_MS);

        // Serializable isolation protects candidate selection and both assignments.
        await tx.rankedSeat.deleteMany({ where: { roomCode: null, seenAt: { lt: cutoff } } });
        const player = await tx.player.findUnique({
          where: { id: playerId, isSimulated: false },
          select: { id: true, name: true, rating: true, rd: true, volatility: true, rated: true },
        });
        if (!player) return null;

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
        if (!seat && command !== "join") return { status: "idle", rating: player.rating };

        const waiting = await tx.rankedSeat.upsert({
          where: { playerId },
          update: { seenAt: now, rating: player.rating },
          create: { playerId, seenAt: now, joinedAt: now, rating: player.rating },
        });
        const pool = await tx.rankedSeat.findMany({
          where: {
            playerId: { not: playerId },
            roomCode: null,
            rating: { gte: player.rating - RANKED_MAX_RANGE, lte: player.rating + RANKED_MAX_RANGE },
          },
        });
        const candidate = chooseRankedOpponent(waiting, pool, now.getTime());
        if (candidate) {
          const opponent = await tx.player.findUnique({
            where: { id: candidate.playerId, isSimulated: false },
            select: { id: true, name: true, rating: true, rd: true, volatility: true, rated: true },
          });
          if (opponent && chooseRankedOpponent(waiting, [{ ...candidate, rating: opponent.rating }], now.getTime())) {
            const matchId = await createActiveRankedMatch(tx, [player, opponent], now);
            const table = newRankedTable(player, opponent, now.getTime());
            table.ranked!.matchId = matchId;
            const room = await tx.liveRoom.create({ data: roomRecord(table, matchId) });
            await tx.rankedSeat.update({ where: { playerId }, data: { roomCode: room.code } });
            await tx.rankedSeat.update({ where: { playerId: opponent.id }, data: { roomCode: room.code, rating: opponent.rating } });
            return { status: "matched", code: room.code, rating: player.rating };
          }
        }
        return {
          status: "searching", rating: player.rating, joinedAt: waiting.joinedAt.getTime(),
          range: rankedRange(waiting.joinedAt.getTime(), now.getTime()),
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (attempt >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        !["P1008", "P2002", "P2028", "P2034"].includes(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
}
