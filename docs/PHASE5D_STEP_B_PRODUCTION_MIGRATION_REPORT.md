# Phase 5D Step B — 生产 Migration 执行报告

**日期：** 2026-07-28（UTC）  
**Runbook：** `docs/PHASE5_PRODUCTION_MIGRATION_RUNBOOK.md`  
**Step A 报告：** `docs/PHASE5D_STEP_A_PREFLIGHT_REPORT.md`  
**最终 Gate：** `PRODUCTION_MIGRATION_SUCCESS`  
**Phase 6：** **未进入**（等待单独业务批准）

---

## 0. 人工批准内容（原文要点）

```text
批准执行生产 migration。
Neon Project：青砚-AI工作助手
目标生产 branch：production
生产 endpoint：ep-super-field-*
Database：neondb
备份 branch：prod-pre-phase45-backup-20260728-2228
备份 branch ID：br-orange-river-an55s52x
发布 commit：9c4f9b385967e44b50576f579379b498ba62b8b1
批准人：Lucas Jiang
执行人：指定 CTO / 工程负责人
日志观察人：指定工程负责人
回滚决策人：Lucas Jiang
```

---

## 1. 执行时间与人员

| 项 | 值 |
|---|---|
| 再确认开始 | `2026-07-28T22:55:41Z` |
| 生产 resolve | `2026-07-28T22:57:06Z` |
| 生产 deploy | `2026-07-28T22:58:15Z` |
| 应用 prebuilt 部署完成 | `2026-07-28T23:43:01Z` 左右（Ready + alias） |
| 报告完成 | `2026-07-28T23:47:35Z` |
| 批准人 | Lucas Jiang |
| 执行人 | Cursor Agent（代指定 CTO / 工程负责人执行受控命令） |
| 回滚决策人 | Lucas Jiang（本次未触发回滚） |

---

## 2. 执行前再确认

| # | 检查 | 结果 |
|---|---|---|
| 1 | HEAD = `9c4f9b385967e44b50576f579379b498ba62b8b1` | ✅ |
| 2 | baseline checksum | ✅ `f1e3c211dc44a08df70a2b19a61ea569b3501844c2fa845c6cc636938d813093` |
| 3 | Phase 4 checksum | ✅ `194cf361ad0281cbf961a9dfe963807a9c92da656786afe03c8e3e1569b4696a` |
| 4 | Phase 5 checksum | ✅ `6581b9056fb1f5537e497ac204505fa71e76e2596adb0abd2ae7743940a9784b` |
| 5 | 生产 Schema vs baseline（forward diff） | ✅ empty（无新 drift） |
| 6 | 备份 branch 存在 / ready / 可读 | ✅ `br-orange-river-an55s52x`；计数 Org12/User18/Project13/Task138 |
| 7 | 生产仍无 greenfield/P4/P5；无 workDomain / ProjectHandoff | ✅ |

工作区另有未跟踪 Step A 产物（预检脚本/报告），**无未提交 migration/Schema 变更**。

---

## 3. Baseline resolve 结果

**目标：** `ep-super-field-*` / `neondb` / `neondb_owner`（production）

```text
prisma migrate resolve --applied 00000000000000_greenfield_baseline_pre_phase4
→ Migration marked as applied.
```

### Resolve 后门禁

| 检查 | 结果 |
|---|---|
| greenfield baseline 已登记 | ✅ finished |
| pending | **仅** `20260728120000_project_work_domain`、`20260728180000_project_handoff` |
| 未知 pending | 无 |
| failed migration | 无 |

---

## 4. 实际 deploy migration 清单

命令：

```bash
ALLOW_DATABASE_MIGRATION=true
CONFIRM_PRODUCTION_MIGRATION=I_UNDERSTAND_PRODUCTION_MIGRATION
npm run db:migrate:deploy   # scripts/safe-migrate-deploy.ts
```

`protectedTarget=true`；目标 host 确认为 `ep-super-field-*`。

**实际应用（仅二者）：**

1. `20260728120000_project_work_domain`
2. `20260728180000_project_handoff`

无其他 migration 被执行。

---

## 5. migrate status（部署后）

```text
Datasource: ep-super-field-antfibsl… / neondb
3 migrations found in prisma/migrations
Database schema is up to date!
```

已登记：

- `00000000000000_greenfield_baseline_pre_phase4`
- `20260728120000_project_work_domain`
- `20260728180000_project_handoff`

旧 legacy 行与旧 `baseline_before_launch` 重复记录仍共存（允许，未删除）。

---

## 6. 迁移前后数据数量

| 表 | 迁移前 | 迁移后 |
|---|---|---|
| Organization | 12 | 12 |
| User | 18 | 18 |
| Project | 13 | 13 |
| Task | 138 | 138 |
| ProjectHandoff | NOT_PRESENT | 0（表已创建） |

### 结构存在性（迁移后）

| 对象 | 状态 |
|---|---|
| Project.workDomain / deliveryStage / plannedCompletionDate / actualCompletionDate / sourceTenderProjectId | ✅ |
| ProjectHandoff + FK/unique/index | ✅ |
| Task blockedReason / waitingOn / waitingUntil / sourceType / sourceId / sourceTemplateKey / sourceBatchKey | ✅ |

无原项目被回填为 `delivery`（delivery 计数 = 0）。

---

## 7. workDomain 回填分布

| workDomain | n |
|---|---|
| tender | 11 |
| general | 2 |
| delivery | 0 |

非法 / NULL：0。

---

## 8. 完整性检查

```text
Summary: PASS=14 WARNING=1 BLOCKER=0
```

- WARNING：既有数据 `Task done 但 completedAt 为空 (n=2)`（非本次 migration 引入）
- **无 BLOCKER**

---

## 9. 应用部署版本

| 项 | 值 |
|---|---|
| 发布 commit（本地构建源） | `9c4f9b385967e44b50576f579379b498ba62b8b1` |
| Build 命令 | `prisma generate && next build`（**不含** migrate） |
| 部署方式 | `vercel build --prod` → `vercel deploy --prebuilt --prod` |
| Deployment ID | `dpl_6XCV4DTqykCjTCthbV69RQEaKkLv` |
| Deployment URL | `https://1fjstwfyh-6afvii4fw-lucas-9039s-projects.vercel.app` |
| Production alias | `https://qingyan.ca`（及 www / 既有别名） |
| readyState | **READY** |

说明：首次远程 `vercel deploy` 因仓库存在 `deploy/` 目录曾出现卡住的 UNKNOWN 部署，已移除后改用 prebuilt 成功。部署阶段**未**再次运行 migration。

该 commit 尚未合并进 GitHub `main`；本次为 CLI 预构建生产部署。

---

## 10. Smoke Test 结果

### HTTP / API（未登录）

| 路径 | 结果 |
|---|---|
| `/` `/login` `/ops` `/ops/projects` `/tasks` `/bids` `/projects` `/capabilities/approvals` `/settings` | HTTP **200**（页面壳可加载；无 Internal Server Error / Prisma 错误正文） |
| `/api/ops/home` `/api/ops/projects` `/api/tasks` | **401** `{"error":"未登录"}`（鉴权门禁正常，非 500） |

### 按清单对照

| 项 | 结果 | 说明 |
|---|---|---|
| 登录页可达 | ✅ | `/login` 200 |
| 管理总览 `/` | ✅ | 200，无 500 |
| `/ops` `/ops/projects` `/tasks` `/bids` `/projects` | ✅ | 200，无 500 |
| PendingAction 审批入口 | ✅ | `/capabilities/approvals` 200 |
| Handoff Preview | ⚠️ 部分 | API 未登录正确 401；**未**用真实客户项目做正式 Handoff；未注入生产会话做深度 Preview |
| Task 新状态读取 / 角色入口 / 组织隔离 | ⚠️ 部分 | 依赖登录会话；本次无生产测试账号会话，未做写操作验证 |

**明确未做：** 真实客户项目正式 Handoff execute。

建议观察窗口内由负责人用内部账号补齐登录后的 Preview / 任务状态 / 组织隔离人工抽检。

---

## 11. 错误日志摘要

| 来源 | 观察 |
|---|---|
| Prisma migrate deploy | 成功；仅 P4+P5 |
| Neon | 生产 endpoint 正常；备份 ready |
| Vercel | 两次 UNKNOWN 远程构建已移除；最终 prebuilt **READY**；无持续 500 |
| 应用 API（抽检） | 未登录 401，符合预期 |

未发现持续数据库错误。

---

## 12. 是否触发回滚

**否。**

Migration 成功且应用 Ready；未回滚应用版本；未 DROP 任何 Phase 4/5 结构；未修改 checksum；未删除 `_prisma_migrations`。

---

## 13. 备份 branch 保留状态

| 项 | 值 |
|---|---|
| 名称 | `prod-pre-phase45-backup-20260728-2228` |
| ID | `br-orange-river-an55s52x` |
| 状态 | **ready（保留）** |
| 说明 | 未删除；可作为对照 / 灾难恢复参考 |

---

## 14. 最终 Gate

```text
PRODUCTION_MIGRATION_SUCCESS
```

### SUCCESS 条件核对

| 条件 | 状态 |
|---|---|
| baseline resolve 成功 | ✅ |
| Phase 4/5 deploy 成功 | ✅ |
| migrate status 干净 | ✅ |
| 完整性无 BLOCKER | ✅ |
| 数据数量无异常变化 | ✅ |
| 应用部署成功（qingyan.ca Ready） | ✅ |
| 核心 smoke（页面可达 + API 鉴权正常） | ✅（深度登录项待观察窗口补齐） |
| 无持续 DB 错误 | ✅ |
| 备份保留 | ✅ |
| 发布记录完整 | ✅ |

---

## 15. 暂停声明

- **已暂停。不自动进入 Phase 6。**
- 建议业务观察窗口：数小时至一个业务日。
- 进入 Phase 6 须单独业务批准。

---

## 16. 修改/新增文件（本阶段文档）

- `docs/PHASE5D_STEP_B_PRODUCTION_MIGRATION_REPORT.md`（本报告）
- Step A 产物仍本地未提交：`docs/PHASE5D_STEP_A_PREFLIGHT_REPORT.md`、`scripts/phase5d-preflight-readonly.ts`
