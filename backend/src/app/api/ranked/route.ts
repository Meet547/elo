import { NextRequest, NextResponse } from "next/server";
import { dbEnabled } from "@/lib/db";
import { updateRankedQueue, RankedEligibilityError } from "@/lib/ranked-queue";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import { sessionPlayer } from "@/lib/session";

const json = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  const player = await sessionPlayer(req);
  if (!player) return json({ error: "Claim an Elo profile first." }, 401);
  if (!dbEnabled) return json({ error: "Ranked play needs a database connection." }, 503);
  const limit = await rateLimit(req, "ranked", 60, 60_000, player);
  if (!limit.ok) return tooMany(limit.retryAfter);
  const command = (await req.json().catch(() => null))?.command;
  if (command !== "join" && command !== "poll" && command !== "cancel") return json({ error: "Invalid queue command." }, 400);
  try {
    const result = await updateRankedQueue(player, command);
    return result ? json(result) : json({ error: "Claim an Elo profile first." }, 401);
  } catch (error) {
    if (error instanceof RankedEligibilityError) return json({ error: error.message }, 403);
    console.error("[elo] ranked queue", error);
    return json({ error: "Could not reach the ranked queue. Try again in a moment." }, 503);
  }
}
