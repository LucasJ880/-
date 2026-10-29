# Tasks

## 1. 判定与守卫

- [x] 1.1 共用判定与平台档（D1 / D2）：
  - `roles.ts` 的 `isSuperAdmin` / `isAdmin`、`platform-admin.ts` 的 `isPlatformAdmin`、`permissions-client.ts` 同名函数与 `canViewAdminPages`、`use-current-user.ts` 的 `isPlatformAdmin` 只认 `super_admin`；
  - 新增 `platformTier`（服务端 + 客户端同实现），`requireRole`、`canAccessModule`、工具注册表 `normalizeRole` 改调它。
  - verify：typecheck；新纯测试的判定 / 档位段通过。
- [x] 1.2 手写判断（D3）：
  - 按 D3 清单改调共用判定；实施前 `grep` 复核清单，新发现的一并改并写入报告；
  - 保留项不动（`factoryOwnerRoleProblem`）；话术 / 晨报 `case "admin"` 实施中改为去掉（见 design D3"同样去掉"）。
  - verify：源码断言段通过；`grep -rnE "role ?=== ?['\"]admin['\"]" src --include=*.ts --include=*.tsx`（排除测试与 `roles.ts` / `permissions-client.ts`）无平台判断。

## 2. AI、签发与压扁

- [x] 2.1 派生角色与 Muse（D4）：`RESERVED_PLATFORM_ROLES = ["super_admin"]`；`SALES_MANAGER_PLATFORM_ROLES` 去掉 `admin`。
  - verify：`effective-platform-role`、`position-derived-role` 相关既有测试按 D7 处理后通过。
- [x] 2.2 不再签发（D5）：邀请码与用户修改的 `validRoles` 去掉 `admin`；注册时 `admin` 邀请码按 `user` 落。
  - verify：新纯测试源码断言段；隔离库邀请码段。
- [x] 2.3 压扁纳入 `admin`（D6）：`COLLAPSIBLE_PLATFORM_ROLES` 加 `admin`。
  - verify：`platform-role-collapse` 既有测试按新 spec 场景更新后通过。

## 3. 测试

- [x] 3.1 新建测试（内容见 design 验证方式），注册：
  - `src/lib/rbac/__tests__/platform-admin-scope.test.ts`（纯）→ `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；
  - `platform-admin-scope-db.isolated.test.ts`（隔离库）→ `scripts/test-all.sh`。
  - verify：两个文件本地通过；`bash scripts/check-test-registry.sh` 通过。
- [x] 3.2 既有测试（D7）：
  - 隔离库下跑全部登记测试；
  - 失败的按 D7 分类：构造换 `super_admin` / 保持 / 停下回报；
  - 每处改动写入报告。
  - verify：除已知失败外全部通过。已知失败（在 6b 基线上同样失败）：`capabilities/phase3a*` ×4（本地缺双租户种子）、`sunny-process/autogen-db`（main 上即失败，已提任务卡）、`mention-gateway/m2a-identity-db`（测试自身数据唯一约束）。

## 4. 收尾

- [x] 4.1 收尾：
  - `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；
  - `openspec validate perm-7b-retire-platform-admin --strict` 通过；
  - 写 `docs/QINGYAN_PERM-7b_REPORT.md`，含"上线顺序"（查 admin 名单 → Lucas 改 super_admin → 6b 先合 → 确认 → 合并 → 可选压扁）；
  - TASKFLOW PERM-7b 改 `[G]`；
  - 更新 HANDOFF 与验收清单。
  - verify：四条命令退出 0；`grep -c "PERM-7b .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- **合并前**：
  - 6b（#307）已合并；
  - Lucas 确认 `lucas@sunnyshutter.ca` 已是 super_admin，且其余平台 `admin` 账号已绑岗位，才合并 PR。
