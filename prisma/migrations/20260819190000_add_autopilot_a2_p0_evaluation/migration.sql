-- Autopilot A2-P0: deterministic evaluation records.
-- ADDITIVE ONLY. Does not alter AgentRun / AgentRunEvent / AutopilotRun / Outbox.
-- Does not enable LLM Judge / Monitor / Optimizer / Production activation.
-- Do not run against production from this PR.

-- CreateTable
CREATE TABLE "AutopilotEvaluation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "autopilotRunId" TEXT,
    "evaluatorKind" TEXT NOT NULL,
    "evaluatorVersion" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "failureType" TEXT,
    "failureSource" TEXT,
    "judged" BOOLEAN NOT NULL DEFAULT false,
    "ruleId" TEXT NOT NULL,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutopilotEvaluation_agentRunId_evaluatorVersion_key" ON "AutopilotEvaluation"("agentRunId", "evaluatorVersion");

-- CreateIndex
CREATE INDEX "AutopilotEvaluation_orgId_updatedAt_idx" ON "AutopilotEvaluation"("orgId", "updatedAt");

-- CreateIndex
CREATE INDEX "AutopilotEvaluation_orgId_outcome_idx" ON "AutopilotEvaluation"("orgId", "outcome");

-- CreateIndex
CREATE INDEX "AutopilotEvaluation_orgId_agentRunId_idx" ON "AutopilotEvaluation"("orgId", "agentRunId");

-- AddForeignKey
ALTER TABLE "AutopilotEvaluation" ADD CONSTRAINT "AutopilotEvaluation_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopilotEvaluation" ADD CONSTRAINT "AutopilotEvaluation_autopilotRunId_fkey" FOREIGN KEY ("autopilotRunId") REFERENCES "AutopilotRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
