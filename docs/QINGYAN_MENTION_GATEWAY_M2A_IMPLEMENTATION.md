# Qingyan Mention Gateway — M2-A Persistent External Identity 实施报告

- 日期：2026-08-24
- 分支：`feature/qingyan-mention-gateway-m2-a-external-identity`（base = origin/main `fbae6fb9`，即 M2-C PR #156 merge 后）
- 范围：**仅 M2-A**（ExternalIdentity 持久化 + 身份生命周期 + DB 身份源 + legacy 回填）。M2-B（ChannelContextBinding）未开始；频道绑定仍为 fixture。
- 设计基线：`docs/QINGYAN_MENTION_GATEWAY_M2_ARCHITECTURE.md`（含 §29 as-built 对齐）

---

## 1. Final Security Amendments（冻结）

### A1 — SELF_LINK = DEFERRED（M3）

不实现 `POST /api/mention-gateway/identities/link`。理由：自助 link 即便只产生 PENDING，也会**占用唯一键** `(provider, providerTenantId, providerUserId)`——任何登录用户可抢注他人的外部身份（identity-key squatting），阻塞管理员后续 provision，构成低成本 DoS。没有 proof-of-possession（PROVIDER_CHALLENGE / OAUTH / SIGNED_EVENT）之前，自助申请没有安全的落点。

M2-A 身份仅两个来源：

| 来源 | verificationMethod | 产生状态 |
|---|---|---|
| 管理员 provision（API） | `ADMIN_PROVISIONED` | ACTIVE（ownership OWNED 前提下） |
| legacy 回填（脚本） | `LEGACY_SELF_ASSERTED` | ACTIVE / PENDING / REVOKED / DISABLED（按 binding/user/gateway 状态映射） |

测试 M2A-15 以文件系统断言 `identities/` 下无 `link/` 路由，且全部写端点挂 `requireIdentityAdminContext`。

### A2 — NO BLIND UPSERT

写路径零 `upsert`。唯一键语义由纯函数 `decideProvisionOutcome` 冻结：

- 不存在 → CREATE（事务内 create + audit；并发 P2002 → 视同 CONFLICT）
- 已存在且**属其它用户** → `CONFLICT`：DB 零修改、错误响应不泄露 existing userId（DB-6 断言）
- 已存在且同用户：ACTIVE/ADMIN → IDEMPOTENT（无写）；PENDING 或 ACTIVE/LEGACY → NEEDS_VERIFY；DISABLED → NEEDS_ENABLE；REVOKED → NEEDS_RELINK（终态恢复必须显式 relink）
- 永不把非 LEGACY 的 verified 身份降级为 `LEGACY_SELF_ASSERTED`（回填 STRONGER_PRESERVED；verify 只升不降）

---

## 2. Schema 变更（唯一 migration M2-1）

### 2.1 Prisma diff（`prisma/schema.prisma`）

新增 `model ExternalIdentity`（文件尾部）+ `User.externalIdentities ExternalIdentity[] @relation("UserExternalIdentities")`：

- 键：`id cuid`；`@@unique([provider, providerTenantId, providerUserId])`
- 归属：`userId → User onDelete: Cascade`。**无 orgId**（EXTERNAL_IDENTITY_DOES_NOT_GRANT_ORG_ACCESS：org 每次由 OrganizationMember + resolveAgentTenant 推导）
- 状态：`status TEXT default "PENDING"`（PENDING/ACTIVE/DISABLED/REVOKED）；`verificationMethod TEXT?`
- 元数据：verifiedAt/verifiedById、linkedAt/linkedById、lastSeenAt、revokedAt/revokedById/revokeReason、createdAt/updatedAt
- 索引：`[userId, status]`、`[provider, providerTenantId, userId]`、`[status, updatedAt]`
- 数据最小化：不存 profile / avatar / email / token / 消息正文

### 2.2 Migration

- 名称：`prisma/migrations/20260824170000_add_mention_gateway_external_identity/migration.sql`（无命名冲突）
- 内容：CreateTable + 唯一索引 + 3 索引 + FK + **2 个 CHECK 兜底约束**（`ExternalIdentity_status_check`、`ExternalIdentity_verification_method_check`；Prisma 不建模 CHECK，应用层为主，DB 兜底，additive 可独立 DROP 回滚）
- 纯 additive：无 ALTER 业务列 / 无 DROP / 无 RENAME / 无数据回填（回填是独立脚本）
- SHA256：`65d282a8fd2fef8d6ebd3c0499f4e67ac19cd374caf12536bd53f028b1bde3b1`
- 治理三件套同步：`src/lib/release/expected-migrations.ts`（追加 active 名单）、`scripts/verify-migration-history.ts`（IMMUTABLE 表新增本条 checksum，历史条目零改动）、`scripts/check-release-safety.test.ts`（有序清单 + 标签 `+ MentionGatewayExternalIdentity`）
- **未执行** `prisma db push`；**未触碰**任何生产库（生产部署走 safe-migrate-deploy runbook，不在本 PR）

---

## 3. Provider Tenant Ownership Gate（P0）

`src/lib/mention-gateway/provider-tenant-ownership.ts`。任何 ACTIVE transition（provision / verify / relink / enable）前**重新判定**，结果不跨请求缓存；API body 的归属声明一律不可信。

| provider | 可信事实源 | 判定 |
|---|---|---|
| `mock` | 固定租户 `"mock"` | tenant ≠ "mock" → MISMATCH；生产运行时（`isMentionMockRuntimeAllowedWithEnv` 为 false，含环境声明冲突）→ UNSUPPORTED；否则 OWNED |
| `personal_wechat` | `WeChatGateway.id` | 网关不存在/channel 不符 → UNPROVEN；`orgId ≠ 目标 org` → MISMATCH；`status ≠ active` → INACTIVE；全匹配 → OWNED |
| `wecom` | 目标 org 的 org 级 `WeChatGateway.corpId` | 无网关 → UNPROVEN；目标 org 网关 → OWNED/INACTIVE；**仅平台共享网关（`PLATFORM_WECOM_ORG_ID = "__qingyan_platform__"`）命中 → UNPROVEN**（仓库运行期解析是 WeChatBinding→用户级，不存在可信 platform→org 映射，**不得猜**）；CorpID 属其它真实 org → MISMATCH |
| `slack` / 未知 | 无 ChannelProviderInstallation | UNSUPPORTED（M3 安装模型后开放） |

非 OWNED → `PROVIDER_TENANT_UNVERIFIED`（HTTP 422），**不创建任何行**（含 PENDING 占位；DB-7 断言 count 不变）。

## 4. 身份生命周期服务

`src/lib/mention-gateway/identity-service.ts`（唯一写入口；API 是薄壳；AI / runtime 绝不调用写函数）：

- 状态机：PENDING → ACTIVE ⇄ DISABLED → REVOKED（终态；恢复只能显式 relink）
- `adminProvisionIdentity`：caller 需目标 org 在职 membership + `hasOrgPermission(role, ORG_MEMBER_ROLE_CHANGE)`（org_admin/org_owner）；target 需本 org 在职成员且账号 active；ownership OWNED；按 §1.A2 决策
- `verifyIdentity`：PENDING → ACTIVE，或 ACTIVE+LEGACY → 方法升级 ADMIN_PROVISIONED；重验 caller/target/ownership
- `relinkIdentity`：old→new 显式改绑（REVOKED 恢复唯一路径）；old user 必须仍是本 org 成员（非在职 → OLD_USER_NOT_MANAGEABLE 409，跨 org 改绑属平台流程，M2-A 未开放）；清空 revoke 字段；审计 before/after
- `disableIdentity` / `enableIdentity`：ACTIVE|PENDING → DISABLED；DISABLED → ACTIVE（enable 前重验 target + ownership，网关失活即拒 — DB-11 实测）
- `revokeIdentity`：本人（`findFirst({id, userId: caller})`，IDOR 免疫）或管理员；REVOKED 终态
- 全部写 `db.$transaction(tx)` + `writeAuditLog(tx, …)`（**不是** fire-and-forget `logAudit`）；审计失败 → 整体回滚（DB-15 以事务中断证明回滚语义）
- 管理读/写的对象定位一律 `loadManageableIdentity`：identity.userId 非本 org 在职成员 → 视同不存在（跨 org 404，不泄露存在性）

审计动作（`AUDIT_ACTIONS` 新增）：`external_identity_provision / verify / relink / status_change / revoke / backfill`。`providerUserId` 永不以 raw 形态入审计/日志——只存 `sha256(providerUserId)` 截断 16 位（`hashProviderUserId`）。

## 5. API（最小面；SELF_LINK 无）

全部 `withAuth`；写端点再叠 `requireIdentityAdminContext` = `MENTION_GATEWAY_IDENTITY_ADMIN_ENABLED`（缺省 false，即缺省 404）→ `requireTenantContext`（服务端解析 org，绝不来自 body）→ `hasOrgPermission(ORG_MEMBER_ROLE_CHANGE)` → rate limit（30/min）。body 全部 zod `.strict()`，**不接受** orgId / status / verifiedAt / verifiedById / linkedById。

| 端点 | 语义 |
|---|---|
| `GET /api/mention-gateway/identities` | 本人列表；`?userId=` 管理员视角（目标须共享 org） |
| `POST /api/mention-gateway/identities/provision` | `{provider, providerTenantId, providerUserId, targetUserId}` → ADMIN_PROVISIONED ACTIVE |
| `POST /api/mention-gateway/identities/:id/verify` | PENDING→ACTIVE / LEGACY 升级 |
| `POST /api/mention-gateway/identities/:id/relink` | `{newUserId, reason?}` |
| `POST /api/mention-gateway/identities/:id/disable` / `enable` | 状态切换 |
| `DELETE /api/mention-gateway/identities/:id` | revoke；缺省本人路径，`?scope=admin` 管理员路径 |

平台管理员无 org membership 时 `requireTenantContext` 返回 403 —— 平台级 provisioning 顺延（记录于已知限制，不加 bypass）。

## 6. Mention Gateway DB 身份源

- `MENTION_GATEWAY_IDENTITY_SOURCE`：缺省/`fixture` → M1 fixture 语义不变；`db` → `lookupExternalIdentityRecord`（只读 findUnique，最小投影，**不写 lastSeenAt**，DB-14 实测零写）；**非法值 → `resolveMentionIdentitySourceWithEnv` 返回 null → 网关 `GATEWAY_DISABLED`（fail-closed，绝不 fallback fixture）**；DB 异常 → `identity_lookup_error` → `IDENTITY_OR_MEMBERSHIP_DENIED`（对外不泄内因）
- `MENTION_GATEWAY_REQUIRE_VERIFIED_IDENTITY`：缺省 **true** —— `LEGACY_SELF_ASSERTED` 的 ACTIVE 身份仍拒（`identity_unverified`）；仅显式 `0/false/off/no` 放行
- 状态门：`status ≠ ACTIVE` → `identity_not_active`（PENDING/DISABLED/REVOKED 全拒）
- 身份通过后链路**不变**：User(active) → active OrganizationMember → pickMembershipOrg → resolveAgentTenant(hasMembership) → binding → resolveAgentScope → M2-C 上下文工具面 → l0_read → initiating_user_only。身份表不授予任何 org 权限（E2E-5：membership inactive → 拒）

### providerTenantId 贯穿

- `MentionEvent.providerTenantId`（必填，server-authoritative）：mock 适配器**忽略** body 声明并固定 `"mock"`（Attack E，M2A-14）
- 键全部含 tenant 段（仍 BEST_EFFORT）：conversationKey `provider:tenant:channel:thread`、userMessageId `provider:tenant:channel:message`、dedupeKey `provider:tenant:org:user:channel:eventId`；同 channel/eventId 不同 tenant 零碰撞（M2A-13）

## 7. Legacy 回填（WeChatBinding → ExternalIdentity）

`src/lib/mention-gateway/backfill.ts`（纯决策）+ `scripts/backfill-external-identity-from-wechat-binding.ts`（IO）：

- 安全：`assertSafeTestDatabase` fail-closed（生产任何信号组合 HARD BLOCK；本 PR **无** production override）；缺省 dry-run，`--write` 显式
- canonical tenant：personal_wechat → binding.orgId 的网关 `WeChatGateway.id`；wecom → org 级网关 `corpId`；解析不出（无 org / 平台 org 占位 / 无网关 / corpId 空 / 未知 channel）→ **仅 UNRESOLVED 报告**，绝不写 `"unknown"`/`"legacy"`/orgId 顶替
- 状态映射：user inactive → DISABLED；binding disconnected/expired → REVOKED；active+gateway active → ACTIVE（方法仍 LEGACY_SELF_ASSERTED，缺省照样被 REQUIRE_VERIFIED 拒）；gateway 失活 → PENDING(gateway_inactive)
- 决策（Attack C 防线）：键属他人 → CONFLICT 零修改；同用户更强方法 → STRONGER_PRESERVED；同用户 LEGACY → no-op 或仅 ACTIVE/PENDING → REVOKED/DISABLED 单调收敛（**绝不复活** REVOKED/DISABLED）
- 幂等：按唯一键 find→decide；重复 `--write` 零新增（DB-16 实测）；创建/收敛均事务内写 `external_identity_backfill`/`status_change` 审计
- 日志仅 bindingId + reason + hash（不含 raw externalId；DB-16 断言输出）

## 8. 隔离库验证（本地 PostgreSQL 17.x + pgvector 0.8.6）

一次性本地集群（scratchpad `initdb`，port 54329，用后销毁；`assertSafeTestDatabase` localhost ALLOW）：

| 项 | 结果 |
|---|---|
| `prisma migrate deploy`（main 全量 24 个 + M2-1） | **全部成功** |
| `prisma migrate status` | `Database schema is up to date!` |
| `verify-migration-history.ts` | 65/65 pass |
| drift（`migrate diff` 实库 vs datamodel） | **ExternalIdentity 零 drift**（diff 中 0 次出现）；148 行 diff 全部为 main 既有基线噪音（历史 FK ON DELETE 差异、TenderRequirement 遗留、索引名 63 字符截断重命名），与本 PR 无关 |
| `m2a-identity-db.isolated.test.ts` | **57/57**（唯一键 P2002、CHECK 拒非法值、级联删、provision+audit 原子、幂等、Attack B 不接管、UNPROVEN 零占位行、跨 org IDOR、verify/disable/enable/revoke/relink 全生命周期 + 审计计数、enable 重验 ownership、self-revoke IDOR、lookup 零写、事务回滚、回填 dry-run→write→幂等→Attack C） |
| `m2a-db-identity-e2e.isolated.test.ts` | **25/25**（DB 身份 + 真实 membership/Project/resolveAgentScope + fixture 绑定 + M2-C 8 工具面 + B2 事件序；PENDING/LEGACY/移除 membership/跨 tenant 全拒；失败不污染 dedupe；非法 source → GATEWAY_DISABLED） |

## 9. 测试矩阵（新增/更新）

| 套件 | 断言 | 摘要 |
|---|---|---|
| `m2a-identity-policy.test.ts`（纯，进 test:ci + test-all） | 96 | flags fail-closed、键归一化、ownership 全矩阵（mock 生产 / platform corp / slack）、decideProvisionOutcome（Attack B）、回填纯函数（Attack C）、租户键隔离、适配器 tenant 伪造（Attack E）、SELF_LINK 缺席（fs）、resolver 状态/验证门 |
| `m2a-identity-db.isolated.test.ts`（隔离库） | 57 | 上表 §8 |
| `m2a-db-identity-e2e.isolated.test.ts`（隔离库） | 25 | 上表 §8 |
| 既有套件（fixture 缺省语义不变） | m0 95 / m1-gateway 70 / m1-static 279 / m1-final-review 72 / m1-tool-policy 124 / m2c 105 | 仅 providerTenantId 键面与 fixture 3 参签名更新；全绿 |

安全断言（全 PASS）：`IDENTITY_TAKEOVER_BLOCKED`、`BACKFILL_CANNOT_OVERWRITE_VERIFIED`、`TENANT_FORGERY_BLOCKED`、`TENANT_KEY_ISOLATION`、`SELF_LINK_ABSENT`、`UNVERIFIED_IDENTITY_DENIED`（纯 + E2E）、`OWNERSHIP_GATE_FAIL_CLOSED`、`DB_IDENTITY_E2E`、`PENDING_IDENTITY_DENIED`、`MEMBERSHIP_REVOCATION_ENFORCED`、`TENANT_BOUNDARY_ENFORCED`、`IDENTITY_SOURCE_FAIL_CLOSED`。

## 10. Flags（`.env.example` 已记录）

| Flag | 缺省 | 语义 |
|---|---|---|
| `MENTION_GATEWAY_IDENTITY_SOURCE` | `fixture` | `db` 启用持久身份；非法值 fail-closed GATEWAY_DISABLED |
| `MENTION_GATEWAY_REQUIRE_VERIFIED_IDENTITY` | `true` | LEGACY_SELF_ASSERTED 拒；仅显式 0/false/off/no 放行 |
| `MENTION_GATEWAY_IDENTITY_ADMIN_ENABLED` | `false` | 身份管理 API 总开关（写全部 404） |

生产完全不受影响：三个 flag 均未在任何环境配置；`MENTION_GATEWAY_ENABLED` 仍关。

## 11. DO NOT TOUCH 证据

`git diff origin/main --name-only` 不含：`src/lib/messaging/gateway.ts`、`src/lib/messaging/adapters/*`、`src/app/api/messaging/*`、`src/lib/agent-runtime/process*`、Workforce/Runtime V2、既有迁移目录。对 messaging 仅 **import** `PLATFORM_WECOM_ORG_ID` 常量（只读）。agent-core / agent-scope 本轮零改动（M2-C 的 3 文件维持原样）。

## 12. 已知限制 / M2-B 前置

1. 频道绑定仍 fixture（M2-B：ChannelContextBinding 表 + binding API + precedence；migration `M2-2` 名字空间已预留）
2. 幂等 BEST_EFFORT（进程内 dedupe + org 作用域 userMessageId）；STRONG 去重待 M3 InboundChannelEvent
3. 平台管理员（无 org membership）不能用身份管理 API（requireTenantContext 403）；平台级 canonical flow 顺延
4. slack ownership UNSUPPORTED，personal_wechat/wecom 依赖 WeChatGateway 现状（secret 明文等 R4 遗留不在本 PR）
5. lastSeenAt 暂无写入方（读路径刻意零写；未来由已验签 inbound 事件更新）
6. 回填脚本无 production override —— 生产运行需后续显式 runbook PR

## 13. 门禁结果

见 PR 描述与最终交付块：typecheck 0 错、eslint 基线 PASS（error 出现数较基线 -12）、test:ci PASS、test-all 与 main 基线逐条一致（12 项环境性失败，全部 MISSING_DATABASE_URL/Gmail 环境门）、build PASS、治理测试 27/27 + 65/65。
