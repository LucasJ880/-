-- Phase 5: Award → delivery handoff
-- DO NOT apply to shared/production Neon until migration history is reconciled.
-- See docs/MIGRATION_HISTORY_RECONCILIATION.md
--
-- Rollback (after confirming no app dependency):
--   DROP INDEX IF EXISTS "Task_sourceBatchKey_idx";
--   DROP INDEX IF EXISTS "Task_sourceType_sourceId_idx";
--   DROP INDEX IF EXISTS "Task_sourceId_sourceTemplateKey_key";
--   ALTER TABLE "Task" DROP COLUMN IF EXISTS "sourceTemplateKey";
--   ALTER TABLE "Task" DROP COLUMN IF EXISTS "sourceBatchKey";
--   ALTER TABLE "Task" DROP COLUMN IF EXISTS "sourceId";
--   ALTER TABLE "Task" DROP COLUMN IF EXISTS "sourceType";
--   DROP TABLE IF EXISTS "ProjectHandoff";
--   DROP INDEX IF EXISTS "Project_sourceTenderProjectId_idx";
--   DROP INDEX IF EXISTS "Project_orgId_sourceTenderProjectId_idx";
--   ALTER TABLE "Project" DROP COLUMN IF EXISTS "sourceTenderProjectId";
-- Rollback loses Phase 5 handoff records, source links, and task source metadata.

-- Project source reference
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "sourceTenderProjectId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Project_sourceTenderProjectId_fkey'
  ) THEN
    ALTER TABLE "Project"
      ADD CONSTRAINT "Project_sourceTenderProjectId_fkey"
      FOREIGN KEY ("sourceTenderProjectId") REFERENCES "Project"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Project_orgId_sourceTenderProjectId_idx"
  ON "Project"("orgId", "sourceTenderProjectId");
CREATE INDEX IF NOT EXISTS "Project_sourceTenderProjectId_idx"
  ON "Project"("sourceTenderProjectId");

-- ProjectHandoff
CREATE TABLE IF NOT EXISTS "ProjectHandoff" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "sourceTenderProjectId" TEXT NOT NULL,
  "targetDeliveryProjectId" TEXT,
  "handoffType" TEXT NOT NULL DEFAULT 'award_to_delivery',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "idempotencyKey" TEXT NOT NULL,
  "initiatedById" TEXT NOT NULL,
  "deliveryOwnerId" TEXT NOT NULL,
  "previewSnapshot" JSONB,
  "transferredSnapshot" JSONB,
  "overrideReason" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectHandoff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectHandoff_idempotencyKey_key"
  ON "ProjectHandoff"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectHandoff_targetDeliveryProjectId_key"
  ON "ProjectHandoff"("targetDeliveryProjectId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectHandoff_orgId_sourceTenderProjectId_handoffType_key"
  ON "ProjectHandoff"("orgId", "sourceTenderProjectId", "handoffType");
CREATE INDEX IF NOT EXISTS "ProjectHandoff_orgId_status_idx"
  ON "ProjectHandoff"("orgId", "status");
CREATE INDEX IF NOT EXISTS "ProjectHandoff_sourceTenderProjectId_idx"
  ON "ProjectHandoff"("sourceTenderProjectId");
CREATE INDEX IF NOT EXISTS "ProjectHandoff_status_idx"
  ON "ProjectHandoff"("status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectHandoff_orgId_fkey') THEN
    ALTER TABLE "ProjectHandoff"
      ADD CONSTRAINT "ProjectHandoff_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectHandoff_sourceTenderProjectId_fkey') THEN
    ALTER TABLE "ProjectHandoff"
      ADD CONSTRAINT "ProjectHandoff_sourceTenderProjectId_fkey"
      FOREIGN KEY ("sourceTenderProjectId") REFERENCES "Project"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectHandoff_targetDeliveryProjectId_fkey') THEN
    ALTER TABLE "ProjectHandoff"
      ADD CONSTRAINT "ProjectHandoff_targetDeliveryProjectId_fkey"
      FOREIGN KEY ("targetDeliveryProjectId") REFERENCES "Project"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectHandoff_initiatedById_fkey') THEN
    ALTER TABLE "ProjectHandoff"
      ADD CONSTRAINT "ProjectHandoff_initiatedById_fkey"
      FOREIGN KEY ("initiatedById") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectHandoff_deliveryOwnerId_fkey') THEN
    ALTER TABLE "ProjectHandoff"
      ADD CONSTRAINT "ProjectHandoff_deliveryOwnerId_fkey"
      FOREIGN KEY ("deliveryOwnerId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Task source fields
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "sourceType" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "sourceId" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "sourceBatchKey" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "sourceTemplateKey" TEXT;

CREATE INDEX IF NOT EXISTS "Task_sourceType_sourceId_idx" ON "Task"("sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS "Task_sourceBatchKey_idx" ON "Task"("sourceBatchKey");

-- Unique for handoff task dedupe; multiple NULLs remain allowed in PostgreSQL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'Task_sourceId_sourceTemplateKey_key'
  ) THEN
    CREATE UNIQUE INDEX "Task_sourceId_sourceTemplateKey_key"
      ON "Task"("sourceId", "sourceTemplateKey");
  END IF;
END $$;
