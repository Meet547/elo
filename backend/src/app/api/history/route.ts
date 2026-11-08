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

  const limit = rateLimit(req, "history", 60, 60_000);
  if (!limit.ok) return tooMany(limit.retryAfter);

  const playerId = sessionPlayer(req);
  if (!playerId) return NextResponse.json({ error: "no session" }, { status: 401, headers: NO_STORE });

  const sessions = await db.session.findMany({
    where: { playerId },
    orderBy: { createdAt: "desc" },
    take: 60,
  });

  return NextResponse.json({ sessions }, { headers: NO_STORE });
}
