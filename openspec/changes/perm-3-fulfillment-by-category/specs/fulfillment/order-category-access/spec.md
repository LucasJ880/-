# Spec Delta

## Purpose

工艺单按品类归属出单岗位：定义品类如何从单据内容推导、谁能看 / 改 / 推进哪些工艺单，以及出单人的入口可见性。

## ADDED Requirements

### Requirement: 品类判定
系统 SHALL 把工艺单每一行按产品类型映射到品类 `vinyl` / `drapery` / `shades`：`卷帘`、`斑马帘`、`香格里拉` → `shades`；报价产品 `Drapery`、`Sheer` → `drapery`，`Shutters` → `vinyl`，`Zebra`、`Roller`、`SHANGRILA`、`Cordless Cellular`、`SkylightHoneycomb`、`Roman Shade`、`Roman`、`Allusion` → `shades`。未知产品类型 SHALL 判为无品类。一张单的品类集合 SHALL 是各行品类去重后的集合。

#### Scenario: 工艺单全为斑马帘
- **WHEN** 工艺单 4 行产品类型均为 `斑马帘`
- **THEN** 品类集合为 `{shades}`

#### Scenario: 未知产品类型
- **WHEN** 某行产品类型为 `百叶窗X`
- **THEN** 该行无品类，不计入集合

### Requirement: 工艺单修改权按品类
修改工艺单（含改行、改状态、导出以外的所有写操作）SHALL 要求操作者持有该单品类集合中**每一个**品类的 `orders.fulfillment.update.<品类>`，或持有全品类键 `orders.fulfillment.update`，或是平台管理员。缺任一品类 SHALL 返回 403，响应 SHALL 列出缺少的品类。品类集合为空的单 SHALL 只允许全品类键持有者与平台管理员修改。既有的项目可见性限制 SHALL 继续作为附加条件，不因本能力放宽。

#### Scenario: 出单·Roller/Zebra 改斑马帘单
- **WHEN** 持 `orders.fulfillment.update.shades` 的小叶修改品类集合为 `{shades}` 的工艺单
- **THEN** 返回 200

#### Scenario: 出单·Vinyl 改斑马帘单
- **WHEN** 持 `orders.fulfillment.update.vinyl` 的 Bill 修改品类集合为 `{shades}` 的工艺单
- **THEN** 返回 403，响应含 `missingCategories: ["shades"]`

#### Scenario: 老板改任何单
- **WHEN** 持 `orders.fulfillment.update` 的老板修改任意工艺单
- **THEN** 返回 200

### Requirement: 工艺单读范围
持 `orders.fulfillment.read`（ORG）的人 SHALL 能读取当前企业全部工艺单（列表、详情、导出）；工艺单所属企业 SHALL 按 客户所属企业 → 项目所属企业 → 创建人唯一活跃企业 的顺序推导，推导不出的单 SHALL 只对创建人与平台管理员可见。不持该键的人 SHALL 保持原有范围（可见项目的单 + 本人创建的单）。

#### Scenario: 出单人看全企业
- **WHEN** 持 `orders.fulfillment.read` 的蒋晨请求工艺单列表
- **THEN** 返回企业内全部工艺单，含他人创建、无项目归属的单

#### Scenario: 销售只看自己的
- **WHEN** 只持 `sales_rep` 岗位的 Alex 请求工艺单列表
- **THEN** 只返回其可见项目的单与本人创建的单

### Requirement: 创建工艺单
创建工艺单 SHALL 要求 `sales.order.create`；创建人 SHALL 始终能读取自己创建的单。

#### Scenario: 安装工不能建单
- **WHEN** 只持 `installer` 岗位的人创建工艺单
- **THEN** 返回 403

### Requirement: 状态推进按品类
把工艺单推进到 `confirmed`、`in_production`、`ready`、`installed`、`completed`，或在 `draft` 与 `confirmed` 之间退回，SHALL 适用与修改相同的品类判定；推进到 `scheduled` SHALL 继续要求 `install.task.assign`；推进到 `cancelled` SHALL 遵循 `fulfillment/order-cancellation-approval`。

#### Scenario: 出单人确认本品类单
- **WHEN** 小叶把品类 `{shades}` 的工艺单从 `draft` 转 `confirmed`
- **THEN** 返回 200，状态日志记录操作人为小叶

### Requirement: 入口可见性
导航中"工艺单"条目 SHALL 对持 `orders.fulfillment.read` 或 `sales.order.create` 的人显示，"面料库存"条目 SHALL 对持 `inventory.manage` 或 `inventory.read` 的人显示；原平台角色条件 SHALL 继续作为回退放行条件。工艺单详情页 SHALL 对无修改权的人隐藏编辑与删除操作，并显示本单品类集合与负责该品类的岗位名。

#### Scenario: 出单人看到入口
- **WHEN** 平台角色为 `user`、持 `fulfillment_drapery` 岗位的人加载导航
- **THEN** 导航含"工艺单"，不含"面料库存"

#### Scenario: 无权者看到只读详情
- **WHEN** Bill 打开品类 `{shades}` 的工艺单详情
- **THEN** 页面无"编辑""删除"按钮，显示"本单品类：Roller/Zebra/Roman · 负责岗位：出单·Roller/Zebra/Roman"

### Requirement: 响应不含成本与金额
工艺单列表与详情接口 SHALL NOT 新增任何成本价、报价金额或折扣字段；403 响应 SHALL NOT 透露其他企业的工艺单是否存在（统一 404）。

#### Scenario: 跨企业访问
- **WHEN** 梦馨成员请求 Sunny 的工艺单详情
- **THEN** 返回 404
