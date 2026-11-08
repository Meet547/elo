CREATE TABLE "CommandReceipt" (
 "actorId" TEXT NOT NULL REFERENCES "Player"("id") ON DELETE CASCADE,
 "scope" VARCHAR(80) NOT NULL, "key" UUID NOT NULL, "requestHash" CHAR(64) NOT NULL,
 "response" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMP(3) NOT NULL, PRIMARY KEY("actorId","scope","key")
);
CREATE INDEX "CommandReceipt_expiresAt_idx" ON "CommandReceipt"("expiresAt");
