# Qingyan Mention Gateway — M2-B Persistent Channel Context Binding 实施报告

- 日期：2026-08-26
- 分支：`feature/qingyan-mention-gateway-m2-b-channel-context-binding`
- Base：origin/main `b99c2d80`（M2-A merge `c673d6b5` 之后 +1 commit：#174 analyst-memo workbench UI，与 M2-B 零相关 → M2B_RELEVANT_MAIN_DRIFT = NO）
- 范围：**仅 M2-B**（ChannelContextBinding 持久层 + 生命周期 + DB 绑定源 + thread precedence + 管理 API）。
  真实 adapter / ChannelProviderInstallation / InboundChannelEvent / 强幂等 / M3 全部未动。
- 设计基线：`docs/QINGYAN_MENTION_GATEWAY_M2_ARCHITECTURE.md`（§30 M2-B as-built）

---

## 1. 冻结安全语义（B0–B5）

| 原则 | 实施 |
|---|---|
| **B0 CHANNEL CONTEXT IS SERVER AUTHORITY** | 业务上下文只能来自显式持久化 ChannelContextBinding。写路径只在 binding-service（API 薄壳挂 `requireBindingAdminContext`）；AI/runtime 零调用面（M2B-9 以 fs 断言写路由无任何 AI 执行路径）。模型不能按聊天内容猜项目/切客户/建绑定。 |
| **B1 PROVIDER TENANT 是键的一部分** | 唯一键 `(provider, providerTenantId, providerChannelId, providerThreadId)`；fixture store 同步升级为租户键。跨租户同 channel/thread 并存且互不命中（DB-2/§39 实测）。 |
| **B2 NO BLIND UPSERT** | `decideCreateBindingOutcome` 纯函数：ACTIVE 同 target 同 role → IDEMPOTENT 零写；不同 target/role → `BINDING_ALREADY_EXISTS`（必须显式 rebind）；并发 P2002 同语义；绝不 upsert 改 target。 |
| **B3 REVOKED = TERMINAL** | ACTIVE ⇄ DISABLED → REVOKED；REVOKED 后 enable → INVALID_STATE、rebind → BINDING_REVOKED_TERMINAL、同 exact key recreate → BINDING_REVOKED_TERMINAL 零行（恢复属未来显式 recovery/supersession，不偷偷复活）。可逆暂停 = DISABLE。 |
| **B4 THREAD PRECEDENCE** | ACTIVE exact thread > ACTIVE channel > CONTEXT_UNRESOLVED；DISABLED/REVOKED thread 视为不存在 → fallback channel；**ACTIVE thread 但 org/target/ownership 校验失败 → FAIL CLOSED，绝不 fallback channel**（E2E-2/E2E-3 硬测）。 |
| **B5 绑定失败不得污染 dedupe** | handle 次序改为 identity → binding → org → context → scope → **dedupe** → session/run；markIfNew 前全部只读。unknown binding / DB lookup 失败 / scope denied 均零 dedupe 消耗；修复后同 eventId 可重试；合法完成后重放 → DUPLICATE_EVENT（纯测 M2B-8 + E2E-5）。M1 B1（身份未验证不 dedupe）保持。 |

## 2. Schema / Migration M2-2

### 2.1 `model ChannelContextBinding`（schema 尾部）+ 三个 back-relation

- 键：`@@unique([provider, providerTenantId, providerChannelId, providerThreadId])`
- **threadId 非空哨兵设计**（§5）：`providerThreadId String @default("")` —— CHANNEL 级恒 `""`、THREAD 级恒非空真实 id。原因：Postgres UNIQUE 对 NULL 的语义会允许同 provider/tenant/channel 出现多条 threadId=NULL 的 channel 级行；`""` 哨兵使「每渠道最多一条 channel 级绑定」真正由唯一键保证（DB-2 直插 P2002 实测）。对外 API：threadId 缺省/null = channel 级；显式空串/空白 → INVALID（不静默降级）。
- target：`projectId?` / `customerId?` 真实 FK + XOR；`orgId` 必填 FK（server 推导）；`contextRole String?`（null | "tender"；tender 只是 Project 标签，**无 tenderId**）
- 生命周期字段：status/createdById/updatedById/disabledAt/By/revokedAt/By/Reason
- 索引：`[orgId,status]` `[projectId,status]` `[customerId,status]` `[provider,tenant,channel,status]`
- **删除语义（§8）**：org/project/customer FK 全部 `onDelete: Restrict` —— 绑定是审计/安全配置，target 删除不得静默连带删除（现有仓库无冲突纪律；显式 Restrict 而非依赖 Prisma 缺省）。

### 2.2 Migration

- `prisma/migrations/20260826183000_add_mention_gateway_channel_context_binding/migration.sql`（无 timestamp/name collision；latest 此前为 20260824170000）
- 纯 additive：CreateTable + 唯一索引 + 4 索引 + FK×3(RESTRICT) + **CHECK×6**：
  `status_check`（ACTIVE/DISABLED/REVOKED）、`level_thread_check`（CHANNEL↔"" / THREAD↔非空白）、`target_xor_check`、`context_role_check`（null|'tender'）、`tender_requires_project_check`、`key_nonblank_check`
- 索引名与 Prisma canonical 截断一致（用 `migrate diff --from-empty` 校准，避免 drift RenameIndex 噪音）
- SHA256：`457b4b779cb9e4215276407643b8e128eb78c9a22b3120e0eb6deb19a3a1f85a`
- 治理三件套已同步（expected-migrations / verify-migration-history IMMUTABLE / check-release-safety 标签 `+ MentionGatewayChannelContextBinding`）；历史条目零改动；无 `db push`；无 backfill（§11：不存在可信 legacy channel→target 源——AgentSession.currentProjectId / ExternalReference / 聊天历史都不是 canonical，初始为空是正确状态；fixture 亦不回填生产）

## 3. 创建 / 权限（§14–§20）

- body 只收：provider / providerTenantId / providerChannelId / providerThreadId? / targetType(project|customer) / targetId / contextRole?(tender)。**禁**：orgId / status / bindingLevel / createdById / updatedById（zod strict + fs 断言）。bindingLevel 由 threadId 有无服务端推导。
- **targetOrg 服务端推导（§15）**：project.orgId / customer.orgId；必须 `=== 管理租户 org`（requireTenantContext），否则 TARGET_NOT_FOUND（跨 org 不泄露；不存在的 targetId 同 code，无存在性 oracle）。
- **project 权限（§16）**：逐条镜像 canonical `requireProjectWriteAccess`（`src/lib/projects/access.ts`）决策表，复用同一套原语（`isSuperAdmin`/`hasOrgRole`/`hasProjectRole` + `getOrgMembership`/`getProjectMembership`）：super_admin ∥ (intakeStatus=dispatched ∧ (owner ∥ org_admin ∥ project_admin))。普通只读成员（operator）→ CALLER_FORBIDDEN（DB-4 全表实测）。
- **personal project（§17）**：canonical 判别 = `Project.orgId === null`（`agent-scope/resolve.ts` evaluateProjectScope 的 `isPersonalOwn` / `projects/visibility.ts` 同判）→ `TARGET_PERSONAL_PROJECT`，DB 零行（§38 硬测）。
- **customer 权限（§18）**：canonical `authorize({permission:'sales.customer.update', resource:{type:'sales_customer', id, orgId, ownerId: createdById}})` + `isAdmin` 旁路（与 `sales/customers/[id]` PUT Security-1 完全一致）。DB-5 用**真实授权链**（seedOrgAuthorizationProfiles + sales_rep PrincipalRoleBinding）实测：创建者 PRINCIPAL scope 通过、非创建者拒、无 profile 拒、平台 admin 旁路通过。
- **ownership（§19）**：复用 M2-A `resolveProviderTenantOwnership()`（零第二份实现）；create/enable/rebind 需 OWNED；INACTIVE/UNPROVEN/MISMATCH/AMBIGUOUS/UNSUPPORTED → `PROVIDER_TENANT_UNVERIFIED` **零行**（DB-3）。mock 仅非生产；slack UNSUPPORTED。

## 4. Rebind（§21–§22）/ 生命周期（§23）/ 可见性（§24）/ CAS（§25）

- rebind：`loadManageableBinding`（org 匹配 + ownership ∈ {OWNED,INACTIVE} + **OLD target 权限**）→ REVOKED 拒 → NEW target（加载 + personal 拒 + org == binding.org == 管理 org，**CROSS_ORG_REBIND=FORBIDDEN，平台 admin 也不例外**）→ NEW 权限 → ownership OWNED → CAS。同 org 允许换 target/换类型（project⇄customer）/换 contextRole；审计记录 before/after target。§42 矩阵（OLD∧NEW/仅 OLD/仅 NEW/都无/跨 org/错租户/REVOKED/并发 revoke 胜出）全实测。
- disable（ACTIVE→DISABLED；ownership OWNED|INACTIVE 可）/ enable（DISABLED→ACTIVE；重验 OWNED + target 有效 + 权限）/ revoke（ACTIVE|DISABLED→REVOKED；OWNED|INACTIVE 可）。
- 管理可见性（§24）：list/写一律 `binding.orgId == 管理 org ∧ ownership ∈ {OWNED,INACTIVE} ∧ caller 可管理该 target`；MISMATCH/UNPROVEN/AMBIGUOUS/UNSUPPORTED 行对管理员 404/不可见（存在性不泄露；DB-8 含「损坏行」实测）。org_admin 看不到无权限的 customer 绑定；sales_rep 只见自己客户的绑定。
- **CAS（§25，Day One）**：所有 mutation read → validate → `commitBindingTransition`（`updateMany WHERE id+status+projectId+customerId+contextRole+updatedAt`）；失配 → `BINDING_STATE_CHANGED` 409、零写零审计。stale disable vs revoke、并发 revoke beats rebind（ownershipDeps 交错注入全 API 路径）实测；REVOKED 终态不可被 stale 覆盖。

## 5. 审计（§26–§27）

4 个新 `AUDIT_ACTIONS`：`channel_context_binding_create / rebind / status_change / revoke`；targetType `channel_context_binding`。全部 `db.$transaction + writeAuditLog(tx)`（失败整体回滚；CAS FAIL 零审计实测）。审计不复制 raw channel/thread id —— 只存 `providerChannelIdHash` / `providerThreadIdHash`（sha256 截断 16，与 M2-A providerUserId 同风格）+ provider/tenant/bindingLevel/orgId/projectId/customerId/contextRole/status；无消息正文/外部用户 ID/token。

## 6. Runtime 解析（§30–§36）

- Flags：`MENTION_GATEWAY_BINDING_SOURCE`（缺省 fixture；`db` 显式；**非法值 → GATEWAY_DISABLED fail-closed，绝不 fallback fixture**）、`MENTION_GATEWAY_BINDING_ADMIN_ENABLED`（缺省 false；未启用连管理 list 也 404）。
- lookup 签名升级（§31）：`ContextDeps.lookupChannelBinding(provider, providerTenantId, channelId, threadId, expectedOrgId)` → 三态 `found | none | fail_closed`；fixture store 同步租户键（缺省 "mock"）。
- DB resolver `lookupPersistentChannelBinding`（§32/§33）：thread 精确键任何状态先查——ACTIVE → 校验（org == expectedOrgId、XOR、ownership==OWNED）通过即返回，**失败即 fail_closed 不落 channel**；DISABLED/REVOKED 视为不存在 → channel 键（""）→ ACTIVE 校验或 none。零写路径。DB 异常 → deps 层 catch → fail_closed(`binding_lookup_error`) → 对外 CONTEXT_UNRESOLVED + 结构化日志（绝不 fixture）。
- **§34 边界不变**：绑定只是业务对象 selector，不是授权。命中后仍走 `verifyBindingOrganization` + `resolveAgentScope`（membership/project/customer 真实校验）→ M2-C 工具面。binding ACTIVE ≠ hasMembership；E2E：membership 撤销即拒、他人客户 SCOPE_DENIED。
- §35 行→运行期映射 `bindingRowToContextType`：project+null→"project"、project+tender→"tender"、customer→"sales"（M2-C 策略零第二套实现）；XOR 破损 → null → fail closed。

## 7. 测试矩阵

| 套件 | 断言 | 摘要 |
|---|---|---|
| `m2b-binding-policy.test.ts`（纯；test:ci + test-all） | 57 | flags fail-closed（含 handle 层 GATEWAY_DISABLED）、键归一化/哨兵、decideCreateBindingOutcome（B2/B3）、行→contextType 映射、hash 隐私、fixture 租户隔离、B5 dedupe 次序（binding/scope 失败零污染 + 修复重试 + 完成后 DUPLICATE）、管理路由守卫 fs 断言（无 AI-write） |
| `m2b-binding-db.isolated.test.ts`（隔离库） | 72 | CHECK×9 场景、§40 唯一键（channel 单行/channel+thread 并存/T1+T2 并存/P2002）、§39 跨租户并存 + lookup 隔离、创建语义、ownership 零行、§16 决策表、§38 personal 硬拒、§18 真实授权链、生命周期 + REVOKED 终态 + recreate 拒、CAS（stale disable / 并发 revoke beats rebind）、§42 rebind 矩阵、§24 可见性（含损坏行）、审计原子 + hash |
| `m2b-db-full-e2e.isolated.test.ts`（隔离库；§45 HARD GATE） | 37 | 真实默认 deps 装配（identity db + binding db 源经 flag 实际分派）：全链路 completed、M2-C project 恰 8 / customer 恰 3 / org-wide 排除、B2 事件序、§41 precedence 全矩阵（含 **ACTIVE-invalid FAIL CLOSED 不 fallback** + ownership_invalid resolver 证明）、§46 负向、B5 dedupe 锁（binding/scope/DB 失败零消耗 + 修复重试） |
| 既有套件 | m0 96 / m1-gateway 70 / m1-static 333 / m1-final-review 72 / m1-tool-policy 124 / m2c 105 / m2a 108 | fixture 缺省语义不变；仅 lookup 签名/租户键面更新 |

安全断言（全 PASS）：`NO_BLIND_UPSERT` / `REVOKED_TERMINAL_PURE` / `CROSS_TENANT_KEY_ISOLATION` / `BINDING_SOURCE_FAIL_CLOSED` / `DB_IDENTITY_AND_BINDING_E2E` / `THREAD_PRECEDENCE_E2E` / `INVALID_ACTIVE_THREAD_NO_FALLBACK` / `PROJECT_BINDING_E2E` / `CUSTOMER_BINDING_E2E` / `FAILED_BINDING_CANNOT_POISON_DEDUPE` / `FAILED_SCOPE_CANNOT_POISON_DEDUPE`。

## 8. 隔离库验证（§49）

Fresh 本地 PostgreSQL 17.11 + pgvector（scratchpad 一次性集群，用后销毁）；**走当前 main canonical DB-safety 链，零 bypass**：

| 项 | 结果 |
|---|---|
| `npm run db:target:check` | ALLOWED（目标一致） |
| `ALLOW_DATABASE_MIGRATION=true npm run db:migrate:deploy`（25 migrations 含 M2-2） | 全部成功 |
| `npm run db:migrate:status` | up to date |
| `verify-migration-history` | 67/67 |
| drift（migrate diff 实库 vs datamodel） | ChannelContextBinding / ExternalIdentity **零出现**；148 行均为 main 既有基线噪音 |

## 9. Flags 缺省（§48）/ 生产（§54）

`MENTION_GATEWAY_BINDING_SOURCE=fixture`、`MENTION_GATEWAY_BINDING_ADMIN_ENABLED=false`（.env.example 已记录）；既有 M0/M1/M2-A flags 全部不变。生产：零 migration 执行、零 env 变更、无真实 adapter、外发/记忆写仍硬关 —— M2-B merge ≠ production activate。

## 10. 已知限制 / M3 前置

1. 幂等仍 BEST_EFFORT（§37：InboundChannelEvent + durable unique(provider,tenant,providerEventId) 属 M3）
2. 真实 adapter（Slack/WeCom/personal WeChat cutover）与 ChannelProviderInstallation 未开始；slack ownership 恒 UNSUPPORTED
3. REVOKED exact key 的恢复/接替（supersession）属未来显式 recovery 设计
4. 管理面无 UI（API only）；平台管理员无 org membership 时 requireTenantContext 403（与 M2-A 同延后）
5. list 逐条 target-权限过滤为 O(n) 查询（take 100 上限内可接受；大规模需 M3 批量化）
