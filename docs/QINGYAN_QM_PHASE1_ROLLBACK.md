# Qingyan × QM Phase 1 — 回滚说明

## 1. 应用层回滚（优先）

1. 确保环境变量：
   - `QINGYAN_QM_SCOPE_PHASE1_ENABLED=0`
2. 清空 allowlist（或不设置）
3. 组织 Kill Switch（可选）：`modulesJson.agentAutomationEnabled=false`
4. 回滚 git 分支 / revert 合并 commit（未合并则直接丢弃分支）

Flag 关闭后：PoC 不运行；Harness/Scope 新入口不被调用则对业务零影响。

## 2. Schema 回滚（仅在已对某库执行 migration 后）

### 2a. `20260803120000_qm_phase1_scoped_skills`

**正向（additive）：** ADD COLUMN / CREATE INDEX + builtin→SYSTEM 回填。  
**注意：** 该 migration **尚未**在任何业务库执行；语义已按审查修正（builtin→SYSTEM）。

**回滚 SQL（人工、隔离库验证后再用于目标库）：**

```sql
DROP INDEX IF EXISTS "AgentSkill_orgId_lifecycleStatus_idx";
DROP INDEX IF EXISTS "AgentSkill_orgId_ownerScopeType_ownerScopeId_idx";

ALTER TABLE "AgentSkill" DROP COLUMN IF EXISTS "approvedAt";
ALTER TABLE "AgentSkill" DROP COLUMN IF EXISTS "approvedBy";
ALTER TABLE "AgentSkill" DROP COLUMN IF EXISTS "publishedBy";
ALTER TABLE "AgentSkill" DROP COLUMN IF EXISTS "approvalMode";
ALTER TABLE "AgentSkill" DROP COLUMN IF EXISTS "riskLevel";
ALTER TABLE "AgentSkill" DROP COLUMN IF EXISTS "lifecycleStatus";
ALTER TABLE "AgentSkill" DROP COLUMN IF EXISTS "ownerScopeId";
ALTER TABLE "AgentSkill" DROP COLUMN IF EXISTS "ownerScopeType";
```

### 2b. `20260803140000_qm_phase1_brief_claim_and_audit`

**正向：** `AuditLog.userId` DROP NOT NULL；新增 `actorType`/`servicePrincipal`；新建 `ProjectDailyBriefRun`。

**回滚 SQL（仅隔离库演练；生产需额外评估历史 service 审计行）：**

```sql
DROP INDEX IF EXISTS "ProjectDailyBriefRun_projectId_localDate_idx";
DROP INDEX IF EXISTS "ProjectDailyBriefRun_orgId_status_claimExpiresAt_idx";
DROP INDEX IF EXISTS "ProjectDailyBriefRun_orgId_projectId_briefType_localDate_key";
DROP TABLE IF EXISTS "ProjectDailyBriefRun";

DROP INDEX IF EXISTS "AuditLog_servicePrincipal_createdAt_idx";
ALTER TABLE "AuditLog" DROP COLUMN IF EXISTS "servicePrincipal";
ALTER TABLE "AuditLog" DROP COLUMN IF EXISTS "actorType";
-- 恢复 userId NOT NULL 前须先清理/回填 null 行，否则会失败
-- UPDATE "AuditLog" SET "userId" = '<system-placeholder>' WHERE "userId" IS NULL;
-- ALTER TABLE "AuditLog" ALTER COLUMN "userId" SET NOT NULL;
```

然后从 `_prisma_migrations` 删除对应记录（仅在确认应用已不再依赖后）。

**禁止：** 在生产自动执行上述 DROP；禁止把 migrate 绑回 `npm run build`。

### 2c. 应用层急停（优先于 Schema 回滚）

1. `QINGYAN_QM_SCOPE_PHASE1_ENABLED=0`
2. 清空 org/project allowlist
3. 可选：从 `vercel.json` 移除 `/api/cron/qm-project-daily-brief` 或依赖 Flag 早退

## 3. 迁移执行纪律

- 使用：`npm run db:migrate:deploy` → `scripts/safe-migrate-deploy.ts`
- 需要：`ALLOW_DATABASE_MIGRATION=1`
- 生产额外：`CONFIRM_PRODUCTION_MIGRATION=1`
- 本 Phase **不**执行生产迁移

## 4. 数据影响

- 新列均有默认值，回滚前存量行可安全存在
- PoC 幂等键若写入 PendingAction / 内部 store，回滚应用后历史建议记录可保留（只读），不自动删除
