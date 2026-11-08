import { NextResponse } from "next/server";
import { db, dbEnabled } from "@/lib/db";

// Liveness + database reachability for the load balancer. It answers with the
// smallest possible body so a probe cannot be used to enumerate the ladder.
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET() {
  if (!dbEnabled) {
    return NextResponse.json({ ok: false, mode: "unavailable" }, { status: 503, headers: NO_STORE });
  }

  try {
    await db.liveRoom.findFirst({ select: { code: true } });
    await db.rankedSeat.findFirst({ select: { playerId: true } });
    return NextResponse.json({ ok: true, mode: "sqlite" }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });
  }
}
