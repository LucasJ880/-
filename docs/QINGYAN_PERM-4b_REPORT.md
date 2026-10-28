# PERM-4b 报告 — 运营 / 增长中心 / 平台用户管理按岗位权限

change：`openspec/changes/perm-4b-ops-authorize/`（proposal / specs ×5 / design / tasks 8/8）
任务书：`docs/QINGYAN_PERM-4_PLATFORM_ROLE_CLOSEOUT_TASKBRIEF.md` PERM-4b 段（拍板见末尾"拍板结果 · PERM-4b"）
零 schema：两个新权限键是代码常量；自批判定用既有 `submittedById` / `createdById`。

## 1. 做了什么

### 1.1 权限键与岗位
| 键 | 范围 | 给谁 |
|---|---|---|
| `operations.content.draft`（新，MEDIUM） | ORG | `ops_staff`、`ops_lead` |
| `operations.content.approve`（新，HIGH，HUMAN only） | ORG | `ops_lead`、`owner` |

`owner` 不持 `operations.manage` / `operations.content.draft`（只看 + 批）。`authorize.test` 81 → 88。

判定集中在新模块 `src/lib/operations/access.ts`：`holdsOpsPermission` / `requireOpsPermission`（任一键允许即过）/ 纯函数 `selfApprovalBlocked`（作者 = 操作者 → 拦，只有平台 super_admin 例外）。

### 1.2 运营配置（12 个路由，删除 `canManageUsers`）
| 接口 | 读 | 写 |
|---|---|---|
| 品牌档案、矩阵账号（列表 / 新增 / 改 / 删）、postiz 集成、视频资产（列表 / 新增 / 同步） | `operations.read` | `operations.manage` |
| 内容计划 | `operations.read` | 新建 / 编辑 / 删除 / AI 生成 `operations.content.draft`；改为已通过 `operations.content.approve` |
| 选题派发、视频扇出 | — | `operations.manage` |
| 投标档案 | `operations.read` 或 `project.read` | `operations.manage` 或 `project.update`（招投标岗可维护，design D5） |

所有判定都在 `resolveRequestOrgIdForUser` 之后，按当前企业判。

### 1.3 运营内容分权
- **Playbook**（账号 / 账号组共 12 个路由 + 账号生效上下文）：`playbook/permissions.ts` 改为异步按键——读 `operations.read`、起草 / 改草稿 / AI 草稿 / 提交 `operations.content.draft`、批准 / 驳回 `operations.content.approve`；**批准**时提交人不得自批，驳回可撤自己的。删除按平台角色 `operations` / `manager` / `boss` 的判定。
- **发布任务**：`canApprovePublishJob(user, orgId)` 判 `operations.content.approve`；`approveAndDispatchJob` 自批改为 `selfApprovalBlocked`，**去掉 Boss 例外**，自批返回 `code: "SELF_APPROVAL"` → 路由 403；列表 GET 要 `operations.read`；驳回只判键。

### 1.4 增长中心
`canEditMarketingBrandProfile(user, orgId)` = `operations.manage`，经 `requireMarketingWriteAccess` 覆盖约 20 个 `src/app/api/marketing/**` 写接口（路由不改）；品牌事实读接口的 `permissions.canEdit` 同口径。增长中心品牌页的只读 / 可编辑提示文案同步。

### 1.5 平台用户管理
`/api/users`、`/api/users/{id}`（查看他人、修改他人、改状态 / 平台角色、删除）→ `isPlatformSuperAdmin`；目标账号保护（admin 账号不可删等）保持。`/admin/users` 页面改用客户端新增的 `isPlatformSuperAdmin`。`canManageUsers` / `canDeleteUsers` 标 `@deprecated`。

### 1.6 运营中心入口
`canAccessOperationsWorkspace` 去掉平台角色 `operations` 放行。新增 `src/lib/rbac/permission-keys.ts` `loadPermissionKeys`，`resolve-workspace-context`、`/api/ops/home`、`/api/ops/projects/[id]` 共用——**顺带修正**：这两个 API 之前构造的上下文不带权限键，`ops_lead` 的团队任务键（`operations.tasks.team.*`）在这两处被忽略。`projects/access.ts` 删除无独立效果的 `canManageUsers` 行。工作区 / 导航测试改为岗位键语义并加"平台角色 operations 无键不可进 /ops"反例。

## 2. 怎么验

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run lint:baseline` | PASS |
| `npm run test:ci` | PASS（含 runtime-architecture 守卫、新 `ops-access.test`） |
| `bash scripts/check-test-registry.sh` | OK（444） |
| `openspec validate perm-4b-ops-authorize --strict` | valid |
| 回归 | authorize 88、playbook 23、publish-pipeline 22、postiz 6、growth-center 25、security1-owner-manager 13、tender-profile 5、navigation-workspace 34、navigation-ia 63、workspace-policy 26、default-workspace 8、home-redirect 9、nav-active-matcher 21、ops 其余（ai-review / content-rules / intel-to-content / aivora）通过 |
| `ops-access.test.ts`（新） | 21 通过：自批决策表；`src/app/api/operations` 无平台角色判定；27 个受判定路由均在 orgRes 之后、异步判定均有 `await`；关键路由的键 |
| `ops-authorize-db.isolated.test.ts`（新，本地 Postgres 16 + pgvector） | **25 / 25**：销售读品牌档案 403、老板读内容计划 200、老板（boss）改品牌档案 403、Marty 改 200、Maggie 扇出 403、招投标岗写投标档案 200、销售读投标档案 403；销售读 Playbook 403、Maggie 起草 + 提交 201 / 200、Maggie 批 403、Marty 自批 403 仍待审、老板批 Marty 的 200；Maggie 批发布任务 403、Marty 批 Maggie 的放行（postflow 入队，不出网）、boss 自批 403 `SELF_APPROVAL`、Marty 驳回自己的 200；增长中心销售写 403、Marty 写 200、平台 admin 写 403、Maggie `canEdit=false`、Marty `canEdit=true`；平台 admin / boss 列用户 403；平台角色 operations 无岗位进运营中心 403、Maggie 200 |
| 验收 grep | `grep -rn "canManageUsers(" src/app/api` 空；`grep -rnE 'role === "(operations\|manager\|boss)"\|isBoss\('`（运营 / 营销 lib 与 API，非测试）空 |
| 全量 `npm test` | 见 HANDOFF 进度行（无 DB 环境跑，对照 13 条环境性基线） |

## 3. 判断点（拍板，2026-10-28）

1. 运营配置读收紧到 `operations.read`、写 `operations.manage`。
2. 平台用户管理只限平台 super_admin。
3. 增长中心写 `operations.manage`。
4. 新键 `operations.content.approve`（ops_lead + owner），不得自批，只有平台 super_admin 例外。
5. 新键 `operations.content.draft`（ops_staff + ops_lead）。

实施中补的设计选择：投标档案对招投标岗开放（D5）；选题"已通过"不做自批（无创建人字段，D4）；驳回不做自批判定（只撤下内容）。

## 4. 已知限制与上线顺序

- **BREAKING**：老板（平台角色 boss / 岗位 owner）不再能改运营配置与增长中心，只能看和批内容；平台 admin / boss 不再能管理平台用户；企业普通成员不再能写增长中心；平台角色 `operations` 无岗位不再进运营中心。
- **上线**：合并后对 Sunny 重跑 `seedOrgAuthorizationProfiles`（ops_staff / ops_lead / owner 模板变了），确认 Marty（`ops_lead`）、Maggie（`ops_staff`）岗位绑定已生效——否则 Maggie 进不了运营中心。
- Marty 是唯一运营主管：他创建的发布任务与提交的 Playbook 只能由老板岗批（Sunny 有 4 位）。
- **仍无任何判定的运营接口**（本次不加门槛，见 proposal Out of scope）：`market-intelligence/**`（含竞品增删改与运行）、`dashboard`、`brand-truth`、`glossary`、`metrics`、`config-health`。建议后续单独 change 评估。
- `src/lib/projects/handoff/access.ts` 仍用 `canManageUsers`（招投标交接，属 PERM-4c）。

## 5. 合并后

`/opsx:archive perm-4b-ops-authorize --yes` 独立小 PR；`openspec list --specs` 应出现 `operations/config-access`、`operations/content-approval`、`marketing/growth-center-access`；TASKFLOW PERM-4b → `[x]`。
