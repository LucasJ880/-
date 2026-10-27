# PERM-3 任务书：出单按品类 + 库存改动限运营主管

| 项 | 值 |
|---|---|
| 编号 | PERM-3（`fulfillment_vinyl / fulfillment_drapery / fulfillment_shades` 的 CATEGORY 范围落地；`inventory.manage` 落地） |
| 设计稿 | `docs/QINGYAN_PERMISSION_REDESIGN_DESIGN.md` §3（三个出单岗）、§4 第 2、7 条、§5 冲突 C6 |
| 依赖 | PERM-1（#264）、PERM-2（#265）、INSTALL-1（#268）已合并并 archive |
| 执行者 | Claude Code（`/opsx:propose perm-3-fulfillment-by-category`，一个 change） |
| 审核 | Claude（chat）；Lucas 拍板（§6 判断点先定） |
| 纪律 | 零 schema（品类从既有字段推导，不加列）；作废走 `requestApproval`；确定性优先；新测试注册 |

---

## 0. 先读

- `prisma/schema.prisma` `BlindsOrder` / `BlindsOrderItem` / `FabricInventory` / `FabricStockLog` —— 工艺单**没有 orgId**，靠 `customerId → SalesCustomer.orgId`、`projectId → Project.orgId` 或创建人唯一企业推导；`FabricInventory` 是**全局表**（也无 orgId）
- `src/lib/blinds/deduction-rules.ts` `PRODUCT_TYPES = ["卷帘","斑马帘","香格里拉"]` —— 工艺单行的品类来源；`src/lib/blinds/pricing-types.ts` `ProductName`（Zebra / Roller / SHANGRILA / Cordless Cellular / SkylightHoneycomb / Roman Shade / Roman / Drapery / Sheer / Shutters / Allusion）—— 报价行 `SalesQuoteItem.product` 的品类来源
- `src/app/api/blinds-orders/route.ts`（GET 用 `getVisibleProjectIds` + 创建人；POST 任何登录用户）、`[id]/route.ts`（GET 同上；PUT **无项目归属的单只有平台 admin 能改**；DELETE）、`[id]/transition/route.ts`（INSTALL-1 已给 scheduled 加 `install.task.assign` 判定；其余转换无判定）、`[id]/export/route.ts`
- `src/app/api/inventory/route.ts`（GET 任何登录用户；POST 仅平台 admin）、`[id]/route.ts`（PATCH 仅平台 admin）
- `src/lib/authorization/role-defaults.ts` `FULFILLMENT_BINDINGS`（现在只有 `orders.fulfillment.update` + INSTALL-1 的 read / photo.read，全部 ORG）；`ops_lead` 已绑 `inventory.manage`
- `src/lib/authorization/types.ts` `DataScope` —— **没有 CATEGORY**；RolePermissionBinding 也没有属性列，所以品类不能做成 scope（见 §6-1）
- `src/lib/navigation/registry.ts` `biz-work-orders` / `biz-inventory` —— `requiredPlatformRoles: [...NAV_ROLES_EXEC, "operations"]`，平台角色为 `user` 的出单人**看不到入口**；INSTALL-1 已把 `permissionKeys` 送进 `NavigationFilterContext`，可直接用
- `src/lib/approval/port.ts` `requestApproval`；`src/lib/pending-actions/executor.ts`（PERM-2 的 `execSalesUpdateQuoteSettings` 是最近样例）；`src/lib/wechat/wechat-confirm-policy.ts` 新类型要登记
- `openspec/specs/authorization/position-catalog/spec.md` —— 已归档的岗位规格，本次只能通过 change 增量修改

---

## Why

设计稿 §4-7：订单由销售建立，每个品类由出单人负责修改，面料库存由运营主管定。现状：
- 三个出单岗位绑的是 `orders.fulfillment.update`（ORG），没有任何按品类的限制；而且工艺单路由根本不读这把权限 —— 无项目归属的工艺单只有平台 admin 能改，出单人实际上改不了。
- 库存增减 / 盘点只有平台 admin 能做，Marty（运营主管）做不了，`inventory.manage` 没有接入点。
- 出单人的平台角色是 `user`，侧栏看不到"工艺单""面料库存"。

## What

### 1. 品类推导（纯函数，`src/lib/fulfillment/category.ts`）
- 品类枚举：`vinyl` / `drapery` / `shades`（与三个岗位一一对应）。
- `categoryOfProductType(productType)`：工艺单行 `卷帘 / 斑马帘 / 香格里拉` → `shades`；未知值 → `null`。
- `categoryOfQuoteProduct(product)`：报价行 `Zebra / Roller / SHANGRILA / Cordless Cellular / SkylightHoneycomb / Roman Shade / Roman / Allusion` → `shades`；`Drapery / Sheer` → `drapery`；`Shutters` → `vinyl`（**§6-2 待确认**）。
- `orderCategories(items)` → 去重品类集合；`missingCategories(required, held)`。
- 未来新增品类只改这一张表（设计稿"确定性优先"）。

### 2. 权限键按品类拆分（`permissions.ts` / `role-defaults.ts`）
- 新键（ORG）：`orders.fulfillment.update.vinyl`、`orders.fulfillment.update.drapery`、`orders.fulfillment.update.shades`；`orders.fulfillment.read`（看全企业工艺单，ORG）；`orders.cancel`（作废，仅 owner）。保留 `orders.fulfillment.update` 作为"全品类"伞键，只给 `owner`（平台管理员天然全权）。
- `fulfillment_vinyl` 绑 `.vinyl`；`fulfillment_drapery` 绑 `.drapery`；`fulfillment_shades` 绑 `.shades`；三者都绑 `orders.fulfillment.read`。`sales_rep` 绑 `orders.create`（PERM-1 已有）+ 本人创建单的读。
- 判定规则（纯函数 `canEditOrder({ categories, heldKeys })`）：持伞键 → 允许；否则**工艺单所有品类**都在持有的品类键内才允许，缺任一品类 → 403 并列出缺的品类。混品类单很少，宁严勿宽。

### 3. 工艺单路由接入
- 企业归属推导 `resolveOrderOrgId(order)`：`customer.orgId ?? project.orgId ?? 创建人唯一活跃企业`；推不出 → 只对创建人与平台管理员可见。
- GET 列表：`orders.fulfillment.read`（ORG）看全企业；否则回落现有"项目可见 + 本人创建"。
- GET 详情 / export：同上。
- PUT：`canEditOrder`；保留"项目可见"作为**附加**条件（不放宽）。删除"无项目归属只有平台 admin 可改"分支。
- POST：`orders.create`（销售 / 老板 / 出单）；创建人本人始终可见。
- transition：`confirmed / in_production / ready / installed / completed` 由持该单品类更新键的人推进；`scheduled` 保持 INSTALL-1 的 `install.task.assign`；**`cancelled` 改为走审批**（见第 5 条）。
- 不改 `getVisibleProjectIds`。

### 4. 库存接入
- POST / PATCH：`authorize(inventory.manage)`（ops_lead / owner / 平台管理员）；删除 `user.role !== "admin"` 分支。
- GET：企业成员可读（保持）。
- 每次 `adjustYards` 写 `FabricStockLog`（已有表）与 AuditLog `inventory.adjusted`（含前后码数、原因、操作人）。
- `FabricInventory` 是全局表：本阶段**不做企业隔离**（Sunny 单一租户在用；梦馨不用库存），在 REPORT 明示。

### 5. 作废工艺单走审批（设计稿 §4-2 敏感操作）
- transition `→ cancelled`：持 `orders.cancel` 的老板提交 → `requestApproval` 建 `orders.cancel_blinds_order`（payload：orderId、code、当前状态、原因）→ 另一位 `owner` 批准后执行器写状态 + OrderStatusLog + 审计；平台管理员直批记 `selfApproved`。出单人不能作废（只能退回 draft？**§6-3**）。
- `wechat-confirm-policy` 登记为 `web_only_review`。

### 6. 入口
- `NavigationItem` 新增 `requiredPermissions?: string[]`（任一命中即可），`filter.ts` 用 `ctx.permissionKeys` 判定；`biz-work-orders` 改为 `requiredPermissions: ["orders.fulfillment.read","orders.create"]`，`biz-inventory` 改为 `["inventory.manage","inventory.read"]`（新增 `inventory.read` 给 ops_staff / 出单岗只读）。`requiredPlatformRoles` 保留为过渡回退（PERM-4c 再删）。
- 工艺单详情页：无编辑权时隐藏"编辑 / 删除"，并显示"本单品类：…，由 … 岗负责"。

## 受影响意图
- Bill 只能改 Vinyl 单，蒋晨 / Bob 只能改布帘单，小叶只能改 Roller / Zebra / Roman 单；混品类单需要两个岗位都有的人（实际是老板）。
- Marty 能增减库存与盘点；平台 admin 不再是唯一能改库存的人。
- 老板作废工艺单要另一位老板批准。
- 出单人侧栏出现"工艺单""面料库存"。

## Out of scope
- 不加 orgId / category 列；不做 FabricInventory 企业隔离；不动 `getVisibleProjectIds`；不动报价（SalesQuote）的编辑权限；不做"订单金额修改走审批"（已成交单金额在报价上，属 PERM-4a 顺带评估）；不动导航的平台角色体系（PERM-4c）。

## 验收
- 纯函数测试：品类映射表每个值一例；`canEditOrder` 决策表（单品类 × 3 岗位 / 混品类 / 伞键 / 无键）；`missingCategories`。
- 路由测试（纯函数层）：`resolveOrderOrgId` 三条来源与推不出的回落。
- `authorize.test.ts`：三个出单岗快照更新（各自只有自己的品类键 + read）；owner 有伞键 + `orders.cancel`。
- `wechat-confirm-policy.test` 类型数 +1；执行器新增类型有用例（批准人 ≠ 提交人；平台管理员自批）。
- `npm run typecheck`、`lint:baseline`、`test:ci`、`check-test-registry` 通过；`openspec validate perm-3-fulfillment-by-category --strict` 通过；specs 增量覆盖：品类判定、工艺单读写范围、库存改动权限、作废审批、入口可见性五项对外行为。

---

## 6. 判断点（Lucas 先定，再 propose）

1. **品类不做 DataScope**：零 schema 下 RolePermissionBinding 没地方放"哪个品类"，所以用三把按品类拆的权限键。代价是新增品类要加键 + 改岗位模板（一次性）。替代方案是加 `attributesJson` 列 —— 违反零 schema，不建议。
2. **报价产品 → 品类映射**：`Shutters → vinyl` 是我按"Bill 出 Vinyl"推的，`Allusion`（百叶纱）我归到 `shades`；请确认。工艺单（BlindsOrder）现在只有 卷帘 / 斑马帘 / 香格里拉，全是 `shades`，所以 Vinyl / 布帘的"订单"目前只存在于报价行 —— PERM-3 先把规则和键立好，报价行级的出单编辑在 PERM-4a 接入。
3. **出单人能否作废 / 退回**：建议出单人只能在 `draft / confirmed` 之间退回，不能作废；作废只有老板（走审批）。
4. **`FabricInventory` 全局表**：是否接受本阶段不隔离企业（梦馨不用库存）。
