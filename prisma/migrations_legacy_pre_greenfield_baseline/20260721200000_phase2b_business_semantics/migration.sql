-- Phase 2B: Glossary / Business Objects / Metrics / Workspace Skill & Knowledge bindings

CREATE TABLE IF NOT EXISTS "OrganizationGlossaryTerm" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "scopeKey" TEXT NOT NULL DEFAULT 'org',
    "canonicalTerm" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "aliasesJson" JSONB NOT NULL DEFAULT '[]',
    "category" TEXT NOT NULL DEFAULT 'general',
    "language" TEXT NOT NULL DEFAULT 'zh',
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationGlossaryTerm_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationGlossaryTerm_orgId_scopeKey_canonicalTerm_language_key"
  ON "OrganizationGlossaryTerm"("orgId", "scopeKey", "canonicalTerm", "language");
CREATE INDEX IF NOT EXISTS "OrganizationGlossaryTerm_orgId_status_idx"
  ON "OrganizationGlossaryTerm"("orgId", "status");
CREATE INDEX IF NOT EXISTS "OrganizationGlossaryTerm_orgId_workspaceId_status_idx"
  ON "OrganizationGlossaryTerm"("orgId", "workspaceId", "status");

CREATE TABLE IF NOT EXISTS "BusinessObjectDefinition" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "industryPackId" TEXT,
    "objectKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "aliasesJson" JSONB NOT NULL DEFAULT '[]',
    "sourceModel" TEXT,
    "idField" TEXT DEFAULT 'id',
    "statusField" TEXT,
    "allowedStatusesJson" JSONB,
    "relationDefinitionsJson" JSONB,
    "riskFieldsJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessObjectDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BusinessObjectDefinition_orgId_objectKey_key"
  ON "BusinessObjectDefinition"("orgId", "objectKey");
CREATE INDEX IF NOT EXISTS "BusinessObjectDefinition_orgId_status_idx"
  ON "BusinessObjectDefinition"("orgId", "status");
CREATE INDEX IF NOT EXISTS "BusinessObjectDefinition_orgId_workspaceId_idx"
  ON "BusinessObjectDefinition"("orgId", "workspaceId");

CREATE TABLE IF NOT EXISTS "BusinessMetricDefinition" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'operations',
    "unit" TEXT NOT NULL DEFAULT 'count',
    "direction" TEXT NOT NULL DEFAULT 'higher_better',
    "sourceType" TEXT NOT NULL DEFAULT 'query',
    "sourceConfigJson" JSONB NOT NULL DEFAULT '{}',
    "warningThresholdJson" JSONB,
    "targetValueJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessMetricDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BusinessMetricDefinition_orgId_key_key"
  ON "BusinessMetricDefinition"("orgId", "key");
CREATE INDEX IF NOT EXISTS "BusinessMetricDefinition_orgId_status_displayOrder_idx"
  ON "BusinessMetricDefinition"("orgId", "status", "displayOrder");

CREATE TABLE IF NOT EXISTS "WorkspaceSkillBinding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "skillKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "paramsJson" JSONB,
    "allowOrgRolesJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceSkillBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceSkillBinding_workspaceId_skillKey_key"
  ON "WorkspaceSkillBinding"("workspaceId", "skillKey");
CREATE INDEX IF NOT EXISTS "WorkspaceSkillBinding_orgId_workspaceId_idx"
  ON "WorkspaceSkillBinding"("orgId", "workspaceId");

CREATE TABLE IF NOT EXISTS "WorkspaceKnowledgeBinding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceKnowledgeBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceKnowledgeBinding_workspaceId_knowledgeBaseId_key"
  ON "WorkspaceKnowledgeBinding"("workspaceId", "knowledgeBaseId");
CREATE INDEX IF NOT EXISTS "WorkspaceKnowledgeBinding_orgId_workspaceId_idx"
  ON "WorkspaceKnowledgeBinding"("orgId", "workspaceId");

-- FKs
DO $$ BEGIN
  ALTER TABLE "OrganizationGlossaryTerm" ADD CONSTRAINT "OrganizationGlossaryTerm_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OrganizationGlossaryTerm" ADD CONSTRAINT "OrganizationGlossaryTerm_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BusinessObjectDefinition" ADD CONSTRAINT "BusinessObjectDefinition_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BusinessObjectDefinition" ADD CONSTRAINT "BusinessObjectDefinition_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BusinessMetricDefinition" ADD CONSTRAINT "BusinessMetricDefinition_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BusinessMetricDefinition" ADD CONSTRAINT "BusinessMetricDefinition_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "WorkspaceSkillBinding" ADD CONSTRAINT "WorkspaceSkillBinding_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "WorkspaceSkillBinding" ADD CONSTRAINT "WorkspaceSkillBinding_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "WorkspaceKnowledgeBinding" ADD CONSTRAINT "WorkspaceKnowledgeBinding_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "WorkspaceKnowledgeBinding" ADD CONSTRAINT "WorkspaceKnowledgeBinding_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
