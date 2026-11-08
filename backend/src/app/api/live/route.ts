import { NextRequest, NextResponse } from "next/server";
import { dbEnabled } from "@/lib/db";
import { createLiveRoom } from "@/lib/live-rooms";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import { sessionPlayer } from "@/lib/session";

export async function POST(req: NextRequest) {
  const player = await sessionPlayer(req);
  if (!player) return NextResponse.json({ error: "Claim an Elo profile first." }, { status: 401 });
  if (!dbEnabled) return NextResponse.json({ error: "Live rooms need a database connection." }, { status: 503 });
  const limit = rateLimit(req, `live:create:${player}`, 8, 60_000);
  if (!limit.ok) return tooMany(limit.retryAfter);
  const room = await createLiveRoom(player);
  if (!room) return NextResponse.json({ error: "Claim an Elo profile first." }, { status: 401 });
  return NextResponse.json({ room }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
