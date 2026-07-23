# Phase Security-1：企业身份锁定与统一权限底座 — 交付报告

**分支**：`feature/security-1-workforce-authorization-foundation`  
**基线**：Phase 3A Complete merge `19c1200` + 状态 `d6942f3`  
**差距审计**：`docs/SECURITY1_AUTHORIZATION_GAP_AUDIT.md`  
**交付日期**：2026-07-23  
**状态**：待独立 PR 验收（不合入 main；不启动 Security-2 / Phase 3B）

---

## 1. 现状问题（已对齐并修复）

| 问题 | 修复 |
|---|---|
| 平台 / 企业 / Workspace / 项目多套角色混用 | 企业业务数据改走 Permission + DataScope；平台角色仅保留平台能力 |
| `manager` 可访问 `/api/users` 全平台用户 | `canManageUsers` / `canDeleteUsers` 仅 `admin` / `super_admin` |
| `org_admin` ≡ 全部销售数据 | 销售改 `authorize()`；`org_admin` 默认无销售权限 |
| 左上角组织切换易误触 | 改为只读企业身份展示；切换移至 `/settings/account` |
| 多组织切换后缓存/草稿串企业 | 报价草稿 key 含 `orgId`+`userId`；切换走统一 API + 刷新 |
| 无 Principal / Scope 底座 | 新增 `src/lib/authorization/*` |

---

## 2. 新企业访问模式

Prisma：

```prisma
enum OrgAccessMode { FIXED MULTI_ORG PLATFORM_SUPPORT }
User.orgAccessMode  @default(FIXED)
User.canSelfSwitchOrg @default(false)
```

| 模式 | 行为 |
|---|---|
| `FIXED` | 默认；不可自助切换；日常使用 `activeOrgId` |
| `MULTI_ORG` | 需同时 `canSelfSwitchOrg=true` 且 active membership > 1；仅可在设置中切换 |
| `PLATFORM_SUPPORT` | 平台 admin/super_admin；不走普通企业切换器 |

**重要**：多个 active membership **不等于** 可自助切换。不得在迁移中自动授予 `canSelfSwitchOrg=true`。  
纠正迁移：`20260723040000_security1_fix_org_switch_grants`（撤销误开；admin→PLATFORM_SUPPORT；多 owner 可标 MULTI_ORG 但 `canSelfSwitchOrg=false`）。

`activeOrgId` 语义：**当前锁定的工作企业**（不新增第二个 currentOrgId）。

---

## 3. 左上角组织展示调整

- 组件：`OrgIdentityBadge`（`org-switcher` 仅 re-export）
- 展示：`青砚 × {企业名}` + 当前 Workspace
- **无**下拉箭头 / 组织列表 / 直接切换
- 点击最多进入企业首页

---

## 4. 组织切换流程

1. 用户打开 `/settings/account`
2. 仅当 `MULTI_ORG` + `canSelfSwitchOrg` + 多 active membership 显示「切换工作企业」
3. `POST /api/auth/switch-org` `{ orgId }`
4. 后端校验：登录、模式、自助开关、active membership、组织 active
5. 更新 `activeOrgId`、写 AuditLog、返回 Tenant 摘要
6. 前端清理缓存 / Workspace / 草稿上下文后跳转 `/` 并强制刷新

失败码：`ORG_SWITCH_NOT_ALLOWED` / `ORG_MEMBERSHIP_REQUIRED` / `ORG_INACTIVE` / `ORG_CONTEXT_INVALID`

列表仅来自用户自己的 `OrganizationMember`（禁止 `organization.findMany()` 全库）。

---

## 5. Owner / Admin 分离

| 角色 | 等级 | 默认职责 |
|---|---|---|
| `org_owner` | 40 | 企业负责人：权限蓝图 + 组织级业务只读（经 Permission） |
| `org_admin` | 30 | 系统管理员：成员 / Workspace / 配置；**默认无全部销售数据** |
| `org_member` | 20 | 普通成员（靠岗位模板） |
| `org_viewer` | 10 | 只读观察 |

迁移：`Organization.ownerId` → active membership `org_owner`；唯一 active owner 不可删除/降级（`owner-guard`）。

---

## 6. Permission Registry

`src/lib/authorization/permissions.ts`

含：`organization.*`、`identity.member.*`、`sales.customer|opportunity|quote|analytics.*`、`operations.*`、`project.*`、`authorization.policy.*`、`audit.read`。

每条含：`key / resource / action / label / description / allowedPrincipalTypes / supportedScopes / riskLevel`。

---

## 7. Role Profile

模型：`RoleProfile`、`RolePermissionBinding`、`PrincipalRoleBinding`

- `principalType` + `principalId`（HUMAN 第一版 = `User.id`）
- 系统模板见 `role-defaults.ts`
- 解析：`resolveEffectiveBindings`（DB 绑定优先，兼容回退 membership / 平台 sales）

---

## 8. Position Template

模型：`PositionTemplate`；系统岗位：企业负责人 / 企业管理员 / 销售经理 / 销售人员 / 运营经理 / 运营人员 / 项目经理 / 只读观察员。

Seed：`npx tsx scripts/seed-security1-authorization.ts`

---

## 9. Data Scope

| Scope | 本阶段 |
|---|---|
| `NONE` / `PRINCIPAL` / `ASSIGNED` / `ORG` | 启用 |
| `SPONSOR` / `GROUP` / `TEAM` / `WORKSPACE` / `EXPLICIT` | 枚举预留；遇则 **fail closed** |

销售映射：

- `PRINCIPAL` → `createdById`
- `ASSIGNED` → `assignedToId`（商机）
- `ORG` → `orgId`

禁止未实现 Scope 静默扩为 ORG。

### DENY 语义（V1 锁定）

同一 `permission` 存在**任意** `DENY` binding → **整个 permission 拒绝**（不是按 scope 局部拒绝）。

例：`ALLOW sales.customer.read:ORG` + `DENY sales.customer.read:PRINCIPAL` → 仍全部拒绝。  
本阶段不实现 scope-aware DENY。

---

## 10. Principal 兼容设计

```ts
type PrincipalRef = {
  type: "HUMAN" | "DIGITAL_EMPLOYEE";
  id: string;
  orgId: string;
  sponsorUserId?: string;
};
```

`DIGITAL_EMPLOYEE` → `NOT_IMPLEMENTED`（fail closed）。不强制 `Principal` 总表。

---

## 11. 销售模块迁移

| API | 变化 |
|---|---|
| `/api/sales/customers` | `buildAuthorizedWhere` + create 鉴权 |
| `/api/sales/customers/[id]` | 资源级 `authorize` |
| `/api/sales/opportunities*` | 读/写走 opportunity 权限；创建前校验客户权限 |
| `/api/sales/quotes*` | 创建前校验客户 + 商机权限 |
| `/api/sales/analytics/*` | `sales.analytics.read` |
| `/api/sales/reps` | 需 ORG 级客户读，不再 `org_admin` |

`resolveSalesScope` 已改为基于 `authorize()`；**不再** `org_admin → ownOnly=false`。

---

## 12. manager 风险修复

- `canManageUsers` / `canDeleteUsers`：仅平台 `admin` / `super_admin`
- `/admin/users`、`/api/users`：manager 不可访问
- 企业成员管理走 `/organizations/[orgId]/members`，按当前组织过滤

---

## 13. 成员隐私

成员目录：

| 权限 | 可见字段 |
|---|---|
| 无 `identity.member.read` | `userId` / displayName / avatar |
| `identity.member.read`（或 org_owner/admin 兼容） | 姓名 / 头像 / 岗位 / Workspace / 状态 |
| `identity.member.manage` | + 邮箱 / 组织角色 / 访问模式等 |

---

## 14. API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST/GET | `/api/auth/switch-org` | 统一切换（闸门校验） |
| PATCH | `/api/auth/active-org` | MULTI_ORG 委托 switch；FIXED hydrate-only |
| — | `authorize` / `buildAuthorizedWhere` / `authorizeMutation` | 库内服务 |

业务请求 `body.orgId`：仅交叉校验，不可覆盖 `activeOrgId`（不一致 → `ORG_CONTEXT_MISMATCH`）。

---

## 15. Schema / Migration

| Migration | 内容 |
|---|---|
| `20260723010000_security1_org_access_mode` | `OrgAccessMode` + User 字段 |
| `20260723020000_security1_org_owner` | owner → `org_owner` |
| `20260723030000_security1_role_profiles` | RoleProfile / Binding / PositionTemplate |
| `20260723040000_security1_fix_org_switch_grants` | 纠正误开 MULTI_ORG/canSelfSwitchOrg |

回填（纠正后）：

- 普通用户默认 `FIXED` + `canSelfSwitchOrg=false`（即使多 membership）
- 平台 `admin`/`super_admin` → `PLATFORM_SUPPORT`
- 多企业 `ownerId` → 可标 `MULTI_ORG` 但 `canSelfSwitchOrg=false`（需平台显式开启自助切换）
- 单 membership → 修复 `activeOrgId`；多 membership 无效 activeOrgId → warning，不随机选
- 平台 `sales` + `org_member` → sales_rep（兼容/seed）；**`trade` 不映射销售**

---

## 16. Sunny 验收

### 验收组织

| 组织 | code | 状态 |
|---|---|---|
| Sunny Home & Deco | `sunny-home-deco` | active（验收主组织） |
| Sunny Shutter --Bid Lead | `sunny-shutter-bid-lead` | archived（**未搬迁历史数据**） |

### 验收账号

| 身份 | Email | OrgRole | RoleProfile | OrgAccessMode | canSelfSwitchOrg |
|---|---|---|---|---|---|
| 企业负责人 | `security1-owner@test.qingyan.ai` | org_owner | org_owner | FIXED | false |
| 企业管理员 | `security1-admin@test.qingyan.ai` | org_admin | org_admin | FIXED | false |
| 销售 A | `alex@sunnyshutter.ca` | org_member | sales_rep | FIXED | false |
| 销售 B | `security1-sales-b@test.qingyan.ai` | org_member | sales_rep | FIXED | false |

准备：`scripts/security1-prepare-preview-qa.ts`。仅为 Alex **新增** Sunny Home & Deco membership；archived Bid Lead 历史业务数据未迁移；其 archived membership 已 inactive。

### 结果

- [x] API 验收 31/31（`scripts/security1-preview-api-acceptance.ts`）
- [x] 销售 A：左上角只读、设置无切换、仅见自己客户、跨销售 403
- [x] 企业管理员：成员可管；销售 API 403（`NO_BINDING`）；`/admin/users` 403
- [x] 企业负责人：可见 A/B 客户与分析；跨梦馨资源拒绝
- [x] UI 截图：`docs/security1-screenshots/sunny-*.png`

---

## 17. 梦馨验收

| 身份 | Email | platform | OrgRole | RoleProfile | 模式 |
|---|---|---|---|---|---|
| 外贸员工 | `security1-trade@test.qingyan.ai` | trade | org_member | 无（禁止 sales_rep） | FIXED |

- [x] 自动进入梦馨；左上角不可切换
- [x] 无销售客户读权限；trade 不映射 sales_rep
- [x] 不能访问 Sunny 销售资源
- [x] 草稿 key 含独立 orgId（见准备脚本 draftKeyExamples）
- [x] UI 截图：`mengxin-trade-*.png`

---

## 18. 多组织验收

| 身份 | Email | 说明 |
|---|---|---|
| 双租户 QA | `security1-multi@test.qingyan.ai` | 专用 MULTI_ORG + canSelfSwitchOrg；**非**平台 admin |

> `nav-qa@test.qingyan.ai` 为平台 admin，不用作普通 MULTI_ORG 切换验收。

- [x] 左上角只读；仅 `/settings/account` 显示「切换工作企业」
- [x] 列表仅 Sunny + 梦馨；无 archived / 其他组织
- [x] 切换后 AuditLog `org.switch_active` before/after 正确
- [x] UI 截图：`multi-org-*.png`

---

## 19. 测试与 Preview

| 项 | 结果 |
|---|---|
| Vercel Preview | **SUCCESS**（SSO Protection 阻挡无登录 curl；同 Head 本地 `next start` + 共享 Neon 完成 UI/API 验收） |
| Preview URL | `https://git-feature-security-1-workforce-a-233948-lucas-9039s-projects.vercel.app` |
| `migrate reset --force` | **N/A**：无隔离本地 PostgreSQL；禁止 wipe 共享 Neon。真实 migrate deploy + Smoke + DB 探针已通过 |
| API 验收 | 31/31 |
| 截图 | `docs/security1-screenshots/`（含要求的 7 张 + 补充） |
| 基线失败 | Image Engine FormData；AI 分类 401；Agent Trace 假 orgId / Reservation FK（据实） |

另：`resolveTradeOrgId` 已按 Security-1 改为优先 `activeOrgId`（query/body orgId 仅交叉校验）。

---

## 20. 已知限制

1. 完整数字员工 / Assignment / Group 执行未实现（预留 fail closed）。
2. TEAM / WORKSPACE scope 未启用（销售经理暂用 ORG）。
3. 权限拖拽编辑器未做（仅模型 + seed）。
4. 运营 / 项目模块尚未全量迁移到 authorize（仅销售）。
5. 导航仍部分兼容平台 `requiredPlatformRoles`（可叠加 `requiredPermissions`，未重做 IA）。
6. `PLATFORM_SUPPORT` 无完整支持访问流程。
7. Cockpit / appointments 等仍用 `resolveSalesScope` 兼容层（已不再给 org_admin 全量销售）。
8. 基线已知失败（见下）未伪造通过。

### 基线已知失败（据实）

| 项 | 状态 |
|---|---|
| Image Engine FormData | 既有基线失败 |
| AI 分类 API 401 | 既有基线失败 |
| Agent Trace 假 orgId / Reservation FK | 既有基线失败 |

本阶段未改相关路径则保持独立记录。

---

## 21. 回滚方案

1. **代码**：revert 本分支 commits（`2a535c1`…交付 commit）。
2. **数据**：
   - RoleProfile 表可保留（无害）或 DROP 四张新表；
   - `org_owner` 可改回 `org_admin`（注意唯一 owner）；
   - `OrgAccessMode` 列可保留默认 FIXED。
3. **Seed**：`seed-security1-authorization` 幂等 upsert，回滚时无需强制反 seed。
4. **切流**：先关 `canSelfSwitchOrg`，再回退销售 API。

---

## 22. Security-2 建议（不自动开始）

1. 运营 / 项目 / 外贸模块接入 `authorize` + DataScope。
2. 启用 `TEAM` scope（销售经理团队）。
3. Group Scope 执行 + 临时事件 Group。
4. 数字员工 Principal 解析与 Assignment。
5. 权限蓝图 UI（岗位模板编辑）。
6. 导航全面 `requiredPermissions`。
7. 评估 OpenFGA / Cerbos（非必须）。

---

## Commit 序列

| # | Commit | 说明 |
|---|---|---|
| 0 | `2a535c1` | 差距审计 |
| 1 | `69a6962` | 企业身份锁定 + 设置切换 |
| 2 | `4aba8d8` | Owner 分离 + manager 修复 |
| 3 | `7e5ca9c` | RoleProfile / Permission / Scope 底座 |
| 4 | `fad155c` | 销售统一授权 |
| 5 | （本文件） | 交付收口 |

---

## 最终验收对照（20 条）

1–6 企业身份与切换 ✅  
7–8 Owner/Admin 分离与业务数据分离 ✅  
9–10 manager / 企业成员边界 ✅  
11–13 销售 Scope + 统一授权服务 ✅  
14–15 Principal / GROUP 预留 fail closed ✅  
16 Sunny/梦馨隔离（需验收清单勾选）  
17 Phase 3A 无回归（跑回归后据实记录）  
18 未改一级导航 IA ✅  
19 未开始完整 Group/数字员工 ✅  
20 独立 PR，等待验收 ✅  
