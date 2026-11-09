CREATE TABLE "FairHand" (
 "handId" TEXT PRIMARY KEY,
 "roomCode" TEXT NOT NULL,
 "handNo" INTEGER NOT NULL,
 "publicData" JSONB NOT NULL,
 "auditData" JSONB NOT NULL,
 "completedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "FairHand_roomCode_handNo_idx" ON "FairHand"("roomCode","handNo");
CREATE FUNCTION elo_fair_hand_archive() RETURNS trigger LANGUAGE plpgsql AS $$
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
 INSERT INTO "FairHand"("handId","roomCode","handNo","publicData","auditData","completedAt")
 VALUES(evidence->>'handId',NEW."code",(document#>>'{game,handNo}')::integer,evidence,
   jsonb_build_object('round',document#>'{fair,round}','hand',document#>'{fair,hand}','game',document->'game'),complete_at)
 ON CONFLICT("handId") DO UPDATE SET
   "publicData"=EXCLUDED."publicData","auditData"=EXCLUDED."auditData",
   "completedAt"=COALESCE("FairHand"."completedAt",EXCLUDED."completedAt")
 WHERE "FairHand"."completedAt" IS NULL;
 RETURN NEW;
END $$;
CREATE TRIGGER elo_fair_hand_archive AFTER INSERT OR UPDATE ON "LiveRoom" FOR EACH ROW EXECUTE FUNCTION elo_fair_hand_archive();
