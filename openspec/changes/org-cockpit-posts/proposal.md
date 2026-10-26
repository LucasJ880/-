# Proposal: org-cockpit-posts

**TASKFLOW：** A-1（岗位注册表），状态列在 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` Phase A 表。
**受影响的 Muse 意图：** 无。本 change 不碰 `src/lib/muse-bridge/**`；`status` 意图复用岗位汇总留给后续 change。

## Why

28 项自动化、14 种 PendingAction、4 个 workforce 工作域、AgentRun runType 之间没有"岗位"这层归属，A-2（岗位读模型）、A-3（首页岗位卡片）、A-4（工作量面板）的任何聚合都无从下手。岗位归属是代码事实，必须先落成一张可穷举校验的表，新加的自动化或动作类型漏了归属要立刻测试失败。

## What Changes

- 新增 `src/lib/cockpit/posts.ts`：七个岗位（`inbound_sales` / `tender` / `marketing` / `service` / `projects` / `ops_knowledge` / `content`，D-5）的表驱动注册表，每个岗位声明中文名、自动化键、PendingAction 类型、workforce 工作域、AgentRun runType、KPI 来源、跳转页面；附按自动化 / 动作类型 / 工作域 / runType 反查岗位的纯函数。文件零运行时依赖（只有 type import），不读库、不读 settingsJson。
- 在类型层加穷举断言：任何 `AutomationKey`、`PendingActionType`、`WorkDomain` 没有归属岗位 → `npm run typecheck` 失败并报出缺失的字面量。
- 新增 `src/lib/cockpit/__tests__/posts.test.ts`：穷举校验 28 个自动化键、14 个 PendingAction 类型（从 `src/lib/pending-actions/types.ts` 源码读出联合成员）、4 个工作域各恰好归属一个岗位；runType 至多归属一个岗位且 `workforce_job` 不按 runType 归属；KPI 来源指向的模块与导出确实存在且指标不含敏感字段；跳转页面对应的 `page.tsx` 确实存在。
- 把该测试注册进 `scripts/test-all.sh` 第一组。
- 把任务书原文落盘为 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md`（作为 A / B 阶段状态列的事实源）；写 `docs/QINGYAN_ORG_COCKPIT_A-1_REPORT.md` 并把 A-1 状态列改成实际值。

**与任务书的偏差（GATE 审核时请逐条确认）：**
1. 任务书写"23 项自动化、12 种 PendingAction"，代码现状是 28 项与 14 种；本 change 按代码现状穷举。
2. 任务书初版岗位清单没有列出的 `wechat-push`、`trade-daily` 归入 `inbound_sales`（两者都是销售线的每日推送 / 检查）；`marketing-*` 展开为 6 项。
3. `approval-timeout` 归入 `ops_knowledge`，不放 `tender`（**已认可，用户 2026-10-26**）：它统一处理全组织所有类型 PendingAction 的过期与审批升级，放在投标岗位会让投标卡片的心跳 / 健康被与投标无关的失败染红。
4. 任务书未指定的 PendingAction 归属：`grader.*` 三种与 `calendar.create_event` 都只由 ai-grader（`proactive-scan` 巡视分级）产出，归入 `projects`；`sales.*` 四种归入 `inbound_sales`；`marketing.*` 四种归入 `marketing`；`tender.*` 两种归入 `tender`。
5. `service` 与 `content` 两个岗位目前没有任何"只读、按组织"的既有读函数（只有写入型 cron 函数，计数内联在 API 路由里），KPI 声明为"未接入"并写明原因，不在本 change 新写查询；A-2 再决定是否把路由内联查询原样抽成读函数。

## Capabilities

### New Capabilities
- `cockpit/post-registry`：组织驾驶舱的岗位注册表——七个岗位及其对自动化、待审批动作、workforce 工作域、AgentRun 类型、KPI 来源、跳转页面的归属规则与穷举校验。

### Modified Capabilities
（无。`qa/test-registry` 的要求不变，本 change 只是遵守它。）

## Impact

- 新文件：`src/lib/cockpit/posts.ts`、`src/lib/cockpit/__tests__/posts.test.ts`、`docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md`、`docs/QINGYAN_ORG_COCKPIT_A-1_REPORT.md`。
- `scripts/test-all.sh`：第一组 SDD-0 注册段之后、注册校验之前追加 1 条 `run_test`。
- 不改任何既有源文件；无 API、页面、数据库、cron 变化；运行时行为零变化（`posts.ts` 当前没有调用方）。
- `npm test` 增加约 4 秒（测试导入 `automation/registry` 与 `workforce-runtime/work-domain` 读取运行时常量）。

## Out of scope

- 不改 `AUTOMATION_REGISTRY`（含其 `category` 字段）、不改 `PendingActionType` 联合类型、不改 `WORK_DOMAINS`。
- 不加岗位配置 UI、不读写 `Organization.settingsJson`：岗位归属是代码事实，不是租户设置。
- 不实现任何读模型、API、页面、KPI 取数（A-2 / A-3 / A-4 的范围）；不给 `service` / `content` 新写或抽取查询。
- 不接 Muse `status` 意图。
- 不补注册 `src/lib/trade/__tests__/{inbound-org,channel-inbound-id-db.isolated}.test.ts`：这两条是 PR #242 带进 main 的注册欠账，由进行中的 `register-acquisition-hub-tests` change 处理。
- 不在本 change 内 archive；archive 等 PR 合并后另开小 PR。
