# Spec Delta

## Purpose

把 CAL-1 观察到的网站预约（Google 共享日历里归因为网站的新建事件）列成待转入清单，由销售确认后一键在青砚建客户与预约；不依赖网站插件，对 Google 只读。

## ADDED Requirements

### Requirement: 查看授权
网站预约的列表、详情与忽略接口 SHALL 要求调用者在该企业持 `sales.customer.create`（任意范围）或全企业范围的 `sales.customer.read`，否则返回 403；转入接口 SHALL 要求持 `sales.customer.create`，否则返回 403。

#### Scenario: 运营主管无权
- **WHEN** 只持 `ops_lead` 岗位的成员请求列表
- **THEN** 返回 403；`website-booking-intake-db.isolated.test.ts` 覆盖

#### Scenario: 老板只读
- **WHEN** 只持 `owner` 岗位的成员请求列表与转入
- **THEN** 列表返回 200，转入返回 403

### Requirement: 待转入列表
`GET /api/sales/website-bookings` SHALL 列出该企业日历观察账本中首次记录为新建且归因为网站的事件，按事件 ID 跨日历去重；SHALL 排除最近一条账本为删除的、已有本企业预约记下该事件 ID 的、已被忽略的，以及开始时间早于组织当地今天前 7 天的；按开始时间升序，最多 200 条。每条 SHALL 含事件 ID、日历 ID、标题、起止时间与是否全天。日历观察未开启时 SHALL 返回空列表与 `enabled: false`。

#### Scenario: 过滤
- **WHEN** 账本中有网站新建 4 条，其中 1 条已删除、1 条已转入、1 条已忽略
- **THEN** 列表只有 1 条；`website-booking-intake-pure.test.ts` 与隔离库测试覆盖

#### Scenario: 不是网站来源
- **WHEN** 账本中有一条归因为成员的新建事件
- **THEN** 它不出现在列表中

### Requirement: 详情与预填
`GET /api/sales/website-bookings/{eventId}?calendarId` SHALL 只对待转入列表中的事件返回详情（否则 404 `NOT_PENDING`）：用日历观察的读取账号实时读取该事件，返回标题、起止时间、地点、描述原文与预填建议（姓名、电话、邮箱、地址），以及调用者本人名下电话相同（末 10 位比对）的未归档客户。读取账号未连接或授权失效 SHALL 返回 409 `READER_NOT_CONNECTED`；Google 里已不存在该事件 SHALL 返回 404 `EVENT_NOT_FOUND`。描述原文与预填建议 SHALL NOT 落库。

#### Scenario: 预填
- **WHEN** 事件描述含"Name: Jane Doe / Phone: (416) 555-0100 / Email: jane@example.com"，地点为"12 Main St"
- **THEN** 预填姓名 Jane Doe、电话 (416) 555-0100、邮箱 jane@example.com、地址 12 Main St；`website-booking-intake-pure.test.ts` 覆盖

#### Scenario: 已有客户
- **WHEN** 调用者名下已有电话为 4165550100 的客户，事件描述电话为 +1 416-555-0100
- **THEN** 详情返回该已有客户作为建议关联对象

### Requirement: 转入
`POST /api/sales/website-bookings/{eventId}/convert` SHALL 对待转入事件，在一个事务里：关联调用者名下的未归档客户，或新建客户（来源为 `website_booking`，归属调用者）；再新建一条预约（记下该 Google 事件 ID 与同步时间，负责人缺省为调用者，指定时须为在职成员）。新建客户时若电话与调用者名下已有客户相同，SHALL 返回 409 `CUSTOMER_EXISTS` 并给出该客户，不建任何记录。成功 SHALL 返回 201 与客户、预约 ID，并写一条审计。

#### Scenario: 销售认领
- **WHEN** 销售填写新客户与预约信息并提交
- **THEN** 新客户归该销售，预约负责人为该销售，预约记下事件 ID，该事件从待转入列表消失；`website-booking-intake-db.isolated.test.ts` 覆盖

#### Scenario: 关联已有客户
- **WHEN** 销售选择关联本人名下已有客户
- **THEN** 不新建客户，预约挂在该客户下

#### Scenario: 电话重复
- **WHEN** 新建客户的电话与本人名下已有客户相同
- **THEN** 返回 409 `CUSTOMER_EXISTS`，客户与预约条数都不变

### Requirement: 只转入一次
同一企业的同一事件 SHALL 只能转入一次；并发或重复提交时，后到的请求 SHALL 返回 409 `ALREADY_CONVERTED`，不新建任何客户或预约。

#### Scenario: 两人同时认领
- **WHEN** 两个销售几乎同时转入同一事件
- **THEN** 一个返回 201，另一个返回 409 `ALREADY_CONVERTED`，该事件只有一条预约；`website-booking-intake-db.isolated.test.ts` 覆盖

### Requirement: 对 Google 只读
转入、忽略、列表与详情 SHALL NOT 新建、修改或删除任何 Google 日历事件；转入时 SHALL NOT 触发把预约推送到 Google 的既有同步。

#### Scenario: 转入不推送
- **WHEN** 一次转入成功
- **THEN** Google 写接口调用次数为 0；隔离库测试以源码断言与注入的读取函数验证

### Requirement: 忽略
`POST /api/sales/website-bookings/{eventId}/dismiss` SHALL 把待转入事件从列表移除并写一条审计（可带 ≤ 200 字的原因）；重复忽略 SHALL 幂等返回 200。

#### Scenario: 忽略测试预约
- **WHEN** 销售忽略一条测试预约
- **THEN** 该事件不再出现在列表，审计一条

### Requirement: 不留存与不外泄联系方式
列表 SHALL NOT 返回事件描述、创建者邮箱或任何联系方式；转入与忽略的审计 SHALL NOT 含电话、邮箱、地址与描述原文，只含事件 ID、日历 ID、客户与预约 ID、是否关联已有客户与忽略原因。

#### Scenario: 审计无联系方式
- **WHEN** 一次转入成功
- **THEN** 审计记录中不含该客户的电话与邮箱；`website-booking-intake-db.isolated.test.ts` 覆盖

### Requirement: 页面与入口
`/sales/website-bookings` 页面 SHALL 对有查看权的成员列出待转入事件，持转入权的成员可打开预填表单确认转入或忽略；只读成员 SHALL NOT 看到转入按钮。首页 SHALL 在待转入数 > 0 且有查看权时显示"网站预约待转入 N 条"入口，否则不显示。

#### Scenario: 无待转入
- **WHEN** 待转入数为 0
- **THEN** 首页没有该入口；可观察产物：浏览器检查记录写入报告
