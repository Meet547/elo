CREATE TABLE "RateWindow" ("key" TEXT PRIMARY KEY, "count" INTEGER NOT NULL, "resetAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "RateWindow_resetAt_idx" ON "RateWindow"("resetAt");
