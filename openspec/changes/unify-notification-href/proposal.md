# Proposal: unify-notification-href

**TASKFLOW：** 无（缺陷修复，不对应 TASKFLOW 任务）。
**受影响的 Muse 意图：** 不改 `src/lib/muse-bridge/**`。`ask_colleague` 产生的询问通知（`entityType=muse_inquiry`）此前只在顶栏铃铛下拉里能点开回复页，本 change 后在 `/notifications` 页点击也跳到同一回复页；其余意图不受影响。

## Why

通知点击跳转在顶栏铃铛下拉（`src/components/header.tsx`）与通知中心页（`src/app/(main)/notifications/page.tsx`）各写了一份 `entityType` → 地址的映射，两份已经分叉：`approval`、`trade_prospect`、`revenue_opportunity`、`sales_customer`、`sales_actions`、`project`、`visualizer_session` 七类通知在铃铛下拉里点击无反应（或被兜底带去项目页），`muse_inquiry` 在通知中心页点击无反应。同一条通知在两个入口跳到不同地方（甚至不跳），用户无法预期。

## What Changes

- 新增纯函数解析器 `src/lib/notifications/href.ts`：输入通知的 `entityType` / `entityId` / `projectId` / `activityId` / `orgId`，输出跳转地址与"是否需要先记住所选企业"，映射为两份现有映射的并集（12 个 `entityType` + 项目 / 项目活动兜底）；无目标时返回 `null`。
- 统一任务通知目标为 `/tasks?open=<id>`（`/tasks/<id>` 只是一个客户端重定向到 `/tasks?open=<id>` 的过渡页）。
- 统一地址里的 ID 一律 `encodeURIComponent`（现有映射里 `task`、`project`、`trade_prospect` 与项目兜底未编码；对现有 cuid 形态的 ID 输出不变）。
- 改写 `header.tsx` 的 `handleNotificationNavigate`：调用解析器；需要记住企业的类型在跳转前 `persistSelectedOrgId(orgId)`；仍用 `window.location.href` 整页跳转。
- 改写 `notifications/page.tsx` 的 `handleItemClick`：调用解析器；未读先标已读的行为不变；需要记住企业的类型在跳转前 `persistSelectedOrgId(orgId)`；仍用 `router.push`。
- 新增表驱动测试 `src/lib/notifications/__tests__/href.test.ts`（每个已处理的 `entityType` → 期望地址与企业标记；缺 `entityId` 时的兜底；未知类型 → `null`），注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

对外可观察变化（铃铛下拉）：上述七类通知点击后跳到对应实体页，不再无反应；带 `projectId` 的这七类通知不再被兜底带去项目页。对外可观察变化（通知中心页）：`muse_inquiry` 通知点击后跳到 `/sales/inquiries/<id>`；任务通知直接落到 `/tasks?open=<id>`，少一次客户端重定向（最终地址不变）。

## Capabilities

### New Capabilities
- `notifications/click-target`：站内通知被点击时跳到哪里——两个入口共用同一套 `entityType` → 地址映射、项目兜底、无目标不跳转，以及企业作用域类型跳转前记住所选企业。

### Modified Capabilities
- 无。现有 specs 中没有任何一条约束通知点击跳转（`muse-bridge/sales-intents` 只约束询问 Task 的创建，不约束通知点击）。

## Impact

- 新增：`src/lib/notifications/href.ts`、`src/lib/notifications/__tests__/href.test.ts`。
- 修改：`src/components/header.tsx`（仅 `handleNotificationNavigate`；`persistSelectedOrgId` 仍从 `@/lib/org-selection` 引入）、`src/app/(main)/notifications/page.tsx`（仅 `handleItemClick`）。
- 修改：`scripts/test-all.sh`、`scripts/test-ci-unit.sh` 各新增 1 条测试行，不改既有行。
- 不改任何 API、Prisma schema、通知生产方（`createNotification` 调用处）与 `NotificationItem` 类型。

## Out of scope

- 不读取通知 `metadata.href`。当前唯一写它的生产方（`src/lib/sunny-process/autogen.ts`）同时写了 `entityType=blinds_order`，解析结果与它相同；把任意 metadata 字符串当跳转地址需要另做站内地址白名单校验，另开 change。
- 不给两份映射里都没有的 `entityType`（如 `approval_request`、`pending_action`、`requirement`、`marketing_plan`、`quota`、`trade_quote`、`tender_analysis_run`、`website_inquiry_receipt`、`calendar_event`、`agent_task` 等）新增目标；它们沿用项目兜底，没有 `projectId` 时仍不跳转。
- 不新增 INSTALL-2b/2c（分支 `claude/vigilant-edison-73bk9i`）的安装类 `entityType`：该分支尚未合并，也还没有改这两个组件；若它先合并，本 change 在实施时把它的类型并进解析器。
- 不改铃铛下拉的整页跳转方式（`window.location.href`）与通知中心页的 `router.push`，不改标已读 / 稍后提醒 / 批量操作。
- 不改 `src/app/(main)/tasks/[id]/page.tsx`（其他入口仍链接 `/tasks/<id>`，过渡页保留）。
- 不在本 change 内 archive；PR 合并后另开小 PR。
