# Tasks

## 1. 派生角色

- [x] 1.1 新建 `src/lib/rbac/effective-platform-role.ts`：
  - 纯函数 `deriveEffectivePlatformRole({ platformRole, positionMode, permissionKeys })`（D1 / D2）；
  - 异步 `resolveEffectivePlatformRole({ userId, orgId, platformRole })`：先 `loadPositionMode`；旧模式或保留角色直接返回，否则 `loadPermissionKeys`，解析失败按无键处理。
  - verify：typecheck。

## 2. 接入

- [x] 2.1 `src/lib/agent-core/engine.ts`：`runAgent` / `runAgentStream` 开头派生，覆盖工具列表过滤与工具执行上下文的 `role`（D3）。`/api/agent-core/tools` 列表、`/api/agent-core/chat` 用派生角色。
  - verify：agent-core 既有工具策略 / 授权测试通过；typecheck。
- [x] 2.2 `src/app/api/ai/threads/[threadId]/messages/route.ts`：取得企业后派生一次，替换路由内 `getCapabilities` / `buildOperatorSystemPrompt` / `getWorkContext` / 路由器 `role` / `isOperatorEnabled`（D6）。`.../runs/[runId]/retry`、`/api/ai/chat` 同样处理。
  - verify：typecheck；既有 AI 线程测试通过。
- [x] 2.3 微信与其他入口：
  - `agent-runtime/process.ts` `executeConversationRun`：开头派生，用于域选择与营销数字员工判定（D5）；
  - `agent-runtime-v2/principal.ts`、`/api/agent-supervisor/runs/**` 发起入口：取派生角色；`mention-gateway/policy.ts` 的工具域不看角色，角色只传给 `runAgent`，由 2.1 的 engine 派生覆盖（不另改）。
  - verify：typecheck；既有 mention-gateway / runtime-v2 / supervisor 测试通过。
- [x] 2.4 Muse（D4）：
  - `muse-bridge/binding.ts` 身份 `role` 取派生角色并带 `positionMode`（`binding-pure.ts` 类型补字段）；
  - `sales-pure.ts` `resolveSalesScope` 岗位模式只看派生角色。
  - verify：muse-bridge 既有测试通过（旧模式用例不变）。
- [x] 2.5 防放宽（D5）：
  - `secretary/briefing.ts` 扫描域按派生角色（`getUserDomains(userId, orgId)`）；
  - `agent-scope/resolve.ts` 用派生角色；
  - `/api/marketing/employee` 用派生角色。
  - verify：typecheck；secretary / agent-scope / marketing 既有测试通过。

## 3. 测试与收尾

- [x] 3.1 新建 `src/lib/rbac/__tests__/effective-platform-role.test.ts`（纯）与 `effective-platform-role-db.isolated.test.ts`（隔离库），内容见 design 验证方式。纯测试注册 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`，隔离库测试注册 `scripts/test-all.sh`。
  - verify：两个文件本地通过（隔离库用本地 Postgres）；`bash scripts/check-test-registry.sh` 通过。
- [x] 3.2 收尾：
  - `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；
  - `openspec validate perm-4c4-ai-tools-by-position --strict` 通过；
  - `docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md` A 组逐条标"4c4 已收口"或说明保留原因（A8 未触及的开关调用方列出待核对）；
  - 写 `docs/QINGYAN_PERM-4c4_REPORT.md`；
  - `docs/QINGYAN_PERMISSION_TASKFLOW.md` PERM-4c4 改 `[G]`；更新 `docs/QINGYAN_PERMISSION_HANDOFF.md`。
  - verify：四条命令退出 0；`grep -c "PERM-4c4 .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- PR 合并后 `/opsx:archive perm-4c4-ai-tools-by-position --yes`（独立小 PR），TASKFLOW PERM-4c4 改 `[x]`；确认 `openspec list --specs` 出现 `agents/position-derived-role`。
- 生产：合并即生效。核对 Sunny 绑定（同 4c3）；核对 A8 列出的环境变量白名单生产值。
- 下一个：`perm-4c5-management-reads-by-position`（B / C / D1 / D5，含招投标交接；最后打开 4c3 写库闸门）。
