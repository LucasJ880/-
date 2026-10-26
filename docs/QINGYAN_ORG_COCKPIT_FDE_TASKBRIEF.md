# 青砚 — 组织驾驶舱（岗位视图）× Inbound Sales FDE 优化 任务书

| 项 | 值 |
|---|---|
| 日期 | 2026-10-25 |
| 基线 | `origin/main` @ PR #242 `feature/acquisition-hub-m1` 合并后 |
| 目标 | A：把 23 项自动化、PendingAction、workforce、AgentRun、AuditLog 投影成一屏"岗位 → 心跳 → KPI → 等你拍板 → 日志"的组织驾驶舱；B：在 A 的度量之上，给 Inbound Sales FDE 补上"人工修改 → 事实沉淀 → 下一封更好"的闭环 |
| 来源 | 外部参考：Simon林《我用 CEO Agent 把自己替换了》（一人公司：人 → CEO Agent → 7 个部门 Agent，排班心跳 / P0-P2 分级 / 等你 N 件 / company.log / 夜间知识沉淀 / AI 工作量看板）。青砚已具备全部原语，缺的是投影与闭环，见 §0 |
| 审批人 | 每个 GATE 由 Claude 审（diff + 测试输出 + 本文验收项），Evan 拍板合并 |
| 纪律 | 沿用 `openspec/config.yaml` context 全部八条：零 schema / 出站先审批 / 禁止第三套队列 / 脱敏 / 不爬登录页 / 邮箱分离 / 确定性优先 / 测试注册。本任务书内所有 change 默认**零新增 LLM 调用**；唯一例外 A-5 单独列为决策项 |
| 与主线关系 | 不打断 Muse 招投标主线；A 阶段纯读、可随时合入；B 阶段只动 `revenue-spine` 与 `employee-ai`，不碰 `tender-*` / `muse-bridge` |

状态图例：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成 · `[G]` 等 Claude 审

---

## 0. 现状审计（只读，2026-10-25）

### 0.1 Simon 的七个构件在青砚里的对应物

| Simon 的构件 | 青砚已有 | 位置 | 缺口 |
|---|---|---|---|
| 部门 Agent 排班 + 心跳 | `AUTOMATION_REGISTRY` 23 项（cadence、组织时区）+ `AutomationRun`（running/succeeded/partial/skipped/failed，30 min 僵尸回收） | `src/lib/automation/registry.ts` `runner.ts` | 没有按"岗位"聚合的健康视图；`getAutomationReadiness()` 只有 readiness，没有迟到 / 失败滚动统计 |
| 等你 N 件 | `PendingAction`（12 种 type）+ `approval` + workforce `projectNeedsYou` | `src/lib/pending-actions` `approval` `workforce-runtime/read-model/projection.ts` | 散在 `/inbox` `/notifications` `/workforce` 三页，没有去重后的总数 |
| CEO 每小时巡视、分级 | `proactive-scan`（每小时）、`ai-grader` 分级→PendingAction、`approval-timeout`、`inquiry-sla` / `service-inbox-sla` | `src/lib/proactive` `ai-grader` | 按业务线各自为政，无横向汇总 |
| 日报 | `daily-brief`（组织本地 07:00）+ `owner-brief` + secretary briefing + `progress-summary` | `src/lib/secretary` `revenue-spine/owner-brief.ts` | 无 |
| company.log | `AuditLog` + `AgentRunEvent` + `AutopilotRunEvent` + `AutomationRun` | 已持久化 | 没有合并的只读时间线 |
| AI 工作量 / 成本 / 无用功 | `AiUsageLedger`、autopilot metrics、老板驾驶舱（仅外贸漏斗，`src/lib/cockpit`） | `src/lib/autopilot` `cockpit` `ai/usage-ledger-bridge.ts` | 没有"岗位 × 天"的提案 / 批准 / 驳回 / 自动执行 / token 视图；回答不了"哪些 AI 活是无用功" |
| 夜间知识沉淀 | `corporate-memory`（MemoryClaim）、`knowledge-extractor`、`practice-miner`（每周一 06:00） | `src/lib/corporate-memory` `employee-ai/practice-miner.ts` | 周粒度、只产候选方法；没有岗位级日结 |

### 0.2 Inbound Sales FDE 现状（`src/lib/revenue-spine`）

流水线（`fde/inbound-sales.ts`，一个 `AgentRun runType=fde_inbound_sales`）：research（确定性分类）→ extract RFQ(+evidence) → factory knowledge → score（六维可解释）→ qualify → missing info → draft（模板 + 可选 LLM 润色，`checkDraftGuardrails` 润色后再跑）→ `PendingAction sales.send_inquiry_reply` → next action。队列面 `fde/inbound-queue.ts`（原子认领，已登记 runtime-architecture 基线）。跟进 `fde/no-reply-followup.ts`（3/7/14 天，只起草）。度量 `sla-metrics.ts`（首响中位 / P90 / 24h 回复率 / 护栏拦截）。归因 `attribution.ts`（fdeSourced / fdeInfluenced）。

**审计发现的闭环断点（本任务书 B 阶段的全部依据）：**

| # | 事实 | 证据 |
|---|---|---|
| F1 | 审批中心对 FDE 草稿的批准 / 修改 / 驳回 / 超时**不产生** `HumanFeedbackEvent`；唯一写入口是手工 `POST /api/agent-feedback` | `grep createHumanFeedbackEvent src` 只命中 `api/agent-feedback/route.ts` 与 `feedback-service.ts` |
| F2 | 执行器发送的是 payload 里的 `body`，**原始草稿与人工修改后的正文没有结构化 diff**落库 | `pending-actions/exec-sales-inquiry-reply.ts` L96/L160；`employee-ai/diff.ts` 的 `StructuredDiff` 无人调用 FDE 路径 |
| F3 | `reply-draft.ts` / `inbound-sales.ts` **不读取**任何 `employee-ai` 偏好或候选方法 | `grep -E 'employee-ai|preference|feedback'` 两文件零命中 |
| F4 | `factory-knowledge.ts` 的 MOQ / 生产周期 / 样品 / 港口全部依赖 `settingsJson.revenue_spine.business_profile.commercialFacts` 手工配置，未配置即草稿写"需内部确认"；没有任何自动沉淀路径 | `factory-knowledge.ts` L102–L119 |
| F5 | `practice-miner` 读 `humanFeedbackEvent` + `businessOutcome`，但因 F1 没有 FDE 的反馈事件，等于**没被 spine 喂** | `practice-miner.ts` L109/L126；V1 报告 §17 P2.3 仍开放 |
| F6 | V1 报告 §16 P1.5：`DAILY_AGENT_RUNS` 配额封顶 FDE 日运行数，配额命中无可视化 | 实施报告 §16 |
| F7 | V1 报告 §16 P1.8：陈旧商机只展示不流转，是否 cron 自动转 `stale` 未决 | 实施报告 §16 |

### 0.3 架构约束（来自 `runtime-architecture/manifest.ts`）

- canonical：`agent-core` / `agent-runtime-v2` / `workforce-runtime` / `approval` / `tool-policy` / `corporate-memory` / `project-ledger`；`autopilot` higher_level。
- frozen：`agent-supervisor`、`agent-task-legacy`。本任务书不触碰。
- 本任务书新增的全部代码位于 `src/lib/cockpit`、`src/lib/revenue-spine`、`src/lib/employee-ai`、`src/app/(main)`、`src/app/api/cockpit`，不进入任何 guarded dir census。

---

## Phase A — 组织驾驶舱（岗位视图）

设计原则：**纯投影**。零 schema、零新 cron、零新 runtime、零新 LLM 调用；全部是对既有表的查表和聚合；页面只读、不复制任何 mutation 入口。

| ID | 任务 | 依赖 | 产物 | 状态 |
|---|---|---|---|---|
| A-1 | 岗位注册表 | — | `src/lib/cockpit/posts.ts` + 表驱动测试 | [G] |
| A-2 | 岗位读模型 + API | A-1 | `src/lib/cockpit/posts-read-model.ts`、`GET /api/cockpit/posts`、`GET /api/cockpit/timeline` | [G] |
| A-3 | 工作台首页 → 岗位卡片 | A-2 | `src/app/(main)/page.tsx` + 组件 | [G] |
| A-4 | 工作量 / 无用功面板 | A-2 | `src/lib/cockpit/workload.ts`、`GET /api/cockpit/workload`、页面区块 | [G] |
| A-5 | （决策）夜间岗位日结 → corporate-memory | A-2 | 见 §A-5 | [ ] |

### A-1 岗位注册表 `src/lib/cockpit/posts.ts`

**Why**：23 项自动化、12 种 PendingAction、workforce work-domain、AgentRun runType 之间没有"岗位"这层归属，所以任何聚合都做不出来。

**What**：代码里的表驱动配置，形制仿 `AUTOMATION_REGISTRY`：

```ts
interface PostDefinition {
  key: PostKey;                 // "inbound_sales" | "tender" | "marketing" | "service" | "projects" | "ops_knowledge" | "content"
  name: string;                 // 岗位中文名
  automationKeys: AutomationKey[];
  pendingActionTypes: PendingActionType[];
  workDomains: string[];        // workforce-runtime work-domain
  agentRunTypes: string[];      // 如 "fde_inbound_sales"
  kpi: PostKpiSpec;             // 指向既有读函数（loadSlaMetrics / cockpit / revenue-spine/cockpit 等），不新写查询
  nav: string;                  // 卡片点击跳转的既有页面路径
}
```

初版岗位：`inbound_sales`（询盘 FDE：daily-brief / inquiry-sla / revenue-spine / sales-actions / followup）、`tender`（tender-watch / tender-auto-analysis / tender-rfq-inbound / approval-timeout）、`marketing`（marketing-* / market-intelligence / postiz-sync）、`service`（service-inbox-sla）、`projects`（project-inspection / progress-summary / proactive-scan）、`ops_knowledge`（employee-ai-practice-miner / release-drift / agent-runs / autopilot-telemetry）、`content`（aivora-sync）。

**受影响意图**：无（Muse `status` 意图可在后续 change 复用 A-2 的汇总，本次不接）。

**Out of scope**：不改 `AUTOMATION_REGISTRY`；不改 PendingAction 类型；不加配置 UI（岗位归属是代码事实，不是租户设置）。

**验收**
1. 纯函数、无 DB；测试文件在 `scripts/test-all.sh` 注册。
2. 穷举测试：每个 `AutomationKey` 与每个 `PendingActionType` **恰好**归属一个岗位；新增 automation / action type 未归属 → 测试失败。
3. `typecheck` / `lint:baseline` 通过，零 schema diff。

### A-2 岗位读模型 `getOrgPostsCockpit(orgId)` + `GET /api/cockpit/posts` / `GET /api/cockpit/timeline`

**Why**：一屏看完是 Simon 系统唯一真正的价值；青砚的数据齐全但散在六个页面。

**What**：
- 每个岗位返回：`heartbeat`（该岗位 automationKeys 最近一次 `AutomationRun`，含 status / startedAt / completedAt）、`nextDueAt`（由 registry cadence + 组织时区推算，纯函数）、`health`（`on_time | late | failed | quota_hit | never_ran`；late = 超过 cadence × 1.5 未跑）、`pendingApprovals`（该岗位 pendingActionTypes 中 status=pending 的数）、`needsYou`（workforce `projectNeedsYou` 按 workDomain 过滤）、`actions7d`（近 7 天 AgentRun / AutomationRun 计数）、`kpi`（调 A-1 指定的既有读函数）。
- 顶部 `waitingForYou`：pending PendingAction ∪ workforce needsYou ∪ 需决策的 Notification（category 白名单），按 `(type, targetId)` 去重后的总数与前 N 条。
- `timeline`：`AuditLog` + `AgentRunEvent` + `AutomationRun` 合并成统一信封 `{at, post, actor: "system"|"ai"|userId, kind, summary, href}`，游标分页，每页 ≤ 50，窗口 ≤ 7 天。
- 访问控制：复用 `withAuth` + 组织解析（Security-1 口径，与 `resolveWorkforceApiOrg` 同）；只读。

**受影响意图**：无。

**Out of scope**：不新建任何表、不写入；不做实时推送；不做跨组织视图。

**验收**
1. 对现有页面与 API 零行为变化（`npm test` 全量绿）。
2. `health` 推算为纯函数并有表驱动测试（含时区边界、cadence 为"按需"的 automation 返回 `n/a`）。
3. 所有查询按 `orgId` 限定；timeline 查询带上限与游标，无全表扫描（`EXPLAIN` 走 `(orgId, createdAt)` 既有索引）。
4. 响应中出现 `毛利` / `winningBidPrice` 等脱敏字段 → 整段替换（复用 Muse 脱敏函数）。

### A-3 工作台首页 → 岗位卡片

**Why**：现首页是通用仪表盘，和 `/revenue` `/workforce` `/capabilities` 各看一角；岗位卡片是"老板一眼看完"的入口。

**What**：`src/app/(main)/page.tsx` 替换为：顶部"等你 N 件"（点击跳 `/inbox`）→ 岗位卡片网格（心跳、health 色、KPI 三个数、待审批 / needsYou）→ 底部 company.log 时间线。卡片点击跳 `nav` 指向的既有页面。视觉按 `DESIGN.md`；不新增顶层导航（遵守 `NAVIGATION_INFORMATION_ARCHITECTURE_DELIVERY.md`）。

**受影响意图**：无。

**Out of scope**：页面内零 mutation；不做移动端专版（响应式即可）。

**验收**
1. 页面全部数据来自 A-2 两个 API，无 mock。
2. 无组织 / 无数据时显示空态而非报错。
3. Lighthouse 首屏请求 ≤ 2 个 API 调用。

### A-4 工作量 / 无用功面板

**Why**：Simon 收尾那段话的工程化——"有 Agent 跟踪数据之后你才知道哪些 AI 活是无用功"。这是对客户最有说服力的一屏，也是 B 阶段 FDE 优化的度量底座。

**What**：`src/lib/cockpit/workload.ts`：按 **岗位 × 天**（默认 14 天）聚合
- runs（AutomationRun + AgentRun）、proposed（PendingAction 创建）、approved / edited / rejected / expired / auto_executed（PendingAction 终态）、guardrail_blocked（FDE：`SalesAction.inputContext.guardrailBlockedAt`）、tokens / cost（`AiUsageLedger` 按 runType 归岗位）。
- 规则化"无用功"信号（阈值放 `Organization.settingsJson.cockpit.workloadThresholds`，默认值在代码）：`rejectRate7d > 0.5`、`expireRate7d > 0.5`、`proposed7d = 0 && runs7d > 0`（空转）、`costPerApproved` 超过岗位中位数 3 倍。命中即卡片标红并给出一句原因。

**受影响意图**：无。

**Out of scope**：不做成本预测；不自动关停任何 automation（标红只是信号）。

**验收**
1. 聚合为纯函数 `computeWorkload(rows)` + 表驱动测试 ≥ 15 例（含 edited 与 approved 的区分、expired 不计入 rejected）。
2. 阈值可由 settingsJson 覆盖，非法值回退默认。
3. 与 `sla-metrics.ts` 的口径一致（入驻测试询盘排除、展会速记卡单列）。

### A-5 （决策项）夜间岗位日结 → corporate-memory

**Why**：Simon 的"每晚去每个部门看一下今天做了什么、沉淀进知识库"。青砚已有 MemoryClaim 与每周 practice-miner，但没有岗位级日结。

**What**：组织本地 23:30，**复用 `daily-brief` 的小时 cron 机制**（`orgsAtLocalHour(..., [23])`，不新建 cron），按岗位把当天 A-4 的聚合与 A-2 的 timeline 摘要写入一条 `MemoryClaim`（claimType=`post_daily_digest`，来源可验证=business_record）。

- **第一版纯模板拼接，零 LLM**。
- LLM 摘要版本单独开 change、放 flag 后面，因为它直接撞 context 第 7 条"不增加新的 LLM 调用"——**需要 Evan 先决定是否修改 `openspec/config.yaml`**，否则 GATE 不过。

**Out of scope**：不回写 settingsJson；不触发任何动作。

**验收**：当日无事件的岗位不写（避免噪音）；同一组织同一天幂等；`corporate-memory/access.ts` 的访问控制不变。

**GATE-A（A-1 ~ A-3）验收（Claude 审）**
1. `git diff --stat prisma/` 为空；`vercel.json` 无改动。
2. `npm test` 全绿；新测试全部已注册；`npm run test:runtime-architecture` 通过（无新 guarded dir 文件）。
3. 以 `seed:org:sunny-home-deco` 组织登录，首页一屏可见 7 个岗位、心跳时间与 health 色、"等你 N 件"数字与 `/inbox` 一致。
4. 任意既有页面行为零变化。

**GATE-A2（A-4）验收**：14 天工作量图与 `/ai-activity` 的运行计数一致；至少能复现一个标红信号并解释原因。

---

## Phase B — Inbound Sales FDE 优化（建立在 A-4 的度量之上）

设计原则：**闭环先于更强模型**。先把人工修改变成可学习的事实，再谈换模型 / 加推理。全部 change 零新增 LLM 调用、零 schema；出站动作仍 100% 经 PendingAction。

| ID | 任务 | 依赖 | 产物 | 状态 |
|---|---|---|---|---|
| B-1 | 审批动作自动产反馈事件 + 草稿结构化 diff | A-4 | `pending-actions/exec-sales-inquiry-reply.ts`、`approval/*` 挂钩、`employee-ai/diff.ts` 接入 | [G] |
| B-2 | 人工修改 → 商务事实沉淀（commercialFacts 提案） | B-1 | `revenue-spine/fact-proposals.ts`、新 PendingActionType `revenue_spine.propose_commercial_fact` | [ ] |
| B-3 | 已确认偏好接入草稿模板层 | B-1 | `revenue-spine/reply-draft.ts` 读 `employee-ai` confirmed 偏好 | [ ] |
| B-4 | 评分校准报表（只报不改） | A-4 | `revenue-spine/score-calibration.ts` + 面板区块 | [G] |
| B-5 | 分级自治：内部动作按 policy 自动化 | B-1 | `revenue-spine/next-action.ts` / `transition.ts` 扩展 | [~] |
| B-6 | （决策）FDE V2 Quotation Engineer 启动条件 | B-2 跑满 30 天 | 见 §B-6 | [ ] |

### B-1 审批动作自动产反馈事件 + 草稿结构化 diff

**Why**：F1 / F2 / F5——FDE 的每一次被批准、改过再发、驳回、过期，今天都是沉默的。没有这些事件，`preference-learner` 和 `practice-miner` 对 FDE 永远是空转；A-4 也算不出 `edited` 与修改幅度。

**What**
1. PendingAction `sales.send_inquiry_reply` 创建时，把**原始草稿快照**（subject / body / 守卫结果 / 引用的 factory facts 列表）写入 `AuditLog`（零 schema；metadata 里存，正文截断 10k 与执行器一致）。
2. 终态时（approved / rejected / expired，在 `approval` 的既有终态入口挂钩，不新建审批面）：
   - 用 `employee-ai/diff.ts` 的 `StructuredDiff` 比较原始草稿与执行正文 → 得到 `edited: boolean`、改动段落类型（问候 / 事实段 / 追问段 / 签名）、改动字数占比。
   - 自动调用 `createHumanFeedbackEvent`（employeeKey=`inbound_sales_fde`，feedbackType 按终态映射：approved_as_is / approved_edited / rejected / expired；scope=team），携带 StructuredDiff，**不存完整正文**。
   - 驳回原因：审批 UI 已有的驳回备注字段原样带入；没有则为空，不猜。
3. A-4 的 `edited` / `approved` 区分从这里取。

**受影响意图**：Muse `approve` / `reject` 命令走同一终态入口，自动获得反馈事件；响应文本不变。

**Out of scope**：不改审批 UI；不改执行器的发送逻辑；不对 Trade Inbox（`/trade/inbox`）的人工回复做 diff。

**验收**
1. 同一 PendingAction 终态只产一条 `HumanFeedbackEvent`（幂等键 = actionId + 终态）。
2. StructuredDiff 单测：全文照发 → `edited=false`；改签名 → 段落类型=signature；加一句 MOQ → 段落类型=facts 且捕获数值。
3. `HumanFeedbackEvent` 与 `AuditLog` 内不含买家邮箱以外的 PII（复用 `autopilot/sanitize.ts` 口径）。
4. 既有 `/api/agent-feedback` 手工入口行为不变。

### B-2 人工修改 → 商务事实沉淀

**Why**：F4——草稿质量最大的拖累是"需内部确认"占位；而销售每次手工把 MOQ / 周期 / 港口填进草稿，这个知识就丢了。这是 Simon"夜间沉淀"的 FDE 版，而且是确定性的。

**What**：`revenue-spine/fact-proposals.ts`
1. 在 B-1 的 `approved_edited` 事件上触发（不是 cron）：对 StructuredDiff 中 facts 段新增内容做**规则化**抽取——复用 `lexicon.ts` 词表 + 数字 / 单位模式，目标字段限定为 `commercialFacts` 已有的键（moq / sampleLeadTime / productionLeadTime / loadingPorts / signature / catalogUrl）。
2. 若对应 `commercialFacts` 键为空或与抽取值冲突 → 创建 PendingAction `revenue_spine.propose_commercial_fact`（新增 union 成员属代码改动，不是 schema），payload = { field, proposedValue, evidence: diff 片段, opportunityId }。
3. 批准 → 执行器写 `Organization.settingsJson.revenue_spine.business_profile.commercialFacts[field]`（既有写入口），并记 AuditLog；驳回 → 不再为同一 (field, proposedValue) 起卡。
4. 限流：同一字段一天最多一张卡；同一字段已有 pending 卡不重复。

**受影响意图**：`approve` / `reject` 自然覆盖新 type；`status` 意图的待审批计数会包含它（符合预期）。

**Out of scope**：不抽价格 / 折扣 / 付款条款（这些永远是"需内部确认"，与 `reply-draft.ts` 硬约束一致）；不用 LLM 抽取。

**验收**
1. 抽取为纯函数，表驱动测试 ≥ 20 例，含"MOQ 500 pcs per color"→ `{quantity:500, unit:"pcs", per:"color"}`、含价格句 → 不产提案、中英混排。
2. 批准后下一封同类目草稿直接引用该事实（端到端测试：先 unavailable → 批准提案 → available）。
3. 只有 admin / boss 角色能批准该 type（复用 `approval` 的角色门）。

### B-3 已确认偏好接入草稿模板层

**Why**：F3——`preference-learner` 产出的 confirmed 偏好（语气、签名、必问字段、禁用语）今天没有消费者。

**What**：`reply-draft.ts` 在**模板生成阶段**读取 `employee-ai` 的 confirmed 团队偏好（employeeKey=`inbound_sales_fde`），只影响：问候与落款模板、追问字段顺序与默认追问集、禁用词替换。守卫顺序不变：`checkDraftGuardrails` 仍在任何 LLM 润色之后再跑；偏好不能注入任何商务承诺（偏好值经同一守卫校验，违规偏好忽略并记 AuditLog）。

**受影响意图**：无。

**Out of scope**：不改 `preference-learner` 的学习规则；不做个人偏好（只 team scope）。

**验收**：偏好开关 `settingsJson.revenue_spine.fde.useConfirmedPreferences`（默认 false）；关闭时草稿字节级不变；开启时有偏好 → 模板体现，且守卫测试全绿。

### B-4 评分校准报表（只报不改）

**Why**：`scoreOpportunity` 六维权重来自 policy，从未与结果对账。Simon 式的"看哪些是无用功"对评分而言就是：哪一维其实不预测赢单。

**What**：`score-calibration.ts`：按窗口（默认 90 天）把 `SalesOpportunityAssessment` 的分维度得分与 `BusinessOutcome`（won / lost / disqualified / quote_sent）对齐，输出每一维的命中率、分桶转化率与"建议权重"（确定性统计，如按分桶转化率归一化）。只在面板展示，**不自动改 policy**；提供"复制为 policy 片段"按钮，人工粘贴到设置。

**Out of scope**：不做模型训练；样本 < 30 时不输出建议（显示"样本不足"）。

**验收**：纯函数 + 固定样本测试；样本不足路径有测试；面板与 `/revenue` 既有数字口径一致。

### B-5 分级自治：内部动作按 policy 自动化

**Why**：Simon 的 P0 / P1 / P2 分级在青砚的对应是"外部动作永远审批，内部动作可以查表自动"。今天 FDE 连不合格询盘关闭、陈旧商机流转（F7）都要人点。

**What**（全部查表，policy 驱动，默认关闭）
- `disqualified` 且命中 `excludedCategoryAction = "decline"` → 自动 `transitionOpportunity(..., source="system")` 关闭并写原因，不起草任何外发。
- open 商机超过 `policy.followUp.staleAfterDays` 且无 pending 草稿、无买家回信 → 自动转 `stale`，Notification 通知负责人（解决 F7）。
- `DAILY_AGENT_RUNS` 配额命中 → A-2 的 health 置 `quota_hit` 并通知 admin（解决 F6 的可视化；配额本身不改）。

**Out of scope**：任何外发仍走 PendingAction；不自动驳回 / 自动批准任何草稿。

**验收**：每条自动流转都有 AuditLog（actor=system，带 policy 键名）；policy 未配置时零行为；`transition.ts` 的 `ALLOWED_TRANSITIONS` 不放宽。

### B-6 （决策项）FDE V2 Quotation Engineer 启动条件

V1 报告 §18 建议下一阶段做 Quotation Engineer，但其前提 factory knowledge 数据源至今仍为 `unavailable`（F4）。建议：**B-2 跑满 30 天、至少 3 个类目的 MOQ / 生产周期由提案沉淀为 available 之后**再启动 V2；否则 V2 仍然在空数据上生成"需内部确认"。

**GATE-B1（B-1）**：在 staging 走一遍"网站询盘 → 草稿 → 修改后批准"，`HumanFeedbackEvent` 恰好一条且含 StructuredDiff；A-4 面板 `edited` 计数 +1。
**GATE-B2（B-2 + B-3）**：修改草稿加入 MOQ → 出现事实提案卡 → 批准 → 下一封草稿引用；驳回 → 不再起卡；价格句永不起卡。
**GATE-B3（B-4 + B-5）**：校准报表在 sunny-home-deco 种子数据上可渲染；自动关闭 / stale 流转各有一条 AuditLog 并可在 company.log 时间线看到。

---

## 已决定（Evan，2026-10-25）

| # | 决策 | 结论 |
|---|---|---|
| D-1 | A-5 的 LLM 摘要版 | **不做**。A-5 只做模板版；`openspec/config.yaml` 第 7 条不改。LLM 版若将来要做，另开 change 并先改 config |
| D-2 | 首页 `/` | **直接替换**为岗位视图（A-3），不新建 `/cockpit`，不保留旧首页 |
| D-3 | 新 PendingActionType | 命名 `revenue_spine.propose_commercial_fact`；审批角色 **admin / boss** |
| D-4 | B-5 自动流转 | 代码默认关闭；**sunny-home-deco 组织默认开启**做 dogfood（通过 seed 脚本写 policy，不改默认值） |
| D-5 | 岗位划分 | 维持七个；`content` 与 `marketing` **保持独立**，便于 Aivora 线单独看 |

以上结论对 Claude Code 是约束：`/opsx:propose` 产出的 proposal 不得重开这五项。

## 实施顺序与 PR 切分

```
A-1 ─► A-2 ─► A-3   （GATE-A，纯读，先合）
        └──► A-4   （GATE-A2）
                └──► B-1 ─► B-2 ─► B-3   （GATE-B1 / GATE-B2）
                      └──► B-4、B-5       （GATE-B3）
A-5、B-6 单独决策后再开 change
```

一个 change = 一个 PR；每个 change 由 Claude Code `/opsx:propose <change>` 产出四件套回传审核后再 `/opsx:apply`。建议 change 命名：`org-cockpit-posts`、`org-cockpit-read-model`、`org-cockpit-home`、`org-cockpit-workload`、`fde-feedback-loop`、`fde-fact-proposals`、`fde-preferences-in-draft`、`fde-score-calibration`、`fde-internal-autonomy`。

## 明确不做

- 不做任何形式的"CEO Agent"运行时、supervisor、调度器——这正是 T5 preflight §2 永久禁令要防的东西；巡视与分级已由 `proactive-scan` / `ai-grader` / SLA cron 承担，缺的只是投影。
- 不动 `agent-supervisor`（frozen）、`agent-task-legacy`（frozen）。
- 不加 Prisma model、不加 cron、不换模型、不加 LLM 调用（A-5 LLM 版除外且需决策）。
- 不改 FDE 的出站规则：首封与跟进永远经 PendingAction。
