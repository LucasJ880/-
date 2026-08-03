-- QM Phase 1 审查修复：每日简报原子 claim + 服务审计字段
-- Additive only；不在 build 中执行。

-- AuditLog：允许 service principal 无 userId（不伪造普通用户）
ALTER TABLE "AuditLog" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "AuditLog" ADD COLUMN "actorType" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "servicePrincipal" TEXT;
CREATE INDEX "AuditLog_servicePrincipal_createdAt_idx"
  ON "AuditLog"("servicePrincipal", "createdAt");

-- 项目每日简报原子幂等表（唯一业务键：org+project+type+localDate）
CREATE TABLE "ProjectDailyBriefRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "briefType" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STARTED',
    "correlationId" TEXT,
    "servicePrincipal" TEXT,
    "triggerSource" TEXT,
    "claimExpiresAt" TIMESTAMP(3),
    "briefMarkdown" TEXT,
    "inputDataVersion" TEXT,
    "errorMessage" TEXT,
    "agentRunId" TEXT,
    "pendingActionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectDailyBriefRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectDailyBriefRun_orgId_projectId_briefType_localDate_key"
  ON "ProjectDailyBriefRun"("orgId", "projectId", "briefType", "localDate");

CREATE INDEX "ProjectDailyBriefRun_orgId_status_claimExpiresAt_idx"
  ON "ProjectDailyBriefRun"("orgId", "status", "claimExpiresAt");

CREATE INDEX "ProjectDailyBriefRun_projectId_localDate_idx"
  ON "ProjectDailyBriefRun"("projectId", "localDate");
