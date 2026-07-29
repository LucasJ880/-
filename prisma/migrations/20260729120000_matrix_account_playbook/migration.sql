-- Phase B: Matrix account groups + versioned playbooks
-- Compatible: groupId nullable; legacy groupName/personaNotes untouched.

-- CreateTable
CREATE TABLE "MatrixAccountGroup" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatrixAccountGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatrixGroupPlaybook" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "basedOnVersion" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "isEffective" BOOLEAN NOT NULL DEFAULT false,
    "completenessScore" INTEGER NOT NULL DEFAULT 0,
    "validationResult" TEXT NOT NULL DEFAULT 'unchecked',
    "validationIssues" JSONB NOT NULL DEFAULT '[]',
    "accountRole" TEXT,
    "businessObjective" TEXT,
    "positioning" TEXT,
    "personaBackground" TEXT,
    "personality" TEXT,
    "toneOfVoice" TEXT,
    "operatingLanguage" TEXT,
    "operatingRegion" TEXT,
    "primaryProducts" TEXT,
    "targetAudienceJson" JSONB,
    "contentPillarsJson" JSONB,
    "contentMixJson" JSONB,
    "visualStyleJson" JSONB,
    "postingRulesJson" JSONB,
    "ctaStrategyJson" JSONB,
    "conversionPathJson" JSONB,
    "kpiTargetsJson" JSONB,
    "forbiddenTopicsJson" JSONB,
    "exampleContentJson" JSONB,
    "mergeRulesJson" JSONB,
    "changeSummary" TEXT,
    "rejectedReason" TEXT,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatrixGroupPlaybook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatrixAccountPlaybook" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "basedOnVersion" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "isEffective" BOOLEAN NOT NULL DEFAULT false,
    "completenessScore" INTEGER NOT NULL DEFAULT 0,
    "validationResult" TEXT NOT NULL DEFAULT 'unchecked',
    "validationIssues" JSONB NOT NULL DEFAULT '[]',
    "accountRole" TEXT,
    "businessObjective" TEXT,
    "positioning" TEXT,
    "personaBackground" TEXT,
    "personality" TEXT,
    "toneOfVoice" TEXT,
    "operatingLanguage" TEXT,
    "operatingRegion" TEXT,
    "primaryProducts" TEXT,
    "targetAudienceJson" JSONB,
    "contentPillarsJson" JSONB,
    "contentMixJson" JSONB,
    "visualStyleJson" JSONB,
    "postingRulesJson" JSONB,
    "ctaStrategyJson" JSONB,
    "conversionPathJson" JSONB,
    "kpiTargetsJson" JSONB,
    "forbiddenTopicsJson" JSONB,
    "exampleContentJson" JSONB,
    "overridesJson" JSONB,
    "changeSummary" TEXT,
    "rejectedReason" TEXT,
    "aiDraftMetaJson" JSONB,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatrixAccountPlaybook_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "MatrixAccount" ADD COLUMN "groupId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MatrixAccountGroup_orgId_groupKey_key" ON "MatrixAccountGroup"("orgId", "groupKey");
CREATE INDEX "MatrixAccountGroup_orgId_idx" ON "MatrixAccountGroup"("orgId");

CREATE UNIQUE INDEX "MatrixGroupPlaybook_groupId_version_key" ON "MatrixGroupPlaybook"("groupId", "version");
CREATE INDEX "MatrixGroupPlaybook_orgId_groupId_status_idx" ON "MatrixGroupPlaybook"("orgId", "groupId", "status");
CREATE INDEX "MatrixGroupPlaybook_orgId_groupId_isEffective_idx" ON "MatrixGroupPlaybook"("orgId", "groupId", "isEffective");

CREATE UNIQUE INDEX "MatrixAccountPlaybook_accountId_version_key" ON "MatrixAccountPlaybook"("accountId", "version");
CREATE INDEX "MatrixAccountPlaybook_orgId_accountId_status_idx" ON "MatrixAccountPlaybook"("orgId", "accountId", "status");
CREATE INDEX "MatrixAccountPlaybook_orgId_accountId_isEffective_idx" ON "MatrixAccountPlaybook"("orgId", "accountId", "isEffective");
CREATE INDEX "MatrixAccountPlaybook_orgId_status_idx" ON "MatrixAccountPlaybook"("orgId", "status");

CREATE INDEX "MatrixAccount_orgId_groupId_idx" ON "MatrixAccount"("orgId", "groupId");

-- AddForeignKey
ALTER TABLE "MatrixAccount" ADD CONSTRAINT "MatrixAccount_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "MatrixAccountGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MatrixGroupPlaybook" ADD CONSTRAINT "MatrixGroupPlaybook_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "MatrixAccountGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatrixAccountPlaybook" ADD CONSTRAINT "MatrixAccountPlaybook_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MatrixAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
