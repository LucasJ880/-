-- Project: 主采购人 + 开标日
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "purchaserId" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "openDate" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Project_purchaserId_fkey'
  ) THEN
    ALTER TABLE "Project"
      ADD CONSTRAINT "Project_purchaserId_fkey"
      FOREIGN KEY ("purchaserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Project_purchaserId_idx" ON "Project"("purchaserId");

-- CalendarEvent: 项目里程碑同步
ALTER TABLE "CalendarEvent" ADD COLUMN IF NOT EXISTS "sourceKey" TEXT;
ALTER TABLE "CalendarEvent" ADD COLUMN IF NOT EXISTS "projectId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CalendarEvent_projectId_fkey'
  ) THEN
    ALTER TABLE "CalendarEvent"
      ADD CONSTRAINT "CalendarEvent_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "CalendarEvent_userId_sourceKey_key"
  ON "CalendarEvent"("userId", "sourceKey");

CREATE INDEX IF NOT EXISTS "CalendarEvent_projectId_idx" ON "CalendarEvent"("projectId");
