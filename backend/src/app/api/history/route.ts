import { NextRequest, NextResponse } from "next/server";
import { db, dbEnabled } from "@/lib/db";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import { sessionPlayer } from "@/lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

/** GET /api/history — the signed-in player's ledger, newest first. */
export async function GET(req: NextRequest) {
  if (!dbEnabled) {
    return NextResponse.json({ error: "demo mode", demo: true }, { status: 503, headers: NO_STORE });
  }

  const limit = await rateLimit(req, "history", 60, 60_000);
  if (!limit.ok) return tooMany(limit.retryAfter);

  const playerId = await sessionPlayer(req);
  if (!playerId) return NextResponse.json({ error: "no session" }, { status: 401, headers: NO_STORE });

  const [sessions, groups, adjustments] = await db.$transaction(async tx => {
    const rows = await tx.session.findMany({ where: { playerId }, include: { match: { select: { moderation: { select: { action: true } } } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 60 });
    const totals = await tx.session.groupBy({
      by: ["place"], orderBy: { place: "asc" }, where: { playerId, OR: [{ matchId: null }, { match: { moderation: null } }] },
      _count: { _all: true },
      _sum: { hands: true, potsWon: true, net: true },
      _max: { biggestPot: true, net: true },
      _min: { net: true },
    });
    const corrections = await tx.ratingAdjustment.findMany({
      where: { playerId }, orderBy: [{ moderation: { createdAt: "desc" } }, { matchId: "desc" }], take: 60,
      select: { matchId: true, before: true, after: true, moderation: { select: { createdAt: true } } },
    });
    return [rows, totals, corrections] as const;
  }, { isolationLevel: "RepeatableRead" });

  const statistics = {
    sessions: groups.reduce((total, group) => total + group._count._all, 0),
    hands: groups.reduce((total, group) => total + (group._sum.hands ?? 0), 0),
    firsts: groups.find(group => group.place === 1)?._count._all ?? 0,
    potsWon: groups.reduce((total, group) => total + (group._sum.potsWon ?? 0), 0),
    net: groups.reduce((total, group) => total + (group._sum.net ?? 0), 0),
    biggestPot: Math.max(0, ...groups.map(group => group._max.biggestPot ?? 0)),
    bestNet: groups.length ? Math.max(...groups.map(group => group._max.net!)) : null,
    worstNet: groups.length ? Math.min(...groups.map(group => group._min.net!)) : null,
    finishes: groups.map(group => ({ place: group.place, count: group._count._all })).sort((a, b) => a.place - b.place),
  };
  const ratingHistory = [
    ...sessions.filter(session => session.mode === "RANKED" || session.mode === "LEGACY").map(session => ({
      id: session.id, before: session.ratingBefore, after: session.ratingAfter, at: session.createdAt, label: "result",
    })),
    ...adjustments.map(adjustment => ({
      id: adjustment.matchId, before: adjustment.before, after: adjustment.after, at: adjustment.moderation.createdAt, label: "reversal",
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id)).slice(0, 60).reverse();
  return NextResponse.json({ sessions, statistics, ratingHistory, ownerId: playerId }, { headers: NO_STORE });
}
