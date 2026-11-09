ALTER TABLE "Session" ADD COLUMN "bestSeenHand" TEXT,
ADD COLUMN "bestSeenScore" INTEGER,
ADD COLUMN "bestWinningHand" TEXT,
ADD COLUMN "bestWinningScore" INTEGER;
ALTER TABLE "Session" ADD CONSTRAINT "bestSeenScoreNonnegative" CHECK ("bestSeenScore" IS NULL OR "bestSeenScore" >= 0),
ADD CONSTRAINT "bestWinningScoreNonnegative" CHECK ("bestWinningScore" IS NULL OR "bestWinningScore" >= 0);
