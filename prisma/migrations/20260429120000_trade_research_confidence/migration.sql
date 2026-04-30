-- P1-B: 研究可信度与 website candidates

ALTER TABLE "TradeProspect" ADD COLUMN "websiteCandidates" JSONB;
ALTER TABLE "TradeProspect" ADD COLUMN "websiteConfidence" DOUBLE PRECISION;
ALTER TABLE "TradeProspect" ADD COLUMN "websiteCandidateSource" TEXT;
ALTER TABLE "TradeProspect" ADD COLUMN "websiteVerifiedAt" TIMESTAMP(3);
ALTER TABLE "TradeProspect" ADD COLUMN "websiteVerifiedBy" TEXT;
ALTER TABLE "TradeProspect" ADD COLUMN "researchStatus" TEXT;
ALTER TABLE "TradeProspect" ADD COLUMN "researchWarnings" JSONB;
ALTER TABLE "TradeProspect" ADD COLUMN "crawlStatus" TEXT;
ALTER TABLE "TradeProspect" ADD COLUMN "crawlSourceType" TEXT;
ALTER TABLE "TradeProspect" ADD COLUMN "sourcesCount" INTEGER;
ALTER TABLE "TradeProspect" ADD COLUMN "lastResearchError" VARCHAR(2000);
ALTER TABLE "TradeProspect" ADD COLUMN "lastResearchedAt" TIMESTAMP(3);

CREATE INDEX "TradeProspect_orgId_researchStatus_idx" ON "TradeProspect"("orgId", "researchStatus");
