import { NextRequest, NextResponse } from "next/server";
import { db, dbEnabled } from "@/lib/db";
import { ROSTER } from "@/lib/poker/ai";
import { applySession, PROVISIONAL_SESSIONS } from "@/lib/rating";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import { sessionPlayer } from "@/lib/session";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// The ladder breathes: rivals play sessions of their own while you are away.
//
// Their results come from a random-utility model — every seat at their table
// gets a Gumbel draw the size of a bad beat, the six scores are sorted, and
// that order is the finish. It is the same shape as a real six-max: the best
// rating cashes most often, nobody is ever safe. The hero's rating then moves
// through the same Glicko-2 update the human's does, so the ladder is one
// system, not two.
// ---------------------------------------------------------------------------

async function ensureSeeded() {
  const count = await db.player.count({ where: { isRival: true } });
  if (count >= ROSTER.length) return;
  const now = Date.now();
  await db.player.createMany({
    data: ROSTER.map((b, i) => {
      // regulars arrive with a history behind them: low deviation, high count
      const rated = 40 + ((i * 13) % 260);
      return {
        id: `rival_${b.slug}`,
        name: b.name,
        rating: b.rating,
        rd: Math.round(Math.max(58, 118 - rated * 0.18)),
        volatility: Number((0.05 + ((i * 7) % 9) / 400).toFixed(4)),
        rated,
        peak: b.rating + 40 + ((i * 17) % 90),
        hands: b.hands,
        cashes: b.cashes,
        netChips: Math.round(b.hands * (3.1 + ((i * 7) % 11) / 3)),
        biggestPot: 1400 + ((i * 331) % 5200),
        streak: (i % 5) - 2,
        isRival: true,
        lastSeen: new Date(now - ((i * 83) % 1440) * 60_000),
      };
    }),
  });
}

/** Gumbel(0, 1) — the noise behind a random-utility finish. */
function gumbel(): number {
  const u = Math.max(1e-9, Math.random());
  return -Math.log(-Math.log(u));
}

async function driftRivals() {
  const last = await db.session.findFirst({
    where: { player: { isRival: true } },
    orderBy: { createdAt: "desc" },
  });
  if (last && Date.now() - last.createdAt.getTime() < 45_000) return;

  const rivals = await db.player.findMany({
    where: { isRival: true },
    orderBy: { lastSeen: "asc" },
    take: 8,
  });
  if (rivals.length < 6) return;
  const waves = 1 + (Math.random() < 0.35 ? 1 : 0);

  for (let w = 0; w < waves; w++) {
    const hero = rivals[Math.floor(Math.random() * rivals.length)];
    const field = (
      await db.player.findMany({
        where: { isRival: true, id: { not: hero.id } },
        take: 40,
      })
    )
      .sort(
        (a, b) =>
          Math.abs(a.rating - hero.rating) - Math.abs(b.rating - hero.rating) ||
          Math.abs(a.lastSeen.getTime() - Date.now()) - Math.abs(b.lastSeen.getTime() - Date.now()),
      )
      .slice(0, 12)
      .sort(() => Math.random() - 0.5)
      .slice(0, 5);
    if (field.length < 5) return;

    // the finish: utility = rating + a bad-beat-sized shock, sorted
    const seats = [hero, ...field].map((p) => ({ p, u: p.rating + gumbel() * 150 }));
    seats.sort((a, b) => b.u - a.u);
    const heroPlace = seats.findIndex((s) => s.p.id === hero.id) + 1;
    const others = seats
      .filter((s) => s.p.id !== hero.id)
      .map((s) => ({ rating: s.p.rating, rd: s.p.rd, place: seats.indexOf(s) + 1 }));

    const next = applySession(
      { rating: hero.rating, rd: hero.rd, volatility: hero.volatility, rated: hero.rated },
      others,
      heroPlace,
    );
    const hands = 18 + Math.floor(Math.random() * 40);
    const finalStack = [9000, 4200, 2700, 1650, 700, 0][heroPlace - 1] ?? 0;

    await db.player.update({
      where: { id: hero.id },
      data: {
        rating: next.rating,
        rd: next.rd,
        volatility: next.volatility,
        rated: { increment: 1 },
        peak: Math.max(hero.peak, next.rating),
        hands: { increment: hands },
        cashes: { increment: heroPlace === 1 ? 1 : 0 },
        netChips: { increment: finalStack - 1500 },
        lastSeen: new Date(),
      },
    });
    await db.session.create({
      data: {
        playerId: hero.id,
        hands,
        finalStack,
        net: finalStack - 1500,
        place: heroPlace,
        ratingBefore: hero.rating,
        ratingAfter: next.rating,
        biggestPot: 600 + Math.floor(Math.random() * 3400),
      },
    });
  }
}

/** GET /api/leaderboard — the ladder, plus the recent wire. */
export async function GET(req: NextRequest) {
  if (!dbEnabled) {
    return NextResponse.json({ error: "demo mode", demo: true }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  const limit = rateLimit(req, "leaderboard", 90, 60_000);
  if (!limit.ok) return tooMany(limit.retryAfter);

  await ensureSeeded();
  await driftRivals();

  // "me" is whoever the signed cookie says it is; a query token is ignored
  const token = sessionPlayer(req);

  const players = await db.player.findMany({
    orderBy: [{ rating: "desc" }, { hands: "desc" }],
    take: 60,
  });

  const me = token ? (players.find((p) => p.id === token) ?? null) : null;
  const rankOf = (id: string) => players.findIndex((p) => p.id === id) + 1;

  const wire = await db.session.findMany({
    orderBy: { createdAt: "desc" },
    take: 14,
    include: { player: { select: { name: true, rating: true, isRival: true } } },
  });

  return NextResponse.json({
    ladder: players.map((p) => ({
      id: p.id,
      name: p.name,
      rating: p.rating,
      rd: Math.round(p.rd),
      rated: p.rated,
      peak: p.peak,
      hands: p.hands,
      cashes: p.cashes,
      streak: p.streak,
      isMe: p.id === token,
      rank: rankOf(p.id),
    })),
    me: me
      ? {
          ...me,
          rd: Math.round(me.rd),
          rank: rankOf(me.id),
          provisional: me.rated < PROVISIONAL_SESSIONS,
        }
      : null,
    wire: wire.map((s) => ({
      id: s.id,
      name: s.player.name,
      place: s.place,
      hands: s.hands,
      net: s.net,
      seats: s.seats,
      ratingBefore: s.ratingBefore,
      ratingAfter: s.ratingAfter,
      at: s.createdAt,
    })),
  }, { headers: { "cache-control": "no-store" } });
}
