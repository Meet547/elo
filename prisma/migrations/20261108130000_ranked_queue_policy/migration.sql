ALTER TABLE "RankedSeat" ADD COLUMN "rd" DOUBLE PRECISION NOT NULL DEFAULT 350,
  ADD COLUMN "networkTag" TEXT;
ALTER TABLE "Match" ADD COLUMN "sharedNetwork" BOOLEAN NOT NULL DEFAULT false;
UPDATE "RankedSeat" AS seat SET "rd" = player."rd" FROM "Player" AS player
WHERE seat."playerId" = player."id";

CREATE FUNCTION elo_ranked_queue_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."roomCode" IS NOT DISTINCT FROM OLD."roomCode" THEN
    RETURN NEW;
  END IF;
  PERFORM pg_notify('elo_queue_events', json_build_object(
    'actorId', CASE WHEN TG_OP = 'DELETE' THEN OLD."playerId" ELSE NEW."playerId" END
  )::text);
  RETURN NULL;
END $$;
CREATE TRIGGER elo_ranked_queue_notify AFTER INSERT OR UPDATE OR DELETE ON "RankedSeat"
FOR EACH ROW EXECUTE FUNCTION elo_ranked_queue_notify();
