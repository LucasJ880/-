-- Mention Gateway M2-A — ExternalIdentity（additive-only：仅 CreateTable / 索引 / 唯一键 / FK / CHECK）
-- 无 ALTER 业务列 / 无 DROP / 无 RENAME / 无 backfill（legacy 回填是独立 script，不在 migration 内）。
-- 外部渠道身份 → 青砚用户映射；不含 orgId（org 每次由 OrganizationMember + resolveAgentTenant 推导）。
-- 功能门：MENTION_GATEWAY_IDENTITY_SOURCE（default fixture）；生产部署走 safe-migrate-deploy runbook，不由本 PR 执行。

-- CreateTable
CREATE TABLE "ExternalIdentity" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerTenantId" TEXT NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "verificationMethod" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkedById" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentity_provider_providerTenantId_providerUserId_key" ON "ExternalIdentity"("provider", "providerTenantId", "providerUserId");

-- CreateIndex
CREATE INDEX "ExternalIdentity_userId_status_idx" ON "ExternalIdentity"("userId", "status");

-- CreateIndex
CREATE INDEX "ExternalIdentity_provider_providerTenantId_userId_idx" ON "ExternalIdentity"("provider", "providerTenantId", "userId");

-- CreateIndex
CREATE INDEX "ExternalIdentity_status_updatedAt_idx" ON "ExternalIdentity"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CheckConstraint（Prisma 不建模 CHECK；DB 兜底，应用层为主。additive，可独立 DROP 回滚）
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_status_check" CHECK ("status" IN ('PENDING', 'ACTIVE', 'DISABLED', 'REVOKED'));

-- CheckConstraint
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_verification_method_check" CHECK ("verificationMethod" IS NULL OR "verificationMethod" IN ('ADMIN_PROVISIONED', 'PROVIDER_CHALLENGE', 'PROVIDER_OAUTH', 'PROVIDER_SIGNED_EVENT', 'LEGACY_SELF_ASSERTED'));
