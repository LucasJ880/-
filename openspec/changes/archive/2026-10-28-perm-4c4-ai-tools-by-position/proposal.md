# Proposal

TASKFLOW：PERM-4c4（`docs/QINGYAN_PERMISSION_TASKFLOW.md`）；残留清单 `docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md` A 组；拍板见任务书 `docs/QINGYAN_PERM-4_PLATFORM_ROLE_CLOSEOUT_TASKBRIEF.md`"拍板结果 · PERM-4c3"（2026-10-28：按推荐拆 4c4 / 4c5；Sunny 暂不要外贸）

## Why

4c3 的盘点表明，AI / 智能体一侧仍按平台角色（`User.role`）决定：
- 可用工具与工具域（`tool-registry` + `_policy`、`capabilities.ts`、微信入口的域）；
- 晨报扫描域；
- Muse 销售查询范围与金额（决定 B）；
- AI 上下文能挂哪些客户；
- 能否用营销数字员工；
- 部分功能开关的角色白名单。

Sunny 压扁后（销售 → `user`），销售会失去全部销售 / 秘书 / 项目工具、晨报变空、Muse 拒绝；老板若不是 `org_owner` / `org_admin` 会失去 Muse 的全组织范围与金额；同时销售反而会被放宽到全企业客户与营销数字员工。

本次让岗位模式企业的 AI 一侧按岗位判定，并保证压扁前后行为一致。这是打开 4c3 写库闸门的前置之一。

## What Changes

- **岗位派生平台角色**：新增 `src/lib/rbac/effective-platform-role.ts`。
  - 纯函数 `deriveEffectivePlatformRole({ platformRole, positionMode, permissionKeys })`；
  - 异步 `resolveEffectivePlatformRole({ userId, orgId, platformRole })`，内部用 4c2 的 `loadPositionMode` + `loadPermissionKeys`。
  - 规则：
    - 旧模式企业 → 原平台角色；
    - 平台角色为 `super_admin` / `admin` / `trade` → 原样；
    - 岗位模式下，持 `organization.dashboard.read` → `boss`；否则持 `sales.quote.create` 或 `sales.quote.pricing_close` → `sales`；否则持 `operations.read` 或 `operations.manage` → `operations`；其余 → `user`。
  - 派生角色只在 AI 一侧使用，不写库、不改 `User.role`。
- **AI 工具与能力按派生角色**：
  - `runAgent` / `runAgentStream` 开头用派生角色覆盖 `options.role`。一处覆盖工具列表过滤与工具执行上下文的 `role`，适用于网页、@提及、微信、`/api/agent-core/chat`。
  - AI 线程路由（`/api/ai/threads/[threadId]/messages`）取得企业后计算一次派生角色，替换路由内的能力矩阵、系统提示词、工作上下文、路由器、`isOperatorEnabled` 白名单。
  - `/api/ai/threads/.../retry`、`/api/ai/chat`、`/api/agent-core/tools`（列表）同样处理。
  - 微信 `executeConversationRun` 的域选择、`mention-gateway` 策略、`agent-runtime-v2` 主体、`agent-supervisor` 发起入口使用派生角色。
- **Muse 销售查询（决定 B）**：
  - `resolveMuseBinding` 返回的身份 `role` 改为派生角色，并带 `positionMode`；
  - 岗位模式下 `resolveSalesScope` 不再因企业成员角色 `org_owner` / `org_admin` 给全组织范围，只看派生角色（管理层 = 持 `organization.dashboard.read`）。与 4c2"`org_owner` 本身不是管理层"一致。
  - 旧模式不变。
- **晨报、AI 上下文客户、营销数字员工**：
  - `secretary/briefing` 的扫描域、`agent-scope` 的销售本人客户限制、`/api/marketing/employee` 与微信入口的营销数字员工判定，都改用派生角色；
  - 防止压扁后销售被放宽。
- 旧模式企业（梦馨）全部行为不变。

## Capabilities

### New Capabilities
- `agents/position-derived-role`：岗位派生平台角色的规则与使用范围（AI 工具 / 能力 / 微信域 / 晨报 / AI 上下文 / 营销数字员工 / 功能开关白名单），压扁前后一致

### Modified Capabilities
- `agents/tool-authorization`：工具列表与执行上下文的角色在岗位模式企业取派生角色
- （Muse 决定 B 目前无已归档规格；在 `agents/position-derived-role` 内以需求写明岗位模式下的 Muse 范围）

## Out of scope

- 清单 B / C / D1 / D5（任务、运营项目、招投标交接、审批执行、管理总览、微信推送域、入职清单）→ `perm-4c5-management-reads-by-position`。
- 页面中间件 `middleware.ts` 对 `/marketing`、`/operations/growth` 的路由放行：读 JWT，同步路径拿不到岗位键。接口已按派生角色挡住；页面壳层放行归 4c5 处理。
- 工具策略表 `_policy.ts` 的 `allowRoles` 改成权限键（另立 change；本次用派生角色保持等价）。
- `admin` / `trade` 与外贸（PERM-6）。
- 打开 4c3 写库闸门（4c5 负责）。

## Impact

- 新增：`src/lib/rbac/effective-platform-role.ts`；测试 `src/lib/rbac/__tests__/effective-platform-role.test.ts`（纯）、`effective-platform-role-db.isolated.test.ts`（隔离库）。
- 修改：
  - `src/lib/agent-core/engine.ts`；
  - `src/app/api/ai/threads/[threadId]/messages/route.ts`、`.../runs/[runId]/retry/route.ts`；
  - `src/app/api/ai/chat/route.ts`、`src/app/api/agent-core/{chat,tools}/route.ts`；
  - `src/lib/agent-runtime/process.ts`、`src/lib/mention-gateway/policy.ts`、`src/lib/agent-runtime-v2/principal.ts`；
  - `src/app/api/agent-supervisor/runs/**`；
  - `src/lib/muse-bridge/{binding,binding-pure,sales-pure}.ts`；
  - `src/lib/secretary/briefing.ts`、`src/lib/agent-scope/resolve.ts`、`src/app/api/marketing/employee/route.ts`；
  - `docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md`（A 组标已收口）。
- **BREAKING（Sunny，合并即生效）**：
  - AI 一侧不再看平台角色。没绑 `owner` 的老板在 Muse 不再有全组织范围与金额（即使是 `org_owner`）。
  - 平台角色是 `sales`、但岗位不是销售的人，失去销售工具。
  - 上线前确认岗位绑定（同 4c2 / 4c3）。
- 零 schema；每次 AI 运行多 2 次轻量查询（行业包 + 有效键）。
