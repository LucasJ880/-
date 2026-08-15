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

（本节在 canonical run 完成后以实测结果填写；未达 224/224 前**禁止**写 `TESTALL_FULL_GREEN = YES`）

---

## M. MOBILE / HEIC

- HEIC 魔数收紧**保留**，未放松（p16-pure 断言 `case "heic"` + `checkHeifMagic` + `ftyp` 校验存在）
- `MOBILE_REAL_DEVICE_UAT_PENDING` **不是 dark-merge blocker**，但升级为 **PRODUCTION_ACTIVATION_BLOCKER**

真机 iPhone Safari 必须通过后才允许开启生产 feature：拍 HEIC → 上传 → 金额输入（不触发自动放大）→ CNY 切换 + 预估显示 → camera capture → 上传失败 retry 且表单不丢。

---

## O. 最终 GATE 输出

（见报告末尾「GATE BLOCK」章节，canonical test-all 完成后填终值）
