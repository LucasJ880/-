-- Phase 4: Project workDomain / deliveryStage / completion dates
-- Rollback (after confirming no app dependency on these columns):
--   DROP INDEX IF EXISTS "Project_orgId_workDomain_deliveryStage_idx";
--   DROP INDEX IF EXISTS "Project_orgId_workDomain_idx";
--   ALTER TABLE "Project" DROP COLUMN IF EXISTS "actualCompletionDate";
--   ALTER TABLE "Project" DROP COLUMN IF EXISTS "plannedCompletionDate";
--   ALTER TABLE "Project" DROP COLUMN IF EXISTS "deliveryStage";
--   ALTER TABLE "Project" DROP COLUMN IF EXISTS "workDomain";
-- Rollback loses Phase 4 delivery project stage/completion data written after this migration.

-- Step 1: add nullable columns
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "workDomain" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "deliveryStage" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "plannedCompletionDate" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "actualCompletionDate" TIMESTAMP(3);

-- Step 2: deterministic backfill (no name-keyword heuristics)
-- tender: explicit tender fields or tender-related relations
UPDATE "Project" AS p
SET "workDomain" = 'tender'
WHERE p."workDomain" IS NULL
  AND (
    p."tenderStatus" IS NOT NULL
    OR p."closeDate" IS NOT NULL
    OR p."awardDate" IS NOT NULL
    OR p."publicDate" IS NOT NULL
    OR p."questionCloseDate" IS NOT NULL
    OR p."solicitationNumber" IS NOT NULL
    OR p."sourceSystem" IS NOT NULL
    OR EXISTS (SELECT 1 FROM "TenderRequirement" tr WHERE tr."projectId" = p.id)
    OR EXISTS (SELECT 1 FROM "ProductEvidence" pe WHERE pe."projectId" = p.id)
    OR EXISTS (SELECT 1 FROM "BidDataRevision" br WHERE br."projectId" = p.id)
    OR EXISTS (SELECT 1 FROM "ExternalReference" er WHERE er."projectId" = p.id)
    OR EXISTS (SELECT 1 FROM "ProjectIntelligence" pi WHERE pi."projectId" = p.id)
  );

-- remaining historical rows without reliable tender signals → general
UPDATE "Project"
SET "workDomain" = 'general'
WHERE "workDomain" IS NULL;

-- Step 3: enforce NOT NULL + safe default for new rows; do NOT auto-set deliveryStage
ALTER TABLE "Project" ALTER COLUMN "workDomain" SET DEFAULT 'general';
ALTER TABLE "Project" ALTER COLUMN "workDomain" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "Project_orgId_workDomain_idx"
  ON "Project"("orgId", "workDomain");

CREATE INDEX IF NOT EXISTS "Project_orgId_workDomain_deliveryStage_idx"
  ON "Project"("orgId", "workDomain", "deliveryStage");
