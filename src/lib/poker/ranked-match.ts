export const RANKED_HANDS = 10;
export const RANKED_MIN_RANGE = 75;
export const RANKED_MAX_RANGE = 350;
export const RANKED_PRESENCE_MS = 45_000;

interface QueueCandidate {
  playerId: string;
  rating: number;
  joinedAt: Date;
  seenAt: Date;
}

export function rankedRange(joinedAt: number, now: number): number {
  const steps = Math.floor(Math.max(0, now - joinedAt) / 10_000);
  return Math.min(RANKED_MAX_RANGE, RANKED_MIN_RANGE + 25 * steps);
}

/** Both players must accept the rating gap. Among eligible players, use the
 * closest rating, then the person who has waited longest. */
export function chooseRankedOpponent<T extends QueueCandidate>(player: QueueCandidate, pool: T[], now: number): T | undefined {
  const range = rankedRange(player.joinedAt.getTime(), now);
  const distance = (opponent: QueueCandidate) => Math.abs(opponent.rating - player.rating);
  return pool
    .filter((opponent) => opponent.playerId !== player.playerId &&
      now - opponent.seenAt.getTime() <= RANKED_PRESENCE_MS &&
      distance(opponent) <= Math.min(range, rankedRange(opponent.joinedAt.getTime(), now)))
    .sort((a, b) => distance(a) - distance(b) ||
      a.joinedAt.getTime() - b.joinedAt.getTime() ||
      a.playerId.localeCompare(b.playerId))[0];
}

export type RankedQueueStatus =
  | { status: "idle"; rating: number }
  | { status: "searching"; rating: number; joinedAt: number; range: number }
  | { status: "matched"; code: string; rating: number };
