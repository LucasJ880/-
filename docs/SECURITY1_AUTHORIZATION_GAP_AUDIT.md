# Phase Security-1：企业身份锁定与统一权限底座 — 差距审计

**分支**：`feature/security-1-workforce-authorization-foundation`  
**基线**：Phase 3A Complete merge `19c1200` + 状态记录 `d6942f3`  
**审计日期**：2026-07-22  
**目的**：锁定七项范围，防止权限改造无限扩张。

---

## 范围锁定（只做七项）

| # | 项 | 本阶段 |
|---|---|---|
| 1 | 普通员工企业身份锁定 | ✅ |
| 2 | 多组织切换移至个人设置 | ✅ |
| 3 | Owner 与 Org Admin 分离 | ✅ |
| 4 | 修复 manager 跨组织用户管理风险 | ✅ |
| 5 | Permission Registry + Role Profile + Data Scope | ✅ |
| 6 | 销售模块接入统一数据范围 | ✅ |
| 7 | Principal 兼容结构（数字员工 / Group 预留） | ✅ |

**明确不做**：完整数字员工运行、Assignment、Group 执行、OpenFGA/Cerbos、全业务迁移、跨企业协作、Phase 3B、主导航 IA 重设计。

---

## 四层角色并存（现状）

| 层 | 字段 | 真相源文件 |
|---|---|---|
| 平台 | `User.role` | `src/lib/rbac/roles.ts`、`capabilities.ts` |
| 企业 | `OrganizationMember.role` | `roles.ts`、`permissions.ts` |
| Workspace | `WorkspaceMember.role` | `src/lib/tenancy/workspace-rbac.ts` |
| 项目 | `ProjectMember.role` | `roles.ts`、`permissions.ts` |

另有：`User.activeOrgId`（`src/lib/organizations/active-org.ts`）、`Organization.ownerId`（与 membership 可漂移）。

---

## 审计明细

### A. 平台角色使用点

| 位置 | 行为 | 风险 | 本阶段态度 |
|---|---|---|---|
| `ROLE_CAPABILITIES.dataScope` | `admin`→all，其余→own | 平台角色决定业务可见性 | 销售迁移后不再作为销售真相源 |
| `canManageUsers` | `admin`/`super_admin`/`manager` | **manager 全平台列用户** | **P0 修复**：仅平台 admin |
| `canDeleteUsers` | 含 manager | manager 可软删非管理员 | **P0 修复** |
| 运营多 API 复用 `canManageUsers` | manager 可写运营 | 语义混淆 | 本阶段拆分门禁；运营写权限留 Security-2 细化 |
| `isSuperAdmin` / `isAdmin` | 含 `admin` | 命名误导 | 保留兼容；新授权服务不依赖 |
| 导航 `requiredPlatformRoles` | 销售依赖平台 sales | 岗位与平台混用 | 增加 `requiredPermissions` 优先 |

### B. 组织角色使用点

| 位置 | 行为 | 风险 | 本阶段态度 |
|---|---|---|---|
| `resolveSalesScope` | `org_admin`→`ownOnly=false` | **管理员=全部销售数据** | **迁移销售**：改为 permission+scope |
| `projects/access.ts` | `org_admin` 可读/写项目 | 偏宽 | 本阶段不改项目；记入 Security-2 |
| `tool-auth.ts` | org_admin 满足 admin 工具标签 | Agent 抬权 | 记入后续 |
| `permissions.ts` ORG_* | 成员邀请/改角色仅 org_admin | 合理但无 owner | 引入 `org_owner` |
| 无 `org_owner` | ownerId 与 role 脱节 | 唯一负责人不可靠 | **本阶段迁移** |

### C. API 依赖前端 orgId

| 模式 | 文件 | 问题 |
|---|---|---|
| `searchParams.orgId` / `body.orgId` | `resolve-request-org.ts`、`sales/org-context.ts`、`trade/access.ts`、大量 sales/ops/marketing API | 多组织用户靠客户端选 org；可隐式切上下文 |
| `api-fetch` 自动附 orgId | `src/lib/api-fetch.ts` | 读 `qingyan_selected_org_id` | 与服务端 activeOrgId 可能短暂不一致 |
| Session JWT | 不含 orgId | 文档已记 | FIXED 后应以 `activeOrgId` 为准，body 仅交叉校验 |

### D. 缺少组织过滤的查询

| 位置 | 问题 | 优先级 |
|---|---|---|
| `listUsers` / `GET /api/users` | 全表用户，无 org 过滤 | P0 |
| `GET /api/sales/measurements` | GET 无 org 作用域 | 本阶段销售迁移顺带或记缺口 |
| `buildProjectVisibilityWhere` | 组织内全员可见项目列表 | Security-2 |
| 企微 gateway `findFirst` membership | 任意 org_admin 可操作平台网关 | Security-2 |

### E. 组织切换 UI

| 位置 | 现状 | 本阶段 |
|---|---|---|
| `src/components/org-switcher.tsx` | 侧栏下拉可切换任意 membership | **改为只读企业身份展示** |
| `sidebar.tsx` / `mobile-nav-drawer.tsx` | 挂载 OrgSwitcher | 改为只读组件 |
| `/select-org` | 多组织强制选一次 | FIXED 用户不再需要；MULTI_ORG 保留兼容入口或引导至设置 |
| `/organizations`「设为当前」 | 可切换 | MULTI_ORG 可保留；FIXED 隐藏 |
| Header | 无 switcher | 保持 |
| `/settings/*` | **无**「账号与企业」切换页 | **新增** |

### F. 缓存 / 草稿未含 orgId

| Key / 资源 | 位置 | 问题 |
|---|---|---|
| `qingyan:quote-sheet-draft:v1` | `sales/quote-sheet/quote-draft.ts` | **全局单键，串企业** → 必须修复 |
| `qingyan_selected_org_id` | `org-selection.ts` | 正式键（冒烟脚本误用 `qy_active_org_id`） |
| `AiThread` | schema 无 orgId | 切换后线程可能混显 → 本阶段至少前端按 activeOrg 过滤/清理；schema 全量迁移可记限制 |
| Workspace 选择 | 多处未统一 org 前缀 | 切换后清理 |
| React Query / SWR | 若存在 | 切换后全量刷新 |

### G. `org_admin` ≡ 全部业务数据

| 模块 | 是否等同 | 本阶段 |
|---|---|---|
| 销售 HTTP（customers/opps/quotes/cockpit） | **是**（`resolveSalesScope`） | **改为 authorize** |
| 销售 Agent 工具（`salesCreatedScope`） | **否**（看平台 dataScope）→ 与 HTTP 不一致 | 对齐到统一授权 |
| 项目单条 API | org_admin 可读 | 不改 |
| 能力中台治理写配额 | org_admin | 不改（管理权限） |

### H. manager 可访问的平台 API

| API / 能力 | manager | 本阶段 |
|---|---|---|
| `GET/DELETE /api/users` | ✅ | **禁止**（仅平台 admin） |
| 运营 content-plan / matrix / postiz / brand 写 | ✅（`canManageUsers`） | 拆出门禁；manager 默认失去平台用户管理，运营写若仍依赖旧 helper 需改为 org permission（最小改：运营写改为 `isAdmin` 或 org_admin，避免 manager 全平台） |
| 数据 scope | `own` | 不再给用户管理 |

---

## 七项差距对照

### 1. 企业身份锁定

| 维度 | 判定 |
|---|---|
| 状态 | **缺失** |
| 已有 | `User.activeOrgId`、membership 校验、`needsSelection` |
| 缺失 | `OrgAccessMode`、`canSelfSwitchOrg`、FIXED 禁止自助切换 |
| 本阶段修复 | schema + switch API 门禁 + 登录自动进唯一企业 |
| 留到后续 | PLATFORM_SUPPORT 完整运维流程 |

### 2. 切换移至设置

| 维度 | 判定 |
|---|---|
| 状态 | **缺失** |
| 已有 | 侧栏 OrgSwitcher、PATCH active-org |
| 缺失 | 设置页、侧栏只读、主导航去切换 |
| 本阶段修复 | 只读展示 + `/settings/account` 条件切换 |

### 3. Owner / Admin 分离

| 维度 | 判定 |
|---|---|
| 状态 | **缺失**（仅有 ownerId 字段） |
| 本阶段修复 | `org_owner` 角色 + 回填 + 唯一 owner 保护 |

### 4. manager 风险

| 维度 | 判定 |
|---|---|
| 状态 | **P0 漏洞** |
| 本阶段修复 | 收紧 `canManageUsers`；企业成员走 org API |

### 5. 授权底座

| 维度 | 判定 |
|---|---|
| 状态 | **缺失** |
| 已有 | 分散 permissions / data-scope / workspace-rbac |
| 本阶段修复 | `src/lib/authorization/*` + RoleProfile 模型 + seed |

### 6. 销售统一 Scope

| 维度 | 判定 |
|---|---|
| 状态 | **部分完成**（ownOnly 可用但不统一） |
| 本阶段修复 | customers/opps/quotes/analytics 走 authorize |

### 7. Principal 预留

| 维度 | 判定 |
|---|---|
| 状态 | **缺失** |
| 本阶段修复 | `PrincipalRef` 类型；DIGITAL_EMPLOYEE / GROUP fail-closed |

---

## 搜索命中摘要（代表性）

```text
user.role          → rbac/capabilities、guards、大量 API
org_admin         → sales/org-context、projects/access、permissions、nav
manager           → canManageUsers、运营写 API
activeOrgId       → organizations/active-org、stream-guard、hydrator
resolveSalesScope → sales API 主路径
isSuperAdmin      → guards、报价写、项目
body.orgId        → trade/sales/marketing resolve*
```

正式客户端 org 键：`qingyan_selected_org_id`（非 `qy_active_org_id`）。

---

## 建议实施顺序（与规格一致）

1. 企业身份锁定 + UI/切换/缓存  
2. Owner 分离 + manager/成员隐私  
3. 授权底座 + seed  
4. 销售迁移  
5. 交付文档 + 独立 PR  

**导航约束**：不修改一级 Navigation IA 结构；仅调整权限过滤与组织入口展示。

---

## 已知基线失败（回归时如实记录）

1. Image Engine FormData  
2. AI 分类 API 401  
3. Agent Trace 假 orgId / Reservation FK  
