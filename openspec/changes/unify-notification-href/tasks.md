# Tasks

## 1. 纯函数解析器与测试

- [ ] 1.1 实施前检查并发：`git fetch origin main` 后确认 `src/components/header.tsx` 与 `src/app/(main)/notifications/page.tsx` 相对本 change 起点（`ed3b55f`）没有新增 `entityType` 分支；若有（如 INSTALL-2b/2c 已合并），把新类型并入 1.2 的映射与 1.3 的测试表。verify：`git diff ed3b55f origin/main -- src/components/header.tsx "src/app/(main)/notifications/page.tsx" | grep -c "entityType ==="` 输出 0，或新类型已列入 1.3 的测试表。
- [ ] 1.2 新建 `src/lib/notifications/href.ts`：导出 `notificationTarget(item)`（返回 `{ href, orgScoped } | null`）与 `notificationHref(item)`（返回 `string | null`），映射按 specs `notifications/click-target` 的 12 个类型 + 项目 / 项目活动兜底，ID 一律 `encodeURIComponent`，七类企业作用域类型 `orgScoped: true`。verify：`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出 0。
- [ ] 1.3 新建表驱动测试 `src/lib/notifications/__tests__/href.test.ts`（中文用例名）：12 个类型各一行（地址 + `orgScoped`）；`sales_quote` 有 / 无 `orgId` 两行；已知类型缺 `entityId` 走兜底；未知类型带项目活动、只带项目、都不带（→ `null`）；ID 含 `/`、`?` 时被编码；`notificationHref` 与 `notificationTarget(...).href` 一致。同一 task 内注册：`scripts/test-all.sh` 第一组末尾"测试注册校验（SDD-0）"之前加一行，`scripts/test-ci-unit.sh` 在 `delivery-gate.test.ts` 行之后加一行。verify：`npx tsx src/lib/notifications/__tests__/href.test.ts` 退出 0；`bash scripts/check-test-registry.sh` 打印 OK 行并退出 0；`bash -n scripts/test-all.sh && bash -n scripts/test-ci-unit.sh` 通过。

## 2. 两个入口改用解析器

- [ ] 2.1 改写 `src/components/header.tsx` 的 `handleNotificationNavigate`：调用 `notificationTarget`，为 `null` 时直接返回；`orgScoped && item.orgId` 时先 `persistSelectedOrgId(item.orgId)`；仍用 `window.location.href = href`。verify：`grep -c 'entityType ===' src/components/header.tsx` 输出 0；`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出 0。
- [ ] 2.2 改写 `src/app/(main)/notifications/page.tsx` 的 `handleItemClick`：未读先 `PATCH /api/notifications/<id>/read` 的行为保留在最前；调用 `notificationTarget`，为 `null` 时返回；`orgScoped && item.orgId` 时先 `persistSelectedOrgId(item.orgId)`；仍用 `router.push(href)`。verify：`grep -c 'entityType ===' "src/app/(main)/notifications/page.tsx"` 输出 0；`grep -c 'notifications/\${item.id}/read' "src/app/(main)/notifications/page.tsx"` ≥ 1；`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出 0。

## 3. 集成检查

- [ ] 3.1 全量回归与规格校验。verify：`npm run test:ci` 以 `CI unit subset PASS` 结束并退出 0；`npm run lint:baseline` 不新增错误；`npm test` 中新测试与"测试注册校验（SDD-0）"PASS（其余失败若有，逐条确认与本 change 无关并记录在 PR 描述）；`npx -y @fission-ai/openspec@1.15.0 validate unify-notification-href --strict` 通过。

## Workflow follow-up

- `/opsx:verify unify-notification-href` 后开 PR（一个 change = 一个 PR）。
- PR 合并到 main 后 `/opsx:archive unify-notification-href --yes`（独立小 PR）；确认 `openspec list --specs` 列出 `notifications/click-target`。本 change 无 TASKFLOW ID，archive 时不改 TASKFLOW 状态列。
