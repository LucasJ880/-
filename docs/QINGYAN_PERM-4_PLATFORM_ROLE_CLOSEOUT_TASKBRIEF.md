# PERM-4 任务书：收口平台角色 —— 各模块角色字符串判定换 `authorize`，导航 / 默认工作区按岗位

| 项 | 值 |
|---|---|
| 编号 | PERM-4a（销售）、PERM-4b（运营）、PERM-4c（招投标 + 导航 / 默认工作区 + 平台角色压扁） |
| 设计稿 | `docs/QINGYAN_PERMISSION_REDESIGN_DESIGN.md` §2.1（平台角色只剩 super_admin / user）、§4 第 3、9 条、§5 冲突 C4、C5 |
| 依赖 | PERM-3 合并（4a 可与 PERM-3 并行开 propose，但合并顺序 PERM-3 → 4a → 4b → 4c） |
| 执行者 | Claude Code（三个 change：`perm-4a-sales-authorize`、`perm-4b-ops-authorize`、`perm-4c-nav-by-position`，各一个 PR） |
| 审核 | Claude（chat）；Lucas 拍板 |
| 纪律 | 零 schema；不改 `User.role` 的列，只改数据（脚本 + dry-run）；确定性优先；新测试注册 |

---

## 0. 先读（现状盘点，2026-10-27）

| 判定方式 | 服务端出现次数 | 位置 |
|---|---|---|
| `requireRole(request, [...])` | 110 | **全部在 `src/app/api/trade/**`**（外贸模块，本阶段 Out of scope） |
| `canManageUsers(user.role)`（= admin 或 boss） | 17 | `src/app/api/operations/**` 11 个文件（matrix-accounts、postiz、video-assets、tender-profile、brand-profile、content-plan ×4） |
| `isAdmin(user.role)` / `user.role === "..."` | 24 | 销售 3 个文件（`sales/opportunities/[id]`、`sales/customers/[id]`、`sales/measurements`）；`src/lib/sales/org-context.ts` 4 处（PLATFORM_ADMIN 短路）；`src/app/api/organizations/**` 4 个文件；`blinds-orders/[id]` PUT；`inventory` ×2（PERM-3 处理） |
| `requireOrgRole(request, orgId, "org_admin")` | 9 | `src/app/api/projects/[id]/finance/**` 5 个文件（expenses、receipt、budget、payables）、organizations |
| 平台角色字符串（nav / 工作区） | — | `src/lib/rbac/nav-role-policy.ts`（`isSalesStaff / isOperationsStaff / isExecutiveRole`、`NAV_ROLES_*`、`isNavGroupHiddenForRole`、`isNavItemHiddenForRole`）；`src/lib/rbac/workspace-policy.ts` 第 81、101、134、158–171 行；`src/lib/navigation/registry.ts` 所有 `requiredPlatformRoles`；`src/components/mobile-tab-bar.tsx` `isSales = user?.role === "sales"` |
| 客户端角色门禁 | 8 处 / 1 文件 + 2 处 `user?.role ===` | `src/lib/permissions-client.ts`（`isAdmin / canManageUsers`）及其调用组件 |
| C4 三个旧策略文件 | — | `src/lib/marketing/access-policy.ts`（org_admin / org_member 放行）、`src/lib/quote-engine/access.ts`（org_admin 特权）、`src/lib/agent-scope/resolve.ts`（`normalizeOrgRole`、工作区角色） |
| 平台角色枚举 | — | `src/lib/rbac/roles.ts` `PLATFORM_ROLES`（admin / super_admin / boss / manager / operations / sales / trade / user）、`canManageUsers`、`isBoss` |

已完成的接入样例：`src/lib/sales/org-context.ts` `resolveSalesScope`（authorize + PRINCIPAL/ORG 推 ownOnly）、`src/app/api/install/*`（INSTALL-1 资源级 authorize）、`src/app/api/sales/quote-settings/discounts/route.ts`（PERM-2）。

---

## PERM-4a：销售模块

### Why
销售区还有 3 个路由和 `org-context.ts` 4 处靠 `isAdmin` 短路；平台 `admin`（非 super_admin）账号在 PERM-2 之后已不免审批，但在这些点仍是全权，判定口径不一致。

### What
1. `sales/opportunities/[id]`、`sales/customers/[id]`、`sales/measurements`：`isAdmin` 分支删除，统一 `authorize(sales.customer.read / update / delete …)`，范围走 `resolveSalesScope`。
2. `org-context.ts`：删除 4 处 `isAdmin(user.role)` 短路；super_admin 的全权由 `platformAdminBindings()` 提供（PERM-1 已做），平台 `admin` 不再有隐含权限（上线前按 PERM-2 报告 §4-1 清查账号）。
3. `assertSalesCustomerInOrgForMutation` 与分享 / PDF 出口的 `isAdmin` 同步清理。
4. "改已成交订单金额"（设计稿 §4-2 敏感操作）：`signed` 状态的报价 PATCH 改金额 → `requestApproval`（`sales.update_signed_quote`），另一老板批；其余字段照旧。
5. 报价行级出单编辑（接 PERM-3 的品类表）：`SalesQuoteItem` 的 `fabricSku / 工艺字段` 修改需持该行品类的 `orders.fulfillment.update.<category>`；金额 / 折扣字段仍只归销售 / 合价。

### 验收
- `grep -rnE "isAdmin\(|user\.role" src/app/api/sales src/lib/sales` 为空（测试文件除外）。
- security1-sales-authz / quote-ops-contract / phase5-contract 通过；新增"签约单改金额走审批"用例；`wechat-confirm-policy` 类型 +1。

---

## PERM-4b：运营模块

### Why
11 个运营配置接口（内容计划、品牌档案、矩阵账号、postiz、视频资产、投标档案）用 `canManageUsers`（= 平台 admin 或 boss）作守卫，Marty 的平台角色是 `operations`，所以要么给他 boss 要么他做不了。设计稿 §4-9：运营自己维护，老板看过程和结果。

### What
1. 11 个文件：`canManageUsers` → `authorize(operations.manage)`（ops_lead / owner / 平台管理员）；只读接口 → `operations.read`（ops_staff 也有）。
2. `src/lib/marketing/access-policy.ts` `canEditMarketingBrandProfile`：org_admin / org_member / manager 放行 → `authorize(operations.manage)`。
3. 发布类动作（postiz 发布、video fanout、content-plan dispatch）：保持现有审批口径（出站先审批）；审批人 = 持 `operations.manage` 的人，不再要求 boss。
4. `permissions-client.ts` 的 `canManageUsers` 调用点改为读 `/api/auth/active-org` 的 `permissionKeys`（INSTALL-1 已返回），客户端只做显示，服务端判定为准。
5. `workspace-policy.ts` `canAccessOperationsWorkspace`：去掉 `isOperationsStaff(platformRole)`，只按 `operations.*` 权限 + 管理层。

### 验收
- `grep -rn "canManageUsers(" src/app/api` 为空；`src/lib/rbac/roles.ts` 的 `canManageUsers` 标 `@deprecated`（4c 删除）。
- publish-pipeline / operations 测试通过；新增 ops_lead 能改 / ops_staff 只读 / sales_rep 403 的用例。

---

## PERM-4c：招投标模块 + 导航 / 默认工作区 + 平台角色压扁

### Why
招投标与项目财务仍按 `org_admin` / 项目 owner 特权；导航与默认工作区完全按平台角色（boss / manager / operations / sales / trade）渲染；设计稿 §2.1 的终态是平台角色只剩 `super_admin / user`，业务全部按岗位。

### What
1. **招投标 / 项目财务**：`src/app/api/projects/[id]/finance/**` 5 个文件 `requireOrgRole(org_admin)` → `authorize(project.finance.manage)`（新键，`bids` + `owner`；`accounting` 只读走 PERM-5）；`src/lib/quote-engine/access.ts` 与 `src/lib/project-finance/access.ts` 的 `org_admin` 特权 → `bids` 岗位 ORG 或项目成员；`src/lib/agent-scope/resolve.ts` `normalizeOrgRole` 仅保留兼容回退并标注。
2. **导航按岗位**：`NavigationItem.requiredPermissions`（PERM-3 引入）铺开到所有业务条目；`requiredPlatformRoles` 删除；`NAV_ROLES_*` 删除；`isNavGroupHiddenForRole / isNavItemHiddenForRole` 改为按工作区 / 权限隐藏（销售工作区只显示 `salesWorkspaceVisible` 的规则保留，但"是否销售"由 `canAccessSalesWorkspace` 判定）。
3. **默认工作区**：`workspace-policy.ts` 全部去平台角色：管理层 = `owner` 岗位或 super_admin；销售 = 持 `sales.customer.read`；运营 = `operations.*`；招投标 = `project.*`；安装 = `install.task.read`（已做）。`mobile-tab-bar.tsx` 的 `isSales` 改为工作区判定。
4. **平台角色压扁（数据，不改列）**：脚本 `scripts/collapse-platform-roles.ts`（`ALLOW_ROLE_COLLAPSE=true` + super_admin 双闸，`--dry-run`）：对指定企业成员把 `User.role ∈ {boss, manager, operations, sales}` 改为 `user`，前置校验每人至少一条 PrincipalRoleBinding，否则拒绝并列出；`trade` 角色不动（外贸模块仍用 `requireRole`）；写 AuditLog。`PLATFORM_ROLES` 枚举保留旧值以兼容外贸与历史数据，`isBoss / canManageUsers / isExecutiveRole` 删除或只剩 trade 用途。
5. **兼容回退收口**：`resolve-effective-permissions.ts` 的 `compatProfileKeyForMembership`（按 OrganizationMember.role 回退到系统模板）保留，但对 `industryPackId = window_covering` 的企业**关闭**（有绑定才有权限），防止压扁后漏放。

### 验收
- `grep -rnE "requiredPlatformRoles|NAV_ROLES_|isSalesStaff\(|isOperationsStaff\(|isExecutiveRole\(" src --include=*.ts --include=*.tsx` 为空（trade 目录除外）。
- navigation ia / workspace / active-matcher / default-workspace / workspace-policy 测试重写为按 permissionKeys；每个岗位一例"落地工作区 + 底栏"快照（owner / sales_rep / pricing_lead / ops_lead / ops_staff / accounting / bids / fulfillment_* / installer）。
- 脚本 dry-run 对 Sunny 列出 11 人的前后角色；缺绑定时退出码 2。
- 每个 change：typecheck / lint:baseline / test:ci / registry / `openspec validate --strict`。

## 受影响意图（三段合计）
- Sunny 全员平台角色变为 `user`，一切可见性由岗位决定；Lucas 仍是 super_admin。
- Marty / Maggie 的运营配置不再需要 boss；老板只看。
- 侧栏 / 底栏 / 落地页按岗位；兼职多岗的人（Miki、Bill、Bob）看到并集。
- 平台 `admin` 角色（非 super_admin）失去所有隐含权限。

## Out of scope
- `src/app/api/trade/**` 110 处 `requireRole`（外贸模块，另立 PERM-6）；`User.role` 列与枚举定义不删；工作区（Workspace / WorkspaceMember）角色体系不动；数字员工（PERM-5）。

## 判断点（Lucas 先定）
1. 4a 第 4 条"签约单改金额走审批"是否纳入 4a，还是单独小 change。
2. 4c 压扁顺序：先对 Sunny 跑，梦馨保持旧平台角色（它没有岗位绑定）—— 还是两家一起（梦馨需先落模板与绑定）。
3. `manager` 平台角色在 Sunny 是否有人在用（现在被当作管理层）。

### 拍板结果（2026-10-28）
1. "签约单改金额走审批"**纳入 4a**。
2. 4c 压扁**先 Sunny，梦馨不动**（梦馨落模板与绑定后另行压扁）。
3. Sunny **没人用** `manager` 平台角色：4c 直接按 `user` 压扁，不为 `manager` 做岗位映射。
4. 4a 第 5 条"报价行级出单编辑"**移出 4a**（propose 时拍板）：报价行无工艺字段，签字后由 sunny-process 生成工艺单，出单人在工艺单上按品类改（PERM-3 已覆盖）。
5. 去掉 `isAdmin` 短路后 `owner` **补销售改权**（propose 时拍板）：`sales.customer.update / archive`、`sales.opportunity.update`、`sales.quote.update`（ORG）；签约单改总价对老板同样要另一位审批人。

4a 已于 2026-10-28 合并（#279），见 `docs/QINGYAN_PERM-4a_REPORT.md`。

### 拍板结果 · PERM-4b（2026-10-28，propose 前）
1. 运营配置只读接口（品牌档案、内容计划、矩阵账号、postiz、视频资产、投标档案）**收紧到 `operations.read`**，写要 `operations.manage`；销售网页读不到运营配置（服务端 AI 读品牌上下文不受影响）。
2. 平台用户管理接口 `/api/users`、`/api/users/[id]` **只限平台 super_admin**；`/admin/users` 页面同步只对 super_admin 显示。
3. 增长中心（营销）写操作**改为 `operations.manage`**；普通成员只读。
4. 发布任务审核与 Playbook 批准：**新键 `operations.content.approve`**，绑 `ops_lead` 与 `owner`；创建人 / 提交人**不得自批**，只有平台 super_admin 例外（Maggie 写的 Marty 批，Marty 写的老板批）。
5. 起草 / 改草稿 / 提交审核：**新键 `operations.content.draft`**，绑 `ops_staff` 与 `ops_lead`；不能批准，也不能改品牌档案、矩阵账号等配置（这些要 `operations.manage`）。

### 拍板结果 · PERM-4c（2026-10-28，propose 前）
1. **拆成三个 change**（一个 change 不超过 8 条 task）：`perm-4c1-project-finance`（项目财务 / 报价引擎按岗位、会计进单项目财务页、删除 `canManageUsers`）→ `perm-4c2-nav-by-position`（导航 / 默认工作区 / 底栏按岗位）→ `perm-4c3-collapse-platform-roles`（平台角色压扁脚本 + 窗饰企业关闭兼容回退）。按此顺序各一个 PR。
2. **梦馨保留旧规则**：窗饰行业包企业（Sunny）按岗位权限键；其他企业（梦馨，无岗位绑定）导航与默认工作区继续按平台角色，等梦馨落岗位后再切。项目财务对无岗位企业由系统模板 `org_owner` / `org_admin` 的兼容回退保持原有特权。
3. **外贸入口保留平台角色**：只有 `/trade/**` 相关导航入口继续按平台角色 `trade` 判断，压扁脚本也不动 `trade`；外贸整体改造留 PERM-6。
4. **管理层 = 老板岗位或平台 super_admin**：新增只给 `owner` 的权限键（4c-2 定名，如 `organization.dashboard.read`），导航与工作区都看这个键。
