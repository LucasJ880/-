# Tasks

## 1. 岗位与权限

- [ ] 1.1 `permissions.ts` 加 5 个 `install.*` 键（read / update / window.complete 支持 ASSIGNED+ORG；assign / photo.read 仅 ORG）；`role-defaults.ts` 窗饰集加 `installer`（三键 ASSIGNED），`owner / ops_lead / fulfillment_*` 追加 assign + read + photo.read（ORG），`accounting` 追加 photo.read；`WINDOW_COVERING_POSITION_TEMPLATES` 加安装工；`config/positions/sunny.json` 加 `TODO:安装工`。`authorize.test.ts` 加 installer 快照 / 追加键 / sales_rep 无 install 键断言。verify：`npx tsx src/lib/authorization/__tests__/authorize.test.ts` 通过；`profilesForIndustryPack(WC)` 为 10 个。

## 2. 安装领域纯函数

- [ ] 2.1 新建 `src/lib/install/scope.ts`（`installTaskWhere({ userId, hasOrgScope })`、`canSeeTask`）、`src/lib/install/closeout.ts`（`aggregateCloseout(items, logs)`、`missingWindows(agg)`、`installPhotoPathname`、`validatePhotoUpload({ contentType, size })`）、`src/lib/install/__tests__/closeout.test.ts` 与 `scope.test.ts`，注册进 `scripts/test-all.sh`。verify：两个测试通过；`bash scripts/check-test-registry.sh` 退出 0。

## 3. API

- [ ] 3.1 `src/app/api/install/tasks/route.ts` GET（范围判定 → 预约 + 工艺单摘要 + 收口计数）、`tasks/[id]/route.ts` GET（详情 + 每窗收口）、`installers/route.ts` GET（持 `install.task.read` 用户，经 `listUsersWithPermission`）；响应不含金额 / 成本 / 原始存储 URL。verify：typecheck；`grep -nE "grandTotal|price|msrp|costPrice" src/app/api/install -r` 为空。
- [ ] 3.2 `tasks/[id]/start/route.ts` POST（scheduled → in_progress，审计 `install.task.started`）、`tasks/[id]/items/[itemId]/photo/route.ts` POST（校验被分配 / ORG → 类型 & 大小 → `putPrivateBlob` → `logAudit install.window.completed` → 返回最新记录；itemId 不属该单 404）、`tasks/[id]/complete/route.ts` POST（缺窗 409 列表；全部 → 预约 completed + 工艺单 installed（状态机 + OrderStatusLog）+ 审计；已完成幂等 200）。verify：typecheck；纯函数用例覆盖 409 清单与幂等分支。
- [ ] 3.3 `src/app/api/files/[...path]/route.ts` 加 `install-photos/{orgId}/{orderId}/...` 前缀：org 成员 + （`install.photo.read` ORG 或该 orderId 预约的 assignedToId = 本人）；`blinds-orders/[id]/transition/route.ts`：转 scheduled 时执行者需 `install.task.assign`，`assignedToId` 必须持 `install.task.read`（否则 400），工艺单无 customerId 时 400。verify：typecheck；`grep -c "install-photos" src/app/api/files/[...path]/route.ts` ≥ 1。

## 4. 页面与入口

- [ ] 4.1 `src/app/(main)/install/page.tsx`（按日期分组列表 + 周视图切换，手机优先）与 `install/[id]/page.tsx`（任务头：时间 / 客户 / 地址 / 开始安装按钮；窗列表：序号 / 位置 / 尺寸 / 产品 / 面料 / 拍照按钮 `<input type=file accept=image/* capture=environment>` / 缩略图 + 时间 + 张数；全部收口后"完成收口"；客户端压缩 ≤ 1600px）。verify：`npm run typecheck`；`npx eslint` 两文件无 error。
- [ ] 4.2 `workspace-policy.ts` 加 `install` 工作区（`canAccessInstallWorkspace` 按 `install.task.read`）、默认跳转与 `resolveHomeRedirect`；`mobile-tab-bar.tsx` 与 `navigation/registry.ts` 加"安装"入口；`tenancy/modules.ts` `NAV_HREF_MODULES["/install"] = ["window_covering"]`；layout 侧向 `workspaceContextFromNav` 注入 `permissionKeys`（`resolveEffectiveBindings` 的键集合）。`src/lib/rbac/__tests__/workspace-policy*.test.ts`（若存在）加 install 用例，否则在 `scope.test.ts` 里断言 `getDefaultWorkspace({ platformRole: "user", permissionKeys: ["install.task.read"] }) === "/install"`。verify：测试通过；typecheck。
- [ ] 4.3 `blinds-orders/[id]/page.tsx`："安排安装"对话框加安装工下拉（`/api/install/installers`）与安装时间，提交到 transition；新增"收口"标签（持 `install.photo.read` 时显示，调用 `/api/install/tasks/{appointmentId}` 渲染每窗缩略图 / 时间 / 张数）。verify：typecheck；eslint 无 error。

## 5. 收尾

- [ ] 5.1 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；写 `docs/QINGYAN_INSTALL-1_REPORT.md`（做了什么 / 怎么验 / 判断点 / 已知限制：AuditLog 作为收口记录不可清理、日历页放行留 PERM-4、手工走查步骤）；TASKFLOW INSTALL-1 改 `[G]`；更新 HANDOFF。verify：四条命令退出 0；`grep -c "INSTALL-1 .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1；`openspec validate install-1-installer-position --strict` 通过。

## Workflow follow-up

- PR 合并到 main 后 `/opsx:archive install-1-installer-position --yes`（独立小 PR）；确认 `openspec list --specs` 列出 `installation/install-tasks`、`installation/window-closeout`。
- 生产：对 Sunny 跑模板落地；补安装工邮箱后执行绑定脚本。
