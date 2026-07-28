-- Phase 4A-2A: Bid Data Review state machine + edit provenance fields

ALTER TABLE "BidDataRevision" ADD COLUMN "technicalReviewStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED';
ALTER TABLE "BidDataRevision" ADD COLUMN "financialReviewStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED';
ALTER TABLE "BidDataRevision" ADD COLUMN "submittedByUserId" TEXT;
ALTER TABLE "BidDataRevision" ADD COLUMN "submittedAt" TIMESTAMP(3);
ALTER TABLE "BidDataRevision" ADD COLUMN "technicalApprovedByUserId" TEXT;
ALTER TABLE "BidDataRevision" ADD COLUMN "technicalApprovedAt" TIMESTAMP(3);
ALTER TABLE "BidDataRevision" ADD COLUMN "financialApprovedByUserId" TEXT;
ALTER TABLE "BidDataRevision" ADD COLUMN "financialApprovedAt" TIMESTAMP(3);
ALTER TABLE "BidDataRevision" ADD COLUMN "rejectedByUserId" TEXT;
ALTER TABLE "BidDataRevision" ADD COLUMN "rejectedAt" TIMESTAMP(3);
ALTER TABLE "BidDataRevision" ADD COLUMN "rejectReason" TEXT;
ALTER TABLE "BidDataRevision" ADD COLUMN "revisionContentHash" TEXT;

ALTER TABLE "TenderRequirement" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'AGENT';
ALTER TABLE "TenderRequirement" ADD COLUMN "originalValueJson" JSONB;
ALTER TABLE "TenderRequirement" ADD COLUMN "lastChangeReason" TEXT;
ALTER TABLE "TenderRequirement" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "TenderRequirement_deletedAt_idx" ON "TenderRequirement"("deletedAt");

ALTER TABLE "ComplianceResponse" ADD COLUMN "reviewerNote" TEXT;
ALTER TABLE "ComplianceResponse" ADD COLUMN "conditionText" TEXT;
ALTER TABLE "ComplianceResponse" ADD COLUMN "requiredFollowUp" TEXT;
ALTER TABLE "ComplianceResponse" ADD COLUMN "responsibleParty" TEXT;
ALTER TABLE "ComplianceResponse" ADD COLUMN "dueDate" TIMESTAMP(3);
