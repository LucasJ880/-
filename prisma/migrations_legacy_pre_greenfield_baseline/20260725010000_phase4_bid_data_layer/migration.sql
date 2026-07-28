-- Phase 4A-1: Formal Bid Data Layer
-- CreateTable
CREATE TABLE "BidDataRevision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sourceRootTaskId" TEXT,
    "sourceTenderRunId" TEXT,
    "sourceProductRunId" TEXT,
    "sourceComplianceRunId" TEXT,
    "sourcePricingRunId" TEXT,
    "sourceDocumentQaRunId" TEXT,
    "projectionVersion" TEXT NOT NULL,
    "projectionHash" TEXT NOT NULL,
    "technicalReadiness" TEXT NOT NULL DEFAULT 'BLOCKED',
    "financialReadiness" TEXT NOT NULL DEFAULT 'BLOCKED',
    "blockingIssueCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "issuesJson" JSONB,
    "origin" TEXT NOT NULL DEFAULT 'AGENT_PROJECTION',
    "createdByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "approvedByUserId" TEXT,
    "lockedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "supersedesRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidDataRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderRequirement" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "bidDataRevisionId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "requirementNumber" TEXT,
    "title" TEXT,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "requirementText" TEXT NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "evaluationType" TEXT NOT NULL DEFAULT 'OTHER',
    "comparator" TEXT,
    "expectedValueJson" JSONB,
    "unit" TEXT,
    "sourceDocumentId" TEXT,
    "sourcePage" INTEGER,
    "sourceExcerpt" TEXT,
    "sourceAgentTaskId" TEXT,
    "sourceAgentRunId" TEXT,
    "confidence" DOUBLE PRECISION,
    "reviewStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenderRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductEvidence" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "bidDataRevisionId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "factKey" TEXT,
    "manufacturerName" TEXT,
    "productName" TEXT,
    "productModel" TEXT,
    "displayValue" TEXT NOT NULL,
    "valueJson" JSONB,
    "unit" TEXT,
    "evidenceType" TEXT NOT NULL DEFAULT 'AI_EXTRACTION',
    "evidenceStrength" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "confirmationStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "usageScopes" JSONB NOT NULL DEFAULT '[]',
    "sourceProjectFactId" TEXT,
    "sourceDocumentId" TEXT,
    "sourceMessageId" TEXT,
    "sourcePage" INTEGER,
    "sourceExcerpt" TEXT,
    "sourceAgentTaskId" TEXT,
    "sourceAgentRunId" TEXT,
    "certificateNumber" TEXT,
    "standard" TEXT,
    "applicableModel" TEXT,
    "confidence" DOUBLE PRECISION,
    "reviewStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceResponse" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "bidDataRevisionId" TEXT NOT NULL,
    "tenderRequirementId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "proposedResponse" TEXT,
    "rationale" TEXT,
    "riskLevel" TEXT,
    "confidence" DOUBLE PRECISION,
    "reviewStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "sourceAgentTaskId" TEXT,
    "sourceAgentRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceResponseEvidence" (
    "id" TEXT NOT NULL,
    "complianceResponseId" TEXT NOT NULL,
    "productEvidenceId" TEXT NOT NULL,
    "relevance" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "mappingReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceResponseEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingScenario" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "bidDataRevisionId" TEXT NOT NULL,
    "scenarioNumber" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "readiness" TEXT NOT NULL DEFAULT 'BLOCKED',
    "quantity" DECIMAL(18,6),
    "outputCurrency" TEXT,
    "factoryCostCurrency" TEXT,
    "exchangeRate" DECIMAL(18,8),
    "exchangeRateBaseCurrency" TEXT,
    "exchangeRateQuoteCurrency" TEXT,
    "marginMethod" TEXT,
    "targetRate" DECIMAL(18,8),
    "totalCost" DECIMAL(18,6),
    "unitSellingPrice" DECIMAL(18,6),
    "totalSellingPrice" DECIMAL(18,6),
    "calculationVersion" TEXT,
    "sourcePricingRunId" TEXT,
    "createdByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "approvedByUserId" TEXT,
    "lockedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingScenarioLineItem" (
    "id" TEXT NOT NULL,
    "pricingScenarioId" TEXT NOT NULL,
    "lineType" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(18,6),
    "unitCost" DECIMAL(18,6),
    "currency" TEXT,
    "exchangeRate" DECIMAL(18,8),
    "amountInOutputCurrency" DECIMAL(18,6),
    "includedInTotal" BOOLEAN NOT NULL DEFAULT false,
    "sourceProjectFactId" TEXT,
    "sourceDocumentId" TEXT,
    "sourceMessageId" TEXT,
    "sourceAgentRunId" TEXT,
    "confirmationStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "reviewStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingScenarioLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BidDataRevision_projectId_revisionNumber_key" ON "BidDataRevision"("projectId", "revisionNumber");
CREATE UNIQUE INDEX "BidDataRevision_projectId_projectionHash_key" ON "BidDataRevision"("projectId", "projectionHash");
CREATE INDEX "BidDataRevision_projectId_status_idx" ON "BidDataRevision"("projectId", "status");
CREATE INDEX "BidDataRevision_projectId_createdAt_idx" ON "BidDataRevision"("projectId", "createdAt");
CREATE INDEX "BidDataRevision_sourceRootTaskId_idx" ON "BidDataRevision"("sourceRootTaskId");
CREATE INDEX "BidDataRevision_status_idx" ON "BidDataRevision"("status");

CREATE UNIQUE INDEX "TenderRequirement_bidDataRevisionId_stableKey_key" ON "TenderRequirement"("bidDataRevisionId", "stableKey");
CREATE INDEX "TenderRequirement_projectId_idx" ON "TenderRequirement"("projectId");
CREATE INDEX "TenderRequirement_bidDataRevisionId_idx" ON "TenderRequirement"("bidDataRevisionId");
CREATE INDEX "TenderRequirement_sourceDocumentId_idx" ON "TenderRequirement"("sourceDocumentId");
CREATE INDEX "TenderRequirement_sourceAgentRunId_idx" ON "TenderRequirement"("sourceAgentRunId");
CREATE INDEX "TenderRequirement_category_idx" ON "TenderRequirement"("category");
CREATE INDEX "TenderRequirement_reviewStatus_idx" ON "TenderRequirement"("reviewStatus");

CREATE UNIQUE INDEX "ProductEvidence_bidDataRevisionId_stableKey_key" ON "ProductEvidence"("bidDataRevisionId", "stableKey");
CREATE INDEX "ProductEvidence_projectId_idx" ON "ProductEvidence"("projectId");
CREATE INDEX "ProductEvidence_bidDataRevisionId_idx" ON "ProductEvidence"("bidDataRevisionId");
CREATE INDEX "ProductEvidence_factKey_idx" ON "ProductEvidence"("factKey");
CREATE INDEX "ProductEvidence_sourceDocumentId_idx" ON "ProductEvidence"("sourceDocumentId");
CREATE INDEX "ProductEvidence_sourceAgentRunId_idx" ON "ProductEvidence"("sourceAgentRunId");
CREATE INDEX "ProductEvidence_sourceProjectFactId_idx" ON "ProductEvidence"("sourceProjectFactId");
CREATE INDEX "ProductEvidence_confirmationStatus_idx" ON "ProductEvidence"("confirmationStatus");
CREATE INDEX "ProductEvidence_reviewStatus_idx" ON "ProductEvidence"("reviewStatus");

CREATE UNIQUE INDEX "ComplianceResponse_bidDataRevisionId_tenderRequirementId_key" ON "ComplianceResponse"("bidDataRevisionId", "tenderRequirementId");
CREATE UNIQUE INDEX "ComplianceResponse_bidDataRevisionId_stableKey_key" ON "ComplianceResponse"("bidDataRevisionId", "stableKey");
CREATE INDEX "ComplianceResponse_projectId_idx" ON "ComplianceResponse"("projectId");
CREATE INDEX "ComplianceResponse_bidDataRevisionId_idx" ON "ComplianceResponse"("bidDataRevisionId");
CREATE INDEX "ComplianceResponse_tenderRequirementId_idx" ON "ComplianceResponse"("tenderRequirementId");
CREATE INDEX "ComplianceResponse_status_idx" ON "ComplianceResponse"("status");
CREATE INDEX "ComplianceResponse_sourceAgentRunId_idx" ON "ComplianceResponse"("sourceAgentRunId");
CREATE INDEX "ComplianceResponse_reviewStatus_idx" ON "ComplianceResponse"("reviewStatus");

CREATE UNIQUE INDEX "ComplianceResponseEvidence_complianceResponseId_productEvidenceId_key" ON "ComplianceResponseEvidence"("complianceResponseId", "productEvidenceId");
CREATE INDEX "ComplianceResponseEvidence_complianceResponseId_idx" ON "ComplianceResponseEvidence"("complianceResponseId");
CREATE INDEX "ComplianceResponseEvidence_productEvidenceId_idx" ON "ComplianceResponseEvidence"("productEvidenceId");

CREATE UNIQUE INDEX "PricingScenario_bidDataRevisionId_scenarioNumber_key" ON "PricingScenario"("bidDataRevisionId", "scenarioNumber");
CREATE INDEX "PricingScenario_projectId_idx" ON "PricingScenario"("projectId");
CREATE INDEX "PricingScenario_bidDataRevisionId_idx" ON "PricingScenario"("bidDataRevisionId");
CREATE INDEX "PricingScenario_status_idx" ON "PricingScenario"("status");
CREATE INDEX "PricingScenario_sourcePricingRunId_idx" ON "PricingScenario"("sourcePricingRunId");

CREATE INDEX "PricingScenarioLineItem_pricingScenarioId_idx" ON "PricingScenarioLineItem"("pricingScenarioId");
CREATE INDEX "PricingScenarioLineItem_lineType_idx" ON "PricingScenarioLineItem"("lineType");
CREATE INDEX "PricingScenarioLineItem_sourceProjectFactId_idx" ON "PricingScenarioLineItem"("sourceProjectFactId");
CREATE INDEX "PricingScenarioLineItem_sourceAgentRunId_idx" ON "PricingScenarioLineItem"("sourceAgentRunId");
CREATE INDEX "PricingScenarioLineItem_confirmationStatus_idx" ON "PricingScenarioLineItem"("confirmationStatus");

-- AddForeignKey
ALTER TABLE "BidDataRevision" ADD CONSTRAINT "BidDataRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BidDataRevision" ADD CONSTRAINT "BidDataRevision_supersedesRevisionId_fkey" FOREIGN KEY ("supersedesRevisionId") REFERENCES "BidDataRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TenderRequirement" ADD CONSTRAINT "TenderRequirement_bidDataRevisionId_fkey" FOREIGN KEY ("bidDataRevisionId") REFERENCES "BidDataRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductEvidence" ADD CONSTRAINT "ProductEvidence_bidDataRevisionId_fkey" FOREIGN KEY ("bidDataRevisionId") REFERENCES "BidDataRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ComplianceResponse" ADD CONSTRAINT "ComplianceResponse_bidDataRevisionId_fkey" FOREIGN KEY ("bidDataRevisionId") REFERENCES "BidDataRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComplianceResponse" ADD CONSTRAINT "ComplianceResponse_tenderRequirementId_fkey" FOREIGN KEY ("tenderRequirementId") REFERENCES "TenderRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ComplianceResponseEvidence" ADD CONSTRAINT "ComplianceResponseEvidence_complianceResponseId_fkey" FOREIGN KEY ("complianceResponseId") REFERENCES "ComplianceResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComplianceResponseEvidence" ADD CONSTRAINT "ComplianceResponseEvidence_productEvidenceId_fkey" FOREIGN KEY ("productEvidenceId") REFERENCES "ProductEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PricingScenario" ADD CONSTRAINT "PricingScenario_bidDataRevisionId_fkey" FOREIGN KEY ("bidDataRevisionId") REFERENCES "BidDataRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PricingScenarioLineItem" ADD CONSTRAINT "PricingScenarioLineItem_pricingScenarioId_fkey" FOREIGN KEY ("pricingScenarioId") REFERENCES "PricingScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
