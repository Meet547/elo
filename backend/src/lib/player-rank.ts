import 'server-only';
import type { Player, PrismaClient } from '@prisma/client';

/** Uses the same deterministic ordering as the real ladder, independent of its page size. */
export async function realPlayerRank(client: PrismaClient, player: Pick<Player, 'id' | 'rating' | 'hands'>) {
  return 1 + await client.player.count({ where: { isSimulated: false, deletedAt: null, OR: [
    { rating: { gt: player.rating } },
    { rating: player.rating, hands: { gt: player.hands } },
    { rating: player.rating, hands: player.hands, id: { lt: player.id } },
  ] } });
}
