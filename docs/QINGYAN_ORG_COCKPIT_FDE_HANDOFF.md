# 组织驾驶舱 × Inbound Sales FDE — 交接记录（换会话从这里接）

> 每完成一个 change 的一个阶段就更新本文件并推送。新会话开工顺序：先读 `CLAUDE.md` §1，再读本文件"当前位置"，再 `openspec list` 看进行中的 change，用 `/opsx:continue <change>` 接着做，不凭记忆重写。

| 项 | 值 |
|---|---|
| 任务书 | `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md`（状态列是 A / B 阶段的事实源） |
| 工作分支 | A-1：`claude/awesome-turing-dorqeg`（基线 `origin/main` @ `51cc62c`，PR #243 合并后）；A-2 起见 PR 策略 |
| PR 策略 | **已定（用户，2026-10-26）**：每个 change 一个独立分支、一个 PR。A-1 用 `claude/awesome-turing-dorqeg`；之后的 change 用 `claude/<change-name>`，从前一个 change 的分支切出（叠加），PR base 指向前一个 change 的分支，前一个合并进 `main` 后把 base 改回 `main`。archive 另走 `claude/archive-<change-name>` 小 PR |
| 每个 change 的完成定义 | 四件套 `openspec validate --strict` 通过 → apply 全部 task 打勾 → 本 change 测试 + typecheck + lint:baseline 绿 → `/opsx:verify` 报告 → 独立审查代理交叉验证（只给代码与规格）并处理发现 → 写 REPORT + 状态列 `[G]` → 提交推送 → 更新本文件 |

## 当前位置

- **A-1 `org-cockpit-posts`**：全部完成，状态 `[G]` 等 GATE。报告 `docs/QINGYAN_ORG_COCKPIT_A-1_REPORT.md`；PR 见进度表。合并后另开 `claude/archive-org-cockpit-posts` 做 `/opsx:archive org-cockpit-posts --yes`。
- **A-2 `org-cockpit-read-model`**（分支 `claude/org-cockpit-read-model`，叠在 A-1 上）：全部完成，状态 `[G]` 等 GATE。报告 `docs/QINGYAN_ORG_COCKPIT_A-2_REPORT.md`（含 staging 待验项：时间线 `EXPLAIN ANALYZE`、sunny-home-deco 人工对账）。
- **A-3 `org-cockpit-home`**（分支 `claude/org-cockpit-home`，叠在 A-2 上，[PR #246](https://github.com/LucasJ880/-/pull/246)，base = A-2 分支）：全部完成，状态 `[G]` 等 GATE。报告 `docs/QINGYAN_ORG_COCKPIT_A-3_REPORT.md`。**GATE 决策项**：旧首页每 5 分钟 `POST /api/proactive/scan` 随替换停止，未开自动化偏好的管理层不再收到主动提醒——接受，或另开 change 让定时任务为管理层同步通知（等用户 / Evan 回复）。
- **A-4 `org-cockpit-workload`**（分支 `claude/org-cockpit-workload`，叠在 A-3 上，[PR #247](https://github.com/LucasJ880/-/pull/247)，base = A-3 分支）：全部完成，状态 `[G]` 等 GATE。报告 `docs/QINGYAN_ORG_COCKPIT_A-4_REPORT.md`（偏差 9 条，交叉审查 5 应修 + 4 小全部处理）。
- **B-1 `fde-feedback-loop`**（分支 `claude/fde-feedback-loop`，叠在 A-4 上）：四件套 ✅；apply 3/5（`draft-diff.ts` 35 条、`draft-feedback.ts` + 接入 61 条）。进行中：task 4.1 全量门禁、独立交叉审查；之后 5.1 报告 + `[G]` + PR（base = `claude/org-cockpit-workload`）。
  - **GATE 决策项（阻塞 B-2）**：现有代码没有"审批时改稿"的路径。`payloadVersion` 恒为 1、审批中心校验 `payloadHash`、批准接口只收决定 + 备注、执行器发载荷正文。所以 `approved_edited` 不会出现，而 B-2 以它为触发。选项：
    - (a) 审批时允许改稿；
    - (b) 对"人工回复作废草稿"（`SUPERSEDED_BY_MANUAL_REPLY`）做草稿 vs 人工回复的 diff；
    - (c) B-2 暂缓。
    - 等用户 / Evan 拍板，未拍板前不开 B-2；B-3 / B-4 / B-5 不依赖它，可先做。
  - 设计要点：终态映射复用 `cockpit/workload.ts` 的 `pendingActionOutcome`；端口批准 / 驳回非重复分支 + 过期赢家 + `approval-timeout` 内补漏（10 分钟沉淀）三路写入时间不重叠，先查后写。事件 `skillSlug = inbound_sales_fde`、`feedbackScope = team_candidate`、`aiOutputRef.terminal/feedbackType`。快照里买家信息替换为占位符，只保留收件人邮箱；事件里连收件人邮箱也不留。
- 已排队后续任务：清理未引用的 `src/components/dashboard/**`（A-3 合并后做）。
- 记录的改进点：A-2 时间线的审计摘要是原始 action 代码（如 `PENDING_ACTION_APPROVED · pending_action`），可在 A-2 读模型加常见动作的中文标签（后续 change）。
- A-2 实施中发现并已修到 A-1（PR #244 分支 `1776263`，再合进 A-2）：`Project.workDomain` 默认 `general` = 未分类项目，不能按工作域规则归到 `ops_knowledge`。

## 进度表

| ID | change | 四件套 | apply | 测试 | verify | 交叉验证 | 状态列 |
|---|---|---|---|---|---|---|---|
| A-1 | `org-cockpit-posts`（[PR #244](https://github.com/LucasJ880/-/pull/244)，base `main`） | ✅（修订 `1482019`） | 4/4 | ✅ 412/426，失败清单 = 基线；test:ci PASS | ✅ 无 WARNING | ✅ 10 条全部处理 | `[G]` |
| A-2 | `org-cockpit-read-model`（[PR #245](https://github.com/LucasJ880/-/pull/245)，base = A-1 分支） | ✅（修订 `4aa5183`） | 6/6 | ✅ 416/430，失败清单 = 基线；test:ci PASS | ✅ 无 WARNING | ✅ 1 阻塞 + 5 应修全部处理 | `[G]` |
| A-3 | `org-cockpit-home`（[PR #246](https://github.com/LucasJ880/-/pull/246)，base = A-2 分支） | ✅ `c7f4b57`（两轮审查后修订） | 8/8 | ✅ 419/433，失败清单 = 基线；test:ci PASS；typecheck 0 | ✅ 无 WARNING | ✅ 两轮：1 阻塞（列为 GATE 决策项）+ 8 应修 + 第二轮 4 项，全部处理 | `[G]` |
| A-4 | `org-cockpit-workload`（[PR #247](https://github.com/LucasJ880/-/pull/247)，base = A-3 分支） | ✅ `00080806` | 7/7 | ✅ 422/436，失败清单 = 基线；test:ci PASS；typecheck 0 | ✅ 无 WARNING | ✅ 5 应修 + 4 小全部处理 | `[G]` |
| B-1 | `fde-feedback-loop`（分支 `claude/fde-feedback-loop`，叠在 A-4 上） | ✅ 四件套 `61feec70` | 3/5 | 进行中 | — | 进行中 | `[~]` |
| B-2 | `fde-fact-proposals` | — | — | — | — | — | `[ ]` |
| B-3 | `fde-preferences-in-draft` | — | — | — | — | — | `[ ]` |
| B-4 | `fde-score-calibration` | — | — | — | — | — | `[ ]` |
| B-5 | `fde-internal-autonomy` | — | — | — | — | — | `[ ]` |

A-5、B-6 是决策项，不开 change（D-1：A-5 只做模板版，需另行决定是否启动）。

## 已做的判断（GATE 审核时逐条确认；详见各 change 的 proposal "偏差"一节）

1. 代码现状是 28 项自动化、14 种 PendingAction（任务书写 23 / 12）；A-1 按代码现状穷举。
2. `approval-timeout` 归 `ops_knowledge`，不归 `tender`（它处理全组织所有类型的审批过期）。**已认可（用户，2026-10-26）**。
3. ~~`grader.*` 与 `calendar.create_event` 归 `projects`~~（交叉审查证伪：多条链路产出）→ 改为**通用动作类型**，按行上下文归属（项目工作域 → 目标类型 → 产出 runType → 未归属）。`runtime_v2` 归 `inbound_sales`。
4. 工作域：`sales`→`inbound_sales`、`tender`→`tender`、`delivery`→`projects`、`general`→`ops_knowledge`。
5. `service`、`content` 没有既有只读读函数，A-1 的 KPI 标"未接入"；A-2 决定是否把路由里的内联查询原样抽成读函数。
6. `tender` 的 KPI 来源 `getTenderPortfolioSummary`、`marketing` 的 `getMarketingDashboard` 返回值含毛利 / 利润 / 估值 / 中标金额，KPI 只取白名单计数字段。
7. `ops_knowledge` 卡片跳 `/ai-activity`（不跳 `/ai/autopilot`，后者有权限门与开关）。
8. （A-2）心跳是平台级（AutomationRun 不带 orgId）；健康度多 `n/a` / `not_configured`；迟到按类型化调度表（对照 vercel.json）判断。
9. （A-2）"等你 N 件" = `/capabilities/approvals` 待我审批（PendingAction + ApprovalRequest + 产品内容审批，带决策权）∪ workforce 需要你，作业的审批已列出则去重；通知不另计。**A-3 的跳转目标是 `/capabilities/approvals`，不是 `/inbox`**（`/inbox` 是快速捕获页）。
10. （A-2）两个 API 只对首页同口径管理层开放；时间线无 `(orgId, createdAt)` 索引，靠 7 天窗口 + limit+1 + 事件白名单，`EXPLAIN` 留到 staging。

## A-4 预研事实（只读调研结果，写 proposal 前先核对一遍）

任务书 A-4 的口径与代码现状有几处对不上，propose 时要逐条写成"偏差"：

1. **AutomationRun** 有 `orgId String?` 列和 `[orgId, automationKey, startedAt]` 索引，但唯一写入方 `runTrackedAutomation`（`src/lib/automation/runner.ts`）的 45 个调用点都不传 orgId → 实际恒为 null，仍按平台级处理。**AgentRun** `orgId` 必填，但没有 `(orgId, createdAt)` 索引（有 `[orgId, status]`）。
2. **PendingAction 状态只有** pending / approved（执行中的占位）/ executed / failed / rejected。
   - 没有 `expired` / `edited` / `auto_executed`。
   - 过期 = `status: "failed"` 且 `failureReason: "已过期"`、无 `decidedById`（`expireOverdueApprovals`，`src/lib/approval/port.ts`；执行器懒过期 `executor.ts`）。
   - 人工取消 = failed + "已取消"（有 decidedById）；关联任务取消 = rejected + "关联任务已取消…"。
   - 其他 failed 原因：BATCH_PREPARE_FAILED、未接入执行器、报价让利已变化、`SUPERSEDED_BY_ONBOARDING_TEST` 前缀。
   - **没有"编辑后批准"信号**：PendingAction 无 editedPayload，审批接口只收 decision + reason。`humanDecision: "edited"` 属于 employee-ai 反馈系统（`src/lib/employee-ai/feedback-service.ts`），不是 PendingAction。
   - 没有自动执行路径（报价路由直接 pending→executed 也带 decidedById）。
   - 索引 `[orgId, status, createdAt]`。
3. **SalesAction.inputContext.guardrailBlockedAt**：ISO 字符串，`guardrailMarkerPatch`（`src/lib/revenue-spine/fde/inbound-sales.ts`）在 draftStatus 为 guardrail_blocked / no_email 且有违规时写入，重跑不清除；SalesAction `orgId` 必填。
4. **AiUsageLedger 没有 runType**。
   - `sourceType` 取值：AGENT_RUNTIME / PRODUCT_CONTENT / IMAGE_ENGINE / SUPERVISOR / WORKFLOW / MANUAL_IMPORT。
   - 只能经 `runId → AgentRun.runType` 归岗位，而且 runId 经常为空（`ai/usage-ledger-bridge.ts` 不填）。
   - 字段：`costAmount Decimal(18,6)`、`inputTokens` / `outputTokens`。索引 `[orgId, occurredAt]`。
5. **Organization.settingsJson**（`Json?`）目前没有 `cockpit` 键；仓库惯例是每个键一个纯函数读取 `settingsJson: unknown`（如 `resolveOrgTimezone`、`runVisibilityFromOrgSettings`）。
6. **sla-metrics.ts**（`src/lib/revenue-spine/sla-metrics.ts`）已导出可复用的判定：
   - `isOnboardingTestInquiry({utmSource, customerTags, lostReason})`；
   - `utmSourceOf(inputContext)`；
   - `TRADE_SHOW_SOURCE = "trade_show"`，来源取 `opportunity.source ?? inputContext.source`。
   - 统计范围：`employeeKey = FDE_EMPLOYEE_KEY`、`actionType = "inbound_inquiry"`，先按商机去重，再排除测试询盘，再把展会单列。
   - `sla-tiers.ts` 已在复用这些判定。
7. **`/ai-activity` 不显示任何运行计数**：它按**当前用户**分页读 AuditLog（`ai_generate` / `ai_send` / `ai_analyze`），浏览器本地时区分天。GATE-A2"14 天工作量图与 `/ai-activity` 的运行计数一致"按字面无法满足，需改口径。
8. **按天分桶**：组织时区来自 `settingsJson.timezone`（`resolveOrgTimezone`，默认 America/Toronto），`getLocalTimeParts(date, tz).date` 给 YYYY-MM-DD，`localDayBounds` / `zonedLocalToUtc` 在 `revenue-spine/owner-today.ts`、`business-days.ts`；没有现成的多天分桶函数。

## B-4 预研事实（评分校准，写 proposal 前核对）

1. **评估记录**：`SalesOpportunityAssessment`。
   - 六维分数只在 `dimensionsJson`：`[{key,label,score,max,reason}]`，key 为 productFit / commercialPotential / buyerQuality / intent / completeness / strategicValue。
   - **`max` = 打分当时的 policy 权重**：要按 score/max 归一。`policyVersion` 恒为 v1，不能据此区分权重。
   - 唯一写入方 `fde/inbound-sales.ts`；一个商机可有多条，"当前" = `createdAt` 最新（与商机详情页一致）。
   - `qualification` 不落在评估上。
2. **权重**：`policy.scoring.weights`，默认 25/20/20/15/10/10。总分 = min(100, 各维之和)。分级阈值 hot 90 / high 70 / medium 50。
3. **结果真值**：
   - `BusinessOutcome` 经 `entityType="sales_opportunity"` + `entityId` 关联。写入的类型有 CUSTOMER_REPLIED / RFQ_RECEIVED / QUOTE_SENT / SAMPLE_REQUESTED / NEGOTIATION_STARTED / DEAL_WON / DEAL_LOST / REVENUE_RECORDED。
   - **没有 disqualified 结果**；`sourceId` 带时间戳，会重复写。
   - **`/revenue` 用 `SalesOpportunity.stage` + `wonAt` / `lostAt` / `lostReason`**（`revenue-spine/cockpit.ts`），校准应与之同口径。
   - **disqualified 是循环的**：由 `score.qualification` 自己决定，不能拿来校准评分。
4. **`/revenue` 页没有胜率 / 转化率 / 分级分布 / 时间窗口**。
   - 只有 stageCounts 排除测试商机，用 `EXCLUDE_ONBOARDING_TEST_OPPORTUNITIES`，只看 lostReason；
   - SLA 指标用更严的 `isOnboardingTestInquiry`。
5. **policy 不在 `settingsJson`**：在 `OrgBusinessRule`（`ruleKey = "revenue_spine.policy"`，最高版本，`loadRevenueSpinePolicy`）。
   - 权重片段形状：`{"scoring":{"weights":{...}}}`；
   - 应用方式：`PUT /api/revenue/policy` `{ policy: <片段> }`，boss / admin，发布新版本。
6. **面板位置**：`/revenue` 是单个客户端页（`src/app/(main)/revenue/page.tsx`），可在队列网格后加只读区块。
   - API 惯例：`resolveRevenueAccess(request)` + `force-dynamic` + `?days=` + `clampWindowDays`（默认 30、上限 180，需另设 90 默认）。

## 环境（云端容器每次都是新的，照做即可）

```bash
# Node 24（容器自带 v22，项目要求 >=24 <25）
mkdir -p /opt/node24 && cd /opt/node24 \
  && curl -sS -O https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.xz \
  && tar -xJf node-v24.22.1-linux-x64.tar.xz && rm node-v24.22.1-linux-x64.tar.xz
export PATH=/opt/node24/node-v24.22.1-linux-x64/bin:$PATH

cd <repo> && npm ci
# npm 11 默认不跑依赖的 install 脚本，手动补三步：
(cd node_modules/esbuild && node install.js)
(cd node_modules/@prisma/engines && node scripts/postinstall.js)
npx prisma generate

npm i -g @fission-ai/openspec@1.15.0   # openspec CLI
```

## 已知的既有问题（不是本任务引入，不在本任务修）

- `bash scripts/check-test-registry.sh` 在 `main` 上已失败：PR #242 带入 `src/lib/trade/__tests__/inbound-org.test.ts`、`src/lib/trade/__tests__/channel-inbound-id-db.isolated.test.ts` 未注册。另一会话的 `register-acquisition-hub-tests` change（分支 `claude/affectionate-ptolemy-81vzuy`）在处理。
- 容器里没有 Postgres：DB 集成测试会以 MISSING_DATABASE_URL 失败或跳过；`npm test` 的失败项要与基线逐条比对，只认新增失败。
