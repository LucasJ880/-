# Qingyan × QM Phase 1 — 回滚说明

## 1. 应用层回滚（优先）

1. 确保环境变量：
   - `QINGYAN_QM_SCOPE_PHASE1_ENABLED=0`
2. 清空 allowlist（或不设置）
3. 组织 Kill Switch（可选）：`modulesJson.agentAutomationEnabled=false`
4. 回滚 git 分支 / revert 合并 commit（未合并则直接丢弃分支）

Flag 关闭后：PoC 不运行；Harness/Scope 新入口不被调用则对业务零影响。

## 2. Schema 回滚（仅在已对某库执行 migration 后）

Migration：`20260803120000_qm_phase1_scoped_skills`

**正向（additive）：** 仅 ADD COLUMN / CREATE INDEX。

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

然后从 `_prisma_migrations` 删除对应记录（仅在确认应用已不再依赖新字段后）。

**禁止：** 在生产自动执行上述 DROP；禁止把 migrate 绑回 `npm run build`。

## 3. 迁移执行纪律

- 使用：`npm run db:migrate:deploy` → `scripts/safe-migrate-deploy.ts`
- 需要：`ALLOW_DATABASE_MIGRATION=1`
- 生产额外：`CONFIRM_PRODUCTION_MIGRATION=1`
- 本 Phase **不**执行生产迁移

## 4. 数据影响

- 新列均有默认值，回滚前存量行可安全存在
- PoC 幂等键若写入 PendingAction / 内部 store，回滚应用后历史建议记录可保留（只读），不自动删除
