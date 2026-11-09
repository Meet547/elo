ALTER TABLE "Player" ADD COLUMN "ratedAt" TIMESTAMP(3);
CREATE INDEX "Session_playerId_createdAt_idx" ON "Session"("playerId", "createdAt");
UPDATE "Player" AS player SET "ratedAt" = history."latest"
FROM (
  SELECT "playerId", MAX("createdAt") AS "latest" FROM "Session"
  WHERE "mode" IN ('RANKED', 'LEGACY') GROUP BY "playerId"
) AS history WHERE player."id" = history."playerId";
CREATE TABLE "RatingDaily" (
  "day" DATE PRIMARY KEY,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "playerCount" INTEGER NOT NULL,
  "ratingTotal" BIGINT NOT NULL,
  "accountingTotal" BIGINT NOT NULL,
  "ledgerDelta" BIGINT NOT NULL,
  "unexplained" BIGINT
);
