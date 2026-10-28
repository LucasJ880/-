# Design

## Context

- 4c3 交付了压扁工具与写库闸门 `PLATFORM_ROLE_COLLAPSE_READY = false`，并把残留读点落成 `docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md`。
- 4c4 收口了 A 组（AI 一侧），提供 `resolveEffectivePlatformRole`（`src/lib/rbac/effective-platform-role.ts`）。
- 剩余读点分两类：
  1. **自建工作区上下文缺岗位信号**：`/api/tasks`、`/api/tasks/[id]`、`/api/ops/projects`、交接三路由直接用 `{ platformRole: user.role, orgRole }` 构造上下文，没带 `permissionKeys` / `positionMode`。判定函数本身已按键（`canViewTeamTasks` 认 `operations.tasks.team.*`；交接认 `bids.handoff.*`；管理层在岗位模式按 `organization.dashboard.read`），只差注入。`/api/ops/home` 与 `/api/ops/projects/[id]` 在 4b / 4c2 已注入。
  2. **直接读平台角色**：
     - 审批决策 / 执行（`canDecideTeamApproval`、`approveApprovalItem` 的 `role` → 执行器 `canSeeResource(ctx.role…)`）；
     - 视觉方案（`isGlobalScope(role)`）；
     - 前端 `user.role`（管理总览、工作台）；
     - 中间件营销拦截（读 JWT 的 `role`）；
     - 微信绑定默认推送（`roleDefaults(role)`）；
     - 入职清单（`SALES_PLATFORM_ROLES`）；
     - 3 处功能开关调用方。
- 企业成员角色 `org_owner` / `org_admin` 在 `isPlatformOrOrgManager` / 交接 `isManager` 中仍放行，与平台角色无关，压扁不影响，本 change 不改（4c1 / 4c2 已处理财务与导航的成员角色口径）。

## Goals / Non-Goals

**Goals**：
- 压扁前后 Sunny 在上述功能上行为一致；
- 旧模式（梦馨）零变化；
- 收口后打开写库闸门。

**Non-Goals**：
- 外贸（PERM-6）；
- B6 / B7 的 `manager`：Sunny 无人用，派生不产生 `manager`；
- 改 `isPlatformOrOrgManager` 的成员角色口径；
- 工具策略表改权限键；
- 在生产执行压扁。

## Decisions

### D1 两种手法，按读点性质选
- **"上下文缺信号"的读点**：只注入 `permissionKeys` + `positionMode`，不碰判定函数。改动小，且与 4b / 4c2 的做法一致。
- **"直接读平台角色"的读点**：入口处换成 `resolveEffectivePlatformRole`，下游判定不改，保证压扁前后等价（同 4c4 D1）。
- 否决：把所有下游改成按权限键——审批执行器的 `canSeeResource`、视觉方案范围、开关白名单都是角色词汇；全改成键要逐个重新定义口径，超出本 change 的"等价收口"目标。

### D2 前端拿派生角色：`/api/auth/me` 加 `effectiveRole`
- 前端无法自己算岗位键，只有 active-org 的 `permissionKeys`。在 `/api/auth/me` 按用户当前企业（`activeOrgId`，无则唯一企业）返回 `effectiveRole`，`role` 保持不变（平台管理页、`isPlatformAdmin` 等仍读 `role`）。
- 只改两处按业务角色显示的组件：管理总览、助手工作台营销入口。
- 否决：把 `role` 字段直接换成派生角色——平台管理页（`canViewAdminPages(user.role)`）等依赖真实平台角色，换掉会把派生的 `boss` 误当平台角色。

### D3 营销工作区：服务端 layout + GET 守卫
- 中间件运行在边缘、读 JWT，拿不到岗位键。
- 岗位模式改由两个服务端 `layout.tsx`（`/marketing`、`/operations/growth`）重定向，加上 `requireMarketingReadAccess` 接到 16 个 GET 处理器。规则与中间件相同：派生角色为 `sales` 即拦。
- 中间件原判定保留，覆盖旧模式；岗位模式压扁后 JWT 角色为 `user`，中间件放行，由 layout / 守卫拦。
- 否决：把派生角色写进 JWT——要改登录、切换企业、刷新三条路径，且岗位变动后 JWT 不会自动更新。

### D4 视觉方案顺带修跨企业泄露（2026-10-28 已拍板并入）
- 改视觉方案范围时，`dataScope=all` 一直没有企业过滤（`visualizerSessionListScope` 返回 `null`）：平台 `boss` / `admin` 能看到其他企业的方案。这是既有安全缺陷，已单独提任务卡。
- 因为本 change 要改同一组函数，建议一并修：`all` 改为"当前企业内全部"，并在新建校验里核对客户的 `orgId`。

### D5 打开闸门放在最后一个 task
- 把常量改为 `true`，同步改纯测试断言；隔离库测试通过执行器参数 `ready` 控制，不受影响。
- 残留清单写明"收口完成"、剩余归 PERM-6 的项，以及生产执行步骤：先 dry-run 核对名单 → 执行 → 通知相关成员重新登录 → 出问题 `--restore`。

## 与八条硬纪律的关系

1. **零 schema**：不涉及。只在内存派生，并注入已有信号。
2. **出站先审批**：触碰。审批流程不变，只是审批人角色按岗位派生，不新增出站。
3. **第三套队列**：不涉及。
4. **脱敏**：不涉及。管理总览模块显示口径与压扁前一致。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：触碰。全部查表，无 LLM。
8. **测试注册**：触碰。纯测试注册 `test-all` 与 `test-ci-unit`，隔离库测试注册 `test-all`。

## Risks / Trade-offs

- **BREAKING（Sunny，合并即生效）**：平台角色与岗位不一致的人行为会变（例如平台 `boss` 未绑 `owner` 失去审批执行的全组织可见），上线前核对绑定。
- **闸门打开后的风险**：压扁可以执行了，但仍有外贸（PERM-6）读点按平台角色。Sunny 暂不用外贸，所以不受影响；若 Sunny 日后启用外贸，需先做 PERM-6。
- **每请求开销**：涉及的接口多 1–2 次轻量查询。

## 验证方式

- `npx tsx src/lib/authorization/__tests__/residual-reads.test.ts`（新，纯）：
  - 注入后判定：老板岗位看团队任务、平台 `boss` + `sales_rep` 被拒、`ops_lead` 看运营项目、`bids` 预览交接、平台 `operations` + `ops_staff` 执行交接被拒；
  - 营销读守卫规则；微信默认推送；入职清单业务员判定；
  - 视觉方案范围含企业过滤；
  - 闸门为 true；
  - 各入口调用 `resolveEffectivePlatformRole` / 注入 `permissionKeys` 的源码断言；中间件原判定仍在。
- `residual-reads-db.isolated.test.ts`（新，隔离库）：
  - 窗饰企业 `user` + `owner` 的团队任务 / 运营项目 / 交接预览放行；
  - 压扁销售 GET `/api/marketing/dashboard` 403、`ops_staff` 200；
  - `/api/auth/me` 的 `role` / `effectiveRole`；
  - 老板岗位批准销售报价动作时执行器可见；
  - 视觉方案不跨企业。
- 回归：`platform-role-collapse`（隔离库）、`effective-platform-role`、`ops-access`、`handoff-domain`、`position-nav`、marketing / messaging / onboarding 既有测试原样通过。
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate perm-4c5-management-reads-by-position --strict`。
