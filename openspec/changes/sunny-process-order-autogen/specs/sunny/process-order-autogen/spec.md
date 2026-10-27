# Spec Delta

## Purpose

销售报价单被客户签字后，系统自动把 Order Form 转成一张草稿工艺单（Blinds / 国内下单 / 窗帘 / Vinyl），列出所有默认推导与缺失项供工厂核对，核对通过才能确认进入生产，并能导出与 Excel 原件同口径的工艺单工作簿。

## ADDED Requirements

### Requirement: 签字后自动生成草稿工艺单
报价单经 `POST /api/sales/quotes/{quoteId}/mark-signed` 或 `POST /api/sales/quotes/share/{token}/sign` 成功置为 signed 后，系统 SHALL 为该报价生成一张状态为 draft 的工艺单，关联报价的客户与商机，并在 Order Form 有任一可生产行时才生成。

#### Scenario: 销售现场生成订单
- **WHEN** 销售对含 2 个斑马帘行与 1 个 Vinyl 窗的报价调用 mark-signed 并成功
- **THEN** 响应体含 `processOrder: { id, code, created: true }`，数据库新增一张 status=draft 的工艺单，含 2 个 Blinds 行，Vinyl 窗在其工艺参数中

#### Scenario: 没有可生产行
- **WHEN** 报价 Order Form 的所有行都缺宽或高
- **THEN** 不生成工艺单，响应体 `processOrder` 为 `{ created: false, reason: "NO_PRODUCIBLE_LINES" }`

### Requirement: 自动生成幂等
同一报价 SHALL 至多对应一张自动生成的工艺单；重复签字调用、两条签字路径先后触发或并发触发时，系统 SHALL 返回已存在的工艺单而不再创建。

#### Scenario: 重复调用
- **WHEN** 对同一报价连续两次调用 mark-signed
- **THEN** 第二次响应 `processOrder.created` 为 false 且 `id` 与第一次相同，工艺单总数不变

### Requirement: 生成失败不阻断签字
自动生成过程中的任何错误 SHALL NOT 改变签字接口的成功状态码与报价的 signed 状态；错误 SHALL 记录到服务端日志，响应体 `processOrder` 为 `{ created: false, reason: "GENERATION_FAILED" }`。

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

### Requirement: 待核对清单
每一个由默认值推导、原件不支持或缺失的工艺输入 SHALL 产生一条待核对项，含行号、字段、原因与级别（提示 / 阻断）。罩盒默认映射、斑马帘默认 3:2 布纱比、窗帘杆型默认、Vinyl 开合编码推导为提示级；Vinyl 缺外框类型、外框组合不受支持、开合与扇数不符、切分非法、Wooden 百叶、Grommet 窗帘、不受支持的百叶尺寸为阻断级。

#### Scenario: 详情页可见
- **WHEN** 打开一张自动生成的工艺单详情页
- **THEN** 页面顶部列出全部待核对项，阻断级项以醒目样式标出并给出所在产品段与行号

### Requirement: 确认门禁
工艺单从 draft 转为 confirmed 时，若仍存在阻断级待核对项，`POST /api/blinds-orders/{id}/transition` 与 `PUT /api/blinds-orders/{id}`（body.status=confirmed）SHALL 都返回 409，错误码 `PROCESS_ORDER_BLOCKED`，并在响应中列出全部阻断项；无阻断项时按原逻辑转换。

#### Scenario: 缺外框类型
- **WHEN** 工艺单中某 Vinyl 窗外框类型为空，调用 transition 到 confirmed
- **THEN** 返回 409、`code: "PROCESS_ORDER_BLOCKED"`，`issues` 中含该窗"缺外框类型"，工艺单仍为 draft

#### Scenario: 详情页按钮路径
- **WHEN** 同一工艺单以 `PUT /api/blinds-orders/{id}` 提交 `{ "status": "confirmed" }`
- **THEN** 同样返回 409 `PROCESS_ORDER_BLOCKED`（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/sunny-process/__tests__/autogen-db.isolated.test.ts` 第 [3] 段）

### Requirement: 非 Blinds 工艺参数可编辑
draft 状态的工艺单 SHALL 允许通过 `PUT /api/blinds-orders/{id}/spec` 修改国内下单 / 窗帘 / Vinyl 的工艺参数与单头设置（Vinyl 颜色、百叶尺寸、默认控制杆、窗帘版本）；每次保存 SHALL 留存为新版本，读取以最新版本为准；非 draft 状态 SHALL 返回 409。

#### Scenario: 补外框后可确认
- **WHEN** 对上一场景的工艺单 PUT spec 补上外框类型 L，再调用 transition 到 confirmed
- **THEN** PUT 返回 200 且版本号 +1，transition 返回 200，工艺单为 confirmed

### Requirement: 工艺单导出
`GET /api/blinds-orders/{id}/export` SHALL 只对能查看该工艺单的用户返回 xlsx，按实际存在的产品线包含：开料表、工艺单、开料表（布料）、Blinds 标签、国内下单表、国内下单标签、窗帘工艺单、窗帘物料、Vinyl 工艺单、Vinyl 下料总表、Vinyl 标签、待核对；无任何行时返回 400。

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
自动生成、编辑参数、确认门禁与导出 SHALL NOT 发送邮件、微信或任何外部消息，也 SHALL NOT 修改报价金额与状态。

#### Scenario: 生成不发邮件
- **WHEN** mark-signed 触发自动生成
- **THEN** 除既有签字流程本身的通知外，不新增任何邮件或外部推送调用
