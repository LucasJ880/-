# T2-P1.6 INTEGRATION CONVERGENCE R1 REPORT

> 本轮**不扩 P1.6 功能**，只做 integration remediation。
> 零新增：OCR / FX provider / bank integration / AR / 完整 Change Order workflow / 新 AI 功能。
> 日期：2026-08-15 · **不 merge，不开生产，不动生产库/env**

---

## A. FREEZE 记录

| 项 | 值 |
|---|---|
| `CURRENT_MAIN_SHA`（本轮起点） | `d4a39a77a0ad45ddbe2949b24a0254874ebcae85` |
| `PR104_HEAD_SHA`（本轮起点） | `e03b9b79e8449f101bad6a30efedbfc3045cbe7a` |
| `PR111_HEAD_SHA`（本轮起点） | `74764e224beff77a6fb0158433b8f9543487cfc6` |
| worktree | clean（`git status --porcelain` 空） |
| PR #111 | 保持 **Draft** |
| PR #107（T4） | MERGED @ `399a769`，2026-08-14T16:15:42Z |

本轮起点时 main 已从 `399a769` 前进到 `d4a39a7`（新增 PR #109 Autopilot A0）。

---

## B. #104 ← main 集成

**方法**：merge（**不重写历史**）—— #111 stacked on #104，rebase 会撕裂下游。
在临时分支 `tmp/p15-main-integration` 上完成后 **fast-forward push** 到 #104 分支。

| 冲突文件 | 解决方式 |
|---|---|
| `prisma/schema.prisma` | **ADDITIVE PRESERVE BOTH**。两侧均为「块尾追加」，共享收尾 `}` 位于冲突标记之后 —— 首次机械切片丢了该大括号（`prisma validate` 立刻报 7 错捕获），修正为「各自补回收尾大括号 + 空行分隔」 |
| `scripts/check-release-safety.test.ts` | 迁移名数组按 `sorted()` 字典序合并三条，描述串合并 |

**逐模型 byte-identity 验证**（防「过冲突时删了一边」）：

```
✓ AwardRecord        identical to origin/main
✓ AwardRecordSource  identical to origin/main
✓ ProjectBudget / ProjectBudgetVersion / ProjectBudgetLine
✓ ProjectExpenseSubmission / ProjectExpenseAttachment   identical to PR104 head
```

**顺带修复 main 既有缺陷（非本轮引入）**：
`verify-migration-history.ts` 在 main 上 `EXPECTED_ACTIVE` 只有 **14** 条，而 `prisma/migrations` 实际有 **16** 个目录 —— T4 PR #107 与 Autopilot A0 PR #109 都只登记了 `check-release-safety.test.ts`，**漏登** `verify-migration-history.ts`，导致 `Phase5C Migration History` gate **在 main 上即为红**（`active 数量=15` 断言失败）。本轮按治理契约补齐两条目（`EXPECTED_ACTIVE` + `IMMUTABLE` sha256），纯 additive，不改任何既有条目。

**集成后验证（P1.5 树）**：

| 项 | 结果 |
|---|---|
| `prisma validate` | valid |
| `verify-migration-history` | **51 / 0**（修复前 48/1） |
| `check-release-safety` | **27 / 0** |
| `tsc --noEmit` | **0 error** |
| `next build` | **PASS** |
| P1.5 finance DB | **43 / 0** |
| T2-P1 / T3.5 ledger DB | **60 / 0** |
| T3 memory DB | **43 / 0** |
| T4 awards DB / pure / semantics | **18 / 0 · 20 / 0 · 12 / 0** |
| P1.5 pure / authz | **7 / 0 · 10 / 0** |

**SEMANTIC_DRIFT = NONE** → 未触发 STOP。

`PR104_MAIN_INTEGRATED = YES`（新 head `53f4960`，`mergeable` 由 **CONFLICTING → MERGEABLE**）

---

## C. MIGRATION ORDER GATE

### 生产 `_prisma_migrations` 只读取证（隔离生产快照分支）

```
2026-08-14T17:58:53.082Z  20260805090000_marketing_economics
                          started_at == finished_at  ← migrate resolve --applied 的特征
2026-08-14T17:59:00.100Z  20260811002000_add_tender_t2_ledger_archive_foundation  → .277Z
2026-08-14T17:59:00.325Z  20260811040000_add_tender_t3_corporate_memory_foundation → .471Z
2026-08-14T17:59:00.515Z  20260814150000_add_tender_t4_award_record_foundation     → .655Z
```

- T4 **已 applied**，1 step，无 `rolled_back_at`，无 error logs
- P1.5（`20260811050000`）/ P1.6（`20260814090000`）**均未 applied**
- 二者命名**都早于**已 applied 的 T4 → 真实的 out-of-order 场景

### 实测（不假设，全部在隔离生产快照上执行）

| 测试 | 结果 |
|---|---|
| `migrate status`（deploy 前） | 报 `Your local migration history and the migrations table are different` / `last common migration = T3` —— **信息性发散提示** |
| `migrate deploy`（out-of-order） | **成功**：`Applying 20260811050000…` / `20260814090000…` / `20260814220000…`，Prisma 不拒绝更早命名的未应用迁移 |
| `migrate status`（deploy 后） | **exit 0** + `Database schema is up to date!` —— **发散提示消失，不持久** |
| 全新快照上一次性 deploy 三条 | **成功**，status 干净 |
| 对象验证 | 7 张表全部存在；4 个关键 unique index 存在；P1.5 财务表 **0 FK**（符合「项目硬删后财务史存活」哲学）；`AwardRecordSource_awardRecordId_fkey` 唯一内部 FK 存在 |
| `migrate diff` drift | 仅**既有** legacy 残留表（`AgentTaskDependency` / `BidDataRevision` / `ProjectFact` / `TenderRequirement` 等 11 张 + `AgentRun.agentTaskId`）——greenfield re-baseline 的历史残留，**与本 PR 无关**，无任何 P1.5/P1.6/T4 相关差异 |

### 是否需要 rename / re-sequence？

**结论：不需要。** 理由：
1. 实测 `deploy` 成功且 `status` 事后干净（exit 0），**无持久发散**
2. 全新快照一次性 deploy 三条同样干净
3. rename 会改动 #104 的迁移产物（他人 PR）并使其 checksum key 失效，属**无实证收益的 churn**

**`MIGRATION_ORDER_INTEGRATION = PASS`**

---

## K. T4 PRODUCTION MIGRATION PROVENANCE

**只读取证，本轮零生产操作。**

证据链完整且自洽：

1. **runbook 冻结在仓库内**：`docs/QINGYAN_TENDER_T4_INTELLIGENCE_P1_REPORT.md` §0
   「生产激活 Runbook（冻结；merge 后按序执行，本轮零生产操作）」
2. **runbook 预写步骤与 DB ledger 实测逐条吻合**：

| runbook 步骤 | 观测证据 |
|---|---|
| ③ `prisma migrate resolve --applied 20260805090000_marketing_economics` | `marketing_economics` @ 17:58:53.082Z，**`started_at == finished_at`**（resolve 的标志：只登记不执行） |
| ④ `migrate deploy` →「依序应用 T2（20260811002000）/ T3（20260811040000）/ T4（20260814150000）」 | 17:59:00 一个 555ms 批次内**正是该顺序**：T2-M1 → T3 → T4 |

3. **时间线一致**：PR #107 merged 16:15:42Z → 生产部署 17:59（1h43m 后）
4. `scripts/safe-migrate-deploy.ts` 存在（受 `ALLOW_DATABASE_MIGRATION` + `CONFIRM_PRODUCTION_MIGRATION` 双闸保护，由 check-release-safety 27/27 验证）

**`T4_PROD_MIGRATION_PROVENANCE = VERIFIED`** —— 属**已文档化、有 gate、有意为之**的生产激活 runbook 执行，非带外变更。

### 重要副产物（更新 P1.5/P1.6 激活前置）

该次 runbook 同时改变了两项长期 BLOCKING 前置：

| 前置 | 此前 | 现在 |
|---|---|---|
| `MARKETING_ECONOMICS_MIGRATION_STATE` | **BLOCKING**（drift，migrate deploy 恒 42P07 失败） | **RESOLVED** |
| `PRODUCTION_M1_SCHEMA_STATUS`（T2 ledger 四表） | NOT_PRESENT | **PRESENT**（`20260811002000` 已 applied） |

即：P1.5/P1.6 的两个历史激活障碍已消除。**但这不改变本轮结论** —— 生产激活仍需独立 runbook + Final Review，且本报告 §M / §J 另有 blocker。

---

## D. #111 BASE UPDATE

#104 集成完成后，#111 merge 更新后的 #104（同样不重写历史）。三处冲突（`schema.prisma` / `check-release-safety.test.ts` / `verify-migration-history.ts`）全部 ADDITIVE PRESERVE BOTH，字典序排列。

**12 个模型逐一 byte-identity 校验通过**（7 个 P1.5+T4 + 5 个 P1.6）。

`T4_PRESENT_IN_P16_BASE = YES` —— 实测 Prisma client 暴露 `awardRecord` / `awardRecordSource` delegate，`src/lib/tender-intel/*` 全部在编译上下文内。

### REVENUE_SOURCE_GAP 重新审计（前提已失效）

原报告写的是「T4 `AwardRecord` **不在本 stack 的 base 内**」。**该前提现已失效**，必须更新。

重新审计结论：**`ProjectRevenueEntry` 仍应是唯一财务收入源，但理由变了。**

此前理由是「AwardRecord 拿不到」（可用性）。现在理由是**语义**：

> `AwardRecord` 的定义域是「**某买家把某合同授予某供应商**」的组织级情报事实，
> 其 `projectId` 可为 null（外部公开授标），`winnerName` 可以是**任何**供应商。
> 它记录的可能是历史买家授标、**竞争对手中标**、或纯外部市场情报 ——
> 这些与青砚的项目收入**毫无关系**。

因此二者不是「同一事实的两处存储」，而是**两个不同的域**，需要一条受控的单向桥。详见 §E/§F。

---

## E. AWARD / REVENUE CONTRACT（冻结）

```
AWARD_TRUTH   = AwardRecord          （Tender Award Intelligence / Award Evidence，组织级情报层）
REVENUE_TRUTH = ProjectRevenueEntry  （Project Financial Revenue Ledger，收入计算唯一财务源）
```

### 硬约束

| 约束 | 实现 / 保证 |
|---|---|
| `AwardRecord` **不得**直接参与 Project Profit 求和 | `profitability.ts` / `portfolio.ts` **从不查询** AwardRecord —— p16-pure 静态断言 `!/awardRecord/i.test(src)` |
| **禁止** `on AwardRecord created → auto create revenue` | `tender-intel/awards.ts` 不得 import 收入域 —— p16-pure 静态断言；系统中不存在该路径 |
| `CONTRACT_AWARD` 可引用合法 AwardRecord 作 provenance | `sourceType=AWARD_RECORD` + `sourceRefId=AwardRecord.id` |
| 物化必须显式、单独授权 | 唯一通道 `materializeAwardRevenue()` + `POST …/finance/revenue/materialize-award`（COST_WRITE） |

### 六重资格闸（全部满足才允许物化；拒绝时如实返回 reason，绝不静默）

| # | 闸 | 拒绝码 |
|---|---|---|
| 1 | AwardRecord 存在且同 org | `AWARD_NOT_FOUND` |
| 2 | `awardRecord.projectId === 当前 projectId` | `AWARD_NOT_LINKED_TO_PROJECT` |
| 3 | `status === "ACTIVE"` | `AWARD_NOT_ACTIVE` |
| 4 | `verificationStatus ∈ {HUMAN_CONFIRMED, SYSTEM_VERIFIED}` | `AWARD_NOT_VERIFIED` |
| 5 | `contractAmount > 0` | `AWARD_AMOUNT_MISSING` |
| 6 | **项目本身处于我方中标态**（`isProjectAwardEligible`） | `PROJECT_NOT_AWARDED_TO_US` |

**第 6 条是本轮最关键的设计判断。** 仅凭 `projectId` 关联是**不够**的：
AwardRecord 完全可以挂在我们**落标**的项目上，用来记录「是谁中的标」（此时 `winnerName` 是竞争对手，这正是 Loss Review 的证据来源）。若只看关联就建收入，会把**竞争对手的中标额记成我方收入**。
测试 `INT-AWARD-REV-01c` 专门覆盖该场景。

---

## F. STRUCTURAL PROVENANCE

`refs` JSON + `findFirst` + 开发者约定**不足以**提供强去重保证 → 改为结构化字段 + DB 约束。

### 新增字段（`ProjectRevenueEntry`，最小集，**不建泛化 source framework**）

| 字段 | 语义 |
|---|---|
| `sourceType` | `AWARD_RECORD` \| `MANUAL` |
| `sourceRefId` | 来源域 id（`AWARD_RECORD` 时 = `AwardRecord.id`） |
| `activeSourceKey` | 去重键：ACTIVE 时 = `"{entryType}:{sourceType}:{sourceRefId}"`；**VOID 时置 NULL** |

### 约束

```prisma
@@unique([projectId, activeSourceKey])
```

- **同 Project + 同 Award source + CONTRACT_AWARD → 至多一条有效权威收入行**
- VOID 置 NULL 释放键位 → **VOID + replacement 修正链不被唯一键卡死**（`sourceType`/`sourceRefId` 作为 provenance **永久保留**）
- Postgres 唯一索引下 NULL 互不冲突 → 手工录入（无来源锚）不受约束
- **DB unique 是最后防线**：`INT-AWARD-REV-03b` 绕过 service 直插同键 → `P2002`

### 修正语义

AwardRecord 后续更正**不得** UPDATE 已确认 revenue amount → 继续 **VOID + replacement**，provenance chain 保留（`INT-AWARD-REV-04a/b/c/d`）。

`AWARD_TO_REVENUE_CONTRACT = FROZEN（受控单向桥；六重资格闸 + 结构化去重 + VOID/replacement 修正）`

---

## G. PROFIT VS SETTLEMENT（BLOCKING 业务更正）

### 更正内容

**移除**以下 Final Profit blocker：
- ~~`OUTSTANDING_REIMBURSEMENT`~~
- ~~`OUTSTANDING_PAYABLE` / `OPEN_PAYABLES`~~

**理由（会计事实）**：`Payment ≠ Cost`。费用一经审批即产生 `ProjectCost.ACTUAL`，
**那一刻成本就已进入项目损益**。员工是否已经拿到钱是**现金面**的事，不改变项目赚了多少钱。

### 新的 blocker 白名单（p16-pure 静态锁定，越界即测试红）

```
REVENUE_LEDGER_UNAVAILABLE · OUTCOME_NOT_WON · PROJECT_NOT_COMPLETED
REVENUE_NOT_FINAL · PENDING_COST_REVIEW · UNRESOLVED_COST_CORRECTION
UNKNOWN_CURRENCY_COST · UNKNOWN_REVENUE_CURRENCY
```

### 独立并列输出

```
outstandingReimbursementCad
outstandingPayablesCad
settlementStatus = NONE | OPEN | SETTLED
```

UI 上「最终利润」与「结算」是**两张并列卡片**，不再是前置关系。

### 实测（`PROFIT-SETTLEMENT-01`）

```
Final Profit : CAD 1,078,720   （= 已确认收入 1,080,000 − 总成本 1,280）
Settlement   : OPEN
Outstanding Reimbursement : CAD 1,280
→ 两者同时成立 ✓
付清后：利润**不变**，仅 settlementStatus → SETTLED ✓
```

`PROFIT_SETTLEMENT_SEPARATED = YES`

---

## H. REVENUE VS CASH

`REALIZED` → **`RECOGNIZED`**（未 merge 状态下改名最安全，已同步 schema / migration / types / services / tests / UI labels）。

| 状态 | 语义 |
|---|---|
| `FORECAST` | 预期 / 合同额 / 已批变更单金额 |
| `RECOGNIZED` | **经济收入已确认/定案**（履约完成、金额定案）—— **不是**客户已付款 |
| `VOIDED` | 作废（修正走 VOID + replacement） |

改名理由：`realized` 在中英文里都极易被读成「钱已到账」，而此处表达的是**会计确认**。

**冻结域外**：`CUSTOMER_COLLECTION_OUT_OF_SCOPE` —— invoice / customer payment / cash collection / AR aging 均**不在 P1.6**，属未来 AR / settlement 域。
静态断言：收入域源码不得出现 `customerPayment` / `accountsReceivable` / `cashCollected` / `collectionStatus`。
**禁止**未来用银行回款再产生第二条 revenue（收入只在本账确认一次）。

实测 `REV-CASH-01`：已确认收入存在、模型中零 AR 概念、利润仍可基于已确认收入计算。

`REVENUE_CASH_SEPARATED = YES`

---

## I. CHANGE ORDER

维持现状，**不扩 scope**：`entryType = CHANGE_ORDER` + 人工 `approvedById`（AI 不得自动批准）+ `changeOrderReference` + ProjectEvent audit。

`CHANGE_ORDER_MODEL_GAP` **remains open**（完整 CO workflow：范围变更、成本侧影响、审批链、客户变更协商 —— 均未实现）。

---

## J. PHASE BOUNDARY COVERAGE（READ-ONLY 审计）

对生产快照只读审计，**零写入、零猜测**（未使用 `createdAt` / `updatedAt` / 今天日期推断边界）：

```
PROJECTS_TOTAL        = 25
OUTCOME_DISTRIBUTION  = { NOT_SUBMITTED: 23, LOST: 1, WON: 1 }
WON_PROJECTS_TOTAL    = 1
RELIABLE_BOUNDARY     = 1   { delivery: 1, handoff: 0, awardDate: 0, none: 0 }
UNKNOWN_BOUNDARY      = 0
COVERAGE_PCT          = 100.0
WON_WITH_AWARDDATE    = 0
WON_WITH_HANDOFF      = 0
PROJECTCOST_ROWS      = 0
PROJECTEVENT_ROWS     = 0
```

### 诚实解读（数字 100% 但**不构成通过**）

1. **样本量 = 1**，统计上无意义。
2. 那唯一的 WON 项目是 `workDomain=delivery`（→ `allPostAward`），且 **`sourceTenderProjectId = NULL`** ——
   它的投标期成本**无处归集**，实际是「边界已知但投标成本不可得」。
3. **`WITH_SUBMITTED_AT = 0`** —— **生产上没有任何一个项目填了 `submittedAt`**。
   而 `submittedAt` 是 Portfolio cohort 的 canonical 日期（PORT-01）→
   **当前生产数据下 Portfolio 读模型对任意时间窗都会返回 0 个项目**。
4. `ProjectCost` / `ProjectEvent` 均为 0 行（ledger 生产 dark，符合预期）。

### 结论

`PHASE_BOUNDARY_COVERAGE = INSUFFICIENT_DATA (n=1)`

登记为 **ACTIVATION BLOCKER + DATA MIGRATION REQUIREMENT**：
- `COHORT_DATE_COVERAGE = 0%` —— 生产启用 Portfolio 前必须回填 `Project.submittedAt`
- WON 项目需要 `awardDate` 或已完成 handoff 才能切分 bid/delivery；delivery 项目需要 `sourceTenderProjectId` 才能归集投标成本
- 读模型行为不变：缺数据继续返回 `UNKNOWN` / `phaseSplitAvailable=false`，**绝不猜**

---

## L. TEST-ALL

### 历史事实（必须如实保留，不得改写）

| 轮次 | 结果 |
|---|---|
| 首次完整 test-all（R0） | **212 / 224**，12 失败 |
| 12 个失败套件串行复跑（R0） | **12 / 12 PASS**（266 项断言） |
| 失败根因 | 与 `next build` **并行**导致 Neon 连接池（limit 13 / timeout 10s）与 5s 交互事务超时被打穿（`P2024` / `P2028`，实测一笔事务被拉到 89.8s），多数死在 `seedWorkforceFixture` 播种阶段 |

R0 阶段的正确表述是 `TESTALL_LOGIC_REGRESSION_CLEARED = YES` / `CANONICAL_TESTALL_CLEAN_RUN = PENDING`。

### R1 canonical clean run（本轮）

条件：**全新**隔离生产快照分支 · 完整迁移链已 deploy · **零并行**（无 `next build`、无其它 DB-heavy 套件）· 单次完整 `scripts/test-all.sh`。

| 轮次 | commit | 结果 |
|---|---|---|
| canonical #1 | `745ca93b` | **250 / 250 通过，0 失败**（`TESTALL_EXIT=0`） |
| canonical #2（**最终 HEAD**，全新快照复核） | `8f9e688e` | **250 / 250 通过，0 失败**（`TESTALL_EXIT=0`） |

canonical #2 的存在理由：#1 跑完后我补了一条 `materialize-award` 路由的授权契约断言（覆盖缺口）。
代码一改，#1 就不再对应 HEAD —— 因此换全新隔离快照重跑一次完整 test-all，
使「canonical clean run」严格对应最终交付 commit。

**套件总数由 224 → 250 的原因**：#104 集成 main 后引入了 main 侧全部新套件（T4 awards ×3、Autopilot A0 ×7、tender-analyst、tender-doc-html、workbench-state 等），加上本轮新增的 `p16-integration-r1-db`。**224 是集成前的旧基数，不再是本树的分母。**

### 本轮 P1.6 相关套件

| 套件 | 结果 |
|---|---|
| `p16-pure` | **32 / 32**（新增 6 项 R1 静态纪律） |
| `p16-authz-contract` | **12 / 12**（新增 materialize-award 路由契约） |
| `p16-profitability-db` | **61 / 61** |
| `p16-integration-r1-db` | **24 / 24**（本轮新增） |

### 工具链

`tsc --noEmit` 0 error · `eslint` 0 error（1 warning：DB 测试内未用变量） · `verify-migration-history` **53 / 0** · `check-release-safety` **27 / 0** · `next build` PASS

---

## M. MOBILE / HEIC

- HEIC 魔数收紧**保留**，未放松（p16-pure 断言 `case "heic"` + `checkHeifMagic` + `ftyp` 校验存在）
- `MOBILE_REAL_DEVICE_UAT_PENDING` **不是 dark-merge blocker**，但升级为 **PRODUCTION_ACTIVATION_BLOCKER**

真机 iPhone Safari 必须通过后才允许开启生产 feature：拍 HEIC → 上传 → 金额输入（不触发自动放大）→ CNY 切换 + 预估显示 → camera capture → 上传失败 retry 且表单不丢。

---

## O. 最终 GATE 输出

```
PR104_MAIN_INTEGRATED        = YES   （merge，不重写历史；e03b9b7 → 53f4960；CONFLICTING → MERGEABLE）
PR111_BASE_UPDATED           = YES   （吸收更新后的 #104；74764e2 → 8f9e688e）

T4_PRESENT_IN_P16_BASE       = YES   （Prisma client 暴露 awardRecord/awardRecordSource；tender-intel/* 在编译上下文内）

MIGRATION_ORDER_INTEGRATION  = PASS  （实测：out-of-order deploy 成功；事后 status exit 0 且 "up to date"；
                                       全新快照一次性 deploy 三条同样干净 → 无需 rename/re-sequence）
T4_PROD_MIGRATION_PROVENANCE = VERIFIED
                                     （仓库内冻结 runbook §0 的预写步骤与生产 _prisma_migrations
                                       逐条吻合：resolve marketing_economics（started==finished）
                                       → deploy T2-M1/T3/T4 同批 555ms；PR #107 merge 后 1h43m）

AWARD_TRUTH                  = AwardRecord（Tender Award Intelligence / Evidence）
REVENUE_TRUTH                = ProjectRevenueEntry（Project Financial Revenue Ledger）
AWARD_TO_REVENUE_CONTRACT    = FROZEN
                                     （受控单向桥 materializeAwardRevenue()：六重资格闸
                                       + sourceType/sourceRefId/activeSourceKey 结构化去重
                                       + @@unique([projectId, activeSourceKey])
                                       + VOID/replacement 修正；禁止 on-award-created 自动建收入）

PROFIT_SETTLEMENT_SEPARATED  = YES   （移除 OUTSTANDING_REIMBURSEMENT / OUTSTANDING_PAYABLE blocker；
                                       改为 outstandingReimbursementCad / outstandingPayablesCad /
                                       settlementStatus 并列输出；PROFIT-SETTLEMENT-01 实证）
REVENUE_CASH_SEPARATED       = YES   （REALIZED → RECOGNIZED；AR/回款冻结为域外；REV-CASH-01 实证）

PHASE_BOUNDARY_COVERAGE      = INSUFFICIENT_DATA (n=1)
                                     （WON=1 且为无 sourceTenderProjectId 的 delivery 项目；
                                       COHORT_DATE_COVERAGE = 0%：生产 25 个项目**无一**填了 submittedAt
                                       → 登记为 ACTIVATION BLOCKER + DATA MIGRATION REQUIREMENT）

P15                          = PASS  （finance DB 43/43；pure 7/7；authz 10/10）
P16                          = PASS  （pure 32/32；authz 12/12；DB 61/61；R1 集成 24/24）
T2                           = PASS  （P1/T3.5 ledger DB 60/60，零 drift）
T3                           = PASS  （memory DB 43/43，零 drift）
T4                           = PASS  （awards DB 18/18；awards pure 20/20；award-semantics 12/12）

CANONICAL_TESTALL            = 250/250 PASS @ 8f9e688e（全新隔离生产快照，零并行，TESTALL_EXIT=0）
TESTALL_FULL_GREEN           = YES

MOBILE_REAL_DEVICE_UAT       = PENDING（PRODUCTION_ACTIVATION_BLOCKER，非 dark-merge blocker）
PRODUCTION_ACTIVATION_ALLOWED = NO

PRODUCTION_DB_CHANGED        = NO
PRODUCTION_ENV_CHANGED       = NO
PRODUCTION_MIGRATION_RUN     = NO
PR104_MERGED                 = NO
PR111_MERGED                 = NO

P16_STATUS                   = READY_FOR_FINAL_REVIEW
```

### 为什么是 READY_FOR_FINAL_REVIEW 而不是 BLOCKED

本轮四个收口目标全部达成、零 STOP 条件触发：
① #104/#111 与 main + T4 完成收口（MERGEABLE，byte-identity 校验通过）
② Profitability 财务语义已更正（Payment ≠ Cost，实证）
③ Award ↔ Revenue source-of-truth 契约已冻结并有结构化+DB 双层保证
④ migration / regression integration gate 全部重跑通过（canonical 250/250）

`PHASE_BOUNDARY_COVERAGE` 与 `MOBILE_REAL_DEVICE_UAT` 是**生产启用**前置，
不是 dark-merge 前置 —— 二者均已登记为 `PRODUCTION_ACTIVATION_ALLOWED = NO` 的具名理由。

---

## 生产激活前置清单（本轮更新后的真实状态）

| 前置 | 状态 |
|---|---|
| `MARKETING_ECONOMICS_MIGRATION_STATE` | ✅ **RESOLVED**（2026-08-14 runbook，本轮取证） |
| `PRODUCTION_M1_SCHEMA_STATUS`（T2 ledger 四表） | ✅ **PRESENT**（`20260811002000` 已 applied） |
| P1.5 migration deployed | ❌ 未（PR 未 merge） |
| P1.6 migration deployed | ❌ 未（PR 未 merge） |
| `COHORT_DATE_COVERAGE`（`Project.submittedAt` 回填） | ❌ **0%** —— Portfolio 启用前必须回填 |
| `MOBILE_REAL_DEVICE_UAT` | ❌ PENDING |
| `TENDER_FINANCIAL_CONTROL_ENABLED` | OFF |
| `TENDER_PROFITABILITY_SCHEMA_READY` | OFF |
| `T2_LEDGER_SCHEMA_READY` / `PRODUCERS_ENABLED` | OFF |
| `T4_AWARD_INTELLIGENCE_SCHEMA_READY` | OFF |

---

## OPEN RISKS（继承 + 本轮新增）

| # | 项 | 状态 |
|---|---|---|
| 1 | `CHANGE_ORDER_MODEL_GAP` | 仍 open（只做收入侧，无完整 CO workflow） |
| 2 | `FX_PROVIDER_GAP` | 仍 open（仅 MANUAL；SYSTEM_REFERENCE 无 provider 时 fail-closed 503） |
| 3 | `CUSTOMER_COLLECTION_OUT_OF_SCOPE` | 本轮**明确冻结**为域外（AR / 回款不在 P1.6） |
| 4 | `PAYMENT_INTEGRATION_GAP` | 仍 open（付款手工录入，无银行对账） |
| 5 | `AI_OCR_NOT_IMPLEMENTED` | 仍 open（只建边界未实现识别） |
| 6 | `LOSS_REVIEW_AI_SUGGEST_NO_ROUTE` | 仍 open（service API 存在，刻意不暴露 HTTP） |
| 7 | **`COHORT_DATE_COVERAGE = 0%`** | **本轮新增**：生产无任何 `submittedAt` → Portfolio 对任意窗口返回 0 |
| 8 | **`PHASE_BOUNDARY_SAMPLE_TOO_SMALL`** | **本轮新增**：WON=1 且无 `sourceTenderProjectId`，覆盖率数字无统计意义 |
| 9 | `MOBILE_REAL_DEVICE_UAT_PENDING` | 升级为 PRODUCTION_ACTIVATION_BLOCKER |
| 10 | `TESTALL_CONCURRENCY_FRAGILITY` | 既有环境债：Workforce 12 个 DB 套件在并发负载下会被连接池/事务超时打穿；串行下全绿 |
| 11 | `MAIN_MIGRATION_REGISTRATION_DEFECT` | **本轮修复**：T4/A0 漏登 `verify-migration-history`（main 上该 gate 即为红）；本分支已补齐，但 **main 本身仍红**，直到本 stack merge 回去 |
| 12 | `LEGACY_PROD_SCHEMA_DRIFT` | 生产存在 11 张 greenfield re-baseline 残留表 + `AgentRun.agentTaskId`；与本 PR 无关，长期需独立清理决策 |

---

**STOP。等待 Lucas Final Review。不 merge，不开生产。**
