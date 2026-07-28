# Phase 5B 生产发布验证门报告

**开始 commit：** `626db2e9fa369b05d583fc4134f227f4eb785265`  
**Phase 5B commit：** `e7941687fedbb8e1d5ca0ca8605fdefd6c668e55`  
**日期：** 2026-07-28  

## 最终发布 Gate 结论

```text
BLOCKED
```

**是否允许开始 Phase 6：否**  
**是否已对生产执行 migration：否**

---

## 阻塞主因

空数据库全链 `prisma migrate deploy` **失败**。

| 项 | 值 |
|---|---|
| 空库位置 | 新建 Neon Project `ancient-thunder-95474893`（`qingyan-migration-empty-replay-phase5b`） |
| Endpoint（脱敏） | `ep-falling-silence-avtm4eie` |
| 验证方式 | 全新空 project（非 production branch）+ `ALLOW_DATABASE_MIGRATION=true npm run db:migrate:deploy` |
| 失败 migration | `20260318200000_add_project_discussion` |
| 错误 | `ERROR: relation "Project" does not exist` (42P01) |
| 根因 | 时间戳顺序上 discussion **早于** `20260319230000_init_postgresql`（后者才 CREATE "Project"）。历史库在已有 Project 的前提下应用 discussion；空库无法按当前目录序重放 |
| 是否依赖历史业务数据 | 依赖「Project 表已存在」的历史状态，而非具体业务行 |
| 推荐修复（独立治理，非本阶段） | 新建 **baseline 治理方案**（不可变旧 SQL；可选：文档化 greenfield 使用打包 baseline / 新初始 migration 链）；**禁止**改写已部署 migration 文件冒充通过 |
| 是否需要新增兼容 migration | 可能需要「仅 greenfield」旁路流程，但不能修改已部署 SQL |

按验收标准：空库链无法重放 → **BLOCKED**。

> 说明：隔离分支从 production 快照叠加 Phase 4/5 **已成功**，证明**向前迁移**可行；但这不能替代空库全链重放。

---

## 1. 四个失败测试逐项结论（已修复）

| 测试名称 | 文件 | 失败原因 | 首次引入 | 与 Phase1–5 关系 | 是否产品缺陷 | 处理 |
|---|---|---|---|---|---|---|
| Agent Runtime Phase-1 | `src/lib/agent-runtime/__tests__/runtime.test.ts` | DB 集成用虚构 `orgId`，`CapabilityQuotaReservation_orgId_fkey` 失败 | 测试 `5eaefd7`；FK 强化约 `ced12b4`（Phase3A-4，早于 ops Phase1） | 非 ops/handoff 引入，但发布门内必须绿 | 测试夹具缺陷，非线上业务回归 | 增加 `ensureTestUserOrg` fixture **已修复** |
| 记忆 org 隔离与 Session 摘要 | `src/lib/ai/__tests__/memory-org.test.ts` | 虚构 `userId` → `UserMemory_userId_fkey`；embedding 403 仅为 warn | 同期 agent/记忆测试 | 无关 handoff | 测试夹具缺陷 | 同上 **已修复**（embedding 403 不阻断写入） |
| Agent Trace 只读查询 | `src/lib/agent-runtime/__tests__/trace.test.ts` | 同 Runtime：quota FK | 同 Runtime | 无关 handoff | 测试夹具缺陷 | **已修复** |
| Image Engine FormData 传图证明 | `src/lib/image-engine/__tests__/provider-formdata-proof.test.ts` | 断言 `metadata` 不含子串 `http`，误伤字段名 `httpStatus` | `0a7327a`（早于 Phase1） | 无关 | 测试误报 | 改为检测 `https?://` **已修复** |

**豁免清单：** 无（目标恢复 145/145 单元组；见下节 test-all）。

---

## 2. test-all 结果

```text
scripts/test-all.sh → 145/145 通过, 0 失败
```

附：`scripts/test-work-json.py` 在无 API 凭证时 15 例均 401（环境未配置，不计入上述 145 纯逻辑组）。

---

## 3. 空库重放

见上文「阻塞主因」。Schema 验证：未进入可 seed 阶段（首条即失败）。  
空库当前 `_prisma_migrations` 含失败中的 discussion；**仅测试 project**，可后续 `migrate resolve --rolled-back` 清理，不影响生产。

---

## 4. Baseline 重复

见 `docs/BASELINE_MIGRATION_DUPLICATE_ASSESSMENT.md`。

| 问题 | 结论 |
|---|---|
| 生产是否重复 | **是**（与共享/隔离相同两行） |
| 是否阻塞 Prisma | **否**（情况 B） |
| 本阶段是否清理 | **否** |

---

## 5. Handoff 并发 / P2002 / 故障注入 / 响应丢失

隔离库：`migration-reconciliation-phase5`（`ep-orange-smoke-*`）  
命令：`ALLOW_HANDOFF_INTEGRATION_TEST=true npx tsx scripts/phase5b-handoff-integration.test.ts`

| 项 | 结果 |
|---|---|
| 并发 execute | **69 项中并发段全部通过**：1 completed handoff、1 delivery、模板任务不重复；另一路 `IN_PROGRESS` 结构化错误，无 P2002 |
| P2002 恢复 | 不向调用方暴露 P2002 / Unique constraint 原文 |
| 故障注入 | before_processing / after_delivery / after_source_link / after_first_task / after_all_tasks / on_audit_log / before_completed_update：事务回滚无残留；可安全重试 |
| after_completed_before_response | DB 保持 completed；重试回原 target |
| 响应丢失重试 | 二次 execute → 同 target、`created=false`、无第二项目 |

故障注入开关：`ALLOW_HANDOFF_FAULT_INJECTION` + `HANDOFF_FAULT_POINT`（禁止 production；无公开 API 参数）。

---

## 6. 数据完整性

脚本：`scripts/verify-phase5-data-integrity.ts`

| 库 | BLOCKER | WARNING |
|---|---|---|
| 隔离分支 | 0 | 1（done 缺 completedAt，n=2，历史） |
| 共享库 | 0 | 同左 |

---

## 7. 隔离分支 migrate status

`Database schema is up to date!`（85 migrations）

---

## 8. TypeScript / ESLint / Build

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | 通过 |
| eslint（本阶段相关文件） | 通过 |
| `npm run build` | 通过；日志无 migrate deploy |

---

## 9. Runbook / 备份 / 回滚

| 项 | 路径或方案 |
|---|---|
| Runbook | `docs/PHASE5_PRODUCTION_MIGRATION_RUNBOOK.md` |
| 生产备份 | 发布前新建 Neon branch `pre-phase5-prod-<date>`（parent=production） |
| 回滚 | 停交接 → 回滚应用 → 保留 DB 结构；不优先 DROP |

---

## 10. 剩余风险

1. **空库 migration 链历史顺序断裂**（发布 Gate 阻塞）  
2. Baseline 重复行（不阻塞，需独立窗口）  
3. 共享库与生产数据分叉（发布必须以 production 为准）  
4. Bid Data 未完整进入 Prisma schema  
5. done 缺 completedAt 历史 WARNING  

---

## 11. 为何不是 READY_WITH_APPROVED_EXCEPTIONS

空库重放失败属于标准中的 **硬阻塞**，不是「非关键测试豁免」。向前迁移证据充分，但 Gate 条文要求空库链成功。

解除阻塞前需要：独立 baseline/greenfield 治理方案落地并复验空库 deploy，再重开发布门。  
