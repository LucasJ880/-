-- Mention Gateway M2-B — ChannelContextBinding（additive-only：仅 CreateTable / 索引 / 唯一键 / FK / CHECK）
-- 无 ALTER 业务列 / 无 DROP / 无 RENAME / 无 backfill（M2-B 冻结：不存在可信 legacy channel→target 源，初始为空是正确状态）。
-- 唯一键含 providerTenantId（B1 渠道边界）；providerThreadId 用 '' 哨兵表示 channel 级（可空列会让 UNIQUE 放行多条 channel 行）。
-- FK 一律 RESTRICT：绑定是审计/安全配置，target 删除不得静默连带删除绑定。
-- 功能门：MENTION_GATEWAY_BINDING_SOURCE（default fixture）；生产部署走 safe-migrate-deploy runbook，不由本 PR 执行。

-- CreateTable
CREATE TABLE "ChannelContextBinding" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerTenantId" TEXT NOT NULL,
    "providerChannelId" TEXT NOT NULL,
    "bindingLevel" TEXT NOT NULL DEFAULT 'CHANNEL',
    "providerThreadId" TEXT NOT NULL DEFAULT '',
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "customerId" TEXT,
    "contextRole" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "updatedById" TEXT,
    "disabledAt" TIMESTAMP(3),
    "disabledById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelContextBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelContextBinding_provider_providerTenantId_providerCha_key" ON "ChannelContextBinding"("provider", "providerTenantId", "providerChannelId", "providerThreadId");

-- CreateIndex
CREATE INDEX "ChannelContextBinding_orgId_status_idx" ON "ChannelContextBinding"("orgId", "status");

-- CreateIndex
CREATE INDEX "ChannelContextBinding_projectId_status_idx" ON "ChannelContextBinding"("projectId", "status");

-- CreateIndex
CREATE INDEX "ChannelContextBinding_customerId_status_idx" ON "ChannelContextBinding"("customerId", "status");

-- CreateIndex
CREATE INDEX "ChannelContextBinding_provider_providerTenantId_providerCha_idx" ON "ChannelContextBinding"("provider", "providerTenantId", "providerChannelId", "status");

-- AddForeignKey
ALTER TABLE "ChannelContextBinding" ADD CONSTRAINT "ChannelContextBinding_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelContextBinding" ADD CONSTRAINT "ChannelContextBinding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelContextBinding" ADD CONSTRAINT "ChannelContextBinding_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraint（Prisma 不建模 CHECK；DB 兜底，应用层为主。additive，可独立 DROP 回滚）
ALTER TABLE "ChannelContextBinding" ADD CONSTRAINT "ChannelContextBinding_status_check" CHECK ("status" IN ('ACTIVE', 'DISABLED', 'REVOKED'));

-- CheckConstraint（CHANNEL 级用 '' 哨兵；THREAD 级必须非空白真实线程 id）
ALTER TABLE "ChannelContextBinding" ADD CONSTRAINT "ChannelContextBinding_level_thread_check" CHECK (
    ("bindingLevel" = 'CHANNEL' AND "providerThreadId" = '')
    OR ("bindingLevel" = 'THREAD' AND length(btrim("providerThreadId")) > 0)
);

-- CheckConstraint（target XOR：projectId / customerId 恰一）
ALTER TABLE "ChannelContextBinding" ADD CONSTRAINT "ChannelContextBinding_target_xor_check" CHECK (
    ("projectId" IS NOT NULL AND "customerId" IS NULL)
    OR ("projectId" IS NULL AND "customerId" IS NOT NULL)
);

-- CheckConstraint（contextRole 词表）
ALTER TABLE "ChannelContextBinding" ADD CONSTRAINT "ChannelContextBinding_context_role_check" CHECK ("contextRole" IS NULL OR "contextRole" = 'tender');

-- CheckConstraint（tender 只是 Project 标签：contextRole=tender → 必绑 Project）
ALTER TABLE "ChannelContextBinding" ADD CONSTRAINT "ChannelContextBinding_tender_requires_project_check" CHECK ("contextRole" IS DISTINCT FROM 'tender' OR "projectId" IS NOT NULL);

-- CheckConstraint（键基础非空白）
ALTER TABLE "ChannelContextBinding" ADD CONSTRAINT "ChannelContextBinding_key_nonblank_check" CHECK (
    length(btrim("provider")) > 0
    AND length(btrim("providerTenantId")) > 0
    AND length(btrim("providerChannelId")) > 0
);
