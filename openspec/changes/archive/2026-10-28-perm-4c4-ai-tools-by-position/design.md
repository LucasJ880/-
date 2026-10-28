# Design

## Context

- AI 一侧按 `User.role` 判定的点见 `docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md` A 组：
  - 工具策略表 `agent-core/tools/_policy.ts`：约 100 个工具的 `allowRoles` 写的是 `admin` / `sales` / `trade` / `*`；
  - `tool-registry.ts` `normalizeRole`：已把 `boss` / `operations` / 未知归一为 `user`，`manager` 原样；
  - `rbac/capabilities.ts` 按角色给 `aiDomains` / `dataScope` / `uiModules`；
  - 微信入口 `executeConversationRun` 自己按 `userRole` 拼域；
  - Muse `resolveSalesScope` 看平台角色或企业角色。
- `runAgent` / `runAgentStream`（`agent-core/engine.ts`）是网页、@提及、微信、`/api/agent-core/chat` 的共同出口。它们用 `options.role` 做工具列表过滤（`registry.toOpenAITools({ role })`），并放进工具执行上下文（`buildToolContextBase`，工具内 `canSeeResource(ctx.role…)` 等数据范围遗留用法）。
- 4c2 已有 `loadPositionMode(orgId)` 与 `loadPermissionKeys(userId, orgId)`（`src/lib/rbac/permission-keys.ts`），以及岗位模式下"管理层 = `organization.dashboard.read`、销售专职 = `sales.quote.create|pricing_close`"的口径。
- 4c3 写库闸门 `PLATFORM_ROLE_COLLAPSE_READY = false`，打开前须完成 A 组（本 change）与 B / C / D1 / D5（4c5）。

## Goals / Non-Goals

**Goals**：
- 岗位模式企业 AI 一侧的判定由岗位决定；
- Sunny 压扁前后 AI 行为一致（等价）；
- 旧模式企业零变化；
- 防止压扁后的放宽（全企业客户、营销数字员工）。

**Non-Goals**：
- 把 `_policy.ts` 改成权限键（另立 change）；
- 改变任何岗位的能力范围（例如给老板开销售工具——今天平台 `boss` 在工具列表里就是 `user`，保持）；
- 4c5 范围；
- 中间件页面放行；
- 外贸 / `admin`。

## Decisions

### D1 用"岗位派生平台角色"做桥，不逐个工具改权限键
在岗位模式企业，把有效权限键映射回今天的平台角色词汇：
- `organization.dashboard.read` → `boss`；
- 销售工作键 → `sales`；
- `operations.*` → `operations`；
- 其余 → `user`。

所有按角色判定的下游（工具策略、能力矩阵、提示词、晨报、Muse、开关白名单）不改一行，就能在压扁前后得到同样结果。
- 否决：逐个工具声明 `requiredPermission`——约 100 个工具，且执行层授权已按企业角色 / 模块 / 风险收口，列表过滤只是可见性；工作量与风险都不相称，留待单独 change。
- 否决：在登录 / `withAuth` 层全局替换 `user.role`——影响外贸 `requireRole`、平台管理页等不该变的地方，且每个请求都多查询。

### D2 优先级与保留角色
- `super_admin` / `admin` / `trade` 原样：前两者是平台管理口径（4b / PERM-1 已定），`trade` 留 PERM-6。
- 其余按键：管理层优先于销售，销售优先于运营。
- 多岗并集时取最高一项，与今天"一个人只有一个平台角色"等价。老板兼销售（如 Miki：owner + pricing_lead + accounting）派生为 `boss`。今天平台 `boss` 在工具列表里同样不含 `sales_*`，所以等价。
- 否决：派生成多个角色的并集——下游都按单一角色判定，并集要改所有下游。

### D3 在 `runAgent` / `runAgentStream` 开头派生一次
- 工具列表过滤与工具执行上下文都取派生角色，一处覆盖所有对话入口。
- 派生是幂等的：入口已派生过的角色再派生一次结果不变，因为结果只取决于权限键，保留角色原样。
- 入口仍需各自派生，用于工具之外的判定：能力矩阵的 `aiDomains`、微信域、提示词、开关白名单、工作上下文。
- 否决：只在入口派生——漏掉任何一个入口都会退回平台角色；engine 兜底更稳。

### D4 Muse：岗位模式忽略企业成员角色
- `resolveMuseBinding` 构造身份时，`role` 取派生角色，并带 `positionMode`。
- `resolveSalesScope` 在 `positionMode` 下只看派生角色：`boss` → 全组织 + 金额；`sales` → 本人；其余拒绝。
- 与 4c2"岗位模式下 `org_owner` / `org_admin` 本身不是管理层"一致。旧模式保留"平台角色或企业角色任一管理"的规则。
- 平台 `admin` / `super_admin` 派生原样，仍是全组织。

### D5 防放宽：晨报、AI 上下文、营销数字员工
- `secretary/briefing.getUserDomains`：改为接收企业 id 并取派生角色。调用方 `api/secretary/briefing`、`agent-core/tools/secretary`、批量晨报都已有 `orgId`。
- `agent-scope/resolve`：`platformRole` 取派生角色。
- `/api/marketing/employee` 与微信入口的 `canUseMarketingDigitalEmployee`：取派生角色。
- 客户端工作台 `digital-employee-workbench.tsx` 只决定按钮显示，接口已挡住；它的 `user.role` 用法留 4c5 页面层统一处理。

### D6 功能开关白名单
- AI 线程路由的 `isOperatorEnabled` 改传派生角色。
- 其余开关（`DIGITAL_EMPLOYEE_ROLE_ALLOWLIST`、`WORKFORCE_RUNTIME_ROLE_ALLOWLIST`、`AGENT_SUPERVISOR_ROLE_ALLOWLIST`、`ENABLE_GPT6_ASTRA_ROLE_ALLOWLIST`、`ASSISTANT_DURABLE_FOLLOWUP_ROLE_ALLOWLIST`）：在本 change 触及的入口里随派生角色传入；未触及的调用方列进报告，由 Lucas 核对生产值。
  - 白名单若含 `sales`，派生后依然命中；若写的是具体用户 id 则不受影响。

## 与八条硬纪律的关系

1. **零 schema**：不涉及。派生角色只在内存，不写库。
2. **出站先审批**：不涉及。工具的审批门不变（`approval-gate`）。
3. **第三套队列**：不涉及。
4. **脱敏**：触碰。Muse 金额仍只给管理层（决定 B 不变，只是"管理层"按岗位判定）。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：触碰。派生是查表，无 LLM；不新增 LLM 调用。
8. **测试注册**：触碰。纯测试注册 `test-all` 与 `test-ci-unit`，隔离库测试注册 `test-all`。

## Risks / Trade-offs

- **BREAKING（Sunny，合并即生效）**：AI 一侧从此看岗位。
  - 平台角色与岗位不一致的人行为会变（例如平台 `sales` 但只绑 `ops_staff` → 失去销售工具）；
  - 没绑 `owner` 的 `org_owner` 在 Muse 失去全组织与金额。
  - 上线前核对绑定。
- 每次 AI 运行多 2 次查询（行业包 + 有效键）；旧模式企业只多 1 次（行业包）。
- 派生角色延续了旧角色词汇，是过渡。终态是工具按权限键声明（另立 change）。

## 验证方式

- `npx tsx src/lib/rbac/__tests__/effective-platform-role.test.ts`（新，纯）：
  - 派生规则表：岗位模式各岗位 / 多岗 / 保留角色 / 旧模式 / 无键；
  - 幂等；
  - 工具列表等价：岗位模式 `user` + `sales_rep` 与平台 `sales` 得到同一组工具；平台 `sales` + `ops_staff` 不含 `sales_*`；
  - Muse `resolveSalesScope` 岗位模式 / 旧模式；
  - 源码断言：`runAgent` / `runAgentStream` 开头派生，D3 / D5 / D6 各入口调用 `resolveEffectivePlatformRole`。
- `effective-platform-role-db.isolated.test.ts`（新，隔离库）：
  - 窗饰企业 `user` + `sales_rep` → `sales`、`boss` + `ops_staff` → `operations`、`user` + `owner` → `boss`；
  - 旧模式企业 `sales` → `sales`；
  - Muse 绑定身份的 `role` / `positionMode`；
  - 晨报域、AI 上下文客户限制。
- 回归：`authorize`、`position-nav`、`platform-role-collapse`、muse-bridge 既有测试、agent-core 工具策略测试原样通过。
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate perm-4c4-ai-tools-by-position --strict`。
