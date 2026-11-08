import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { ROSTER } from '@/lib/poker/ai';

/** Explicit, idempotent seed. No request handler calls this function. */
export async function seedPracticeRoster(client: PrismaClient) {
  return client.player.createMany({ skipDuplicates: true, data: ROSTER.map(bot => ({
    id: `rival_${bot.slug}`, name: bot.name, rating: bot.rating, rd: 70,
    peak: bot.rating, hands: bot.hands, cashes: bot.cashes,
    isSimulated: true,
  })) });
}
