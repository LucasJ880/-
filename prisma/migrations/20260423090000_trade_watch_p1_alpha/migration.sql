-- P1-alpha: watch targets + page text change signals (decoupled from researchReport)

CREATE TABLE "TradeWatchTarget" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "prospectId" TEXT,
    "url" TEXT NOT NULL,
    "pageType" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastContentHash" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastChangedAt" TIMESTAMP(3),
    "lastFetchError" VARCHAR(500),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeWatchTarget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TradeSignal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "watchTargetId" TEXT NOT NULL,
    "prospectId" TEXT,
    "signalType" TEXT NOT NULL DEFAULT 'page_text_changed',
    "strength" TEXT NOT NULL DEFAULT 'low',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidenceJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeSignal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TradeWatchTarget_orgId_isActive_idx" ON "TradeWatchTarget"("orgId", "isActive");
CREATE INDEX "TradeWatchTarget_prospectId_idx" ON "TradeWatchTarget"("prospectId");

CREATE INDEX "TradeSignal_orgId_createdAt_idx" ON "TradeSignal"("orgId", "createdAt");
CREATE INDEX "TradeSignal_prospectId_createdAt_idx" ON "TradeSignal"("prospectId", "createdAt");
CREATE INDEX "TradeSignal_watchTargetId_createdAt_idx" ON "TradeSignal"("watchTargetId", "createdAt");

ALTER TABLE "TradeWatchTarget" ADD CONSTRAINT "TradeWatchTarget_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "TradeProspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TradeSignal" ADD CONSTRAINT "TradeSignal_watchTargetId_fkey" FOREIGN KEY ("watchTargetId") REFERENCES "TradeWatchTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
