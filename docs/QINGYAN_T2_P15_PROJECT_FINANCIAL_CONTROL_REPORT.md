# QINGYAN T2-P1.5 — Project Financial Control 实施报告

- 日期：2026-08-12（gate-closing + Final Remediation：EXPENSE_SUBMIT 三权解耦 / 授权契约 / Budget UI / **3 blockers：ledger-active 契约 · award baseline 资格 · 预算并发锁**）
- 分支：`feature/tender-t2-p15-project-financial-control`（现 base = origin/main@e0c2dac，已 sync 含 **#105 T3.5** history-anchor / schema-ready 语义）｜Draft PR #104

## 0. Final Remediation（CONDITIONAL_PASS → 三 blockers 闭合，依赖 #105 先 merge）

- **BLOCKER1 Ledger Active Contract**：`approveExpense` 产 ProjectCost.ACTUAL 的闸由旧 `isLedgerProducersEnabled()` 改为 T3.5 canonical `isLedgerProducerActive()`（= `T2_LEDGER_SCHEMA_READY && T2_LEDGER_PRODUCERS_ENABLED`，fail-closed；不自行重构 boolean）。→ `EXP-ACTIVE-01`（schema=false&producer=true → 拒绝且零 ACTUAL）+ 反向/双开组合实证。
- **BLOCKER2 Award Baseline Eligibility**：`freezeAwardBaseline` 服务端校验项目处于仓库既有 canonical 中标态（`bidPhaseStatus="AWARDED"` | `tenderStatus="won"` | `workDomain="delivery"` | `awardDate!=null`——不新造 award state）；来源必须是**当前 ACTIVE** 版本（拒 DRAFT/SUPERSEDED/既有 AWARD_BASELINE；显式 sourceVersionId 须等于 current ACTIVE）。→ `BUDGET-AWARD-01..05`。
- **BLOCKER3 Budget Version Concurrency**：`activateBudgetVersion` / `freezeAwardBaseline` 进入事务后先对 `ProjectBudget` 容器行取 `FOR UPDATE`（镜像 `project-ledger/history-anchor` 的 PostgreSQL row-lock 风格，不另造锁框架），锁后 re-read 状态。→ 保证「每项目至多一个 current ACTIVE」+「至多一个 AWARD_BASELINE」并发下成立；`BUDGET-CONC-01/02`（真实 Postgres 并发实证）。
- 同步保 #105 语义无 drift：`history-anchor.ts`、DEL-RACE、cost/event-service 锚锁未改；隔离快照上 T2-P1/T3.5 ledger DB 60/60、T3 43/43。
- 类型：CORE FINANCIAL CONTROL（预算版本化 → 费用提交 → 票据证据 → Accounting 审核 → ProjectCost.ACTUAL → Budget vs Actual）
- 生产状态：**dark**（`TENDER_FINANCIAL_CONTROL_ENABLED` default OFF；审批产成本再叠加 `T2_LEDGER_PRODUCERS_ENABLED`）
- SCHEMA_CHANGE = ADDITIVE（5 张新表，无 DROP/rename/破坏性 ALTER/backfill）
- WORKFORCE_RUNTIME_MODIFIED = NO ｜ TENDER_UNDERSTANDING_V2_MODIFIED = NO ｜ T2_P1_LEDGER_SEMANTICS_MODIFIED = NO

> 一句话：在已合并的 T2-P1 authoritative ledger 之上，新增独立模块 `src/lib/project-finance/`，建立「Submission ≠ Authoritative Cost」的完整财务控制闭环——费用只有经 Accounting 审核后，才在**同一权威事务**内经既有 `cost-service` 产出 ProjectCost.ACTUAL；权威成本仍是 ProjectCost 唯一事实源，本阶段不新建第二成本源。

## 1. Existing Model Audit（EXISTING_FINANCIAL_MODEL_AUDIT）

三路并行审计结论：

- **无既有 Budget/Expense/Receipt/Invoice/Accounting 模型** → 预算容器、费用提交记录、审核状态机均 greenfield，零重复风险。
- **ProjectCost 是唯一权威成本表**（PLANNED→COMMITTED→ACTUAL→VOIDED，三金额列留痕；类别冻结 13 项，AI/DATA_API 由 AiUsageLedger 专属）。审批终点**复用 `cost-service.createProjectCost({costStatus:"ACTUAL"})`**，绝不建平行 actuals 表；`incurredById≠createdById` 天然建模「X 发生 Y 录入」；`refs.documentId/expenseSubmissionId` 松链票据/费用。
- **ProjectEvent = authoritative business ledger**；`relatedCostId` 链成本，`ProjectEventActor.role` 含 `approver` → 审批可复用。AuditLog 是 security/CRUD 日志，二者不混。
- **RBAC**：per-project `ProjectMember.role`（free-text）+ `src/lib/rbac/` 静态权限映射；无既有 cost 权限/accounting 角色 → 在此**扩展**（非另建）。较新的 `src/lib/authorization/` per-project scope 为 RESERVED/fail-closed，**不碰**。
- **文件基础设施**：`putPrivateBlob`（Vercel Blob private + proxyUrl）+ `validateUploadedFileAsync`（magic-byte 反欺骗）复用；ProjectDocument（Cascade、无 orgId、自动触发 tender 分析）**不适合**票据证据 → 新建 `ProjectExpenseAttachment` 镜像 `TenderArchiveItem` 不可变语义（org-scoped、内容寻址、create-only），存储 I/O 复用 blob 层（不造第二套文件系统）。

## 2. Architecture

```
Award/Contract → ProjectBudgetVersion(DRAFT→ACTIVE, freeze→AWARD_BASELINE 快照)
                    ↓ ProjectBudgetLine（规划 taxonomy；百分比行留 basis+basisAmount）
项目执行 → 成员费用提交 ProjectExpenseSubmission（DRAFT→SUBMITTED→PENDING_REVIEW…）
              ↓ ProjectExpenseAttachment（票据证据，不可变、内容寻址）
Accounting 审核 → approveExpense（同一权威事务）
    ├─ 条件 updateMany(status=PENDING_REVIEW→APPROVED) 并发/双击闸
    ├─ cost-service.createProjectCost({costStatus:"ACTUAL"})  ← 权威成本唯一入口
    ├─ set approvedProjectCostId
    └─ appendProjectEvent(expense.approved:{id}, relatedCostId, actors[performer+approver])
              ↓
Budget vs Actual 只读模型（从 BudgetVersion/Line + ProjectCost + approved expense 计算）
```

模块 `src/lib/project-finance/`：types / flags / event-keys / budget-service / expense-service / attachment-service / read-model / access / index。**复用**（不修改）`src/lib/project-ledger/` 的 event-service / cost-service / event-keys。

## 3. Schema（ADDITIVE）

`prisma/migrations/20260811050000_add_project_financial_control/`（5 表，无 FK 到 project/org 沿用 ledger 硬删存活哲学）：`ProjectBudget`（每项目一容器 + baseline/current 指针）、`ProjectBudgetVersion`（versionNumber + status + total + activated/baselineFrozen 元数据）、`ProjectBudgetLine`（category + amount + percentage/basis/basisAmount + note/supplier/sourceReference + 可扩展 relatedTask/Milestone）、`ProjectExpenseSubmission`（budgetLineId 链接 + costCategory + 三时间戳 + phase/stage 快照 + 金额 + status + reviewedBy + approvedProjectCostId + transitionCount + OCR 预留字段）、`ProjectExpenseAttachment`（内容寻址 storageKey+contentHash + unique[expenseSubmissionId,contentHash] 去重）。已注册进 `verify-migration-history.ts`（EXPECTED_ACTIVE + IMMUTABLE sha256）与 `check-release-safety.test.ts`（sorted 列表）。

## 4. Budget Version Contract

一个项目至多一个 current ACTIVE version（`activateBudgetVersion` 自动把既有 ACTIVE→SUPERSEDED，不动 AWARD_BASELINE）；`createBudgetVersion` 建 DRAFT + 行 + `budget.version.created` 事件；百分比型行（OVERHEAD/CONTINGENCY/PROFIT）**必须**提供 percentage+basis+basisAmount（禁只存无法还原的最终金额，服务层硬校验）。

## 5. Award Baseline Contract

`freezeAwardBaseline` 把来源版本（缺省当前 ACTIVE）的行**快照**成一个新的 `AWARD_BASELINE` 版本（不可变副本），与 current ACTIVE 并存 → 原始中标假设永久保留、后续 ACTIVE 修订永不覆盖 baseline，实现 Baseline vs Actual。写 `budget.baseline_frozen` 事件（baselineAmount/currency/sourceVersionId）。幂等：已存在 baseline → 返回既有。`BASELINE_IMMUTABILITY`：AWARD_BASELINE 版本 `assertVersionEditable` 抛 `BUDGET_BASELINE_IMMUTABLE`。

## 6. Expense Submission State Machine

`DRAFT→SUBMITTED→PENDING_REVIEW→{NEEDS_INFO→RESUBMITTED→PENDING_REVIEW | REJECTED(终) | APPROVED(终)}`。转移表集中于 `types.EXPENSE_TRANSITIONS`（`canTransitionExpense`），服务命令 `createExpenseDraft/submitExpense/requestExpenseInfo/resubmitExpense/rejectExpense/approveExpense`；route 不直接改 status。可重复转移（info_requested/resubmitted）用 `transitionCount` 版本化事件键（retry-stable）。

## 7. Accounting Permission Model

`src/lib/rbac/`：新增权限 `project:expense:submit` + `project:cost:read/write/review` + 项目角色 `accounting`（level 15，**不进 hasProjectRole 单调阶梯** → review 能力仅经细粒度 `project:cost:review` 授予，避免误授管理权）。财务路由守卫 `requireCostAccess`：先 `requireProjectReadAccess`（租户+成员+存在性）再叠加细粒度权限（owner/super_admin/org_admin 特权直通），缺权 403、feature dark 404。

**EXPENSE_SUBMIT 与 COST_WRITE/REVIEW 三权解耦**（产品要求：所有 active 项目成员可提交本人费用）：
- `project:expense:submit`：提交/重提/上传票据「本人」费用 —— **授予每个项目角色（含 viewer/tester 只读角色）**。「本人」归属由 route 层 `submittedById` 校验强制（越权替他人提交 403）。
- `project:cost:write`：编辑预算版本/行（规划动作）—— operator/accounting/project_admin。
- `project:cost:review`：审批/拒绝/要求补充 —— accounting/project_admin（+ owner/org_admin 特权）。
- `project:cost:read`：查看 —— 全部项目角色。

即：一个 read-only（viewer）项目成员**能**提交本人费用，但**不能**编辑预算或审核他人费用。三者互不蕴含，路由按动作精确门控（`expenses` POST + `receipt` POST + 详情 PATCH 的 submit/resubmit → EXPENSE_SUBMIT；PATCH 的 approve/reject/request_info → COST_REVIEW；`budget` POST → COST_WRITE）。actor 一律 `serverActor(access.user.id)`，绝不取自请求体。

## 8. Self Approval Rule

`submittedById === reviewerUserId` → `EXPENSE_SELF_APPROVAL_FORBIDDEN`（服务端硬拒，reject 亦然；UI 同步禁用但服务端才是真闸）。SELF_APPROVAL = BLOCKED（EXP-09 实证）。

## 9. Receipt Evidence

`ProjectExpenseAttachment` 镜像 TenderArchiveItem：`contentHash=sha256(bytes)`、内容寻址 storageKey、create-only（原件永不 update/delete，AI/OCR/审核不得覆盖）、unique[expenseSubmissionId,contentHash] 幂等去重。ORIGINAL_EVIDENCE_IMMUTABLE = 服务层 create-only + DB 唯一约束。

## 10. Approval Atomic Transaction + 11. ProjectCost Mapping

`approveExpense` 单事务：条件 `updateMany(PENDING_REVIEW→APPROVED)` 闸 → 胜者经 `createProjectCost({tx, costStatus:"ACTUAL", category=expense.costCategory 1:1, amount=totalAmount, incurredById=submittedById, incurredAt=expenseOccurredAt, refs:{expenseSubmissionId,budgetLineId,vendorName}, createdById=reviewer})` → set approvedProjectCostId → `appendProjectEvent(expense.approved)`。任一步失败全事务回滚（EXP-08 abort 实证零残留）。客户端不得决定 projectCostId/status/reviewedBy/approval 元数据（全服务端）。

## 12. ProjectCost.ACTUAL Immutability

沿用 T2-P1 冻结契约：审批产的 ProjectCost.ACTUAL 不可原地改（`revisePlannedCost` 抛 COST_LIFECYCLE_VIOLATION，EXP-14 实证）；纠错 = void 旧行 + correction 新行（cost-service 既有能力）。本阶段冻结此后端不变量；完整纠错 UI = DESIGN_ONLY / follow-up。AI_COST_REMAINS_AI_USAGE_LEDGER：费用类别限于冻结集减 AI/DATA_API（pure 测试静态断言 + 服务 assertCostCategory）。

## 13. ProjectEvent Integration + 14. Idempotency

事件全经 `appendProjectEvent`（禁直写）：budget.created/version.created/activated/baseline_frozen、expense.created/submitted/info_requested/resubmitted/rejected/approved。审批幂等键 `expense.approved:{expenseId}`（仅认 expenseId）+ 条件 updateMany 闸 → 一份 expense 至多一条 approved ProjectCost。DOUBLE_APPROVAL_IDEMPOTENCY（EXP-15）+ CONCURRENT_APPROVAL（EXP-16：5 路并发恰一 created、恰一 ProjectCost、恰一事件）均实证。

## 15. Budget vs Actual Read Model

`getBudgetVsActual`（server-side，从 BudgetVersion/Line + ProjectCost + approved expense 计算，禁从聊天/AuditLog/AI 推算）：项目总计（baseline/current/committed/actual/variance/variance%）+ category 级 + line 级（actual 经 approved expense 的 budgetLineId 滚动，taxonomy 无关）。COST-READ-01/02 实证正确。

## 16-19. UI

Project Workbench 嵌入 `FinancialControlCard`（入口简单信息深，不新增顶层导航/不改 detail-tabs；wired 于 `workbench-tab.tsx`）。移动优先、375px 可用、分段导航自动换行。4 个页签：

- **概览**：tiles（中标基线/当前预算/已承诺/实际/差异+variance%/待审）。
- **添加费用**：`AddExpenseForm`（类别/金额 `inputMode=decimal`/日期/供应商/说明 + `capture="environment"` 拍票据，提交即上传 receipt；不依赖 AI）。**任何 active 成员可用**（EXPENSE_SUBMIT）。
- **预算**：`BudgetPanel` —— 按类别 Budget vs Actual 表（预算/实际/差异，超支红字）+ 预算版本列表（状态徽章：草稿/生效中/已被取代/中标基线）；`canManage`（COST_WRITE）时显示：新建版本（动态多行，直接金额类别；百分比型 OVERHEAD/CONTINGENCY/PROFIT 提示需 basis 不在移动快录范围）、激活草稿版本、冻结中标基线（不可逆提示）。`canManage` 由 `budget` GET 返回，UI 仅门控控件，服务端仍二次强制。
- **费用审核**（仅 `canReview`）：`ReviewList`（批准/补充/拒绝；self-approval UI 禁用 + 服务端硬拒）。

feature dark（summary 404）时卡片自渲染为空。数据经 `apiFetch` + 本地 state（无 SWR/server component）。

## 20. Change Order Preparation

未实现完整 Change Order（T2-P1.6 单独做）。schema 预留可扩展：budgetLine.relatedTaskId/Milestone、expense.relatedTask/Milestone、version.metadata、成本 refs——未来 Original Contract Value + Approved COs = Current Approved Contract Value / CO delta / schedule impact 可自然接入，当前不堵死。

## 21. Security / Tenant Isolation

全部 org+project scoped + 服务端授权：服务层 `FinanceTenantError`（跨 org/project append/approve 拒，EXP-11/12 实证），route `requireCostAccess`。禁客户端 orgId/reviewer/approval status 信任；attachment org-scoped + 归属校验。self-approval blocked。

## 22-23. Migration Safety / Production Activation Gate

additive-only；进 verify-migration-history + check-release-safety allowlist；隔离 Neon（staging 子分支 `preview-t2p15-validation`）做 rehearsal（db push 对齐 schema + DB 矩阵），用毕删除 → **ISOLATED_NEON_BRANCHES_LEFT = 0**。生产 migration blocker `20260805090000_marketing_economics` 仍 BLOCKING（表存在但迁移态不一致，plain deploy 会 42P07）→ 本 PR **零生产写/零 migrate resolve/零 deploy**；未来部署前先 read-only schema equivalence audit 再由单独 human-authorized runbook 处理，`BLIND_MIGRATE_RESOLVE = FORBIDDEN`。`PRODUCTION_ACTIVATION_GATE = BLOCKED`。

## 24. Test Matrix

- **纯逻辑 7/7**（`p15-pure.test.ts`，进 test-all + CI 子集）：费用类别 ⊆ 冻结 ProjectCost（无 AI/DATA_API）、预算百分比 taxonomy、状态机合法/非法/终态、flag 默认 OFF、事件键确定性、RBAC accounting review 授权、**EXPENSE_SUBMIT 解耦**（所有项目角色可提交本人费用；viewer/tester 能提交但不得编辑预算/审核）。
- **授权契约 10/10**（`p15-authz-contract.test.ts`，静态源码断言，进 test-all + CI 子集）：每条财务路由都先过 `requireCostAccess`（服务端闸，非仅 UI）；审核动作强制 `PROJECT_COST_REVIEW`；创建/票据走 `PROJECT_EXPENSE_SUBMIT`；预算编辑 `COST_WRITE`、只读 `COST_READ`；**actor 一律 `serverActor(access.user.id)`，禁从请求体取 actor/reviewer/org/submitter**；submit/resubmit 须本人；service 层硬拒自审批 + 条件 updateMany 并发闸；**BLOCKER1 用 `isLedgerProducerActive`（禁用已弃 `isLedgerProducersEnabled`）**；**BLOCKER2/3 freeze 校验中标资格 + 来源当前 ACTIVE + 容器行 FOR UPDATE 锁**；`requireCostAccess` 缺权 403 / feature dark 404。
- **DB 矩阵 42/42**（`p15-finance-db.test.ts`，隔离库执行否则跳过）：BUDGET-01..05、EXP-01..09/11..16、COST-READ-01/02、EVENT-01/02/03，外加 Final Remediation 新增 **EXP-ACTIVE-01..03**（ledger-active 双闸 fail-closed / 正常产成本）、**BUDGET-AWARD-01..05**（非中标拒 / 中标可冻 / DRAFT·SUPERSEDED source 拒 / current ACTIVE 成功）、**BUDGET-CONC-01/02**（真实 Postgres 并发：恰一 ACTIVE、恰一 AWARD_BASELINE）。
- 全量回归（隔离 Neon 生产快照 @ e0c2dac base）：P1.5 DB 42/42；**T2-P1/T3.5 ledger DB 60/60（含 DEL-RACE-01，无 drift）**；T3 记忆 DB 43/43；CI 子集（p1-pure / t3-pure / V2 / tender-eval / workforce 纯测试）PASS；tsc 0 / eslint 净 / build PASS。用毕删隔离分支 → ISOLATED_NEON_BRANCHES_LEFT = 0。

## 25. Known Gaps / Explicit Non-Scope

- Correction/void UI = DESIGN_ONLY（后端 ACTUAL immutability 已冻结）。
- committed-per-line = v1 仅项目总计（per-line committed 待 CO/直接成本链接）。
- OCR 字段仅 schema 预留，本阶段无 AI 抽取（流程不依赖 AI）。
- **Explicit Non-Scope**（未做）：Change Order 完整流程 / T2-P1.6 / T2-P2 / Archive Capture / T3 auto-write / T4 / T5 / AI 自动审批/建预算/改利润 / QuickBooks·Xero / production migration。

## 26. Final Gate

READY_FOR_FINAL_REVIEW（Draft PR，保持 Draft，不 merge，生产 dark，activation BLOCKED）。
