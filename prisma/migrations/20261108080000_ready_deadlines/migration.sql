ALTER TABLE "Match" ADD COLUMN "readyDeadlineAt" TIMESTAMP(3);
ALTER TABLE "LiveRoom" ADD COLUMN "nextDeadlineAt" TIMESTAMP(3);
CREATE INDEX "LiveRoom_nextDeadlineAt_idx" ON "LiveRoom"("nextDeadlineAt");
-- Existing private rooms keep their persisted deadline when present.
UPDATE "LiveRoom" SET "nextDeadlineAt" = to_timestamp(("state"::jsonb->>'nextAt')::double precision / 1000.0) AT TIME ZONE 'UTC' WHERE "state"::jsonb->>'nextAt' IS NOT NULL;
