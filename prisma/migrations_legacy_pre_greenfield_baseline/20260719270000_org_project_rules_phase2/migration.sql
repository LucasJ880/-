-- Phase 2: OrganizationProjectRule

CREATE TABLE IF NOT EXISTS "OrganizationProjectRule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "sourceProjectId" TEXT,
    "sourceReviewId" TEXT,
    "sourceInsightId" TEXT,
    "evidenceJson" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationProjectRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OrganizationProjectRule_orgId_status_idx" ON "OrganizationProjectRule"("orgId", "status");
CREATE INDEX IF NOT EXISTS "OrganizationProjectRule_orgId_category_idx" ON "OrganizationProjectRule"("orgId", "category");
CREATE INDEX IF NOT EXISTS "OrganizationProjectRule_sourceProjectId_idx" ON "OrganizationProjectRule"("sourceProjectId");

DO $$ BEGIN
  ALTER TABLE "OrganizationProjectRule" ADD CONSTRAINT "OrganizationProjectRule_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
