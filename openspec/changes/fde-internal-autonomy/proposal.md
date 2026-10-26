# Proposal: fde-internal-autonomy

**TASKFLOW：** B-5（分级自治：内部动作按 policy 自动化）。状态列在 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` Phase B 表。本分支叠在 B-4（PR #249）之上；B-5 依赖 B-1。
**受影响的 Muse 意图：** 无。
**已决定（不重开）：** D-4。代码默认关闭；sunny-home-deco 组织通过 seed 脚本写 policy 开启做 dogfood，不改默认值。

## Why

外部动作永远走审批；内部动作（商机阶段流转、内部通知）可以查表自动做。今天的情况：
- 长期无互动的开放商机只在 `/revenue` 的"Stale Opportunity"队列里展示，不流转（F7）。负责人要一个个点；
- `revenue-spine` 定时任务头注释写的"步骤 3：长期无动作商机标记进入 stale 队列"，实际没有任何流转。

B-5 让这件事按 policy 自动完成，每次流转留审计、通知负责人，并在 company.log 时间线可见。

## What Changes

- **policy 新增 `autonomy.autoStale`（布尔，默认 `false`）**：
  - 存量 policy 没有这一项时视为关闭；
  - 只认布尔值，与 `notify.wechatOnNewDraft` 同一合并规则。
- **自动转 stale**：开启的组织，在既有 `revenue-spine` 定时任务（每 15 分钟）里对开放商机逐个判定，同时满足以下条件的流转到 `stale`：
  1. 最后互动（无互动时取创建时间）早于 `followUp.staleAfterDays` 天前；
  2. 买家在这段时间内没有来信；
  3. 该商机没有待审批或已批准未执行的审批动作（即没有在途草稿）。
- **流转方式**：
  - 经唯一写入口 `transitionOpportunity`，来源 `system`；
  - 阶段规则 `ALLOWED_TRANSITIONS` 不放宽：所有开放阶段本来就允许转 `stale`；
  - 审计记录新增 `policyKey = "autonomy.autoStale"` 与原因（含天数）。
- **通知负责人**：
  - 每轮每个负责人一条站内汇总通知（类型 `followup`）："已自动搁置 N 个长期无互动商机"，列出前几个商机标题，链接到 `/revenue`；
  - 无负责人的商机通知其创建人；
  - 开启后第一轮可能一次搁置几十个，按负责人汇总避免刷屏。
- **每轮上限**：每个组织每轮最多流转 200 个，在既有维护时间预算内执行；超出部分下一轮继续。
- **不合格自动关闭（任务书第 1 条）补审计键名**：
  - FDE 在 `excludedCategoryAction = "decline"` 时把只命中不做类目的询盘判为不合格、转 `disqualified`、不起草、关闭 FDE 行动。这条链路**已经存在**。
  - 本 change 只给这次流转的审计记录补 `policyKey = "businessProfile.excludedCategoryAction"`。
- **seed 脚本**：`scripts/seed-revenue-autonomy.ts`。
  - 默认只打印计划；带 `--apply` 时为指定组织（默认 `sunny-home-deco`）发布一版 policy，只把 `autonomy.autoStale` 设为 `true`，其余 policy 不变；
  - 已开启时不重复发布。
- **新增测试**：自治判定与执行（纯函数 + 假依赖）、seed 计划函数、接入点与配额链路的静态断言，注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
- 写 `docs/QINGYAN_ORG_COCKPIT_B-5_REPORT.md` 并更新状态列。

**与任务书的偏差（GATE 审核时请逐条确认）：**
1. **第 1 条已由 FDE 实现，不重复做**：
   - `excludedCategoryAction = "decline"` 本身就是开关（默认 `review`，未配置时零行为）；
   - FDE 判不合格后经 `transitionOpportunity` 转 `disqualified`（来源 `fde`）、写原因、不起草、自动关闭行动；
   - 本 change 只补审计里的 policy 键名。来源保持 `fde`（是 FDE 在这次运行里判定的），不改成 `system`。
2. **第 3 条（配额命中可视化）已由既有代码满足，不改代码**：
   - FDE 运行经 `createAgentRun` 预留 `DAILY_AGENT_RUNS` 配额；
   - 硬限额命中时写 `QUOTA_HARD_LIMIT_BLOCKED` 审计，并按天去重通知 org_owner / org_admin；
   - A-2 的岗位健康度据此置 `quota_hit`。
   - 本 change 只加静态断言锁定这条链路。
3. **"无买家回信"的口径**：买家最后来信时间为空，或早于 `staleAfterDays` 天前。最后互动时间本来就包含来信，这一条是显式的双重保险。
4. **"无 pending 草稿"的口径**：该商机没有 `pending` 或 `approved`（已批准未执行）状态的审批动作。按载荷里的商机 id 匹配，与 FDE 跟进草稿的去重口径一致。
5. **通知类型用既有 `followup`，按负责人汇总**：用户的通知偏好里本来就有这个类型，不新增类型；任务书写"通知负责人"，按负责人每轮一条汇总，不按商机逐条发。
6. **policy 存在 `OrgBusinessRule`**（`revenue_spine.policy`），不在 `settingsJson`。seed 脚本走既有的发布函数，生成新版本，可回滚。

## Capabilities

### New Capabilities
- `revenue-spine/internal-autonomy`：policy 驱动的内部自治动作。包括：
  - 自动转 stale 的条件、流转方式、审计、通知、上限与默认关闭；
  - 不合格自动关闭的审计键名；
  - 配额命中可见性的既有保证；
  - dogfood 开启脚本。

### Modified Capabilities
（无。）

## Impact

- 新文件：
  - `src/lib/revenue-spine/autonomy.ts`（判定纯函数 + 依赖可注入的执行器）；
  - `scripts/seed-revenue-autonomy.ts`；
  - 测试 `src/lib/revenue-spine/__tests__/autonomy.test.ts`；
  - `docs/QINGYAN_ORG_COCKPIT_B-5_REPORT.md`。
- 改动：
  - `src/lib/revenue-spine/policy.ts`：`autonomy` 字段、默认值与合并；
  - `src/lib/revenue-spine/transition.ts`：可选 `policyKey` 写进审计；
  - `src/lib/revenue-spine/fde/inbound-sales.ts`：decline 判不合格时传 `policyKey`；
  - `src/app/api/cron/revenue-spine/route.ts`：在 next action 重算之前加自动 stale 步骤，并修正头注释；
  - 两个测试脚本。
- 不改：`opportunity-stage.ts`（`ALLOWED_TRANSITIONS`）、`next-action.ts`、`vercel.json`、Prisma schema、任何审批 / 执行器 / 外发路径；不新增 cron、队列、LLM 调用。

## Out of scope

- 不自动驳回、不自动批准任何草稿；不新建任何外发动作。
- 不自动激活 stale 商机（买家再来信时，新询盘照常新建商机）；stale 商机的"激活或关闭"仍由人决定。
- 不回填历史：开启前已经超期的商机，在开启后的下一轮按同一条件处理，不追溯更早的审计。
- 不改配额本身与配额通知。
