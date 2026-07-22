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
| `PLATFORM_SUPPORT` | 预留；本阶段无普通切换入口 |

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

回填：多 membership → `MULTI_ORG`+`canSelfSwitchOrg`；单 membership 保持 FIXED；销售平台角色 → sales_rep 绑定（seed）。

---

## 16. Sunny 验收（清单）

- [ ] 普通销售登录进入 Sunny，左上角只读
- [ ] 销售只见自己客户；不能用他人客户 ID 建商机/报价
- [ ] 企业负责人可见组织级销售
- [ ] 企业管理员无销售权限时看不到全部客户
- [ ] `/settings/account` FIXED 无切换按钮

---

## 17. 梦馨验收（清单）

- [ ] 梦馨成员无法读 Sunny 客户/报价
- [ ] activeOrgId=梦馨 时用 Sunny 资源 ID → 404/403
- [ ] 草稿 key 含 orgId，切换后不串

---

## 18. 多组织验收（清单）

- [ ] MULTI_ORG 用户可在设置切换；FIXED 不可
- [ ] 切换后导航 / Workspace / 报价草稿隔离
- [ ] 无 membership 企业不可见

---

## 19. 测试

| 套件 | 命令 |
|---|---|
| Org Access | `npx tsx src/lib/organizations/__tests__/org-access.test.ts` |
| Owner/Manager | `npx tsx src/lib/rbac/__tests__/security1-owner-manager.test.ts` |
| Authorization | `npx tsx src/lib/authorization/__tests__/authorize.test.ts` |
| Sales Authz | `npx tsx src/lib/sales/__tests__/security1-sales-authz.test.ts` |
| 汇总 | `./scripts/test-all.sh` |

已覆盖：FIXED 不可切、DENY/未知权限/GROUP fail closed、org_admin 无销售、PRINCIPAL+ASSIGNED where、manager 无平台用户管理等。

回归执行（2026-07-23）：

| 检查 | 结果 |
|---|---|
| `prisma validate` / `migrate status` / `generate` | 通过 |
| Security-1 四套单测 | 41 passed |
| `tsc --noEmit` | 通过 |
| `./scripts/test-all.sh` | 通过（含既有 Agent Trace / Runtime 基线 warning） |
| `next build` | 通过（Compiled + TypeScript） |

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
