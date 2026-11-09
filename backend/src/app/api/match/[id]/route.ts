import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessionPlayer } from "@/lib/session";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import type { LiveTable, PublicFairHand } from "@/lib/poker/live-table";
import type { GameState } from "@/lib/poker/engine";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
const missing = () => NextResponse.json({ error: "Match record not found." }, { status: 404, headers });
const resultFields = { place: true, hands: true, net: true, ratingBefore: true, ratingAfter: true } as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actorId = await sessionPlayer(request);
  if (!actorId) return NextResponse.json({ error: "Sign in to view your match record." }, { status: 401, headers });
  const limit = await rateLimit(request, `match:read:${actorId}`, 60, 60_000);
  if (!limit.ok) return tooMany(limit.retryAfter);
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return missing();

  const match = await db.match.findFirst({
    where: { id, participants: { some: { playerId: actorId } } },
    select: {
      state: true, room: { select: { instanceId: true } },
      history: { select: { ...resultFields, player: { select: { name: true } } } },
      moderation: { select: { action: true } },
    },
  });
  let instanceId = match?.room?.instanceId ?? null;
  let title = match ? "Ranked match" : "Session record";
  let state: string | undefined = match?.moderation?.action === "REVERSE" ? "Reversed" : match?.state;
  let results = match?.history ?? [];
  if (!match) {
    const ownSession = await db.session.findFirst({ where: { id, playerId: actorId }, select: {
      ...resultFields, mode: true, privateRoomId: true, player: { select: { name: true } },
    } });
    if (ownSession) {
      instanceId = ownSession.privateRoomId;
      title = ownSession.mode === "PRIVATE" ? "Private table" : "Session record";
      const { mode: _mode, privateRoomId: _room, ...summary } = ownSession;
      results = [summary];
    } else {
      const hand = /^[a-f0-9]{64}$/.test(id)
        ? await db.fairHand.findUnique({ where: { handId: id }, select: { roomInstanceId: true } })
        : null;
      if (!hand?.roomInstanceId) return missing();
      instanceId = hand.roomInstanceId;
      const room = await db.liveRoom.findUnique({ where: { instanceId }, select: { state: true, matchId: true } });
      const member = room && (JSON.parse(room.state) as LiveTable).players.some(player => player.id === actorId);
      if (!member && !await db.session.count({ where: { playerId: actorId, privateRoomId: instanceId } })) return missing();
      title = room?.matchId ? "Ranked hand history" : "Private hand history";
      state = room ? (JSON.parse(room.state) as LiveTable).status : undefined;
    }
  }
  const records = instanceId ? await db.fairHand.findMany({
    where: { roomInstanceId: instanceId, completedAt: { not: null } },
    orderBy: { handNo: "desc" }, take: 30,
    select: { handId: true, handNo: true, auditData: true, publicData: true },
  }) : [];
  const hands = records.map(record => {
    const game = (record.auditData as unknown as { game: GameState }).game;
    const publicHand = record.publicData as unknown as PublicFairHand;
    const log = game.log.slice(Math.max(0, game.log.findLastIndex(entry => entry.kind === "hand")));
    return {
      id: record.handId, number: record.handNo, pot: game.awards?.reduce((sum, award) => sum + award.amount, 0) ?? 0,
      actions: log.filter(entry => ["action", "blind", "street", "result"].includes(entry.kind)).map(entry => entry.text),
      cards: publicHand.cards.map(proof => proof.card),
    };
  });
  return NextResponse.json({ title, state, results, hands }, { headers });
}
