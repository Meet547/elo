import "server-only";
import { db } from "./db";
import { START_RATING } from "@/lib/rating";

const DAY_MS = 86_400_000;
let nextCheck = 0;

/** Compare cumulative ledger movement with the total since the previous snapshot.
 * Archived real profiles stay in the accounting total so closure cannot create drift.
 */
export async function captureRatingDay(now = Date.now()) {
  const day = new Date(Math.floor(now / DAY_MS) * DAY_MS);
  return db.$transaction(async tx => {
    if (await tx.ratingDaily.findUnique({ where: { day } })) return null;
    const previous = await tx.ratingDaily.findFirst({ where: { day: { lt: day } }, orderBy: { day: "desc" } });
    const [totals] = await tx.$queryRaw<{
      playerCount: number; ratingTotal: bigint; accountingTotal: bigint; ledgerDelta: bigint;
    }[]>`
      SELECT COUNT(*)::int AS "playerCount",
        COALESCE(SUM("rating") FILTER (WHERE "deletedAt" IS NULL), 0)::bigint AS "ratingTotal",
        COALESCE(SUM("rating"), 0)::bigint AS "accountingTotal",
        (SELECT COALESCE(SUM(session."ratingAfter" - session."ratingBefore"), 0)::bigint
         FROM "Session" AS session JOIN "Player" AS player ON player."id" = session."playerId"
         WHERE NOT player."isRival" AND session."mode" IN ('RANKED', 'LEGACY')) AS "ledgerDelta"
      FROM "Player" WHERE NOT "isRival"
    `;
    const unexplained = previous
      ? totals.accountingTotal - previous.accountingTotal
        - BigInt((totals.playerCount - previous.playerCount) * START_RATING)
        - (totals.ledgerDelta - previous.ledgerDelta)
      : null;
    const data = { day, capturedAt: new Date(now), ...totals, unexplained };
    const inserted = await tx.ratingDaily.createMany({ data, skipDuplicates: true });
    return inserted.count ? data : null;
  }, { isolationLevel: "RepeatableRead" });
}

export async function checkDailyRating(now: number) {
  if (now < nextCheck) return;
  nextCheck = now + 60_000;
  try {
    const result = await captureRatingDay(now);
    nextCheck = (Math.floor(now / DAY_MS) + 1) * DAY_MS;
    if (result && result.unexplained !== null && result.unexplained !== BigInt(0)) {
      console.warn(JSON.stringify({
        event: "rating_drift",
        day: result.day.toISOString().slice(0, 10),
        unexplained: result.unexplained.toString(),
        ratingTotal: result.ratingTotal.toString(),
      }));
    }
  } catch {
    console.error(JSON.stringify({ event: "rating_audit_retry" }));
  }
}
