# Migration History Reconciliation Report

**日期：** 2026-07-28  
**环境：** Neon `neondb`（`ep-raspy-credit-anx2k4wx`）  
**分支：** `feat/ops-bids-workspace-phase1`  
**目的：** 记录本地 Prisma migrations 与共享 Neon `_prisma_migrations` 的分叉，作为 Phase 5 发布前置条件。

---

## 1. 当前状态摘要

| 项 | 结果 |
|---|---|
| 本地 migration 目录数量 | 74 |
| DB `_prisma_migrations`（未回滚） | 84 |
| 仅 DB 有、本地缺失 | 10 |
| 仅本地有、DB 未记录 | 0（截至本报告；含已手工落地并 resolve 的 Phase 3/4） |
| Phase 5 migration 文件 | `20260728180000_project_handoff` |

`prisma migrate status` 在本地曾显示 “Database schema is up to date”，含义是：**本地目录中的 migration 均已在 DB 标记 applied**。  
这**不**表示历史已对齐——DB 仍有 10 条本地缺失的 migration 记录。

---

## 2. 仅数据库存在、本地缺失的 migration

必须从历史 commit / 已部署分支 / CI artifact **恢复原始文件**，禁止按当前 Schema 重新编造同名 migration。

```text
20260318200000_add_project_discussion
20260319230000_init_postgresql
20260320120000_add_auth_provider_and_indexes
20260724160000_project_fact_memory_phase2
20260724170000_project_orchestrator_task_lease
20260724190000_project_orchestrator_3i_persistence
20260724200000_agent_task_cancel_requested_at
20260725010000_phase4_bid_data_layer
20260725020000_phase4a2_bid_data_review
20260725030000_phase4a2_pricing_line_reviewer_note
```

说明：

- Bid Data Layer 相关表（如 `BidDataRevision`）**已存在于 Neon**，但本地 `schema.prisma` 未完整建模。
- Phase 5 交接对 Bid Data 的校验通过安全 raw SQL 完成；无 revision 时走历史 override，不伪造审批。

---

## 3. 已手工应用并验证的 migration（Phase 3 / 4）

| Migration | 应用方式 | 验证 |
|---|---|---|
| `20260728010000_task_waiting_blocked_fields` | `prisma db execute`（IF NOT EXISTS） | Task 列存在；138 条任务未丢；旧状态可读 |
| `20260728120000_project_work_domain` | `prisma db execute` | workDomain 回填 tender=13 / general=4；deliveryStage 全空 |

二者现已出现在 `_prisma_migrations`（finished）。若未来在其他环境复现，必须：

1. 核对列/类型/nullability/index 与 SQL 完全一致  
2. 再考虑 `prisma migrate resolve --applied <name>`  
3. **禁止**仅因“列看起来存在”就标记 applied

---

## 4. Phase 5 migration 与意外应用事故

文件：

```text
prisma/migrations/20260728180000_project_handoff/migration.sql
```

内容：

- `Project.sourceTenderProjectId` + FK/index  
- `ProjectHandoff` 表 + 唯一约束  
- `Task.sourceType/sourceId/sourceBatchKey/sourceTemplateKey` + 去重唯一索引  

### 4.1 事故记录（必须透明）

本仓库 `package.json` 的 `build` 脚本为：

```text
prisma generate && prisma migrate deploy && next build
```

在 Phase 5 验收构建时执行了 `npm run build`，导致 **`migrate deploy` 将 Phase 5 migration 应用到了当前 DATABASE_URL 指向的 Neon 共享库**（2026-07-28T19:22:49Z）。

这违反了「历史对齐完成前不得应用到共享库」的流程要求。

### 4.2 影响评估

| 项 | 结果 |
|---|---|
| 变更类型 | 纯增量（新列 + 新表 + 新索引） |
| 既有 Task / Project 数据 | 未删除、未改写业务字段 |
| `sourceTenderProjectId` | 历史行为 NULL |
| `ProjectHandoff` | 空表 |
| Task source 字段 | 历史行为 NULL |
| 是否 `migrate reset` | 否 |
| 是否破坏 Phase 3/4 | 否 |

### 4.3 后续约束

- 本地验证 build 优先使用：`npx prisma generate && npx next build`（跳过 deploy）
- 生产 / 共享库部署前仍须完成第 5 节历史对齐
- **禁止** `prisma migrate reset`
- **禁止** 删除或手工改 checksum
- 回滚 Phase 5 仅在隔离快照验证后、且确认无依赖时按 SQL 头部注释执行

---

## 5. 安全对齐步骤（发布前仍必做）

### 5.1 创建 Neon 隔离分支或快照

在隔离分支操作，不要先动生产主分支。

### 5.2 收集状态

```bash
npx prisma migrate status
# 并导出 _prisma_migrations
```

记录：仅 DB / 仅本地 / checksum 不一致 / 手工 SQL 未入史。

### 5.3 恢复本地缺失的 10 个 migration 文件

来源优先级：对应 git commit → 已部署分支 → CI artifact → 可靠备份。

### 5.4 在隔离分支验证

```bash
npx prisma migrate deploy
npx prisma generate
# 跑 Phase 3/4/5 测试 + build
```

验证：数据未丢失、Client 正常、migration status 干净。

### 5.5 再将 Phase 5 应用到隔离分支

确认后再规划生产窗口。

---

## 6. 回滚说明（Phase 5）

见 migration SQL 头部注释。回滚前需确认无应用依赖；回滚会丢失：

- ProjectHandoff 记录  
- `sourceTenderProjectId` 链接  
- Task 来源字段  

---

## 7. 结论

| 结论 | 状态 |
|---|---|
| 历史分叉已识别 | 是 |
| 本地缺失 migration 文件清单 | 已列出（10） |
| Phase 3/4 数据验证 | 已在开发库完成 |
| Phase 5 已因 build 脚本意外落入当前共享 Neon | **是（事故，见 §4）** |
| 历史 10 条本地缺失 migration 仍未恢复 | **是** |
| 生产部署前置 | 完成隔离分支对齐 + 恢复缺失文件 + 全量验证 |

**本地缺失的 10 条 migration 文件恢复与隔离分支验证完成前，不得将当前分支视为生产可发布状态。**
