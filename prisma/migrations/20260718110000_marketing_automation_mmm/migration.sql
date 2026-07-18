-- Growth Center Phase 1.1: Activepieces execution boundary + Meridian MMM result store.

ALTER TABLE "MarketingMetricSnapshot"
ADD COLUMN "periodStart" TIMESTAMP(3),
ADD COLUMN "periodEnd" TIMESTAMP(3),
ADD COLUMN "granularity" TEXT NOT NULL DEFAULT 'snapshot',
ADD COLUMN "geography" TEXT,
ADD COLUMN "productCategory" TEXT,
ADD COLUMN "objective" TEXT,
ADD COLUMN "baseCurrency" TEXT NOT NULL DEFAULT 'CAD',
ADD COLUMN "ingestionKey" TEXT,
ADD COLUMN "externalEventId" TEXT,
ADD COLUMN "dataQualityStatus" TEXT NOT NULL DEFAULT 'unverified';

CREATE INDEX "MarketingMetricSnapshot_orgId_periodStart_granularity_idx"
ON "MarketingMetricSnapshot"("orgId", "periodStart", "granularity");

CREATE UNIQUE INDEX "MarketingMetricSnapshot_orgId_source_ingestionKey_key"
ON "MarketingMetricSnapshot"("orgId", "source", "ingestionKey");

CREATE TABLE "MarketingWorkflowRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'activepieces',
    "flowKey" TEXT NOT NULL,
    "externalRunId" TEXT,
    "requestId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "inputJson" JSONB,
    "outputJson" JSONB,
    "error" TEXT,
    "triggeredById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingWorkflowRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketingWorkflowRun_requestId_key" ON "MarketingWorkflowRun"("requestId");
CREATE UNIQUE INDEX "MarketingWorkflowRun_provider_externalRunId_key" ON "MarketingWorkflowRun"("provider", "externalRunId");
CREATE INDEX "MarketingWorkflowRun_orgId_flowKey_createdAt_idx" ON "MarketingWorkflowRun"("orgId", "flowKey", "createdAt");
CREATE INDEX "MarketingWorkflowRun_status_createdAt_idx" ON "MarketingWorkflowRun"("status", "createdAt");

CREATE TABLE "MmmDatasetVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "granularity" TEXT NOT NULL DEFAULT 'weekly',
    "targetKpi" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "weekCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "checksum" TEXT NOT NULL,
    "schemaJson" JSONB NOT NULL,
    "dataJson" JSONB NOT NULL,
    "qualityIssues" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MmmDatasetVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MmmDatasetVersion_orgId_createdAt_idx" ON "MmmDatasetVersion"("orgId", "createdAt");
CREATE UNIQUE INDEX "MmmDatasetVersion_orgId_checksum_key" ON "MmmDatasetVersion"("orgId", "checksum");

CREATE TABLE "MmmModelRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "datasetVersionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'meridian',
    "externalRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "modelVersion" TEXT,
    "configJson" JSONB,
    "diagnosticsJson" JSONB,
    "summaryJson" JSONB,
    "error" TEXT,
    "requestedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MmmModelRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MmmModelRun_provider_externalRunId_key" ON "MmmModelRun"("provider", "externalRunId");
CREATE INDEX "MmmModelRun_orgId_createdAt_idx" ON "MmmModelRun"("orgId", "createdAt");
CREATE INDEX "MmmModelRun_datasetVersionId_status_idx" ON "MmmModelRun"("datasetVersionId", "status");

CREATE TABLE "MmmChannelContribution" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "modelRunId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contribution" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contributionShare" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "roi" DOUBLE PRECISION,
    "marginalRoi" DOUBLE PRECISION,
    "confidenceLow" DOUBLE PRECISION,
    "confidenceHigh" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MmmChannelContribution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MmmChannelContribution_modelRunId_channel_key" ON "MmmChannelContribution"("modelRunId", "channel");
CREATE INDEX "MmmChannelContribution_orgId_channel_idx" ON "MmmChannelContribution"("orgId", "channel");

CREATE TABLE "MmmBudgetScenario" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "modelRunId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "totalBudget" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "allocationsJson" JSONB NOT NULL,
    "expectedKpi" DOUBLE PRECISION,
    "confidenceLow" DOUBLE PRECISION,
    "confidenceHigh" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MmmBudgetScenario_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MmmBudgetScenario_orgId_createdAt_idx" ON "MmmBudgetScenario"("orgId", "createdAt");
CREATE INDEX "MmmBudgetScenario_modelRunId_idx" ON "MmmBudgetScenario"("modelRunId");

ALTER TABLE "MmmModelRun"
ADD CONSTRAINT "MmmModelRun_datasetVersionId_fkey"
FOREIGN KEY ("datasetVersionId") REFERENCES "MmmDatasetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MmmChannelContribution"
ADD CONSTRAINT "MmmChannelContribution_modelRunId_fkey"
FOREIGN KEY ("modelRunId") REFERENCES "MmmModelRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MmmBudgetScenario"
ADD CONSTRAINT "MmmBudgetScenario_modelRunId_fkey"
FOREIGN KEY ("modelRunId") REFERENCES "MmmModelRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
