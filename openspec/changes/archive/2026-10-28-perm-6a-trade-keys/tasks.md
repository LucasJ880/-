# Tasks

## 1. 键、模板与守卫

- [x] 1.1 键与模板（D1 / D4）：
  - `permissions.ts` 加 `trade.read` / `trade.manage` / `trade.settings.manage`（ORG、HUMAN only）；
  - `role-defaults.ts`：新系统模板 `trade_rep` 与岗位模板登记；`org_owner` 加三键、`org_admin` 加 `trade.settings.manage`、窗饰 `owner` 加三键；
  - `resolve-effective-permissions.ts` 兼容回退 `org_member` + 平台 `trade` → `trade_rep`；
  - `seed-org-profiles.ts` 自动绑平台 `trade` → `trade_rep`；
  - `authorize.test.ts` 补登记与模板断言。
  - verify：`npx tsx src/lib/authorization/__tests__/authorize.test.ts` 通过；typecheck。
- [x] 1.2 守卫与企业解析（D2 / D3 / D5）：
  - `src/lib/trade/access.ts` 新增 `requireTradePermission`、`TRADE_READ_KEYS` / `TRADE_MANAGE_KEYS` / `TRADE_SETTINGS_KEYS`；
  - `resolveTradeOrgId` 的显式企业通道只给平台 super_admin；
  - `channel-access.ts` 改为 super_admin 或持 `trade.settings.manage`。
  - verify：typecheck；trade 既有测试通过。

## 2. 接入

- [x] 2.1 `src/app/api/trade/**` 全部 110 处 `requireRole` 改为 `requireTradePermission`（脚本按处理器方法）：
  - GET 读键、其余写键；
  - 发件档案 / 发件人 → 设置键；
  - 发件人 DELETE 与 `fromEmail` → 平台 super_admin；
  - 通道入口（列表 / 详情 / 管理）→ 三键任一，管理动作再经 `canManageTradeChannels`；
  - 清理不再使用的 `BOOTH_CARD_ROLES` / `PROFILE_ROLES` / `SENDER_ROLES` 引用（导出保留则标注）。
  - verify：`grep -rn "requireRole(" src/app/api/trade` 为空；typecheck；eslint 改动文件无新增 error。
- [x] 2.2 AI 与导航（D6）：
  - `effective-platform-role.ts` 加 `trade` 档；
  - `navigation/filter.ts` 岗位模式 `tradeEntry` 认 `trade.read`；
  - `trade/chat-assistant.ts` 工具策略用派生角色。
  - verify：`effective-platform-role`、`position-nav` 既有测试通过（按需补断言）。

## 3. 测试与收尾

- [x] 3.1 新建测试（内容见 design 验证方式），注册：
  - `src/lib/trade/__tests__/trade-access.test.ts`（纯）→ `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；
  - `trade-access-db.isolated.test.ts`（隔离库）→ `scripts/test-all.sh`。
  - verify：两个文件本地通过；`bash scripts/check-test-registry.sh` 通过。
- [x] 3.2 收尾：
  - `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；
  - `openspec validate perm-6a-trade-keys --strict` 通过；
  - 写 `docs/QINGYAN_PERM-6a_REPORT.md`；
  - `docs/QINGYAN_PERMISSION_TASKFLOW.md` 新增 PERM-6a / 6b / 6c / PERM-7 行，PERM-6a 为 `[G]`；
  - 更新 `docs/QINGYAN_PERMISSION_HANDOFF.md`。
  - verify：四条命令退出 0；`grep -c "PERM-6a .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- PR 合并后：`/opsx:archive perm-6a-trade-keys --yes`（独立小 PR），TASKFLOW PERM-6a 改 `[x]`。
- 生产：对 Sunny 与梦馨重跑 `seedOrgAuthorizationProfiles`；确认梦馨外贸业务员是平台 `trade`（会自动绑 `trade_rep`）、老板是 `org_owner`。
- 下一个：`perm-6b-mengxin-positions`（需梦馨人员与邮箱）。
