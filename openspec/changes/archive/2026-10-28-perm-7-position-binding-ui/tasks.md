# Tasks

## 1. 服务与守卫

- [x] 1.1 共用绑定服务（D1）：
  - 新 `src/lib/authorization/position-binding-service.ts`（`loadBindingContext` / `executeBindingPlan`，审计带 `via`）；
  - `scripts/bind-positions.ts` 改调服务，输出与退出码不变；
  - `position-binding.ts` 新增纯函数 `wouldRemoveLastOwnerBinding`（D3）。
  - verify：typecheck；既有 `position-binding` / `digital-employee*` 测试通过。
- [x] 1.2 守卫与成员接口（D5）：
  - `src/lib/auth/guards.ts` 新增 `requirePlatformSuperAdmin`（403 `PLATFORM_ADMIN_REQUIRED`）；
  - `members` POST、`members/[memberId]` PATCH / DELETE 改用它；GET 不变。
  - verify：typecheck；成员相关既有测试通过（按需改断言）。

## 2. 接口与界面

- [x] 2.1 绑定接口（D2 / D3）：
  - `src/app/api/organizations/[orgId]/positions/route.ts` GET / PUT；
  - 单主体完整集合、`dryRun`、400 列全部原因、409 `LAST_OWNER_BINDING`、`via: "console"`。
  - verify：typecheck；eslint 改动文件无新增 error。
- [x] 2.2 界面（D4）：
  - `src/app/(main)/organizations/[orgId]/positions-section.tsx`（成员岗位表 + 编辑弹窗 + 预览差异 + 数字员工子节）；
  - `page.tsx` 只对平台 super_admin 渲染该节；成员编辑控件改为只对 super_admin 显示。
  - verify：typecheck；eslint 改动文件无新增 error。

## 3. 测试与收尾

- [x] 3.1 新建测试（内容见 design 验证方式），注册：
  - `src/lib/authorization/__tests__/position-binding-console.test.ts`（纯）→ `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；
  - `position-binding-console-db.isolated.test.ts`（隔离库）→ `scripts/test-all.sh`。
  - verify：两个文件本地通过；`bash scripts/check-test-registry.sh` 通过。
- [x] 3.2 收尾：
  - `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；
  - `openspec validate perm-7-position-binding-ui --strict` 通过；
  - 写 `docs/QINGYAN_PERM-7_REPORT.md`；
  - `docs/QINGYAN_PERMISSION_TASKFLOW.md` PERM-7 改 `[G]`（新增 PERM-7b 行）；
  - 更新 `docs/QINGYAN_PERMISSION_HANDOFF.md`。
  - verify：四条命令退出 0；`grep -c "PERM-7 .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- PR 合并后：`/opsx:archive perm-7-position-binding-ui --yes`（独立小 PR），TASKFLOW PERM-7 改 `[x]`。
- 生产：无数据动作。之后调岗在企业详情页"岗位"一节完成；验收清单里"跑 bind-positions"的步骤可改用界面。
- 下一个：PERM-7b（AI 工具策略平台 admin 档、企业列表 / 新建企业的平台 admin 入口）；6b（等梦馨人员与邮箱）。
