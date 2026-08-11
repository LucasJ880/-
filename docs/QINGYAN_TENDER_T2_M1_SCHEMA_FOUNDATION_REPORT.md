# Qingyan Tender T2-M1 — Schema Foundation 实施报告

| 项 | 值 |
|---|---|
| 分支 | `feature/tender-t2-m1-schema-foundation` |
| Base main SHA | `3b6406b9afe7316369d6b80e60b2269de55f6f48`（= PR #96 architecture merge commit,main 无更新 commit） |
| #96 architecture merge SHA | `3b6406b9afe7316369d6b80e60b2269de55f6f48`（#96 head `015e35b` 已验证为 main ancestor） |
| 日期 | 2026-08-11 |
| 性质 | **T2-M1 Schema Foundation**:仅四张新表;零 producer、零读面、零回填、零双写、零 runtime 改动 |
| Source of Truth | `docs/QINGYAN_TENDER_T2_LEDGER_ARCHIVE_PREFLIGHT.md`（PR #96 Final Contract Micro-Fix Review 后版本） |

---

## 1. Schema 变更

`prisma/schema.prisma`:文件尾部**纯追加** +165 行(单一 diff hunk,`@@ -6811,3 +6811,168 @@`),新增独立 section「Tender T2-M1 — Project Ledger / Cost / Archive Foundation」。**既有模型零改动**(刻意未运行全局 `prisma format`——既有 `MarketingMetricSnapshot` 在 main 上即非 format-clean,全局 format 会引入无关 cosmetic 重排;新增 section 自身 format-clean)。

四个新模型(字段与 #96 Final Contract §5.2/§6.3/§7.3/§9.2 逐项一致):

| 模型 | 角色 | 行为契约(schema 支持,producer 阶段实施) |
|---|---|---|
| `ProjectEvent` | AUTHORITATIVE BUSINESS LEDGER(append-only) | 无 update/delete 路径;修正 = 新事件 `correctionOfEventId` → 旧事件;seq 分配 = eventKey 幂等短路 → max(seq)+1 → P2002 有界重试(8) → 耗尽 THROW 随业务事务回滚 |
| `ProjectEventActor` | 事件参与人集合(一个业务事实 + 多参与者) | `actorType/actorId` = 记账人;Actor 行 = 参与者;唯一内部 FK |
| `ProjectCost` | 当前权威成本域记录 | PLANNED→COMMITTED→ACTUAL 三金额列填充留痕;实质修改 = `revisionCount` 自增 + 未来 `cost.revised` 事件(`cost:{costId}:revision:{revisionCount}`);ACTUAL 后 = void + correction 新行;**AI 成本不入本表**(AiUsageLedger 仍是唯一权威) |
| `TenderArchiveItem` | Source Snapshot Contract v1(证据不可变) | 证据字段 create-only;内容变化 = 新快照 + `supersedesSnapshotId`(新→旧);`accessClass` 为治理元数据例外(未来受权通道修改,分级变更不复制快照);`capturedAt` **无 default**(采集时刻显式传入) |

### SCHEMA_IMPLEMENTATION_DEVIATION

**无语义偏差。** 两处纯表达层说明:①字段注释按 repo 惯例压缩为短句(详细设计留在 Preflight 文档,任务书 §37);②`quantity Decimal(12,3)` / `unitRate Decimal(18,4)` 为 repo 新精度组合(既有仅 18,2/18,6/5,2)——按 Final Contract 冻结值原样实现,未向既有精度靠拢(WHY:契约值优先于精度集合一致性,且 repo 对 `@db.Decimal` 无统一约束)。String 词表字段**全部保持 String**(repo 全库仅 1 个 enum,策略 = String + server validation,任务书 §22 满足,零新 enum)。

## 2. 唯一约束与索引

| 约束 | 职责 |
|---|---|
| `ProjectEvent @@unique([projectId, seq])` | 顺序唯一性(全序号不重不漏) |
| `ProjectEvent @@unique([projectId, eventKey])` | 业务幂等(同一动作实例至多一条) |
| `ProjectEventActor @@unique([eventId, actorKey])` | 参与人去重 |
| `TenderArchiveItem @@unique([orgId, projectId, captureKey, contentHash])` | 同观察幂等 |
| `TenderArchiveItem @@unique([orgId, projectId, captureKey, snapshotVersion])` | 版本序完整性(**真 UNIQUE 约束**,非 index) |

索引 17 个,与 Final Contract 一致:Ledger 读路径(`[orgId,projectId,occurredAt]`/`[projectId,eventType,occurredAt]`/related 两列/People 贡献 `[orgId,actorType,actorId,occurredAt]`/traceId/correction 链)、Cost 聚合(`[orgId,projectId,costStatus]`/`[projectId,category]`/`[orgId,incurredById,incurredAt]`/correction 链)、Archive(`[orgId,contentHash]` 跨项目同件/`[projectId,kind,capturedAt]`/supersedes 链)、Actor(`[orgId,userId]`/`[orgId,actorKey]`)。

## 3. FK 决策

- **对外零 FK**(信息模式核验:四表合计恰 1 条 FK):`ProjectEvent`/`ProjectCost`/`TenderArchiveItem` 不 FK Project/User/ProjectDocument——业务对象硬删 ≠ 账本/证据消失(#96 §15.2/§15.8;AuditLog 摘挂与 Document Cascade 蒸发的双重教训)。`projectDocumentId`/`correctionOfCostId`/`supersedesSnapshotId`/`relatedDocumentId` 等全部为无约束引用列。
- **唯一内部 FK**:`ProjectEventActor.eventId → ProjectEvent.id`,`onDelete: Restrict`(SQL `ON DELETE RESTRICT` 已核验)——事件原则上不可删除,禁止经 Actor 关系级联抹史。
- **零 Cascade**:migration SQL 中不存在任何 `ON DELETE CASCADE`。

## 4. 租户边界

四表 `orgId` 全部 `NOT NULL`(DB 级核验:raw SQL 插入 NULL orgId 四表全部被 23502 拒绝)。

```
TENANT_SCHEMA_BOUNDARY      = PRESENT(列级强制非空)
TENANT_SERVICE_ENFORCEMENT  = FUTURE_PRODUCER_RESPONSIBILITY
```

orgId 存在 ≠ 自动安全:org-scope 查询过滤、授权(含 §15.8 孤儿行 org 级特权残余路径)全部是 producer/读面阶段的服务层责任,本轮不夸大。

## 5. 删除 / 留存语义

- 项目硬删(现状仍存在)不触及四表任何行——无 FK 无 Cascade,账本与证据存活。
- `DELETION_GATING`(项目删除收敛 soft-delete)= **T2-P1 前置条件,非 M1 blocker**;M1 未实现 Project soft-delete(遵任务书 §19)。
- ProjectEvent/TenderArchiveItem 的 no-update/no-delete 纪律是 **service 层未来责任**:`SCHEMA_SUPPORTS_IMMUTABILITY = YES`;`IMMUTABILITY_RUNTIME_ENFORCED = 留待 producer/archive PR`(任务书 §27,不伪称)。

## 6. Migration

`prisma/migrations/20260811002000_add_tender_t2_ledger_archive_foundation/migration.sql`(166 行):

- 4× `CREATE TABLE` + 17× `CREATE INDEX` + 5× `CREATE UNIQUE INDEX` + 1× `ALTER TABLE "ProjectEventActor" ADD CONSTRAINT … ON DELETE RESTRICT`(对**新表自身**加 FK)。
- **零**对既有表的 ALTER;**零** DROP;**零** RENAME;**零**数据回填/改写。纯 additive。
- 生成方式:`prisma migrate diff --from-schema-datamodel(HEAD schema) --to-schema-datamodel(新 schema) --script`。

## 7. 隔离 Neon 演练(生产快照子分支;已删除,零遗留资产)

| 分支 | 用途 | 结果 |
|---|---|---|
| `preview-t2-m1-rehearsal`(`br-noisy-darkness-anrbzgsu`,生产 project `polished-thunder-16018212` 子分支,host 非生产) | migrate deploy 演练 + 约束测试 + rollback 演练 | 全部通过后删除 |
| `preview-t2-m1-testall`(`br-delicate-leaf-an7xml2l`,同上) | test-all DB 平面 | 用毕删除 |

**演练序列**:①`prisma migrate deploy` 首次运行暴露**既有生产迁移态问题**(见 §17-G1)→ ②按 Prisma 标准 `migrate resolve --applied 20260805090000_marketing_economics` 后 deploy 干净落地,仅应用 `20260811002000_add_tender_t2_ledger_archive_foundation` → ③29 项约束测试全过(§8)→ ④**rollback 演练**:按 Preflight §15.5 文档化回滚(DROP 四表 + 删迁移记录)后,既有表抽查完好(public 表计数回到 244,Project/AuditLog/ProjectDocument/AgentRunEvent 在位),re-deploy 干净重放 → ⑤分支删除。

## 8. 约束测试(`scripts/tender-t2-m1-isolated-migrate-verify.ts`,任务书 §26 A–L,29 checks ALL PASS)

| 项 | 结果 |
|---|---|
| A 四表创建 | PASS×4 |
| B 既有表完好(Project/AuditLog/ProjectDocument/TenderAnalysisRun/AgentRun/AgentRunEvent/AiUsageLedger/ProjectMessage) | PASS×8 |
| FK 全景(四表恰 1 FK,RESTRICT) | PASS×2 |
| C `(projectId,seq)` 重复拒绝 | PASS |
| D `(projectId,eventKey)` 重复拒绝 | PASS |
| E `(eventId,actorKey)` 重复拒绝 | PASS |
| F 被 Actor 引用的 Event 删除被 Restrict 拒绝 | PASS |
| G `(captureKey,contentHash)` 重复拒绝 | PASS |
| H `(captureKey,snapshotVersion)` 重复拒绝 | PASS |
| I 同 contentHash + 不同 captureKey 允许多行 | PASS |
| J Decimal 精度(120.505 / 0.6825 / 12345678901234.56 精确回读) | PASS×3 |
| K orgId NOT NULL(raw SQL 绕过 client 层,四表全拒) | PASS×4 |
| L 无 Project FK 依赖(不存在的 projectId 可插入) | PASS |

另有静态契约测试 `src/lib/tender/__tests__/t2-m1-schema-contract.test.ts`(5 tests,无 DB,已接入 test-all):守护双唯一/Restrict/revisionCount/capturedAt 无 default/新→旧 supersedes 方向/migration 纯 additive(禁 DROP、禁对既有表 ALTER、恰四表)。

## 9. Prisma 校验

- `prisma validate`:valid ✅(worktree 无 .env,以占位 env 提供 DATABASE_URL/DIRECT_URL——validate 只需变量存在)
- `prisma generate`:✅ 四模型 client 正常生成(`projectEvent`/`projectEventActor`/`projectCost`/`tenderArchiveItem` 均可实例化)

## 10. 回归

- **test-all**(隔离生产快照分支,`DATABASE_URL+DIRECT_URL+NODE_ENV=test+DATABASE_ENVIRONMENT=isolated`):见 PR 描述回归段(执行于本报告提交前,结果以 PR 记录为准)
- **tsc --noEmit**:test-all 内含
- **eslint**:新增两文件零 findings;全库 51 errors/116 warnings 与 base 一致(99 个报错文件与本 PR 变更集**零交集**,全部基线噪声)
- **build**(`prisma generate + check-preview-db-isolation + next build`):见 PR 描述回归段

## 11–16. 影响面声明

```
SCHEMA_CHANGE               = FOUR_NEW_TABLES_ONLY
EXISTING_TABLE_ALTERATION   = NONE
PRODUCTION_DATA_MUTATION    = NONE（生产库零接触；演练全部在子分支）
PRODUCTION_BEHAVIOR_CHANGE  = NO（表存在但无任何业务写入者/读者）
RUNTIME_IMPACT              = NONE（Workforce/AgentRun/tender-auto-analysis 零改动）
PROJECT_EVENT_PRODUCERS     = 0
PROJECT_COST_PRODUCERS      = 0
ARCHIVE_CAPTURE_PRODUCERS   = 0
NEW_UI_READERS              = 0
DUAL_WRITE_ACTIVE           = NO
BACKFILL_EXECUTED           = NO
```

变更集:`prisma/schema.prisma`(纯追加)、migration 文件、`scripts/tender-t2-m1-isolated-migrate-verify.ts`(隔离验证工具,DATABASE_ENVIRONMENT=isolated 门闸)、`src/lib/tender/__tests__/t2-m1-schema-contract.test.ts`、`scripts/test-all.sh`(+1 行接线)、本报告。**无任何 production runtime 代码。**

## 17. Known Future Gates / 发现登记

| # | 项 | 说明 |
|---|---|---|
| **G1** | **生产迁移态前置(本次演练的关键发现)**:生产库 `_prisma_migrations` 存在一条**先前失败的记录** `20260805090000_marketing_economics`(started 未 finished、未 rolled back;表实际已存在)。**当前生产上任何 plain `prisma migrate deploy` 都会被此记录阻塞**(重放该迁移 → `42P07 relation already exists`,两个隔离分支均复现)。M1 部署前必须由运维按既有 safe-migrate 流程先执行 `prisma migrate resolve --applied 20260805090000_marketing_economics`(隔离分支两次验证该解法后 deploy 干净)。**属既有生产状态问题,与 M1 无关,本轮未触碰生产。** |
| G2 | `DELETION_GATING`(项目删除收敛 soft-delete)= T2-P1 前置(#96 §15.8),独立小 PR |
| G3 | `SECURITY_PRECONDITION`(R5 报价授权)= T2-P2 quote/supplier producer 前置(#96 §18),独立 SECURITY-P0.x PR |
| G4 | seq allocator / cost 状态机 / archive capture 的 service 层纪律(THROW 不吞错、no-update/no-delete)= 各 producer PR 的评审红线;M1 未创建任何 service/类型/常量(任务书 §8) |
| G5 | staging project(`super-scene-97779903`)schema 落后于当前 migrations 链——与 M1 无关,但未来以 staging 为基的测试需 `db push` 对齐(既有已知态) |

## 18. T2-P1 Blockers / Prerequisites

```
T2-P1 开始前（全部为已冻结前置,M1 不解锁其任何一项）：
  1. 本 PR 人工 Final Review + merge
  2. 生产 migrate deploy（经 safe-migrate 流程；前置 G1 resolve）
  3. DELETION_GATING PR 合入（G2）
  4. producer 实现逐 PR 评审（首批仅 stage/result/abandon/go-no-go 四点,#96 §17.2）
T2_P1_AUTOSTART = NO
```

*T2-M1 至此完成:Draft PR + 隔离演练 + 测试 + 报告。STOP,等待人工 Final Review。*
