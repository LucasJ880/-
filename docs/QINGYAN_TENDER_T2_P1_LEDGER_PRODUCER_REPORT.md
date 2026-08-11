# Qingyan Tender T2-P1 — Authoritative Ledger Producer Foundation 实施报告

| 项 | 值 |
|---|---|
| 分支 | `feature/tender-t2-p1-ledger-producer-foundation` |
| Starting main | `b27f0ae`（初始）；Final Review remediation 已 rebase 到 `42c4f15`（含 #97 tender-eval benchmark v1；#96/#99/#101/#97 ancestry 均已验证） |
| 日期 | 2026-08-11 |
| Source of Truth | `docs/QINGYAN_TENDER_T2_LEDGER_ARCHIVE_PREFLIGHT.md`（#96 Final Contract）+ M1 报告 |
| 性质 | `SCHEMA_CHANGE = NONE` · `PRODUCTION_DATA_MUTATION = NONE` · `BACKFILL_EXECUTED = NO` · `DUAL_WRITE_ACTIVE = NO` · `WORKFORCE_RUNTIME_MODIFIED = NO` · `TENDER_UNDERSTANDING_V2_MODIFIED = NO` |

## 1. Executive Summary

建立了 ProjectEvent/ProjectCost 的**唯一权威写入服务**(`src/lib/project-ledger/`),按 #96 冻结契约实现 eventKey 幂等短路 → max(seq)+1 → P2002 有界重试(8) → 耗尽 THROW → 业务事务整体回滚;接入首批 4 个低风险 lifecycle producer(project.created/updated/member.added/member.removed,全部在既有事务内、flag 默认 OFF 保持 dark);完成 **Deletion Gate**(既有 `status="archived"` 生命周期为 OPTION A 授权锚 + 硬删路由账本存量拒绝);隔离 Neon(生产快照子分支)实测 **纯逻辑 10/10 + DB 矩阵 34/34** 全绿(含并发 2/5/10 竞争收敛、原子回滚、跨 org 拒绝)。生产库尚无 M1 四表且迁移态仍 BLOCKING → `PRODUCTION_ACTIVATION_GATE = BLOCKED`,producer 保持 dark code。

## 2. Starting Main / Branch

`git fetch origin` 后 origin/main = `b27f0ae`;`#96(3b6406b)`/`#99(9efcfa4)`/`#101(b27f0ae)` 逐一 `merge-base --is-ancestor` 验证通过。分支自 latest main 创建,与 V2 lane(#97/#100)零堆叠。

## 3. Scope

见任务书 §0;本轮交付 = Deletion Gate + canonical services + 4 producers + 测试矩阵 + 隔离验证。禁区(V2/T1B rollout/Archive capture/Quote/Backfill/Dual-write/Workforce)全部未触碰。

## 4. M1 Contract Verification

静态契约测试 `t2-m1-schema-contract.test.ts` 5/5(双唯一/Restrict/revisionCount/capturedAt 无 default/migration 纯 additive);四模型在 schema 中在位;`PROJECT_FK_CREATED = NO`、`DOCUMENT_FK_CREATED = NO` 复核通过。**本轮 `prisma/schema.prisma` 与 `prisma/migrations/` 零改动(`SCHEMA_CHANGE = NONE`)。**

## 5. Production Migration Readiness(read-only audit,生产零写入)

| 项 | 实测 |
|---|---|
| `PRODUCTION_M1_SCHEMA_STATUS` | **NOT_PRESENT**(生产 `pg_tables` 无四表) |
| `MARKETING_ECONOMICS_MIGRATION_STATE` | **BLOCKING**——较 M1 演练时状态**又有变化**:先前的失败记录已被人工**删除**(`_prisma_migrations` 无该行),但迁移未标记 applied 而 `MarketingEconomicsSetting` 表实际存在 ⇒ 任何 plain `migrate deploy` 仍会尝试重放该迁移 → `42P07 already exists` 再次失败。正确解法不变:`prisma migrate resolve --applied 20260805090000_marketing_economics`(本轮又在 P1 隔离分支上第三次验证:resolve 后 deploy 干净落地 M1) |
| 后果 | `PRODUCTION_ACTIVATION_GATE = BLOCKED`;producer 必须 dark(§20) |

### 5.1 生产 migrate 前置 runbook（本轮不对生产执行任何写操作）

`prisma migrate resolve --applied 20260805090000_marketing_economics` 是把「未标记 applied 但表已存在」的迁移标记为已应用——**它不比对表结构、不修表**。因此 resolve 前必须先做一次**只读结构核对**,确认生产实际的 `MarketingEconomicsSetting`(及该 migration 涉及的其它对象)与 migration `20260805090000_marketing_economics/migration.sql` 定义**等价**:

```
1. 只读读取生产 information_schema（列名/类型/nullable/默认/索引/约束），
   与 migration.sql 的 CREATE 语句逐项比对。
2. 仅当结构等价（表已按该 migration 建成、无缺列/类型漂移）时，才执行:
     prisma migrate resolve --applied 20260805090000_marketing_economics
   随后按既有 safe-migrate 流程 deploy（M1 = 20260811002000_...）。
3. 若结构不等价（缺列/漂移/部分应用）→ 停止,转人工设计修复,禁止 resolve
   （resolve 会把不一致状态“钉死”为 applied,后续 deploy 将跳过真正需要的补齐）。
```

**本轮仅为 runbook 文档**:未对生产 DB 执行 resolve/deploy/任何写操作(`PRODUCTION_DB_MUTATION = NO`)。隔离分支上的 resolve+deploy 仅证明解法有效,不代表生产已处理。

## 6. Deletion Gate(DELETION_GATING = PASS)

- **现状核查**:Project 支持 hard delete(`DELETE /api/projects/[id]`,项目写权限即可);既有生命周期词表含 `status="archived"`(「已归档」,`src/lib/projects/lifecycle.ts` 一等过滤态,行/orgId/成员关系全保留)与 `status="abandoned"`——**OPTION A 的 soft anchor 已存在,无需 migration**。
- **本轮实现**:硬删路由前置账本存量闸——项目存在任一 ProjectEvent/ProjectCost/TenderArchiveItem 行 ⇒ `409 PROJECT_HAS_LEDGER_HISTORY`,引导改用归档;无历史项目仍可照常删除。静态测试锁定 gate 必须先于 `tx.project.delete`。
- **Dark-merge 安全(Final Review remediation)**:该存量闸的 M1 表查询**整体门控于 `T2_LEDGER_PRODUCERS_ENABLED`**。生产 M1 schema 未上线(NOT_PRESENT)时 flag 默认 OFF → DELETE **完全不访问** ProjectEvent/ProjectCost/TenderArchiveItem,删除行为与 T2 前逐字节一致(修复前无条件查询会命中不存在的表 → 违反"flag OFF 行为不变")。flag ON → 查询执行,有历史 → 409。由 DEL-DARK-01(spy 委托证明 0 次 M1 访问)/ DEL-ACTIVE-01 / DEL-ACTIVE-02 三组真实路由测试锁定。
- **DELETION_ANCHOR = Project.status="archived"(既有生命周期态)**;残余清理(孤儿行 org 级特权访问)= `DELETION_RESIDUAL_CLEANUP = DESIGN_ONLY`(#96 §15.8 契约在案,本轮无实现需求——账本行在项目归档下全程可读,DEL-01 实证)。

## 7. Legacy Event Store Decision(GATE = PASS)

#96 已完成 26 套存量存储判决;P1 复核结论:**repo 内不存在第二个满足权威账本判据的系统**(AuditLog=可变摘挂/orgId 可空/无幂等 → KEEP_AS_TECHNICAL_AUDIT;ProjectMessage(SYSTEM)=人类叙事流 → presentation;TaskActivity/域日志=窄域)。权威关系冻结:

```
ProjectEvent            = authoritative business ledger（唯一）
AuditLog                = technical audit（producer 沿既有行为继续写,用途不同非双账本）
ProjectMessage(SYSTEM)  = presentation/operational history（既有 helper 继续,未来 DERIVED_ONLY）
```

**无 blind dual-write**:P1 未新增任何 legacy 写入点;producer 只在既有事务内追加 ProjectEvent。

## 8. ProjectEvent Architecture

`src/lib/project-ledger/`:`types.ts`(错误类/词表)、`event-keys.ts`(确定性 key)、`event-service.ts`(**唯一** canonical append + 最小 read)、`cost-service.ts`、`flags.ts`。业务代码禁止直接 `prisma.projectEvent.create`(静态测试锁定四 producer 文件零直写;canonical service 是唯一调用点)。

**实现说明(忠实于冻结契约的 Postgres 落法)**:事务内约束冲突会毒化外层事务,因此每次 create 包在 `SAVEPOINT` 中;P2002 时 `ROLLBACK TO SAVEPOINT` 后按 `meta.target` 分流(eventKey 命中→幂等返回既有行;seq 命中→重读 max 重试)。语义与 #96 §5.6 逐条一致:BOUNDED(8)/DETERMINISTIC/FAIL TRANSACTION/NO SILENT LOSS。

## 9. EventKey Contract(全部 deterministic/server-authored;零 random/wall-clock)

| 动作 | eventKey | retry 稳定性来源 |
|---|---|---|
| project.created | `project.created:{projectId}` | projectId 即动作身份 |
| project.updated | `project.updated:{projectId}:{sha256(prevUpdatedAt+changedFields+afterSubset)[:24]}` | 前置行 updatedAt(持久化先前状态)——同逻辑动作重试同 key;A→B→A→B 第三次因前置不同得新 key |
| project.member.added/removed | `project.member.{kind}:{membershipRowId}:v{n}`,n=事务内账本前缀计数+1 | 行复用(加入→移除→再加入)下每动作新 key;重试回滚后计数不变 |
| cost 状态 | `cost:{costId}:{STATUS}` | 每状态至多一次 |
| cost 修订 | `cost:{costId}:revision:{revisionCount}` | domain counter,同事务自增 |

## 10. Transaction Semantics(AUTHORITATIVE_EVENT_ATOMICITY = REQUIRED)

`tx` 为必传参数(类型+运行时双重强制,缺失 → LedgerContractError);四 producer 全部在**既有** `db.$transaction` 内追加;append 失败(租户/竞争耗尽/任何异常)→ THROW → 业务变更整体回滚(EV-06 实测:project.update + 错误 org append → 名称回滚 + 零事件残留)。全链路无 catch-swallow/return null/best-effort(静态断言锁定)。与 `logAudit` 事务外 best-effort 的既有行为刻意区分,后者不变。

## 11. ProjectEventActor

参与者行与事件同事务写入(实测);同 key 去重;actorKey 词表 `user:{id}`/`external:{name}`;M1 的 `ON DELETE RESTRICT` 保证事件不因参与关系误删。member.added producer 写入被加入者为 participant(记账人=操作者,分离语义)。actor 一律来自服务端 `user.id` 上下文;静态测试断言 producer 文件不读取 `body.actorId/actorType/eventKey/eventType`(EV-08)。

## 12. First Producers(FIRST_PRODUCERS = 4)

| Producer | 站点 | 状态 |
|---|---|---|
| project.created | `POST /api/projects`(主创建路由,既有 tx 内) | **PASS** |
| project.updated | `PATCH /api/projects/[id]`(既有 tx;真实 diff 才落账;payload = changedFields + 短字段白名单 before/after) | **PASS** |
| project.member.added | `POST /api/projects/[id]/members`(既有 tx) | **PASS** |
| project.member.removed | `DELETE /api/projects/[id]/members/[memberId]`(既有 tx) | **PASS** |

范围说明:仅接入主人工路由;`/api/v1/projects`(BidToGo intake)与 `/api/ops/projects` 创建路径**本轮不接**(独立 intake 语义,留 P2 显式评审——避免为凑数强行接入)。orgId 为 null 的 legacy 项目跳过落账(账本要求 org 租户;记录于 §21)。

## 13. ProjectCost Lifecycle(PROJECT_COST_SERVICE = PASS)

canonical service:`createProjectCost`(PLANNED / 直接 ACTUAL"记一笔")、`revisePlannedCost`、`commitProjectCost`(PLANNED→COMMITTED)、`actualizeProjectCost`(COMMITTED→ACTUAL)、`voidProjectCost`(任何态→VOIDED,+可选 correction 新行)。三金额列只填充不覆盖(COST-03/04 实测留痕);每步同事务落 cost.recorded/revised/committed/actualized/voided 事件。**无新 API/UI surface**(任务书 §19/§24):服务层 + 测试 + 受控 internal 调用;`AUTO_COST_PRODUCER = NO`;`COST_PERMISSION_MODEL = TEMPORARY_CONSERVATIVE`(调用方必须持有项目写上下文,未来 API 化时走 #95 门 + 保守 admin/project-write)。

## 14. ACTUAL Immutability(PASS)

ACTUAL 后:revise/commit/actualize 全部状态断言拒绝(COST-05 实测 CostLifecycleError);修正 = `voidProjectCost` + correction 新行(`correctionOfCostId` 指回,COST-06 实测);无任何直接金额覆盖路径。PLANNED 修订强制 `revisionCount+1` + cost.revised(payload 含 costId/revisionCount/changedFields/previousAmount/newAmount/previousCategory/newCategory,COST-02 逐字段断言);no-op 修订不产生事件。

## 15. Tenant Isolation(PASS)

append/read/cost 全部操作在事务内验证 `(projectId, orgId)` 归属;跨 org → `LedgerTenantError`(统一 not-found 语义,不泄露存在性)。实测:EV-06(错误 org 原子回滚)/EV-07(append+read 双向拒绝)/COST-07/DEL-04(跨 org deleteMany 零命中)。`TENANT_SERVICE_ENFORCEMENT` 由 canonical service 承担——producer 无法绕过(唯一入口)。

## 16. Authorization(PASS)

零新增权限系统。producer 事件由既有 #95 门后的业务 mutation 自然产生(`withAuth`+org 成员校验 / `requireProjectWriteAccess` / `requireProjectManageAccess`);**无 `POST /project-events` 类客户端直写口**(静态断言不存在该路由);读 service 要求 org+project 归属(未暴露 API);事件无 PATCH/PUT/DELETE 通道(`PROJECT_EVENT_UPDATE_DELETE = DISALLOWED`,修正走 correctionOfEventId 追加)。

## 17. Test Matrix

- **纯逻辑 11/11**(`p1-pure.test.ts`,进 test-all):eventKey 确定性(含 A→B→A→B)/flag 默认 OFF+fail-closed/EV-05 重试耗尽 THROW(mock:attempts=maxRetries+1,默认上限=8,绝不 return null)/EV-08 actor 伪造+缺 tx 拒绝/producer 静态纪律(tx 调用+flag 门+零直写+服务端 actor+禁客户端 ledger 字段)/canonical 唯一写入口/无事件修改 API/Deletion Gate 先于 hard delete/**Dark-merge:三个 M1 count 静态锁定在 activation flag 分支块内**/AI 类别拒入。
- **DB 矩阵 40/40**(`p1-ledger-db.test.ts`,隔离库执行否则自动跳过):EV-01(顺序幂等恰一行)/EV-02(5 路并发同 key 恰一行,全返回同一事件)/EV-03(并发 2/5/10 后 seq 致密单调)/EV-04(竞争经有界重试全收敛)/EV-06(原子回滚+零残留)/EV-07(跨 org 双向拒)/ACTOR(同事务+去重)/READ(seq DESC 稳定 cursor)/P-CREATE/P-UPDATE(key 确定性+重放幂等)/P-FAIL(业务失败零事件)/P-MEMBER(v1/v1/v2 三独立事件)/COST-01..08/DEL-01(归档后三表全保留+账本仍可读)/DEL-04/**DEL-DARK-01(真实 DELETE 路由 × flag OFF:spy 委托证明 0 次 M1 表访问 + 删除照常完成)**/**DEL-ACTIVE-01(flag ON + 无历史:M1 表被查询 3 次 + 删除继续)**/**DEL-ACTIVE-02(flag ON + 有历史:409 PROJECT_HAS_LEDGER_HISTORY + 项目保留)**。
- DEL-02/03(普通用户不能删事件/历史 ACTUAL 成本):**无任何删除 API/服务函数存在**(静态锁定 + service 层无 delete 导出),辅以 M1 的 Restrict 约束。
- **并发稳定性说明**:EV-02/EV-03 的 N 路同时突发是超出 #96“human-frequency”设计点的压力场景,在隔离 Neon 高延迟下给这两项按并发度放宽重试预算(仍有界、仍 THROW-on-exhaust);**服务默认值(8)不变**,默认预算的耗尽→THROW 行为由 pure 套件 EV-05 以 mock 确定性验证。remediation 后 DB 矩阵连续两次 40/40 稳定。

## 18. Concurrency Results

同项目并发 append(独立 eventKey):2 路 463ms / 5 路 767ms / 10 路 1308ms(总墙钟,含事务往返 Neon us-east-1);P2002 竞争重试在日志中可见(单次最高观察到 attempt 6)并全部在上限内收敛;无失败、无丢事件、seq 零间隙。人频业务(#96 预期)下延迟充裕;未做 Redis/sequence service 类优化(correctness first,遵任务书 §35)。

## 19. Isolated Neon Validation

生产快照子分支(host 非生产,用毕全部删除):初版 `preview-t2-p1-validation`(DB 矩阵 34/34 + test-all 211/211);Final Review remediation `preview-t2-p1-remediation`(`migrate resolve --applied` → deploy 干净应用 M1 → DB 矩阵 **40/40 连续两次稳定** → test-all 全量回归)。**ISOLATED_NEON_BRANCHES_LEFT = 0**;生产 DB 全程只读(§5 审计的两条 SELECT,remediation 轮亦仅只读)。

## 20. Production Activation Gate(BLOCKED——预期内)

```
PRODUCTION_M1_SCHEMA_STATUS            = NOT_PRESENT   → 未满足
MARKETING_ECONOMICS_MIGRATION_STATE    = BLOCKING      → 未满足
DELETION_GATING                        = PASS
LEGACY_EVENT_STORE_DECISION_GATE       = PASS
⇒ PRODUCTION_ACTIVATION_GATE = BLOCKED
```

因此增加 `T2_LEDGER_PRODUCERS_ENABLED`(**default OFF、fail-closed**,解析异常按 OFF):未开启时 producer 完全 dark(不触新表,业务路径行为与 main 一致——生产缺表时部署本 PR 亦安全);开启后 append 失败 = 业务事务回滚(authoritative)。**激活是人工动作**:先按既有 safe-migrate 流程完成生产 resolve+deploy,再显式置 flag。

## 21. Known Gaps

| # | 项 | 说明 |
|---|---|---|
| G1 | EV-04/05 的确定性竞争注入 | DB 层竞争为统计性触发(并发矩阵实证收敛);耗尽 THROW 的确定性验证在 mock 层完成——DB 层无法在不 hack 服务的情况下稳定制造 9 连冲突,权衡记录在案 |
| G2 | legacy null-org 项目 | producer 跳过(账本强制 org 租户);此类项目本就在 org 化迁移债范围 |
| G3 | 其余创建路径(v1/ops) | 未接入(§12 范围说明),P2 显式评审 |
| G4 | 孤儿行(激活前已硬删项目)读取 | DESIGN_ONLY(org 特权面),现行为:project 归属校验 fail-closed |
| G5 | 生产迁移态第三次漂移 | 失败记录被删而非 resolve——runbook 已固化(§5.1):resolve 前必须只读比对 `MarketingEconomicsSetting` 实际结构 vs migration.sql,仅等价时 resolve |

## 21.1 Final Review Remediation（2026-08-11）

| 项 | 处理 |
|---|---|
| 同步最新 main | rebase 到 `42c4f15`(含 #97 tender-eval benchmark v1);唯一冲突 `scripts/test-all.sh`(两侧 additive)解决,保留 #97 与 P1 两组条目;#97 benchmark 套件 rebase 后仍绿(test-all 内) |
| Dark-merge 安全修复 | DELETE 的 M1 存量闸整体门控于 `T2_LEDGER_PRODUCERS_ENABLED`;flag OFF → 零 M1 表访问(前 T2 行为逐字节不变),flag ON → 存量闸执行。新增 DEL-DARK-01/ACTIVE-01/ACTIVE-02(真实路由 + spy 委托)+ pure 静态锁定 |
| 迁移 runbook | §5.1 记录 resolve 前只读结构核对前置;**未对生产执行任何写操作** |
| 并发稳定性 | EV-02/03 压力场景按并发度放宽重试预算(服务默认 8 不变);DB 矩阵 remediation 后 40/40 连续两次稳定 |

## 22. Explicit Non-Scope

Tender Understanding V2 / T1B rollout / Archive Capture(TenderArchiveItem 零 producer,仅删除保留验证)/ Quote-Supplier-Tender-Award-Email-Calendar-TaskActivity producers / Corporate Memory / Backfill / Dual-write / Workforce runtime / 新 UI / Parallelism 变更 / 生产 flag 开启——全部未做。

## 23. Final Gate

见 PR 描述与 FINAL RETURN 键值(全部 PASS;`T2_P1_STATUS = READY_FOR_FINAL_REVIEW`;`T2_P2_AUTOSTART = NO`)。

*T2-P1 至此完成:Draft PR + 隔离验证 + 测试 + 报告。STOP,等待人工 Final Review。*
