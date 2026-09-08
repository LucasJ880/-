-- Mengxin FDE V1 — Revenue Spine（纯增量迁移，无破坏性变更）
--
-- 内容：
--   SalesCustomer      +contactName/website/country + 去重键 emailDomain/normalizedName（+2 索引）
--   SalesOpportunity   +canonical 阶段时间 / Next Action 引擎 / 评分缓存 / FDE 归因字段（+2 索引）
--   SalesAction        +FDE 行动追踪字段（employeeKey/inputContext/recommendedAction/approval/execution）（+3 索引）
--   BusinessOutcome    +salesActionId（Action → Outcome 关联）（+1 索引）
--   新表 SalesRfq / SalesRfqEvidence / SalesOpportunityAssessment
--
-- 所有新增列均可空或带默认值；不删除、不重命名、不改类型；对 Sunny 现有数据零影响。
-- 生成方式：prisma migrate diff --from-schema-datamodel <origin/main> --to-schema-datamodel prisma/schema.prisma --script

-- AlterTable
ALTER TABLE "SalesCustomer" ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "emailDomain" TEXT,
ADD COLUMN     "normalizedName" TEXT,
ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "SalesOpportunity" ADD COLUMN     "buyerType" TEXT,
ADD COLUMN     "fdeInfluenced" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fdeSourced" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "firstFdeActionId" TEXT,
ADD COLUMN     "followUpCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastCustomerReplyAt" TIMESTAMP(3),
ADD COLUMN     "lastFdeActionId" TEXT,
ADD COLUMN     "lastInteractionAt" TIMESTAMP(3),
ADD COLUMN     "lastOutboundAt" TIMESTAMP(3),
ADD COLUMN     "market" TEXT,
ADD COLUMN     "nextActionReason" TEXT,
ADD COLUMN     "nextActionType" TEXT,
ADD COLUMN     "score" INTEGER,
ADD COLUMN     "scoreGrade" TEXT,
ADD COLUMN     "scoredAt" TIMESTAMP(3),
ADD COLUMN     "stageChangedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SalesAction" ADD COLUMN     "actionType" TEXT,
ADD COLUMN     "agentRunId" TEXT,
ADD COLUMN     "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "employeeKey" TEXT,
ADD COLUMN     "executedAt" TIMESTAMP(3),
ADD COLUMN     "inputContext" JSONB,
ADD COLUMN     "interactionId" TEXT,
ADD COLUMN     "pendingActionId" TEXT,
ADD COLUMN     "recommendedAction" JSONB,
ADD COLUMN     "resultJson" JSONB;

-- AlterTable
ALTER TABLE "BusinessOutcome" ADD COLUMN     "salesActionId" TEXT;

-- CreateTable
CREATE TABLE "SalesRfq" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "productCategory" TEXT,
    "productName" TEXT,
    "material" TEXT,
    "composition" TEXT,
    "size" TEXT,
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,
    "color" TEXT,
    "customLogo" BOOLEAN,
    "customization" TEXT,
    "packaging" TEXT,
    "certification" TEXT,
    "sampleRequired" BOOLEAN,
    "targetPrice" DOUBLE PRECISION,
    "currency" TEXT,
    "destinationCountry" TEXT,
    "destinationCity" TEXT,
    "incoterm" TEXT,
    "requiredDeliveryDate" TIMESTAMP(3),
    "buyerType" TEXT,
    "application" TEXT,
    "missingFields" JSONB,
    "notes" TEXT,
    "language" TEXT,
    "extractionMethod" TEXT,
    "extractedAt" TIMESTAMP(3),
    "agentRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesRfq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesRfqEvidence" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "sourceInteractionId" TEXT,
    "sourceKind" TEXT NOT NULL,
    "evidenceText" TEXT,
    "extractedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesRfqEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOpportunityAssessment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "score" INTEGER NOT NULL,
    "grade" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "dimensionsJson" JSONB NOT NULL,
    "reasoning" TEXT NOT NULL,
    "missingInformation" JSONB,
    "recommendedNextAction" TEXT,
    "policyVersion" TEXT NOT NULL,
    "agentRunId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesOpportunityAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesRfq_opportunityId_key" ON "SalesRfq"("opportunityId");

-- CreateIndex
CREATE INDEX "SalesRfq_orgId_status_idx" ON "SalesRfq"("orgId", "status");

-- CreateIndex
CREATE INDEX "SalesRfq_customerId_idx" ON "SalesRfq"("customerId");

-- CreateIndex
CREATE INDEX "SalesRfqEvidence_rfqId_field_idx" ON "SalesRfqEvidence"("rfqId", "field");

-- CreateIndex
CREATE INDEX "SalesRfqEvidence_opportunityId_idx" ON "SalesRfqEvidence"("opportunityId");

-- CreateIndex
CREATE INDEX "SalesRfqEvidence_sourceInteractionId_idx" ON "SalesRfqEvidence"("sourceInteractionId");

-- CreateIndex
CREATE INDEX "SalesOpportunityAssessment_opportunityId_createdAt_idx" ON "SalesOpportunityAssessment"("opportunityId", "createdAt");

-- CreateIndex
CREATE INDEX "SalesOpportunityAssessment_orgId_grade_idx" ON "SalesOpportunityAssessment"("orgId", "grade");

-- CreateIndex
CREATE INDEX "SalesCustomer_orgId_emailDomain_idx" ON "SalesCustomer"("orgId", "emailDomain");

-- CreateIndex
CREATE INDEX "SalesCustomer_orgId_normalizedName_idx" ON "SalesCustomer"("orgId", "normalizedName");

-- CreateIndex
CREATE INDEX "SalesOpportunity_orgId_stage_idx" ON "SalesOpportunity"("orgId", "stage");

-- CreateIndex
CREATE INDEX "SalesOpportunity_orgId_nextFollowupAt_idx" ON "SalesOpportunity"("orgId", "nextFollowupAt");

-- CreateIndex
CREATE INDEX "SalesAction_pendingActionId_idx" ON "SalesAction"("pendingActionId");

-- CreateIndex
CREATE INDEX "SalesAction_agentRunId_idx" ON "SalesAction"("agentRunId");

-- CreateIndex
CREATE INDEX "SalesAction_orgId_employeeKey_status_idx" ON "SalesAction"("orgId", "employeeKey", "status");

-- CreateIndex
CREATE INDEX "BusinessOutcome_salesActionId_idx" ON "BusinessOutcome"("salesActionId");

-- AddForeignKey
ALTER TABLE "SalesRfq" ADD CONSTRAINT "SalesRfq_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "SalesOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesRfqEvidence" ADD CONSTRAINT "SalesRfqEvidence_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "SalesRfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOpportunityAssessment" ADD CONSTRAINT "SalesOpportunityAssessment_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "SalesOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

