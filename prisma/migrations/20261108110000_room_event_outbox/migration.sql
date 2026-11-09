CREATE TABLE "RoomEvent" (
 "roomCode" TEXT NOT NULL REFERENCES "LiveRoom"("code") ON DELETE CASCADE,
 "revision" INTEGER NOT NULL, "state" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY("roomCode","revision")
);
CREATE INDEX "RoomEvent_createdAt_idx" ON "RoomEvent"("createdAt");
INSERT INTO "RoomEvent"("roomCode","revision","state") SELECT "code","revision","state"::jsonb FROM "LiveRoom";
CREATE FUNCTION elo_room_event_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  PERFORM pg_notify('elo_room_events',json_build_object('code',OLD."code",'deleted',true)::text);
  RETURN OLD;
 END IF;
 INSERT INTO "RoomEvent"("roomCode","revision","state") VALUES(NEW."code",NEW."revision",NEW."state"::jsonb)
 ON CONFLICT("roomCode","revision") DO UPDATE SET "state"=EXCLUDED."state";
 PERFORM pg_notify('elo_room_events',json_build_object('code',NEW."code",'revision',NEW."revision")::text);
 RETURN NEW;
END $$;
CREATE TRIGGER elo_room_event_notify AFTER INSERT OR UPDATE OR DELETE ON "LiveRoom" FOR EACH ROW EXECUTE FUNCTION elo_room_event_notify();
CREATE FUNCTION elo_session_revoke_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_notify('elo_auth_events',json_build_object('type','session','tag',OLD."tokenHash")::text);
 RETURN OLD;
END $$;
CREATE TRIGGER elo_session_revoke_notify AFTER DELETE ON "AuthSession" FOR EACH ROW EXECUTE FUNCTION elo_session_revoke_notify();
CREATE FUNCTION elo_player_revoke_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."deletedAt" IS NULL AND NEW."deletedAt" IS NOT NULL THEN
  PERFORM pg_notify('elo_auth_events',json_build_object('type','actor','actorId',NEW."id")::text);
 ELSIF NOT OLD."legacySessionsRevoked" AND NEW."legacySessionsRevoked" THEN
  PERFORM pg_notify('elo_auth_events',json_build_object('type','legacy-actor','actorId',NEW."id")::text);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER elo_player_revoke_notify AFTER UPDATE ON "Player" FOR EACH ROW EXECUTE FUNCTION elo_player_revoke_notify();
