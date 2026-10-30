# Design

## Context

动机见 proposal.md「Why」，对外行为见 `specs/revenue-spine/fde-v2-readiness/spec.md`。决定做法的现状：

1. **商务事实**：
   - 在 `OrgBusinessRule(revenue_spine.business_profile)` 的 `commercialFacts`，由 `loadRevenueSpinePolicy` 读出；
   - MOQ（`moq`）与大货周期（`productionLeadTime`）都是组织级单值，没有类目维度；
   - 草稿是否能引用，由 `factory-knowledge.ts` 的 `getMOQ` / `getLeadTime` 决定（未配置 → unavailable → 草稿写"需内部确认"）；
   - `getCertification`、`getCostBasis` 目前恒为 unavailable。
2. **事实提案（B-2）**：
   - `PendingAction(type = revenue_spine.propose_commercial_fact)`，`payload.field` 是六个字段之一；
   - 状态：`pending`、`approved`（认领中）、`executed`、`rejected`、`failed`。过期没有单独状态：`approval-timeout`（每 2 小时）把过期的待审批改成 `failed` + `failureReason = "已过期"`，执行器懒过期写法相同；清理前的过期仍是 `pending` 且 `expiresAt` 已过。A-4 的 `cockpit/workload.ts` `pendingActionOutcome` 已把这些终态归好类；
   - 写入成功记 `AuditLog(action = revenue_spine.commercial_fact.applied)`，`afterData` 是 JSON 字符串，含 `field`、`valueKey`、`version`；值相同不写新版本时不记这条审计。
3. **草稿快照（B-1）**：
   - `AuditLog(action = revenue_spine.inquiry_reply.draft_snapshot, targetType = pending_action)`，`afterData` 是 JSON 字符串；
   - 快照含 `followUpStep`（首封为 `null`）与 `pendingInternalConfirmation`（字符串数组），还有正文（≤ 10k）；
   - 首封里 MOQ 未配置时写 `"MOQ"`；周期未配置时写"生产周期与交期"（中文）或 "production lead time and delivery schedule"（英文）。
4. **页面与接口惯例**：
   - `/api/revenue/*` 统一用 `resolveRevenueAccess` + `force-dynamic`；
   - B-4 的 `score-calibration-panel.tsx` 已有"点开才请求"的容器 + 无 hook 视图写法，可照搬。

## Goals / Non-Goals

**Goals:**
- 条件判定与计数全部在纯函数里，读模型只查数；用固定样本锁定每个状态与数字。
- 判定口径直接调用 `factory-knowledge.ts` 的函数，与草稿同源，不另写一份"可引用"规则。
- `/revenue` 首屏零影响（不加首屏请求、不改已有区块）。

**Non-Goals:**
- 不改以下文件：
  - `src/lib/revenue-spine/policy.ts`、`factory-knowledge.ts`、`fact-proposals.ts`、`fact-extract.ts`、`reply-draft.ts`；
  - `src/lib/revenue-spine/fde/draft-feedback.ts`、`fde/inbound-sales.ts`、`fde/no-reply-followup.ts`；
  - `src/lib/pending-actions/**`；
  - `src/components/revenue/score-calibration-panel.tsx`；
  - `prisma/schema.prisma`、`vercel.json`。

## Decisions

### D1 条件 4 固定为"无法度量"

- 任务书要"至少 3 个类目的 MOQ / 生产周期"；`commercialFacts` 没有类目维度。
- 条件 4 固定输出"无法度量"，依据写明原因；结论里单独提示"需人工判断"，不计为已满足。
- **否决**：
  - 用"已配置产品类目数 ≥ 3 且组织级 MOQ 可引用"代替。组织级 MOQ 对每个类目都一样，这会把一个值算成三个类目，结论失真；
  - 为此改 `commercialFacts` 结构做类目级事实。超出决策项范围，属于 V2 本身的工作。

### D2 MOQ / 周期按"可引用"判定，来源只作依据

- 条件 2、3 直接看 `getMOQ(null, policy).status`、`getLeadTime(null, policy).status`。
- 来源：统计 `commercial_fact.applied` 审计里该字段的条数；0 条标为手工配置。
- **否决**：只认"经提案写入"。V2 需要的是已确认的数据；负责人一开始就手工配好的组织会被判为永远不满足，与任务书"否则 V2 仍在空数据上生成"的本意相反。B-2 是否在运转由条件 1 和提案计数体现。

### D3 条件 1 用本组织第一张事实提案的创建时间

- B-2 在每个组织的"开始运行"没有单独记录；第一张提案是可观察的最早证据。
- 还没有提案时条件 1 未满足、天数为空。
- **否决**：用 B-2 合并日期或代码常量。各组织启用时间不同（偏好、FDE 负责人配置各异），常量日期对没开 FDE 的组织会误判为已满足。

### D4 首封草稿占比从快照读取，最近 300 封封顶

- 近 30 天 `draft_snapshot` 审计，按创建时间倒序最多读 301 条；超过 300 条只统计最近 300 封并标记。
- 只解析 `followUpStep` 与 `pendingInternalConfirmation`，正文读出后即丢弃，不进入响应。
- 同一审批（`targetId`）只留最新一份快照：并发重跑同一封来信时 `requestApproval` 会返回已有审批，但快照照写。
- 只发目录的首封（展会 C 级 + `gradeCCatalogOnly`）`pendingInternalConfirmation` 为空；非目录首封一定含"价格 / pricing"。所以"待确认项为空的首封"单独计为只发目录，不进占比分母，否则 MOQ 未配置时占比会被拉低、与条件 2 的依据矛盾。
- MOQ 匹配 `"MOQ"`；周期匹配"生产周期与交期"或 "production lead time and delivery schedule"（与 `reply-draft.ts` 的两个固定文案逐字一致，测试对照源码）。
- **否决**：从 `AgentRun` 事件 `agent.output` 读 `pendingInternalConfirmation`。事件也写首封之外的路径（复用未决草稿等），与"进了审批的首封"口径不一致；快照是 B-1 专门为审批草稿留的。

### D5 读模型：六个只读查询，依赖可注入

- 查询：
  1. 第一张提案（`orderBy createdAt asc`，`take 1`）；
  2. 近 30 天提案（只取 `status`、`expiresAt`、`failureReason`、`decidedById`、`payload`，读 2001 条判断是否超过 2000，超出标记截断）；
  3. 写入审计（只取 `afterData`，读 2001 条判断是否超过 2000）；
  4. 近 30 天快照（只取 `targetId`、`afterData`，读 301 条判断是否超过 300）；
  5. 历史报价计数（`TradeQuote.count` + `SalesQuote.count`，只要条数）；
  6. policy（`loadRevenueSpinePolicy`）。
- 查询条件由读模型导出的纯函数构造，全部带服务端解析出的 `orgId`；测试用源码断言锁定每个默认查询都经这些构造函数。
- 提案按 `pendingActionOutcome` 归桶（与 A-4 同一口径），再交给纯函数；纯函数只认桶，不认原始状态。
- **否决**：在接口里直接写 Prisma 查询。无法在无 DB 测试里锁定组织范围与窗口。

### D6 区块：容器 + 无 hook 视图，点开才请求

- 与 B-4 同一写法：`V2ReadinessPanel` 管展开与加载；`V2ReadinessSection` / `V2ReadinessReportView` 无 hook，服务端静态渲染测试。
- 状态用图标 + 文字（"已满足 / 未满足 / 无法度量"）。
- **否决**：放进 A-4 的工作量面板。工作量面板按岗位看负荷，启动条件是组织级的决策依据，混在一起会被误读为某个岗位的指标。

## 与八条硬纪律的关系

1. **零 schema**：只读既有表（`PendingAction`、`AuditLog`、`TradeQuote`、`SalesQuote`、`OrgBusinessRule`）；不加列、不加表。
2. **出站先审批**：不涉及（只读，不发任何外发、不建审批卡）。
3. **禁止第三套队列**：不涉及（点开才算，不新增 cron / 队列）。
4. **脱敏**：响应只含状态、计数、比率与是否配置；MOQ / 周期 / 最低毛利 / 报价金额等值一律不出；提案载荷与草稿正文只在服务端解析计数，不进入响应。spec 有一条 SHALL NOT 覆盖。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：纯规则计数，不调用 LLM；"可引用"口径复用 `factory-knowledge.ts`。
8. **测试注册**：两个新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## Risks / Trade-offs

- **[条件 1 偏晚]**：第一张提案要等销售第一次改草稿加入事实才会出现，比 B-2 上线晚。偏保守，可接受；依据里写明口径。
- **[快照封顶]**：近 30 天首封超过 300 封时只看最近 300 封；占比反映近况，标记里写明。每次点开最多读约 3MB 快照（正文 ≤ 10k × 301），点开才算，可接受。
- **[平台管理员]**：与 B-4 相同，`resolveRevenueAccess` 要求平台 admin 显式带 `orgId`，区块不带，平台 admin 打开会显示加载失败；组织成员不受影响。
- **[审计里的来源]**：值相同未写新版本时不记审计，"经提案写入"次数可能少于提案批准数；依据写"经提案写入过 N 次"，不写"批准 N 次"。

## 验证方式

| 验证项 | 命令或做法 | 期望结果 |
|---|---|---|
| 条件判定、结论、依据计数、脱敏 | `npx tsx src/lib/revenue-spine/__tests__/v2-readiness.test.ts` | 全部通过 |
| 查询条件限定组织、窗口；只读 | 同上（纯函数 + 源码静态断言） | 通过 |
| 区块渲染 | `npx tsx src/components/revenue/__tests__/v2-readiness-panel.test.tsx` | 全部通过 |
| 全量 / 类型 / lint / CI 子集 | `npm test`、`npm run typecheck`、`npm run lint:baseline`、`npm run test:ci` | 与基线一致 / 通过 |
| 规格 | `openspec validate fde-v2-readiness --strict` | 通过 |
| staging | 在 sunny-home-deco 打开 `/revenue`，展开"FDE V2 启动条件" | 显示四条条件与依据；MOQ 已配置时条件 2 为已满足 |

## Migration Plan

无数据迁移。回滚：撤销 PR。接口与区块只读，撤销后无残留数据。
