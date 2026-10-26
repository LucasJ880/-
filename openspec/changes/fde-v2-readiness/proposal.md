# Proposal: fde-v2-readiness

**TASKFLOW：** B-6（决策项：FDE V2 Quotation Engineer 启动条件）。状态列在 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` Phase B 表。本分支叠在 A-3b（`claude/org-cockpit-proactive-notify`）之上；B-6 本身只依赖 B-2（事实提案）与 B-1（草稿快照）。
**受影响的 Muse 意图：** 无。
**已决定（不重开）：** 本 change 只交只读就绪度指标，不启动 V2 本身（用户 2026-10-26："A5和B-6开始"，HANDOFF 已记）；V2 是否启动仍由 Evan 按指标决定。

## Why

任务书 §B-6 给的启动条件是"B-2 跑满 30 天、MOQ / 生产周期由提案沉淀为 available"，但今天没有任何地方能看到这些条件满没满足，决策只能靠翻数据库。本 change 把条件做成 `/revenue` 上一个只读区块，按组织给出每条条件的状态与依据，不写任何数据。

## What Changes

- 新增就绪度计算（纯函数），按组织输出四条条件，每条为"已满足 / 未满足 / 无法度量"并附一句依据：
  1. **事实提案已运行满 30 天**：本组织第一张商务事实提案创建至今 ≥ 30 天；
  2. **MOQ 已可引用**：与草稿同一口径（`getMOQ` 为 available）；
  3. **生产周期已可引用**：与草稿同一口径（`getLeadTime` 为 available）；
  4. **至少 3 个类目的 MOQ / 生产周期**：固定为"无法度量"，依据写明商务事实目前是组织级、不分类目（见偏差 1）。
  - 结论：前三条都满足 → "已达到任务书建议的启动条件（组织级口径）"；否则列出未满足的条件。
- 输出依据数据（只有计数、比率、是否配置，不含任何值）：
  - 事实提案：首张提案距今天数；近 30 天新建、已写入、驳回、待审批、已过期张数，按字段（MOQ / 样品时效 / 生产周期 / 装运港 / 落款 / 目录链接）分列；
  - MOQ 与生产周期的来源：经提案写入过几次，或从未经提案（手工配置）；
  - 首封草稿：近 30 天首封回复草稿数，以及其中仍写"需内部确认 MOQ""需内部确认生产周期"的封数与占比；
  - V2 其余数据源：认证清单、成本基础是否可用；样品政策、最低毛利是否配置（只给是 / 否）；历史报价条数；已配置的产品类目数。
- 新增只读接口 `GET /api/revenue/v2-readiness`：组织由服务端解析（与 `/api/revenue/*` 同一访问规则），不接受请求里的 orgId。
- `/revenue` 页在"评分校准"区块下方新增"FDE V2 启动条件（只读）"区块：默认收起，点击才请求；状态用图标 + 文字，不只靠颜色。

**偏差（与任务书 §B-6 的差异）**
1. 任务书要"至少 3 个类目"。`commercialFacts` 的 MOQ / 生产周期是组织级单值，不存在类目级数据，这条如实标为"无法度量"，不拿组织级值冒充类目数；结论里单独提示这一条需要 Evan 判断。
2. 任务书写"由提案沉淀为 available"。指标按"可引用"判定，来源（提案 / 手工）作为依据列出，不把手工配置的事实判为不满足（理由见 design D2）。

## Capabilities

### New Capabilities
- `revenue-spine/fde-v2-readiness`：按组织计算并展示 FDE V2 启动条件的只读就绪度（条件状态、依据计数、脱敏边界、只读接口与 `/revenue` 区块）。

### Modified Capabilities
- 无。

## Impact

- 新增：
  - `src/lib/revenue-spine/v2-readiness.ts`（纯函数）；
  - `src/lib/revenue-spine/v2-readiness-read-model.ts`（只读查询，依赖可注入）；
  - `src/app/api/revenue/v2-readiness/route.ts`；
  - `src/components/revenue/v2-readiness-panel.tsx`；
  - 测试 `src/lib/revenue-spine/__tests__/v2-readiness.test.ts`、`src/components/revenue/__tests__/v2-readiness-panel.test.tsx`（注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`）。
- 修改：`src/app/(main)/revenue/page.tsx`（挂一个区块）。
- 只读：`PendingAction`、`AuditLog`、`TradeQuote`、`SalesQuote`（只计数）、`OrgBusinessRule`（经 `loadRevenueSpinePolicy`）。不写任何表。

## Out of scope

- 不启动 V2 Quotation Engineer，不新增报价相关的生成、建议或审批卡。
- 不做类目级商务事实（不改 `commercialFacts` 结构，不改 `policy.ts`、`factory-knowledge.ts`）。
- 不改事实提案（`fact-proposals.ts`、`fact-extract.ts`）与草稿生成（`reply-draft.ts`）。
- 不输出 MOQ / 周期 / 最低毛利 / 报价金额等任何具体值；不读客户名与邮箱。
- 不新增定时任务、不发通知、不改 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` 的启动条件本身。
