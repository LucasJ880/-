# Design

## Context

- **共用判定**（`admin || super_admin`）：
  - 服务端 `src/lib/rbac/roles.ts` 的 `isSuperAdmin` / `isAdmin`，`src/lib/rbac/platform-admin.ts` 的 `isPlatformAdmin`（委托 `isSuperAdmin`）；
  - 客户端 `src/lib/permissions-client.ts` 的 `isSuperAdmin` / `isAdmin` / `isPlatformAdmin` / `canViewAdminPages`，`src/lib/hooks/use-current-user.ts` 的 `isPlatformAdmin`；
  - 61 个非测试文件调用它们。`isPlatformSuperAdmin`（只认 `super_admin`）已存在，4b / 6a / 7 用它收口。
- **守卫**（`src/lib/auth/guards.ts`）：
  - `requirePlatformAdmin` → `isPlatformAdmin`；`requireSuperAdmin` 是它的别名（3 个文件）；
  - `requireRole` 对 `isAdmin` 直接放行（2 个调用点）；
  - `requireOrgRole` 等 4 处 `isSuperAdmin` 旁路把平台管理员当作 `org_admin`。
- **平台档归一**：有 3 处把 `super_admin` 归一成 `admin` 档：`requireRole`、`canAccessModule`、工具注册表 `normalizeRole`。
  - 工具策略表 `_policy.ts` 的 `allowRoles` 用 `admin / sales / trade` 这套词汇，`admin` 档 = 平台管理员；
  - 原始 `admin` 今天原样进入 `admin` 档。
- **派生角色**（`effective-platform-role.ts`）：保留名单 `super_admin / admin / trade` 原样透传，其余在岗位模式按键派生。
- **生产**：
  - 平台 `admin` 账号已知有 `lucas@sunnyshutter.ca`（已安排改 super_admin），其余未知，需 Lucas 查 `User.role='admin'`；
  - 6b 合并后两家企业都是岗位模式。

## Goals / Non-Goals

**Goals**：
- 平台特权只属于 `super_admin`，`admin` 在代码里等同 `user`；
- 一条规则覆盖全部判定点，不逐处设例外；
- super_admin 行为不变。

**Non-Goals**：
- 删除平台角色枚举值；
- 改 super_admin 跨企业范围；
- 改工具策略表 `allowRoles` 的词汇。

## Decisions

### D1 改共用判定的口径，不改调用方
- `roles.ts` 的 `isSuperAdmin` / `isAdmin`、`platform-admin.ts` 的 `isPlatformAdmin`、客户端同名函数与 `canViewAdminPages`、`useCurrentUser().isPlatformAdmin` 全部改为 `role === "super_admin"`。
- 函数名保留，注释改为"PERM-7b：只认 super_admin；平台 admin 等同 user"。`isPlatformSuperAdmin` 与之同义，保留。
- 61 个调用方随之收口，不逐个改。
- 否决：
  - 逐个调用方改成 `isPlatformSuperAdmin`：量大、容易漏，而且漏掉的地方仍放行 admin；
  - 删除旧函数名：纯搬迁，收益小。

### D2 平台档归一函数 `platformTier`
- `roles.ts` 新增 `platformTier(role)`：
  - `super_admin` → `"admin"`（工具 / 模块映射里的平台管理员档）；
  - `admin` → `"user"`；
  - 其余原样。
- 三处归一改调它：`requireRole`、`canAccessModule`（客户端放同一份实现，SYNC 注释）、工具注册表 `normalizeRole`。
- `requireRole` 的"`isAdmin` 直接放行"随 D1 变为只放行 super_admin。
- 结果：工具策略表、模块映射里的 `"admin"` 词汇不变，原始 `admin` 不再进入 `admin` 档。
- 实施中补充（同一口径的其余档位入口）：
  - AI 能力矩阵 `getCapabilities`（`rbac/capabilities.ts`）、微信推送默认域也改调 `platformTier`（super_admin 结果与改动前相同）；
  - 操作员提示词角色说明用 `normalizeRetiredPlatformRole`（只把 `admin` 换成 `user`；super_admin 原来就落到默认说明，保持不变）；
  - 旧模式导航按平台角色名单比对（`requiredPlatformRoles` 含 `user` 的条目）：新增 `normalizeRetiredPlatformRole`（`admin` → `user`，`super_admin` 不变），`navigation/filter.ts` 的 `isNavItemVisible` 入口先归一。只去掉名单里的 `admin` 会让平台 admin 比 `user` 看到的还少，所以归一而不是删名单。

### D3 手写平台 admin 判断改调共用判定
实施时以 `grep` 为准，下列是提案时的清单：
- **改为共用判定**（`isSuperAdmin` / `isPlatformAdmin` / `platformTier`）：
  - `src/app/(main)/sales/cockpit/discount-stats-card.tsx`
  - `src/app/api/projects/[id]/org-rules/route.ts`
  - `src/app/api/org/knowledge/route.ts`、`[id]/route.ts`、`search/route.ts`、`import/route.ts`
  - `src/app/api/org/project-rules/route.ts`
  - `src/app/api/agent/trace/route.ts`、`sessions/[sessionId]/runs/route.ts`、`runs/[runId]/route.ts`
  - `src/app/api/messaging/gateway/route.ts`（2 处）
  - `src/app/api/secretary/briefing/route.ts`
  - `src/lib/agent-scope/resolve.ts`
  - `src/lib/agent-runtime-v2/executor.ts`（2 处）
  - `src/lib/agent-runtime/process.ts`
  - `src/lib/agent-supervisor/engine.ts`、`workers/run-worker.ts`
  - `src/lib/agent-core/tool-registry.ts`（`normalizeRole` 与执行上下文）、`engine.ts`
  - `src/lib/operations/dashboard/build-dashboard.ts`
- **保留**：
  - `src/lib/organizations/onboarding-rules.ts` 的 `factoryOwnerRoleProblem`："平台管理员不能当工厂老板"是限制，不是特权，`admin` 也继续拦。
- **同样去掉 `admin`（实施中确认）**：
  - 提示词领域知识包与晨报领域的 `case "admin"`（`ai/prompts/common.ts`、`secretary/briefing.ts`）：`admin` 走默认分支，与 `user` 相同；
  - 旧模式导航角色表 `NAV_ROLES_EXEC`（`rbac/nav-role-policy.ts`）去掉 `admin`；
  - 微信绑定推送默认（`messaging/binding.ts`）、发布漂移通知收件人（`cron/release-drift`，原来只发 `admin`，改为 `super_admin`）；
  - 平台用户页 / 邀请码页的"平台管理员"选项与"不能删 admin"判断（`(main)/admin/users`、`(main)/admin/invite-codes`）；
  - 风险扫描技能传给扫描器的 `"admin"` 改为 `"super_admin"`（保持原扫描范围，结果仍按 `ctx.projectId` 过滤）。
- 实施后源码断言：业务代码（`src/**`，不含测试与 `roles.ts` / `permissions-client.ts`）不再出现 `role === "admin"` 形式的平台判断。

### D4 派生角色保留名单只剩 `super_admin`
- `RESERVED_PLATFORM_ROLES = ["super_admin"]`：
  - 岗位模式下 `admin` 与 `trade` 按键派生；
  - 旧模式仍返回原角色，下游经 D1 / D2 把原始 `admin` 当 `user`。
- `trade` 一并取消：6b 后外贸业务员都绑 `trade_rep`，派生结果同为 `trade`，与压扁后一致。
- Muse `SALES_MANAGER_PLATFORM_ROLES` 去掉 `admin`。它只在旧模式生效，岗位模式按派生角色。

### D5 不再签发 `admin`
- `/api/admin/invite-codes` 与 `/api/users/[id]` 的 `validRoles` 去掉 `admin`，传入返回 400。
- `/api/auth/register`：邀请码角色为 `admin` 时按 `user` 落。默认项目创建条件随之只认 `user`。

### D6 压扁纳入 `admin`
- `COLLAPSIBLE_PLATFORM_ROLES` 加 `admin`；
- 前置校验（岗位模式、有 active 岗位绑定、不在旧模式企业）与审计 / 还原不变；
- 执行者仍须 super_admin。

### D7 既有测试的处理原则
- 约 65 个测试文件出现平台 `admin`。逐个跑失败的测试，判断：
  - 断言"平台 admin 有平台特权"（例如诊断视图、跨企业、工具 admin 档）：构造改为 `super_admin`，被测行为不变；
  - 断言"平台 admin 被拒"：保持（本来就该拒）；
  - 其他原因失败：停下回报，不改断言。
- 每处改动在报告里按文件列出。

## Risks / Trade-offs

- **Lucas 自己被锁**：他若还是平台 `admin`，合并后失去企业列表、入驻控制台、诊断。
  - 上线顺序第 1 步改 super_admin；
  - 漏了用 SQL 补救即恢复，不需回滚。
- **未知的平台 admin 账号**：合并后只剩岗位能力。
  - 上线前查名单；业务人员先确认岗位绑定。
- **改动面广**（61 个调用方随判定一起变）：
  - super_admin 路径不变；
  - 只有 `admin` 的结果变化，且变化方向一律是"按 user 判定"。
  - 用纯测试覆盖判定、档位与派生角色；隔离库覆盖跨企业、控制台、工具档。
- **测试改造量**：约 65 个文件里一部分要把构造从 `admin` 改为 `super_admin`。只改构造、不改被测行为，报告逐个列出。

## Migration Plan

1. 合并前（Lucas）：
   - 查生产 `User.role='admin'` 名单；
   - 平台运维账号执行 super_admin SQL；
   - 其余确认已在所属企业绑岗位。
2. 6b（#307）先合并。
3. Lucas 确认后合并 7b。
4. 合并后可选：两家企业压扁 `--dry-run`，`admin → user` 无阻断后执行。
5. 回滚：代码回滚即恢复 `admin` 旧口径；压扁有 `--restore`。

## 验证方式

- **纯 `src/lib/rbac/__tests__/platform-admin-scope.test.ts`**：
  - 判定：`isSuperAdmin` / `isAdmin` / `isPlatformAdmin` / 客户端同名函数 / `canViewAdminPages` 对 `admin` 为 false、对 `super_admin` 为 true；
  - `platformTier`：`super_admin → admin`、`admin → user`、`sales → sales`；
  - 派生角色：`admin` 按键（`owner` → `boss`、`trade_rep` → `trade`、无键 → `user`），`trade` 按键，`super_admin` 保留；
  - 工具注册表：原始 `admin` 的可用工具与 `user` 相同，`super_admin` 为 `admin` 档；
  - Muse 名单无 `admin`；压扁范围含 `admin`；
  - 源码断言：邀请码 / 用户修改的 `validRoles` 无 `admin`；D3 清单文件无手写 `role === "admin"`。
- **隔离库 `platform-admin-scope-db.isolated.test.ts`**（真实路由），平台 `admin`（只在企业 A 绑 `owner`）：
  - 企业列表只有 A；企业 B 详情 / 项目列表 403；
  - 入驻控制台、能力运行记录、新建企业、邀请码 403；
  - 在 A 是管理层；智能体追踪 403；
  - super_admin 对照全部放行；
  - 创建 `admin` 邀请码 400；旧 `admin` 邀请码注册得到 `user`；
  - 压扁 dry-run：有绑定的 `admin` 进计划，无绑定的阻断。
- **回归**：受影响目录全部登记测试在隔离库跑一遍，失败按 D7 处理并写入报告。
