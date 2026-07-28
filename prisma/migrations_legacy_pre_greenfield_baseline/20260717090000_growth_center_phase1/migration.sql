-- CreateTable
CREATE TABLE "MarketingBrandProfile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "website" TEXT,
    "phone" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT,
    "postalCode" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "industry" TEXT NOT NULL,
    "productsJson" JSONB NOT NULL DEFAULT '[]',
    "serviceAreasJson" JSONB NOT NULL DEFAULT '[]',
    "targetAudiencesJson" JSONB NOT NULL DEFAULT '[]',
    "competitorsJson" JSONB NOT NULL DEFAULT '[]',
    "forbiddenContextsJson" JSONB NOT NULL DEFAULT '[]',
    "canonicalNapJson" JSONB,
    "validationStatus" TEXT NOT NULL DEFAULT 'draft',
    "validationScore" INTEGER NOT NULL DEFAULT 0,
    "validationIssues" JSONB NOT NULL DEFAULT '[]',
    "validatedAt" TIMESTAMP(3),
    "validatedById" TEXT,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingBrandProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingChannelAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "externalAccountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'manual',
    "providerConfig" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingChannelAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAuditRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "totalScore" INTEGER,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "profileValidationSnapshot" JSONB NOT NULL,
    "invalidReason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingAuditRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingDimensionScore" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "auditRunId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "grade" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 100,
    "evidenceJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingDimensionScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingFinding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "auditRunId" TEXT,
    "dimension" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "currentValue" TEXT,
    "expectedValue" TEXT,
    "evidenceUrl" TEXT,
    "evidenceJson" JSONB,
    "confidence" INTEGER NOT NULL DEFAULT 100,
    "status" TEXT NOT NULL DEFAULT 'open',
    "taskId" TEXT,
    "createdById" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingPlan" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingPlanItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "dayOffset" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'planned',
    "taskId" TEXT,
    "findingId" TEXT,
    "dueDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "product" TEXT,
    "geography" TEXT,
    "offer" TEXT,
    "primaryConversion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "budget" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingContentAsset" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contentPlanItemId" TEXT,
    "videoAssetId" TEXT,
    "assetType" TEXT NOT NULL DEFAULT 'video',
    "variantKey" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'draft',
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingContentAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingPublication" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contentAssetId" TEXT,
    "publishJobId" TEXT,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "externalPostId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingMetricSnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "channelAccountId" TEXT,
    "campaignId" TEXT,
    "publicationId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "engagements" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "qualifiedLeads" INTEGER NOT NULL DEFAULT 0,
    "appointments" INTEGER NOT NULL DEFAULT 0,
    "quotes" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "rawJson" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingExperiment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "primaryMetric" TEXT NOT NULL,
    "secondaryMetricsJson" JSONB NOT NULL DEFAULT '[]',
    "variantsJson" JSONB NOT NULL,
    "trafficAllocationJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "winnerVariantKey" TEXT,
    "learningSummary" TEXT,
    "stopCondition" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingLeadAttribution" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "salesOpportunityId" TEXT NOT NULL,
    "publicationId" TEXT,
    "attributionModel" TEXT NOT NULL DEFAULT 'manual',
    "confidence" INTEGER NOT NULL DEFAULT 100,
    "attributedRevenue" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingLeadAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingBrandProfile_orgId_key" ON "MarketingBrandProfile"("orgId");

-- CreateIndex
CREATE INDEX "MarketingBrandProfile_orgId_validationStatus_idx" ON "MarketingBrandProfile"("orgId", "validationStatus");

-- CreateIndex
CREATE INDEX "MarketingChannelAccount_orgId_status_idx" ON "MarketingChannelAccount"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingChannelAccount_orgId_provider_name_key" ON "MarketingChannelAccount"("orgId", "provider", "name");

-- CreateIndex
CREATE INDEX "MarketingAuditRun_orgId_createdAt_idx" ON "MarketingAuditRun"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingAuditRun_orgId_status_idx" ON "MarketingAuditRun"("orgId", "status");

-- CreateIndex
CREATE INDEX "MarketingDimensionScore_orgId_dimension_idx" ON "MarketingDimensionScore"("orgId", "dimension");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingDimensionScore_auditRunId_dimension_key" ON "MarketingDimensionScore"("auditRunId", "dimension");

-- CreateIndex
CREATE INDEX "MarketingFinding_orgId_status_severity_idx" ON "MarketingFinding"("orgId", "status", "severity");

-- CreateIndex
CREATE INDEX "MarketingFinding_orgId_dimension_idx" ON "MarketingFinding"("orgId", "dimension");

-- CreateIndex
CREATE INDEX "MarketingFinding_taskId_idx" ON "MarketingFinding"("taskId");

-- CreateIndex
CREATE INDEX "MarketingPlan_orgId_status_startDate_idx" ON "MarketingPlan"("orgId", "status", "startDate");

-- CreateIndex
CREATE INDEX "MarketingPlanItem_orgId_dueDate_idx" ON "MarketingPlanItem"("orgId", "dueDate");

-- CreateIndex
CREATE INDEX "MarketingPlanItem_planId_dayOffset_idx" ON "MarketingPlanItem"("planId", "dayOffset");

-- CreateIndex
CREATE INDEX "MarketingCampaign_orgId_status_createdAt_idx" ON "MarketingCampaign"("orgId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingContentAsset_orgId_campaignId_idx" ON "MarketingContentAsset"("orgId", "campaignId");

-- CreateIndex
CREATE INDEX "MarketingContentAsset_contentPlanItemId_idx" ON "MarketingContentAsset"("contentPlanItemId");

-- CreateIndex
CREATE INDEX "MarketingContentAsset_videoAssetId_idx" ON "MarketingContentAsset"("videoAssetId");

-- CreateIndex
CREATE INDEX "MarketingPublication_orgId_campaignId_status_idx" ON "MarketingPublication"("orgId", "campaignId", "status");

-- CreateIndex
CREATE INDEX "MarketingPublication_publishJobId_idx" ON "MarketingPublication"("publishJobId");

-- CreateIndex
CREATE INDEX "MarketingMetricSnapshot_orgId_capturedAt_idx" ON "MarketingMetricSnapshot"("orgId", "capturedAt");

-- CreateIndex
CREATE INDEX "MarketingMetricSnapshot_orgId_campaignId_idx" ON "MarketingMetricSnapshot"("orgId", "campaignId");

-- CreateIndex
CREATE INDEX "MarketingExperiment_orgId_status_idx" ON "MarketingExperiment"("orgId", "status");

-- CreateIndex
CREATE INDEX "MarketingExperiment_campaignId_idx" ON "MarketingExperiment"("campaignId");

-- CreateIndex
CREATE INDEX "MarketingLeadAttribution_orgId_salesOpportunityId_idx" ON "MarketingLeadAttribution"("orgId", "salesOpportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingLeadAttribution_orgId_campaignId_salesOpportunityI_key" ON "MarketingLeadAttribution"("orgId", "campaignId", "salesOpportunityId");

-- AddForeignKey
ALTER TABLE "MarketingDimensionScore" ADD CONSTRAINT "MarketingDimensionScore_auditRunId_fkey" FOREIGN KEY ("auditRunId") REFERENCES "MarketingAuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingFinding" ADD CONSTRAINT "MarketingFinding_auditRunId_fkey" FOREIGN KEY ("auditRunId") REFERENCES "MarketingAuditRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPlanItem" ADD CONSTRAINT "MarketingPlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MarketingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContentAsset" ADD CONSTRAINT "MarketingContentAsset_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPublication" ADD CONSTRAINT "MarketingPublication_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingExperiment" ADD CONSTRAINT "MarketingExperiment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingLeadAttribution" ADD CONSTRAINT "MarketingLeadAttribution_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
