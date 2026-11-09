export const RANKED_HANDS = 10;
export const RANKED_READY_MS = 15_000;
export const RANKED_MIN_RANGE = 75;
export const RANKED_MAX_RANGE = 350;
export const RANKED_PRESENCE_MS = 45_000;
export const RANKED_SEARCH_MS = 180_000;
export const RANKED_REMATCH_MS = 10 * 60_000;
export const RANKED_PROPOSAL_COOLDOWN_MS = 60_000;
const OLD_SEARCH_MS = 120_000;
const SHARED_NETWORK_PENALTY = 40;

interface QueueCandidate {
  playerId: string;
  rating: number;
  joinedAt: Date;
  seenAt: Date;
  rd?: number;
  networkTag?: string | null;
}

export function rankedRange(joinedAt: number, now: number, rd = 150): number {
  const steps = Math.floor(Math.max(0, now - joinedAt) / 10_000);
  const initial = Math.max(RANKED_MIN_RANGE, Math.round(rd / 2));
  return Math.min(RANKED_MAX_RANGE, initial + 25 * steps);
}

export function sharesRankedNetwork(a: QueueCandidate, b: QueueCandidate): boolean {
  return Boolean(a.networkTag && a.networkTag === b.networkTag);
}

export function chooseRankedOpponent<T extends QueueCandidate>(
  player: QueueCandidate, pool: T[], now: number, blocked = new Set<string>(),
): T | undefined {
  if (now - player.joinedAt.getTime() >= RANKED_SEARCH_MS) return;
  const range = rankedRange(player.joinedAt.getTime(), now, player.rd);
  const distance = (opponent: QueueCandidate) => Math.abs(opponent.rating - player.rating);
  const score = (opponent: QueueCandidate) => distance(opponent) +
    (sharesRankedNetwork(player, opponent) ? SHARED_NETWORK_PENALTY : 0);
  const oldest = (opponent: QueueCandidate) => now - opponent.joinedAt.getTime() >= OLD_SEARCH_MS;
  return pool.filter(opponent =>
    opponent.playerId !== player.playerId && !blocked.has(opponent.playerId) &&
    now - opponent.seenAt.getTime() <= RANKED_PRESENCE_MS &&
    now - opponent.joinedAt.getTime() < RANKED_SEARCH_MS &&
    distance(opponent) <= Math.min(range, rankedRange(opponent.joinedAt.getTime(), now, opponent.rd))
  ).sort((a, b) =>
    Number(oldest(b)) - Number(oldest(a)) ||
    (oldest(a) ? a.joinedAt.getTime() - b.joinedAt.getTime() : score(a) - score(b)) ||
    a.joinedAt.getTime() - b.joinedAt.getTime() ||
    a.playerId.localeCompare(b.playerId)
  )[0];
}

export type RankedQueueStatus =
  | { status: "idle" | "expired"; rating: number }
  | { status: "searching"; rating: number; joinedAt: number; range: number }
  | { status: "matched"; code: string; rating: number };
