ALTER TABLE "RankedSeat" ADD COLUMN "pool" TEXT NOT NULL DEFAULT 'PLACEMENT';
ALTER TABLE "RankedSeat" ADD CONSTRAINT "RankedSeat_pool_check" CHECK ("pool" IN ('PLACEMENT','ESTABLISHED'));
CREATE INDEX "RankedSeat_pool_roomCode_rating_idx" ON "RankedSeat"("pool","roomCode","rating");

ALTER TABLE "Player" ADD COLUMN "rankedPlacements" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Player" ADD CONSTRAINT "Player_rankedPlacements_nonnegative" CHECK ("rankedPlacements" >= 0);
