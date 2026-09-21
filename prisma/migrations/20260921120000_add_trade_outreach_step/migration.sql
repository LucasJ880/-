-- 主动开发短序列：Day 1 / 3 / 7，cron 只起草，人审后才发

CREATE TABLE "TradeOutreachStep" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "dayOffset" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sequenceCategory" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "draftedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "subject" TEXT,
    "body" TEXT,
    "subjectZh" TEXT,
    "bodyZh" TEXT,
    "lastError" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeOutreachStep_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TradeOutreachStep_prospectId_dayOffset_key" ON "TradeOutreachStep"("prospectId", "dayOffset");
CREATE INDEX "TradeOutreachStep_orgId_status_scheduledAt_idx" ON "TradeOutreachStep"("orgId", "status", "scheduledAt");
CREATE INDEX "TradeOutreachStep_prospectId_status_idx" ON "TradeOutreachStep"("prospectId", "status");

ALTER TABLE "TradeOutreachStep" ADD CONSTRAINT "TradeOutreachStep_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "TradeProspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
