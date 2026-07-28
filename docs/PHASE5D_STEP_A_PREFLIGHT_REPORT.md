# Phase 5D Step A — 生产 Migration 预检报告

**阶段：** Step A（只读生产 + 备份分支预演）  
**日期：** 2026-07-28（UTC）  
**结论：** `READY_FOR_EXPLICIT_PRODUCTION_APPROVAL`  
**本阶段未执行：** 生产 `migrate resolve` / `migrate deploy` / 任何生产 DDL / Phase 6

依据：`docs/PHASE5_PRODUCTION_MIGRATION_RUNBOOK.md`

---

## 1. 发布代码

| 项 | 值 |
|---|---|
| Branch | `feat/ops-bids-workspace-phase1` |
| HEAD commit | `9c4f9b385967e44b50576f579379b498ba62b8b1` |
| Phase 5C commit（祖先） | `f04b88aadf56f588fce6e00a4c324a90b7499081` |
| Hash 回填 commit | `9c4f9b385967e44b50576f579379b498ba62b8b1` |
| 工作区 | **无未提交 migration / Schema 修改**；仅有未跟踪预检脚本 `scripts/phase5d-preflight-readonly.ts`（不阻塞） |
| `verify:migration-history` | 23 passed, 0 failed |

### Active migration checksum（完整，与清单一致）

| Migration | SHA-256 | 结果 |
|---|---|---|
| `00000000000000_greenfield_baseline_pre_phase4` | `f1e3c211dc44a08df70a2b19a61ea569b3501844c2fa845c6cc636938d813093` | MATCH |
| `20260728120000_project_work_domain` | `194cf361ad0281cbf961a9dfe963807a9c92da656786afe03c8e3e1569b4696a` | MATCH |
| `20260728180000_project_handoff` | `6581b9056fb1f5537e497ac204505fa71e76e2596adb0abd2ae7743940a9784b` | MATCH |

---

## 2. 生产数据库身份（脱敏）

| 项 | 值 |
|---|---|
| Neon Project 名称 | 青砚-AI工作助手 |
| Neon Project ID | `polished-thunder-16018212` |
| Org | `org-autumn-pine-10800773` |
| Branch 名称 | `production` |
| Branch ID | `br-green-boat-ann7k5yf` |
| Endpoint（脱敏） | `ep-super-field-antf…`（完整前缀 `ep-super-field-*`，与 Runbook 一致） |
| Region | `aws-us-east-1` |
| Database | `neondb` |
| 连接用户 | `neondb_owner` |
| PostgreSQL | 17.x |

**身份确认：** 目标为 Runbook 记录的生产 endpoint `ep-super-field-*`。未误连共享库 `ep-raspy-credit-*`。

**注意：** 预检时本机 `.env` 的 `DATABASE_URL` 亦指向 `ep-super-field-*`。Step B 前须再次确认部署管道所用连接串，且任何 migrate 必须走双确认受控脚本；不得依赖普通 `build`。

未输出完整 `DATABASE_URL`、密码或 token。

---

## 3. 生产备份分支

| 项 | 值 |
|---|---|
| 名称 | `prod-pre-phase45-backup-20260728-2228` |
| Branch ID | `br-orange-river-an55s52x` |
| Parent | `production` / `br-green-boat-ann7k5yf` |
| Parent LSN | `0/1A767128` |
| 创建时间 | `2026-07-28T22:29:47Z` |
| 创建者 | Lucas（neonctl / console） |
| 数据时间点 | 创建时生产快照（parent LSN 如上） |
| Endpoint（脱敏） | `ep-shiny-pine-anky…` |
| 状态 | `ready`；可连接；关键表可读 |
| 历史备份 | **未删除**任何既有备份 / cutover 分支 |

---

## 4. 生产基线数据（只读，无客户敏感正文）

| 表 | 数量 |
|---|---|
| Organization | 12 |
| User | 18 |
| OrganizationMember | 25 |
| Project | 13 |
| Task | 138 |
| TaskActivity | 16 |
| AuditLog | 1749 |
| ProjectHandoff | **NOT_PRESENT** |
| BidDataRevision | 2 |
| TenderRequirement | 0 |
| ProductEvidence | 2 |
| PricingScenario | 2 |
| PricingScenarioLineItem | 0 |

### Task 状态分布

| status | n |
|---|---|
| todo | 123 |
| done | 10 |
| cancelled | 3 |
| in_progress | 2 |

### Project 投标相关分布

| 指标 | n |
|---|---|
| tenderStatus 非空 | 7 |
| solicitationNumber 非空 | 5 |
| 有 BidDataRevision 关系的项目 | 1 |

### Phase 4/5 结构（生产当前）

| 对象 | 状态 |
|---|---|
| `Project.workDomain` | ABSENT |
| `ProjectHandoff` | ABSENT |
| Task 来源列（`sourceType` 等） | ABSENT（Phase 5 未部署） |

---

## 5. 生产 migration history

`prisma migrate status`（生产，只读）：

- 本地 active 链 3 条与 DB 历史**无共同点**（`last common migration: null`）— 符合 greenfield cutover 预期
- Pending（本地视角）：baseline + Phase4 + Phase5
- DB 侧仍保留全部 legacy 记录（约 84 行 / 含重复名）

| 检查项 | 结果 |
|---|---|
| 旧 migration 记录存在 | 是（末条 `20260728010000_task_waiting_blocked_fields`） |
| 旧 `baseline_before_launch` 重复 | 2 行（1 rolled_back + 1 finished）— 与 Phase 5C / `BASELINE_MIGRATION_DUPLICATE_ASSESSMENT.md` **情况 B** 一致 |
| 新 greenfield baseline 已登记 | **否** |
| Phase 4 已登记 | **否** |
| Phase 5 已登记 | **否** |
| failed（finished=null 且未 rollback） | **0** |
| rolled-back-but-unresolved（已知 baseline 历史痕迹） | 1 行（评估为非阻塞） |
| 未知新 migration | **无** |

预检阶段**未**运行 `migrate resolve`。

---

## 6. Schema 与 Baseline 等价

比较：生产当前结构 ↔ `prisma/baseline/schema.pre-phase4.prisma`

| 方向 | 结果 |
|---|---|
| `migrate diff --from-url <prod> --to-schema-datamodel baseline` | **empty migration**（无 DDL） |
| `migrate diff --from-schema-datamodel baseline --to-url <prod>` | 仅建议 `CREATE EXTENSION IF NOT EXISTS "plpgsql" … VERSION "1.0"` |

### 核对摘要

| 维度 | 结论 |
|---|---|
| 核心表 / 列类型 / nullability / 默认值 / PK / FK / unique / index | 与 baseline **等价**（forward diff 空） |
| Bid Data 表 | 存在且纳入 baseline（如 BidDataRevision 等） |
| vector extension | 生产有 `vector`（及 `plpgsql`） |
| view / trigger / policy | 业务侧 0（与 Phase 5C 文档一致） |
| public functions | 主要为 vector 扩展函数族（计数约 118，非业务自定义） |
| Phase 4 字段 | **尚不存在** |
| Phase 5 表/字段 | **尚不存在** |

### 已知非阻塞差异

1. **Reverse diff 的 plpgsql VERSION pin** — Prisma 元数据差异，不构成结构漂移；不阻塞 resolve。  
2. **正式 `schema.prisma` 未完整建模 Bid Data / 部分 AgentTask 超集列** — 已在 Phase 5C 文档化；DB 与 baseline 一致。  
3. **旧 `_prisma_migrations` 重复 baseline 行** — 情况 B，允许与 greenfield 共存；不 DELETE。

**无未解释结构差异 → 允许在批准后 resolve baseline。**

---

## 7. 备份分支发布预演（仅 backup）

目标：`ep-shiny-pine-*` / `prod-pre-phase45-backup-20260728-2228`（**非**生产）

### 7.1 Resolve

```text
prisma migrate resolve --applied 00000000000000_greenfield_baseline_pre_phase4
→ Migration marked as applied.
```

之后 status：pending **仅**  
`20260728120000_project_work_domain`、`20260728180000_project_handoff`

### 7.2 Deploy

```text
ALLOW_DATABASE_MIGRATION=true npm run db:migrate:deploy
→ Applying 20260728120000_project_work_domain
→ Applying 20260728180000_project_handoff
→ Database schema is up to date!
```

未执行任何未知 migration。

### 7.3 预演验证

| 检查 | 结果 |
|---|---|
| Task / Project / User / Organization 数量（deploy 后、集成测前） | 138 / 13 / 18 / 12 — **未异常变化** |
| workDomain 回填 | `tender: 11`, `general: 2`；非法/NULL = 0 |
| ProjectHandoff 表 | 存在；索引与 FK 齐全 |
| Task 来源列 | `sourceType` / `sourceId` / `sourceBatchKey` / `sourceTemplateKey` + 索引 |
| migrate status | up to date |
| `verify-phase5-data-integrity` | **BLOCKER=0**；WARNING=1（既有：done 缺 completedAt，n=2） |
| Handoff 集成（备份，非客户交接） | **69/69**；测后关键业务计数回到 13/138（测试数据清理） |
| `npm run build` | 成功；路由含 `/ops`、`/ops/projects`、`/bids`、`/tasks`；**未**跑 migrate |

### 7.4 生产未触碰（预演后复验）

| 检查 | 生产 |
|---|---|
| greenfield / Phase4 / Phase5 登记 | 无 |
| `Project.workDomain` | 仍 ABSENT |
| `ProjectHandoff` | 仍 ABSENT |
| migrate status pending | 仍为 baseline + P4 + P5 |

---

## 8. 发布窗口与职责（建议）

| 项 | 建议 |
|---|---|
| 建议窗口 | 工作日低流量时段（例如美东工作日 09:00–11:00 或业务方指定窗口）；需批准人与执行人同时在线 |
| 是否需短暂停写 | **建议**暂停新 Handoff、Project 关键结构写入、Task Schema 相关批量操作、管理员 DDL；migration 本身为向前兼容新增字段/表，旧应用可读，但停写可降低竞态 |
| 预计步骤 | ① 再确认 commit/checksum/无 drift ② 停写 ③ 生产 resolve baseline ④ 受控 `db:migrate:deploy` ⑤ 完整性检查 ⑥ 部署应用（仅 generate+build）⑦ smoke |
| 执行人 | （待填，默认：发布执行工程师） |
| 批准人 | （待填，默认：产品/技术负责人） |
| 日志观察 | （待填） |
| 回滚决策人 | （待填） |
| 观察窗口 | 迁移成功后至少观察 **数小时至一个业务日**；不自动进入 Phase 6 |

不承诺未经实测的精确 DDL 耗时。备份预演中 resolve+deploy 在秒级完成，但生产负载与锁等待可能更长。

---

## 9. 回滚路径（明确）

| 场景 | 动作 |
|---|---|
| Resolve 后、Deploy 前失败 | **停止**；不 deploy；不擅自 DELETE baseline 行；按 Runbook 制定恢复 |
| Deploy 中失败 | 不盲目重跑；查 status / 部分 DDL；**禁止** reset / 改 checksum / 删 `_prisma_migrations` |
| Migration 成功、应用异常 | 停新 Handoff → **回滚应用版本** → **保留**向前兼容 DB → 调查；不立即 DROP `ProjectHandoff`/字段 |
| 灾难恢复 | 保留备份分支 `prod-pre-phase45-backup-20260728-2228`；可对照或按 Neon 流程恢复（独立批准） |

---

## 10. Step A Gate

### READY 条件核对

| # | 条件 | 状态 |
|---|---|---|
| 1 | 生产身份确认 | ✅ |
| 2 | 备份 branch 创建成功 | ✅ |
| 3 | 数据基线已记录 | ✅ |
| 4 | migration history 与预期一致 | ✅ |
| 5 | Schema 与 baseline 等价 | ✅ |
| 6 | 备份 resolve 成功 | ✅ |
| 7 | 备份 Phase 4/5 deploy 成功 | ✅ |
| 8 | 数据数量未异常变化（deploy 后） | ✅ |
| 9 | 完整性无 BLOCKER | ✅ |
| 10 | 应用 build + smoke（路由/完整性/handoff 集成） | ✅ |
| 11 | 回滚路径明确 | ✅ |

### 结论

```text
READY_FOR_EXPLICIT_PRODUCTION_APPROVAL
```

**已暂停。不进入 Step B。**

---

## 11. 进入 Step B 所需的明确批准格式

仅在收到**完整**人工指令后执行生产 migration，格式须包含：

```text
批准执行生产 migration。
目标生产 branch：production
备份 branch：prod-pre-phase45-backup-20260728-2228
发布 commit：9c4f9b385967e44b50576f579379b498ba62b8b1
```

缺少任一项 → **不得**执行。

Step B 仍禁止：擅自进入 Phase 6；在应用部署阶段再次跑 migrate；删除旧 `_prisma_migrations` 行。
