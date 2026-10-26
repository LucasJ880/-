# Proposal: org-cockpit-timeline-labels

**TASKFLOW：** A-2 后续（A-2 HANDOFF"记录的改进点"与 B-5 报告 GATE 注意项的落地，不是任务书新编号）。状态列沿用 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` 的 A-2 行。本分支叠在 B-6（`claude/fde-v2-readiness`）之上，逻辑上只依赖 A-2。
**受影响的 Muse 意图：** 无。
**已决定（不重开）：** 改进项按推荐顺序做（用户 2026-10-26 第二轮）。

## Why

company.log 时间线里的审计条目直接显示原始动作代码（如 `revenue_spine.opportunity.transition · sales_opportunity`），而且系统或 FDE 以负责人名义写的审计（自动搁置、草稿留底、审批被系统作废）显示成负责人本人操作。本 change 给常见动作配中文摘要，并给每条时间线条目标出来源（人工 / AI / 系统）。

## What Changes

- **审计条目中文摘要**：常见动作（通用增删改、登录与成员、审批生命周期、Revenue Spine 商机 / 商务事实 / 草稿相关）与常见目标类型配中文标签；没有标签的动作照旧显示原始代码，不丢信息。
- **商机阶段变更显示前后阶段**：`revenue_spine.opportunity.transition` 显示为"商机阶段：<原阶段> → <新阶段>"，按策略自动流转时追加"（按策略自动）"。阶段只认已知阶段值，其它值不显示。
- **条目来源**：每条时间线条目新增 `source`：
  - AI 运行事件 = `ai`，自动化运行 = `system`；
  - 审计条目默认 `human`；固定由 FDE 写的动作（草稿留底、跟进草稿被守卫拦下、草稿偏好被忽略）= `ai`；审批被系统作废 = `system`；商机阶段变更按审计里记录的流转来源（人工 / FDE / 系统）。
- **只读白名单字段**：只为商机阶段变更这一种审计额外读取 `source`、`policyKey` 是否存在与前后 `stage` 三个字段，且只接受已知枚举值；其它审计仍不读变更前后数据。
- **时间线显示来源**：操作者列对 `ai` / `system` 来源的审计显示"AI"/"系统"，并提示"以 <负责人> 名义记录"；人工条目照旧显示姓名。
- **新增测试**：标签与回退、来源判定、白名单解析（异常值不显示）、读模型额外查询的组织范围、界面渲染；注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

**与任务书的偏差（GATE 审核时请逐条确认）：**
1. **不是任务书条目**：A-2 HANDOFF 记录的改进点与 B-5 GATE 注意项。
2. **A-2 原则"审计不读变更前后数据"开一个窄口子**：只对商机阶段变更读 3 个枚举字段，用于显示前后阶段与来源；不读原因、金额等其它字段（原因可能是自由文本）。
3. **不改时间线收录范围**：草稿留底这类高频审计仍进时间线（只是有了中文标签与 AI 来源）；是否从时间线去掉留给后续判断。

## Capabilities

### New Capabilities
- `cockpit/company-log-labels`：时间线审计条目的中文摘要、商机阶段变更的前后阶段、条目来源（人工 / AI / 系统）与只读白名单字段、界面上的来源显示。

### Modified Capabilities
- `cockpit/company-log`（A-2，未归档）：「统一信封」增加 `source` 字段。

## Impact

- 新文件：`src/lib/cockpit/audit-labels.ts`（标签表、来源判定、白名单解析，纯函数）；测试 `src/lib/cockpit/__tests__/audit-labels.test.ts`。
- 修改：
  - `src/lib/cockpit/timeline.ts`（`TimelineEntry.source`、审计摘要与来源）；
  - `src/lib/cockpit/posts-read-model.ts`（商机阶段变更的白名单字段额外查询）；
  - `src/lib/cockpit/presentation.ts`（来源感知的操作者标签）；
  - `src/components/cockpit/org-cockpit-view.tsx`（操作者列）；
  - 既有测试 `timeline.test.ts`、`posts-read-model.test.ts`、`presentation.test.ts` 补断言；
  - `scripts/test-all.sh`、`scripts/test-ci-unit.sh`。
- 零 schema；不新增 cron / 队列；无 LLM 调用；无外发。

## Out of scope

- 不改审计写入方（不给任何 `logAudit` 调用补字段）。
- 不改时间线收录范围（白名单事件、记账类动作黑名单、自动化运行筛选都不变）。
- 不改脱敏规则（敏感词整段替换照旧作用于新摘要）。
- 不做英文标签。
