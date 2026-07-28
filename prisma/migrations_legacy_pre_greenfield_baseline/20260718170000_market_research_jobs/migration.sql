-- CreateTable
CREATE TABLE "MarketResearchRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "inputJson" JSONB NOT NULL,
    "outputMarkdown" TEXT,
    "errorCode" TEXT,
    "error" VARCHAR(2000),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "primaryModel" TEXT NOT NULL,
    "fallbackModel" TEXT,
    "modelUsed" TEXT,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "skillExecutionId" TEXT,
    "createdById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketResearchRun_orgId_createdAt_idx" ON "MarketResearchRun"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketResearchRun_orgId_status_createdAt_idx" ON "MarketResearchRun"("orgId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketResearchRun_status_nextAttemptAt_idx" ON "MarketResearchRun"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "MarketResearchRun_status_leaseExpiresAt_idx" ON "MarketResearchRun"("status", "leaseExpiresAt");
