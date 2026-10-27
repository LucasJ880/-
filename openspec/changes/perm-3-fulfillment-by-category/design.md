# Design: perm-3-fulfillment-by-category

## Context

见 proposal.md「Why」。现状（已读代码）：
- `BlindsOrder` 无 `orgId`，`customerId` 在创建接口里从不写入（只有 `creatorId`、`projectId`）；企业归属只能推导。`BlindsOrderItem.productType` 取值 `卷帘 / 斑马帘 / 香格里拉`（`PRODUCT_TYPES`）。
- `blinds-orders` 路由：列表 / 详情按 `getVisibleProjectIds` + 本人创建；PUT 对无项目归属的单只放行平台 `admin / super_admin`；transition 除 `scheduled`（INSTALL-1）外无判定。
- `inventory` 路由：POST / PATCH 判 `user.role !== "admin"`；`FabricInventory` 是全局表，无 orgId；码数调整已写 `FabricStockLog`。
- `DataScope` 没有 CATEGORY，`RolePermissionBinding` 没有属性列。
- 导航 `biz-work-orders / biz-inventory` 用 `requiredPlatformRoles`；INSTALL-1 已把 `permissionKeys` 注入 `NavigationFilterContext`。
- 审批统一入口 `requestApproval`（`src/lib/approval/port.ts`）；执行器按 `PendingActionType` 分派；微信确认策略表要登记每个类型。

## Goals / Non-Goals

**Goals:**
- 不加列、不加 scope：品类做成权限键后缀，判定是纯函数。
- 出单人能改且只能改自己品类的单；老板全品类；作废走审批。
- 运营主管能管库存；其他岗位只读。

**Non-Goals:**
- 不改 `src/lib/projects/visibility.ts`（`getVisibleProjectIds`）。
- 不给 `FabricInventory` 做企业隔离；不改 `prisma/schema.prisma`。
- 不改报价（`SalesQuote*`）的任何编辑权限（PERM-4a）。
- 不删 `requiredPlatformRoles` / `NAV_ROLES_*`（PERM-4c）。
- 不动 `blinds-orders/[id]/transition` 里 INSTALL-1 的 `scheduled` 分支逻辑。

## 八条硬纪律对照

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 遵守。品类由 `productType` 推导；权限键是 registry 常量；作废审批用 PendingAction |
| 2 | 出站先审批 | 不涉及对外发送；作废工艺单按设计稿 §4-2 作为敏感操作走 `requestApproval` |
| 3 | 禁止第三套队列 | 遵守。只用 PendingAction |
| 4 | 脱敏 | 不涉及 Muse。工艺单与库存响应不新增金额 / 成本字段（spec 有 SHALL NOT） |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 不涉及 |
| 7 | 确定性优先 | 遵守。品类映射表、`canEditOrder` 决策、企业归属推导全是纯函数 |
| 8 | 测试注册 | 遵守。`src/lib/fulfillment/__tests__/*.test.ts` 注册进 `scripts/test-all.sh` |

## Decisions

### D1 品类 = 权限键后缀，不是 DataScope
`orders.fulfillment.update.vinyl / .drapery / .shades` 三把键 + 伞键 `orders.fulfillment.update`。
- 否决：新增 `DataScope = "CATEGORY"` 并在绑定上记品类。理由：绑定表没有属性列，零 schema 下无处存"哪个品类"。
- 否决：把品类写进 `Organization.settingsJson` 的 "用户 → 品类" 映射。理由：绕开岗位体系，PERM-1 的绑定脚本与岗位快照测试都覆盖不到。
- 代价：新增品类要加键 + 改模板，一次性且有测试锁。

### D2 混品类单要求"全部品类"而不是"任一"
`canEditOrder({ categories, heldKeys })`：有伞键 → 允许；否则 `categories ⊆ held` 才允许。
- 否决：任一品类命中即可。理由：Vinyl 出单人会改到布帘行；宁严勿宽，混品类单由老板处理。
- 空品类集合（全部行未知类型）只给伞键持有者 —— 等价于"不认识的东西只有老板能动"。

### D3 企业归属推导顺序
`resolveOrderOrgId(order)`：`customer.orgId` → `project.orgId` → 创建人唯一活跃企业 → `null`。
- 否决：只按创建人。理由：有项目的单应归项目企业；创建人多企业时无法判定。
- `null` 时只有创建人与平台管理员可见（与现状一致，不放宽）。

### D4 作废走审批，退回不走
`cancelled` 由 `orders.cancel` 持有者提交 → `requestApproval({ type: "orders.cancel_blinds_order", approver: { requiredPermission: "orders.cancel" }, idempotencyKey: orderId })`；执行器校验批准人 ≠ 提交人且持 `orders.cancel`（企业无其他持有者时沿用 PERM-2 的过渡态：只拒自批）。`draft ↔ confirmed` 退回视同普通状态推进。
- 否决：出单人也能作废。理由：设计稿 §4-2 把作废列为老板敏感操作。
- 否决：作废直接生效、事后审计。理由：与 PERM-2 的"设置走审批"口径不一致。

### D5 库存不做企业隔离
`FabricInventory` 全局；读权 `inventory.read`，写权 `inventory.manage`，判定时 `orgId` 取用户当前企业（`resolveRequestOrgIdForUser`）。
- 否决：按 `productType` 推企业。理由：两家企业产品重叠；梦馨现在不用库存，隔离留到有需求时（届时也只能 settingsJson 白名单，仍零 schema）。

### D6 导航 `requiredPermissions` 与平台角色并存
`NavigationItem.requiredPermissions?: string[]`，任一命中即可见；`requiredPlatformRoles` 命中也可见（过渡）。
- 否决：直接删 `requiredPlatformRoles`。理由：会把 `boss / operations` 平台角色的老用户一次性关在门外，这是 PERM-4c 的事。

### D7 执行器写状态复用 transition 的更新逻辑
把"置状态 + 时间戳字段 + OrderStatusLog"抽成 `applyOrderTransition(tx, order, toStatus, operatorId, note)`，transition 路由与作废执行器共用，避免两份状态写法。
- 否决：执行器内部再 fetch 一次 transition 路由。理由：执行器无 request 上下文，且架构守卫禁止旁路。

## Risks / Trade-offs

- [旧工艺单多数无 customerId / projectId，归属靠创建人] → 创建人多企业的单推不出企业，只有创建人与平台管理员可见；REPORT 列出 Sunny 现网受影响条数的查询 SQL，必要时由平台管理员补 `projectId`。
- [出单岗位失去全品类键是 BREAKING] → 上线前先对 Sunny 重跑 `seedOrgAuthorizationProfiles`（模板更新幂等），再跑绑定脚本；顺序写进 REPORT。
- [混品类单老板才能改] → 现网工艺单全是 shades，实际不受影响；布帘 / Vinyl 单进入工艺单后再评估。
- [`requiredPermissions` 需要 `permissionKeys` 已加载] → 客户端初次渲染前 `permissionKeys` 为空时按平台角色回退；不会多显示，只会晚显示。

## Migration Plan

1. 合并后对 Sunny 跑 `seedOrgAuthorizationProfiles`（更新三个出单模板与 owner / ops 模板）。
2. 绑定不变（岗位 key 不变），无需重跑绑定脚本；验证 `fulfillment_*` 的人能改自己品类的单。
3. 回滚：revert PR；模板回到上一版需再跑一次 seed。

## 验证方式

- `npx tsx src/lib/fulfillment/__tests__/category.test.ts`：映射表每个值一例、集合去重、未知类型。
- `npx tsx src/lib/fulfillment/__tests__/order-access.test.ts`：`canEditOrder` 决策表（单品类 × 3 岗 / 混品类 / 伞键 / 空集合）、`resolveOrderOrgId` 四条来源、`missingCategories`。
- `npx tsx src/lib/authorization/__tests__/authorize.test.ts`：三个出单岗快照、owner 伞键 + `orders.cancel`、ops_staff 只读库存。
- `npx tsx src/lib/ai-grader/actions/__tests__/wechat-confirm-policy.test.ts`：类型数 +1。
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`。
- `grep -rnE "user\.role|isAdmin\(" src/app/api/blinds-orders src/app/api/inventory` 为空。
