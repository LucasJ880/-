-- Phase 1: Project AI summary / insight / similarity / review / generated docs

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "ourBidPrice" DOUBLE PRECISION;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "winningBidPrice" DOUBLE PRECISION;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "projectTypes" JSONB;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "aiAdviceStatus" TEXT;

ALTER TABLE "ProjectIntelligence" ADD COLUMN IF NOT EXISTS "structuredSummaryJson" TEXT;

CREATE TABLE IF NOT EXISTS "ProjectInsight" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'chat',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "embedding" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectInsight_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProjectSimilarity" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "projectId" TEXT NOT NULL,
    "similarProjectId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "reasonsJson" TEXT NOT NULL,
    "impactText" TEXT,
    "recommendationsJson" TEXT,
    "redacted" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectSimilarity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProjectReview" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "outcome" TEXT,
    "priceAnalysisJson" TEXT,
    "reasonTagsJson" TEXT,
    "narrative" TEXT,
    "customerFeedback" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProjectGeneratedDocument" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "projectId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "version" INT NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "blobUrl" TEXT,
    "fileUrl" TEXT,
    "metaJson" TEXT,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectGeneratedDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProjectInsight_projectId_status_idx" ON "ProjectInsight"("projectId", "status");
CREATE INDEX IF NOT EXISTS "ProjectInsight_orgId_status_idx" ON "ProjectInsight"("orgId", "status");
CREATE INDEX IF NOT EXISTS "ProjectInsight_kind_idx" ON "ProjectInsight"("kind");

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectSimilarity_projectId_similarProjectId_key" ON "ProjectSimilarity"("projectId", "similarProjectId");
CREATE INDEX IF NOT EXISTS "ProjectSimilarity_projectId_score_idx" ON "ProjectSimilarity"("projectId", "score");
CREATE INDEX IF NOT EXISTS "ProjectSimilarity_orgId_idx" ON "ProjectSimilarity"("orgId");

CREATE INDEX IF NOT EXISTS "ProjectReview_projectId_status_idx" ON "ProjectReview"("projectId", "status");
CREATE INDEX IF NOT EXISTS "ProjectReview_orgId_status_idx" ON "ProjectReview"("orgId", "status");
CREATE INDEX IF NOT EXISTS "ProjectReview_outcome_idx" ON "ProjectReview"("outcome");

CREATE INDEX IF NOT EXISTS "ProjectGeneratedDocument_projectId_docType_idx" ON "ProjectGeneratedDocument"("projectId", "docType");
CREATE INDEX IF NOT EXISTS "ProjectGeneratedDocument_orgId_idx" ON "ProjectGeneratedDocument"("orgId");

DO $$ BEGIN
  ALTER TABLE "ProjectInsight" ADD CONSTRAINT "ProjectInsight_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProjectSimilarity" ADD CONSTRAINT "ProjectSimilarity_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProjectSimilarity" ADD CONSTRAINT "ProjectSimilarity_similarProjectId_fkey"
    FOREIGN KEY ("similarProjectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProjectReview" ADD CONSTRAINT "ProjectReview_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProjectGeneratedDocument" ADD CONSTRAINT "ProjectGeneratedDocument_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
