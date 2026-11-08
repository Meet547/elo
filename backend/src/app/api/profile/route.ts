import { NextRequest, NextResponse } from "next/server";
import { db, dbEnabled } from "@/lib/db";
import { realPlayerRank } from "../../../lib/player-rank";
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

  const limit = rateLimit(req, "profile:create", 8, 10 * 60_000);
  if (!limit.ok) return tooMany(limit.retryAfter);

  let body: { name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400, headers: NO_STORE });
  }

  // one line, no control characters, no leading/trailing space
  const raw = typeof body.name === "string" ? body.name : "";
  const printable = Array.from(raw)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("");
  const name = printable.replace(/\s+/g, " ").trim().slice(0, 18);
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400, headers: NO_STORE });

  const player = await db.player.create({
    data: { name, rating: START_RATING, peak: START_RATING },
  });

  const res = NextResponse.json({ player: { ...player, rank: await realPlayerRank(db, player), provenance: "REAL" } }, { headers: NO_STORE });
  await setSessionCookie(res, player.id);
  return res;
}
