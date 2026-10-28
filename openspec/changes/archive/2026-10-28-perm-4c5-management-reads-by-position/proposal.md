# Proposal

TASKFLOW：PERM-4c5（`docs/QINGYAN_PERMISSION_TASKFLOW.md`）。
残留清单：`docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md` B / C / D1 / D5 组与 A 组余项（A2 / A6 / A8）。
拍板：任务书"拍板结果 · PERM-4c3"第 1–3 条（Sunny 暂不要外贸 → PERM-6；Sunny 需要招投标 → 本 change 覆盖交接）。

## Why

4c4 已让 AI 一侧按岗位。导航之外还剩接口、页面与通知按平台角色判定。Sunny 压扁（`boss` / `sales` / `operations` → `user`）后，以下会立刻变化：

- **老板失去的管理功能**：
  - 团队任务（看团队、指派他人、改他人任务）；
  - 运营项目列表与创建；
  - 招投标中标交接；
  - 审批执行时看销售的商机 / 报价 / 客户；
  - 视觉方案全员可见；
  - 管理总览的销售 / 外贸模块与每日简报；
  - 入职清单。
- **销售被放宽**：可以进营销工作区 / 增长中心的页面与只读接口（今天由中间件按平台角色 `sales` 挡住）。
- **销售新绑定微信不再推送销售消息**。
- **按角色白名单的功能开关**：在没有派生角色的入口失效。

本 change 收口这些读点。它是 4c3 写库闸门打开前的最后一项，收口后把 `PLATFORM_ROLE_COLLAPSE_READY` 改为 `true`。之后由 Lucas 在生产先 dry-run 再执行压扁。

## What Changes

- **工作区上下文注入岗位信号（B1 / B2 / B3）**：
  - 涉及路由：`/api/tasks`、`/api/tasks/[id]`、`/api/ops/projects`、`/api/projects/[id]/handoff{,/preview,/execute}`。
  - 这些路由自建的 `WorkspacePolicyContext` / `OpsAccessContext` / `HandoffAccessContext` 补上 `permissionKeys`（`loadPermissionKeys`）与 `positionMode`（`loadPositionMode`），做法同 4b 的 `/api/ops/home`。
  - 判定函数（`canViewTeamTasks` / `canManageTeamTasks` / 运营项目 / 交接）本身不改：它们已认权限键，岗位模式下管理层也已按 `organization.dashboard.read`（4c2）。
- **审批决策与执行用派生角色（B4）**：
  - 入口：`/api/ai/pending-actions/[id]`、`/api/agent/tasks/[taskId]/steps/[stepId]/{approve,reject}`、`capabilities/approvals/decision.ts`、`ai-grader/actions/wechat-confirm.ts`；
  - 传给 `canDecideTeamApproval` 与 `approveApprovalItem` / `rejectApprovalItem` 的 `role` 改为 4c4 的岗位派生平台角色。执行器里的 `canSeeResource(ctx.role…)` 因而与压扁前等价。
  - Muse 入口已在 4c4 派生，不再改。
- **视觉方案（B5 / A2）**：
  - `/api/visualizer/**` 传给 `visualizerSessionListScope` / `canSeeVisualizerSession` / `validateCustomerAccessForCreate` 的角色改为派生角色。
  - 同时修既有跨企业泄露：`dataScope=all` 的列表与详情加企业过滤（见 design D4，已拍板并入）。
- **前端按岗位（C1 / A6 余项）**：
  - `/api/auth/me` 返回新增字段 `effectiveRole`（当前企业的派生角色；`role` 字段不变）；
  - 管理总览 `management-dashboard-client.tsx` 的销售 / 项目 / 外贸模块显示、`digital-employee-workbench.tsx` 的营销数字员工按钮改读 `effectiveRole`。
- **营销工作区（A6 余项）**：
  - 新增 `src/app/(main)/marketing/layout.tsx` 与 `src/app/(main)/operations/growth/layout.tsx`（服务端）：派生角色为 `sales` 时重定向 `/sales`；
  - 新增 `requireMarketingReadAccess(user, orgId)`，接到 `/api/marketing/**` 的 16 个 GET 处理器，派生角色为 `sales` 时 403；
  - 中间件的平台角色判定保留给旧模式。
- **微信绑定默认推送与入职清单（D1 / D5）**：
  - `messaging/binding.ts` 新绑定的默认推送域按派生角色；
  - `organizations/onboarding.ts` 的"业务员"判定在岗位模式下按销售工作键。
- **功能开关白名单（A8 余项）**：`/api/agent-supervisor/runs` 的 `isSupervisorEnabled`、`assistant/followup-task.ts`、`workforce-runtime/job.ts` 传入派生角色。
- **打开写库闸门**：`PLATFORM_ROLE_COLLAPSE_READY = true`；残留清单写明收口完成与生产执行步骤。

## Capabilities

### New Capabilities
- `authorization/position-mode-residual-reads`：岗位模式企业中，工作区上下文岗位信号、审批 / 视觉方案 / 前端 / 营销工作区 / 微信绑定 / 入职清单 / 功能开关对派生角色的使用，以及压扁前后等价

### Modified Capabilities
- `authorization/platform-role-collapse`：写库闸门由关闭改为打开（残留读点已收口）
- `projects/handoff-access`：交接上下文带岗位信号（岗位模式管理层按老板岗位）
- `marketing/growth-center-access`：岗位模式下销售不能读增长中心（页面与只读接口）

## Out of scope

- 外贸（PERM-6）：
  - `revenue-spine` 的 `/api/revenue/*` 与 `api/revenue/policy`；
  - `trade/*` 询盘 / 展会 / SLA 收件人；
  - 默认询盘负责人。
- B6 市场情报 / B7 团队学习审核的 `manager` 判定：Sunny 无人用 `manager`，派生角色也不产生 `manager`，压扁对 Sunny 无影响。保留现状，在报告中写明。
- 工具策略表改权限键；梦馨落岗位；在生产执行压扁（Lucas 做）。

## Impact

- 修改：
  - `src/app/api/tasks/{route,[id]/route}.ts`、`src/app/api/ops/projects/route.ts`、`src/app/api/projects/[id]/handoff/{route,preview/route,execute/route}.ts`；
  - 审批入口 4 处、`src/app/api/visualizer/**` 与 `src/lib/visualizer/access.ts`；
  - `src/app/api/auth/me/route.ts`、`src/components/dashboard/management-dashboard-client.tsx`、`src/app/(main)/assistant/digital-employee-workbench.tsx`；
  - `src/lib/marketing/access.ts` 与 16 个 GET 路由；
  - `src/lib/messaging/binding.ts`、`src/lib/organizations/onboarding.ts`；
  - 开关调用方 3 处；
  - `src/lib/authorization/platform-role-collapse.ts`（闸门）。
- 新增：两个营销 layout；测试 `src/lib/authorization/__tests__/residual-reads.test.ts`（纯）与 `residual-reads-db.isolated.test.ts`（隔离库）。
- **BREAKING（Sunny，合并即生效）**：
  - 上述判定按岗位；
  - 平台 `sales` 但岗位不是销售的人可以进营销工作区；
  - 平台 `boss` 但没绑 `owner` 的人失去团队任务 / 交接 / 审批执行的管理范围（企业 `org_owner` / `org_admin` 仍按原规则放行团队任务与交接）。
- 合并后闸门打开：生产执行压扁前须先 `bind-positions --dry-run` 与 `collapse-platform-roles --dry-run`。
- 零 schema。
