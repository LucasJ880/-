-- 人机协作与企业数字员工学习系统 Phase 1

CREATE TABLE "EmployeeAiProfile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleScope" TEXT NOT NULL DEFAULT 'general',
    "department" TEXT,
    "preferredLanguage" TEXT,
    "responseDetailLevel" TEXT,
    "preferredFormats" JSONB,
    "preferredChannels" JSONB,
    "schedulingPreferences" JSONB,
    "communicationStyle" JSONB,
    "approvalPreferences" JSONB,
    "personalTemplates" JSONB,
    "learnedPreferences" JSONB,
    "manuallyConfirmedPreferences" JSONB,
    "consentConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "consentConfirmedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeAiProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HumanFeedbackEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentRunId" TEXT,
    "skillExecutionId" TEXT,
    "pendingActionId" TEXT,
    "supervisorStepId" TEXT,
    "workerType" TEXT,
    "skillSlug" TEXT,
    "taskType" TEXT NOT NULL,
    "aiOutputRef" JSONB NOT NULL,
    "aiOutputSnapshot" JSONB,
    "humanDecision" TEXT NOT NULL,
    "humanEditedOutput" JSONB,
    "diffSummary" JSONB,
    "reasonCode" TEXT,
    "reasonText" TEXT,
    "feedbackScope" TEXT NOT NULL DEFAULT 'personal_only',
    "consentConfirmed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HumanFeedbackEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BusinessOutcome" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT,
    "feedbackEventId" TEXT,
    "pendingActionId" TEXT,
    "skillExecutionId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "actionOccurredAt" TIMESTAMP(3) NOT NULL,
    "outcomeType" TEXT NOT NULL,
    "outcomeValue" JSONB,
    "successSignals" JSONB,
    "failureSignals" JSONB,
    "revenueImpact" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "manuallyVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessOutcome_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CandidatePractice" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "roleScope" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "triggerConditions" JSONB,
    "recommendedProcess" JSONB,
    "exceptions" JSONB,
    "evidenceSummary" JSONB,
    "supportingFeedbackIds" JSONB,
    "supportingOutcomeIds" JSONB,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "generatedByRunId" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidatePractice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RolePlaybook" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "roleScope" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "rules" JSONB,
    "workflows" JSONB,
    "templates" JSONB,
    "exceptions" JSONB,
    "evidenceSummary" JSONB,
    "sourceCandidatePracticeIds" JSONB,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RolePlaybook_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentSkillVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "systemPromptHash" TEXT NOT NULL,
    "inputSchemaHash" TEXT,
    "outputSchemaHash" TEXT,
    "playbookVersionRefs" JSONB,
    "changeReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentSkillVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvaluationCase" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "inputFixture" JSONB NOT NULL,
    "expectedConstraints" JSONB,
    "expectedSignals" JSONB,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationCase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeeAiProfile_orgId_userId_key" ON "EmployeeAiProfile"("orgId", "userId");
CREATE INDEX "EmployeeAiProfile_orgId_department_idx" ON "EmployeeAiProfile"("orgId", "department");
CREATE INDEX "EmployeeAiProfile_userId_idx" ON "EmployeeAiProfile"("userId");

CREATE INDEX "HumanFeedbackEvent_orgId_userId_createdAt_idx" ON "HumanFeedbackEvent"("orgId", "userId", "createdAt");
CREATE INDEX "HumanFeedbackEvent_orgId_feedbackScope_createdAt_idx" ON "HumanFeedbackEvent"("orgId", "feedbackScope", "createdAt");
CREATE INDEX "HumanFeedbackEvent_orgId_skillSlug_createdAt_idx" ON "HumanFeedbackEvent"("orgId", "skillSlug", "createdAt");
CREATE INDEX "HumanFeedbackEvent_agentRunId_idx" ON "HumanFeedbackEvent"("agentRunId");
CREATE INDEX "HumanFeedbackEvent_pendingActionId_idx" ON "HumanFeedbackEvent"("pendingActionId");
CREATE INDEX "HumanFeedbackEvent_skillExecutionId_idx" ON "HumanFeedbackEvent"("skillExecutionId");

CREATE INDEX "BusinessOutcome_orgId_entityType_entityId_idx" ON "BusinessOutcome"("orgId", "entityType", "entityId");
CREATE INDEX "BusinessOutcome_orgId_outcomeType_createdAt_idx" ON "BusinessOutcome"("orgId", "outcomeType", "createdAt");
CREATE INDEX "BusinessOutcome_feedbackEventId_idx" ON "BusinessOutcome"("feedbackEventId");
CREATE INDEX "BusinessOutcome_pendingActionId_idx" ON "BusinessOutcome"("pendingActionId");

CREATE INDEX "CandidatePractice_orgId_status_department_idx" ON "CandidatePractice"("orgId", "status", "department");
CREATE INDEX "CandidatePractice_orgId_roleScope_idx" ON "CandidatePractice"("orgId", "roleScope");

CREATE UNIQUE INDEX "RolePlaybook_orgId_name_version_key" ON "RolePlaybook"("orgId", "name", "version");
CREATE INDEX "RolePlaybook_orgId_status_department_idx" ON "RolePlaybook"("orgId", "status", "department");
CREATE INDEX "RolePlaybook_orgId_roleScope_status_idx" ON "RolePlaybook"("orgId", "roleScope", "status");
CREATE INDEX "RolePlaybook_supersedesId_idx" ON "RolePlaybook"("supersedesId");

CREATE UNIQUE INDEX "AgentSkillVersion_skillId_version_key" ON "AgentSkillVersion"("skillId", "version");
CREATE INDEX "AgentSkillVersion_orgId_skillId_idx" ON "AgentSkillVersion"("orgId", "skillId");

CREATE INDEX "EvaluationCase_orgId_domain_taskType_idx" ON "EvaluationCase"("orgId", "domain", "taskType");
CREATE INDEX "EvaluationCase_orgId_approved_idx" ON "EvaluationCase"("orgId", "approved");

ALTER TABLE "EmployeeAiProfile" ADD CONSTRAINT "EmployeeAiProfile_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeAiProfile" ADD CONSTRAINT "EmployeeAiProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HumanFeedbackEvent" ADD CONSTRAINT "HumanFeedbackEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HumanFeedbackEvent" ADD CONSTRAINT "HumanFeedbackEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessOutcome" ADD CONSTRAINT "BusinessOutcome_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessOutcome" ADD CONSTRAINT "BusinessOutcome_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BusinessOutcome" ADD CONSTRAINT "BusinessOutcome_feedbackEventId_fkey" FOREIGN KEY ("feedbackEventId") REFERENCES "HumanFeedbackEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CandidatePractice" ADD CONSTRAINT "CandidatePractice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RolePlaybook" ADD CONSTRAINT "RolePlaybook_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentSkillVersion" ADD CONSTRAINT "AgentSkillVersion_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentSkillVersion" ADD CONSTRAINT "AgentSkillVersion_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "AgentSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EvaluationCase" ADD CONSTRAINT "EvaluationCase_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
