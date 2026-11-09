-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 1200,
    "rd" REAL NOT NULL DEFAULT 110,
    "volatility" REAL NOT NULL DEFAULT 0.06,
    "rated" INTEGER NOT NULL DEFAULT 0,
    "peak" INTEGER NOT NULL DEFAULT 1200,
    "hands" INTEGER NOT NULL DEFAULT 0,
    "cashes" INTEGER NOT NULL DEFAULT 0,
    "netChips" INTEGER NOT NULL DEFAULT 0,
    "biggestPot" INTEGER NOT NULL DEFAULT 0,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "isRival" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT NOT NULL,
    "hands" INTEGER NOT NULL,
    "buyIn" INTEGER NOT NULL DEFAULT 1500,
    "finalStack" INTEGER NOT NULL,
    "net" INTEGER NOT NULL,
    "place" INTEGER NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 6,
    "ratingBefore" INTEGER NOT NULL,
    "ratingAfter" INTEGER NOT NULL,
    "biggestPot" INTEGER NOT NULL DEFAULT 0,
    "potsWon" INTEGER NOT NULL DEFAULT 0,
    "bestHand" TEXT,
    "exit" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LiveRoom" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RankedSeat" (
    "playerId" TEXT NOT NULL PRIMARY KEY,
    "rating" INTEGER NOT NULL,
    "joinedAt" DATETIME NOT NULL,
    "seenAt" DATETIME NOT NULL,
    "roomCode" TEXT
);

-- CreateIndex
CREATE INDEX "LiveRoom_expiresAt_idx" ON "LiveRoom"("expiresAt");

-- CreateIndex
CREATE INDEX "RankedSeat_roomCode_rating_joinedAt_idx" ON "RankedSeat"("roomCode", "rating", "joinedAt");

