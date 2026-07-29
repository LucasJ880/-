-- Phase 3: Task waiting/blocked fields (status remains String; new values are app-level)
-- Rollback: ALTER TABLE "Task" DROP COLUMN "blockedReason", DROP COLUMN "waitingOn", DROP COLUMN "waitingUntil";

ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "blockedReason" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "waitingOn" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "waitingUntil" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Task_waitingUntil_idx" ON "Task"("waitingUntil");
