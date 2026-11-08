-- Preserve every legacy name and ID; ambiguous old names are claimed explicitly by rename.
ALTER TABLE "Player" ADD COLUMN "nameKey" TEXT;
CREATE UNIQUE INDEX "Player_nameKey_key" ON "Player"("nameKey");
