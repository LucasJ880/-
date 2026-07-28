-- CreateTable
CREATE TABLE "MarketCompetitor" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "websiteUrl" TEXT NOT NULL,
    "normalizedDomain" TEXT NOT NULL,
    "targetGeography" TEXT,
    "primaryProduct" TEXT,
    "salesModel" TEXT DEFAULT '询价报价 + 预约量房',
    "watchFocus" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketCompetitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketMonitor" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'firecrawl',
    "providerMonitorId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'provisioning',
    "scheduleText" TEXT NOT NULL DEFAULT 'weekly',
    "scheduleCron" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "goal" TEXT NOT NULL,
    "targetUrls" JSONB NOT NULL,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastCheckId" TEXT,
    "lastError" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketMonitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "providerEventId" TEXT,
    "providerCheckId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "pageStatus" TEXT NOT NULL,
    "isMeaningful" BOOLEAN,
    "diffJson" JSONB,
    "snapshotJson" JSONB,
    "judgmentJson" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSignal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'low',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "evidenceJson" JSONB,
    "analysisStatus" TEXT NOT NULL DEFAULT 'queued',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketAnalysisRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "signalId" TEXT,
    "skillExecutionId" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'webhook',
    "status" TEXT NOT NULL DEFAULT 'running',
    "inputJson" JSONB,
    "outputMarkdown" TEXT,
    "error" VARCHAR(2000),
    "createdById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketAnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketCompetitor_orgId_normalizedDomain_key" ON "MarketCompetitor"("orgId", "normalizedDomain");
CREATE INDEX "MarketCompetitor_orgId_status_idx" ON "MarketCompetitor"("orgId", "status");
CREATE INDEX "MarketCompetitor_orgId_updatedAt_idx" ON "MarketCompetitor"("orgId", "updatedAt");
CREATE UNIQUE INDEX "MarketMonitor_providerMonitorId_key" ON "MarketMonitor"("providerMonitorId");
CREATE UNIQUE INDEX "MarketMonitor_competitorId_provider_key" ON "MarketMonitor"("competitorId", "provider");
CREATE INDEX "MarketMonitor_orgId_status_idx" ON "MarketMonitor"("orgId", "status");
CREATE INDEX "MarketMonitor_orgId_nextRunAt_idx" ON "MarketMonitor"("orgId", "nextRunAt");
CREATE UNIQUE INDEX "MarketSnapshot_monitorId_providerCheckId_urlHash_key" ON "MarketSnapshot"("monitorId", "providerCheckId", "urlHash");
CREATE INDEX "MarketSnapshot_orgId_capturedAt_idx" ON "MarketSnapshot"("orgId", "capturedAt");
CREATE INDEX "MarketSnapshot_monitorId_capturedAt_idx" ON "MarketSnapshot"("monitorId", "capturedAt");
CREATE UNIQUE INDEX "MarketSignal_snapshotId_key" ON "MarketSignal"("snapshotId");
CREATE INDEX "MarketSignal_orgId_status_createdAt_idx" ON "MarketSignal"("orgId", "status", "createdAt");
CREATE INDEX "MarketSignal_competitorId_createdAt_idx" ON "MarketSignal"("competitorId", "createdAt");
CREATE INDEX "MarketSignal_orgId_severity_createdAt_idx" ON "MarketSignal"("orgId", "severity", "createdAt");
CREATE INDEX "MarketAnalysisRun_orgId_createdAt_idx" ON "MarketAnalysisRun"("orgId", "createdAt");
CREATE INDEX "MarketAnalysisRun_competitorId_createdAt_idx" ON "MarketAnalysisRun"("competitorId", "createdAt");
CREATE INDEX "MarketAnalysisRun_signalId_createdAt_idx" ON "MarketAnalysisRun"("signalId", "createdAt");

-- AddForeignKey
ALTER TABLE "MarketCompetitor" ADD CONSTRAINT "MarketCompetitor_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketMonitor" ADD CONSTRAINT "MarketMonitor_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "MarketCompetitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketSnapshot" ADD CONSTRAINT "MarketSnapshot_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "MarketMonitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketSignal" ADD CONSTRAINT "MarketSignal_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "MarketSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketAnalysisRun" ADD CONSTRAINT "MarketAnalysisRun_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "MarketCompetitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketAnalysisRun" ADD CONSTRAINT "MarketAnalysisRun_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "MarketSignal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
