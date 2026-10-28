# PERM-3 报告 — 出单按品类 + 库存改动限运营主管 + 作废走审批

change：`openspec/changes/perm-3-fulfillment-by-category/`（proposal / specs ×4 / design / tasks 8/8）
任务书：`docs/QINGYAN_PERM-3_FULFILLMENT_BY_CATEGORY_TASKBRIEF.md`　设计稿：§3 三个出单岗、§4 第 2 / 7 条、§5 C6
零 schema：品类由 `productType` 推导；权限键按品类拆分；作废用 PendingAction。

## 1. 做了什么

### 1.1 权限键与岗位（`permissions.ts` / `role-defaults.ts`）
| 键 | 范围 | 给谁 |
|---|---|---|
| `orders.fulfillment.update.vinyl / .drapery / .shades` | ORG | 对应出单岗 |
| `orders.fulfillment.update`（全品类伞键） | ORG | **只给 owner**（出单岗不再持有，BREAKING） |
| `orders.fulfillment.read` | ORG | 出单岗 ×3、owner、ops_lead |
| `orders.cancel` | ORG | owner |
| `inventory.manage` | ORG | ops_lead、owner（原有） |
| `inventory.read` | ORG | 出单岗 ×3、owner、ops_lead、ops_staff、sales_rep |

`authorize.test.ts` 67 → 77（11 个窗饰模板；出单岗只含自己品类键；owner 伞键 + 作废 + 库存管理；ops_staff / sales_rep 只读库存）。

### 1.2 纯函数（`src/lib/fulfillment/`）
- `category.ts`：`卷帘 / 斑马帘 / 香格里拉 → shades`；报价产品 `Drapery / Sheer → drapery`、`Shutters → vinyl`、其余窗饰 → `shades`；`orderCategories(items)` 去重；品类 ↔ 岗位名表。
- `order-access.ts`：`canEditOrder`（伞键 → 允许；否则单的**全部**品类都在持有键内；空集合只给伞键；平台管理员允许）、`missingCategories`、`responsiblePositions`、`pickOrderOrgId`（客户企业 → 项目企业 → 创建人唯一企业 → null）、`isPlainTransition`（含 `confirmed → draft` 退回）、`applyOrderTransition(tx, …)`（状态 + 时间戳 + OrderStatusLog，transition 路由与作废执行器共用）。
- `service.ts`（DB 侧）：`loadHeldKeys`（一次解析 ALLOW 键）、`resolveOrderOrgId`、`resolveOrderAccess`（canRead = 全企业读键 或 旧范围；项目可见性仍是附加条件）、`orgWideOrderFilter`（列表 where + 创建人多企业的后置剔除）。
- 测试：`category.test.ts` 12、`order-access.test.ts` 17，已注册（422）。

### 1.3 工艺单路由
| 路由 | 变化 |
|---|---|
| `GET /api/blinds-orders` | 持 `orders.fulfillment.read` → 全企业（企业解析失败时回落旧范围）；否则旧范围 |
| `POST /api/blinds-orders` | 要求 `sales.order.create` |
| `GET /api/blinds-orders/[id]` | 读范围判定（跨企业 404）；响应附 `access: { canEdit, categories, missingCategories, responsiblePositions }` |
| `PUT / DELETE /api/blinds-orders/[id]` | `canEditOrder`：缺品类 403 `FULFILLMENT_CATEGORY_FORBIDDEN` + 清单；删除"无项目归属只有平台 admin 可改"分支；DELETE 原本**无任何判定**，现与 PUT 同 |
| `GET /api/blinds-orders/[id]/export` | 原本无判定，现与读同范围 |
| `POST …/transition` | 普通推进 / `draft ↔ confirmed` 退回 → `canEditOrder`；`scheduled` 保持 INSTALL-1；`cancelled` → 见 1.4；状态写入统一 `applyOrderTransition` |

### 1.4 作废走审批
- 持 `orders.cancel` 的老板提交 → `requestApproval`（类型 `orders.cancel_blinds_order`，幂等键 `blinds-order-cancel:{orderId}`，审批人候选 = 其他持 `orders.cancel` 者）→ 202 `{ pending, approvalId }`；已 cancelled / completed → 409；出单人 → 403。
- 执行器 `execOrdersCancelBlindsOrder`：批准人 ≠ 提交人且持 `orders.cancel`（企业无其他持有者时过渡态只拒自批，与 PERM-2 同）→ 事务内转 `cancelled` + OrderStatusLog（操作人 = 提交者）→ 审计 `blinds_order_cancelled` → 通知提交人；已 cancelled 幂等成功。
- 平台管理员直接作废，审计 `selfApproved: true`。
- 微信确认策略 `web_only_review`（类型数 15 → 16）。

### 1.5 库存
- `GET /api/inventory`：`inventory.read | inventory.manage`；`POST` / `PATCH`：`inventory.manage`；删除 `user.role !== "admin"`。
- 码数调整：原有 `FabricStockLog` + 新增审计 `inventory.adjusted`（before / after / adjustYards / type / reason / sku）。
- 企业取用户当前企业（`resolveRequestOrgIdForUser`，多企业需传 `?orgId`）；`FabricInventory` 仍是全局表。

### 1.6 入口与页面
- `NavigationItem.requiredPermissions`（任一命中可见；与 `requiredPlatformRoles` 并存时二者任一命中；单独存在时必须命中）；`biz-work-orders` = `["orders.fulfillment.read","sales.order.create"]`，`biz-inventory` = `["inventory.manage","inventory.read"]`。`navigation-workspace.test` 30 → 34。
- 工艺单详情页：显示"本单品类 · 负责岗位"，无 `canEdit` 时隐藏安排安装 / 状态按钮 / 编辑 / 删除并标"只读"；新增"作废"按钮（提交审批，202 提示"已提交等待另一位老板批准"）。

## 2. 怎么验
| 项 | 结果 |
|---|---|
| `category.test` / `order-access.test` | 12 / 17 passed |
| `authorize.test` | 77 passed |
| `navigation-workspace` / `navigation-ia` / `nav-active-matcher` / `trade-layout` | 34 / 63 / 21 / 5 |
| `wechat-confirm-policy.test` | 通过（16 类型） |
| `npm run typecheck` | 0 error |
| `npx eslint`（本 change 文件） | 0 error |
| `npm run lint:baseline` | PASS |
| `npm run test:ci` | PASS（含 runtime-architecture 守卫） |
| `check-test-registry` | OK（422） |
| `grep -rnE "user\.role\s*[!=]==\|isAdmin\(" src/app/api/blinds-orders src/app/api/inventory` | 空 |
| `openspec validate perm-3-fulfillment-by-category --strict` | valid |

沙箱无 PostgreSQL，路由未端到端跑，见 §5。

## 3. 判断点（任务书四条，按推荐默认值实施）
1. **品类 = 权限键后缀**，不加 scope / 列。新增品类 = 加一把键 + 改模板 + 映射表一行。
2. **报价产品映射**：`Shutters → vinyl`、`Allusion → shades`。改表即生效（`src/lib/fulfillment/category.ts`）。
3. **出单人不能作废**：只能 `confirmed → draft` 退回；作废只有老板且走审批。
4. **库存不隔离企业**：`FabricInventory` 全局；判定用用户当前企业。
5. 实施中追加：混品类单要求**全部**品类键（宁严勿宽）；创建人多企业且无客户无项目的单推不出企业 → 只有创建人与平台管理员可见；详情接口附 `access` 摘要供前端只读态。

## 4. 已知限制与上线顺序
- **BREAKING**：出单岗模板不再含全品类键。上线后必须对 Sunny 重跑 `seedOrgAuthorizationProfiles`（幂等）；岗位 key 不变，绑定不用重跑。
- 现网工艺单全是 `卷帘 / 斑马帘 / 香格里拉`（= shades）；Vinyl / 布帘的"订单"目前只存在于报价行，报价行级出单编辑在 PERM-4a 接。
- 旧工艺单多数无 `customerId`（创建接口从不写）也无 `projectId`：归属靠创建人唯一企业。查受影响条数：
  `SELECT count(*) FROM "BlindsOrder" o WHERE o."customerId" IS NULL AND o."projectId" IS NULL AND (SELECT count(*) FROM "OrganizationMember" m WHERE m."userId"=o."creatorId" AND m.status='active') <> 1;`
  结果非 0 时由平台管理员补 `projectId` 或 `customerId`。
- `FabricInventory` 全局：梦馨若启用库存需再做隔离（settingsJson 白名单，仍零 schema）。
- 详情页 `PUT status`（"确认工艺单 / 标记完成"按钮）仍绕过状态机直接写状态；现受 `canEditOrder` 门禁，但不校验边。PERM-4a 顺手改走 transition。
- 导航 `requiredPlatformRoles` 保留为回退（boss / operations 平台角色仍可见），PERM-4c 删除。

## 5. 手工走查（上线后）
0. 重跑 seed；确认 `fulfillment_shades` 的人 `permissionKeys` 含 `orders.fulfillment.update.shades`、`orders.fulfillment.read`、`inventory.read`。
1. 小叶登录：侧栏有"工艺单""面料库存"；工艺单列表看到全企业；打开斑马帘单可编辑、可"确认工艺单"；库存页只读（调整返回 403）。
2. Bill（Vinyl）打开同一张斑马帘单：只读态，显示"本单品类：Roller/Zebra/Roman · 负责岗位：出单·Roller/Zebra/Roman"；直接调 PUT 返回 403 + `missingCategories: ["shades"]`。
3. Marty：库存新增 / 调整 200；审计中心出现 `inventory.adjusted`。Maggie：库存可看，调整 403。
4. Bob 对一张 confirmed 单点"作废"→ 202；审批中心出现"审批作废工艺单 …"；Bob 自己批 → 拒绝；Bill 批 → 工艺单 cancelled，状态日志一条；再提交同单作废 → 409。
5. Alex（销售）：工艺单列表只见本人创建；新建工艺单 200；安装工新建 → 403。
6. Lucas（super_admin）：任意单可改；作废立即生效且审计 `selfApproved: true`。

## 5b. 合并 main 的整合（2026-10-28，design D8 / tasks §7）

PR 开出后 main 合入了 sunny-process 签字自动生成工艺单（#266 / #272），5 个文件冲突，GitHub 因此没跑 CI。合并 `origin/main` 后的语义整合：

| 冲突点 | 处理 |
|---|---|
| 可见性两套（`canViewBlindsOrder` vs `resolveOrderAccess`） | 合一：`canViewBlindsOrder` 委托 `canRead`；旧范围加"无项目时关联客户所在企业成员"（sunny 规格） |
| 品类只看 `items` | 加参数行：国内下单 → shades、窗帘 → drapery、Vinyl → vinyl、外采购按段；全部发给国内后不退化为空集合 |
| sunny 新写接口（`PUT spec` / `move-lines`）只判可见 | 按品类 403 |
| PUT `status` 可直接改 `cancelled` / `scheduled` | 409 `USE_TRANSITION`（防绕过作废审批与 `install.task.assign`） |
| 对照表保存判 `orders.fulfillment.update`（出单岗已不持） | `orders.fulfillment.update.shades` 或伞键；sunny 规格 MODIFIED 增量 |
| transition 锁 + 确认门禁 vs `applyOrderTransition` | 锁内重读 → `isPlainTransition` / 门禁 → `applyOrderTransition` |

验证：typecheck / `lint:baseline` / `test:ci` / registry 全绿；category 18、order-access 17、autogen 31、line-moves 27、authorize 77；`autogen-db.isolated.test.ts` 在本地 Postgres 16 + pgvector 隔离库 **41/41**（夹具：工厂先断言未绑定 403 再绑三个出单岗；对照表 403 用另一名未绑定成员 + 只持 Vinyl 键的情形）。

**行为变化（上线须知）**：sunny 自动生成单的草稿核对（改参数 / 挪行 / 确认）从"同组织任何成员"收紧为"持本单全部品类键的出单岗"。Sunny 需先重跑 seed 并确认工厂人员已绑定对应 `fulfillment_*` 岗位。

## 6. 合并后
`/opsx:archive perm-3-fulfillment-by-category --yes` 独立小 PR；`openspec list --specs` 应出现 `fulfillment/order-category-access`、`fulfillment/order-cancellation-approval`、`inventory/fabric-stock-access`。
