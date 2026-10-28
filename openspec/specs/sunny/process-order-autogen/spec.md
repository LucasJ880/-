# sunny/process-order-autogen Specification

## Purpose
销售报价单被客户签字后，系统自动把 Order Form 转成一张草稿工艺单（Blinds / 国内下单 / 窗帘 / Vinyl），列出所有默认推导与缺失项供工厂核对，核对通过才能确认进入生产，并能导出与 Excel 原件同口径的工艺单工作簿。

## Requirements

### Requirement: 签字后自动生成草稿工艺单
报价单经 `POST /api/sales/quotes/{quoteId}/mark-signed` 或 `POST /api/sales/quotes/share/{token}/sign` 成功置为 signed 后，系统 SHALL 为该报价生成一张状态为 draft 的工艺单，关联报价的客户与商机，并在 Order Form 有任一可生产行时才生成。

#### Scenario: 销售现场生成订单
- **WHEN** 销售对含 2 个斑马帘行与 1 个 Vinyl 窗的报价调用 mark-signed 并成功
- **THEN** 响应体含 `processOrder: { id, code, created: true }`，数据库新增一张 status=draft 的工艺单，含 2 个 Blinds 行，Vinyl 窗在其工艺参数中

#### Scenario: 没有可生产行
- **WHEN** 报价 Order Form 的所有行都缺宽或高
- **THEN** 不生成工艺单，响应体 `processOrder` 为 `{ created: false, reason: "NO_PRODUCIBLE_LINES" }`

### Requirement: 自动生成幂等
同一报价 SHALL 至多对应一张自动生成的工艺单；重复签字调用、两条签字路径先后触发或并发触发（含一方已提交后另一方才进入创建）时，系统 SHALL 返回已存在的工艺单而不再创建，也 SHALL NOT 以编号后缀另建一张。

#### Scenario: 重复调用
- **WHEN** 对同一报价连续两次调用 mark-signed
- **THEN** 第二次响应 `processOrder.created` 为 false 且 `id` 与第一次相同，工艺单总数不变

### Requirement: 生成失败不阻断签字
自动生成过程中的任何错误 SHALL NOT 改变签字接口的成功状态码与报价的 signed 状态；错误 SHALL 记录到服务端日志。`mark-signed` 响应体 `processOrder` 为 `{ created: false, reason: "GENERATION_FAILED" }`；公开签字接口面向客户，SHALL NOT 在响应中返回任何工艺单信息。

#### Scenario: 映射抛错
- **WHEN** Order Form 数据损坏导致生成抛错
- **THEN** mark-signed 仍返回 200 且报价为 signed，`processOrder.reason` 为 "GENERATION_FAILED"

### Requirement: 报价到工艺字段的映射
系统 SHALL 按以下口径从 Order Form 推导工艺输入：Lift L/R → 普通拉绳、拉杆位置 L/R，Lift M → 电动；Mount I/O → IN/OUT；Bracket C/W → 顶装/墙装；Valance Cassette → 亮白插片圆盒、Fascia → 哑白方型罩盒、None → 单轨无盒；窗帘 Pleat P → 韩褶P、R → 蛇型R，Fullness 180/230 → 1.8/2.3，Panels S/D → 1/2，Bracket C/W → 顶装C/墙装W，版本默认 6cm。

#### Scenario: 斑马帘行映射
- **WHEN** Order Form 斑马帘行 Mount=O、Lift=L、Bracket=W、Valance=Cassette
- **THEN** 工艺单行为 斑马帘 / OUT / 普通 / 拉杆位置 L / 亮白插片圆盒 / 墙装

#### Scenario: 电动行
- **WHEN** 卷帘行 Lift=M
- **THEN** 操控方式为电动，且待核对中有一条"电机侧默认 R"提示

### Requirement: 斑马帘布纱比对照表
系统 SHALL 维护组织级的斑马帘「面料编码 → 布:纱」对照表（存于 `Organization.settingsJson.sunnyProcess.zebraRatios`，组织从未保存时以原件《Blinds 工艺单》Sheet1 W 列 24 条为种子），经 `GET/PUT /api/sunny-process/zebra-ratios` 与页面 `/blinds-orders/zebra-ratios` 查看与整表编辑；组织成员可读，保存 SHALL 需要持 `orders.fulfillment.update.shades`（出单·Roller/Zebra/Roman 岗位；斑马帘属 shades 品类）或全品类键 `orders.fulfillment.update`、或 org_admin 及以上组织角色、或平台管理员，否则 403；每次保存记一条 AuditLog。生成工艺单与退回自产时，斑马帘 SHALL 按报价 SKU 查表：编码与 SKU 完全相同优先，否则编码作为完整一段出现在 SKU 中即命中（空格 / 下划线 / 斜杠视同连字符），多条命中取最长编码；命中时用表中布纱比并在待核对写明来源，未命中时默认 3:2 并提示核对。

#### Scenario: 系列名命中
- **WHEN** 对照表有 `AQUAWIDE3 → 3 4/16 : 2 3/16`，报价斑马帘 SKU 为 `AQUAWIDE3-GRAY-LF`
- **THEN** 工艺单该行布纱比为 3.25 : 2.1875，待核对提示含"对照表「AQUAWIDE3」"

#### Scenario: 未命中
- **WHEN** 报价斑马帘 SKU 不在对照表中
- **THEN** 布纱比为 3 : 2，待核对提示"不在布纱比对照表里…请按面料核对"

#### Scenario: 组织隔离
- **WHEN** 另一组织的用户读取对照表
- **THEN** 读到的是该用户自己组织的表（未保存则为种子），看不到本组织的条目（`autogen-db.isolated.test.ts` 第 [5b] 段）

#### Scenario: 出单岗位可以保存
- **WHEN** 一个组织角色为 org_member、但绑定了出单·Roller/Zebra/Roman 岗位（持 `orders.fulfillment.update.shades`）的用户保存对照表
- **THEN** 返回 200；`GET` 返回 `canEdit: true`（`autogen-db.isolated.test.ts` 第 [5b] 段）

#### Scenario: 无出单权限的普通成员只读
- **WHEN** 一个 org_member、未绑定出单岗位的用户保存对照表
- **THEN** 返回 403，`GET` 返回 `canEdit: false`

#### Scenario: 只持其他品类出单键
- **WHEN** 只绑定出单·Vinyl 岗位（持 `orders.fulfillment.update.vinyl`）的 org_member 保存对照表
- **THEN** 返回 403

### Requirement: 外采购行
报价中 Wooden 百叶、外框为 S / G / M / Casing 的百叶（属于 Wooden 百叶）、百叶尺寸为 4-1/2" 或 Arch 的百叶、Pleat 为 G 的打孔窗帘、以及没有工艺模板的帘子产品，系统 SHALL 不做工艺计算，按销售在 Order Form 上填写的原值（尺寸原样、各列原值，不含价格与草图）生成外采购行，SHALL NOT 产生阻断项；导出 SHALL 含「外采购单」工作表。Vinyl 材质却选了 Wooden 外框时 SHALL 另给一条订单级提示请与销售确认。

#### Scenario: Wooden 外框
- **WHEN** Vinyl 报价的一扇百叶外框为 Casing
- **THEN** 该窗不进 Vinyl 段，进外采购行（品类 Wooden 百叶、销售填写含 `Frame: Casing`），待核对无阻断，另有一条订单级提示

#### Scenario: 4-1/2" 百叶
- **WHEN** 报价百叶尺寸为 4-1/2" 或 Arch
- **THEN** 全部百叶行进外采购行，工艺单可确认

### Requirement: 发给国内与退回自产
draft 工艺单 SHALL 支持 `POST /api/blinds-orders/{id}/move-lines`：`{ to: "domestic", itemIds | "all" }` 把自产 Blinds 行按当前字段原样移到国内下单表；`{ to: "in_house", domesticLines }` 把国内下单表里的卷帘 / 斑马帘 / 香格里拉退回自产行。国内下单表没有对应列的值 SHALL 写成备注标记并在退回时原样还原。操作 SHALL 在一个事务内重写自产行并追加一版工艺参数，待核对提示随行搬段。非 draft 或 `baseVersion` 过期返回 409，无可挪的行返回 400，无权查看者 404；SHALL NOT 发送任何外部消息。

#### Scenario: 字段换算
- **WHEN** 卷帘行 OUT / 电动 / R / 单轨无盒 / 墙装 发给国内
- **THEN** 国内下单行为 外装 / 电机 / 右 / 单轨无盒 / 墙装，货号与位置同销售填写；该行"电机侧默认 R"提示跟到国内下单段（`line-moves.test.ts` LM-01a、LM-02f）

#### Scenario: 国内下单表没有的列不丢
- **WHEN** 一个侧装、拉杆 M、底杆覆盖 39.5、布纱比 3.3:2.1 的斑马帘行发给国内后再退回自产
- **THEN** 国内下单行的安装为空、备注含"安装 侧装；拉杆 M；底杆覆盖 39.5；布纱比 3.3:2.1"；退回后这些字段与原值完全相同（`line-moves.test.ts` LM-01c/d）

#### Scenario: 全部发给国内后再退回
- **WHEN** 工厂对含 1 个斑马帘自产行的工艺单（参数 v2）提交 `{ to: "domestic", itemIds: "all", baseVersion: 2 }`，再提交 `{ to: "in_house", domesticLines: [该行], baseVersion: 3 }`
- **THEN** 第一次后自产行为 0、国内下单表多一行斑马帘（货号与位置同销售填写）、参数 v3；第二次后自产行恢复为 1 行、布纱比为发出去前的值（之后保存的对照表不回写已生成的行）、开料重新计算、参数 v4（`autogen-db.isolated.test.ts` 第 [5b] 段）

### Requirement: 挪行与改写串行
挪行、保存工艺参数、整表改写自产行（`PUT /api/blinds-orders/{id}` 带 items）与状态转换 SHALL 在同一把工艺单级锁内串行，并在锁内重读状态再判定门禁；整表改写时若请求带的 `baseUpdatedAt` 与工艺单当前 updatedAt 不一致（期间有人挪过行或另存过），SHALL 返回 409 `ORDER_STALE` 且不写入。

#### Scenario: 旧编辑页不能把挪走的行写回
- **WHEN** 编辑页打开后有人把全部自产行发给国内，编辑页随后带旧 `baseUpdatedAt` 保存
- **THEN** 返回 409 `ORDER_STALE`，自产行仍为 0（`autogen-db.isolated.test.ts` 第 [5b] 段）

### Requirement: 待核对清单
每一个由默认值推导、原件不支持或缺失的工艺输入 SHALL 产生一条待核对项，含行号、字段、原因与级别（提示 / 阻断）。罩盒默认映射、斑马帘布纱比（查表来源或默认 3:2）、窗帘杆型默认、Vinyl 开合编码推导、外采购行为提示级；Vinyl 缺外框类型、外框组合不受支持、开合与扇数不符、切分非法、未选百叶尺寸为阻断级。

#### Scenario: 详情页可见
- **WHEN** 打开一张自动生成的工艺单详情页
- **THEN** 页面顶部列出全部待核对项，阻断级项以醒目样式标出并给出所在产品段与行号

### Requirement: 确认门禁
工艺单从 draft（或 cancelled）改到任何非 draft / 非 cancelled 状态时，若仍存在阻断级待核对项，`POST /api/blinds-orders/{id}/transition` 与 `PUT /api/blinds-orders/{id}`（任何 body.status）SHALL 都返回 409，错误码 `PROCESS_ORDER_BLOCKED`，并在响应中列出全部阻断项；无阻断项时按原逻辑转换。

#### Scenario: 缺外框类型
- **WHEN** 工艺单中某 Vinyl 窗外框类型为空，调用 transition 到 confirmed
- **THEN** 返回 409、`code: "PROCESS_ORDER_BLOCKED"`，`issues` 中含该窗"缺外框类型"，工艺单仍为 draft

#### Scenario: 详情页按钮路径
- **WHEN** 同一工艺单以 `PUT /api/blinds-orders/{id}` 提交 `{ "status": "confirmed" }`
- **THEN** 同样返回 409 `PROCESS_ORDER_BLOCKED`（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/sunny-process/__tests__/autogen-db.isolated.test.ts` 第 [3] 段）

### Requirement: 非 Blinds 工艺参数可编辑
draft 状态的工艺单 SHALL 允许通过 `PUT /api/blinds-orders/{id}/spec` 修改国内下单 / 窗帘 / Vinyl 的工艺参数与单头设置；每次保存 SHALL 留存为新版本，读取以最新版本为准；非 draft 状态、或请求带的 `baseVersion` 不是最新版本时 SHALL 返回 409；来源报价 SHALL NOT 可经此接口修改。

#### Scenario: 补外框后可确认
- **WHEN** 对上一场景的工艺单 PUT spec 补上外框类型 L，再调用 transition 到 confirmed
- **THEN** PUT 返回 200 且版本号 +1，transition 返回 200，工艺单为 confirmed

### Requirement: 有阻断的窗不进下料
有阻断级待核对项的 Vinyl 窗（及百叶尺寸不受支持时的全部 Vinyl 窗）SHALL NOT 出现在下料总表与标签中；下料总表表头 SHALL 注明被排除的窗数。

#### Scenario: 缺外框的窗
- **WHEN** 两个 Vinyl 窗中第 1 窗缺外框类型，导出工艺单
- **THEN** Vinyl 下料总表与 Vinyl 标签只含第 2 窗，表头含"1 窗有阻断"（`export-workbook.test.ts` EX-03d）

### Requirement: 工艺单对同组织成员可见
自动生成的工艺单 SHALL 出现在关联客户所在组织活跃成员的工艺单列表与详情中；其他组织的用户 SHALL NOT 能在列表、详情、参数、导出中看到它。

#### Scenario: 工厂看得到、外部看不到
- **WHEN** 同组织的工厂用户与另一组织的用户分别请求 `GET /api/blinds-orders` 与 `GET /api/blinds-orders/{id}`
- **THEN** 工厂列表含该单，外部用户列表不含、详情返回 404（`autogen-db.isolated.test.ts` 第 [4] 段）

### Requirement: 工艺单导出
`GET /api/blinds-orders/{id}/export` SHALL 只对能查看该工艺单的用户返回 xlsx，按实际存在的产品线包含：开料表、工艺单、开料表（布料）、Blinds 标签、国内下单表、国内下单标签、窗帘工艺单、窗帘物料、Vinyl 工艺单、Vinyl 下料总表、Vinyl 标签、外采购单、待核对；无任何行时返回 400。

#### Scenario: 只含窗帘
- **WHEN** 工艺单只有窗帘行
- **THEN** 导出文件只含窗帘工艺单、窗帘物料与待核对三张表

#### Scenario: 无权查看
- **WHEN** 非管理员、非创建人、不在工艺单项目内、且不是关联客户所在组织成员的用户请求导出
- **THEN** 返回 404，不返回文件

### Requirement: 生成通知与来源可追溯
自动生成成功时系统 SHALL 给报价创建人发一条站内通知（类型 `process_order_generated`，含工艺单编号与待核对阻断项数），并在工艺单详情中显示来源报价订单号与签字时间；工艺单与报价的关联 SHALL 可由报价 id 反查。

#### Scenario: 通知
- **WHEN** 自动生成成功
- **THEN** 报价创建人收到一条 `process_order_generated` 通知，标题含客户名，链接指向 `/blinds-orders/{id}`

### Requirement: 不触发任何对外发送
自动生成、编辑参数、发给国内 / 退回自产、编辑布纱比对照表、确认门禁与导出 SHALL NOT 发送邮件、微信或任何外部消息，也 SHALL NOT 修改报价金额与状态。

#### Scenario: 生成不发邮件
- **WHEN** mark-signed 触发自动生成
- **THEN** 除既有签字流程本身的通知外，不新增任何邮件或外部推送调用
