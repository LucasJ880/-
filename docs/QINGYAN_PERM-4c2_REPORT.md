# PERM-4c2 报告 — 导航 / 默认落地 / 底栏按岗位

change：`openspec/changes/perm-4c2-nav-by-position/`（proposal / specs ×3 / design / tasks 6/6）
任务书：`docs/QINGYAN_PERM-4_PLATFORM_ROLE_CLOSEOUT_TASKBRIEF.md` PERM-4c 段 What-2 / What-3（拍板见"拍板结果 · PERM-4c"第 2–4 条）
零 schema：新键是代码常量；岗位模式由既有 `Organization.industryPackId` 推导。

## 1. 做了什么

### 1.1 权限键与岗位模式
| 项 | 内容 |
|---|---|
| `organization.dashboard.read`（新，MEDIUM，"查看企业经营总览"，ORG，只允许人类） | 只给窗饰 `owner`；系统模板 `org_owner` / `org_admin` 不绑（seed 会自动绑这两个模板，4c1 踩过） |
| 岗位模式 | `hasPositionTemplates(industryPackId)`：行业包有岗位模板（窗饰）→ 岗位模式；否则旧模式（梦馨） |
| 信号来源 | `loadPositionMode(orgId)`（`src/lib/rbac/permission-keys.ts`，出错按旧模式）；`/api/auth/active-org` 返回 `positionMode`；`resolve-workspace-context`、`/api/ops/home`、`/api/ops/projects/[id]` 一并带上 |

### 1.2 工作区与落地（`src/lib/rbac/workspace-policy.ts`，只在岗位模式分支）
- 管理层 = 平台 super_admin ∨ `organization.dashboard.read`。平台 `boss` / `manager` / `admin`、企业 `org_owner` / `org_admin` 本身都不算。
- 销售工作区 = 管理层 ∨ `sales.quote.create` / `sales.quote.pricing_close`（读键会计和出单岗也有，不用）。
- 默认落地：管理层 `/` → 销售 `/sales/home` → `operations.*` `/ops` → `project.create|update` `/bids` → `accounting.read` `/accounting` → `install.task.update` `/install` → `/tasks`。
- 会计落地的"非销售 / 运营专职"在岗位模式下按键判定。

### 1.3 导航（`src/lib/navigation/{types,filter,registry}.ts`）
- 新字段：
  - `positionPermissions`（只在岗位模式生效）；
  - `tradeEntry`（岗位模式下对平台 `trade` 或管理层可见）；
  - `superAdminOnly`（两种模式都生效）。
- 岗位模式下，按平台角色整组 / 单条隐藏的规则不执行。"只看销售条目"的侧栏改由 `isPureSalesWorker` 判定：持销售工作键，且不是管理层，也不持运营 / 招投标 / 会计 / 安装 / 出单键。
- `registry.ts` 按 design D3 表补字段：
  - 销售区 ×7 + 日程：销售键 ∨ 管理层；
  - 企业经营、AI 能力、经营驾驶舱：管理层；
  - 招投标 / 项目情报 / 供应商：`project.read`；
  - 品牌增长 ×3：`operations.*`；
  - 报告：`operations.*` ∨ 管理层；
  - 外贸 ×12、营收 ×2、产品内容：`tradeEntry`；
  - 平台用户管理：`superAdminOnly`。
- 旧模式完全走原逻辑，`requiredPlatformRoles` / `NAV_ROLES_*` / `nav-role-policy.ts` 都保留。

### 1.4 客户端
`sidebar.tsx`、`mobile-nav-drawer.tsx`、`mobile-tab-bar.tsx` 从 active-org 取 `positionMode` 放进导航上下文。底栏的销售布局判定为 `positionMode ? getDefaultWorkspace(wsCtx) === "/sales/home" : user.role === "sales"`。

## 2. 怎么验

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run lint:baseline` | PASS（无新增 error fingerprint） |
| `npm run test:ci` | PASS（含新 `position-nav.test`） |
| `bash scripts/check-test-registry.sh` | OK（451） |
| `openspec validate perm-4c2-nav-by-position --strict` | valid |
| `authorize.test` | 146 → **150**：新键登记、只有 `owner` 含、系统模板不含、`hasPositionTemplates` |
| `position-nav.test`（新，纯） | **86 / 86**，见下方说明 |
| 回归（原样通过） | workspace-policy 26、default-workspace 8、home-redirect 9、navigation-workspace 34、navigation-ia 63、nav-active-matcher 21、ops-access 21、accounting 38 |

`position-nav.test` 覆盖：
- 岗位模式判定。
- 13 个岗位 / 组合的落地与侧栏快照：owner、sales_rep、pricing_lead、ops_lead、ops_staff、accounting、bids、fulfillment ×3、installer、owner+pricing_lead+accounting、无岗位。
- 平台角色 boss / manager / admin / operations / sales 和企业 org_owner / org_admin 不改变落地与侧栏（反例）。
- 外贸例外，包括企业未启用外贸模块时也不显示。
- 平台用户管理两种模式下都只对 super_admin 可见。
- 底栏布局，含一条源码断言。
- 旧模式抽样（sales / operations / boss / org_owner / 会计键 / user），与改动前一致。

**旧模式全量对比**：
- 用 main@da0119d4 与本分支各跑一遍 96 种组合：8 种平台角色 × 3 种企业角色 × 4 组键，比较默认落地、首页重定向和完整侧栏。
- 唯一差异是平台 `admin` / `boss` / `manager` 不再看到"平台用户管理"入口（36 条）。这是 D3 的有意改动：PERM-4b 起该接口只认 super_admin，原入口对他们是死链。

## 3. 实施中对设计的修正（已回写 artifacts）

1. **安装落地键从 `install.task.read` 改为 `install.task.update`**（spec / design D4）。三个出单岗都持 `install.task.read`（看安装进度），照原文会落到 `/install`，与 spec 场景"出单岗 → `/tasks`"矛盾。安装工的工作键是 `install.task.update`；老板 / 运营 / 会计持 `install.task.assign`，但在顺序里排得更前。
2. **平台用户管理明确为"两种模式都只对 super_admin"**。spec 的"旧模式结果与改动前一致"加了这一条例外，场景改为"admin 或 boss 在任一模式下看不到"。
3. task 1.2 的 `loadWorkspaceSignals` 改为实际实现的 `loadPositionMode(orgId)`，与 `loadPermissionKeys` 并列。task 2.2 去掉上下文 `isPlatformSuperAdmin`：`superAdminOnly` 直接看 `platformRole === "super_admin"`。

## 4. 已知限制与上线

- **BREAKING（Sunny）**：平台角色不再影响 Sunny 的菜单与落地。没绑 `owner` 的老板不再是管理层，会落到其岗位工作区；无岗位的人落 `/tasks`。
  - 例外：没有任何岗位绑定的成员仍走成员角色兼容回退（`org_owner` → 系统模板键），但系统模板不含 `organization.dashboard.read`，所以也不是管理层。兼容回退由 4c3 关闭。
- 知识库 / 微信集成在岗位模式下对纯销售之外的人都可见（旧模式只对平台 sales 隐藏）。纯销售仍只看销售侧栏。
- 出单岗没有专属落地，落 `/tasks`。侧栏有工艺单入口。如需落 `/blinds-orders`，另起 change。
- super_admin 在任何企业持全部键（`platformAdminBindings`），岗位模式下菜单完整。
- **上线**：
  1. 合并后对 Sunny 重跑 `seedOrgAuthorizationProfiles`（owner 加 `organization.dashboard.read`）。
  2. 确认 Sunny 老板都绑了 `owner`（PERM-1 绑定文件），否则合并后他们落到各自岗位工作区。
  3. 确认 Sunny 的 `industryPackId = window_covering_services_v1`。

## 5. 合并后

`/opsx:archive perm-4c2-nav-by-position --yes` 独立小 PR；`openspec list --specs` 应出现 `navigation/position-based-visibility`；TASKFLOW PERM-4c2 → `[x]`。下一个 `perm-4c3-collapse-platform-roles`。
