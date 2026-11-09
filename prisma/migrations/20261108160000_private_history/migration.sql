ALTER TABLE "LiveRoom" ADD COLUMN "instanceId" TEXT;
UPDATE "LiveRoom" SET "instanceId" = gen_random_uuid()::text;
ALTER TABLE "LiveRoom" ALTER COLUMN "instanceId" SET NOT NULL;
CREATE UNIQUE INDEX "LiveRoom_instanceId_key" ON "LiveRoom"("instanceId");
ALTER TABLE "Session" ADD COLUMN "privateRoomId" TEXT;
CREATE UNIQUE INDEX "Session_privateRoomId_playerId_key" ON "Session"("privateRoomId", "playerId");
ALTER TABLE "FairHand" ADD COLUMN "roomInstanceId" TEXT;
CREATE INDEX "FairHand_roomInstanceId_handNo_idx" ON "FairHand"("roomInstanceId", "handNo");
UPDATE "FairHand" AS hand SET "roomInstanceId" = room."instanceId"
FROM "LiveRoom" AS room WHERE hand."roomCode" = room."code"
AND hand."auditData"#>>'{round,context}' = (room."state"::jsonb)#>>'{fair,round,context}';
CREATE OR REPLACE FUNCTION elo_fair_hand_archive() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document JSONB; evidence JSONB; complete_at TIMESTAMP(3);
BEGIN
 document=NEW."state"::jsonb;
 evidence=document#>'{fair,evidence}';
 IF evidence IS NULL OR evidence='null'::jsonb THEN RETURN NEW; END IF;
 IF evidence->>'handId' IS DISTINCT FROM document#>>'{fair,hand,handId}'
    OR evidence->>'root' IS DISTINCT FROM document#>>'{fair,hand,root}'
    OR evidence->>'root' IS DISTINCT FROM document#>>'{game,deckCommit}' THEN
   RAISE EXCEPTION 'Fairness evidence does not match the committed hand.';
 END IF;
 IF EXISTS(SELECT 1 FROM "FairHand" WHERE "handId"=evidence->>'handId' AND "publicData"->>'root' IS DISTINCT FROM evidence->>'root') THEN
   RAISE EXCEPTION 'Fairness commitment cannot be replaced.';
 END IF;
 IF (evidence->>'complete')::boolean THEN complete_at=CURRENT_TIMESTAMP; END IF;
 INSERT INTO "FairHand"("handId","roomCode","roomInstanceId","handNo","publicData","auditData","completedAt")
 VALUES(evidence->>'handId',NEW."code",NEW."instanceId",(document#>>'{game,handNo}')::integer,evidence,
   jsonb_build_object('round',document#>'{fair,round}','hand',document#>'{fair,hand}','game',document->'game'),complete_at)
 ON CONFLICT("handId") DO UPDATE SET
   "roomInstanceId"=EXCLUDED."roomInstanceId",
   "publicData"=EXCLUDED."publicData","auditData"=EXCLUDED."auditData",
   "completedAt"=COALESCE("FairHand"."completedAt",EXCLUDED."completedAt")
 WHERE "FairHand"."completedAt" IS NULL;
 RETURN NEW;
END $$;
