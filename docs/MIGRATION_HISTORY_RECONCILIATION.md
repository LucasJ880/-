# Migration History Reconciliation（Phase 5C 更新）

**日期：** 2026-07-28  

## 当前策略

| 层 | 位置 | 用途 |
|---|---|---|
| Active | `prisma/migrations/`（3 条） | Prisma 执行主链 |
| Legacy 归档 | `prisma/migrations_legacy_pre_greenfield_baseline/` | 审计；不执行 |
| 临时 introspection | `prisma/baseline/schema.pre-phase4.prisma` | 生成 baseline 的依据 |

旧链不能空库重放的原因与治理见：

- `docs/PHASE5C_GREENFIELD_BASELINE_PLAN.md`  
- `docs/PHASE5C_THREE_TRACK_VALIDATION.md`  
- `docs/LEGACY_MIGRATION_ARCHIVE_MANIFEST.md`  

事故（build 触发 migrate）：`docs/INCIDENT_BUILD_TRIGGERED_DATABASE_MIGRATION.md`  
重复旧 baseline：`docs/BASELINE_MIGRATION_DUPLICATE_ASSESSMENT.md`  

## 生产状态（Phase 5C 结束时）

- 生产主库：**尚未** resolve 新 baseline，**尚未** deploy Phase 4/5  
- 允许在 Gate READY 且批准后按 Runbook 执行  
- **禁止**自动生产 migrate；**禁止** Phase 6  
