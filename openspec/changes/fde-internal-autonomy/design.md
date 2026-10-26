# Design

## Context

动机见 proposal.md「Why」，对外行为见 `specs/revenue-spine/internal-autonomy/spec.md`。决定做法的现状：

1. **阶段写入**：只经 `transition.ts` 的 `transitionOpportunity`。
   - 它校验 `ALLOWED_TRANSITIONS`，写 `stageChangedAt`，审计 `revenue_spine.opportunity.transition`（`afterData` 含 `source` / `reason`），最后重算下一步。
   - 所有开放阶段都允许转 `stale`；`stale` 可转回 `qualified` / `follow_up` / `negotiation` / `nurture` / `lost` / `disqualified`。
2. **陈旧判定**：`next-action.ts` 的 `isStale`：开放阶段 + (`lastInteractionAt ?? createdAt`) 早于 `followUp.staleAfterDays`（默认 21）天。
   - 只被 `/revenue` 队列用来展示。
   - `lastInteractionAt` 在每次互动（来信与外发）时更新，`lastCustomerReplyAt` 只在来信时更新（`interactions.ts`）。
3. **定时任务**：`/api/cron/revenue-spine` 每 15 分钟一次。
   - 先跑来信 FDE 兜底，再按组织做"next action 重算 + 到期行动"与"无回复跟进草稿"。
   - 维护部分有墙钟预算（`MAINTENANCE_DEADLINE_MS`）。
   - 头注释的"步骤 3 stale"没有实现。
4. **在途草稿**：FDE 跟进草稿用 `PendingAction(type=sales.send_inquiry_reply, status=pending, payload.opportunityId=…)` 判重。其它审批载荷也大多带 `opportunityId` 或 `metadata.opportunityId`（A-4 `opportunityIdOfPayload`）。
5. **再来信**：
   - 新询盘只附加到报价前的开放商机（`inquiry-intake.ts`），否则新建商机；
   - 所以搁置的商机不会吞掉买家的新来信。
6. **不合格**：
   - `scoring.ts` 在 `excludedCategoryAction = "decline"` 且只命中不做类目时得 productFit 0，判 `disqualified`；
   - `inbound-sales.ts` 经 `safeTransition`（来源 `fde`、带原因）转 `disqualified`，不起草，FDE 行动 `auto_resolved`。
7. **配额**：`createAgentRun` → `reserveQuota(DAILY_AGENT_RUNS)` → `evaluateQuota`。硬限额时写 `QUOTA_HARD_LIMIT_BLOCKED` 并调用 `notifyQuotaHardLimitBlocked`（owner / admin，按天去重）。A-2 `quotaHitToday` 读审计或通知。
8. **policy**：`OrgBusinessRule(revenue_spine.policy)`。
   - `mergeRevenueSpinePolicy` 逐段合并，`notify` 段只认布尔值；
   - `PUT /api/revenue/policy` 与 `publishRevenueSpineRule` 发布新版本。

## Goals / Non-Goals

**Goals:**
- 判定是纯函数，查询条件是导出的构造函数，执行器依赖可注入。全部用假依赖测，无 DB。
- 定时任务只多一个由开关保护的步骤，关闭时零查询。
- 审计、通知、上限、失败隔离与现有步骤同一风格。

**Non-Goals:**
- 不改以下文件：
  - `src/lib/revenue-spine/opportunity-stage.ts`（流转规则表）、`next-action.ts`（包括 stale 的下一步"激活或关闭"）；
  - `daily-actions.ts`（队列照旧展示 stale）、`no-reply-followup.ts`、`inquiry-intake.ts`；
  - 所有 `pending-actions/*` 执行器、`approval/*`；
  - `capabilities/governance/*`（配额）、`vercel.json`。
- 不提供自治设置页面（policy 经既有接口或 seed 脚本写入）。
- 不自动激活 stale 商机，不回写历史审计。

## Decisions

### D1 开关放在 policy 新段 `autonomy`，只认布尔值
- `RevenueSpinePolicy.autonomy = { autoStale: boolean }`，默认 `{ autoStale: false }`。合并时 `typeof === "boolean"` 才采用，否则取 base，存量无此段时为 `false`。
- 理由：
  - 与 `notify.wechatOnNewDraft` 同一套写法；
  - 开关跟着 policy 版本走，可回滚；
  - D-4 要求默认关闭、dogfood 用 seed 开。
- **否决**：
  - 放进 `Organization.settingsJson`：与其它 Revenue Spine 策略分家，`/api/revenue/policy` 看不到。
  - 环境变量开关：不能按组织开。

### D2 候选查询 + 纯函数复核 + 在途草稿过滤
1. 先用 `autoStaleCandidateWhere(orgId, cutoff)` 查候选。条件为：开放阶段、客户未归档、`lastInteractionAt < cutoff`（或为空且 `createdAt < cutoff`）、`lastCustomerReplyAt` 为空或 `< cutoff`。
2. 按 `lastInteractionAt ?? createdAt` 升序，取 201 行，最多处理 200 行。
3. 再查本组织状态为 `pending` / `approved` 的审批动作，只选 `payload`，用 `opportunityIdOfPayload` 取商机 id，组成在途集合。
4. 对每个候选再跑纯函数 `decideAutoStale`：复核开关、阶段、`isStale`、来信时间、在途集合，返回流转或跳过原因。

- 理由：
  - 查询用索引列 `(orgId, stage)` 缩小范围；
  - 纯函数复核让判定规则能逐条单测，也防查询条件写错；
  - 审批动作按组织取一次（在途的很少），比逐个商机查 JSON 路径省查询。
- **否决**：
  - 按商机逐个查 `payload.path = opportunityId`：候选多时 N 次 JSON 查询。
  - 只看 `sales.send_inquiry_reply` 类型：报价、样品等其它在途审批也意味着有人正在处理，同样不该搁置。

### D3 流转经 `transitionOpportunity`，审计加可选 `policyKey`
- `TransitionInput` 加可选 `policyKey?: string | null`。有值时写进审计 `afterData.policyKey`，没传时审计内容与现在逐字段相同。
- 自动搁置传 `source: "system"`、`actorUserId: null`、`policyKey: "autonomy.autoStale"`，原因为"超过 N 天无互动、无在途审批、买家未来信（自动搁置）"。
- FDE 的 `safeTransition` 透传 `policyKey`：判不合格且 `score.outOfRange && excludedCategoryAction === "decline"` 时传 `businessProfile.excludedCategoryAction`。来源仍是 `fde`。
- 理由：
  - 一个写入口、一种审计；
  - A-2 时间线已经收录这个审计动作（不在排除名单里），不用改时间线。
- **否决**：
  - 新写一种审计动作：时间线与既有报表都要跟着改。
  - 把键名塞进 `reason` 文本：机器读不出来。

### D4 执行器在定时任务里先于 next action 重算
- 在每个组织的维护段开头、`next action` 重算之前，`policy.autonomy.autoStale` 为真才调用 `runAutoStale`。
- 执行器每处理一个候选都检查维护预算，超时停在原地，下一轮继续。
- 单个流转失败（返回 `ok: false` 或抛错）只记入结果，不中断。
- 理由：
  - 先搁置，紧接着的 next action 重算就不会再为这些商机建到期跟进行动；
  - 同一轮内结果一致。
- **否决**：
  - 新建 cron：违反硬纪律 3。
  - 放在 next action 之后：同一轮会先为它建跟进行动、再把它搁置。

### D5 通知按负责人每轮汇总
- 流转成功的商机按 `assignedToId ?? createdById` 分组，每组一条 `createNotificationsForUsers`：
  - 类型 `followup`，优先级 `medium`；
  - 只有一个商机时 `entityType = "revenue_opportunity"`、`entityId = 商机 id`：通知中心与页头按这对字段跳商机详情。多个时不设 `entityId`，用户从 `/revenue` 的 Stale 队列看全部；
  - 元数据带最多 50 个商机 id 与 policy 键名；
  - 摘要列前 3 个商机标题；
  - `sourceKeyPrefix = revenue-auto-stale:{orgId}:{本轮时刻}`。
- 通知失败吞掉，记入结果。
- 理由：开启第一轮可能一次搁置几十个，逐条通知会刷屏。商机标题是内部数据，不含邮箱、电话、金额。
- **否决**：
  - 逐个商机一条：刷屏。
  - 按天汇总去重：同一天后续轮次的新搁置会被吞掉。

### D6 dogfood 用 seed 脚本发布 policy 新版本
- 纯函数 `planAutonomyEnable(currentConfig)`：已开启返回 `null`；否则返回 `{ ...current, autonomy: { ...current.autonomy, autoStale: true } }`。
- 脚本按 `Organization.code` 找组织（缺省 `sunny-home-deco`，`--org-code` 可改），默认只打印计划，`--write` 才调用 `publishRevenueSpineRule`。
- 理由：
  - D-4 明确"通过 seed 脚本写 policy，不改默认值"；
  - 发布新版本可回滚，保留其它 policy。
- **否决**：
  - 改 `DEFAULT_REVENUE_SPINE_POLICY`：违反 D-4。
  - 写迁移：违反硬纪律 1。

## 与八条硬纪律的关系

1. **零 schema**：不加 model、字段、迁移。开关写在既有 `OrgBusinessRule.configJson`（policy 版本）；流转写既有字段；审计与通知写既有表。
2. **出站先审批**：自治只做内部阶段流转与站内通知，不建审批、不发邮件。静态断言锁定。
3. **禁止第三套队列**：复用既有 `revenue-spine` 定时任务，不新增 cron / 队列 / worker；`vercel.json` 不变。
4. **脱敏**：通知与审计只含商机标题、天数、阶段，不含金额、邮箱、电话；不涉及毛利 / 估值 / 报价。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：自动搁置是查表（policy 阈值 + 时间戳 + 在途集合），无 LLM；偏好记忆不涉及。
8. **测试注册**：`src/lib/revenue-spine/__tests__/autonomy.test.ts` 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；不改基线文件。

## Risks / Trade-offs

- **[开启首轮批量搁置]**：历史上超期的商机会在开启后陆续被搁置。
  → 每组织每轮上限 200 + 汇总通知；dogfood 先在 sunny-home-deco 开。
- **[经已链接线索回信的 stale 商机]**：买家经外贸收件箱回到一个已搁置商机时，它的下一步是"激活或关闭"（`next-action.ts` 的既有 stale 分支），不是"回复客户"。这与人工转 stale 相同。
  → 新询盘本来就新建商机，不受影响；报告列为已知限制。是否让 stale 商机的来信优先于"激活或关闭"，留给后续 change。
- **[审批载荷没有商机 id]**：这类在途审批识别不到，商机可能被搁置。
  → FDE 的询盘回复与跟进草稿都带 `payload.opportunityId`；其它类型尽力识别。
- **[一轮处理不完]**：上限与预算截断，下一轮继续，结果里有截断标记。

## 验证方式

| 验证项 | 命令或做法 | 期望结果 |
|---|---|---|
| 自治测试 | `npx tsx src/lib/revenue-spine/__tests__/autonomy.test.ts` | 断言全部通过（见下） |
| 门禁 | `npm test`（与基线比较，新增失败为 0）、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh` | 前四项通过；注册校验除 base 已有的 2 个 trade 欠账外无新增 |
| 改动范围 | `git diff --stat` | 无 `prisma/`、`vercel.json`、`opportunity-stage.ts` 改动 |
| seed 脚本 | `npx tsx scripts/seed-revenue-autonomy.ts`（无 DB 时报连接错误即可，不写入） | 只在报告中说明 staging 待跑 |

自治测试的断言：
- 合并规则与默认关闭；
- 候选查询条件；
- 纯函数判定的每个条件及跳过原因；
- 执行器（假依赖）：流转参数、审计键名、汇总通知、上限、失败隔离、预算截断、关闭时零调用；
- 定时任务接入点（开关保护、先于 next action）；
- 流转规则表快照；
- FDE decline 键名；
- 配额链路；
- seed 计划函数；
- 时间线不排除流转审计；
- 无外发调用；
- `vercel.json` cron 数不变。

## Migration Plan

部署后默认零行为。
- **dogfood**：在 staging 对 sunny-home-deco 跑 `npx tsx scripts/seed-revenue-autonomy.ts`（看计划）→ `--write`。
- **回滚**：发布一版 `autonomy.autoStale = false` 的 policy（或撤销本 PR）。已搁置的商机可按既有规则人工转回。
