# PERM-4c4 报告：AI 一侧按岗位（岗位派生平台角色）

change：`openspec/changes/perm-4c4-ai-tools-by-position/`（proposal / specs ×2 / design / tasks 8/8）
清单：`docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md` A 组
拍板：任务书"拍板结果 · PERM-4c4"（2026-10-28："按照你推荐的方案开始实施"）
零 schema：派生角色只在内存，不写库。

## 1. 做了什么

### 1.1 岗位派生平台角色
`src/lib/rbac/effective-platform-role.ts`：
- 纯函数 `deriveEffectivePlatformRole` + 异步 `resolveEffectivePlatformRole`；
- 旧模式企业、`super_admin` / `admin` / `trade` 原样，且不查权限键；
- 岗位模式下依次：`organization.dashboard.read` → `boss`，`sales.quote.create|pricing_close` → `sales`，`operations.read|manage` → `operations`，其余 → `user`；
- 多岗取最高一项；权限键解析失败按无键处理（→ `user`）。

### 1.2 接入点

| 入口 | 改动 |
|---|---|
| `agent-core/engine.ts` | `runAgent` / `runAgentStream` 开头 `withEffectiveRole`。工具列表过滤与工具执行上下文的 `role` 取派生角色，覆盖网页 / @提及 / 微信 / `/api/agent-core/chat`；派生幂等 |
| `/api/agent-core/tools` | 列表按派生角色（先解析默认企业） |
| `/api/ai/threads/[threadId]/messages` | 取得企业后派生 `aiRole`。路由器、`isOperatorEnabled`、`getWorkContext`、`getChatSystemPrompt`、操作员分支的 `getCapabilities` / `buildOperatorSystemPrompt` / `runAgent` / 日志都用 `aiRole`；`user.role` 只剩租户解析 |
| 线程重试、`/api/ai/chat` | 派生后传入 |
| 微信 `executeConversationRun` | 开头派生。用于域选择、营销数字员工判定、提示词、工具 |
| `agent-runtime-v2/principal.ts`、`/api/agent-supervisor/runs/**` | 派生后传入 |
| Muse | `resolveMuseBinding` 在岗位模式企业给身份派生角色 + `positionMode`；`resolveSalesScope` 在 `positionMode` 下不再因 `org_owner` / `org_admin` 给全组织（决定 B 的管理层 = 老板岗位） |
| 晨报 | `getUserDomains(userId, orgId)` 取派生角色 |
| AI 上下文 | `resolveAgentScope` 的"销售只能挂自己客户"取派生角色 |
| 营销数字员工 | `/api/marketing/employee` 先解析企业再按派生角色判定 |

`mention-gateway/policy.ts` 的工具域不看角色，角色只传给 `runAgent`，由 engine 派生覆盖，未另改。

## 2. 怎么验

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run lint:baseline` | PASS；改动文件 eslint 0 问题 |
| `npm run test:ci` | PASS（含新 `effective-platform-role.test`） |
| `bash scripts/check-test-registry.sh` | OK（455） |
| `openspec validate perm-4c4-ai-tools-by-position --strict` | valid |
| `effective-platform-role.test`（新，纯） | **63 / 63**，覆盖见下方说明 |
| `effective-platform-role-db.isolated.test`（新，本地 Postgres 16） | **17 / 17**，覆盖见下方说明 |
| 回归：test-all 中 muse-bridge / agent-core / mention-gateway / agent-runtime(-v2) / agent-supervisor / secretary / agent-scope / marketing / assistant 共 88 个文件（无 DB 跑） | 87 过；`agent-runtime/trace.test` 需 DB（`MISSING_DATABASE_URL`，环境性，与改动无关） |

`effective-platform-role.test` 覆盖：
- 规则表：9 个岗位、多岗、平台角色反例、保留角色、旧模式、`null` 键；
- 幂等；
- 工具列表等价：压扁后 `user` + `sales_rep` = 平台 `sales`，含 `sales_*` / `secretary_*` / `project_*`；平台 `sales` + `ops_staff` 不含 `sales_*`；owner = 平台 `boss`；
- Muse 范围：岗位模式 / 旧模式各 4 例；
- 13 处接入点的源码断言。

`effective-platform-role-db.isolated.test` 覆盖：
- 真实绑定下的派生：`user` + `sales_rep` → `sales`、`boss` + `ops_staff` → `operations`、owner + pricing_lead → `boss`、`org_owner` + `ops_lead` → `operations`、`trade` 原样、旧模式 `sales` 原样；
- Muse 身份：老板岗位 → 全组织；压扁销售 → 本人；`org_owner` 无老板岗位 → 拒绝；旧模式身份不变；
- 晨报：压扁销售扫销售域，`boss` + `ops_staff` 不扫；
- AI 上下文：压扁销售挂他人客户被拒、挂自己客户允许。

## 3. 判断与实施中的变更

- 方案按审核拍板：派生角色作桥，工具策略表不改；多岗取最高一项（老板兼销售 = `boss`，与今天平台 `boss` 一样不给 `sales_*` 工具）。
- task 2.3：`mention-gateway` 无须单独改，由 engine 覆盖，已回写 tasks。
- A 组未全部收口的余项归 4c5，已写入清单各条"状态"与 TASKFLOW PERM-4c5 行：
  - 中间件 `/marketing` 路由放行（读 JWT）、工作台按钮显示；
  - `dataScope` 的非 AI 读点（视觉方案、审批执行）；
  - 未经入口的开关白名单调用方。

## 4. 已知限制与上线

- **BREAKING（Sunny，合并即生效）**：AI 一侧从此看岗位。
  - 平台角色与岗位不一致的人行为会变，例如平台 `sales` 但只绑 `ops_staff` → 失去销售工具。
  - 没绑 `owner` 的 `org_owner` 在 Muse 失去全组织与金额。
- 每次 AI 运行多 1–2 次轻量查询：行业包，加上岗位模式下的有效键。
- **上线（Lucas）**：
  1. 确认 Sunny 绑定（同 4c3，`bind-positions --dry-run`）。
  2. 核对生产环境变量 `DIGITAL_EMPLOYEE_ROLE_ALLOWLIST` / `WORKFORCE_RUNTIME_ROLE_ALLOWLIST` / `AGENT_SUPERVISOR_ROLE_ALLOWLIST` / `ENABLE_GPT6_ASTRA_ROLE_ALLOWLIST` / `ASSISTANT_DURABLE_FOLLOWUP_ROLE_ALLOWLIST` / `AI_OPERATOR_ROLE_ALLOWLIST` 的值（含 `sales` 的在压扁前要复核）。
- 4c3 写库闸门仍关闭；打开前还需 4c5。

## 5. 合并后

`/opsx:archive perm-4c4-ai-tools-by-position --yes` 独立小 PR；`openspec list --specs` 应出现 `agents/position-derived-role`；TASKFLOW PERM-4c4 → `[x]`。下一个 `perm-4c5-management-reads-by-position`（先 propose）。
