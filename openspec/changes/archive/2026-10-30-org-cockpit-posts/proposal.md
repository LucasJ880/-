# Proposal: org-cockpit-posts

**TASKFLOW：** A-1（岗位注册表），状态列在 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` Phase A 表。
**受影响的 Muse 意图：** 无。本 change 不碰 `src/lib/muse-bridge/**`；`status` 意图复用岗位汇总留给后续 change。

## Why

28 项自动化、14 种 PendingAction、4 个 workforce 工作域、AgentRun runType 之间没有"岗位"这层归属，A-2（岗位读模型）、A-3（首页岗位卡片）、A-4（工作量面板）的任何聚合都无从下手。岗位归属是代码事实，必须先落成一张可穷举校验的表，新加的自动化或动作类型漏了归属要立刻测试失败。

## What Changes

- 新增 `src/lib/cockpit/posts.ts`：七个岗位（`inbound_sales` / `tender` / `marketing` / `service` / `projects` / `ops_knowledge` / `content`，D-5）的表驱动注册表，每个岗位声明中文名、自动化键、固定归属的 PendingAction 类型、workforce 工作域、AgentRun runType、KPI 来源（统计窗口 + 三个指标的路径 / 标签 / 格式）、跳转页面；附按自动化 / 动作类型 / 工作域 / runType 反查岗位的纯函数。文件零运行时依赖（只有类型导入），不读库、不读组织设置。
- 定义"通用动作类型"（`calendar.create_event` 与 `grader.*` 三种）及其按行上下文的确定性归属规则（项目工作域 → 目标类型 → 产出 run 类型 → 未归属），以纯函数提供给 A-2。
- 提供按 KPI 声明从读函数结果里只取声明路径的纯函数，A-2 取数时不透出结果对象的其他字段（毛利率等）。
- 在类型层加穷举断言：任何 `AutomationKey`、`WorkDomain` 没有归属岗位、任何 `PendingActionType` 既不固定归属也不是通用类型、任何 KPI 指标路径在读函数返回值类型上解析不到标量 → `npm run typecheck` 失败并报出缺失 / 错误的字面量。
- 新增 `src/lib/cockpit/__tests__/posts.test.ts`：穷举校验 28 个自动化键、14 个 PendingAction 类型（从 `src/lib/pending-actions/types.ts` 源码读出联合成员）、4 个工作域的归属；从源码扫出全部 runType 写入取值，逐个必须归属或列为不归属；通用动作类型的上下文规则；KPI 来源指向的模块与导出确实存在、指标格式在白名单内且不含敏感字段、只取声明路径；跳转页面对应的 `page.tsx` 确实存在。
- 把该测试注册进 `scripts/test-all.sh` 第一组，并加进 CI 子集 `scripts/test-ci-unit.sh`（纯逻辑、无 DB；CI 跑的是 `npm run test:ci`，不加则 CI 只靠 typecheck 拦"漏"，拦不住"重"与 KPI 漂移）。
- 把任务书原文落盘为 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md`（作为 A / B 阶段状态列的事实源）；写 `docs/QINGYAN_ORG_COCKPIT_A-1_REPORT.md` 并把 A-1 状态列改成实际值。

**与任务书的偏差（GATE 审核时请逐条确认）：**
1. 任务书写"23 项自动化、12 种 PendingAction"，代码现状是 28 项与 14 种；本 change 按代码现状穷举。
2. 任务书初版岗位清单没有列出的 `wechat-push`、`trade-daily` 归入 `inbound_sales`（两者都是销售线的每日推送 / 检查）；`marketing-*` 展开为 6 项。
3. `approval-timeout` 归入 `ops_knowledge`，不放 `tender`（**已认可，用户 2026-10-26**）：它统一处理全组织所有类型 PendingAction 的过期与审批升级，放在投标岗位会让投标卡片的心跳 / 健康被与投标无关的失败染红。
4. 任务书验收第 2 条写"每个 PendingActionType 恰好归属一个岗位"。`calendar.create_event` 与 `grader.email_draft` / `grader.internal_note` / `grader.project_task` 做不到：它们由 agent-runtime-v2 销售跟进、销售草稿工具、助手场景（客户跟进 / Gmail 草稿）、approval-gate、技能桥与 ai-grader 多条链路产出，目标既有客户 / 商机 / 报价，也有项目。硬塞给任何一个岗位都会让 A-2 的"等你 N 件"按岗位分错。本 change 把这 4 种定为"通用动作类型"，按每条动作的上下文确定性归属（规则见 spec），不命中则记"未归属"；其余 10 种固定归属：`sales.*` 四种 → `inbound_sales`，`marketing.*` 四种 → `marketing`，`tender.*` 两种 → `tender`。穷举仍成立：每个类型恰好有一种归属方式。
5. `service` 与 `content` 两个岗位目前没有任何"只读、按组织"的既有读函数（只有写入型 cron 函数，计数内联在 API 路由里），KPI 声明为"未接入"并写明原因，不在本 change 新写查询；A-2 再决定是否把路由内联查询原样抽成读函数。
6. 代码里写入的 AgentRun runType 有 7 个取值：`runtime_v2`（唯一写入点 `agent-runtime-v2/process.ts`，intent 固定为 `sales_followup_triage`）归 `inbound_sales`，与 `fde_inbound_sales` 同岗；`workforce_job` 按工作域归属；`conversation` / `assistant_dispatch` / `background_conversation` / `supervisor` 不归属。

## Capabilities

### New Capabilities
- `cockpit/post-registry`：组织驾驶舱的岗位注册表——七个岗位及其对自动化、待审批动作、workforce 工作域、AgentRun 类型、KPI 来源、跳转页面的归属规则与穷举校验。

### Modified Capabilities
（无。`qa/test-registry` 的要求不变，本 change 只是遵守它。）

## Impact

- 新文件：`src/lib/cockpit/posts.ts`、`src/lib/cockpit/__tests__/posts.test.ts`、`docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md`、`docs/QINGYAN_ORG_COCKPIT_A-1_REPORT.md`、`docs/QINGYAN_ORG_COCKPIT_FDE_HANDOFF.md`。
- `scripts/test-all.sh`：第一组 SDD-0 注册段之后、注册校验之前追加 1 条 `run_test`；`scripts/test-ci-unit.sh`：末尾架构守卫之前追加 1 行。
- 不改任何既有源文件；无 API、页面、数据库、cron 变化；运行时行为零变化（`posts.ts` 当前没有调用方）。
- `npm test` 增加约 4 秒（测试导入 `automation/registry` 与 `workforce-runtime/work-domain` 读取运行时常量）。

## Out of scope

- 不改 `AUTOMATION_REGISTRY`（含其 `category` 字段）、不改 `PendingActionType` 联合类型、不改 `WORK_DOMAINS`。
- 不加岗位配置 UI、不读写 `Organization.settingsJson`：岗位归属是代码事实，不是租户设置。
- 不实现任何读模型、API、页面、KPI 取数（A-2 / A-3 / A-4 的范围）；不给 `service` / `content` 新写或抽取查询。
- 不接 Muse `status` 意图。
- 不补注册 `src/lib/trade/__tests__/{inbound-org,channel-inbound-id-db.isolated}.test.ts`：这两条是 PR #242 带进 main 的注册欠账，由进行中的 `register-acquisition-hub-tests` change 处理。
- 不在本 change 内 archive；archive 等 PR 合并后另开小 PR。
