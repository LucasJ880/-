# Proposal

TASKFLOW：PERM-3（`docs/QINGYAN_PERMISSION_TASKFLOW.md`）；任务书 `docs/QINGYAN_PERM-3_FULFILLMENT_BY_CATEGORY_TASKBRIEF.md`

## Why

三个出单岗位绑的是全企业范围的 `orders.fulfillment.update`，工艺单路由却不读它：无项目归属的工艺单只有平台 admin 能改，出单人实际改不了，也看不到入口；库存增减同样只有平台 admin 能做，运营主管的 `inventory.manage` 没有接入点。

## What Changes

- 新增品类判定：工艺单行 `卷帘 / 斑马帘 / 香格里拉` → `shades`；报价行 `Drapery / Sheer` → `drapery`、`Shutters` → `vinyl`、其余窗饰产品 → `shades`；一张单的品类集合 = 各行品类去重。
- 权限键按品类拆分：新增 `orders.fulfillment.update.vinyl / .drapery / .shades`、`orders.fulfillment.read`、`orders.cancel`、`inventory.read`；`orders.fulfillment.update` 改为"全品类伞键"，只绑 `owner`。三个出单岗位各绑自己的品类键 + `orders.fulfillment.read`。**BREAKING**：出单岗位不再持有全品类 `orders.fulfillment.update`。
- 工艺单读写按岗位：列表 / 详情 / 导出对持 `orders.fulfillment.read` 的人放开到全企业（企业由客户 → 项目 → 创建人唯一企业推导）；修改与状态推进要求持有该单**全部**品类的更新键或伞键，缺品类 → 403 并列出缺的品类；删除"无项目归属只有平台 admin 可改"分支；创建要求 `sales.order.create`。
- 作废工艺单走审批：转 `cancelled` 只能由持 `orders.cancel` 的老板提交，经另一位老板批准后执行；平台管理员直批并记自批。出单人可在 `draft ↔ confirmed` 之间退回，不能作废。
- 库存改动限运营主管：库存新增 / 调整要求 `inventory.manage`；每次码数调整写库存流水与审计；删除平台 admin 角色字符串判定。
- 入口按权限：导航条目支持 `requiredPermissions`；"工艺单""面料库存"按权限显示，平台角色条件保留为过渡回退。
- 工艺单详情页：无编辑权时隐藏编辑 / 删除，显示本单品类与负责岗位。

## Capabilities

### New Capabilities
- `fulfillment/order-category-access`: 工艺单的品类判定、按岗位的读写范围、入口可见性
- `fulfillment/order-cancellation-approval`: 作废工艺单的审批流程与幂等 / 自批规则
- `inventory/fabric-stock-access`: 面料库存的读写权限与调整流水

### Modified Capabilities
- `authorization/position-catalog`: 出单岗位权限改为按品类键；新增权限键登记扩充；老板岗位追加伞键与作废权

## Impact

- `src/lib/authorization/permissions.ts`、`role-defaults.ts`、`__tests__/authorize.test.ts`
- 新建 `src/lib/fulfillment/category.ts`、`src/lib/fulfillment/order-access.ts` 及测试
- `src/app/api/blinds-orders/route.ts`、`[id]/route.ts`、`[id]/export/route.ts`、`[id]/transition/route.ts`
- `src/app/api/inventory/route.ts`、`[id]/route.ts`
- `src/lib/pending-actions/types.ts`、`executor.ts`、`src/lib/ai-grader/actions/wechat-confirm-policy.ts`（新类型 `orders.cancel_blinds_order`）
- `src/lib/navigation/types.ts`、`filter.ts`、`registry.ts`；`src/app/(main)/blinds-orders/[id]/page.tsx`
- 零 schema；不改 `getVisibleProjectIds`；`FabricInventory` 仍是全局表
