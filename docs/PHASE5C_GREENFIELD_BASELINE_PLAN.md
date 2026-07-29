# Phase 5C：Greenfield Baseline 治理计划

**开始 commit：** `0ff47087e9b49cd6ae6ad27ecbe89ff0290e66d7`  
**日期：** 2026-07-28  
**状态：** 已实施并完成三轨验证（见 `PHASE5C_THREE_TRACK_VALIDATION.md`）

---

## 1. 为什么旧链不能从空库执行

旧目录中 `20260318200000_add_project_discussion` 排在 `20260319230000_init_postgresql` 之前，但 discussion 依赖 `Project` 表，而 `Project` 由 init 创建。  
旧链可在**已有历史库**上增量前进，但不能作为 greenfield 主链。

## 2. 为什么不能修改旧 migration

- Checksum 已登记在多套数据库  
- 修改 SQL / 重排目录 / 改 checksum 会形成不可审计伪历史  
- Phase 5B/5C 明确禁止

## 3. 为什么 baseline 选择 pre-Phase-4

生产主库**尚未**应用 ops Phase 4（`workDomain`）与 Phase 5（`ProjectHandoff`）。  
若 baseline 含 Phase 4/5 并在生产 `resolve --applied`，Prisma 会误以为结构已存在。

**切点：** 生产真实结构 = Phase 3 Task 字段已在 + Bid Data 已在 + **无** `workDomain` / `ProjectHandoff`。

源分支：`greenfield-baseline-source-pre-phase4`（parent=production）。

## 4. 为什么 Phase 4/5 不合入 baseline

- 生产需要通过 `migrate deploy` **真实执行** Phase 4/5 SQL（含回填）  
- 共享库已执行 Phase 4/5，只需 `resolve` 新 baseline，不再跑 DDL  
- 保持 Phase 4/5 目录名、SQL、checksum **不变**

## 5. 现有数据库如何接管

1. Schema diff 确认与 pre-Phase-4 baseline 等价（生产/隔离）  
2. `prisma migrate resolve --applied 00000000000000_greenfield_baseline_pre_phase4`  
3. `npm run db:migrate:deploy` → 仅待应用的 Phase 4/5  
4. 旧 `_prisma_migrations` 行保留，不删除重复旧 baseline

## 6. 新数据库如何完整重建

空库：`baseline → Phase4 → Phase5`（受控 `db:migrate:deploy`）。

## 7. Legacy 归档位置

`prisma/migrations_legacy_pre_greenfield_baseline/`（85 条，含原始 SQL）  
清单：`docs/LEGACY_MIGRATION_ARCHIVE_MANIFEST.md`

## 8. Active 目录

```text
prisma/migrations/
  00000000000000_greenfield_baseline_pre_phase4/
  20260728120000_project_work_domain/
  20260728180000_project_handoff/
  migration_lock.toml
```

## 9. 生产何时允许 migration

仅当 Gate = `READY_FOR_PRODUCTION_MIGRATION` 且单独发布批准后，按更新后的  
`docs/PHASE5_PRODUCTION_MIGRATION_RUNBOOK.md` 执行。  
**本阶段不自动执行生产 migration。**
