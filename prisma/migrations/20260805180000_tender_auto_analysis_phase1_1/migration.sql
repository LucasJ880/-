-- Phase 1.1 Tender Auto Analysis — additive only
-- CREATE TABLE / ALTER ADD COLUMN；不 DROP、不 rename。Rollback：删除本 migration 对应表/列。

-- ProjectDocument：内容指纹与页级解析元数据
ALTER TABLE "ProjectDocument" ADD COLUMN IF NOT EXISTS "contentHash" TEXT;
ALTER TABLE "ProjectDocument" ADD COLUMN IF NOT EXISTS "pageCount" INTEGER;
ALTER TABLE "ProjectDocument" ADD COLUMN IF NOT EXISTS "parseVersion" TEXT;

CREATE INDEX IF NOT EXISTS "ProjectDocument_contentHash_idx" ON "ProjectDocument"("contentHash");
CREATE INDEX IF NOT EXISTS "ProjectDocument_projectId_contentHash_idx" ON "ProjectDocument"("projectId", "contentHash");

CREATE TABLE IF NOT EXISTS "ProjectDocumentPage" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "contentText" TEXT NOT NULL,
    "charCount" INTEGER NOT NULL DEFAULT 0,
    "extractionMethod" TEXT NOT NULL DEFAULT 'unpdf',
    "parseStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectDocumentPage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectDocumentPage_documentId_pageNumber_key"
  ON "ProjectDocumentPage"("documentId", "pageNumber");
CREATE INDEX IF NOT EXISTS "ProjectDocumentPage_documentId_idx"
  ON "ProjectDocumentPage"("documentId");
CREATE INDEX IF NOT EXISTS "ProjectDocumentPage_documentId_parseStatus_idx"
  ON "ProjectDocumentPage"("documentId", "parseStatus");

DO $$ BEGIN
  ALTER TABLE "ProjectDocumentPage"
    ADD CONSTRAINT "ProjectDocumentPage_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "TenderAnalysisRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "roomId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "runKind" TEXT NOT NULL DEFAULT 'FULL',
    "analysisVersion" TEXT NOT NULL DEFAULT 'tender-auto-analysis-v1',
    "promptVersion" TEXT NOT NULL DEFAULT 'tender-analysis-prompt-v1',
    "model" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "sourceHashFingerprint" TEXT NOT NULL,
    "workerStep" TEXT,
    "workerCursor" JSONB,
    "summaryJson" JSONB,
    "summaryText" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessageSanitized" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "parentRunId" TEXT,
    "supersedesRunId" TEXT,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "tokenUsageJson" JSONB,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenderAnalysisRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TenderAnalysisRun_idempotencyKey_key"
  ON "TenderAnalysisRun"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "TenderAnalysisRun_status_nextAttemptAt_idx"
  ON "TenderAnalysisRun"("status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "TenderAnalysisRun_status_leaseExpiresAt_idx"
  ON "TenderAnalysisRun"("status", "leaseExpiresAt");
CREATE INDEX IF NOT EXISTS "TenderAnalysisRun_orgId_projectId_status_idx"
  ON "TenderAnalysisRun"("orgId", "projectId", "status");
CREATE INDEX IF NOT EXISTS "TenderAnalysisRun_projectId_status_idx"
  ON "TenderAnalysisRun"("projectId", "status");
CREATE INDEX IF NOT EXISTS "TenderAnalysisRun_orgId_status_idx"
  ON "TenderAnalysisRun"("orgId", "status");

DO $$ BEGIN
  ALTER TABLE "TenderAnalysisRun"
    ADD CONSTRAINT "TenderAnalysisRun_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TenderAnalysisRun"
    ADD CONSTRAINT "TenderAnalysisRun_parentRunId_fkey"
    FOREIGN KEY ("parentRunId") REFERENCES "TenderAnalysisRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TenderAnalysisRun"
    ADD CONSTRAINT "TenderAnalysisRun_supersedesRunId_fkey"
    FOREIGN KEY ("supersedesRunId") REFERENCES "TenderAnalysisRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "TenderAnalysisRunDocument" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'PRIMARY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TenderAnalysisRunDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TenderAnalysisRunDocument_runId_documentId_key"
  ON "TenderAnalysisRunDocument"("runId", "documentId");
CREATE INDEX IF NOT EXISTS "TenderAnalysisRunDocument_runId_idx"
  ON "TenderAnalysisRunDocument"("runId");
CREATE INDEX IF NOT EXISTS "TenderAnalysisRunDocument_documentId_idx"
  ON "TenderAnalysisRunDocument"("documentId");
CREATE INDEX IF NOT EXISTS "TenderAnalysisRunDocument_contentHash_idx"
  ON "TenderAnalysisRunDocument"("contentHash");

DO $$ BEGIN
  ALTER TABLE "TenderAnalysisRunDocument"
    ADD CONSTRAINT "TenderAnalysisRunDocument_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "TenderAnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TenderAnalysisRunDocument"
    ADD CONSTRAINT "TenderAnalysisRunDocument_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "TenderAnalysisSection" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "contentZh" TEXT NOT NULL,
    "structuredJson" JSONB,
    "confidence" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "reviewStatus" TEXT NOT NULL DEFAULT 'AI_DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenderAnalysisSection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TenderAnalysisSection_runId_sectionKey_key"
  ON "TenderAnalysisSection"("runId", "sectionKey");
CREATE INDEX IF NOT EXISTS "TenderAnalysisSection_runId_idx"
  ON "TenderAnalysisSection"("runId");

DO $$ BEGIN
  ALTER TABLE "TenderAnalysisSection"
    ADD CONSTRAINT "TenderAnalysisSection_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "TenderAnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "TenderAnalysisFact" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sectionId" TEXT,
    "statementKind" TEXT NOT NULL,
    "contentZh" TEXT NOT NULL,
    "contentOriginal" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "manuallyConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TenderAnalysisFact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TenderAnalysisFact_runId_idx"
  ON "TenderAnalysisFact"("runId");
CREATE INDEX IF NOT EXISTS "TenderAnalysisFact_runId_statementKind_idx"
  ON "TenderAnalysisFact"("runId", "statementKind");
CREATE INDEX IF NOT EXISTS "TenderAnalysisFact_sectionId_idx"
  ON "TenderAnalysisFact"("sectionId");

DO $$ BEGIN
  ALTER TABLE "TenderAnalysisFact"
    ADD CONSTRAINT "TenderAnalysisFact_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "TenderAnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TenderAnalysisFact"
    ADD CONSTRAINT "TenderAnalysisFact_sectionId_fkey"
    FOREIGN KEY ("sectionId") REFERENCES "TenderAnalysisSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "TenderExtractedRequirement" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "requirementCode" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "originalRequirement" TEXT NOT NULL,
    "chineseTranslation" TEXT NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
    "complianceStatus" TEXT NOT NULL DEFAULT 'NOT_ASSESSED',
    "reviewStatus" TEXT NOT NULL DEFAULT 'AI_EXTRACTED',
    "ownerId" TEXT,
    "sourcePage" INTEGER,
    "projectionStatus" TEXT NOT NULL DEFAULT 'NOT_PROJECTED',
    "projectedRequirementId" TEXT,
    "projectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenderExtractedRequirement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TenderExtractedRequirement_analysisRunId_requirementCode_key"
  ON "TenderExtractedRequirement"("analysisRunId", "requirementCode");
CREATE INDEX IF NOT EXISTS "TenderExtractedRequirement_projectId_idx"
  ON "TenderExtractedRequirement"("projectId");
CREATE INDEX IF NOT EXISTS "TenderExtractedRequirement_analysisRunId_idx"
  ON "TenderExtractedRequirement"("analysisRunId");
CREATE INDEX IF NOT EXISTS "TenderExtractedRequirement_projectId_reviewStatus_idx"
  ON "TenderExtractedRequirement"("projectId", "reviewStatus");

DO $$ BEGIN
  ALTER TABLE "TenderExtractedRequirement"
    ADD CONSTRAINT "TenderExtractedRequirement_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TenderExtractedRequirement"
    ADD CONSTRAINT "TenderExtractedRequirement_analysisRunId_fkey"
    FOREIGN KEY ("analysisRunId") REFERENCES "TenderAnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "TenderDeliverable" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "deliverableKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "sourcePage" INTEGER,
    "ownerId" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "relatedDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenderDeliverable_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TenderDeliverable_analysisRunId_deliverableKey_key"
  ON "TenderDeliverable"("analysisRunId", "deliverableKey");
CREATE INDEX IF NOT EXISTS "TenderDeliverable_projectId_idx"
  ON "TenderDeliverable"("projectId");
CREATE INDEX IF NOT EXISTS "TenderDeliverable_analysisRunId_idx"
  ON "TenderDeliverable"("analysisRunId");

DO $$ BEGIN
  ALTER TABLE "TenderDeliverable"
    ADD CONSTRAINT "TenderDeliverable_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TenderDeliverable"
    ADD CONSTRAINT "TenderDeliverable_analysisRunId_fkey"
    FOREIGN KEY ("analysisRunId") REFERENCES "TenderAnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "TenderClarificationQuestion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "enquiryDeadline" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "sentAt" TIMESTAMP(3),
    "responseText" TEXT,
    "responseDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenderClarificationQuestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TenderClarificationQuestion_projectId_idx"
  ON "TenderClarificationQuestion"("projectId");
CREATE INDEX IF NOT EXISTS "TenderClarificationQuestion_analysisRunId_idx"
  ON "TenderClarificationQuestion"("analysisRunId");
CREATE INDEX IF NOT EXISTS "TenderClarificationQuestion_analysisRunId_status_idx"
  ON "TenderClarificationQuestion"("analysisRunId", "status");

DO $$ BEGIN
  ALTER TABLE "TenderClarificationQuestion"
    ADD CONSTRAINT "TenderClarificationQuestion_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TenderClarificationQuestion"
    ADD CONSTRAINT "TenderClarificationQuestion_analysisRunId_fkey"
    FOREIGN KEY ("analysisRunId") REFERENCES "TenderAnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "TenderAnalysisSourceRef" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "pageNumber" INTEGER,
    "sectionLabel" TEXT,
    "originalTextSnippet" TEXT NOT NULL,
    "extractionMethod" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "factId" TEXT,
    "sectionId" TEXT,
    "requirementId" TEXT,
    "clarificationQuestionId" TEXT,
    "deliverableId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TenderAnalysisSourceRef_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TenderAnalysisSourceRef_runId_idx"
  ON "TenderAnalysisSourceRef"("runId");
CREATE INDEX IF NOT EXISTS "TenderAnalysisSourceRef_documentId_idx"
  ON "TenderAnalysisSourceRef"("documentId");
CREATE INDEX IF NOT EXISTS "TenderAnalysisSourceRef_factId_idx"
  ON "TenderAnalysisSourceRef"("factId");
CREATE INDEX IF NOT EXISTS "TenderAnalysisSourceRef_sectionId_idx"
  ON "TenderAnalysisSourceRef"("sectionId");
CREATE INDEX IF NOT EXISTS "TenderAnalysisSourceRef_requirementId_idx"
  ON "TenderAnalysisSourceRef"("requirementId");
CREATE INDEX IF NOT EXISTS "TenderAnalysisSourceRef_clarificationQuestionId_idx"
  ON "TenderAnalysisSourceRef"("clarificationQuestionId");
CREATE INDEX IF NOT EXISTS "TenderAnalysisSourceRef_deliverableId_idx"
  ON "TenderAnalysisSourceRef"("deliverableId");

DO $$ BEGIN
  ALTER TABLE "TenderAnalysisSourceRef"
    ADD CONSTRAINT "TenderAnalysisSourceRef_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "TenderAnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TenderAnalysisSourceRef"
    ADD CONSTRAINT "TenderAnalysisSourceRef_factId_fkey"
    FOREIGN KEY ("factId") REFERENCES "TenderAnalysisFact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TenderAnalysisSourceRef"
    ADD CONSTRAINT "TenderAnalysisSourceRef_sectionId_fkey"
    FOREIGN KEY ("sectionId") REFERENCES "TenderAnalysisSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TenderAnalysisSourceRef"
    ADD CONSTRAINT "TenderAnalysisSourceRef_requirementId_fkey"
    FOREIGN KEY ("requirementId") REFERENCES "TenderExtractedRequirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TenderAnalysisSourceRef"
    ADD CONSTRAINT "TenderAnalysisSourceRef_clarificationQuestionId_fkey"
    FOREIGN KEY ("clarificationQuestionId") REFERENCES "TenderClarificationQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TenderAnalysisSourceRef"
    ADD CONSTRAINT "TenderAnalysisSourceRef_deliverableId_fkey"
    FOREIGN KEY ("deliverableId") REFERENCES "TenderDeliverable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "TenderAnalysisChangeCandidate" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "parentRunId" TEXT,
    "changeType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityKey" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "summaryZh" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TenderAnalysisChangeCandidate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TenderAnalysisChangeCandidate_runId_idx"
  ON "TenderAnalysisChangeCandidate"("runId");
CREATE INDEX IF NOT EXISTS "TenderAnalysisChangeCandidate_runId_status_idx"
  ON "TenderAnalysisChangeCandidate"("runId", "status");
CREATE INDEX IF NOT EXISTS "TenderAnalysisChangeCandidate_parentRunId_idx"
  ON "TenderAnalysisChangeCandidate"("parentRunId");

DO $$ BEGIN
  ALTER TABLE "TenderAnalysisChangeCandidate"
    ADD CONSTRAINT "TenderAnalysisChangeCandidate_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "TenderAnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
