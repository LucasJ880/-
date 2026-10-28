# Tasks

## 1. 外贸收件人

- [x] 1.1 新建 `src/lib/trade/recipients.ts`（D2 / D3 / D4）：
  - `loadTradeMemberSignals(orgId)`（成员、企业角色、平台角色、用户状态、加入时间、有效权限键、岗位模式）；
  - 纯函数 `isTradeWorker` / `isTradeManager` / `pickDefaultInquiryOwner`；
  - 入口 `tradeWorkRecipients` / `tradeManagementRecipients` / `resolveDefaultInquiryOwner`（无人 → 企业 owner）。
  - 不引用 `booth-summary`。
  - verify：typecheck；纯测试里三个选择函数的矩阵通过。
- [x] 1.2 接入：
  - `booth-summary.managementOf` 转调 `tradeManagementRecipients`；删除 `isManagementMember` / `MANAGEMENT_ROLES` / `MANAGEMENT_ORG_ROLES`；
  - `inquiry-sla` 首次提醒 → `tradeWorkRecipients`，24 小时升级 → `tradeManagementRecipients`；
  - `website-inquiry.notifyInquiryMembers` → `tradeWorkRecipients`；
  - `inquiry-intake.resolveInquiryOwner` → `resolveDefaultInquiryOwner`（`preferredUserId` 优先不变）。
  - verify：`grep -rn '"boss", "manager", "admin"' src/lib/trade` 与 `grep -n 'role: { in:' src/lib/revenue-spine/inquiry-intake.ts` 均为空；既有 `booth-summary` / `inquiry-sla` / `sla-tiers` / `owner-brief` / `website-inquiry*` 测试通过（按需改断言）。

## 2. 营收中心与压扁

- [x] 2.1 营收中心（D1）：
  - `resolveRevenueAccess(request, keys, opts?)` 内部用 `requireTradePermission` + `resolveTradeOrgId`；
  - 13 个 `/api/revenue/**` 路由传键组：GET 读、POST 写、策略 PUT 设置；策略 PUT 删 `isAdmin || boss`；
  - 删除 `REVENUE_SPINE_ROLES` / `roleCanAccessRevenueSpine`，改 `scoring-draft.test.ts`；
  - 导航 `biz-revenue` / `biz-revenue-today` 的 `requiredPlatformRoles` 去掉 `sales`。
  - verify：typecheck；`scoring-draft.test`、`position-nav` 通过。
- [x] 2.2 压扁纳入 `trade`（D5）：
  - `COLLAPSIBLE_PLATFORM_ROLES` 加 `trade`，同步 `platform-role-collapse` 纯 / 隔离库测试的"trade 不动"断言；
  - 侧栏 `usesTradeLayout(user.effectiveRole ?? user.role)`；
  - 入职清单岗位模式"业务员"认 `trade.manage`；
  - 残留清单新增 F 组（F1–F5）并标状态，D2–D4 标"PERM-6c 已收口"。
  - verify：`platform-role-collapse`（纯 + 隔离库）、`residual-reads`、`trade-access` 通过。

## 3. 测试与收尾

- [x] 3.1 新建测试（内容见 design 验证方式），注册：
  - `src/lib/trade/__tests__/trade-recipients.test.ts`（纯）→ `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；
  - `trade-recipients-db.isolated.test.ts`（隔离库）→ `scripts/test-all.sh`。
  - verify：两个文件本地通过；`bash scripts/check-test-registry.sh` 通过。
- [x] 3.2 收尾：
  - `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；
  - `openspec validate perm-6c-revenue-and-trade-recipients --strict` 通过；
  - 写 `docs/QINGYAN_PERM-6c_REPORT.md`；
  - `docs/QINGYAN_PERMISSION_TASKFLOW.md` PERM-6c 改 `[G]`；
  - 更新 `docs/QINGYAN_PERMISSION_HANDOFF.md`。
  - verify：四条命令退出 0；`grep -c "PERM-6c .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- PR 合并后：`/opsx:archive perm-6c-revenue-and-trade-recipients --yes`（独立小 PR），TASKFLOW PERM-6c 改 `[x]`。
- 生产：无数据动作。上线前确认需要收外贸提醒的人是 `org_owner` 或绑了外贸岗位。
- 下一个：`perm-6b-mengxin-positions`（需梦馨人员与邮箱）；6b 后可对梦馨执行压扁（含 `trade`）。
