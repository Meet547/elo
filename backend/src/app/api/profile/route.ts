import { NextRequest, NextResponse } from "next/server";
import { db, dbEnabled } from "@/lib/db";
import { realPlayerRank } from "../../../lib/player-rank";
import { displayName } from "../../../lib/display-name";
import { Prisma } from "@prisma/client";
import { START_RATING } from "@/lib/rating";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import { clearSessionCookie, sessionPlayer, setSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

/** GET /api/profile — resume the player the session cookie belongs to. */
export async function GET(req: NextRequest) {
  if (!dbEnabled) {
    return NextResponse.json({ error: "demo mode", demo: true }, { status: 503, headers: NO_STORE });
  }

  const playerId = await sessionPlayer(req);
  if (!playerId) return NextResponse.json({ error: "no session" }, { status: 401, headers: NO_STORE });

  const player = await db.player.findUnique({ where: { id: playerId, isSimulated: false } });
  if (!player) {
    // the row is gone (reset ladder): the cookie is dead weight, drop it
    const res = NextResponse.json({ error: "not found" }, { status: 401, headers: NO_STORE });
    clearSessionCookie(res);
    return res;
  }
  return NextResponse.json({ player: { ...player, rank: await realPlayerRank(db, player), provenance: "REAL" } }, { headers: NO_STORE });
}

/** POST /api/profile { name } — claim a seat on the ladder. */
export async function POST(req: NextRequest) {
  if (!dbEnabled) {
    return NextResponse.json({ error: "demo mode", demo: true }, { status: 503, headers: NO_STORE });
  }

  // A repeated claim with an existing signed cookie resumes its owner.
  // This also protects callers other than the current frontend from accidental identity replacement.
  const existingId = await sessionPlayer(req);
  if (existingId) {
    const existing = await db.player.findUnique({ where: { id: existingId, isSimulated: false } });
    if (existing) return NextResponse.json({ player: { ...existing, rank: await realPlayerRank(db, existing), provenance: "REAL" } }, { headers: NO_STORE });
  }

  const limit = await rateLimit(req, "profile:create", 8, 10 * 60_000);
  if (!limit.ok) return tooMany(limit.retryAfter);

  let body: { name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400, headers: NO_STORE });
  }

  let normalized: ReturnType<typeof displayName>;
  try { normalized = displayName(body.name); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid table name." }, { status: 400, headers: NO_STORE }); }
  let player;
  try {
    player = await db.player.create({ data: { ...normalized, rating: START_RATING, peak: START_RATING } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "That table name is already taken." }, { status: 409, headers: NO_STORE });
    throw error;
  }

  const res = NextResponse.json({ player: { ...player, rank: await realPlayerRank(db, player), provenance: "REAL" } }, { headers: NO_STORE });
  await setSessionCookie(res, player.id);
  return res;
}

/** Explicit rename retains player identity and every history row. */
export async function PATCH(req: NextRequest) {
  const id = await sessionPlayer(req);
  if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers: NO_STORE });
  const limit = await rateLimit(req, "profile:rename", 5, 600_000, id);
  if (!limit.ok) return tooMany(limit.retryAfter);
  try {
    const normalized = displayName((await req.json())?.name);
    const player = await db.player.update({ where: { id }, data: normalized });
    return NextResponse.json({ player: { ...player, rank: await realPlayerRank(db, player), provenance: "REAL" } }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") return NextResponse.json({ error: "That table name is already taken." }, { status: 409, headers: NO_STORE });
      throw error;
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid table name." }, { status: 400, headers: NO_STORE });
  }
}
