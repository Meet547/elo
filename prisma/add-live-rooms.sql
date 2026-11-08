CREATE TABLE IF NOT EXISTS "LiveRoom" (
  "code" TEXT NOT NULL PRIMARY KEY,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "state" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS "LiveRoom_expiresAt_idx" ON "LiveRoom"("expiresAt");
