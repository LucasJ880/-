# 青砚 Mention Gateway — M2 Persistent Identity & Context Binding：Architecture + Schema Design Gate

- 日期：2026-08-23
- 性质：**Architecture + Schema Design + Security Gate（docs only）**。本轮未修改任何业务代码、未修改 `prisma/schema.prisma`、未创建 migration、未触碰生产。
- 前置：M0 / M1 已合并（PR #154，APPROVED_HEAD `3f2fd7a0`，MERGE_SHA `4f7294fd`）；M1 验证链：Mock Mention → fixture identity → 真实 membership → fixture ChannelContextBinding → `resolveAgentScope` → `agent-core runAgent` → ToolRegistry → `l0_read` → `initiating_user_only`；B1（principal 作用域幂等）/ B2（投递先于终态）已关闭。
- 本轮回答的问题：**如何把 M1 的 fixture identity / fixture channel binding 安全地变成真正的多租户持久化基础设施**，并为其冻结 identity / binding 生命周期、proof-of-possession、租户隔离、IDOR 防御、审计、幂等与 context-specific tool policy。

```text
KNOWN_M1_MERGE_SHA      = 4f7294fd9ac84f43d02c911a1d2bffdc0b3b117b   (Merge PR #154, 在 origin/main 祖先链上)
CURRENT_ORIGIN_MAIN_SHA = 29e4b2173f3bf7cc14052c1191a48cf3882d495e   (git fetch origin @ 2026-08-23)
MAIN_DRIFT_SINCE_M1     = 5 提交（PR #153 autopilot A2-P2.2 grounded semantic judge；20 文件 +4669/-29）
M2_RELEVANT_MAIN_DRIFT  = NO
  git diff --stat 4f7294fd..29e4b217 -- src/lib/mention-gateway src/app/api/mention-gateway src/lib/messaging
    src/app/api/messaging src/lib/auth src/lib/authorization src/lib/rbac src/lib/organizations
    src/lib/agent-scope src/lib/tenancy src/lib/agent-core/tools/_policy.ts src/lib/agent-core/tool-registry.ts
    prisma/schema.prisma  → 空
M2_BASE_MAIN_SHA        = 29e4b2173f3bf7cc14052c1191a48cf3882d495e
M2_BRANCH               = feature/qingyan-mention-gateway-m2   (从 origin/main 新建；docs only)
WORKTREE_CLEAN          = YES
```

---

## 1. Executive Summary

| 结论 | 值 |
|---|---|
| 现有身份模型可复用？ | **PARTIAL** — `WeChatBinding` 是 `(channel, externalId) → userId` 的自报绑定，耦合推送偏好、无 provider 租户边界、无 proof-of-possession、`upsert` 可改写他人 `userId`；只能作为**概念与回填来源**，不能作为 canonical 表 |
| 现有绑定模型可复用？ | **NO** — 仓库没有「外部频道 → 业务对象」绑定；`ExternalReference` 是 `(system, externalId) → Project 1:1`、无 `orgId`、带出站 webhook 副作用；`AgentSession.currentProjectId` 是按用户的会话态，不是频道真相 |
| Provider installation？ | **PARTIAL** — `WeChatGateway`（`@@unique([orgId, channel])`）承担企微/iLink 的安装 + 凭证，但 secret **明文**存储、无通用 provider 抽象；M2 仅在绑定/身份上携带 `providerTenantId`，`ChannelProviderInstallation` 留到 M3 首个真实 adapter |
| 需要新表？ | **YES ×2**：`ExternalIdentity`（→ User，不带 orgId）、`ChannelContextBinding`（→ Organization + Project/SalesCustomer 真实 FK）。`InboundChannelEvent` M2 不需要（M3 首个真实 adapter 时需要） |
| Proof of possession | M2 = `ADMIN_PROVISIONED`（平台管理员 / 目标用户所属 org 的 org_admin），自助 link 只产生 `PENDING`；`PROVIDER_CHALLENGE / PROVIDER_OAUTH / PROVIDER_SIGNED_EVENT` 预留 M3 |
| 绑定目标 | **方案 B**：`projectId? / customerId?` 真实 FK + XOR 不变量；`contextType` 冗余派生（`project | customer`），`contextRole = tender` 作为标签（tender 即 Project，不另建 tenderId） |
| Tool policy | **代码定义**（`policy.ts` 按 contextType 派生 allowlist，仍经 Registry 链）；不建 DB 表。project 上下文 8 个；customer 上下文 3 个 customer-bound；7 个 org-wide sales 工具排除 |
| AgentRun 幂等唯一约束 | **NO**（`userMessageId` 可空、重试路径 `skipUserMessageIdempotency` 刻意复用同值；STRONG 去重应落在 M3 的 `InboundChannelEvent`） |
| 迁移 | 2 个 additive migration（M2-1 identity / M2-2 binding）+ 1 个幂等回填脚本（`WeChatBinding → ExternalIdentity`）；零停机、可回滚 |
| 拆分 | **3 个 PR**：M2-C（policy，零 schema，先行）→ M2-A（identity）→ M2-B（binding）；M2-D E2E 安全门并入 A/B 并在 B 末尾跑一次隔离库全量 |
| 状态 | **READY_FOR_M2_IMPLEMENTATION** → M2-C 已实施（PR #156，merged）；**M2-A 已实施（见 §29 as-built 与 `docs/QINGYAN_MENTION_GATEWAY_M2A_IMPLEMENTATION.md`）**；M2-B 未开始 |

---

## 2. Existing Identity / Binding Inventory

| 模型 / 代码 | 位置 | 语义 | 对 M2 的价值 |
|---|---|---|---|
| `WeChatBinding` | `prisma/schema.prisma:4656-4692`（`@@unique([channel, externalId])`，`orgId String?`，push 偏好 `pushBriefing/pushFollowup/pushReport/pushSales/pushDomains/silent*`，`filterMode/filterKeyword`） | 企微 / 个微外部账号 → 用户；自报；`orgId` 是缓存 | **回填来源**；推送偏好保留在此表（身份与偏好解耦） |
| `messaging/binding.ts` | `createBinding` `:11-60`（`upsert … update: { userId: params.userId }`）、`resolveBindingOrgId` `:118-143` | 创建即覆盖；`binding.orgId` 命中即信任 | 反例：M2 禁止 upsert-takeover，禁止缓存 org 当真相 |
| `api/messaging/bindings/route.ts` | `:18-63`（`update_preferences/remove` 仅凭 `bindingId`，无归属校验；创建时 membership 回退查询无 `status` 过滤 `:42-46`） | 用户自助绑定 API | 反例：IDOR；M2 所有按 id 操作必须 `findFirst({ id, orgId })` 或 owner 校验 |
| `User.wechatOpenId @unique` | `schema.prisma:150`；`api/auth/wechat/callback` | 微信开放平台**登录**凭证 | 不是消息身份；不扩展 User 列（方案 A 否决） |
| `EmailBinding` | `schema.prisma:173-196`（`smtpPass` 经 `encryptField`） | 每用户 SMTP 发信配置 | 非身份；证明 `crypto.ts` 加密模式 |
| `EmailProvider` / `CalendarProvider` | `schema.prisma:2874-2891` / `717-733`；`google-email.ts:243-244`、`google-calendar.ts:57-60` 用 `encryptField` | 每用户 Google OAuth token | **Secret 存储模式复用来源** |
| `WeChatGateway` | `schema.prisma:4695-4727`（`@@unique([orgId, channel])`，`corpId/agentId/secret/callbackToken/encodingKey`，`mode/fulfillmentOrgId`）；配置写入 `api/messaging/gateway/route.ts:120-134`（**明文**） | 企微 / iLink 安装 + 凭证（org 级或 `PLATFORM_WECOM_ORG_ID`） | Provider installation 的现有雏形；secret 明文 = P1 |
| `ExternalReference` | `schema.prisma:1657-1668`（`projectId @unique`，`@@unique([system, externalId])`，无 orgId）；`webhook/dispatcher.ts:100` | 外部 PM 系统 ↔ 项目 1:1 + 出站 webhook | 不可复用为频道绑定（1:1、无 org、副作用） |
| `ApiToken` | `schema.prisma:1873-1887`（无 orgId/userId） | 系统级 API token | 不可作为外部身份/租户凭证 |
| `OrganizationMember` | `schema.prisma:869-884`（`@@unique([orgId, userId])`，`role/status`） | **唯一的组织权限真相** | M2 每次 Mention 必查 |
| `ProjectMember` / `PROJECT_ROLES` | `schema.prisma:963`；`rbac/roles.ts:48-66`（`project_admin/operator/accounting/tester/viewer`） | 项目级角色 | 绑定权限来源 |
| `resolveAgentTenant` / `resolveAgentScope` | `tenancy/resolve-agent-tenant.ts:31-79`；`agent-scope/resolve.ts:112-254` | 租户字段 / 业务对象归属（fail-closed） | M2 resolver 不变，只换数据源 |
| M1 fixture | `src/lib/mention-gateway/fixtures.ts`（`MentionFixtureStore`：identity 只返回 `userId`；binding 只是声明） | 内存 / env JSON | M2 用同一 `IdentityDeps.lookupExternalIdentity` / `ContextDeps.lookupChannelBinding` 接口换成 DB 实现，`handle.ts` 主链不变 |

```text
CAN_REUSE_EXISTING_IDENTITY_MODEL = PARTIAL
CAN_REUSE_EXISTING_BINDING_MODEL  = NO
```

---

## 3. Current Risks（本轮重点审计前三项 + 附带发现）

| # | 风险 | 证据 | M2 处置 |
|---|---|---|---|
| R1 | **绑定接管 / 无占有证明**：任何登录用户可 `POST {channel, externalId}` 把任意外部 id 绑到自己；`upsert` 直接改写既有绑定的 `userId`；受害者的「1/2/3」会批准攻击者草稿（`wechat-confirm.ts:39-44` 以 `createdById=binding.userId` 取批） | `binding.ts:28-57`；`bindings/route.ts:48-62` | `ExternalIdentity` 唯一键 + 显式 `link / verify / revoke / relink`，无 upsert；自助 link → `PENDING`；`ACTIVE` 只能由 `ADMIN_PROVISIONED`（M2）或 provider 证明（M3）产生；`relink` 需管理员 + 审计 |
| R2 | **`binding.orgId` 不复验 membership**：命中即用；被移出组织仍路由到该 org；创建时 membership 回退查询无 `status` 过滤 | `binding.ts:122-124`；`bindings/route.ts:42-46` | `ExternalIdentity` **不带 orgId**；org 每次 Mention 从 `OrganizationMember(status=active)` + `resolveAgentTenant` 推导（M1 已这样做：`identity.ts pickMembershipOrg`） |
| R3 | **Bindings API IDOR**：`update_preferences / remove` 只凭 `bindingId` | `bindings/route.ts:22-34`；`binding.ts:80-105` | M2 API 所有按 id 操作：identity → `findFirst({ id, userId: caller })` 或管理员 + 共同 org 校验；binding → `findFirst({ id, orgId: tenant.orgId })` → 不存在一律 404 |
| R4 | `WeChatGateway.secret/encodingKey/callbackToken` 明文（注释写「加密存储」但路由直接写入） | `api/messaging/gateway/route.ts:120-134`；`adapters/wecom.ts:72-80,102-112` | 不在 M2 范围（DO NOT TOUCH 生产企微链路）；登记为 M3 `ChannelProviderInstallation` 必须改用 `encryptField` |
| R5 | `sales_get_customer_quotes` 按客户名 `contains` 无 org 过滤先查后判（存在性 oracle） | `tools/sales-quote.ts:237-241` → `canSeeResource(..., ctx.orgId)` `:262-267` 最终拒绝 | 跨 org 数据不泄露（拒绝生效），但「未找到」与「无权访问」文案可区分 → P2，M2-C 的 customer-bound 策略以 `customerId` 约束参数后不再按名查 |
| R6 | `AgentRun(orgId, userMessageId)` 仅索引非唯一；重试路径刻意复用同值 | `schema.prisma:4825,4865`；`assistant/dispatch.ts:287` `skipUserMessageIdempotency: !!input.retryContext` | 不加唯一约束（§17） |
| R7 | M1 的 18 工具对所有上下文一视同仁（project 上下文可调 `sales_get_pipeline`） | `mention-gateway/policy.ts MENTION_GATEWAY_M1_TOOL_ALLOWLIST` | M2-C context-specific policy（§15） |

---

## 4. Target Architecture

```text
                      ┌────────────────────────────────────────────────────────────────┐
 signed provider      │ Provider Installation（M3：ChannelProviderInstallation；M2：无表，│
 event（M3）          │ 由 providerTenantId 字段 + WeChatGateway 既有语义占位）            │
   │                  └────────────┬───────────────────────────────────────────────────┘
   ▼                               │ providerTenantId → 允许的 Organization（M3 校验点）
 adapter.verifyAndParse            ▼
   │      ┌──────────────── ExternalIdentity（M2-A）────────────────┐
   ├─────▶│ (provider, providerTenantId, providerUserId) → userId    │   ← 不带 orgId，不授予权限
   │      │ status ACTIVE + verificationMethod                       │
   │      └───────────────┬──────────────────────────────────────────┘
   │                      ▼
   │            User(status=active) → OrganizationMember(status=active, org 未归档)
   │                      ▼
   │            pickMembershipOrg(activeOrgId ∈ memberships | 唯一 membership)   ← M1 identity.ts 不变
   │                      ▼
   │            resolveAgentTenant(user, orgId)  → orgRole / hasMembership / toolPolicy / modules
   │                      ▼
   │      ┌──────────── ChannelContextBinding（M2-B）─────────────────┐
   └─────▶│ (provider, providerTenantId, providerChannelId, threadId)  │
          │ → orgId（由目标对象派生）+ projectId | customerId          │
          │ 线程级 ACTIVE 优先 → 频道级 ACTIVE → 无 → CONTEXT_UNRESOLVED│
          └───────────────┬──────────────────────────────────────────┘
                          ▼
            binding.orgId === tenant.orgId ?  否 → CHANNEL_ORG_MISMATCH（M1 context.ts 不变）
                          ▼
            resolveAgentScope({ projectId | customerId })  → 对象归属 + 访问权（fail-closed，404 不泄露）
                          ▼
            Context-specific Tool Policy（M2-C）：contextType → allowlist；scopeGuard{orgId, principalUserId, projectId | customerId}
                          ▼
            agent-core runAgent → ToolRegistry 链（allowlist → canInvokeTool → maxRisk=l0_read → approval-gate）
                          ▼
            agent.output → deliver(initiating_user_only) → response.completed → completeRun（B2 顺序不变）
```

安全不变量：**`EXTERNAL_IDENTITY_DOES_NOT_GRANT_ORG_ACCESS`** —— identity 只回答「外部账号是谁」；org 来自 membership；业务对象来自显式绑定；访问权来自 `resolveAgentScope` + Registry 链。membership 被移除 → 即使 identity `ACTIVE`、binding `ACTIVE`，在 `pickMembershipOrg` 即拒（`IDENTITY_OR_MEMBERSHIP_DENIED`）。

**M1 → M2 接线方式**：`handle.ts` 的依赖面不变——`IdentityDeps.lookupExternalIdentity(provider, providerUserId)` 与 `ContextDeps.lookupChannelBinding(provider, channelId, threadId?)` 的默认实现从 `MentionFixtureStore` 换成 DB service（`identity-service.ts` / `binding-service.ts`），并把 `providerTenantId` 加入两个查找签名（`MentionEvent` 新增 `providerTenantId`，mock adapter 固定 `"mock"`）。其余步骤（dedupe 键、session 键、AgentRun、事件、终态顺序）不变。

---

## 5. ExternalIdentity Design

### 5.1 逐项决策

| 问题 | 决策 | 依据 |
|---|---|---|
| A. Identity 是否带 orgId？ | **NO** | `User.activeOrgId`、`orgAccessMode=MULTI_ORG`、`canSelfSwitchOrg`（`schema:48-54`）说明同一用户可属多 org；org 真相只能是 `OrganizationMember`；M1 `pickMembershipOrg` 已按此实现 |
| B. 唯一键 | `@@unique([provider, providerTenantId, providerUserId])`，三列均 **NOT NULL** | Slack `U1@T1` 与 `U1@T2` 不冲突；Postgres 对 NULL 视为互不相等，可空列会让唯一键失效，故无租户概念的 provider 用固定哨兵（mock=`"mock"`；iLink 个微=该 org 的 `WeChatGateway.id`） |
| C. 一个外部身份 → 几个用户？ | **最多一个**（唯一键保证），且同一行只有一个 `userId`；更换用户 = 显式 `relink`（管理员 + 审计 before/after），不是新建行 | 「one external identity → max one active Qingyan user」 |
| D. 一个用户 → 几个外部身份？ | 允许多条（不同 provider / 租户 / 账号）；同一 `(provider, providerTenantId)` 下允许多个 `providerUserId` 指向同一用户（例如换号），由管理员裁决 | 不引入第二唯一键，避免换号时死锁 |
| E. 数据最小化 | 只存 provider 三元组、`userId`、状态、验证元数据、时间戳、操作人；**不存** profile / avatar / title / email / 消息正文 | §29 要求；显示名由 adapter 实时取或不取 |
| F. Secrets | **不存任何 token**；provider 凭证留在 `WeChatGateway`（M3 → `ChannelProviderInstallation` + `encryptField`）、用户 OAuth 留在 `EmailProvider/CalendarProvider` | `SECRET_STORAGE_REUSE = src/lib/crypto.ts encryptField/decryptField` |

### 5.2 Resolver 契约（M2-A 替换 fixture）

```ts
// identity-service.ts（M2-A，设计）
lookupExternalIdentity(provider, providerTenantId, providerUserId)
  → db.externalIdentity.findUnique({ where: { provider_providerTenantId_providerUserId } })
  → null | { userId, status, verificationMethod }
// identity.ts（M1 不变 + 两条新规则）
  status !== "ACTIVE"                                  → IDENTITY_OR_MEMBERSHIP_DENIED (reason: identity_not_active)
  requireVerified && verificationMethod === "LEGACY_SELF_ASSERTED" → DENY (reason: identity_unverified)   // flag 控制（§9）
  user.status !== "active"                             → DENY（已有）
  memberships 为空 / 歧义                               → DENY（已有）
  resolveAgentTenant.hasMembership !== true            → DENY（已有）
```

---

## 6. Provider Installation Relationship

| 项 | 结论 |
|---|---|
| 现状 | `WeChatGateway` = 企微（org 级 / 平台级 `PLATFORM_WECOM_ORG_ID`）与 iLink 个微的安装+凭证，字段企微专用；`TradeChannel`（config Json）、`MarketingChannelAccount` 为营销/外贸账号，非消息安装 |
| 理想结构（§24）是否适合本仓库 | **适合，分两步**：M2 在 `ExternalIdentity` / `ChannelContextBinding` 上**先携带 `providerTenantId`**（唯一键的一部分）；M3 首个真实 adapter 时新增 `ChannelProviderInstallation { provider, providerTenantId @@unique, orgId?, credentialsRef(加密), status, installedById, installedAt, uninstalledAt }` 并在 resolver 增加「binding.orgId 必须是 installation 允许的 org」校验；企微可由 `WeChatGateway` 投影/迁移 |
| 为什么 M2 不建 installation 表 | 本轮无真实 provider；mock 没有安装概念；先建会产生无消费者的 schema；但字段边界（`providerTenantId`）必须现在定死，避免 M3 重建唯一键 |
| Mention 解析顺序（M3 完整版） | `signed event → installation(providerTenantId) resolves allowed org(s) → ExternalIdentity resolves user → user membership ∈ allowed org → ChannelContextBinding resolves business object (binding.orgId ∈ allowed org) → resolveAgentScope`；M2 版本省略 installation 一步，其余一致 |

`PROVIDER_INSTALLATION_MODEL = PARTIAL（WeChatGateway，企微专用、secret 明文）→ M3 新建通用表`。

---

## 7. ChannelContextBinding Design

### 7.1 目标（方案 B，真实 FK）

| 方案 | 评估 |
|---|---|
| A `contextType + contextId` | 灵活但无 FK、无级联、跨表 org 校验全靠代码；M1 fixture 即此形态 |
| **B `projectId? / customerId?`** | **采用**。当前只有两类目标（Project、SalesCustomer；tender = Project），真实 FK + 级联 + 可索引；XOR 由 service 强制 + migration 内 DB `CHECK`（Prisma 不建模 CHECK 但会保留） |
| C 独立 BindingTarget | 过度设计（目标类型 ≤ 2，且没有跨类型共享属性） |

`contextType String` 冗余存储（`"project" | "customer"`，由 FK 派生，service 写入，便于索引与策略分派）；`contextRole String?`（`project → "tender" | null`；由 `Project.workDomain === "tender"`/`tenderStatus` 派生，不接受任意值）。**不新增 `tenderId`**。

### 7.2 组织不变量（§13）

```text
create / rebind:
  load target（project: db.project.findUnique({id}) → 要求 orgId !== null（个人项目拒绝）；customer: db.salesCustomer.findUnique）
  → orgId := target.orgId            ← 从对象派生，绝不接受 body.orgId
  → tenant.orgId === target.orgId ?  否 → 404（不泄露存在性）
  → caller 对 target 有绑定权限（§11）
  → write binding { orgId: target.orgId, projectId | customerId }
resolve（每次 Mention）:
  binding.orgId === tenant.orgId（M1 verifyBindingOrganization）
  → resolveAgentScope({ projectId | customerId }) 再次校验对象 orgId + 用户访问权
```

DB 层：`CHECK (num_nonnulls("projectId","customerId") = 1)`、`CHECK ("contextType" IN ('project','customer'))`；跨表 `orgId` 相等无法用 FK 表达 → service 唯一写入口 + 测试 + （可选）每日一致性巡检查询。

---

## 8. Binding Precedence

```text
lookup(provider, providerTenantId, providerChannelId, providerThreadId?)：
  1. providerThreadId 非空 → findUnique(…, providerThreadId) 且 status=ACTIVE → 命中返回
  2. findUnique(…, providerThreadId="")（频道级）且 status=ACTIVE → 命中返回
  3. 无 → CONTEXT_UNRESOLVED（不进入 Runtime；不由模型猜）
DISABLED / REVOKED 视同不存在（不 fallback 到旧目标）。
```

`THREAD_PRECEDENCE = exact thread (ACTIVE) > channel (ACTIVE) > CONTEXT_UNRESOLVED`。M1 `MentionFixtureStore.lookupBinding` 已是此顺序；M2 只换存储并加 `status` 过滤。

---

## 9. Identity Lifecycle

```text
            link(self)                    verify(admin | provider proof)
  (none) ─────────────▶ PENDING ───────────────────────────▶ ACTIVE
            link(admin-provisioned) ───────────────────────▶ ACTIVE
  ACTIVE ──disable(admin / 自动：user.status≠active)──▶ DISABLED ──enable(admin)──▶ ACTIVE
  ACTIVE | DISABLED | PENDING ──revoke(owner 自助 | admin)──▶ REVOKED（终态；同键再次 link = relink，需管理员）
```

| 事件 | 处理 |
|---|---|
| 外部账号解绑（用户自助 / 管理员） | `revoke` → `REVOKED` + `revokedAt/revokedById/revokeReason` + AuditLog；不物理删除 |
| Qingyan User 被 disabled | resolver 已按 `user.status !== "active"` 拒（不依赖同步）；可选后台任务把其 identity 置 `DISABLED`（观测用） |
| OrganizationMember 被移除 | identity **不变**（它不属于 org）；每次 Mention 的 membership 查询直接 DENY（`REMOVED_MEMBERSHIP_FAILS_CLOSED`） |
| Identity 自动失效？ | 不自动过期；`lastSeenAt` 供清理策略；`LEGACY_SELF_ASSERTED` 可按 org flag 要求重新验证 |
| Provider workspace 卸载 | M3：installation `uninstalledAt` → 该 `providerTenantId` 下 binding 置 `DISABLED`；identity 保留（用户可能重装） |
| 一个外部 identity → 多个用户 | 禁止（唯一键）；更换 = `relink`（管理员、审计、旧用户的 `lastSeenAt` 冻结） |
| User 硬删除 | `onDelete: Cascade`（与 `users/service.ts:174` 删除 `weChatBinding` 的现有语义一致） |

`IDENTITY_LIFECYCLE = PENDING → ACTIVE ⇄ DISABLED → REVOKED（terminal）`。

---

## 10. Binding Lifecycle

```text
  create(permission on target) ──▶ ACTIVE
  ACTIVE ──disable──▶ DISABLED ──enable──▶ ACTIVE
  ACTIVE | DISABLED ──revoke(reason)──▶ REVOKED（终态）
  rebind(old target → new target)：同一行，显式操作；要求 caller 对旧目标与新目标都有权限；AuditLog beforeData/afterData 记录 old→new
```

- 不物理删除；目标对象被删除时 FK `Cascade` 删除绑定，但 AuditLog 保留完整历史（谁绑定、何时、改过什么、之前绑定什么、为何撤销）。
- 同一 `(provider, providerTenantId, providerChannelId, providerThreadId)` 只有一行（唯一键），因此「duplicate active binding」在 DB 层不可能；REVOKED 后要重新绑定 = `rebind`（而非 insert），避免唯一键冲突与历史分叉。

`BINDING_LIFECYCLE = ACTIVE ⇄ DISABLED → REVOKED（terminal）；rebind 显式、同行、审计`。

---

## 11. RBAC / Permissions

现有两套权限面：legacy `PERMISSIONS` 枚举 + `requireOrgRole / requireProjectRole / requireOrgPermission`（`rbac/permissions.ts:13-70`，`auth/guards.ts:134-290`，被绝大多数路由使用）与 Security-1 `PERMISSION_REGISTRY` + `authorize()`（`authorization/permissions.ts:28-`，目前仅 3 条 sales 路由）。M2 **不新增角色名、不新增第三套**；按目标对象选用已有守卫：

| 操作 | 守卫（legacy，M2 实际使用） | Security-1 语义等价键 | 说明 |
|---|---|---|---|
| Identity 自助 link（→ PENDING） | `withAuth`（本人） | — | 只能为**自己**创建；不产生 ACTIVE |
| Identity 管理员 provision / verify / relink / disable | 平台管理员（`isPlatformAdmin`）或目标用户所在 org 的 `requireOrgPermission(orgId, PERMISSIONS.ORG_MEMBER_ROLE_CHANGE)`（= org_owner/org_admin），且目标用户在该 org 有 active membership | `identity.member.manage`（ORG, HIGH） | 管理员只能为「自己能管理的成员」提供身份 |
| Identity revoke | 本人（owner）或上述管理员 | — | 自助解绑允许 |
| Binding create（project 目标） | `requireProjectRole(projectId, "project_admin")`（org_admin/org_owner 自动满足，`guards.ts:193-194`） | `operations.projects.manage` / `project.update` | 普通 `operator/viewer` 不可绑定 |
| Binding create（customer 目标） | `authorize(user, "sales.customer.update", { orgId, resource: customer })`（PRINCIPAL / ASSIGNED / ORG 范围，已被 `api/sales/customers/[id]` 使用） | `sales.customer.update` | 销售只能绑定自己可更新的客户；org_admin 全 org |
| Binding rebind | 旧目标 **和** 新目标都满足 create 权限 | 同上 | 防止用低权目标换高权目标 |
| Binding revoke / disable / enable | 当前目标的 create 权限，或 `requireOrgRole(orgId, "org_admin")` | 同上 | — |
| Binding list / get | 活跃 org 成员（`requireTenantContext`），返回仅限 `tenant.orgId`；按目标对象再以 `project.read` / `sales.customer.read` 语义过滤（项目：`requireProjectAccess`；客户：`canSeeResource`） | `project.read` / `sales.customer.read` | IDOR：跨 org 一律 404 |

```text
BINDING_CREATE_PERMISSION = project → requireProjectRole(project_admin) [≡ operations.projects.manage]；customer → authorize(sales.customer.update)
BINDING_UPDATE_PERMISSION = rebind → create 权限 on OLD ∧ NEW target；status/contextRole → create 权限 on current target
BINDING_REVOKE_PERMISSION = create 权限 on current target ∨ requireOrgRole(org_admin)
IDENTITY_PROVISION_PERMISSION = isPlatformAdmin ∨ requireOrgPermission(PERMISSIONS.ORG_MEMBER_ROLE_CHANGE) on an org where target user is active member [≡ identity.member.manage]
```

AI 永远不能创建/修改绑定（§34）：service 写入口要求 `actor.type === "USER"` 且来自已认证 HTTP 会话；`handle.ts` 只调用只读查找。

---

## 12. Proof-of-Possession

| 方法 | 产生状态 | M2 | 谁可执行 | 说明 |
|---|---|---|---|---|
| `ADMIN_PROVISIONED` | ACTIVE | **实现** | §11 identity 管理员 | 管理员在设置页为成员录入 provider 三元组；写 `verifiedById/verifiedAt` |
| self link | PENDING | **DEFERRED → M3（A1 修正）** | — | 设计稿原计划 M2 实现；Final Security Review 裁定：没有 proof-of-possession 前，自助 link 会造成 identity-key squatting / DoS（PENDING 行占用唯一键，可抢注他人外部身份、阻塞管理员 provision）。M2-A **未实现** `POST /identities/link`；M3 与 PROVIDER_CHALLENGE/OAUTH/SIGNED_EVENT 一起交付 |
| `PROVIDER_CHALLENGE` | ACTIVE | M3 | 系统 | 通过渠道向该外部账号下发一次性码，用户在青砚输入（或反向） |
| `PROVIDER_OAUTH` | ACTIVE | M3 | 系统 | "Sign in with Slack" 回调带 team_id+user_id |
| `PROVIDER_SIGNED_EVENT` | ACTIVE | M3 | 系统 | 已验签事件中的 user id 与 PENDING 申请匹配（如 `/link <code>` 命令） |
| `LEGACY_SELF_ASSERTED` | ACTIVE（回填） | 回填 | 迁移脚本 | 来自 `WeChatBinding`；可被 org flag `MENTION_GATEWAY_REQUIRE_VERIFIED_IDENTITY=1` 排除 |

`PROVIDER_USER_CANNOT_SELF_CLAIM_OTHER_USER`：自助 link 的 `userId` 固定为会话用户且只能到 PENDING；管理员 provision 受 §11 限制；`relink` 只能由管理员执行并审计。

---

## 13. Tenant Isolation

| 不变量 | 执行点 |
|---|---|
| identity 无 orgId | schema（无列）+ resolver 只从 membership 取 org |
| provider 租户边界 | `providerTenantId` NOT NULL 且在两张表的唯一键中；adapter 负责 `team_id / CorpID / gateway.id / "mock"` → `providerTenantId` 映射；resolver 签名携带之 |
| binding.orgId 派生 | service 从目标对象派生；API body 的 `orgId` 忽略（存在即 400） |
| binding.orgId === target.orgId | service 创建/重绑时断言；resolve 时 `resolveAgentScope` 再查对象 orgId |
| tenant.orgId === binding.orgId | M1 `verifyBindingOrganization` 不变 |
| 个人项目（`Project.orgId = null`）不可绑定 | service 拒绝（没有组织边界可校验） |
| 读取跨 org | 所有 `findFirst({ id, orgId: tenant.orgId })` → 404 |
| membership 移除 | 每次 Mention 重新查 `OrganizationMember(status=active)`；不缓存 |

---

## 14. IDOR Defense

| 攻击 | 防御（位置） | 期望结果 |
|---|---|---|
| 1 `GET /bindings/:id`（他 org 的 id） | `db.channelContextBinding.findFirst({ id, orgId: tenant.orgId })` | 404（不区分不存在/无权） |
| 2 Org A 用户创建 `projectId` 属 Org B | service：`project.orgId !== tenant.orgId` → 404；`resolveAgentScope` 二次 | 404 |
| 3 body 携带 `orgId` | DTO 校验：`orgId` 不在 schema 内 → 400 `INVALID_BODY`；orgId 从对象派生 | 400 / 忽略 |
| 4 知道 channelId 覆盖既有 binding | `create` 对已存在键返回 409 `BINDING_EXISTS`（不 upsert）；`rebind` 需旧+新目标权限 + 审计 | 409 / 403 |
| 5 外部用户 A 绑成 Qingyan User B | 自助 link 的 `userId = session.user.id` 且 PENDING；provision 需管理员且 B 必须是管理员可管理的成员；`relink` 管理员 + 审计 | 403 / PENDING |
| 6（附加）identity `GET /identities/:id` 他人 | `findFirst({ id, userId: caller })`，管理员经共同 org 校验 | 404 |

---

## 15. Context-specific Tool Policy（M2-C，代码定义，零 schema）

```text
contextType + scope + role  →  tool allowlist
```

| 上下文 | 默认暴露（`MENTION_TOOL_POLICY[contextType]`） | 说明 |
|---|---|---|
| `project`（含 `contextRole=tender`） | `project_get_tender_summary, project_get_project_documents, project_get_project_requirements, project_get_project_inquiries, project_get_project_quotes, project_search_similar_projects, knowledge_search_project, org_search_knowledge`（8） | `scopeGuard.projectId` 已由 M1 强制（`SCOPE_PROJECT_OVERRIDE`） |
| `customer` | **CUSTOMER_BOUND_TOOLS**：`sales_get_customer, sales_get_customer_quotes, sales_get_customer_interactions`（3）+ `org_search_knowledge`（可选） | 全部以 `customerId` 为参数；工具内已有 `canSeeResource(..., ctx.orgId)` 与 data scope |
| 任何上下文 | **ORG_WIDE_SALES_TOOLS 排除**：`sales_get_pipeline, sales_get_pipeline_snapshot, sales_get_overview, sales_list_opportunities, sales_search_customers, sales_get_opportunity, sales_get_quote_summary`（7） | 绑定一个客户 ≠ 开放全公司销售视角；`get_opportunity/get_quote_summary` 以任意 id 访问，不受 customer 约束，同样排除 |

```text
CUSTOMER_BOUND_TOOLS  = [sales_get_customer, sales_get_customer_quotes, sales_get_customer_interactions]
ORG_WIDE_SALES_TOOLS  = [sales_get_pipeline, sales_get_pipeline_snapshot, sales_get_overview, sales_list_opportunities,
                         sales_search_customers, sales_get_opportunity, sales_get_quote_summary]
```

**参数绑定（防止模型改 customerId）**：M1 的 `scopeGuard` 只有 `orgId / principalUserId / projectId`（`agent-core/types.ts:130-134`，`pre-execute-guard.ts:44-88`）。customer 上下文要做到「工具参数 `customerId` 不得覆盖绑定客户」有两条路：

| 选项 | 内容 | 评估 |
|---|---|---|
| C1（**APPROVED — M2-C 已实施**，见 `docs/QINGYAN_MENTION_GATEWAY_M2C_IMPLEMENTATION.md`） | `scopeGuard` 增加可选 `customerId?`；`assertArgsMatchScopeGuard` 增加一条与 projectId 同形的 fail-closed 比对（`SCOPE_CUSTOMER_OVERRIDE`）；`toScopeGuard` 投影 `scope.customerId`。Final Review 修正版另含：scoped 下 effectiveCustomerId 由服务端权威给定（`tools/sales-scope.ts`）、`customerName` 不得切换客户、`opportunityId` 必须属于绑定客户、scoped 报价 DTO 不含 `shareToken` | core 链最小 additive 扩展（3 文件），缺省不传时行为不变 |
| C2 | 网关不暴露任何带 `customerId` 参数的工具，改为 extraTools 包装固定 customerId | extraTools l0 跳过 `canInvokeTool`（`engine.ts:208`），等于绕开策略链 → **否决** |
| C3 | 只靠系统提示 | 不满足「不仅依赖 prompt」→ **否决** |

role 维度不新增策略：工具内部 `salesCreatedScope / salesAssignableScope / canSeeResource` 与 Registry `allowRoles` 继续生效；M2-C 只做「按上下文收窄」，绝不放宽。`maxRisk` 仍固定 `l0_read`。不建 `ChannelToolPermission` 表。

`CONTEXT_SPECIFIC_TOOL_POLICY = code-defined（policy.ts）；PROJECT_TOOL_SCOPE = 8；SALES_TOOL_SCOPE = 3 customer-bound（org-wide 7 个排除）`。

---

## 16. Audit Strategy（复用 AuditLog）

现有：`AuditLog`（`schema:1287-1316`，`orgId? / projectId? / userId / action / targetType / targetId / beforeData / afterData / traceId`），`writeAuditLog / logAudit`（`audit/logger.ts:43-102`），`AUDIT_ACTIONS`（`:118-149`，目前无 identity/binding 动作）。不新建日志表。

| 事件 | action（新增常量） | targetType / targetId | before / after |
|---|---|---|---|
| identity link（self / admin） | `external_identity_link` | `external_identity` / id | after: `{provider, providerTenantId, providerUserId(hash 或原值), userId, status, verificationMethod}` |
| identity verify | `external_identity_verify` | 同上 | before status → after status + method |
| identity relink | `external_identity_relink` | 同上 | before `{userId}` → after `{userId}` |
| identity disable / enable / revoke | `external_identity_status_change` | 同上 | status + reason |
| binding create | `channel_binding_create` | `channel_context_binding` / id（`projectId` 填 `AuditLog.projectId`） | after 目标 |
| binding rebind | `channel_binding_rebind` | 同上 | before `{projectId|customerId}` → after |
| binding revoke / disable / enable | `channel_binding_status_change` | 同上 | status + reason |
| Mention 解析使用了哪条绑定 | 已有 `AgentRunEvent context.loaded`（M1）新增 payload `bindingId, identityId` | — | 运行时可追踪，不写 AuditLog |

`orgId`：identity 审计写操作者上下文 org（管理员的 org）或 null（自助）；binding 审计写 binding.orgId。`traceId` 可选。

---

## 17. Idempotency Strategy

| 层 | 现状 | M2 |
|---|---|---|
| 进程内 | `DuplicateEventGuard` 键 `provider:orgId:userId:channelId:eventId`（B1） | 键加入 `providerTenantId`：`provider:providerTenantId:orgId:userId:channelId:eventId` |
| DB（跨实例） | `AgentRun.userMessageId = "mock:<channelId>:<messageId>"` + `findFirst({orgId, userMessageId})` 复用（`run.ts:62-70`），`@@index([orgId, userMessageId])` 非唯一 | `userMessageId` 加入租户：`"<provider>:<providerTenantId>:<channelId>:<messageId>"`；仍 BEST_EFFORT |
| `@@unique([orgId, userMessageId])`？ | `userMessageId String?`（`schema:4825`）可空；Web 线程的 `userMessageId = AiMessage.id`；**重试路径刻意复用同值**（`assistant/dispatch.ts:287 skipUserMessageIdempotency: !!input.retryContext` → 同一 userMessageId 第二个 Run），历史库中必然存在重复 | **NO**：唯一约束会打断 `retryAssistantRun`、需要先清理历史重复、且 Prisma 不支持部分唯一索引（按 runType/metadata 过滤需 raw SQL 且会被 `migrate diff` 视为漂移） |
| STRONG 去重应落在哪 | — | M3 `InboundChannelEvent { provider, providerTenantId, providerEventId } @@unique` —— 在适配器边缘、建 Run 之前，与 signature/timestamp 窗一起完成；不污染 AgentRun |

```text
AGENT_RUN_IDEMPOTENCY_UNIQUE_RECOMMENDATION = NO（理由：可空 + 重试刻意复用 + 历史重复 + 无部分唯一索引支持）；STRONG 去重 → M3 InboundChannelEvent
INBOUND_EVENT_TABLE_REQUIRED（M2）= NO；（M3 首个真实 adapter）= YES
```

---

## 18. Proposed Prisma Models

```prisma
// PROPOSED ONLY — NOT APPLIED
// M2-A：ExternalIdentity（外部渠道身份 → 青砚用户；不带 orgId；不授予任何业务权限；不存 secret / profile）

model ExternalIdentity {
  id                 String    @id @default(cuid())
  /// adapter 枚举：mock | slack | wecom | personal_wechat（应用层校验，不做 Prisma enum 以免迁移摩擦）
  provider           String
  /// provider 租户边界：Slack team_id / 企微 CorpID / iLink 个微 = 该 org 的 WeChatGateway.id / mock = "mock"。NOT NULL，进唯一键。
  providerTenantId   String
  /// provider 用户 id：Slack U… / 企微 userid / 微信 openid
  providerUserId     String
  userId             String
  user               User      @relation("UserExternalIdentities", fields: [userId], references: [id], onDelete: Cascade)
  /// PENDING | ACTIVE | DISABLED | REVOKED
  status             String    @default("PENDING")
  /// ADMIN_PROVISIONED | PROVIDER_CHALLENGE | PROVIDER_OAUTH | PROVIDER_SIGNED_EVENT | LEGACY_SELF_ASSERTED
  verificationMethod String?
  verifiedAt         DateTime?
  verifiedById       String?
  linkedAt           DateTime  @default(now())
  /// 发起 link 的用户（自助 = userId；管理员 provision = 管理员）
  linkedById         String?
  lastSeenAt         DateTime?
  revokedAt          DateTime?
  revokedById        String?
  revokeReason       String?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  @@unique([provider, providerTenantId, providerUserId])
  @@index([userId, status])
  @@index([provider, providerTenantId, userId])
  @@index([status, updatedAt])
}

// M2-B：ChannelContextBinding（provider 频道/线程 → Organization + Project | SalesCustomer；安全配置，只能由已认证的人创建）

model ChannelContextBinding {
  id                String         @id @default(cuid())
  provider          String
  providerTenantId  String
  providerChannelId String
  /// 线程级绑定 id；"" = 频道级（非 null 才能进唯一键；Postgres 对 NULL 不做唯一比较）
  providerThreadId  String         @default("")
  /// 由目标对象派生，绝不接受请求体输入
  orgId             String
  org               Organization   @relation("OrgChannelContextBindings", fields: [orgId], references: [id], onDelete: Cascade)
  /// project | customer（由 projectId / customerId 派生的冗余列，用于索引与策略分派）
  contextType       String
  /// 语义标签：project → "tender" | null（由 Project.workDomain/tenderStatus 派生，不接受任意值）
  contextRole       String?
  projectId         String?
  project           Project?       @relation("ProjectChannelContextBindings", fields: [projectId], references: [id], onDelete: Cascade)
  customerId        String?
  customer          SalesCustomer? @relation("CustomerChannelContextBindings", fields: [customerId], references: [id], onDelete: Cascade)
  /// ACTIVE | DISABLED | REVOKED
  status            String         @default("ACTIVE")
  createdById       String
  createdBy         User           @relation("ChannelContextBindingCreatedBy", fields: [createdById], references: [id])
  updatedById       String?
  revokedAt         DateTime?
  revokedById       String?
  revokeReason      String?
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt

  @@unique([provider, providerTenantId, providerChannelId, providerThreadId])
  @@index([orgId, status])
  @@index([orgId, projectId])
  @@index([orgId, customerId])
  @@index([provider, providerTenantId, providerChannelId, status])
}

// 反向关系（PROPOSED ONLY — 追加到现有模型）
// model User         { …  externalIdentities ExternalIdentity[] @relation("UserExternalIdentities")
//                         channelContextBindingsCreated ChannelContextBinding[] @relation("ChannelContextBindingCreatedBy") }
// model Organization { …  channelContextBindings ChannelContextBinding[] @relation("OrgChannelContextBindings") }
// model Project      { …  channelContextBindings ChannelContextBinding[] @relation("ProjectChannelContextBindings") }
// model SalesCustomer{ …  channelContextBindings ChannelContextBinding[] @relation("CustomerChannelContextBindings") }

// M3（PROPOSED ONLY，本轮不建）：
// model ChannelProviderInstallation { id, provider, providerTenantId, orgId?, status, credentialsRef(encryptField), installedById, installedAt, uninstalledAt, @@unique([provider, providerTenantId]) }
// model InboundChannelEvent { id, provider, providerTenantId, providerEventId, receivedAt, signatureVerifiedAt, runId?, status, @@unique([provider, providerTenantId, providerEventId]) }
```

字段取舍说明：`verifiedById / linkedById / revokedById / updatedById` 用纯 `String?` 而非 User 关系，避免给 `User` 再挂 4 条反向关系；`createdById` 保留关系（与 `PendingAction.createdBy` 习惯一致，便于 UI 展示）。不存 displayName / avatar / profile。

---

## 19. Proposed Indexes / Unique Constraints

| 表 | 约束 | 目的 |
|---|---|---|
| ExternalIdentity | `@@unique([provider, providerTenantId, providerUserId])` | 一个外部身份最多一个用户；跨 provider 租户同名 id 不冲突 |
| ExternalIdentity | `@@index([userId, status])` | 用户设置页、禁用/删除用户时的级联查询 |
| ExternalIdentity | `@@index([provider, providerTenantId, userId])` | 管理员按租户审阅 |
| ChannelContextBinding | `@@unique([provider, providerTenantId, providerChannelId, providerThreadId])` | 同频道（含线程）唯一；不同 provider 租户的同名 channelId 不冲突；杜绝 duplicate active binding |
| ChannelContextBinding | `@@index([provider, providerTenantId, providerChannelId, status])` | Mention 解析热路径（线程 → 频道） |
| ChannelContextBinding | `@@index([orgId, status]) / ([orgId, projectId]) / ([orgId, customerId])` | 列表、IDOR 安全查找、目标对象反查 |
| DB CHECK（raw SQL） | `num_nonnulls("projectId","customerId") = 1`；`"contextType" IN ('project','customer')`；`status` 枚举 | Prisma 不建模 CHECK，但 `migrate` 会保留；service 为主、CHECK 为兜底 |

---

## 20. Migration Plan（本轮不创建）

| 项 | 建议 |
|---|---|
| 数量 | **2 个**：`<ts>_add_mention_gateway_external_identity`（M2-1，随 M2-A PR）、`<ts>_add_mention_gateway_channel_context_binding`（M2-2，随 M2-B PR）。理由：两表无相互 FK，可独立发布/回滚；与 PR 拆分对齐 |
| 类型 | 纯 additive（建表 + 索引 + 反向关系，无现有列变更）→ 零停机；`migrate deploy` 在低流量窗口即可 |
| 注册 | `src/lib/release/expected-migrations.ts` `EXPECTED_ACTIVE_MIGRATIONS` 追加两项（否则 `predeploy-migration-gate` 在生产构建 BLOCKED） |
| 流程 | 按 `docs/PHASE5_PRODUCTION_MIGRATION_RUNBOOK.md`：Neon 备份分支 → staging `migrate deploy` → 生产受控 deploy → `verify:migration-history`；代码 flag 默认关，表存在但无消费者不影响线上 |
| 回填 | `scripts/backfill-external-identity-from-wechat-binding.ts`（dry-run 默认，`--write` 执行，幂等 upsert-by-unique-key，仅 `status=active` 的 WeChatBinding），独立于 migration，可重复运行 |
| 回滚 | 代码回滚即停用（flag 关）；表可保留（库比代码新 = 放行 + 告警，gate 允许）；彻底回滚 = `DROP TABLE`（两表无外部依赖） |
| 唯一约束风险 | 回填前检查 `WeChatBinding` 是否存在同 `(channel, externalId)` 映射到不同 `providerTenantId` 的歧义（企微平台级 vs org 级网关 corpId 不同） → 脚本按 `binding.orgId → WeChatGateway` 解析，无法解析的记录进 `PENDING` 并输出清单 |

```text
PROPOSED_SCHEMA_CHANGE   = 2 新表 + 4 个反向关系字段（User / Organization / Project / SalesCustomer），0 现有列修改
PROPOSED_MIGRATION_COUNT = 2（+1 回填脚本，非 migration）
```

---

## 21. Legacy Binding Migration

生产企微助理基于 `WeChatBinding`（`docs/WECOM_WECHAT_DOMAIN.md`），存在真实用户数据 → **不废弃**。

```text
LEGACY_BINDING_MIGRATION_REQUIRED = YES（回填；WeChatBinding 保留为推送偏好表 + 企微/个微现有链路数据源，直到 M3 切换）
```

| WeChatBinding | → ExternalIdentity | 规则 |
|---|---|---|
| `channel` (`wecom` / `personal_wechat`) | `provider` | 原值 |
| — | `providerTenantId` | `wecom`：平台网关 `WeChatGateway(orgId=PLATFORM_WECOM_ORG_ID).corpId`；若 `binding.orgId` 的 org 级网关存在则用该 `corpId`；`personal_wechat`：`WeChatGateway(orgId=binding.orgId, channel=personal_wechat).id`；无法解析 → `PENDING` + 清单 |
| `externalId` | `providerUserId` | 原值 |
| `userId` | `userId` | 原值（用户需 `status=active`，否则 `DISABLED`） |
| `status=active` / `disconnected` / `expired` | `ACTIVE` / `REVOKED` / `REVOKED` | — |
| — | `verificationMethod` | `LEGACY_SELF_ASSERTED`（全部；历史无占有证明） |
| `createdAt` | `linkedAt` | 原值；`linkedById = userId` |
| `lastActiveAt` | `lastSeenAt` | 原值 |
| `orgId`（缓存） | **丢弃** | org 由 membership 推导 |
| push* / silent* / filter* | **留在 WeChatBinding** | 偏好与身份解耦 |

企微 / 个微网关（`messaging/gateway.ts`）在 M2 **继续读 WeChatBinding**（DO NOT TOUCH）；M3 切换为 `ExternalIdentity` 并修复 R1–R3。

---

## 22. Proposed APIs（仅设计）

约定：`withAuth` + `requireTenantContext`（`tenancy/context.ts:131-138`）；响应 `{ error, code }`；跨 org 404；body 用 zod；所有写操作经 service 层（唯一写入口），AI / runtime 绝不调用。

| 方法 / 路径 | 守卫 | 语义 |
|---|---|---|
| `GET /api/mention-gateway/identities` | withAuth | 本人身份列表；`?userId=` 需 §11 管理员权限且目标与管理员共享 org |
| ~~`POST /api/mention-gateway/identities/link`~~ | — | **未实现（SELF_LINK_DEFERRED_TO_M3，A1）**；管理员 provision 改为独立端点 `POST /api/mention-gateway/identities/provision`（§11 权限 + `MENTION_GATEWAY_IDENTITY_ADMIN_ENABLED` + ownership gate）；已存在同键 → 409（不 upsert） |
| `POST /api/mention-gateway/identities/:id/verify` | 管理员（§11） | PENDING → ACTIVE |
| `POST /api/mention-gateway/identities/:id/relink` | 管理员（§11，对新旧用户均可管理） | body `{userId}`；审计 old→new |
| `POST /api/mention-gateway/identities/:id/disable` / `enable` | 管理员 | 状态切换 |
| `DELETE /api/mention-gateway/identities/:id` | 本人或管理员 | = revoke（终态，软删除） |
| `GET /api/mention-gateway/bindings?orgId=&projectId=|customerId=` | requireTenantContext | 仅 `tenant.orgId`；按对象可读性过滤 |
| `POST /api/mention-gateway/bindings` | 目标权限（§11） | body `{provider, providerTenantId, providerChannelId, providerThreadId?, projectId? | customerId?, contextRole?}`；**无 orgId**；同键存在 → 409 |
| `GET /api/mention-gateway/bindings/:id` | requireTenantContext | `findFirst({id, orgId})` → 404 |
| `POST /api/mention-gateway/bindings/:id/rebind` | 旧+新目标权限 | body `{projectId? | customerId?, contextRole?, reason}` |
| `PATCH /api/mention-gateway/bindings/:id` | 当前目标权限 | 仅 `status: ACTIVE|DISABLED`、`contextRole`；**不允许改目标**（必须 rebind） |
| `DELETE /api/mention-gateway/bindings/:id` | 当前目标权限或 org_admin | = revoke（软删除，需 reason） |

是否 service-only：**写操作需要 HTTP API**（管理员设置页要用），但全部为「已认证人类动作」；M2 先出 API + 最小设置页可后置；读路径（Mention 解析）只走 service 内部函数。Mock 入口 `POST /api/mention-gateway/mock` 改为从 DB 解析（fixture 仅测试态）。

---

## 23. Test Matrix

| # | 场景 | 层 | 期望 |
|---|---|---|---|
| 1 | External identity claim takeover（A 自助 link B 的 providerUserId） | service/pure | 只产生 A 自己的 PENDING 或 409（键已被 B 占用）；绝不改写 B |
| 2 | Cross-org identity（identity ACTIVE，用户无该 org membership） | resolver | `IDENTITY_OR_MEMBERSHIP_DENIED` |
| 3 | Removed membership（identity ACTIVE，membership inactive） | resolver | DENY，且不读 binding |
| 4 | Disabled user | resolver | DENY |
| 5 | Disabled / revoked / pending identity | resolver | DENY |
| 6 | Provider tenant mismatch（同 providerUserId，不同 providerTenantId） | resolver + unique | 各自独立；错误租户 → 未找到 → DENY |
| 7 | Unknown provider tenant | resolver | DENY / CONTEXT_UNRESOLVED |
| 8 | Cross-org project binding（Org A 绑 Org B 项目） | service | 404；DB 无行 |
| 9 | Cross-org customer binding | service | 404 |
| 10 | Binding IDOR（他 org bindingId GET/PATCH/DELETE） | API | 404 |
| 11 | Unauthorized rebind（operator / viewer / 无 sales.customer.update） | API/service | 403；AuditLog 无写入 |
| 12 | Thread override | resolver | 线程 ACTIVE 绑定优先于频道 |
| 13 | Channel fallback | resolver | 无线程绑定 → 频道绑定 |
| 14 | Revoked / disabled binding | resolver | 视同不存在 → CONTEXT_UNRESOLVED（不 fallback 到旧目标） |
| 15 | Duplicate active binding | unique + service | 第二次 create → 409；DB 唯一键 |
| 16 | Same channel ID in different provider tenants | unique | 两行并存，互不影响 |
| 17 | Same external user ID in different provider tenants | unique | 两行并存，各自映射 |
| 18 | Prompt tries to change context（"orgId=…/projectId=…/customerId=…"） | Registry | `SCOPE_ORG_OVERRIDE / SCOPE_PROJECT_OVERRIDE / SCOPE_CUSTOMER_OVERRIDE(C1)` |
| 19 | Project context asks for org-wide sales data | policy + Registry | `sales_get_pipeline` 等不在暴露面；直接调用 → `TOOL_NOT_ALLOWLISTED` |
| 20 | Customer context asks for full pipeline | policy + Registry | 同上；`sales_get_customer` 只能用绑定 customerId |
| 21 | Personal project（orgId null）绑定 | service | 400/404 |
| 22 | body.orgId 注入 | API | 400 或忽略；绑定 orgId = 对象 orgId |
| 23 | Legacy backfill 幂等（重复运行） | script | 行数不变；歧义进 PENDING 清单 |
| 24 | Audit：create/rebind/revoke 各写一条且 before/after 正确 | service | AuditLog 断言 |
| 25 | Event-stream：M1 B1/B2 不变量在 DB 实现下仍成立 | e2e（隔离库） | 复用 `m1-final-review` 不变量 |

分层：纯逻辑（policy / precedence / key 构造 / 权限判定函数）→ 注入 deps 的 resolver 测试（M1 夹具扩展）→ 隔离库集成（service + unique 约束 + IDOR + 回填）→ Mock API e2e。

---

## 24. M2 Implementation Plan（建议，不执行）

| PR | 内容 | Schema | 依赖 |
|---|---|---|---|
| **M2-C** Context-specific Tool Policy — **DONE**（分支 `feature/qingyan-mention-gateway-m2-c-tool-policy`） | `policy.ts`：`MENTION_CONTEXT_TOOL_POLICY[canonical]`、`PROJECT_CONTEXT_TOOLS(8) / CUSTOMER_CONTEXT_TOOLS(3) / ORG_WIDE_SALES_TOOLS(7)`；`buildMentionRunOptions` 按 contextType 取 allowlist；**C1 已批准并实施**（`scopeGuard.customerId` + `SCOPE_CUSTOMER_OVERRIDE` + `tools/sales-scope.ts` 服务端权威客户 / name 不逃逸 / opportunity 校验 / shareToken 脱敏）；测试 18–20 + 105 断言攻击套件 | 无 | 无 |
| **M2-A** Persistent External Identity | migration M2-1；`identity-service.ts`（link/verify/relink/disable/revoke + AuditLog）；`IdentityDeps.lookupExternalIdentity` DB 实现（含 `providerTenantId`）；identities API；回填脚本；flag `MENTION_GATEWAY_IDENTITY_SOURCE=fixture|db`（默认 fixture，生产不开）；测试 1–7、17、23、24 | M2-1 | — |
| **M2-B** Persistent Channel Context Binding | migration M2-2；`binding-service.ts`（create/rebind/revoke/disable + 派生 orgId + 权限 + AuditLog）；`ContextDeps.lookupChannelBinding` DB 实现（status 过滤 + 线程优先）；bindings API；flag `MENTION_GATEWAY_BINDING_SOURCE=fixture|db`；测试 8–16、21、22、24 | M2-2 | M2-A（identity 先于 binding 才能端到端） |
| **M2-D** Integration / Security E2E | 隔离库跑全矩阵 + Mock API e2e + M1 B1/B2 不变量回归；并入 A/B 各自 PR，并在 B 合并前跑一次完整门 | 无 | A + B |

```text
RECOMMENDED_M2_SPLIT = 3 PRs（M2-C → M2-A → M2-B；M2-D 作为 A/B 的测试门，不单独成 PR）
理由：C 零 schema、独立可回滚、立即收紧 mock 路径；A/B 各带一个 additive migration，审阅与回滚边界清晰；合成一个 PR 会把 policy 变更与两张表的生产迁移绑死。
```

### 24.1 M2-A / M2-B 新增前置条件（M2-C Final Review 记录）

```text
PROVIDER_TENANT_OWNERSHIP_GATE_REQUIRED = YES
```

`ExternalIdentity.status = ACTIVE` 与 `ChannelContextBinding.status = ACTIVE` 之前，必须证明 `providerTenantId` 属于目标 org 的**可信 installation / gateway**：
- 今天：`WeChatGateway(orgId = 目标 org | PLATFORM_WECOM_ORG_ID, channel).corpId`（企微）/ `WeChatGateway.id`（iLink 个微）；mock：固定 `"mock"` 且仅非生产；
- M3：`ChannelProviderInstallation(provider, providerTenantId) → orgId`。

未能证明归属（未知租户 / 租户属于其它 org / installation 非 ACTIVE）→ 身份与绑定只能停留 `PENDING`，Mention 解析视同不存在（fail-closed）。该门必须在 M2-A / M2-B 的 service 层实现并测试（对应测试矩阵 #6 / #7 扩展为「租户归属未证明 → PENDING」），不得由 API 请求体声明。

---

## 25. M3 Preconditions

1. `ChannelProviderInstallation`（含 `encryptField` 凭证引用）+ `InboundChannelEvent`（签名 / 时间窗 / `providerEventId` 唯一去重）。
2. 首个真实 adapter（Slack 或企微）：`verifyAndParse`（HMAC + 时间窗，模板 `marketing/activepieces.ts:47-72`）、`providerTenantId` 映射、`PROVIDER_CHALLENGE` 或 `PROVIDER_OAUTH` 占有证明。
3. 企微链路从 `WeChatBinding` 切到 `ExternalIdentity`（修 R1–R3），`WeChatGateway` secret 改加密（R4）。
4. 共享频道受众策略（频道成员 ⊆ 业务对象可见成员）后才可放开 `audience: "channel"`。
5. `l2_soft` + PendingAction 草稿 + 渠道内 "1/2/3"（复用 `ApprovalPort`，候选改 `listApprovalInbox`）。
6. P0-A 独立 fix lane（`process.ts` / `skills/runtime.ts` / `trade/chat-assistant.ts` 接入 `resolveAgentTenant`）。

---

## 26. DO NOT TOUCH（M2 实施阶段）

```text
src/lib/agent-core/{tool-registry,approval-gate,engine}.ts        （仅 C1 允许：pre-execute-guard.ts + types.ts scopeGuard.customerId additive，需批准）
src/lib/tenancy/*（含 tool-auth.ts）、src/lib/authorization/*、src/lib/rbac/*、src/lib/auth/*
src/lib/agent-scope/resolve.ts（仅 C1 允许：toScopeGuard 投影 customerId）
src/lib/pending-actions/*、src/lib/approval/port.ts
src/lib/messaging/gateway.ts、adapters/*、src/app/api/messaging/*（生产企微链路；R1–R4 留 M3）
src/lib/agent-runtime/process.ts、session.ts、run.ts（不加唯一约束、不改 userMessageId 语义）
src/lib/agent-runtime-v2/*、src/lib/workforce-runtime/*、src/lib/autopilot/*
prisma/schema.prisma 现有模型的现有列（M2 只追加新表与反向关系字段）
生产 env / flag（MENTION_GATEWAY_* 全部保持关闭）
```

---

## 27. Security Invariants（PASS BY DESIGN）

```text
EXTERNAL_IDENTITY_DOES_NOT_GRANT_ORG_ACCESS      PASS BY DESIGN（identity 无 orgId；org 来自 OrganizationMember + resolveAgentTenant，每次 Mention 重查）
PROVIDER_USER_CANNOT_SELF_CLAIM_OTHER_USER        PASS BY DESIGN（自助 link userId=会话用户且仅 PENDING；ACTIVE 只由管理员/provider 证明产生；唯一键 + 显式 relink）
BINDING_ORG_CANNOT_BE_CLIENT_OVERRIDDEN           PASS BY DESIGN（orgId 从目标对象派生；body.orgId 拒绝）
BINDING_TARGET_MUST_BELONG_TO_ORG                 PASS BY DESIGN（service 断言 target.orgId === tenant.orgId；resolveAgentScope 二次；CHECK XOR）
CHANNEL_REBIND_REQUIRES_PERMISSION                PASS BY DESIGN（无 upsert；rebind 需旧+新目标权限 + AuditLog）
THREAD_BINDING_OVERRIDES_CHANNEL_BINDING          PASS BY DESIGN（线程 ACTIVE → 频道 ACTIVE → CONTEXT_UNRESOLVED）
UNKNOWN_BINDING_FAILS_CLOSED                      PASS BY DESIGN（无绑定 / 非 ACTIVE → 不进入 Runtime）
DISABLED_IDENTITY_FAILS_CLOSED                    PASS BY DESIGN（status !== ACTIVE → DENY；user.status !== active → DENY）
REMOVED_MEMBERSHIP_FAILS_CLOSED                   PASS BY DESIGN（pickMembershipOrg + resolveAgentTenant.hasMembership + resolveAgentScope 三处）
CONTEXT_TOOL_POLICY_IS_SCOPED                     PASS BY DESIGN（contextType → allowlist；org-wide sales 排除；C1 customerId 守卫；maxRisk=l0_read 不变）
```

---

## 28. Design Blockers / Gaps

```text
P0_DESIGN_BLOCKERS = 0
P1_DESIGN_GAPS     = 4
  1. C1 scopeGuard.customerId —— 已批准并在 M2-C 实施（RESOLVED）；新增 M2-A/B 前置 PROVIDER_TENANT_OWNERSHIP_GATE_REQUIRED = YES（§24.1）
  2. 企微 WeChatGateway secret 明文（R4）与 legacy R1–R3 在 M2 不修（生产链路 DO NOT TOUCH），切换窗口在 M3
  3. 幂等保持 BEST_EFFORT 直到 M3 InboundChannelEvent
  4. 回填的 LEGACY_SELF_ASSERTED 身份无占有证明：M2-A 最终裁定改为**默认拒绝**（`MENTION_GATEWAY_REQUIRE_VERIFIED_IDENTITY` 缺省 true；显式设 0 才放行）——安全默认优先于连续性；管理员可逐个 verify 升级
```

---

## 29. M2-A As-Built（2026-08-24 实施对齐）

设计门之后的 Final Security Review 修正 + 实际实现与设计稿的差异（详细证据见 `docs/QINGYAN_MENTION_GATEWAY_M2A_IMPLEMENTATION.md`）：

| 冻结语义 | 实施 |
|---|---|
| **A1 SELF_LINK_DEFERRED_TO_M3** | `POST /identities/link` 不存在（测试 M2A-15 以 fs 断言缺席）。M2-A 仅 `ADMIN_PROVISIONED`（provision API）与 `LEGACY_SELF_ASSERTED`（回填脚本）两个来源；PROVIDER_CHALLENGE / OAUTH / SIGNED_EVENT / SELF_LINK 全部 M3 |
| **A2 NO_BLIND_UPSERT** | 写路径无任何 `upsert`：`decideProvisionOutcome`（纯函数）→ 键属他人 = `CONFLICT`（DB 零修改、不泄露 existing userId）；同用户按状态给显式指令（NEEDS_VERIFY / NEEDS_ENABLE / NEEDS_RELINK）；并发 P2002 → 同 CONFLICT 语义。永不把更强 verified 身份降级为 LEGACY |
| **Provider Tenant Ownership Gate（§24.1）** | `provider-tenant-ownership.ts`：任何 ACTIVE transition（provision/verify/relink/enable）前重判。mock → 恒 `"mock"` 且仅非生产；personal_wechat → `WeChatGateway.id`（channel+orgId+status 全匹配）；wecom → 真实 org 集合（排除平台网关）：0 → UNPROVEN（**含仅平台共享网关命中——无可信 platform→org 映射，不得猜**）、1 → MISMATCH/OWNED/INACTIVE、**>1 → AMBIGUOUS（Final Review B3，NEVER OWNED）**；slack → UNSUPPORTED（待 M3 ChannelProviderInstallation）。非 OWNED → 拒绝且**不创建任何行**（含 PENDING 占位）。**B2：管理可见性同样绑定归属**——OWNED/INACTIVE 可管理（ACTIVE transition 仍要求 OWNED），其余对管理员 404 |
| **REQUIRE_VERIFIED 默认** | 与 §28.4 原产品决策相反：缺省 **true**（LEGACY ACTIVE 也拒）；`MENTION_GATEWAY_IDENTITY_SOURCE` 缺省 fixture、非法值 fail-closed `GATEWAY_DISABLED`（不 fallback）；`MENTION_GATEWAY_IDENTITY_ADMIN_ENABLED` 缺省 false |
| **providerTenantId 贯穿** | `MentionEvent.providerTenantId`（mock 适配器服务端固定 `"mock"`，body 声明被忽略）；session / userMessageId / dedupe 键全部含 tenant 段；仍 BEST_EFFORT |
| **回填** | `scripts/backfill-external-identity-from-wechat-binding.ts`：dry-run 默认、`--write` 显式、生产 hard-block（无 override）；tenant 解析不出 → 仅 UNRESOLVED 报告（绝不写 `"unknown"`/orgId 顶替）；键属他人 → CONFLICT 不 mutation；更强身份 → STRONGER_PRESERVED；仅允许 ACTIVE/PENDING → REVOKED/DISABLED 单调收敛 |
| **审计** | 全部写在 `db.$transaction` + `writeAuditLog(tx, …)`（审计失败整体回滚）；`providerUserId` 只以 sha256 截断 hash 入审计/日志 |

### §29.1 Final Review 修正（2026-08-24，同 PR #160）

- **B1 CAS**：全部生命周期 mutation `updateMany WHERE id+userId+status+verificationMethod+updatedAt`（快照）→ 失配 = `IDENTITY_STATE_CHANGED` 409、零写零审计；REVOKED 终态、self-revoke-vs-relink、回填-vs-verify 升级均实测不可被 stale 覆盖
- **B2 管理域**：user ∈ org ≠ identity ∈ org；admin list/写操作逐身份过滤 provider 租户归属（OWNED/INACTIVE 可见，其余 404）
- **B3**：CorpID 属 >1 真实 org → AMBIGUOUS（NEVER OWNED）；回填 `buildCorpOrgIndex` 同规则 → `wecom_corp_ambiguous` UNRESOLVED
- **B4**：`VERIFIED_IDENTITY_METHODS` 白名单（ACTIVE+null 也拒）；migration 增补 `ExternalIdentity_active_requires_method_check`，最终 sha256 `00302bf409ea820073692d21886bb29826b6d01379d2bf04c616d6b0ac632b52`
- **P1**：目标用户跨 org / 不存在 → 统一 `TARGET_USER_NOT_FOUND`（存在性 oracle 关闭）
