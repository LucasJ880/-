# PERM-4c3 残留平台角色读点清单

> 用途：Sunny（岗位模式企业）把平台角色 `boss / manager / operations / sales` 压成 `user` **之前**必须收口的读点。
> 压扁脚本 `scripts/collapse-platform-roles.ts` 的写库闸门 `PLATFORM_ROLE_COLLAPSE_READY`（`src/lib/authorization/platform-role-collapse.ts`）在本清单收口前保持 `false`。
> 行号以 main@2b44fc4f 为准；改动前先 grep 复核。拍板见任务书 `docs/QINGYAN_PERM-4_PLATFORM_ROLE_CLOSEOUT_TASKBRIEF.md`"拍板结果 · PERM-4c3"。

已不受影响（盘点时排除）：
- 导航 / 默认落地 / 底栏：4c2 岗位模式已按权限键。
- `tenancy/tool-auth.ts` `canInvokeTool`：只看成员角色。
- `capabilities/governance/access.ts:44`：那里的 `manager` 是工作区角色。
- `agent-core/tool-registry.ts` `normalizeRole`：已把 `boss` / `operations` 归一成 `user`。
- `permissions-client.ts` `canAccessModule`：无调用方。
- `admin/users`、`invite-codes`：只 super_admin。

## A. AI / 智能体 → `perm-4c4-ai-tools-by-position`（销售日常工作，必须先收口）

### A1 工具按平台角色过滤
- **位置**：`src/lib/agent-core/tool-registry.ts:28-40,95-98`，`tools/_policy.ts`。
- **门槛**：工具列表按平台角色过滤。入口有：
  - 网页 `api/ai/threads/[threadId]/messages`；
  - 微信 `agent-runtime/process.ts`；
  - @提及 `mention-gateway/policy.ts`；
  - `api/agent-core/chat`。
- **压扁前后**：
  - sales：全部 `sales_*` / `secretary_*` / `project_*` → 只剩通用工具。
  - boss / operations / manager：已归一为 `user`，不变。
- **建议**：岗位模式下工具域按岗位键（销售工作键 → sales / secretary；`project.read` → project）。

### A2 能力矩阵按平台角色
- **位置**：`src/lib/rbac/capabilities.ts`（`aiDomains` / `uiModules` / `dataScope` / `canWrite`），`getCapabilities(role)`。
- **门槛**：AI 域、界面模块、数据范围（`rbac/data-scope.ts`）。
- **压扁前后**：sales / boss 的域与 `dataScope` 变成 `user` 的。
- **建议**：岗位模式下按岗位键派生；`dataScope=all` 只给管理层（`organization.dashboard.read`），并且**必须按企业过滤**——另见独立任务"visualizer 跨企业泄露"。

### A3 晨报
- **位置**：`src/lib/secretary/briefing.ts:24-41`。
- **门槛**：晨报扫描域。
- **压扁前后**：sales 的销售域晨报变空。
- **建议**：按岗位键。

### A4 Muse 销售查询（决定 B）
- **位置**：`src/lib/muse-bridge/sales-pure.ts:35-52` `resolveSalesScope`。调用方：`sales.ts`、`followup.ts`、`inquiry.ts`。
- **门槛**：Muse 销售查询范围与金额（决定 B）。
- **压扁前后**：
  - sales：本人 → 拒绝；
  - boss / manager：全组织 + 金额 → 只有 `org_owner` / `org_admin` 才保留，否则拒绝。
- **建议**：管理层 = `organization.dashboard.read`（金额照决定 B 只给管理层）；本人范围 = 销售工作键。

### A5 放宽：AI 上下文可挂客户
- **位置**：`src/lib/agent-scope/resolve.ts:89`。
- **门槛**：AI 上下文可挂的客户。
- **压扁前后**：sales 只能挂自己的客户 → 可挂全企业客户。
- **建议**：按 `sales.customer.read` 的数据范围。

### A6 放宽：营销数字员工与营销页
- **位置**：`src/lib/marketing/access.ts:40`、`marketing/route-access.ts:22`（`middleware.ts:81`）。
- **门槛**：营销数字员工、`/marketing`、`/operations/growth` 深链。
- **压扁前后**：sales 被挡 → 放行。
- **建议**：按 `operations.read` / `operations.manage`。

### A7 仅提示词
- **位置**：`ai/prompts/common.ts:268-281`、`agent-core/prompts/operator-system.ts:25-27,62`。
- **门槛**：提示词里的角色说明与知识包。
- **压扁前后**：sales 失去窗饰知识包，提示变成"普通用户"。
- **建议**：按岗位键。

### A8 环境变量角色白名单
- **位置**：`feature-flags.ts:51`、`workforce-runtime/flags.ts:49`、`agent-supervisor/flags.ts:55`、`ai/model-policy/flags.ts:92`、`employee-ai/flags`、`digital-employees/activation`、`agent-runtime-v2/flags`、`assistant/followup-flags`。
- **门槛**：按角色白名单开功能（如 `DIGITAL_EMPLOYEE_ROLE_ALLOWLIST=admin,sales`）。
- **压扁前后**：取决于生产环境变量值。
- **建议**：核对生产值；改为按岗位键或加 `user`。

## B. 接口授权 → `perm-4c5-management-reads-by-position`（含招投标，Sunny 需要）

### B1 团队任务
- **位置**：`src/app/api/tasks/route.ts:58-64,188`、`api/tasks/[id]/route.ts:113-118,291`。
- **门槛**：团队视图、指派他人、改他人任务。
- **压扁前后**：boss / manager 若不是 `org_owner` / `org_admin` 就失去。
- **建议**：wsCtx 注入 `permissionKeys` + `positionMode`（同 4b `/api/ops/home`）。

### B2 运营项目列表 / 创建
- **位置**：`src/app/api/ops/projects/route.ts:37-51`（`buildOpsCtx`）。
- **门槛**：列表 / 创建。
- **压扁前后**：同 B1。
- **建议**：同 B1。

### B3 招投标交接
- **位置**：`src/lib/projects/handoff/access.ts:27-31,79`，`api/projects/[id]/handoff{,/preview,/execute}`。
- **门槛**：中标交接。
- **压扁前后**：同 B1。`bids.handoff.*` 键已有但 wsCtx 无键，够不到。
- **建议**：wsCtx 注入键，按 `bids.handoff.*`。

### B4 审批执行
- **位置**：`src/lib/pending-actions/executor.ts:1310,1351,1534,1561,1604,1862-1879` `canSeeResource(ctx.role…)`。
- **门槛**：审批执行时对资源的可见性。
- **压扁前后**：boss 批 / 执行销售的商机 / 报价 / 客户动作被拒。
- **建议**：按岗位键的数据范围（`authorize`）。

### B5 视觉方案
- **位置**：`src/lib/visualizer/access.ts:24,46,73`（`rbac/data-scope.ts`）。
- **门槛**：视觉方案可见范围。
- **压扁前后**：boss 全部 → 本人。
- **建议**：随 A2；**另有既有跨企业泄露（独立任务）**。

### B6 市场情报
- **位置**：`src/lib/market-intelligence/access.ts:9`（5 个 `api/operations/market-intelligence*`）。
- **门槛**：市场情报。
- **压扁前后**：manager（Sunny 无人用）。
- **建议**：按 `operations.*`。

### B7 团队学习审核
- **位置**：`src/lib/employee-ai/access.ts:50` `canReviewTeamLearning`（5 个 `api/team/*`）。
- **门槛**：团队学习审核。
- **压扁前后**：manager（Sunny 无人用）。
- **建议**：按管理层键。

## C. 仅界面 → `perm-4c5`

### C1 管理总览的销售 / 外贸模块与每日简报
- **位置**：`src/components/dashboard/management-dashboard-client.tsx:52-67,238,253,268`。
- **门槛**：管理总览里销售 / 外贸模块与每日简报的显示。
- **压扁前后**：boss 首页这几块消失。
- **建议**：按 `organization.dashboard.read`（外贸模块随 PERM-6）。

## D. 通知 / 收件人 / 路由

### D1 新绑定微信的推送
- **位置**：`src/lib/messaging/binding.ts:25-34`、`messaging/types.ts:97-103`。
- **门槛**：新绑定 / 重绑微信的推送域。
- **压扁前后**：前销售不再推销售消息（已有绑定不受影响）。
- **建议**：按岗位键 → **4c5**。

### D2 外贸管理层收件人
- **位置**：`src/lib/trade/booth-summary.ts:18,146-157`、`trade/inquiry-sla.ts:216`、`trade/website-inquiry.ts:1002`。
- **门槛**：老板询盘晨报、SLA 升级、展会汇总、询盘通知。
- **压扁前后**：boss / manager 收不到。
- **建议**：**PERM-6**（Sunny 暂不需要外贸）。

### D3 默认询盘负责人
- **位置**：`src/lib/revenue-spine/inquiry-intake.ts:147`。
- **门槛**：默认询盘负责人。
- **压扁前后**：不再选到销售。
- **建议**：**PERM-6**。

### D4 营收中心接口
- **位置**：`src/lib/revenue-spine/access.ts:14,19`（13 个 `/api/revenue/*`）、`api/revenue/policy/route.ts:32`。
- **门槛**：营收中心接口。
- **压扁前后**：sales / boss → 403。
- **建议**：**PERM-6**。

### D5 管理员入职清单
- **位置**：`src/lib/organizations/onboarding.ts:596`、`onboarding-rules.ts:321,595`。
- **门槛**：管理员入职清单。
- **压扁前后**：两步回到待办。
- **建议**：按岗位键 → **4c5**（低优先）。

## E. 数据

### E1 seed 自动绑 `sales_rep`
- **位置**：`src/lib/authorization/seed-org-profiles.ts:147-167`。
- **门槛**：平台 `sales` 成员自动绑 `sales_rep`。
- **压扁前后**：压扁后不再触发（已绑定的不受影响）。
- **建议**：可保留；新人走 `bind-positions`。

### E2 兼容回退
- **位置**：`src/lib/authorization/resolve-effective-permissions.ts`。
- **门槛**：兼容回退。
- **压扁前后**：**4c3 已关闭（岗位模式企业）**。
- **建议**：—

## 打开闸门的条件

把 `PLATFORM_ROLE_COLLAPSE_READY` 改为 `true`（在最后一个合并的残留收口 change 里改，并在该 change 的测试里断言）前，须同时满足：
1. A 组全部、B 组全部、C1、D1、D5 已在 `perm-4c4-ai-tools-by-position` / `perm-4c5-management-reads-by-position` 合并。
2. D2 / D3 / D4 明确归 PERM-6（Sunny 暂不需要外贸，2026-10-28 拍板）。
3. 生产对 Sunny 跑 `bind-positions --dry-run` 全员有 active 绑定，跑 `collapse-platform-roles --dry-run` 无阻断。
4. A8 的生产环境变量已核对。
