# Migration History Reconciliation Report

**日期：** 2026-07-28（Phase 5A 更新）  
**相关：** [`PHASE5A_MIGRATION_RELEASE_SAFETY_REPORT.md`](./PHASE5A_MIGRATION_RELEASE_SAFETY_REPORT.md) · [`INCIDENT_BUILD_TRIGGERED_DATABASE_MIGRATION.md`](./INCIDENT_BUILD_TRIGGERED_DATABASE_MIGRATION.md)

---

## 1. 当前状态摘要（Phase 5A 后）

| 项 | 共享库 `ep-raspy-credit` | 生产主库 `ep-super-field` | 隔离分支 `migration-reconciliation-phase5` |
|---|---|---|---|
| 本地 migration 文件 | 85 | 85 | 85 |
| `_prisma_migrations` 唯一名 | 85（行数 86，baseline 重复） | （未直接改） | deploy 后与本地对齐 |
| Phase 4/5 | 已在库中（事故/开发） | 分支创建时**未**应用 | 受控 deploy **成功** |
| `migrate status` | up to date | 见隔离分支验证 | up to date |

---

## 2. 原「仅 DB 有、本地缺失」10 条 — 已全部恢复

| Migration | 恢复来源 | 处理方式 |
|---|---|---|
| `20260318200000_add_project_discussion` | 本仓 Git | 恢复文件；checksum 一致 |
| `20260319230000_init_postgresql` | 本仓 Git | 同上 |
| `20260320120000_add_auth_provider_and_indexes` | 本仓 Git | 同上 |
| `20260724160000_project_fact_memory_phase2` | 姊妹仓 `青砚/prisma/migrations` | 同上 |
| `20260724170000_project_orchestrator_task_lease` | 姊妹仓 | 同上 |
| `20260724190000_project_orchestrator_3i_persistence` | 姊妹仓 | 同上 |
| `20260724200000_agent_task_cancel_requested_at` | 姊妹仓 | 同上 |
| `20260725010000_phase4_bid_data_layer` | 姊妹仓 | 同上；Bid Data 表来源 |
| `20260725020000_phase4a2_bid_data_review` | 姊妹仓 | 同上 |
| `20260725030000_phase4a2_pricing_line_reviewer_note` | 姊妹仓 | 同上 |

**禁止事项（已遵守）：** 未按当前 Schema 重写同名 migration；未对未核验项 `migrate resolve`。

---

## 3. Phase 3 / 4 / 5

| Migration | 共享库 | 生产→隔离分支 |
|---|---|---|
| `20260728010000_task_waiting_blocked_fields` | 结构+history OK；Task=138 | 结构+history OK |
| `20260728120000_project_work_domain` | 已应用；tender=13/general=4 | 隔离分支受控 deploy；tender=11/general=2 |
| `20260728180000_project_handoff` | 已应用（build 事故路径）；Handoff=0 | 隔离分支受控 deploy 成功 |

---

## 4. 构建与迁移策略（强制）

```text
npm run build              → prisma generate && next build   # 禁止改库
npm run db:migrate:deploy  → scripts/safe-migrate-deploy.ts  # 显式受控
```

事故根因与防护见独立事故文档，**不要**仅依赖本报告。

---

## 5. 剩余治理项

1. `20260416120000_baseline_before_launch` 在共享库重复 2 行 — 独立方案，禁止直接删表行  
2. 空库全链 `migrate deploy` 重放未完成  
3. 生产主库 Phase 4/5 需发布审批后受控执行（**不要**用共享库状态代替）  
4. Bid Data 仍主要靠 raw SQL；模型回 Prisma schema 属后续债  
