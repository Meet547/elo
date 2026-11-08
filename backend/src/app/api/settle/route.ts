import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db, dbEnabled } from "@/lib/db";
import { applySession, ordinal, PROVISIONAL_SESSIONS, type RatingSnapshot } from "@/lib/rating";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import { sessionPlayer } from "@/lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

interface SettleBody {
  hands: number;
  finalStack: number;
  place: number; // 1 = first
  seats: number;
  biggestPot: number;
  bestHand?: string | null;
  exit?: string | null;
  potsWon?: number;
  opponentIds: string[];
  /** finishing places for opponentIds — must form a permutation with `place` */
  places?: number[];
  /** final stacks for opponentIds, if the table wants its wire entry exact */
  stacks?: number[];
}

const int = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.max(lo, Math.min(hi, n));
};

function snapshot(p: {
  rating: number;
  rd: number;
  volatility: number;
  rated: number;
}): RatingSnapshot {
  return { rating: p.rating, rd: p.rd, volatility: p.volatility, rated: p.rated };
}

/**
 * POST /api/settle — the official settlement.
 *
 * All six seats are rated from one snapshot, simultaneously, with Glicko-2.
 * The request can only describe the result — the maths, the server's copy of
 * every rating, and the exposure limiter are all out of the client's hands.
 * Opponent places must form a real permutation of the table; a malformed or
 * contradictory settlement is rejected instead of guessed at.
 */
export async function POST(req: NextRequest) {
  if (!dbEnabled) {
    return NextResponse.json({ error: "demo mode", demo: true }, { status: 503, headers: NO_STORE });
  }
  if (process.env.ELO_ENABLE_PRACTICE_RATINGS !== "1") {
    return NextResponse.json({ error: "House games are practice. Ranked queue matches count toward the ladder." }, { status: 403, headers: NO_STORE });
  }

  const limit = rateLimit(req, "settle", 20, 60_000);
  if (!limit.ok) return tooMany(limit.retryAfter);

  // the actor is whoever holds the signed session, never a body field
  const token = sessionPlayer(req);
  if (!token) return NextResponse.json({ error: "no session" }, { status: 401, headers: NO_STORE });

  let body: SettleBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400, headers: NO_STORE });
  }

  const seats = int(body.seats, 2, 6, 6);
  const hands = int(body.hands, 1, 500, 1);
  const finalStack = int(body.finalStack, 0, 1_000_000, 0);
  const place = int(body.place, 1, seats, seats);
  const biggestPot = int(body.biggestPot, 0, 10_000_000, 0);
  const potsWon = int(body.potsWon, 0, 10_000, 0);
  const bestHand = typeof body.bestHand === "string" ? body.bestHand.slice(0, 80) : null;
  const exit = typeof body.exit === "string" ? body.exit.slice(0, 160) : null;

  const opponentIds = Array.isArray(body.opponentIds)
    ? [...new Set(body.opponentIds.filter((x): x is string => typeof x === "string"))].slice(0, 5)
    : [];
  if (opponentIds.length !== seats - 1 || opponentIds.includes(token)) {
    return NextResponse.json({ error: "bad table" }, { status: 400, headers: NO_STORE });
  }

  const me = await db.player.findUnique({ where: { id: token } });
  if (!me) return NextResponse.json({ error: "unknown player" }, { status: 404, headers: NO_STORE });

  const rivals = await db.player.findMany({ where: { id: { in: opponentIds } } });
  if (rivals.length !== opponentIds.length || rivals.some((r) => !r.isRival || r.id === me.id)) {
    return NextResponse.json({ error: "bad table" }, { status: 400, headers: NO_STORE });
  }

  // places: the five rival places plus mine must be exactly 1..seats
  const placesIn = Array.isArray(body.places) ? body.places : [];
  const places = opponentIds.map((_, i) => Math.round(Number(placesIn[i])));
  const all = [place, ...places];
  const validPlaces =
    places.length === seats - 1 &&
    places.every((p) => Number.isFinite(p) && p >= 1 && p <= seats) &&
    new Set(all).size === seats &&
    all.every((p) => p >= 1 && p <= seats);
  if (!validPlaces) {
    return NextResponse.json(
      { error: "places must be a permutation of 1..seats" },
      { status: 400, headers: NO_STORE },
    );
  }

  // The chips are the physical evidence: six stacks must still add up to the
  // six buy-ins, and the reported finish must match where those chips ended
  // up. This is what stops a client claiming first place with a short stack.
  const stacksIn = Array.isArray(body.stacks) ? body.stacks : [];
  const stacks = opponentIds.map((_, i) => Math.round(Number(stacksIn[i])));
  const stacksOk =
    stacks.length === seats - 1 &&
    stacks.every((s) => Number.isFinite(s) && s >= 0 && s <= 1_000_000) &&
    Math.abs(stacks.reduce((a, b) => a + b, 0) + finalStack - 1500 * seats) <= seats;
  if (!stacksOk) {
    return NextResponse.json(
      { error: "stacks must reconcile to the buy-ins" },
      { status: 400, headers: NO_STORE },
    );
  }

  const allStacks = [finalStack, ...stacks];
  const above = allStacks.filter((s) => s > finalStack).length; // seats strictly ahead
  const level = allStacks.filter((s) => s === finalStack).length; // seats sharing the stack
  if (place < above + 1 || place > above + level) {
    return NextResponse.json(
      { error: "finish does not match the final stacks" },
      { status: 400, headers: NO_STORE },
    );
  }

  const byId = new Map(rivals.map((r) => [r.id, r]));
  const field = opponentIds.map((id, i) => {
    const r = byId.get(id)!;
    return {
      id,
      name: r.name,
      rating: r.rating,
      rd: r.rd,
      volatility: r.volatility,
      rated: r.rated,
      place: places[i],
      finalStack: stacksOk ? stacks[i] : 1500,
    };
  });

  const ratingBefore = me.rating;
  const rankBefore = (await db.player.count({ where: { rating: { gt: ratingBefore } } })) + 1;

  const mine = applySession(
    snapshot(me),
    field.map((f) => ({ rating: f.rating, rd: f.rd, place: f.place })),
    place,
  );
  const ratingAfter = mine.rating;
  const delta = ratingAfter - ratingBefore;
  const peak = Math.max(me.peak, ratingAfter);
  const rankAfter =
    (await db.player.count({ where: { rating: { gt: ratingAfter }, id: { not: me.id } } })) + 1;

  // every rival is rated from the same pre-session snapshot — nobody's result
  // is computed from a table half-updated by an earlier loop iteration
  const rivalResults = field.map((f) => {
    const theirField = [
      { rating: ratingBefore, rd: me.rd, place },
      ...field
        .filter((x) => x.id !== f.id)
        .map((x) => ({ rating: x.rating, rd: x.rd, place: x.place })),
    ];
    const next = applySession(
      { rating: f.rating, rd: f.rd, volatility: f.volatility, rated: f.rated },
      theirField,
      f.place,
    );
    return { ...f, next };
  });

  const streak = delta > 0 ? Math.max(0, me.streak) + 1 : delta < 0 ? Math.min(0, me.streak) - 1 : me.streak;
  const net = finalStack - 1500;

  const writes: Prisma.PrismaPromise<unknown>[] = [
    db.player.update({
      where: { id: me.id },
      data: {
        rating: ratingAfter,
        rd: mine.rd,
        volatility: mine.volatility,
        rated: { increment: 1 },
        peak,
        hands: { increment: hands },
        cashes: { increment: place === 1 ? 1 : 0 },
        netChips: { increment: net },
        biggestPot: Math.max(me.biggestPot, biggestPot),
        streak,
        lastSeen: new Date(),
      },
    }),
    db.session.create({
      data: {
        playerId: me.id,
        hands,
        finalStack,
        net,
        place,
        seats,
        ratingBefore,
        ratingAfter,
        biggestPot,
        potsWon,
        bestHand,
        exit,
      },
    }),
  ];

  for (const r of rivalResults) {
    const rivalNet = stacksOk ? r.finalStack - 1500 : Math.max(-1500, Math.round((seats - r.place) * 60));
    writes.push(
      db.player.update({
        where: { id: r.id },
        data: {
          rating: r.next.rating,
          rd: r.next.rd,
          volatility: r.next.volatility,
          rated: { increment: 1 },
          peak: Math.max(r.rating, r.next.rating),
          hands: { increment: hands },
          cashes: { increment: r.place === 1 ? 1 : 0 },
          netChips: { increment: rivalNet },
          lastSeen: new Date(),
        },
      }),
      db.session.create({
        data: {
          playerId: r.id,
          hands,
          finalStack: stacksOk ? r.finalStack : 1500,
          net: stacksOk ? rivalNet : 0,
          place: r.place,
          seats,
          ratingBefore: r.rating,
          ratingAfter: r.next.rating,
          biggestPot: 0,
          potsWon: 0,
        },
      }),
    );
  }

  await db.$transaction(writes);

  return NextResponse.json({
    ratingBefore,
    ratingAfter,
    delta,
    peak,
    rankBefore,
    rankAfter,
    rankLabel: ordinal(rankAfter),
    rd: mine.rd,
    rated: mine.rated,
    provisional: mine.rated < PROVISIONAL_SESSIONS,
    expected: Number(mine.expected.toFixed(3)),
    fieldAvg: Math.round(field.reduce((a, f) => a + f.rating, 0) / Math.max(1, field.length)),
    field: rivalResults.map((r) => ({
      id: r.id,
      name: r.name,
      place: r.place,
      ratingBefore: r.rating,
      ratingAfter: r.next.rating,
      delta: r.next.rating - r.rating,
    })),
  }, { headers: NO_STORE });
}
