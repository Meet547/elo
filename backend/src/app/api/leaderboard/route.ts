import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { PROVISIONAL_SESSIONS } from '@/lib/rating';
import { rateLimit, tooMany } from '@/lib/rate-limit';
import { sessionPlayer } from '@/lib/session';
import { realPlayerRank } from '../../../lib/player-rank';
export const dynamic = 'force-dynamic';

/** Real ladder reads never seed players, simulate games or mutate ratings. */
export async function GET(req: NextRequest) {
  const limit = rateLimit(req, 'leaderboard', 90, 60_000);
  if (!limit.ok) return tooMany(limit.retryAfter);
  const playerId = await sessionPlayer(req);
  const [players, me, wire] = await Promise.all([
    db.player.findMany({ where: { isSimulated: false }, orderBy: [{ rating: 'desc' }, { hands: 'desc' }, { id: 'asc' }], take: 60 }),
    playerId ? db.player.findUnique({ where: { id: playerId, isSimulated: false } }) : null,
    db.session.findMany({ where: { mode: 'RANKED', player: { isSimulated: false } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 14,
      include: { player: { select: { name: true } } } }),
  ]);
  const rank = me ? await realPlayerRank(db, me) : null;
  return NextResponse.json({
    ladder: players.map((player, index) => ({
      id: player.id, name: player.name, rating: player.rating, rd: Math.round(player.rd), rated: player.rated,
      peak: player.peak, hands: player.hands, cashes: player.cashes, streak: player.streak,
      isMe: player.id === playerId, rank: index + 1, isSimulated: false, provenance: 'REAL',
    })),
    me: me ? { ...me, rd: Math.round(me.rd), rank, provenance: 'REAL', provisional: me.rated < PROVISIONAL_SESSIONS } : null,
    wire: wire.map(session => ({
      id: session.id, name: session.player.name, place: session.place, hands: session.hands,
      net: session.net, seats: session.seats, ratingBefore: session.ratingBefore, ratingAfter: session.ratingAfter,
      at: session.createdAt, mode: session.mode, provenance: 'RANKED', isSimulated: false,
    })),
  }, { headers: { 'cache-control': 'private, no-store' } });
}
