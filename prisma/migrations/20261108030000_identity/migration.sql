ALTER TABLE "Player" ADD COLUMN "legacySessionsRevoked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE TABLE "AuthSession" (
 "tokenHash" TEXT PRIMARY KEY, "playerId" TEXT NOT NULL REFERENCES "Player"("id") ON DELETE CASCADE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AuthSession_playerId_idx" ON "AuthSession"("playerId");
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");
CREATE TABLE "ExternalIdentity" (
 "provider" TEXT NOT NULL, "subject" TEXT NOT NULL,
 "playerId" TEXT NOT NULL REFERENCES "Player"("id") ON DELETE CASCADE,
 "email" TEXT NOT NULL, "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("provider", "subject")
);
CREATE UNIQUE INDEX "ExternalIdentity_playerId_provider_key" ON "ExternalIdentity"("playerId", "provider");
CREATE TABLE "OAuthAttempt" (
 "stateHash" TEXT PRIMARY KEY, "browserHash" TEXT NOT NULL, "nonce" TEXT NOT NULL,
 "verifier" TEXT NOT NULL, "playerId" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "OAuthAttempt_expiresAt_idx" ON "OAuthAttempt"("expiresAt");
