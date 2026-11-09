CREATE TABLE "MatchModeration" (
  "matchId" TEXT PRIMARY KEY REFERENCES "Match"("id") ON UPDATE CASCADE,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL CHECK ("action" IN ('VOID', 'REVERSE')),
  "reason" TEXT NOT NULL CHECK (length("reason") BETWEEN 8 AND 500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "RatingAdjustment" (
  "matchId" TEXT NOT NULL REFERENCES "MatchModeration"("matchId") ON UPDATE CASCADE,
  "playerId" TEXT NOT NULL,
  "before" INTEGER NOT NULL,
  "after" INTEGER NOT NULL,
  "delta" INTEGER NOT NULL CHECK ("delta" = "after" - "before"),
  PRIMARY KEY ("matchId", "playerId")
);
CREATE INDEX "RatingAdjustment_playerId_idx" ON "RatingAdjustment"("playerId");
