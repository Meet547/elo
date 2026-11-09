import "server-only";
import { Prisma } from "@prisma/client";
import { allowsMatchTransition } from "@/lib/poker/match-state";
import { refreshFairEvidence, type LiveTable } from "@/lib/poker/live-table";
import { db } from "./db";
import { accountIdentity } from "./google-auth";
import { transitionMatch } from "./match-state";
import { ConcurrentGameWrite } from "./unit-of-work";

export async function reviewMatches() {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const matches = await db.match.findMany({
    where: { createdAt: { gte: since } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 500,
    select: {
      id: true, state: true, createdAt: true, startedAt: true, finishedAt: true, handNumber: true, sharedNetwork: true,
      participants: { select: { playerId: true, player: { select: { name: true } } } },
      history: { select: { playerId: true, place: true } },
      moderation: { select: { action: true, reason: true, createdAt: true } },
    },
  });
  type Pair = { matches: number; draws: number; wins: Record<string, number>; shared: number; fast: number };
  const pairs = new Map<string, Pair>();
  const pairKey = (match: typeof matches[number]) => match.participants.map(seat => seat.playerId).sort().join(":");
  for (const match of matches) {
    if (match.participants.length !== 2 || match.history.length !== 2 || match.moderation) continue;
    const key = pairKey(match);
    const pair = pairs.get(key) ?? { matches: 0, draws: 0, wins: {}, shared: 0, fast: 0 };
    pair.matches++;
    for (const result of match.history) {
      if (result.place === 1) pair.wins[result.playerId] = (pair.wins[result.playerId] ?? 0) + 1;
    }
    if (match.history.every(result => result.place === 0)) pair.draws++;
    if (match.sharedNetwork) pair.shared++;
    if (match.handNumber === 10 && match.startedAt && match.finishedAt &&
      match.finishedAt.getTime() - match.startedAt.getTime() < 30_000) pair.fast++;
    pairs.set(key, pair);
  }
  return matches.slice(0, 100).map(match => {
    const pair = pairs.get(pairKey(match));
    const flags = [];
    if (pair && pair.matches >= 3) flags.push("Repeated pair");
    if (pair && pair.matches >= 3 && Object.values(pair.wins).some(wins => wins / pair.matches >= .9)) flags.push("One-sided results");
    if (pair?.shared || match.sharedNetwork) flags.push("Shared network");
    if (pair?.fast) flags.push("Fast completion");
    return { ...match, pair: pair ?? null, flags };
  });
}

export async function moderateMatch(tx: Prisma.TransactionClient, actorId: string, matchId: string, reason: string) {
  if (!(await accountIdentity(actorId, tx)).administrator) return { status: 403, body: { error: "Administrator access required." } };
  const match = await tx.match.findUnique({ where: { id: matchId }, include: {
    moderation: { include: { adjustments: true } }, room: true, history: true, settlement: true,
  } });
  if (!match) return { status: 404, body: { error: "Match not found." } };
  if (match.moderation) return { status: 200, body: { moderation: match.moderation } };
  if (allowsMatchTransition(match.state, "VOID")) {
    if (!await transitionMatch(tx, matchId, match.state, "VOID", { finishedAt: new Date() })) throw new ConcurrentGameWrite();
    if (match.room) {
      const table = JSON.parse(match.room.state) as LiveTable;
      table.status = "closed";
      table.nextAt = null;
      if (table.ranked) table.ranked.outcome = { kind: "void", reason: "admin-void" };
      refreshFairEvidence(table);
      const updated = await tx.liveRoom.updateMany({ where: { code: match.room.code, revision: match.room.revision },
        data: { state: JSON.stringify(table), nextDeadlineAt: null, revision: { increment: 1 } },
      });
      if (!updated.count) throw new ConcurrentGameWrite();
      await tx.rankedSeat.deleteMany({ where: { roomCode: match.room.code } });
    }
    await tx.matchSettlement.create({ data: { matchId, algorithmVersion: "admin-void-v1", result: { ratingChanges: [] } } });
    const moderation = await tx.matchModeration.create({ data: { matchId, actorId, reason, action: "VOID" } });
    return { status: 200, body: { moderation } };
  }

  if (!["SETTLED", "FORFEIT"].includes(match.state) || !match.settlement || match.history.length !== 2) {
    return { status: 409, body: { error: "This match has no reversible rating result." } };
  }
  const ids = match.history.map(result => result.playerId).sort();
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Player" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
  if (await tx.rankedSeat.count({ where: { playerId: { in: ids } } })) {
    return { status: 409, body: { error: "Both players must leave the ranked queue before a rating reversal." } };
  }
  const players = await tx.player.findMany({ where: { id: { in: ids }, isSimulated: false } });
  if (players.length !== 2) return { status: 409, body: { error: "Original rating owners are unavailable." } };
  const changes = players.map(player => {
    const result = match.history.find(row => row.playerId === player.id)!;
    const delta = result.ratingBefore - result.ratingAfter;
    return { player, result, delta, after: player.rating + delta };
  });
  if (changes.some(change => change.after < 400 || change.after > 4000)) {
    return { status: 409, body: { error: "Exact reversal would move a rating outside the supported range." } };
  }
  const moderation = await tx.matchModeration.create({ data: { matchId, actorId, reason, action: "REVERSE",
    adjustments: { create: changes.map(({ player, after, delta }) => ({ playerId: player.id, before: player.rating, after, delta })) },
  }, include: { adjustments: true } });
  for (const { player, result, after } of changes) {
    await tx.player.update({ where: { id: player.id }, data: {
      rating: after, rated: Math.max(0, player.rated - 1), rankedPlacements: Math.max(0, player.rankedPlacements - 1),
      hands: Math.max(0, player.hands - result.hands), cashes: Math.max(0, player.cashes - Number(result.place === 1)),
      netChips: player.netChips - result.net,
    } });
  }
  return { status: 200, body: { moderation } };
}
