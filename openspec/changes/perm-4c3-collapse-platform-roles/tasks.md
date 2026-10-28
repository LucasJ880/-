# Tasks

## 1. 压扁工具

- [x] 1.1 新建 `src/lib/authorization/platform-role-collapse.ts`（纯）：
  - 常量 `COLLAPSIBLE_PLATFORM_ROLES = ["boss","manager","operations","sales"]`、`PLATFORM_ROLE_COLLAPSE_READY = false`（D1）；
  - `planCollapse({ positionMode, members, otherMemberships })` → `{ change[], skipped[], blockers[] }`（范围 + 三类前置校验，D2 / D3）；
  - `planRestore({ auditRecords, currentRoles })` → `{ restore[], skipped[] }`（每人取最新一条，当前非 `user` 跳过，D4）；
  - `summarizeCollapse(...)` 输出行（只含邮箱与角色名）。
  - verify：typecheck。
- [x] 1.2 新建执行器 `runPlatformRoleCollapse({ orgCode, actorEmail, dryRun, restore, ready })`（同文件或 `platform-role-collapse-run.ts`，连库）：
  - 双闸中的 super_admin 校验、企业查找与岗位模式判定、读成员 / 绑定 / 其他企业成员关系；
  - 闸门为 false 且非 dry-run / restore → 退出 1；
  - 写 `User.role` 与审计 `authorization.platform_role.collapse` / `restore`（`logAuthorizationChange`）；
  - 返回退出码与输出行，输出提醒"相关成员需重新登录"。
  - 新建薄脚本 `scripts/collapse-platform-roles.ts`：参数解析、`ALLOW_ROLE_COLLAPSE=true` 闸、以 `ready: PLATFORM_ROLE_COLLAPSE_READY` 调执行器；用法与退出码对齐 `bind-positions.ts`。
  - verify：typecheck；`ALLOW_ROLE_COLLAPSE` 未设时 `npx tsx scripts/collapse-platform-roles.ts --org x --actor y` 退出 1 且不连库。

## 2. 兼容回退收口

- [x] 2.1 `resolve-effective-permissions.ts`：
  - 新增纯函数 `compatFallbackAllowed(industryPackId)`（= `!hasPositionTemplates`）；
  - 人类主体无 active 绑定时查企业 `industryPackId`，岗位模式返回空，旧模式照旧回退（D5）；
  - super_admin 与数字员工路径不变。
  - verify：`npx tsx src/lib/authorization/__tests__/authorize.test.ts` 与 `finance-access.test.ts` 通过；typecheck。

## 3. 测试、文档与收尾

- [x] 3.1 新建 `src/lib/authorization/__tests__/platform-role-collapse.test.ts`（纯，见 design 验证方式），注册 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - verify：`npx tsx src/lib/authorization/__tests__/platform-role-collapse.test.ts` 通过；`bash scripts/check-test-registry.sh` 通过。
- [x] 3.2 新建 `src/lib/authorization/__tests__/platform-role-collapse-db.isolated.test.ts`（隔离库，见 design 验证方式；闸门打开的场景通过执行器参数 `ready: true` 覆盖），注册 `scripts/test-all.sh`。
  - verify：本地隔离库 `DATABASE_ENVIRONMENT=isolated NODE_ENV=test npx tsx <file>` 全过。
- [x] 3.3 新建 `docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md`：
  - 按 design D6 五组逐条写 file:line、门槛、压扁前后差异（boss / manager / operations / sales）、建议改法、归属 change；
  - 末尾写"打开闸门的条件"（所列 A / B / C / D 项均已合并或明确归 PERM-6，且 Sunny 的 dry-run 无阻断）。
  - verify：文档存在；`grep -c "PLATFORM_ROLE_COLLAPSE_READY" docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md` ≥ 1。
- [x] 3.4 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；`openspec validate perm-4c3-collapse-platform-roles --strict` 通过；写 `docs/QINGYAN_PERM-4c3_REPORT.md`；`docs/QINGYAN_PERMISSION_TASKFLOW.md` PERM-4c3 改 `[G]`，并按审核结果新增后续残留收口行；更新 `docs/QINGYAN_PERMISSION_HANDOFF.md`。
  - verify：四条命令退出 0；`grep -c "PERM-4c3 .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- PR 合并后 `/opsx:archive perm-4c3-collapse-platform-roles --yes`（独立小 PR），TASKFLOW PERM-4c3 改 `[x]`；确认 `openspec list --specs` 出现 `authorization/platform-role-collapse`。
- 生产（合并即生效部分）：合并前后对 Sunny 跑 `bind-positions --dry-run` 确认全员有 active 绑定；可跑 `ALLOW_ROLE_COLLAPSE=true ... collapse-platform-roles.ts --org <sunny> --actor <lucas> --dry-run` 核对 11 人名单与阻断项。
- 闸门打开（`PLATFORM_ROLE_COLLAPSE_READY = true`）与真正执行压扁：在残留收口 change（design D6 建议 `perm-4c4-ai-tools-by-position`、`perm-4c5-management-reads-by-position`）合并之后。
