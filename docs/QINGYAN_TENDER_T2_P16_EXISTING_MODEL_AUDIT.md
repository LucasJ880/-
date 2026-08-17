# EXISTING_TENDER_FINANCIAL_MODEL_AUDIT

> Phase 0 产物 — T2-P1.6（Tender Profitability + Mobile Expense + Multi-Currency + Reimbursement）
> 审计基线：`feature/tender-t2-p15-project-financial-control` @ `e03b9b79e8449f101bad6a30efedbfc3045cbe7a`（= PR #104 head）
> 审计日期：2026-08-14

---

## 0. BASE 判定（先审计再开分支）

| 项 | 值 |
|---|---|
| `origin/main` SHA | `399a7691ade748f3c5797d1bc89fa1b1f782717b` |
| PR #104 状态 | **OPEN / DRAFT**，`mergeable = CONFLICTING`，`mergeStateStatus = DIRTY` |
| PR #104 head | `e03b9b79e8449f101bad6a30efedbfc3045cbe7a`（与任务书给出的历史 head 一致，已重新确认） |
| merge-base(main, P1.5) | `e0c2dacce289f1e5da20e516f145c2aec8bfd72e` |
| main 领先 P1.5 | 38 commits |
| P1.5 领先 main | 4 commits |
| `src/lib/project-finance/**` 存在于 main | **否**（0 个文件） |

**判定 = CASE B。** P1.5 财务代码尚未（也未等价地）进入 `origin/main`。
按任务书 §0：不得从 main 单独重做财务系统 → 从 PR #104 当前 head 建 **stacked branch**。

- 新分支：`feature/tender-t2-p16-profitability-mobile-expense-fx`
- base：`e03b9b7`（PR #104 head）
- `feature/tender-t2-p15-project-financial-control` **未被修改**（它在另一 worktree 检出，本分支只从其 SHA 派生）

**已知 drift（非本 PR 引入，非 STOP 条件）：** P1.5 与 main 的冲突面 = `prisma/schema.prisma` + `scripts/check-release-safety.test.ts`。
二者都是**追加型**冲突（main 侧新增 T4 `AwardRecord` 模型段 + 迁移白名单条目；P1.5 侧新增财务模型段 + 自己的白名单条目），
属文本相邻冲突而非语义破坏，无 destructive 操作。retarget main 时由 #104 owner 解决。

**对 P1.6 的直接后果（重要）：** T4 的 `AwardRecord`（canonical 中标记录）**不在本 stack 的 base 里**，
因此 P1.6 **不得**把 `AwardRecord` 当作 revenue / award 事实源 —— 见 §3 `REVENUE_SOURCE_GAP`。

---

## 1. EXISTING（已存在 → 复用，禁止重造）

### 1.1 成本事实源（唯一权威）

| 对象 | 位置 | 语义 |
|---|---|---|
| `ProjectCost` | `prisma/schema.prisma:6892` | **唯一权威经济成本账**。`PLANNED → COMMITTED → ACTUAL`，任意态 → `VOIDED`。三金额列 `amountPlanned/amountCommitted/amountActual` 只填充不覆盖。 |
| `cost-service.ts` | `src/lib/project-ledger/cost-service.ts` | ProjectCost 唯一写入口。业务代码禁止直连 `prisma.projectCost.*`。 |
| 类别词表 | `src/lib/project-ledger/types.ts:114` | **13 类冻结契约**：`INTERNAL_LABOR / SITE_VISIT / MILEAGE / PARKING / SAMPLE / COURIER / BOND_INSURANCE / CONSULTANT / SUPPLIER / SUBCONTRACTOR / AI / DATA_API / OTHER`。`AI`/`DATA_API` 保留给 `AiUsageLedger`，`createProjectCost` 主动拒绝。 |
| ACTUAL 修正契约 | `voidProjectCost({ correction })` | `ACTUAL` 后**禁止原地改**。修正 = 同事务内 `VOID 旧行` + `创建 correction 新行`（`correctionOfCostId` 新→旧）+ `cost.voided` / `cost.recorded` 事件。 |
| 授权锚锁 | `lockProjectHistoryAnchorShared` | 建 cost 前对 Project 行取 `FOR KEY SHARE`，与 hard delete 互斥；同时充当租户闸。 |

### 1.2 事件 / 审计

| 对象 | 语义 |
|---|---|
| `ProjectEvent` (`:6824`) | **权威业务事件账**。`@@unique([projectId, eventKey])` 幂等 + `@@unique([projectId, seq])` 顺序。追加失败必须 THROW 并回滚业务事务。 |
| `ProjectEventActor` (`:6871`) | 一事实多参与人（performer / participant / approver）。 |
| `AuditLog` (`:1283`) | **安全 / CRUD 审计**，与 ProjectEvent 职责分离，不得混用。 |
| `event-keys.ts` | 确定性幂等键；禁 `Math.random()` / `Date.now()` / `randomUUID()`。可重复动作用 `transitionCount` 版本化（retry-stable）。 |

### 1.3 P1.5 财务控制（本 stack 的直接前置）

| 对象 | 语义 | P1.6 关系 |
|---|---|---|
| `ProjectBudget` / `ProjectBudgetVersion` / `ProjectBudgetLine` | 版本化预算 + `AWARD_BASELINE` 冻结；百分比行必须保留 `basis`/`basisAmount` | 复用，未改 |
| `ProjectExpenseSubmission` (`:7195`) | **费用提交流程**（≠ 权威成本）。状态机 `DRAFT→SUBMITTED→PENDING_REVIEW→{NEEDS_INFO→RESUBMITTED→PENDING_REVIEW \| REJECTED \| APPROVED}`。`transitionCount` 幂等号。已含 `projectPhaseSnapshot` / `projectStageSnapshot` / OCR 预留列 | **EXTEND**（加列，不新建第二张费用表） |
| `ProjectExpenseAttachment` (`:7247`) | 票据证据：create-only、内容寻址 `sha256`、`@@unique([expenseSubmissionId, contentHash])`、私有 blob + proxyUrl | 复用；仅补 `expense.receipt_uploaded` 事件 |
| `expense-service.approveExpense` | 审批唯一路径：条件 `updateMany(status=PENDING_REVIEW)` 并发闸 → 胜者经 `createProjectCost` 产 `ACTUAL` → 回填 `approvedProjectCostId` → `expense.approved:{id}` 事件，全或全无 | **EXTEND**（同事务追加 payable，不改上述不变量） |
| 自审批禁止 | `submittedById === reviewerUserId → SelfApprovalError`（approve + reject 双路径） | 保留 |
| producer 闸 | `isLedgerProducerActive() = T2_LEDGER_SCHEMA_READY && T2_LEDGER_PRODUCERS_ENABLED`（fail-closed） | 保留 |

### 1.4 权限

| Permission | 位置 | 语义 |
|---|---|---|
| `project:cost:read` | `rbac/permissions.ts:58` | 读财务面 |
| `project:expense:submit` | `:62` | 提交**本人**费用（授予全部项目角色含 viewer/tester）；「本人」由 route 层 `submittedById` 强制 |
| `project:cost:write` | `:63` | 编辑预算版本/行 |
| `project:cost:review` | `:64` | 审批/拒绝费用（`accounting` / `project_admin` / owner / org_admin / super_admin） |
| `accounting` 项目角色 | `rbac/roles.ts:53` | 唯一新增 review 能力的非管理项目角色（脱离资历梯） |
| `requireCostAccess` | `project-finance/access.ts` | flag 门 → `requireProjectReadAccess`（租户+成员+存在性）→ 细粒度权限；`serverActor()` 保证 actor 不可伪造 |

### 1.5 文件 / 上传基础设施

| 对象 | 语义 |
|---|---|
| `putPrivateBlob` (`lib/files/blob-access`) | Vercel Blob private + 授权 proxyUrl |
| `validateUploadedFileAsync` (`lib/files/upload-guard`) | 扩展名白名单 + `ALWAYS_BLOCKED` 可执行黑名单 + magic-byte 反伪造 |
| 票据配置 | `RECEIPT_MAX_BYTES = 15MB`，`RECEIPT_EXTS = [jpg,jpeg,png,webp,heic,pdf]` |

### 1.6 Tender 生命周期 canonical 字段（Project 表）

| 字段 | 语义 | P1.6 用途 |
|---|---|---|
| `submittedAt` | 我方投标提交时间 | **portfolio cohort 的 canonical 日期**（PORT-01） |
| `awardDate` | 结果**公布**日（announcement）；won/lost 都可能有值 | 阶段边界（仅当项目 award-eligible 时才作为 PRE/POST_AWARD 分界） |
| `tenderStatus` | `won` / `lost` / … （`markProjectTenderResult` 写入） | outcome |
| `bidPhaseStatus` | Phase1 投标工作流态，`AWARDED` / `LOST` / … | outcome |
| `workDomain` | `tender` / `delivery` / `general` | outcome + cohort |
| `sourceTenderProjectId` | 交付项目 → 来源投标项目 | 投标成本与交付成本跨项目归集 |
| `isProjectAwardEligible()` | `project-finance/types.ts:158` | **既有 canonical「我方中标」判定**，刻意排除 `awardDate` |
| `ProjectHandoff` (`:377`) | 中标→交付交接（`completedAt`） | 阶段边界回退来源 |
| `estimatedValue` / `ourBidPrice` / `winningBidPrice` | **`Float`**，注释明确「复盘与相似对比用」 | **非权威金额**，只可作 indicative，禁止参与权威利润计算 |

---

## 2. EXTEND（在既有对象上加列 / 加能力，不新建平行事实源）

| 对象 | 追加内容 | 理由 |
|---|---|---|
| `ProjectExpenseSubmission` | `fxRateCadPerOriginalUnit` / `fxRateDate` / `fxRateSource` / `estimatedCadAmount` / `fundingSource` / `paidByUserId` / `amountConfirmedAt` / `amountConfirmedById` | 现有 `totalAmount` + `currency` **本来就是「原始金额 + 原始币种」**，不再另立 `originalAmount/originalCurrency`（会造成重复事实）。FX 快照与出资人是费用**提交事实**的属性，属同一聚合。 |
| `expense-service` | 创建时 FX 快照；金额确认事件；出资人校验；审批同事务产 payable | 保持「审批 = 唯一权威成本产出点」不变量 |
| `attachment-service` | 追加 `expense.receipt_uploaded` ProjectEvent | 补齐任务书 §7 时间线 |
| `upload-guard.checkMagic` | **补** `heic`/`heif` 的 ISO-BMFF `ftyp` 品牌校验 | 现状是 `default: return true` —— HEIC 在白名单内但**魔数未校验**（收紧，不是放开，见 §4） |
| `read-model.getBudgetVsActual` | 行级 actual 改从**权威 ProjectCost**（`refs.budgetLineId`）滚动，而非从 submission 表求和 | 消除「第二事实源读路径」，并使 FX 修正后的金额自动生效 |
| `event-keys.ts` | 追加 P1.6 事件键构造器 | 复用既有 deterministic key 纪律 |
| `rbac/permissions.ts` | 追加 `project:payment:record`（记录付款 = 独立于费用审批的第四权） | 「审批 ≠ 付款」（RULE 6）必须体现在权限面，否则 accounting 审批权自动等于放款权 |

---

## 3. MISSING（当前仓库确实不存在 → 本阶段新建）

| 缺口 | 证据 | 结论 |
|---|---|---|
| **FX / 汇率基础设施** | 全仓 `exchangeRate\|fxRate\|forex\|汇率` 命中仅：`tender-eval` 真实标书 fixture 文本、AI prompt 文案、`getOpenRequestForExternalUser` 子串误命中。**零模型、零服务、零 provider** | `FX_PROVIDER_GAP` = 确认。本阶段建 adapter + `MANUAL` / `SYSTEM_REFERENCE` / `BANK_SETTLEMENT` 来源，**不引入任何付费 FX SaaS** |
| **报销 / 结算 / 付款** | 无任何 payable / payment / reimbursement 模型 | 新建 **settlement subledger**（`ProjectExpensePayable` + `ProjectExpensePayment`），**不进成本账** |
| **出资人（谁先付的钱）** | `ProjectExpenseSubmission` 无相关列 | 新增 `fundingSource` + `paidByUserId` |
| **Change Order 事实源** | 全仓仅 UI 注释：`src/components/ops/delivery-project-detail.tsx:350` —「Phase 4 不创建独立 Risk / ChangeOrder 表」 | `CHANGE_ORDER_MODEL_GAP` = 确认。本阶段**只做收入侧**最小表达（revenue entry 的一个 `entryType`），不做完整 CO 工作流 |
| **权威 revenue** | `ProjectQuote.totalAmount` = 报价单文档；`Project.estimatedValue/ourBidPrice/winningBidPrice` = `Float` 复盘字段；T4 `AwardRecord` **不在本 base**；marketing `revenue` 属另一域（MMM）与项目无关 | **`REVENUE_SOURCE_GAP` = 确认。** 新建**唯一**权威 `ProjectRevenueEntry`（镜像 ProjectCost 纪律：填充不覆盖、void+correction）。理由与去重说明见报告 §D |
| **结构化 Loss Review** | `Project.abandonedReason` 是「放弃」自由文本，非落标复盘；无 loss reason 词表 | 新建 `ProjectTenderLossReview`（primary 单选 + secondary 多选 + 证据 + human confirm） |
| **投标 vs 交付成本切分** | `ProjectCost` 无 phase 列 | **不新建第二套 phase**：用既有 canonical 字段在**读时**推导（见报告 §H） |
| **Portfolio 读模型** | 无 | 新建 server-side read model，前端零遍历 |
| **金额人工确认留痕** | 无 | 新增 `amountConfirmedAt/ById` + `expense.amount_confirmed` 事件 |

---

## 4. DO_NOT_DUPLICATE（明确不做的事）

| 禁止项 | 已确认的唯一事实源 |
|---|---|
| 第二套 actual cost ledger（`ExpenseActual` / `TenderActualCost` / `ReimbursementCost`） | `ProjectCost`（经 `cost-service`） |
| 第二套 AI 成本账 | `AiUsageLedger`（`ProjectCost` 主动拒绝 `AI`/`DATA_API`） |
| 第二套证据/快照体系 | `TenderArchiveItem`（来源证据） / `ProjectExpenseAttachment`（票据证据） |
| 第二套 project phase / stage | `workDomain` + `bidPhaseStatus` + `deliveryStage` + `ProjectExpenseSubmission.projectPhaseSnapshot` |
| 第二套 award state | `isProjectAwardEligible()`（`bidPhaseStatus=AWARDED` \| `tenderStatus=won` \| `workDomain=delivery`） |
| 扩大 `ProjectCost` 13 类冻结词表 | 细分投标花费经 `ProjectCost.refs`（`purpose` / `expenseSubmissionId` / `budgetLineId`）承载 |
| 把 Payment 当成本再统计一次 | Payment 只进 settlement subledger；成本仍只在 `ProjectCost` |
| 第二套并发框架 | 复用 `updateMany` 条件闸 + `FOR UPDATE` 行锁 + `eventKey` 幂等（P1.5 / T3.5 既有模式） |
| 第二套授权 | `requireCostAccess` + `hasProjectPermission` |
| 第二套文件系统 | `putPrivateBlob` + `validateUploadedFileAsync` |
| 落地物化 `totalProfit` / `margin` / `totalCost` 列 | 一律 read model 计算 |

---

## 5. 任务书 §1 的 8 个必答项

| # | 问题 | 审计答案 |
|---|---|---|
| 1 | `ProjectCost` 是否仍是唯一 authoritative cost source | **是。** 且 `cost-service` 是唯一写入口；`AI`/`DATA_API` 归 `AiUsageLedger`。P1.6 不改这一点。 |
| 2 | `ProjectExpenseSubmission.amount/currency` 当前语义 | `totalAmount`（`Decimal(18,2)`）+ `currency`（`String`，UI 默认 `CAD`）= **提交人录入的原始金额与原始币种**。审批时 1:1 传给 `ProjectCost.amountActual`/`currency`，**当前无任何换算**。 |
| 3 | 审批是否仍是 `Expense Approved → ProjectCost.ACTUAL` | **是**，且是同事务、条件闸、`expense.approved:{id}` 幂等。P1.6 在该事务内**追加** payable，不改成本产出语义。 |
| 4 | 是否已有权威 revenue | **否。** `REVENUE_SOURCE_GAP`。 |
| 5 | 是否已有权威 Change Order | **否。** `CHANGE_ORDER_MODEL_GAP`（Phase 4 明确决定不建表）。 |
| 6 | 是否已有汇率服务 | **否。** `FX_PROVIDER_GAP`。 |
| 7 | 是否已有 reimbursement / payment 模型 | **否。** |
| 8 | Tender 的 submitted / won / lost 日期由哪个字段提供 | submitted → `Project.submittedAt`；won/lost **结果** → `tenderStatus` / `bidPhaseStatus`（**状态**，非日期）；结果**公布日** → `Project.awardDate`（won/lost 皆可能非空，**不是「我方中标」信号**）。故 cohort 用 `submittedAt`，胜负用 `isProjectAwardEligible()` + `lost` 判定，二者不可互换。 |

---

## 6. 既有安全缺口（审计顺带发现，本阶段处理方式）

| 缺口 | 现状 | 处理 |
|---|---|---|
| **HEIC 魔数未校验** | `RECEIPT_EXTS` 含 `heic`，但 `checkMagic()` 无 `heic` 分支 → 落入 `default: return true`。即 `.heic` 可承载任意字节通过校验 | **收紧**：补 ISO-BMFF `ftyp` + `heic/heix/hevc/hevx/mif1/msf1/heim/heis/hevm/hevs` 品牌校验。这是**加强**不是放开；生产该功能仍 dark，零存量数据受影响 |
| `read-model` 行级 actual 读 submission 而非 ProjectCost | 与「唯一事实源」原则不一致（CAD 场景数值相同，故非既有 bug，但多币种下会错） | 改读 `ProjectCost.refs.budgetLineId` |

---

## 7. 结论

- 成本事实源、事件账、证据体系、权限体系、上传体系 **全部复用**，本阶段零重造。
- 新增全部为 **additive**：8 个可空列（`ProjectExpenseSubmission`）+ 5 张新表 + 1 个新权限 + 1 个新 schema-ready flag。
- 三个已确认 GAP（`REVENUE_SOURCE_GAP` / `CHANGE_ORDER_MODEL_GAP` / `FX_PROVIDER_GAP`）在报告 §O 中显式登记，不静默假装存在。
