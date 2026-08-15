# T2-P1.6 IMPLEMENTATION REPORT

**Tender Profitability + Mobile Expense + Multi-Currency + Reimbursement**

> 配套文档：[EXISTING_TENDER_FINANCIAL_MODEL_AUDIT](./QINGYAN_TENDER_T2_P16_EXISTING_MODEL_AUDIT.md)（Phase 0 审计产物）
> 交付日期：2026-08-14 · **STACKED ON PR #104，未 merge，未开生产**

---

## A. BASE / BRANCH

| 项 | 值 |
|---|---|
| `origin/main` SHA | `399a7691ade748f3c5797d1bc89fa1b1f782717b` |
| P1.5 source / base | `feature/tender-t2-p15-project-financial-control` @ `e03b9b79e8449f101bad6a30efedbfc3045cbe7a`（PR #104 head，已重新确认为当前 head） |
| 新分支 | `feature/tender-t2-p16-profitability-mobile-expense-fx` |
| base 判定 | **CASE B — stacked**（P1.5 未进 main：PR #104 仍 OPEN/DRAFT，`mergeable=CONFLICTING`，`src/lib/project-finance/**` 在 main 中 0 个文件） |
| main 相对 P1.5 | 领先 38 commits（merge-base `e0c2dac`） |
| PR base 分支 | `feature/tender-t2-p15-project-financial-control`（**DEPENDS ON #104**） |

### drift status

| 项 | 状态 |
|---|---|
| 本 PR 对 #104 的 drift | **NONE** — 直接从 #104 head 派生，未 rebase、未修改 #104 分支 |
| #104 ↔ main 的既有冲突 | `prisma/schema.prisma` + `scripts/check-release-safety.test.ts`，**两处均为追加型**（main 侧新增 T4 `AwardRecord` 模型段与迁移白名单条目；P1.5 侧新增自己的）。非破坏性，非本 PR 引入，由 #104 owner 在 retarget main 时解决 |
| **T4 `AwardRecord` 不在本 stack** | 是。因此 P1.6 **不得**把 `AwardRecord` 当 revenue/award 事实源——见 §D / §O |
| 生产快照观察（记录在案，非本 PR 动作） | 用于测试的生产快照分支的 `_prisma_migrations` 中**已存在** `20260814150000_add_tender_t4_award_record_foundation`。本 PR 未做任何生产迁移，仅如实记录该观察 |

---

## B. EXISTING MODEL AUDIT（摘要，详见审计文档）

### reused（复用，零重造）
`ProjectCost`（唯一权威成本 + 13 类冻结词表 + void/correction 契约）、`cost-service`、`ProjectEvent` / `ProjectEventActor`、`AuditLog`、`event-keys` 确定性键纪律、`ProjectBudget*` 三表、`ProjectExpenseSubmission` 状态机、`ProjectExpenseAttachment` 不可变证据、`putPrivateBlob` + `validateUploadedFileAsync`、`requireCostAccess` + `hasProjectPermission`、`isLedgerProducerActive()` fail-closed 闸、`isProjectAwardEligible()`、`resolveRequestOrgIdForUser`、`ProjectHandoff`。

### extended（在既有对象上加，不新建平行事实源）
- `ProjectExpenseSubmission`：+8 个可空列（FX 快照 4 + 出资来源 2 + 金额确认 2）
- `expense-service`：FX 快照、金额确认事件、出资人服务端校验、`updateExpenseDraft`、审批同事务产 payable、**权威成本以 CAD 记账**
- `attachment-service`：+`expense.receipt_uploaded` 事件（与落库同事务）
- `read-model`：行级 actual 改从**权威 ProjectCost**（`refs.budgetLineId`）滚动
- `upload-guard`：+HEIC/HEIF 真实魔数校验（**收紧**，见 §K）
- `rbac`：+`project:payment:record`（第四权）

### new（本阶段新建）
5 张表（`ProjectExpensePayable` / `ProjectExpensePayment` / `ProjectExpenseFxSettlement` / `ProjectRevenueEntry` / `ProjectTenderLossReview`）+ 8 个服务/读模型文件 + 8 条 API 路由 + 2 个 UI 组件 + 3 个测试套件 + 1 个 schema-ready flag。

### deliberately not duplicated
第二套 actual cost ledger / 第二套 AI 成本账 / 第二套证据体系 / 第二套 project phase / 第二套 award state / 扩大 13 类冻结词表 / 把 Payment 计成本 / 第二套并发框架 / 第二套授权 / 第二套文件系统 / 物化 `totalProfit`·`margin`·`totalCost` 列。

---

## C. SCHEMA

**迁移**：`prisma/migrations/20260814090000_add_tender_profitability_settlement/`
`SCHEMA_CHANGE = ADDITIVE`。零 DROP / 零 rename / 零破坏性 ALTER / 零 backfill / 既有表零 NOT NULL 新列。

### columns added（`ProjectExpenseSubmission`，全部 NULLABLE）
`fxRateCadPerOriginalUnit Decimal(18,8)` · `fxRateDate` · `fxRateSource` · `estimatedCadAmount Decimal(18,2)` · `fundingSource` · `paidByUserId` · `amountConfirmedAt` · `amountConfirmedById`

**legacy fallback semantics（已在迁移文件与 `money.resolveExpenseCad` 中固化）**
| legacy 状态 | 语义 |
|---|---|
| `estimatedCadAmount = NULL` 且 `currency = 'CAD'` | CAD 金额 = `totalAmount`（P1.5 单币种语义） |
| `estimatedCadAmount = NULL` 且 `currency ≠ 'CAD'` | **UNKNOWN** —— 不猜、不按今日汇率补算；排除出 CAD 合计并计入 `unknownCurrencyCostCount` |
| `fundingSource = NULL` | UNSPECIFIED → 审批**不产生** payable（fail-closed，绝不凭空造报销义务） |
| `amountConfirmedAt = NULL` | 提交时若操作人 = 提交人则同事务补记确认；他人/系统提交一律拒绝 |

### tables added
| 表 | 作用 | 关键约束 |
|---|---|---|
| `ProjectExpensePayable` | 结算子账（欠谁钱），**非成本** | `@@unique(expenseSubmissionId)` = 防重复报销结构锚 |
| `ProjectExpensePayment` | 付款记录，append-only | `@@unique(idempotencyKey)`；唯一内部 FK → payable，`onDelete: Restrict` |
| `ProjectExpenseFxSettlement` | FX 最终结算 + 差额 | `@@unique(expenseSubmissionId)` = 重复结算幂等锚 |
| `ProjectRevenueEntry` | **唯一权威收入账** | 金额列填充不覆盖；`correctionOfEntryId` 修正链 |
| `ProjectTenderLossReview` | 结构化落标复盘 | `@@unique(projectId)`；AI 建议列与最终原因列物理分离 |

### indexes
每表 org/project/status 组合索引 + 修正链索引，共 12 个 index + 4 个 unique index（详见 migration.sql）。

### migration path
1. 已登记 `scripts/verify-migration-history.ts`（`EXPECTED_ACTIVE` + `IMMUTABLE` sha256 `1ad414bb…`）
2. 已登记 `scripts/check-release-safety.test.ts` 名称数组
3. `verify-migration-history` 49 passed / 0 failed
4. 隔离生产快照分支上 `prisma db execute` 应用 P1.5 + P1.6 两个迁移：**均 clean，零错误**

---

## D. AUTHORITATIVE SOURCES（冻结口径）

```
Cost truth          = ProjectCost（经 src/lib/project-ledger/cost-service.ts；13 类冻结词表；
                      P1.6 起由 approveExpense 保证一律以 CAD 记账；AI/DATA_API 仍归 AiUsageLedger）
Revenue truth       = ProjectRevenueEntry（本阶段新建；见下方 REVENUE_SOURCE_GAP 说明）
Expense truth       = ProjectExpenseSubmission（提交流程；≠ 成本）
Payment truth       = ProjectExpensePayable + ProjectExpensePayment（结算子账；**绝不计入成本合计**）
Tender outcome truth= Project.bidPhaseStatus / tenderStatus / workDomain
                      （经既有 isProjectAwardEligible() + 新 resolveTenderOutcome()；不新造 award/loss state）
FX truth            = ProjectExpenseSubmission 的 fxRate* 快照（审批口径）
                      + ProjectExpenseFxSettlement（银行最终口径）
                      方向恒为 fxRateCadPerOriginalUnit = 1 单位原始币种 → X CAD
Cohort date truth   = Project.submittedAt（我方投标提交时间）
```

### REVENUE_SOURCE_GAP —— 为什么新建 `ProjectRevenueEntry`

审计确认现有候选**全部不合格**：`ProjectQuote.totalAmount`（报价单文档，多版本可 AI 生成，非成交事实）；`Project.estimatedValue` / `ourBidPrice` / `winningBidPrice`（`Float` 类型，schema 注释即写明「复盘与相似对比用」）；T4 `AwardRecord`（**不在本 stack 的 base 内**）；marketing `revenue`（MMM 营销域，与项目无关）。

**去重保证**：上述字段保持 read-only / indicative，收入服务既不读也不写它们；portfolio 中引用 `Project.estimatedValue` 之处强制带 `note: "INDICATIVE_ONLY_NON_AUTHORITATIVE_FLOAT_FIELD"`，且**不参与任何利润计算**。

**与 T4 的未来收敛路径（follow-up，本轮不实现）**：`AwardRecord` 进入本分支后，正确做法是**由 AwardRecord 驱动创建一条 `CONTRACT_AWARD` 收入条目**（AwardRecord = 中标事实，RevenueEntry = 记账事实），而不是让 read model 同时从两处求和。

---

## E. MOBILE

**组件**：`src/components/project-detail/mobile-expense-sheet.tsx`（全屏面板）
**入口**：`FinancialControlCard` 顶部常驻全宽按钮「记一笔费用」（48px 高，永远在最上面）

### camera capture
`<input type="file" accept="image/*" capture="environment">` 拍照通道 + `accept="image/*,application/pdf"` 相册/PDF 通道并列双按钮（52px）。覆盖 receipt / invoice / 停车票 / 酒店发票 / 微信支付截图 / 支付宝截图 / 银行转账截图 / 供应商 PDF 发票。

### form flow（拍照优先，20–30 秒可完成）
```
[拍票据 | 相册/PDF] → [金额 + 币种(+汇率 → ≈预估 CAD)] → [✓ 我确认金额]
→ [费用类型] → [谁付的钱] → [日期 / 商家 / 备注] → [提交]
```

### 上传失败不丢表单（关键）
三步落地：① 先 POST 建 **DRAFT**（服务端落库）→ ② 上传票据（失败可重试）→ ③ PATCH `submit`。
上传失败时停在草稿态并提示「费用已存为草稿，内容未丢失」，「重试」按钮复用同一 `draftId`。

### 375px validation
- 全单列布局 + `min-w-0` + `break-words` + `truncate`；无横向滚动
- 所有 input/select/textarea `text-[16px]`（**低于 16px 会触发 iOS Safari 自动放大**）
- 触控目标 ≥ 44px（`min-h-[44px]`，主按钮 48–52px）
- 金额 `inputMode="decimal"` → 数字键盘
- 底部提交条 `sticky` + `env(safe-area-inset-bottom)`

### amount confirmation
金额输入框旁独立的显式确认控件（`aria-pressed`）；金额或币种任一变化 → **确认状态自动重置**，必须重新确认。未确认无法提交。
服务端：`amountConfirmedAt/ById` 落列 + `expense.amount_confirmed:{id}:t{n}` 事件；OCR 结果只能落 `extracted*` 列，**结构上无法**成为 `totalAmount`。

---

## F. MULTI-CURRENCY

| 项 | 实现 |
|---|---|
| original currency retention | `totalAmount` + `currency` **本来就是**原始金额与原始币种；刻意不新建 `originalAmount/originalCurrency`（会造重复事实）。折算只前向写入独立列 `estimatedCadAmount`，**绝不覆盖原始数据** |
| CAD base currency | `BASE_CURRENCY = "CAD"`；Budget / Actual / Revenue / Profit / Margin / Portfolio 全部以 CAD 汇总；`ProjectCost.currency` 由 `approveExpense` 强制写 `CAD` |
| 汇率方向 | **唯一命名** `fxRateCadPerOriginalUnit` = 1 单位原始币种 = X CAD。不提供 `fxRate` 这种无方向名，也不提供 reciprocal 入口 → 结构性杜绝 inverse-rate bug |
| FX snapshot | `fxRateCadPerOriginalUnit` + `fxRateDate` + `fxRateSource` + `estimatedCadAmount` 四列快照；`resolveExpenseCad()` **不接受当前汇率参数**——历史成本无法被今日汇率重算 |
| FX 来源 | `BASE_CURRENCY` / `MANUAL`（P0 唯一默认可用）/ `SYSTEM_REFERENCE`（**槽位预留；未注册 provider 时 fail-closed 抛 503，绝不硬编码汇率**）/ `BANK_SETTLEMENT` |
| CAD 短路 | `currency = CAD` → rate 恒 1、`estimated = total`、不走 FX 流程；rate ≠ 1 被硬拒 |
| settlement behavior | `settleExpenseFx()` 记录银行实际汇率/入账额/手续费；`finalCad = settledCad + bankFee`（服务端 Decimal） |
| FX variance behavior | `variance = finalCad − estimatedCad`；非 0 时经**既有 ledger 契约** `voidProjectCost({correction})` 在同一事务内 VOID 旧 ACTUAL + 建 correction 新 ACTUAL（`correctionOfCostId` 新→旧）。**从不 UPDATE ProjectCost 金额**（静态测试断言 `fx-settlement-service.ts` 中不含 `projectCost.update`） |
| Decimal 纪律 | 全部 `Prisma.Decimal`，`ROUND_HALF_UP`；权威路径零 JS float（前端 `previewCad` 仅展示用且注释标明） |

**留痕示例（DB 实测）**：CNY ¥72,000 → rate 0.1917 @ 2026-06-10 → estimated CAD 13,802.40 → 银行结算 13,965.00 + 手续费 45.00 → final 14,010.00 → variance **+207.60** → 旧 ACTUAL(13,802.40) VOIDED + 新 ACTUAL(14,010.00) correction。

---

## G. REIMBURSEMENT

### payable lifecycle
`PENDING_PAYMENT → PARTIALLY_PAID → PAID`，另有 `VOID`。
审批事务内经 `createPayableForApprovedExpense()` 创建，`@@unique(expenseSubmissionId)` + 服务层先查后建双保险。

### payment lifecycle
Append-only。纠错 = `voidPayment()`（打 `voidedAt` + 回退 `paidAmountCad`），**没有 DELETE、没有金额原地改**。
并发安全：付款前对 payable 行取 `FOR UPDATE` 行锁 → 串行化 → 剩余额校验 → **结构上不可能超付**。
幂等：`idempotencyKey = payment:{payableId}:{clientKey}`，服务端拼装（客户端只给片段）。

### 出资来源 → 结算义务映射
| fundingSource | payable |
|---|---|
| `EMPLOYEE_PERSONAL` | `EMPLOYEE_REIMBURSEMENT` / payee = 垫资人（**强制 = 提交人**） |
| `CHINA_AFFILIATE` | `AFFILIATE_SETTLEMENT` |
| `VENDOR_INVOICE_UNPAID` | `VENDOR_PAYMENT` |
| `COMPANY_CARD` / `COMPANY_BANK` / `OTHER` / legacy NULL | **无**（员工应报销恒为 0） |

### employee personal behavior
「个人垫付」的垫资人必须是提交人本人：route 层强制 `paidByUserId = access.user.id`，service 层 `resolvePaidByUserId()` 二次硬拒（403）。任何普通成员**无法**替他人伪造个人垫付、也就无法给任意用户凭空造一条报销应付。

### 三层分离（RULE 2 + RULE 6）
`settlement-service.ts` **不 import `cost-service`**（静态测试断言），因此付款在结构上不可能产生第二条成本。付款事件 payload 携带显式标记 `SETTLEMENT_SUBLEDGER_NOT_COST`。

---

## H. PROFITABILITY

### 阶段推导（不新建第二套 phase）
`cost-phase.ts` 在**读时**由既有 canonical 字段推导，优先级：

| 优先级 | boundarySource | 依据 |
|---|---|---|
| 1 | `delivery` | `workDomain = delivery` → 该项目全部成本 = POST_AWARD |
| 2 | `handoff` | 已完成 `ProjectHandoff.completedAt`（最强信号） |
| 3 | `awardDate` | **仅当项目 award-eligible 时**才采用（`awardDate` 对 LOST 项目也可能非空） |
| 4 | `none` | 无可用边界 → 全部 PRE_AWARD + `phaseSplitAvailable = false`（**如实上报无法切分，不猜**） |

零新增列、零新增表、零新增状态机。

| 指标 | 口径 |
|---|---|
| bid cost | PRE_AWARD 的 `ProjectCost.ACTUAL`（CAD）。交付项目经 `sourceTenderProjectId` 跨项目归集来源投标项目的投标成本 |
| delivery cost | POST_AWARD 的 `ProjectCost.ACTUAL`（CAD） |
| total cost | bid + delivery |
| forecast revenue | 非作废收入条目的 `amountForecastCad` 之和（contract + change orders + adjustments） |
| actual revenue | `REALIZED` 条目的 `amountRealizedCad` 之和 |
| forecast profit | forecast revenue − total cost |
| final profit | **仅在具备资格时**= realized revenue − total cost，否则 `null` |
| margin | `profit / revenue × 100`（Decimal，2 位）；收入 ≤ 0 → `null` |

### Final Profit 资格（证据式，全部条件必须成立）
收入账可用 · outcome = WON · 项目有 `actualCompletionDate` · 无未实现收入条目 · 已实现收入 > 0 · 无未结应付 · 无未落实 COMMITTED 成本 · 无未折算币种成本行。
任一不成立 → `finalProfitCad = null` + `finalProfitBlockers[]` 逐项列出缺什么证据。**UI 显示「暂不可得」并列出原因，绝不用预测值冒充最终值。**

---

## I. LOST TENDER

### loss reason model
`ProjectTenderLossReview`（每项目至多一条）。15 项原因词表全覆盖任务书清单；primary 单选、secondary 多选且**不得与 primary 重复**（服务端去重 + 校验）。

### evidence
`evidence Json`（`[{kind, note, archiveItemId?, documentId?, sourceUrl?}]`，只存引用不复制原文）+ `ourBidAmountCad` / `winningBidAmountCad` / `winnerName` / `notes`。

### human confirmation（LOSS-02 / LOSS-03 的三重保证）
1. **结构**：`suggestLossReasons()` 只 update `aiSuggested*` 三列——它连 `primaryLossReason` 字段都不写（静态测试断言）
2. **服务**：`confirmLossReview()` 是唯一能写最终原因的路径，且 `actorType !== "user"` → 403
3. **路由**：`loss-review/route.ts` 只接受 `action = "confirm"`，确认人恒取 `access.user.id`；route 层不 import 任何 AI 建议函数（静态测试断言）

落标项目的费用**全部保留**：本服务不碰任何 `ProjectCost` / expense；DB 实测落标项目 CAD 7,850 全额计为投标成本。

---

## J. PORTFOLIO

**读模型**：`portfolio.getTenderPortfolioSummary(orgId, {from, to})`，一次算完返回，**前端零遍历**。
**cohort canonical 日期 = `Project.submittedAt`**（不用 createdAt / closeDate / awardDate）。
不按 `workDomain` 过滤：中标后 handoff 出的 delivery 项目 `submittedAt` 为空，天然不重复计数。

### fixture 实测（6–8 月，12 投 / 3 中 / 9 落）

| 指标 | 值 |
|---|---|
| Tender Submitted | 12 |
| Won / Lost / Pending | 3 / 9 / 0 |
| Win Rate | **25%** |
| Total Bid Cost | CAD 7,500 |
| Won Tender Bid Cost | CAD 3,000 |
| Lost Tender Bid Cost | CAD 4,500 |
| Lost Tender Total Spend | CAD 4,500 |
| 平均每标投标成本 | CAD 625 |
| Average Cost per Win（含失败） | CAD 2,500 |
| Award Acquisition Cost per Win（仅中标） | CAD 1,000 |
| Awarded Value（**权威**，来自收入账） | CAD 600,000 |
| Indicative Tender Value（**非权威 Float**） | CAD 6,000,000 · `INDICATIVE_ONLY_NON_AUTHORITATIVE_FLOAT_FIELD` |
| **Finalized Profit**（1 个已终结项目） | CAD 199,000 |
| **Current Forecast Profit**（2 个在建项目） | CAD 398,000 |
| Top Loss Reasons | `PRICE_HIGH` × 5 · `TECHNICAL` × 2 |
| 分组计数 | PRICE 5 · TECHNICAL 2 |
| 未复盘落标数（如实暴露覆盖率） | 2 |

**PORT-05 关键**：`finalizedProfitCad`（199,000）与 `currentForecastProfitCad`（398,000）**分列且从不相加**，各自带项目数。
**PORT-06**：空 cohort → `winRatePercentage = null`、`averageCostPerWinCad = null`（不造 0%、不造 NaN）。

---

## K. SECURITY

| 维度 | 实现 |
|---|---|
| tenant isolation | 全部服务以 `(orgId, projectId)` 复合条件加载；跨 org 付款 / 记收入 DB 实测被拒（`FINANCE_TENANT_MISMATCH`） |
| permissions | 读 `COST_READ`；提交/编辑本人费用 `EXPENSE_SUBMIT`；预算与收入 `COST_WRITE`；审批 `COST_REVIEW`；**付款 / FX 结算 `PROJECT_PAYMENT_RECORD`（新增第四权）** |
| 审批 ≠ 付款 | 新权限位与 `COST_REVIEW` 物理分离。当前 `accounting` 同时持有两位（青砚现规模的现实），但要做「审核人 ≠ 放款人」只需从角色移除该位，**零代码改动** |
| self approval | 既有 `SelfApprovalError` 保留（approve + reject 双路径）；DB 实测自审批被拒且**不产生任何应付** |
| payment authorization | 放款人 / FX 结算人 / 落标确认人**恒取 `access.user.id`**，绝不取请求体（静态测试断言） |
| 无审核权者可见性 | 应付列表服务端强制 `payeeUserId = access.user.id`（不依赖前端过滤） |
| idempotency | `expense.approved:{id}` · `expense.payable_created:{id}` · `expense.fx_settled:{id}` · `payment:{payableId}:{clientKey}` · `@@unique(expenseSubmissionId)` ×2 |
| concurrency | 审批：条件 `updateMany(status=PENDING_REVIEW)` 状态闸；付款：payable 行 `FOR UPDATE` 行锁 + 剩余额校验；均复用 P1.5/T3.5 既有模式，零新框架 |
| **HEIC 加固** | 既有缺口：`heic` 在白名单但 `checkMagic()` 无分支 → 落 `default: return true`，`.heic` 可承载任意字节通过校验。**本 PR 补 ISO-BMFF `ftyp` + 10 个 HEIF 品牌校验**（收紧，非放开；生产该功能仍 dark，零存量数据受影响） |
| UI 非安全边界 | 所有闸在 service / route；静态测试断言 route 层不得直写 `ProjectCost` / 结算表 |

---

## L. TEST RESULTS

### 新增套件

| 套件 | 结果 |
|---|---|
| `p16-pure.test.ts`（纯逻辑，进 CI 子集） | **26 / 26 PASS** |
| `p16-authz-contract.test.ts`（授权契约，进 CI 子集） | **11 / 11 PASS** |
| `p16-profitability-db.test.ts`（真实 Postgres 矩阵） | **61 / 61 PASS** |

### 任务书 §18 契约逐项

| 契约 | 结果 | 位置 |
|---|---|---|
| FX-01 CAD 100 → CAD 100 | PASS | pure |
| FX-02 CNY 72000 × 0.1917 → 13,802.40 | PASS | pure + db |
| FX-03 历史 rate 不因当前 rate 改变 | PASS | pure |
| FX-04 finalCad = settledCad + bankFee | PASS | pure + db |
| FX-05 禁止 inverse-rate 歧义 | PASS | pure |
| FX-06 Decimal rounding correctness | PASS | pure |
| EXP-MOBILE-01 active member 提交本人费用 | PASS | db |
| EXP-MOBILE-02 不得代他人提交 | PASS | db + authz |
| EXP-MOBILE-03 amount required（0 / 负均拒） | PASS | db |
| EXP-MOBILE-04 currency required（非 CAD 必带汇率） | PASS | db |
| EXP-MOBILE-05 receipt tenant isolated | PASS | db |
| EXP-MOBILE-06 amount confirmation audit exists | PASS | db |
| REIMB-01 personal 审批恰一条 payable | PASS | db |
| REIMB-02 COMPANY_CARD 零员工 payable | PASS | pure + db |
| REIMB-03 COMPANY_BANK 零员工 payable | PASS | pure + db |
| REIMB-04 付款不产生第二条 ProjectCost | PASS | pure(静态) + db |
| REIMB-05 partial payments 计算正确 | PASS | db |
| REIMB-06 fully paid → PAID | PASS | db |
| REIMB-07 并发/重复付款不可超付 | PASS | db |
| EXP-APP-01 审批仍产恰一条权威成本 | PASS | db |
| EXP-APP-02 self approval forbidden | PASS | db |
| EXP-APP-03 double approval 不产重复 | PASS | db |
| EXP-APP-04 失败事务正确回滚 | PASS | db |
| FX-SETTLE-01 差额可审计 | PASS | db |
| FX-SETTLE-02 ACTUAL 从不被静默改额 | PASS | db |
| FX-SETTLE-03 修正走既有 VOID + replacement | PASS | db |
| FX-SETTLE-04 重复结算幂等 | PASS | db |
| TENDER-COST-01 LOST 保留全部投标成本 | PASS | pure + db |
| TENDER-COST-02 WON 保留 pre-award 成本 | PASS | pure + db |
| TENDER-COST-03 交付成本不抹掉投标成本 | PASS | pure + db |
| TENDER-COST-04 total = bid + delivery | PASS | pure + db |
| LOSS-01 结构化落标原因 | PASS | db |
| LOSS-02 human confirmation required | PASS | db |
| LOSS-03 AI 建议不能直接成为最终原因 | PASS | pure(静态) + db |
| PORT-01 cohort 用 canonical submitted date | PASS | db |
| PORT-02 12/3/9 聚合正确 | PASS | db |
| PORT-03 落标花费正确聚合 | PASS | db |
| PORT-04 中标投标成本正确聚合 | PASS | db |
| PORT-05 forecast 与 final 永不混用 | PASS | db |
| PORT-06 win rate 零分母 | PASS | pure + db |

### 额外覆盖（超出任务书清单）
FLAG fail-closed 三项（OFF 时审批退化为 P1.5 语义 / 读模型 available=false 不抛缺表）、跨 org 付款与记收入被拒、付款冲销 append-only、金额修改重新确认、他人不得改我的费用、变更单必须人工批准、CAD 费用拒绝多余 FX 流程、落标次要原因不得与主要重复、中标项目不得建落标复盘。

### 工具链
`tsc --noEmit` **0 error** · `eslint`（新增/改动文件）**0 error**（唯一 1 个 error 在 `project-detail-header.tsx:140`，**基线既有**，未被本分支触碰）· `check-swc-nullish-logical` **PASS** · `verify-migration-history` **49 / 0** · CI unit subset **PASS**

---

## M. REGRESSION

隔离 Neon 生产快照分支（`polished-thunder-16018212` 子分支 `preview-t2p16-profitability`，`DATABASE_ENVIRONMENT=isolated`）：

| 既有套件 | 结果 | drift |
|---|---|---|
| T2-P1 / T3.5 Ledger DB（EV/COST/DEL/DEL-RACE/并发） | **60 / 60 PASS** | **NONE** |
| T2-P1.5 财务 DB 矩阵（BUDGET / EXP / COST-READ / EVENT / EXP-ACTIVE / BUDGET-AWARD / BUDGET-CONC） | **43 / 43 PASS** | **NONE** |
| T3 企业记忆 DB（MEM-01..12） | **43 / 43 PASS** | **NONE** |
| CI unit subset（T2-P1 / T3 / V2 / tender-eval / workforce / 安全） | **PASS** | **NONE** |

**COST-READ 口径变更说明**：`read-model` 行级 actual 由「approved expense 求和」改为「权威 `ProjectCost.refs.budgetLineId` 滚动」。P1.5 DB 矩阵 COST-READ-01/02 断言值（12,777）**未变**——CAD 场景两条路径同值，改动消除的是多币种下跨币种相加的隐患。

---

## N. PRODUCTION SAFETY

```
PRODUCTION_DB_CHANGED     = NO
PRODUCTION_ENV_CHANGED    = NO
PRODUCTION_FLAGS_ENABLED  = NO
PRODUCTION_MIGRATION_RUN  = NO
PR_MERGED                 = NO
```

补充：
- 测试全部在**临时隔离 Neon 分支**（生产快照子分支）执行，用后删除 → `ISOLATED_NEON_BRANCHES_LEFT = 0`
- 生产 flag 现状：`TENDER_FINANCIAL_CONTROL_ENABLED = OFF`、`T2_LEDGER_SCHEMA_READY = OFF`、`T2_LEDGER_PRODUCERS_ENABLED = OFF`、**新增 `TENDER_PROFITABILITY_SCHEMA_READY` default OFF**
- `marketing_economics` 迁移态仍 **BLOCKING** → `PRODUCTION_ACTIVATION_GATE = BLOCKED`（继承 P1.5）
- 本 PR 未执行任何 `prisma migrate deploy` / `migrate resolve` / production credentials 操作

### Feature flag 决策（任务书 §20）
**只新增 1 个** `TENDER_PROFITABILITY_SCHEMA_READY`（新表可用性，语义等价 `T2_LEDGER_SCHEMA_READY`）。
**刻意不加** `TENDER_EXPENSE_MOBILE_ENABLED` / `TENDER_SETTLEMENT_ENABLED` / `TENDER_PROFITABILITY_ENABLED`：
- 移动端费用录入与 P1.5 费用面是**同一功能面**，已被 `TENDER_FINANCIAL_CONTROL_ENABLED` 门控；再加一位只会造出「面开着但录不进」的半开状态，增加而非降低风险
- 结算 / 利润 / 落标复盘的可用性**完全等价于新表是否存在**，一个 schema-ready 位即可精确表达

所有 producer fail-closed：flag OFF 时审批路径退化为 P1.5 原语义（DB 实测验证）。

---

## O. OPEN RISKS / FOLLOW-UP

| # | 项 | 状态 | 说明 |
|---|---|---|---|
| 1 | **`REVENUE_SOURCE_GAP`** | 已用最小方案填补，但需人工确认口径 | 新建 `ProjectRevenueEntry` 为唯一权威收入源。**需 Final Review 确认**：与 T4 `AwardRecord` 的收敛路径（建议 AwardRecord → 驱动创建 CONTRACT_AWARD 条目，而非双源求和） |
| 2 | **`CHANGE_ORDER_MODEL_GAP`** | 仍开放 | 本轮只做**收入侧**最小表达（`entryType=CHANGE_ORDER` + 人工 `approvedById` + `changeOrderReference`）。完整 CO 工作流（范围变更、成本侧影响、审批链、与客户的变更协商）**未实现** |
| 3 | **`FX_PROVIDER_GAP`** | 仍开放（刻意） | 无自动汇率源。P0 只支持 `MANUAL`；`SYSTEM_REFERENCE` 槽位在未注册 provider 时 fail-closed 抛 503。接入付费 FX SaaS 需单独授权 |
| 4 | **`HEIC_VALIDATION_TIGHTENED`** | 本 PR 已修 | 原缺口：`.heic` 在白名单但魔数未校验。现补 ISO-BMFF `ftyp` 校验。**副作用提示**：若浏览器给出的 HEIC 变体品牌不在 10 项白名单内会被拒——生产该功能 dark，需 UAT 用真机 iPhone 票据验证覆盖度 |
| 5 | `PAYMENT_INTEGRATION_GAP` | 开放 | 付款是**手工录入**（无银行/工资系统对接）。`paymentReference` 为自由文本，无对账自动化 |
| 6 | `AI_OCR_NOT_IMPLEMENTED` | 开放（本轮刻意） | `extracted*` 列（P1.5 预留）仍无 OCR 写入方。本轮只建立「AI 只能 SUGGEST、金额必须人确认」的边界，未实现识别本身 |
| 7 | `LOSS_REVIEW_AI_SUGGEST_NO_ROUTE` | 开放 | `suggestLossReasons()` 是 service API，**未暴露 HTTP 路由**（避免在无 AI 生产方时开一个可被误用的写入口）。接 AI 时再补 route |
| 8 | `PHASE_BOUNDARY_COVERAGE` | 数据面风险 | 中标但无 `awardDate` 且无已完成 handoff 的项目无法切分投标/交付成本 → 全部计 PRE_AWARD 且 `phaseSplitAvailable=false`。read model 已如实上报，但**存量数据覆盖率未知**，建议 UAT 时统计 |
| 9 | `LEGACY_NON_CAD_COST_ROWS` | 数据面风险 | 若生产存在 `currency ≠ CAD` 的既有 `ProjectCost` 行，会被排除出 CAD 合计并计入 `unknownCurrencyCostCount`（不猜金额）。当前生产 ledger dark 故应为 0，需上线前核实 |
| 10 | `PR104_MAIN_CONFLICT` | 继承自 #104 | #104 与 main 在 `schema.prisma` / `check-release-safety.test.ts` 冲突（追加型）。本 PR 的 rebase/retarget 必须等 #104 先解决 |
| 11 | `T4_MIGRATION_IN_PROD_SNAPSHOT` | 待确认 | 生产快照分支的 `_prisma_migrations` 中已存在 `20260814150000_add_tender_t4_award_record_foundation`。本 PR 未做任何生产操作，仅记录该观察，建议独立确认其部署来源 |
| 12 | `MOBILE_REAL_DEVICE_UAT_PENDING` | 待做 | 375px 布局纪律（16px input / 44px 触控 / 无横向滚动 / camera-first）已按规范实现并静态自检，**但未在真机 iPhone Safari 上做视觉冒烟**（本 PR 未起 dev server 做浏览器验证） |
| 13 | `ACCOUNTING_HOLDS_BOTH_POWERS` | 设计取舍 | `accounting` 角色当前同时持 `COST_REVIEW` 与 `PAYMENT_RECORD`。权限位已分离，改为「审核人 ≠ 放款人」只需改角色映射，零代码改动 |

---

## STOP CONDITIONS 检查

| 条件 | 状态 |
|---|---|
| P1.5 与 main 重大不可判断 schema drift | 未触发（冲突为追加型，已定性） |
| authoritative cost source 冲突 | 未触发（ProjectCost 仍唯一，静态测试锁定） |
| migration destructive operation | 未触发（纯 additive） |
| 需要 production credentials | 未触发 |
| 需要 production migration | 未触发 |
| 必须修改 production env | 未触发 |
| ledger regression | 未触发（60/60 + 43/43 + 43/43 全绿，零 drift） |
| tenant isolation failure | 未触发（跨 org 用例全绿） |
| double payment / double cost 无法证明安全 | 未触发（幂等键 + 行锁 + unique 约束 + 并发用例全绿） |

**结论：无 STOP 条件触发。等待人工 Final Review。**
