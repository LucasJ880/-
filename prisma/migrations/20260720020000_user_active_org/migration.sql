-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "activeOrgId" TEXT;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'User_activeOrgId_fkey'
  ) THEN
    ALTER TABLE "User"
      ADD CONSTRAINT "User_activeOrgId_fkey"
      FOREIGN KEY ("activeOrgId") REFERENCES "Organization"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "User_activeOrgId_idx" ON "User"("activeOrgId");
