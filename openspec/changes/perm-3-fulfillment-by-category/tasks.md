# Tasks

## 1. 权限键与岗位模板

- [x] 1.1 `permissions.ts` 新增 `orders.fulfillment.update.vinyl / .drapery / .shades`、`orders.fulfillment.read`、`orders.cancel`、`inventory.read`（均 ORG，HIGH / MEDIUM）；`role-defaults.ts`：三个出单模板各绑自己的品类键 + `orders.fulfillment.read` + `inventory.read`（移除伞键），`owner` 追加伞键 + `orders.fulfillment.read` + `orders.cancel` + `inventory.manage` + `inventory.read`，`ops_lead` 追加 `inventory.read` + `orders.fulfillment.read`，`ops_staff` / `sales_rep` 追加 `inventory.read`；`authorize.test.ts` 更新快照与新增断言。verify：`npx tsx src/lib/authorization/__tests__/authorize.test.ts` 通过；`grep -c "orders.fulfillment.update\." src/lib/authorization/permissions.ts` 为 3。

## 2. 品类与访问纯函数

- [x] 2.1 新建 `src/lib/fulfillment/category.ts`（`CATEGORIES`、`categoryOfProductType`、`categoryOfQuoteProduct`、`orderCategories`、`CATEGORY_POSITION_LABEL`）与 `src/lib/fulfillment/order-access.ts`（`canEditOrder`、`missingCategories`、`resolveOrderOrgId` 的纯部分 `pickOrderOrgId({customerOrgId, projectOrgId, creatorOrgIds})`、`applyOrderTransition(tx, …)`）；测试 `__tests__/category.test.ts`、`__tests__/order-access.test.ts` 注册进 `scripts/test-all.sh`。verify：两测试通过；`bash scripts/check-test-registry.sh` 退出 0。

## 3. 工艺单路由

- [x] 3.1 `blinds-orders/route.ts`：GET 持 `orders.fulfillment.read` 看全企业（按 `resolveOrderOrgId` 过滤），否则原范围；POST 要求 `sales.order.create`。`[id]/route.ts` GET / `[id]/export`：同读范围；PUT / DELETE：`canEditOrder`（缺品类 403 + `missingCategories`），删除平台 admin 分支，项目可见性保留为附加条件；跨企业统一 404。verify：typecheck；`grep -rnE "user\.role\s*[!=]==|isAdmin\(" src/app/api/blinds-orders` 为空（把角色传给既有可见性工具与平台管理员判定不算）。
- [x] 3.2 `[id]/transition/route.ts`：非 `scheduled` / `cancelled` 的推进与 `draft ↔ confirmed` 退回走 `canEditOrder`；`cancelled` → 持 `orders.cancel` 者 `requestApproval`（类型 `orders.cancel_blinds_order`，幂等键 orderId，409 对 cancelled / completed）→ 202；平台管理员直批（审计 `selfApproved`）；状态写入改用 `applyOrderTransition`。`pending-actions/types.ts` 加类型与 payload；`executor.ts` 加 `execOrdersCancelBlindsOrder`（批准人 ≠ 提交人且持 `orders.cancel`，过渡态只拒自批）；`wechat-confirm-policy.ts` 登记 `web_only_review`，其测试类型数 +1。verify：typecheck；`npx tsx src/lib/ai-grader/actions/__tests__/wechat-confirm-policy.test.ts` 通过；runtime-architecture 守卫通过（`npm run test:ci` 内）。

## 4. 库存路由

- [x] 4.1 `inventory/route.ts` GET 要求 `inventory.read | inventory.manage`，POST 要求 `inventory.manage`；`[id]/route.ts` PATCH 要求 `inventory.manage`，码数调整写 AuditLog `inventory.adjusted`（before / after / reason）；删除角色字符串判定。verify：typecheck；`grep -rnE "user\.role\s*[!=]==|isAdmin\(" src/app/api/inventory` 为空。

## 5. 入口与页面

- [x] 5.1 `navigation/types.ts` 加 `requiredPermissions?: string[]`，`filter.ts` 在 `platformRoleOk` 里"平台角色命中 或 权限命中"；`registry.ts` 给 `biz-work-orders` 加 `["orders.fulfillment.read","sales.order.create"]`、`biz-inventory` 加 `["inventory.manage","inventory.read"]`；`navigation-workspace.test.ts` 加"平台角色 user + 权限键 → 可见 / 无权限键 → 不可见"两例。verify：`npx tsx src/lib/navigation/__tests__/navigation-workspace.test.ts` 与 `navigation-ia.test.ts` 通过。
- [x] 5.2 `blinds-orders/[id]/page.tsx`：详情接口返回 `access: { canEdit, categories, missingCategories, responsiblePositions }`（由 3.1 的 GET 附带）；无 `canEdit` 时隐藏编辑 / 删除 / 状态按钮，显示品类与负责岗位；作废走 202 提示"已提交审批"。verify：typecheck；`npx eslint "src/app/(main)/blinds-orders/[id]/page.tsx"` 无 error。

## 6. 收尾

- [x] 6.1 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；写 `docs/QINGYAN_PERM-3_REPORT.md`（做了什么 / 怎么验 / 判断点含四个假设 / 已知限制：全局库存表、归属推导、BREAKING 上线顺序 + 受影响单的 SQL）；TASKFLOW PERM-3 改 `[G]`；更新 HANDOFF。verify：四条命令退出 0；`grep -c "PERM-3 .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1；`openspec validate perm-3-fulfillment-by-category --strict` 通过。

## Workflow follow-up

- PR 合并到 main 后 `/opsx:archive perm-3-fulfillment-by-category --yes`（独立小 PR）；确认 `openspec list --specs` 出现 `fulfillment/order-category-access`、`fulfillment/order-cancellation-approval`、`inventory/fabric-stock-access`。
- 生产：对 Sunny 重跑 `seedOrgAuthorizationProfiles`。
