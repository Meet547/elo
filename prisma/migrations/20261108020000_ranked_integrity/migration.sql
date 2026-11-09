-- CreateEnum
CREATE TYPE "GameMode" AS ENUM ('LEGACY', 'PRACTICE', 'PRIVATE', 'RANKED');

-- CreateEnum
CREATE TYPE "MatchState" AS ENUM ('QUEUED', 'PROPOSED', 'READY', 'ACTIVE', 'SETTLING', 'SETTLED', 'VOID', 'FORFEIT');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "matchId" TEXT,
ADD COLUMN     "mode" "GameMode" NOT NULL DEFAULT 'LEGACY';

-- AlterTable
ALTER TABLE "LiveRoom" ADD COLUMN     "matchId" TEXT;

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "state" "MatchState" NOT NULL DEFAULT 'QUEUED',
    "handNumber" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchParticipant" (
    "matchId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "seat" INTEGER NOT NULL,
    "ratingSnapshot" JSONB NOT NULL,

    CONSTRAINT "MatchParticipant_pkey" PRIMARY KEY ("matchId","playerId")
);

-- CreateTable
CREATE TABLE "MatchSettlement" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchTransition" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "from" "MatchState" NOT NULL,
    "to" "MatchState" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Match_state_updatedAt_idx" ON "Match"("state", "updatedAt");

-- CreateIndex
CREATE INDEX "MatchParticipant_playerId_idx" ON "MatchParticipant"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchParticipant_matchId_seat_key" ON "MatchParticipant"("matchId", "seat");

-- CreateIndex
CREATE UNIQUE INDEX "MatchSettlement_matchId_key" ON "MatchSettlement"("matchId");

-- CreateIndex
CREATE INDEX "MatchTransition_matchId_createdAt_idx" ON "MatchTransition"("matchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_matchId_playerId_key" ON "Session"("matchId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "LiveRoom_matchId_key" ON "LiveRoom"("matchId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveRoom" ADD CONSTRAINT "LiveRoom_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchSettlement" ADD CONSTRAINT "MatchSettlement_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchTransition" ADD CONSTRAINT "MatchTransition_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-level guards supplement conditional application transitions.
ALTER TABLE "Match" ADD CONSTRAINT "Match_handNumber_bounds" CHECK ("handNumber" BETWEEN 0 AND 10);
ALTER TABLE "Match" ADD CONSTRAINT "Match_active_hand" CHECK ("state" <> 'ACTIVE' OR "handNumber" BETWEEN 1 AND 10);
ALTER TABLE "Session" ADD CONSTRAINT "Session_ranked_match_required" CHECK ("mode" <> 'RANKED' OR "matchId" IS NOT NULL);
