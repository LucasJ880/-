-- Phase C: PublishJob snapshots, status events, Postiz writeback fields
-- Compatible: new columns nullable or defaulted; no destructive changes.

-- AlterTable
ALTER TABLE "PublishJob" ADD COLUMN "hookText" TEXT;
ALTER TABLE "PublishJob" ADD COLUMN "titleText" TEXT;
ALTER TABLE "PublishJob" ADD COLUMN "ctaText" TEXT;
ALTER TABLE "PublishJob" ADD COLUMN "firstCommentText" TEXT;
ALTER TABLE "PublishJob" ADD COLUMN "platformFieldsJson" JSONB;
ALTER TABLE "PublishJob" ADD COLUMN "externalPostUrl" TEXT;
ALTER TABLE "PublishJob" ADD COLUMN "providerStatus" TEXT;
ALTER TABLE "PublishJob" ADD COLUMN "providerResponseJson" JSONB;
ALTER TABLE "PublishJob" ADD COLUMN "contentVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PublishJob" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "PublishJob" ADD COLUMN "contextSnapshotJson" JSONB;
ALTER TABLE "PublishJob" ADD COLUMN "generationMetadataJson" JSONB;
ALTER TABLE "PublishJob" ADD COLUMN "riskAssessmentJson" JSONB;
ALTER TABLE "PublishJob" ADD COLUMN "approvalSnapshotJson" JSONB;
ALTER TABLE "PublishJob" ADD COLUMN "similarityScore" DOUBLE PRECISION;
ALTER TABLE "PublishJob" ADD COLUMN "similarityJson" JSONB;
ALTER TABLE "PublishJob" ADD COLUMN "playbookEnforcementMode" TEXT;
ALTER TABLE "PublishJob" ADD COLUMN "createdById" TEXT;
ALTER TABLE "PublishJob" ADD COLUMN "approvedById" TEXT;
ALTER TABLE "PublishJob" ADD COLUMN "approvedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "PublishJob_idempotencyKey_key" ON "PublishJob"("idempotencyKey");
CREATE INDEX "PublishJob_orgId_providerStatus_idx" ON "PublishJob"("orgId", "providerStatus");

-- CreateTable
CREATE TABLE "PublishJobStatusEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "publishJobId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "reasonCode" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublishJobStatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PublishJobStatusEvent_orgId_publishJobId_createdAt_idx"
  ON "PublishJobStatusEvent"("orgId", "publishJobId", "createdAt");
CREATE INDEX "PublishJobStatusEvent_orgId_toStatus_createdAt_idx"
  ON "PublishJobStatusEvent"("orgId", "toStatus", "createdAt");

ALTER TABLE "PublishJobStatusEvent"
  ADD CONSTRAINT "PublishJobStatusEvent_publishJobId_fkey"
  FOREIGN KEY ("publishJobId") REFERENCES "PublishJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
