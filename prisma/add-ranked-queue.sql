CREATE TABLE IF NOT EXISTS "RankedSeat" (
  "playerId" TEXT NOT NULL PRIMARY KEY,
  "rating" INTEGER NOT NULL,
  "joinedAt" DATETIME NOT NULL,
  "seenAt" DATETIME NOT NULL,
  "roomCode" TEXT
);

CREATE INDEX IF NOT EXISTS "RankedSeat_roomCode_rating_joinedAt_idx"
  ON "RankedSeat"("roomCode", "rating", "joinedAt");
