# Design

## Context

动机见 proposal.md「Why」，对外行为见 `specs/cockpit/company-log-labels/spec.md` 与 `specs/cockpit/company-log/spec.md`。现状：

1. **时间线审计条目**（`src/lib/cockpit/timeline.ts` `auditEntry`）：摘要 = `redactCockpitText(action · targetType)`，操作者 = `AuditLog.userId`；读模型（`posts-read-model.ts` `defaultCompanyLogDeps().auditRows`）只取 id / 时间 / 操作人 / 动作 / 目标，不读 `beforeData` / `afterData`。
2. **以负责人名义写的审计**（`AuditLog.userId` 是外键，系统写入只能挂一个真人）：
   - FDE：`revenue_spine.inquiry_reply.draft_snapshot`（`fde/draft-feedback.ts`）、`revenue_spine.followup_draft.guardrail_blocked`（`fde/no-reply-followup.ts`）、`revenue_spine.draft_preferences.ignored`（`draft-preferences.ts`）；
   - 系统：`APPROVAL_SYSTEM_SUPERSEDED`（`pending-actions/supersede.ts`，人工回复 / 入驻测试等触发的作废）；
   - 商机阶段变更 `revenue_spine.opportunity.transition`（`revenue-spine/transition.ts`）：`afterData = { stage, source: human | fde | system, reason, salesActionId, policyKey? }`，`beforeData = { stage }`；`reason` 可能是自由文本。
3. **操作者显示**：`presentation.ts` `actorLabel(actor, actorName)`：`system` → 系统，`ai` → AI，其余显示姓名。
4. **阶段中文名**：`revenue-spine/opportunity-stage.ts` `toCanonicalStage` + `OPPORTUNITY_STAGE_LABELS`（`/revenue` 同一份）。

## Goals / Non-Goals

**Goals:**
- 标签、来源判定、白名单解析都是纯函数，表驱动测试锁定。
- 未知动作不丢信息（回退原始代码）。
- 白名单字段只接受枚举值，自由文本永远不进时间线。

**Non-Goals:**
- 不改任何审计写入方：`fde/draft-feedback.ts`、`fde/no-reply-followup.ts`、`draft-preferences.ts`、`pending-actions/supersede.ts`、`revenue-spine/transition.ts`、`audit/logger.ts`；
- 不改 `TIMELINE_EVENT_TYPES`、`TIMELINE_AUDIT_ACTION_DENYLIST`、自动化运行筛选与游标分页；
- 不改 `src/app/api/cockpit/timeline/route.ts` 的访问控制；
- 不改 `redactCockpitText`。

## Decisions

### D1 标签表放在 `src/lib/cockpit/audit-labels.ts`，按精确动作代码查

- `AUDIT_ACTION_LABELS`：通用动作（`audit/logger.ts` 的 `AUDIT_ACTIONS` 中常见项）、审批生命周期（`capabilities/approvals/decision.ts`、`pending-actions/*` 写的 `APPROVAL_*`）、Revenue Spine 动作；
- `AUDIT_TARGET_LABELS`：常见目标类型（`AUDIT_TARGETS` 常见项 + `pending_action` / `approval` / `approval_request` / `sales_opportunity` / `organization`）；
- 摘要：动作有标签 → `标签 · 目标名`；没有 → 原始 `action · targetType`（目标有中文名也保留原始，避免半中半英的误读）。
- **否决**：按前缀或关键词猜（如含 `approve` 就叫"批准"）。`tender_analysis_approve`、`quote_promotion_approved` 等语义各异，猜错比不翻更糟。

### D2 来源按动作固定 + 商机阶段变更读记录

- `auditSource(action, transition?)`：
  - FDE 固定动作 → `ai`；`APPROVAL_SYSTEM_SUPERSEDED` → `system`；
  - 商机阶段变更：`source` 为 `fde` → `ai`，`system` → `system`，其余（含缺失）→ `human`；
  - 其它 → `human`。
- `TimelineEntry` 新增 `source`；`actor` / `actorName` 语义不变（接口向后兼容，只加字段）。
- **否决**：所有审计都读 `afterData.source`。只有商机阶段变更写了这个字段；为它读全部审计的变更数据（草稿留底一条就近 10k）既贵又扩大了泄露面。

### D3 白名单字段走第二次小查询

- 第一次查询照旧不读变更数据；拿到本页审计后，只对动作为商机阶段变更的 id（≤ limit + 1 条）再查一次 `beforeData` / `afterData`，条件带 `orgId` 与 `id in`。
- `transitionDetailOf(beforeData, afterData)`：两者都是 JSON 字符串；只取 `afterData.source`（枚举）、`afterData.policyKey` 是否为非空字符串（只要布尔）、前后 `stage`（经 `toCanonicalStage`，不认识即丢弃）。解析失败 → 视为没有记录。
- **否决**：第一次查询就 `select afterData`。所有审计都会带上变更数据，违背 A-2 "不读变更前后数据"的口径。

### D4 界面：来源感知的操作者标签

- `presentation.ts` 新增 `entryActorLabel(entry)`：`kind = audit` 且 `source ≠ human` → "AI"/"系统"，并给 `title`"以 <姓名或成员> 名义记录"；其余走原 `actorLabel`。
- `org-cockpit-view.tsx` 操作者列改用它，`title` 放在同一个 `span` 上；列宽不变。
- **否决**：新开一列"来源"。窄屏一行放不下四个短字段，A-3 的布局测试按三列 + 摘要锁定。

## 与八条硬纪律的关系

1. **零 schema**：只读 `AuditLog`；不加列、不加表。
2. **出站先审批**：不涉及（只读展示）。
3. **禁止第三套队列**：不涉及。
4. **脱敏**：白名单只出枚举值（来源、是否按策略、阶段）；原因、金额、策略键本身都不出；新摘要照旧过敏感词整段替换。spec 有一条 SHALL NOT 覆盖。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：纯查表，不调用 LLM。
8. **测试注册**：新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；既有三个测试补断言。

## Risks / Trade-offs

- **[标签覆盖面]**：动作代码分散在 48 个文件里，表只覆盖常见项；没覆盖的照旧显示代码。后续发现高频未覆盖项再补表，不需要改结构。
- **[多一次查询]**：每页最多一次 `id in (≤ 51)` 的主键查询，代价很小；没有商机阶段变更时不查。
- **[来源依赖写入方口径]**：如果以后有新的系统写入动作没进固定表，会显示成人工。表在一个文件里，测试列出了当前全部固定项。

## 验证方式

| 验证项 | 命令或做法 | 期望结果 |
|---|---|---|
| 标签、回退、来源、白名单解析、脱敏 | `npx tsx src/lib/cockpit/__tests__/audit-labels.test.ts` | 全部通过 |
| 信封带 `source`、审计摘要接入 | `npx tsx src/lib/cockpit/__tests__/timeline.test.ts` | 全部通过 |
| 额外查询限定组织与本页、没有阶段变更时不查 | `npx tsx src/lib/cockpit/__tests__/posts-read-model.test.ts` | 全部通过 |
| 操作者列 | `npx tsx src/lib/cockpit/__tests__/presentation.test.ts` | 全部通过 |
| 全量 / 类型 / lint / CI 子集 | `npm test`、`npm run typecheck`、`npm run lint:baseline`、`npm run test:ci` | 与基线一致 / 通过 |
| 规格 | `openspec validate org-cockpit-timeline-labels --strict` | 通过 |
| staging | 在 sunny-home-deco 打开首页时间线 | 自动搁置显示"商机阶段：… → 搁置（按策略自动）"，操作者列为"系统" |

## Migration Plan

无数据迁移。回滚：撤销 PR。接口只多一个字段，旧前端忽略即可。
