# Phase 5A 完成报告：数据库迁移历史修复与发布安全加固

**开始 commit：** `15c357caac05cd853ee1867b9159bfb58857fb91`（Phase 5 handoff）  
**Phase 5A commit：** （提交后回填）  
**日期：** 2026-07-28  
**结论：****可以认为 Phase 5A 工程目标基本达成；生产 migrate 与 Phase 6 仍禁止自动进入。**

---

## 1. Build 脚本修改前后对比

| 脚本 | 修改前 | 修改后 |
|---|---|---|
| `build` | `prisma generate && prisma migrate deploy && next build` | `prisma generate && next build` |
| `postinstall` | `prisma generate` | 不变（无 migrate） |
| `prisma:generate` | （无） | `prisma generate` |
| `db:migrate:status` | 已有 | 保留 |
| `db:migrate:deploy` | （无 / 直接 prisma） | `tsx scripts/safe-migrate-deploy.ts` |
| `db:migrate:deploy:raw` | （无） | `prisma migrate deploy`（逃生舱，仍需人工） |
| `build:with-migrations` | （无） | `db:migrate:deploy && build`（显式） |
| `test:release-safety` | （无） | 静态检查 |

---

## 2. CI / 部署配置

| 配置 | 结果 |
|---|---|
| `.github/workflows` | 本仓不存在 |
| `vercel.json` | 仅 cron；无 migrate |
| `docs/DEPLOY_VERCEL.md` | 已改为「build 不 migrate + 受控 migrate」 |
| `docs/QA_P0_CHECKLIST.md` | 已去掉「build 含 migrate」 |

---

## 3. Migration 安全保护

文件：`scripts/safe-migrate-deploy.ts`

- 必需：`ALLOW_DATABASE_MIGRATION=true`  
- 受保护目标（host 含 prod/production/main/primary，或 `ep-raspy-credit` / `ep-super-field`，或 `FORCE_TREAT_AS_PRODUCTION=true`）额外需要：  
  `CONFIRM_PRODUCTION_MIGRATION=I_UNDERSTAND_PRODUCTION_MIGRATION`  
- 日志仅输出 host / database / user / neonEndpoint，**不打印完整 URL/密码**  
- 无法解析 URL → 拒绝执行  

---

## 4. 缺失 10 条 Migration 恢复清单

| Migration | 恢复来源 | Checksum vs DB |
|---|---|---|
| `20260318200000_add_project_discussion` | 本仓 Git（如 `103ae18`） | 一致 |
| `20260319230000_init_postgresql` | 本仓 Git（如 `d3f805f`） | 一致 |
| `20260320120000_add_auth_provider_and_indexes` | 本仓 Git（如 `d3f805f`） | 一致 |
| `20260724160000_project_fact_memory_phase2` | 姊妹仓 `/Users/user/Desktop/青砚/prisma/migrations`（原文件非空） | 一致 |
| `20260724170000_project_orchestrator_task_lease` | 同上 | 一致 |
| `20260724190000_project_orchestrator_3i_persistence` | 同上 | 一致 |
| `20260724200000_agent_task_cancel_requested_at` | 同上 | 一致 |
| `20260725010000_phase4_bid_data_layer` | 同上（Bid Data 表来源） | 一致 |
| `20260725020000_phase4a2_bid_data_review` | 同上 | 一致 |
| `20260725030000_phase4a2_pricing_line_reviewer_note` | 同上 | 一致 |

**未能恢复：** 无（10/10 已恢复且 checksum 一致）。

---

## 5. `_prisma_migrations` 对照结果（共享库 `ep-raspy-credit`）

| 分类 | 数量 |
|---|---|
| 本地和数据库均存在且一致 | 85 |
| 数据库存在，本地缺失 | 0（修复后） |
| 本地存在，数据库未登记 | 0 |
| Checksum 不一致 | 0 |
| 失败/未完成 | 0 |
| 已 rolled back | 0 |
| **异常：同名重复行** | `20260416120000_baseline_before_launch` ×2（86 行 / 85 唯一名） |

重复 baseline **未**用 resolve/delete 掩盖；记为剩余风险。

逐条明细可由 `npx tsx scripts/phase5a-dump-migrations.ts` 复现。

---

## 6. Phase 3 核验

Migration：`20260728010000_task_waiting_blocked_fields`

| 检查项 | 共享库 | 生产快照隔离分支 |
|---|---|---|
| blockedReason / waitingOn / waitingUntil | 存在，text/text/timestamp，nullable | 存在，一致 |
| Task_waitingUntil_idx | 有 | 有 |
| Task 数量 | 138 | 138 |
| 状态分布 | todo 127 / done 9 / in_progress 2 | todo 123 / done 10 / cancelled 3 / in_progress 2（不同库快照，合理） |
| history 登记 | finished | finished |

**结论：** 结构与 SQL 一致；允许保持 applied。未因「三列存在」草率 resolve——本库已有 finished 记录。

---

## 7. Phase 4 核验

Migration：`20260728120000_project_work_domain`

| 检查项 | 共享库 | 隔离分支 deploy 后 |
|---|---|---|
| workDomain NOT NULL default general | 是 | 是 |
| deliveryStage / planned / actual | 存在 nullable | 存在 |
| 回填 tender/general | 13 / 4 | 11 / 2（production 快照项目更少） |
| 相关索引 | 有 | 有 |

---

## 8. Phase 5 核验

Migration：`20260728180000_project_handoff`

| 检查项 | 共享库 | 隔离分支 deploy 后 |
|---|---|---|
| sourceTenderProjectId + 索引 | 有 | 有 |
| ProjectHandoff 表/字段 | 有，0 行 | 有，0 行 |
| 业务唯一 / idempotency / target 唯一 | 有 | 有 |
| Task 来源唯一 `Task_sourceId_sourceTemplateKey_key` | 有 | 有 |
| FK | 有 | 有 |
| 部分成功 / 约束冲突 | 未见 | deploy 干净成功 |

---

## 9. Neon 隔离分支

| 项 | 值 |
|---|---|
| 名称 | `migration-reconciliation-phase5` |
| ID | `br-jolly-fog-an3eiw4v` |
| Parent | `production` (`br-green-boat-ann7k5yf`) |
| Endpoint（脱敏） | `ep-orange-smoke-anrme6h5` |
| deploy 前 status | 待应用：Phase 4 + Phase 5 |
| 受控 deploy | `ALLOW_DATABASE_MIGRATION=true npm run db:migrate:deploy` → 成功 |
| deploy 后 status | **Database schema is up to date** |

方案 A（受控快照后续迁移）**通过**。

---

## 10. 空库完整重放

**未执行。** 本机无 Docker / psql；未另建 Neon 空分支重放全链。  
记为剩余风险：完整 85 链在空库的可重放性尚未证明（隔离分支仅验证了从 production 基线叠加 Phase 4/5）。

---

## 11. 共享库事故报告

见独立文件：[`docs/INCIDENT_BUILD_TRIGGERED_DATABASE_MIGRATION.md`](./INCIDENT_BUILD_TRIGGERED_DATABASE_MIGRATION.md)

---

## 12. 并发幂等 / P2002 恢复

- 新增 `src/lib/projects/handoff/conflict.ts`  
- `execute.ts`：create/事务路径捕获 P2002 → 按业务唯一键重读 → completed 返回既有 target / processing 返回 409 / failed 可重试  
- **不向用户暴露 Prisma P2002**  
- `markHandoffFailed` 改为 `updateMany` 且 `status ≠ completed`；catch 前再次检查 completed  

测试：`handoff-domain.test.ts`、`handoff-failure-recovery.test.ts`

---

## 13. 事务故障注入

完整 DB 故障注入（创建 Project 前后、首 Task 后、完成更新前、AuditLog 失败）**未在共享库执行**（禁止污染）。  
应用层不变量已用单元测试与代码审查锁定；建议在隔离分支后续补集成故障注入。

---

## 14. Bid Data raw SQL

- 表：`"BidDataRevision"`（public），参数化 `$queryRaw`，**无字符串拼接**  
- Preview 与 Execute **均**调用 `inspectBidDataGate`  
- 表不可用 → `layerAvailable=false` + `BID_DATA_UNAVAILABLE`，仍需管理层 override，**不静默放行**  
- 对应 migration 属于已恢复的 10 条之一：`20260725010000_phase4_bid_data_layer` 等  
- 本地 Prisma schema 仍未完整建模 Bid Data（已知债，非本阶段范围）

---

## 15. 测试结果

| 项 | 结果 |
|---|---|
| `test:release-safety` | 24/24 通过 |
| handoff domain | 33/33 通过 |
| handoff failure recovery | 11/11 通过 |
| `npx tsc --noEmit` | 通过 |
| eslint（本阶段改动文件） | 通过 |
| `npm run build` | 通过；日志无 `migrate deploy` / `Applying migration` |
| `scripts/test-all.sh` | 141/145 通过；失败 4 项为既有用例（Agent Runtime Phase-1 / 记忆 org / Agent Trace / Image Engine FormData），与 Phase 5A 无关；Phase5/5A 三项均通过 |

---

## 16. 生产部署是否仍被阻塞

**是 — 生产 migrate 仍阻塞，需单独审批。**

- 生产主库尚未应用 Phase 4/5（隔离分支创建时证实）  
- 空库全链重放未完成  
- baseline 重复行未治理  

**是否可进入 Phase 6：否。** 本阶段结束后暂停。

---

## 17. 剩余风险

1. 空库完整 migration 重放未做  
2. `_prisma_migrations` baseline 重复行  
3. Bid Data 未进入 Prisma schema  
4. Handoff 并发/故障注入缺隔离库集成测试  
5. 共享库 `ep-raspy-credit` 与生产 `ep-super-field` 数据已分叉（事故/开发漂移）— 发布必须以生产分支为准  
