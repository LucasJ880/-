# PERM-4c3 残留平台角色读点清单

> 用途：岗位模式企业把平台角色 `boss / manager / operations / sales`（PERM-6c 起含 `trade`，见 F 组）压成 `user` **之前**必须收口的读点。
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
- **状态**：**4c4 已收口**——`runAgent` / `runAgentStream` 开头取岗位派生平台角色，覆盖网页 / @提及 / 微信 / `/api/agent-core/chat`；`/api/agent-core/tools` 列表同样处理。工具策略表未改（改权限键另立 change）。

### A2 能力矩阵按平台角色
- **位置**：`src/lib/rbac/capabilities.ts`（`aiDomains` / `uiModules` / `dataScope` / `canWrite`），`getCapabilities(role)`。
- **门槛**：AI 域、界面模块、数据范围（`rbac/data-scope.ts`）。
- **压扁前后**：sales / boss 的域与 `dataScope` 变成 `user` 的。
- **建议**：岗位模式下按岗位键派生；`dataScope=all` 只给管理层（`organization.dashboard.read`），并且**必须按企业过滤**——另见独立任务"visualizer 跨企业泄露"。
- **状态**：**已收口（4c4 + 4c5）**——AI 线程路由的 `getCapabilities` 取派生角色（4c4）；视觉方案 / 审批执行的 `dataScope` 4c5 收口。原文：`dataScope`（视觉方案、审批执行等非 AI 读点）归 B4 / B5（4c5）。

### A3 晨报
- **位置**：`src/lib/secretary/briefing.ts:24-41`。
- **门槛**：晨报扫描域。
- **压扁前后**：sales 的销售域晨报变空。
- **建议**：按岗位键。
- **状态**：**4c4 已收口**——`getUserDomains(userId, orgId)` 取派生角色。

### A4 Muse 销售查询（决定 B）
- **位置**：`src/lib/muse-bridge/sales-pure.ts:35-52` `resolveSalesScope`。调用方：`sales.ts`、`followup.ts`、`inquiry.ts`。
- **门槛**：Muse 销售查询范围与金额（决定 B）。
- **压扁前后**：
  - sales：本人 → 拒绝；
  - boss / manager：全组织 + 金额 → 只有 `org_owner` / `org_admin` 才保留，否则拒绝。
- **建议**：管理层 = `organization.dashboard.read`（金额照决定 B 只给管理层）；本人范围 = 销售工作键。
- **状态**：**4c4 已收口**——`resolveMuseBinding` 身份带派生角色与 `positionMode`；岗位模式 `resolveSalesScope` 忽略企业成员角色。

### A5 放宽：AI 上下文可挂客户
- **位置**：`src/lib/agent-scope/resolve.ts:89`。
- **门槛**：AI 上下文可挂的客户。
- **压扁前后**：sales 只能挂自己的客户 → 可挂全企业客户。
- **建议**：按 `sales.customer.read` 的数据范围。
- **状态**：**4c4 已收口**——`resolveAgentScope` 客户限制取派生角色。

### A6 放宽：营销数字员工与营销页
- **位置**：`src/lib/marketing/access.ts:40`、`marketing/route-access.ts:22`（`middleware.ts:81`）。
- **门槛**：营销数字员工、`/marketing`、`/operations/growth` 深链。
- **压扁前后**：sales 被挡 → 放行。
- **建议**：按 `operations.read` / `operations.manage`。
- **状态**：**已收口（4c4 + 4c5）**——4c5 新增营销工作区服务端 layout（`/marketing`、`/operations/growth`）与 `requireMarketingReadAccess`（16 个 GET）、工作台按钮读 `effectiveRole`；4c4：`/api/marketing/employee` 与微信入口取派生角色（压扁后销售仍被挡）；页面中间件 `middleware.ts` / `route-access.ts`（读 JWT）与工作台按钮显示归 4c5。

### A7 仅提示词
- **位置**：`ai/prompts/common.ts:268-281`、`agent-core/prompts/operator-system.ts:25-27,62`。
- **门槛**：提示词里的角色说明与知识包。
- **压扁前后**：sales 失去窗饰知识包，提示变成"普通用户"。
- **建议**：按岗位键。
- **状态**：**4c4 已收口（经入口）**——AI 线程路由、`/api/ai/chat` 的提示词取派生角色；未经这些入口的提示词调用方由 4c5 复核。

### A8 环境变量角色白名单
- **位置**：`feature-flags.ts:51`、`workforce-runtime/flags.ts:49`、`agent-supervisor/flags.ts:55`、`ai/model-policy/flags.ts:92`、`employee-ai/flags`、`digital-employees/activation`、`agent-runtime-v2/flags`、`assistant/followup-flags`。
- **门槛**：按角色白名单开功能（如 `DIGITAL_EMPLOYEE_ROLE_ALLOWLIST=admin,sales`）。
- **压扁前后**：取决于生产环境变量值。
- **建议**：核对生产值；改为按岗位键或加 `user`。
- **状态**：**已收口（4c4 + 4c5）**——4c5：`/api/agent-supervisor/runs`、持久跟进、workforce job 的开关传派生角色；生产环境变量值仍请 Lucas 核对。4c4：AI 线程路由 `isOperatorEnabled` 取派生角色；agent-supervisor 入口传派生角色。其余开关（`DIGITAL_EMPLOYEE_ROLE_ALLOWLIST`、`WORKFORCE_RUNTIME_ROLE_ALLOWLIST`、`ENABLE_GPT6_ASTRA_ROLE_ALLOWLIST`、`ASSISTANT_DURABLE_FOLLOWUP_ROLE_ALLOWLIST`）的调用方未改：Lucas 核对生产值，含 `sales` 者压扁后需同时有派生入口或改为按用户 id；4c5 收尾时复核。

## B. 接口授权 → `perm-4c5-management-reads-by-position`（含招投标，Sunny 需要）

### B1 团队任务
- **位置**：`src/app/api/tasks/route.ts:58-64,188`、`api/tasks/[id]/route.ts:113-118,291`。
- **门槛**：团队视图、指派他人、改他人任务。
- **压扁前后**：boss / manager 若不是 `org_owner` / `org_admin` 就失去。
- **建议**：wsCtx 注入 `permissionKeys` + `positionMode`（同 4b `/api/ops/home`）。
- **状态**：**4c5 已收口**——上下文注入 `loadWorkspaceSignals`（`permissionKeys` + `positionMode`）。

### B2 运营项目列表 / 创建
- **位置**：`src/app/api/ops/projects/route.ts:37-51`（`buildOpsCtx`）。
- **门槛**：列表 / 创建。
- **压扁前后**：同 B1。
- **建议**：同 B1。
- **状态**：**4c5 已收口**——同 B1。

### B3 招投标交接
- **位置**：`src/lib/projects/handoff/access.ts:27-31,79`，`api/projects/[id]/handoff{,/preview,/execute}`。
- **门槛**：中标交接。
- **压扁前后**：同 B1。`bids.handoff.*` 键已有但 wsCtx 无键，够不到。
- **建议**：wsCtx 注入键，按 `bids.handoff.*`。
- **状态**：**4c5 已收口**——三个交接路由注入岗位信号，`bids.handoff.*` 键可达。

### B4 审批执行
- **位置**：`src/lib/pending-actions/executor.ts:1310,1351,1534,1561,1604,1862-1879` `canSeeResource(ctx.role…)`。
- **门槛**：审批执行时对资源的可见性。
- **压扁前后**：boss 批 / 执行销售的商机 / 报价 / 客户动作被拒。
- **建议**：按岗位键的数据范围（`authorize`）。
- **状态**：**4c5 已收口**——`/api/ai/pending-actions/[id]`、agent 任务步骤审批、微信确认用派生角色；Muse 审批 4c4 已派生；能力中台审批传的是企业成员角色，不受压扁影响。

### B5 视觉方案
- **位置**：`src/lib/visualizer/access.ts:24,46,73`（`rbac/data-scope.ts`）。
- **门槛**：视觉方案可见范围。
- **压扁前后**：boss 全部 → 本人。
- **建议**：随 A2；**另有既有跨企业泄露（独立任务）**。
- **状态**：**4c5 已收口**——`resolveVisualizerViewer`：按企业 + 派生角色判定"看全部"，**跨企业泄露已修**（`dataScope=all` 只在可看全部的企业内生效；平台 super_admin 仍全部）。

### B6 市场情报
- **位置**：`src/lib/market-intelligence/access.ts:9`（5 个 `api/operations/market-intelligence*`）。
- **门槛**：市场情报。
- **压扁前后**：manager（Sunny 无人用）。
- **建议**：按 `operations.*`。
- **状态**：保留——Sunny 无 `manager`，派生角色不产生 `manager`，压扁无影响。

### B7 团队学习审核
- **位置**：`src/lib/employee-ai/access.ts:50` `canReviewTeamLearning`（5 个 `api/team/*`）。
- **门槛**：团队学习审核。
- **压扁前后**：manager（Sunny 无人用）。
- **建议**：按管理层键。
- **状态**：保留——同 B6。

## C. 仅界面 → `perm-4c5`

### C1 管理总览的销售 / 外贸模块与每日简报
- **位置**：`src/components/dashboard/management-dashboard-client.tsx:52-67,238,253,268`。
- **门槛**：管理总览里销售 / 外贸模块与每日简报的显示。
- **压扁前后**：boss 首页这几块消失。
- **建议**：按 `organization.dashboard.read`（外贸模块随 PERM-6）。
- **状态**：**4c5 已收口**——`/api/auth/me` 返回 `effectiveRole`，管理总览按它显示模块。

## D. 通知 / 收件人 / 路由

### D1 新绑定微信的推送
- **位置**：`src/lib/messaging/binding.ts:25-34`、`messaging/types.ts:97-103`。
- **门槛**：新绑定 / 重绑微信的推送域。
- **压扁前后**：前销售不再推销售消息（已有绑定不受影响）。
- **建议**：按岗位键 → **4c5**。
- **状态**：**4c5 已收口**——新绑定默认推送按派生角色。

### D2 外贸管理层收件人
- **位置**：`src/lib/trade/booth-summary.ts:18,146-157`、`trade/inquiry-sla.ts:216`、`trade/website-inquiry.ts:1002`。
- **门槛**：老板询盘晨报、SLA 升级、展会汇总、询盘通知。
- **压扁前后**：boss / manager 收不到。
- **建议**：**PERM-6**（Sunny 暂不需要外贸）。
- **状态**：**PERM-6c 已收口**——新 `src/lib/trade/recipients.ts`：工作收件人 = 持外贸读或写键；管理层收件人 = 管理层且持外贸键（见 F2）。

### D3 默认询盘负责人
- **位置**：`src/lib/revenue-spine/inquiry-intake.ts:147`。
- **门槛**：默认询盘负责人。
- **压扁前后**：不再选到销售。
- **建议**：**PERM-6**。
- **状态**：**PERM-6c 已收口**——按岗位派生平台角色（`trade` / `sales`）选最早加入的人（见 F3）。

### D4 营收中心接口
- **位置**：`src/lib/revenue-spine/access.ts:14,19`（13 个 `/api/revenue/*`）、`api/revenue/policy/route.ts:32`。
- **门槛**：营收中心接口。
- **压扁前后**：sales / boss → 403。
- **建议**：**PERM-6**。
- **状态**：**PERM-6c 已收口**——按外贸键（拍板：平台 `sales` 不再进营收中心，见 F1）。

### D5 管理员入职清单
- **位置**：`src/lib/organizations/onboarding.ts:596`、`onboarding-rules.ts:321,595`。
- **门槛**：管理员入职清单。
- **压扁前后**：两步回到待办。
- **建议**：按岗位键 → **4c5**（低优先）。
- **状态**：**4c5 已收口**——岗位模式"业务员"按销售工作键。

## E. 数据

### E1 seed 自动绑 `sales_rep`
- **位置**：`src/lib/authorization/seed-org-profiles.ts:147-167`。
- **门槛**：平台 `sales` 成员自动绑 `sales_rep`。
- **压扁前后**：压扁后不再触发（已绑定的不受影响）。
- **建议**：可保留；新人走 `bind-positions`。
- **状态**：保留——新人走 `bind-positions`。

### E2 兼容回退
- **位置**：`src/lib/authorization/resolve-effective-permissions.ts`。
- **门槛**：兼容回退。
- **压扁前后**：**4c3 已关闭（岗位模式企业）**。
- **建议**：—

## F. 外贸（压扁 `trade` 的前提）→ `perm-6c-revenue-and-trade-recipients`

压扁范围原来不含 `trade`。PERM-6a 已让外贸接口、导航外贸入口、派生角色（`trade` 档）按岗位；以下是压扁 `trade` 前剩下的读点。

### F1 营收中心接口（= D4）
- **位置**：`src/lib/revenue-spine/access.ts`、`src/app/api/revenue/**`（13 个文件）。
- **状态**：**6c 已收口**——
  - 读 = `trade.read` / `trade.manage`，写 = `trade.manage`，发布策略 = `trade.settings.manage`（读策略三键任一）；
  - 旧模式导航营收入口去掉平台 `sales`。

### F2 外贸收件人（= D2）
- **位置**：`trade/inquiry-sla.ts`、`trade/website-inquiry.ts`、`trade/booth-summary.ts`（`managementOf`，早报 / 展会小结 / SLA 分级共用）。
- **状态**：**6c 已收口**——见 D2。

### F3 默认询盘负责人（= D3）
- **状态**：**6c 已收口**——见 D3。

### F4 侧栏外贸两段式布局
- **位置**：`src/components/sidebar.tsx`（`usesTradeLayout`）。
- **门槛**：原按 `user.role === "trade"`。
- **状态**：**6c 已收口**——按 `/api/auth/me` 的 `effectiveRole`。

### F5 入职清单"业务员"
- **位置**：`src/lib/organizations/onboarding.ts`。
- **门槛**：岗位模式原来"或平台 `trade`"。
- **状态**：**6c 已收口**——认销售工作键或 `trade.manage`。

### 不需要改（复核过）
- 管理总览：读 `effectiveRole`（4c5）。
- AI 晨报 / agent-runtime / Muse / 微信绑定默认推送：经 `resolveEffectivePlatformRole`（4c4 / 4c5）。
- `nav-role-policy`：只在旧模式生效。
- 兼容回退里的平台 `trade` → `trade_rep`：只在旧模式企业生效。
- AI 工具策略里的平台 `admin` 档跨所有域，不属外贸，另议。

## 收口进度

- 2026-10-28 `perm-6c-revenue-and-trade-recipients`：D2–D4 与 F1–F5 已收口；压扁范围加入 `trade`（只对岗位模式企业生效；梦馨要 6b 后才是岗位模式）。

- 2026-10-28 `perm-4c5-management-reads-by-position`：B1–B5、C1、D1、D5 与 A2 / A6 / A8 余项已收口，视觉方案跨企业泄露已修；B6 / B7 / E1 保留（无影响）；D2–D4 归 PERM-6。**写库闸门 `PLATFORM_ROLE_COLLAPSE_READY` 已改为 true。**
- 2026-10-28 `perm-4c4-ai-tools-by-position`：A1 / A3 / A4 / A5 / A7 已收口；A2 / A6 / A8 部分收口（余项见各条"状态"，归 4c5）。

## 打开闸门的条件（2026-10-28 已满足 1 / 2；3 / 4 是生产执行前的核对）

把 `PLATFORM_ROLE_COLLAPSE_READY` 改为 `true`（在最后一个合并的残留收口 change 里改，并在该 change 的测试里断言）前，须同时满足：
1. A 组全部、B 组全部、C1、D1、D5 已在 `perm-4c4-ai-tools-by-position` / `perm-4c5-management-reads-by-position` 合并。
2. D2 / D3 / D4 明确归 PERM-6（Sunny 暂不需要外贸，2026-10-28 拍板）。
3. 生产对 Sunny 跑 `bind-positions --dry-run` 全员有 active 绑定，跑 `collapse-platform-roles --dry-run` 无阻断。
4. A8 的生产环境变量已核对。


## 生产执行压扁（Lucas，闸门已打开）

1. `ALLOW_POSITION_BINDING=true npx tsx scripts/bind-positions.ts --org <sunny> --file config/positions/sunny.json --actor <lucas> --dry-run`：Sunny 全员有 active 绑定（`TODO:` 先填）；有缺口先去掉 `--dry-run` 绑定。
2. `ALLOW_ROLE_COLLAPSE=true npx tsx scripts/collapse-platform-roles.ts --org <sunny> --actor <lucas> --dry-run`：核对待压扁名单（应为 Sunny 的 boss / sales / operations 成员）与阻断项（尤其是否有人同时在梦馨）；退出码 0 才继续。
3. 去掉 `--dry-run` 执行；输出"已压扁 N 人"。
4. 通知被压扁的成员重新登录（中间件读登录时签发的角色）。
5. 抽查：老板首页停在管理总览、AI 有原工具、Muse 能看金额；销售落 `/sales/home`、AI 有销售工具、进不了增长中心；运营进 `/ops`。
6. 出问题：`ALLOW_ROLE_COLLAPSE=true npx tsx scripts/collapse-platform-roles.ts --org <sunny> --actor <lucas> --restore`（先加 `--dry-run` 看计划）。
