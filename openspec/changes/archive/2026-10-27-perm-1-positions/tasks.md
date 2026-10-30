# Tasks

## 1. 岗位目录

- [x] 1.1 `src/lib/authorization/permissions.ts` 追加 9 个权限键（`sales.quote.pricing_close`、`sales.quote.discount.over_limit.submit`、`sales.quote.discount.over_limit.approve`、`sales.settings.manage`、`sales.order.create`、`orders.fulfillment.update`、`inventory.manage`、`accounting.read`、`identity.position.manage`），`identity.position.manage` 的 allowedPrincipalTypes 仅 HUMAN。verify：`npx tsx -e` 对每个 key `isKnownPermission` 为 true，`getPermissionDefinition("identity.position.manage").allowedPrincipalTypes` 等于 `["HUMAN"]`。
- [x] 1.2 `src/lib/authorization/role-defaults.ts` 新增 `WINDOW_COVERING_ROLE_PROFILES`（owner / pricing_lead / ops_lead / accounting / bids / fulfillment_vinyl / fulfillment_drapery / fulfillment_shades，sales_rep 与 ops_staff 复用系统模板）与 `POSITION_PROFILE_SETS`（按 industryPackId）、`profilesForIndustryPack(id)`，绑定内容按 spec `position-catalog`。verify：`authorize.test.ts` 新增断言——owner 含 over_limit.approve + settings.manage 且不含 member.manage；sales_rep 全 PRINCIPAL 且无 over_limit.submit；pricing_lead 含 pricing_close + over_limit.submit 不含 approve；三出单岗含 fulfillment.update 无 sales 写权；多岗并集 `decideFromBindings` 对 `sales.quote.read` 匹配 ORG。
- [x] 1.3 `src/lib/authorization/seed-org-profiles.ts` 读 `Organization.industryPackId`，命中 `POSITION_PROFILE_SETS` 则用同一 upsert 路径追加落地（不改现有自动绑定逻辑）；`authorize.test.ts` 加 `profilesForIndustryPack("window_covering_services_v1")` 返回 10 个 key、`profilesForIndustryPack(null)` 返回 0 的断言。verify：`npx tsx src/lib/authorization/__tests__/authorize.test.ts` 全部通过。

## 2. 平台管理员全权

- [x] 2.1 `src/lib/authorization/resolve-effective-permissions.ts`：`resolveEffectiveBindings` 先查 `User.role`，`super_admin` 返回 Registry 全部 key × ORG，`source` 为 `platform_admin:<key>`；其余路径不变。新增纯函数 `platformAdminBindings()` 供测试。verify：`authorize.test.ts` 断言 `platformAdminBindings()` 条数等于 Registry 条数、全部 source 以 `platform_admin` 开头；`decideFromBindings` 用这些绑定对异企业资源返回 `RESOURCE_OUT_OF_SCOPE`、同企业返回 ALLOW/ORG；平台 `admin` 的 `compatProfileKeyForMembership` 仍为 null。

## 3. 绑定脚本

- [x] 3.1 新建 `src/lib/authorization/position-binding.ts`：`parseBindingFile(text)`（JSON、顶层 bindings、重复邮箱）、`validateBindings({ file, knownProfileKeys, membersByEmail })`（TODO 占位 / 未知 key / 非 active 成员，返回全部错误而非首个）、`planBindingDiff({ desired, existing, prune, prunableKeys })`（新增 / 已存在 / 停用）。新建 `src/lib/authorization/__tests__/position-binding.test.ts` 覆盖 spec `position-binding` 的占位、未知 key、非成员、重复邮箱、幂等、不带 prune 不停用、带 prune 停用、dry-run（plan 不含写）八个场景，并在 `scripts/test-all.sh` "Security-1 Authorization" 下一行注册为"岗位绑定脚本纯函数（PERM-1）"。verify：`npx tsx src/lib/authorization/__tests__/position-binding.test.ts` 全通过；`bash scripts/check-test-registry.sh` 退出 0。
- [x] 3.2 新建 `scripts/bind-positions.ts`：解析 `--org / --file / --actor / --prune / --dry-run`；缺必选参数退出 2 并打印用法；`ALLOW_POSITION_BINDING !== "true"` 退出 1；actor 不存在或 `role !== "super_admin"` 退出 1；按 org code 取企业与其 active 成员、已落地岗位模板、现有 active 绑定；调 3.1 纯函数；非 dry-run 时逐条 create / update status，并对每条新增 / 停用调 `logAuthorizationChange`（action `authorization.position.bind` / `authorization.position.unbind`）；输出每人邮箱 + 岗位列表 + 计数；任何路径不打印连接串。verify：`npx tsx scripts/bind-positions.ts` 退出 2 且输出含"用法"；`npx tsx scripts/bind-positions.ts --org x --file y --actor z` 在未设 ALLOW 时退出 1 且输出含 `ALLOW_POSITION_BINDING`（两者均不连 DB）。
- [x] 3.3 新建 `config/positions/sunny.json`：按设计稿 §3 列 11 人岗位；已知邮箱 `lucas@sunnyshutter.ca`（owner, bids）、`alex@sunnyshutter.ca`（sales_rep），其余 `TODO:<姓名>` 占位并在文件顶部 `_comment` 写明填法与执行命令。verify：`node -e` 解析 JSON 成功；`validateBindings` 对该文件在当前内容下返回的错误全部是 TODO 占位类（测试 3.1 用它做占位用例）。

## 4. 收尾

- [x] 4.1 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci` 全通过；写 `docs/QINGYAN_PERM-1_REPORT.md`（做了什么 / 怎么验 / 判断点 / 已知限制：org_owner 自动绑定与 owner 岗位并存、邮箱占位待 Lucas 补、生产落地命令）；`docs/QINGYAN_PERMISSION_TASKFLOW.md` PERM-1 状态列改 `[G]`；更新 `docs/QINGYAN_PERMISSION_HANDOFF.md` 当前进度。verify：三条命令退出 0；报告文件存在；`grep -c "PERM-1 .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1；`openspec validate perm-1-positions` 通过。

## Workflow follow-up

- PR 合并到 main 后 `/opsx:archive perm-1-positions --yes`（独立小 PR）；确认 `openspec list --specs` 列出 `authorization/position-catalog`、`authorization/position-binding`、`authorization/platform-admin-authority`；TASKFLOW PERM-1 状态改 `[x]`。
- 生产：对 Sunny 跑模板落地 + Lucas 补邮箱后执行绑定脚本（见 design Migration Plan）。
