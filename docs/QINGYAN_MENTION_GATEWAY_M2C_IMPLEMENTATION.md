# 青砚 Mention Gateway — M2-C：Context-specific Tool Policy + Customer Scope Guard（C1）实施报告

- 日期：2026-08-23
- 范围：**仅 M2-C**（M2 Design `docs/QINGYAN_MENTION_GATEWAY_M2_ARCHITECTURE.md` 已批准；C1 APPROVAL = YES，采用 Final Review 修正版：server-authoritative customer id + optional-arg escape 封堵 + shareToken 不暴露）。
- 未做：Prisma schema / migration / ExternalIdentity / ChannelContextBinding / Slack / 企微 / 微信切换 / PendingAction / l2_soft / 记忆写入 / 外发 / Runtime V2 / 生产变更 / M2-A / M2-B。

## 1. Base

```text
BASE_MAIN_SHA   = 29e4b2173f3bf7cc14052c1191a48cf3882d495e   (git fetch origin：origin/main 未前进，drift = 0)
M2C_RELEVANT_DRIFT = NO   (agent-core/types.ts / pre-execute-guard.ts / agent-scope / mention-gateway / sales tools / schema 均无变化)
BRANCH          = feature/qingyan-mention-gateway-m2-c-tool-policy   (从 origin/main 新建；仅 cherry-pick M2 设计文档 213bf710 → b671e465)
```

## 2. C1 — Exact Diff（已批准的 core 扩展；仅 3 个文件，全部 additive）

```diff
--- a/src/lib/agent-core/types.ts
+++ b/src/lib/agent-core/types.ts
@@ ToolExecutionContext
   scopeGuard?: {
     orgId: string;
     principalUserId: string;
     projectId?: string;
+    customerId?: string;
   };
@@ AgentRunOptions
   scopeGuard?: {
     orgId: string;
     principalUserId: string;
     projectId?: string;
+    customerId?: string;
   };

--- a/src/lib/agent-core/pre-execute-guard.ts
+++ b/src/lib/agent-core/pre-execute-guard.ts
@@ PreExecuteDenyCode
   | "SCOPE_PROJECT_OVERRIDE"
+  | "SCOPE_CUSTOMER_OVERRIDE"
   | "SCOPE_MISSING";
@@ assertArgsMatchScopeGuard（在 projectId 检查之后、return ok 之前）
+  // M2-C / C1：customerId 与 projectId 同语义（fail-closed；scope 未声明时不检查）
+  const argCustomer =
+    typeof args.customerId === "string" ? args.customerId.trim() : "";
+  if (argCustomer && scopeGuard.customerId && argCustomer !== scopeGuard.customerId) {
+    return {
+      ok: false,
+      code: "SCOPE_CUSTOMER_OVERRIDE",
+      error: "工具参数不得覆盖 ScopeContext.customerId",
+    };
+  }

--- a/src/lib/agent-scope/resolve.ts
+++ b/src/lib/agent-scope/resolve.ts
@@ toScopeGuard
   projectId?: string;
+  customerId?: string;
 } {
   return {
     orgId: scope.orgId,
     principalUserId: scope.principalUserId,
     projectId: scope.projectId,
+    customerId: scope.customerId,
   };
 }
```

语义：`scopeGuard.customerId = C1` 且 `args.customerId` 明确给出 `C2 ≠ C1` → `DENY SCOPE_CUSTOMER_OVERRIDE`（在 `canInvokeTool` / executor 之前，由 `ToolRegistry.execute` 的 `runPreExecuteGuards` 统一执行，不依赖 prompt）。`scopeGuard` 未声明 `customerId` → 不检查（Web Operator / agent-core chat / 技能 / 旧渠道路径行为不变）。既有 org / user / project 守卫顺序与行为不变（`pre-execute-guard.test.ts` 新增 5 条 C1 断言：same → PASS、未给 → PASS、different → DENY、legacy → 不变、project 守卫优先）。

`ToolRegistry` / `engine` / `tool-auth` / `approval-gate` 未改动。

## 3. Context-specific Tool Policy（`src/lib/mention-gateway/policy.ts`）

| 上下文（绑定声明 → canonical） | allowlist | domains |
|---|---|---|
| `project` / `tender` → **project** | `PROJECT_CONTEXT_TOOLS`（8）：`project_get_tender_summary, project_get_project_documents, project_get_project_requirements, project_get_project_inquiries, project_get_project_quotes, project_search_similar_projects, knowledge_search_project, org_search_knowledge` | `project, system` |
| `sales` → **customer** | `CUSTOMER_CONTEXT_TOOLS`（3，严格）：`sales_get_customer, sales_get_customer_quotes, sales_get_customer_interactions`（本轮**不含** `org_search_knowledge`，最小权限） | `sales` |
| 任何上下文 | **排除** `ORG_WIDE_SALES_TOOLS`（7）：`sales_get_pipeline, sales_get_pipeline_snapshot, sales_get_overview, sales_list_opportunities, sales_search_customers, sales_get_opportunity, sales_get_quote_summary` | — |

- `resolveMentionToolPolicy(contextType)` → `{ canonical, tools, domains }`；`toCanonicalContextType`：`tender → project`、`sales → customer`（M1 fixture / 未来 binding 的声明类型不改，不动 Schema）。
- `buildMentionRunOptions` 现在 `tools: [...policy.tools]`、`domains: [...policy.domains]`、`scopeGuard: toScopeGuard(scope)`（含 `customerId`），并增加 fail-closed 不变量：project 上下文必须有 `scope.projectId`，customer 上下文必须有 `scope.customerId`（否则抛错 → 网关 `RUN_FAILED`，不会用空 scope 运行）。
- 不因 org role 高而放宽：policy 只看 contextType；`registry.toOpenAITools` 的 allowRoles / `canInvokeTool` / 工具内 data scope 继续二次收紧（G-3 测试：平台 admin 在 customer 上下文仍只有 3 个工具）。`maxRisk` 固定 `l0_read`（`MENTION_GATEWAY_M1_MAX_RISK`，env 只能收紧）。
- 系统提示按上下文声明作用域（project：不提供销售数据；customer：只看绑定客户，客户编号由系统给定）——仅作第二层说明，执行边界在 Registry 链。
- 兼容别名：`MENTION_GATEWAY_M1_TOOL_ALLOWLIST`（@deprecated）= `MENTION_GATEWAY_TOOL_UNIVERSE`（两上下文并集 11，不会整体暴露给任何一次运行）；`MENTION_GATEWAY_M1_DOMAINS`（@deprecated）= 域并集；`MENTION_GATEWAY_M1_BLOCKED_L0_TOOLS` 新增 7 个 org-wide 工具的排除原因。
- `handle.ts` 未改（它把 `binding.contextType` 与 `resolveAgentScope` 产出的 scope 交给 `buildMentionRunOptions`）。

## 4. Customer Tool Hardening（`src/lib/agent-core/tools/sales-scope.ts` + 3 个工具）

纯函数（无 DB，便于测试）：

| 函数 | 语义 |
|---|---|
| `isCustomerScoped(ctx)` | `scopeGuard.customerId` 非空 |
| `resolveEffectiveCustomerId(ctx, argCustomerId)` | **SERVER AUTHORITATIVE**：scoped → 永远 `scopeGuard.customerId`（source=scope，忽略 args）；legacy → `args.customerId`（source=args）或 undefined |
| `customerNameLookupAllowed(ctx)` | 仅 legacy（无 customer scope）允许按名搜索并切换客户 |
| `assertOpportunityWithinCustomerScope(opportunity, ctx, effectiveCustomerId)` | `opportunity.orgId === ctx.orgId && opportunity.customerId === effectiveCustomerId`，否则 fail-closed；不存在与越界返回同一文案（不泄露存在性） |
| `redactQuoteShareTokens(quotes, ctx)` | scoped → 移除 `shareToken` 键；legacy → 原样 |

| 工具 | scoped（`scopeGuard.customerId` 存在） | legacy（无 scope） |
|---|---|---|
| `sales_get_customer`（`tools/sales-customer.ts`） | `customerId = scope`（args 不同值已由 C1 拒绝；缺省也取 scope）；其余 RBAC / 归档 / `canSeeResource(..., ctx.orgId)` 原样 | 采用 `args.customerId`；缺失 → 明确错误（原为 `String(undefined)` 查不到），其余不变 |
| `sales_get_customer_quotes`（`tools/sales-quote.ts`） | `customerId = scope`；`customerName` 不再触发搜索/切换（只是提示）；可见性校验原样；**响应 DTO 不含 `shareToken`** | `args.customerId` → 无则按 `customerName` 搜索（原逻辑保留）→ 可见性校验 → `shareToken` 保留（Sales UI / Agent 行为不变） |
| `sales_get_customer_interactions`（`tools/enterprise-readonly.ts`） | `customerId = scope`，查询恒带 `customerId + orgId`；若同时给 `opportunityId`：先 `salesOpportunity.findFirst({ id, orgId })` 并校验 `customerId === scope`，否则 fail-closed（不会返回其它客户商机的互动） | `customerId` / `opportunityId` 任一即可，查询与校验与原来一致 |

`shareToken` 行为：只在 customer scoped 路径（当前即 Mention Gateway customer 上下文）从工具返回中移除；非 scoped legacy 执行（Web Operator / agent-core chat / 技能）完全不变。

## 5. Tests

| 套件 | 结果 | 要点 |
|---|---|---|
| `src/lib/mention-gateway/__tests__/m2c-tool-policy.test.ts`（新） | **105 / 0** | C1 纯函数 + 真实 Registry 执行链（dummy l0 工具：customer B → `SCOPE_CUSTOMER_OVERRIDE`，customer A → 执行，legacy → 不变）；策略集合/canonical；网关 customer / project 上下文的 tools / scopeGuard / domains / maxRisk；admin 不放宽；攻击：customer ctx → `sales_get_customer(customer B)` / `sales_get_customer_quotes(customerId=B)` / `sales_get_customer_interactions(customerId=B)` → `SCOPE_CUSTOMER_OVERRIDE`；7 个 org-wide + 8 个 project 工具 + 写工具 → `TOOL_NOT_ALLOWLISTED`；project ctx → 3 个 customer 工具 + 7 个 org-wide → `TOOL_NOT_ALLOWLISTED`；伪造 allowlist 仍被 `canInvokeTool` 拦；加固纯函数（name 不可逃逸、opportunity 不可逃逸、shareToken 脱敏、legacy 保留）；源码契约（三个工具确实接入、legacy name 搜索路径仍在） |
| `src/lib/agent-core/__tests__/pre-execute-guard.test.ts` | 38 / 0（+5 C1） | same → PASS；未给 → PASS；different → DENY；legacy → 不变；project 守卫优先 |
| `m0-safety-gate` / `m1-gateway` / `m1-tool-policy` / `m1-static-policy` / `m1-final-review` | 95 / 70 / 124 / 207 / 72，全部 0 失败 | M1 套件改为按上下文断言（project 8；新增 customer 3 暴露面断言）；`m1-tool-policy` 并集 11 |
| `agent-scope` / `phase1-1-context-propagation` / `marketing-tools-org-isolation` | 24 / 24 / 36，0 失败 | C1 未破坏既有 scope 投影与 enterprise-readonly org 过滤契约 |

```text
PROJECT_CONTEXT_CANNOT_USE_SALES_TOOLS          = PASS
CUSTOMER_CONTEXT_CANNOT_USE_PROJECT_TOOLS       = PASS
CUSTOMER_CONTEXT_CANNOT_USE_ORG_WIDE_SALES_TOOLS = PASS
CUSTOMER_ID_CANNOT_BE_OVERRIDDEN                = PASS
CUSTOMER_NAME_CANNOT_ESCAPE_BOUND_CUSTOMER      = PASS   （纯函数 + 源码契约；DB 路径见 §7）
OPPORTUNITY_CANNOT_ESCAPE_BOUND_CUSTOMER        = PASS   （纯函数 + 源码契约）
CUSTOMER_SCOPED_QUOTES_DO_NOT_EXPOSE_SHARE_TOKEN = PASS   （纯函数 + 源码契约）
MAX_RISK_STILL_L0                               = PASS
TOOL_REGISTRY_CHAIN_STILL_USED                  = PASS
```

## 6. Legacy Compatibility

- `scopeGuard.customerId` 为可选 additive；只有 Mention Gateway customer 上下文（经 `toScopeGuard`）会设置它。Web Operator（`messages/route.ts`）、`api/agent-core/chat`、技能运行时、旧渠道路径都不传 → 守卫不检查、三个工具走原路径。
- `sales_get_customer_quotes` 的按名搜索、`shareToken` 返回、`sales_get_customer_interactions` 的 opportunity-only 查询在 legacy 下逐行保持；唯一可见差异：`sales_get_customer` 缺 `customerId` 时返回明确错误（原来是查不到 → "客户不存在"），均为失败路径。
- `MENTION_GATEWAY_M1_TOOL_ALLOWLIST` / `MENTION_GATEWAY_M1_DOMAINS` 名称保留（@deprecated），语义改为并集。

## 7. Known Limitations

1. scoped 路径的 DB 行为（name 不逃逸 / opportunity 校验 / shareToken 脱敏）在 CI 以纯函数 + 源码契约锁定；真实 DB 端到端留待 M2-D 隔离库门（`NODE_ENV=test` + isolated Neon）。
2. legacy `sales_get_customer_interactions` 仅给 `opportunityId` 时不按客户约束（原行为，非 Mention 路径）。
3. legacy `sales_get_customer_quotes` 按名搜索先查后判存在性（设计报告 R5，P2）未改——scoped 路径已不再按名查。
4. customer 上下文暂无知识检索工具（有意最小权限）。
5. `contextType` 仍是 M1 声明类型（project / tender / sales）；canonical 映射在 policy 层，Schema 留待 M2-B。

## 8. Regression（本机 2026-08-23）

```text
typecheck      = PASS（tsc --noEmit 0 error；需先 prisma generate 刷新本 worktree 客户端）
lint:baseline  = PASS（41 error vs 基线 53；无新增 fingerprint；eslint 对改动文件 0 问题）
M2-C tests     = 105 / 0
mention suites = 95 / 70 / 124 / 207 / 72 / 105（6 套件 673 断言）
test:ci        = PASS（21/21，含 6 个 mention 套件）
test-all       = 305/317；12 个失败全部为 MISSING_DATABASE_URL ×11 + Gmail draft env ×1（与 M1 以来每轮相同的环境性套件；本分支未触碰其依赖模块）
build          = PASS（npm run build exit 0：prisma generate → 两个预构建门在本地 skip → next build "✓ Compiled successfully in 66s"，ƒ /api/mention-gateway/mock 已生成）
```

## 9. 对 M2-A / M2-B 的新增前置条件（已写入 M2 Architecture 报告）

```text
PROVIDER_TENANT_OWNERSHIP_GATE_REQUIRED = YES
```

在 `ExternalIdentity` 置 `ACTIVE` 或 `ChannelContextBinding` 置 `ACTIVE` 之前，必须证明 `providerTenantId` 属于目标 org 的**可信 installation / gateway**（今天：`WeChatGateway(orgId, channel).corpId` / 平台网关；M3：`ChannelProviderInstallation`）。未证明 → 只能 `PENDING`，不得参与 Mention 解析。

## 10. Files

```text
MODIFIED (core, approved C1)
  src/lib/agent-core/types.ts
  src/lib/agent-core/pre-execute-guard.ts
  src/lib/agent-scope/resolve.ts
MODIFIED (tools hardening)
  src/lib/agent-core/tools/sales-customer.ts
  src/lib/agent-core/tools/sales-quote.ts
  src/lib/agent-core/tools/enterprise-readonly.ts
ADDED
  src/lib/agent-core/tools/sales-scope.ts
  src/lib/mention-gateway/__tests__/m2c-tool-policy.test.ts
  docs/QINGYAN_MENTION_GATEWAY_M2C_IMPLEMENTATION.md
MODIFIED (mention gateway)
  src/lib/mention-gateway/policy.ts, types.ts, index.ts
  src/lib/mention-gateway/__tests__/{m1-gateway,m1-tool-policy,m1-static-policy}.test.ts
MODIFIED (tests / scripts / docs)
  src/lib/agent-core/__tests__/pre-execute-guard.test.ts
  scripts/test-all.sh, scripts/test-ci-unit.sh
  docs/QINGYAN_MENTION_GATEWAY_M2_ARCHITECTURE.md（C1 = APPROVED；PROVIDER_TENANT_OWNERSHIP_GATE_REQUIRED）
```
