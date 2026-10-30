# Tasks

## 1. 收口残留读点

- [x] 1.1 自建上下文注入岗位信号（D1）：`/api/tasks`、`/api/tasks/[id]`、`/api/ops/projects`、`/api/projects/[id]/handoff{,/preview,/execute}` 的上下文补 `permissionKeys`（`loadPermissionKeys`）与 `positionMode`（`loadPositionMode`）。
  - verify：typecheck；`ops-access`、`handoff-domain` 既有测试通过。
- [x] 1.2 审批用派生角色：`/api/ai/pending-actions/[id]`、`/api/agent/tasks/[taskId]/steps/[stepId]/{approve,reject}`、`capabilities/approvals/decision.ts`、`ai-grader/actions/wechat-confirm.ts` 传给 `canDecideTeamApproval` / `approveApprovalItem` / `rejectApprovalItem` 的 `role` 改为 `resolveEffectivePlatformRole`。
  - verify：typecheck；pending-actions / approvals 既有测试通过。
- [x] 1.3 视觉方案：`/api/visualizer/**` 传派生角色；修 D4（`dataScope=all` 限当前企业，新建校验核对客户企业）。
  - verify：typecheck；visualizer 既有测试通过。
- [x] 1.4 前端（D2）：`/api/auth/me` 返回 `effectiveRole`；`management-dashboard-client.tsx`、`digital-employee-workbench.tsx` 改读 `effectiveRole ?? role`。
  - verify：typecheck；`npx eslint` 两个组件无新增 error。
- [x] 1.5 其余服务端读点：
  - 营销工作区（D3）：新增 `src/app/(main)/marketing/layout.tsx`、`src/app/(main)/operations/growth/layout.tsx` 与 `requireMarketingReadAccess`，接到 `/api/marketing/**` 的 16 个 GET；
  - 微信绑定默认推送 `messaging/binding.ts` 按派生角色；
  - 入职清单 `organizations/onboarding.ts` 岗位模式按销售工作键；
  - 功能开关调用方：`/api/agent-supervisor/runs` 的 `isSupervisorEnabled`、`assistant/followup-task.ts`、`workforce-runtime/job.ts` 传派生角色。
  - verify：typecheck；marketing / messaging / onboarding / supervisor / workforce 既有测试通过。

## 2. 打开闸门

- [x] 2.1 打开闸门（D5）：
  - `src/lib/authorization/platform-role-collapse.ts` 的 `PLATFORM_ROLE_COLLAPSE_READY = true`；
  - `platform-role-collapse.test.ts` 的闸门断言改为 true；
  - `docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md` 标"收口完成"：B / C / D1 / D5 与 A 组余项逐条写状态，D2–D4 归 PERM-6，补生产执行步骤。
  - verify：`npx tsx src/lib/authorization/__tests__/platform-role-collapse.test.ts` 通过；隔离库 `platform-role-collapse-db.isolated.test.ts` 通过。

## 3. 测试与收尾

- [x] 3.1 新建测试（内容见 design 验证方式），注册：
  - `src/lib/authorization/__tests__/residual-reads.test.ts`（纯）→ `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；
  - `residual-reads-db.isolated.test.ts`（隔离库）→ `scripts/test-all.sh`。
  - verify：两个文件本地通过；`bash scripts/check-test-registry.sh` 通过。
- [x] 3.2 收尾：
  - `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；
  - `openspec validate perm-4c5-management-reads-by-position --strict` 通过；
  - 写 `docs/QINGYAN_PERM-4c5_REPORT.md`；
  - `docs/QINGYAN_PERMISSION_TASKFLOW.md` PERM-4c5 改 `[G]`；
  - 更新 `docs/QINGYAN_PERMISSION_HANDOFF.md`（验收清单补"执行压扁"步骤）。
  - verify：四条命令退出 0；`grep -c "PERM-4c5 .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- PR 合并后：`/opsx:archive perm-4c5-management-reads-by-position --yes`（独立小 PR）；TASKFLOW PERM-4c5 改 `[x]`。
- 生产（Lucas）：
  1. `bind-positions --dry-run`：Sunny 全员有 active 绑定；
  2. `collapse-platform-roles --dry-run`：名单无阻断，尤其无人同时在梦馨；
  3. 去掉 `--dry-run` 执行压扁；
  4. 通知相关成员重新登录；
  5. 出问题用 `--restore`。
- 之后：PERM-6（外贸 `requireRole` 与外贸通道读点）。
