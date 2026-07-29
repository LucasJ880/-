-- Phase 3B-A：AiThread 绑定组织（nullable 兼容历史；新线程应用层强制非空）

ALTER TABLE "AiThread" ADD COLUMN IF NOT EXISTS "orgId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AiThread_orgId_fkey'
  ) THEN
    ALTER TABLE "AiThread"
      ADD CONSTRAINT "AiThread_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "AiThread_userId_orgId_pinned_lastMessageAt_idx"
  ON "AiThread"("userId", "orgId", "pinned", "lastMessageAt");

CREATE INDEX IF NOT EXISTS "AiThread_userId_orgId_projectId_idx"
  ON "AiThread"("userId", "orgId", "projectId");
