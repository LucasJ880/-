-- QM Phase 1：AgentSkill Scope-owned 字段（additive only）
-- Review: 仅 ADD COLUMN / CREATE INDEX / 数据回填；无 DROP / RENAME。
-- Rollback: 见 docs/QINGYAN_QM_PHASE1_ROLLBACK.md
-- 注意：不在 build 中执行；须经 safe-migrate-deploy + 人工确认。
--
-- 语义：
-- - isBuiltin=true → ownerScopeType=SYSTEM，ownerScopeId=NULL
-- - 非 builtin → ownerScopeType=ORG，ownerScopeId=orgId（可确认的组织归属）

ALTER TABLE "AgentSkill" ADD COLUMN "ownerScopeType" TEXT NOT NULL DEFAULT 'ORG';
ALTER TABLE "AgentSkill" ADD COLUMN "ownerScopeId" TEXT;
ALTER TABLE "AgentSkill" ADD COLUMN "lifecycleStatus" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "AgentSkill" ADD COLUMN "riskLevel" TEXT NOT NULL DEFAULT 'low';
ALTER TABLE "AgentSkill" ADD COLUMN "approvalMode" TEXT NOT NULL DEFAULT 'inherit';
ALTER TABLE "AgentSkill" ADD COLUMN "publishedBy" TEXT;
ALTER TABLE "AgentSkill" ADD COLUMN "approvedBy" TEXT;
ALTER TABLE "AgentSkill" ADD COLUMN "approvedAt" TIMESTAMP(3);

-- Built-in → SYSTEM（不得伪造组织归属）
UPDATE "AgentSkill"
SET "ownerScopeType" = 'SYSTEM',
    "ownerScopeId" = NULL
WHERE "isBuiltin" = true;

-- 非 Built-in：ORG，ownerScopeId 回填为已知 orgId
UPDATE "AgentSkill"
SET "ownerScopeType" = 'ORG',
    "ownerScopeId" = "orgId"
WHERE "isBuiltin" = false;

CREATE INDEX "AgentSkill_orgId_ownerScopeType_ownerScopeId_idx"
  ON "AgentSkill"("orgId", "ownerScopeType", "ownerScopeId");

CREATE INDEX "AgentSkill_orgId_lifecycleStatus_idx"
  ON "AgentSkill"("orgId", "lifecycleStatus");
