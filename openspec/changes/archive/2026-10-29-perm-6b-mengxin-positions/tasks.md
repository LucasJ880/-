# Tasks

## 1. 模板与绑定文件

- [x] 1.1 家纺外贸岗位模板（D1）：
  - `role-defaults.ts` 新增 `HOME_TEXTILE_TRADE_INDUSTRY_PACK`；
  - `owner` 档 = 系统 `org_owner` 全部键 + `organization.read` + `organization.dashboard.read`（代码合成）；
  - 登记 `POSITION_PROFILE_SETS` / `POSITION_TEMPLATE_SETS`；
  - 修正既有测试里"梦馨是旧模式 / 非窗饰只有系统模板"的断言。
  - verify：typecheck；`authorize`、`position-nav`、`platform-role-collapse` 既有测试通过（按需改断言）。
- [x] 1.2 绑定文件与等价核对（D3 / D4）：
  - 新 `config/positions/mengxin.json`（Cathy → `trade_rep`，Lucas → `owner`）；
  - 按 4c2 对比法核对梦馨两人在 main 与本分支的落地 / 首页重定向 / 可见导航，差异写入报告。Cathy 出现非预期差异时先停下回报。
  - verify：`bind-positions` 纯函数能解析该文件且无 `TODO:`；对比脚本输出已记录。

- [x] 1.3 入驻 / 交接 / 邀请注册后落岗位（D5，实施中补充）：
  - 新 `src/lib/authorization/onboarding-positions.ts`（`ensureDefaultPositions`）；
  - `provisionFactoryOrg`、`updateOnboardingSettings`（交接）与 `/api/auth/register`（企业邀请码）调用。
  - verify：`onboarding-db.isolated` 82 / 82（本分支修复前失败）；`onboarding-rules` 通过。

## 2. 测试

- [x] 2.1 新建测试（内容见 design 验证方式），注册：
  - `src/lib/authorization/__tests__/mengxin-positions.test.ts`（纯）→ `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；
  - `mengxin-positions-db.isolated.test.ts`（隔离库）→ `scripts/test-all.sh`。
  - verify：两个文件本地通过；`bash scripts/check-test-registry.sh` 通过。

## 3. 收尾

- [x] 3.1 收尾：
  - `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；
  - `openspec validate perm-6b-mengxin-positions --strict` 通过；
  - 写 `docs/QINGYAN_PERM-6b_REPORT.md`，含"上线顺序"（合并前 seed → 确认 → 合并 → 再 seed → 绑 `owner` → 可选压扁）；
  - TASKFLOW PERM-6b 改 `[G]`；
  - 更新 HANDOFF 与验收清单。
  - verify：四条命令退出 0；`grep -c "PERM-6b .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- **合并前**：等 Lucas 确认已对梦馨跑过 `seedOrgAuthorizationProfiles`、Cathy 有 active `trade_rep` 绑定，才合并 PR。
- 合并后：`/opsx:archive perm-6b-mengxin-positions --yes`（独立小 PR），TASKFLOW PERM-6b 改 `[x]`。
- 生产：
  - 再跑 seed；
  - `bind-positions --org <梦馨> --file config/positions/mengxin.json`（或 PERM-7 界面）；
  - 可选对梦馨执行压扁（Cathy `trade → user`）。
