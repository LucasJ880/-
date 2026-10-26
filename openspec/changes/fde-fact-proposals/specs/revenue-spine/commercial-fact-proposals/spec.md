# Spec Delta

## Purpose

把销售在人工回复里写下的商务事实（起订量、样品与大货周期、装运港、落款、目录链接）用确定性规则抽出来，与企业已配置的值比较。不同或缺失时起一张审批卡，由企业负责人确认后写进商务事实，下一封 FDE 草稿直接引用。价格类条款永不抽取。

## ADDED Requirements

### Requirement: 规则化抽取商务事实
系统 SHALL 用确定性规则（词表 + 数字 / 单位模式，不调用 LLM）从人工回复相对草稿新增的事实段与签名段行中抽取商务事实。目标字段只限：
- `moq`：数量、单位、按什么计（如每色）；
- `sampleLeadTime`：现货样天数，或定制样天数区间；
- `productionLeadTime`：大货天数区间与起算点（周按 7 天换算）；
- `loadingPorts`：装运港名称；
- `signature`：落款里的职位、WhatsApp、网站；
- `catalogUrl`：与"目录 / catalog / brochure"同句出现的链接。

中英文与中英混排 SHALL 都能识别。抽取前 SHALL 截掉回复中引用的历史邮件（以 `>` 开头的行、"On … wrote:"、"Original Message"、"发件人："之后的内容）。网址与 WhatsApp 号码不取买家邮箱同域或买家电话的值。

#### Scenario: 起订量按色
- **WHEN** 新增行为 "MOQ is 500 pcs per color."
- **THEN** 抽到 `moq = { quantity: 500, unit: "pcs", per: "color" }`

#### Scenario: 中英混排周期
- **WHEN** 新增行为 "大货周期 35-45 days after PP sample approval"
- **THEN** 抽到 `productionLeadTime = { daysMin: 35, daysMax: 45 }`，起算点为确认产前样

#### Scenario: 引用的买家原信
- **WHEN** 人工回复末尾引用了买家原信，原信里有买家的网站与电话
- **THEN** 不从引用部分抽取任何值

#### Scenario: 表驱动测试
- **WHEN** 运行 `npx tsx src/lib/revenue-spine/__tests__/fact-extract.test.ts`
- **THEN** 至少 20 个用例全部通过，退出码 0

### Requirement: 抽取口径的边界
抽取 SHALL 遵守以下口径：
- 起订量取关键词之后最近的数字；
- 回复里没写的部分（起订量按什么计、大货起算点）记为未写，不猜默认值；
- 运输时间、产前样时效不当大货周期；目的港不当装运港；
- 目录链接只收 https，`www.` 开头补 `https://`；
- 没有结束语的短回复，最后一段也按事实段抽取；
- 线索页手工留痕（`trade_prospect.manual_outbound`）与开发信不作为抽取来源。

#### Scenario: 低于起订量的句式
- **WHEN** 新增行为 "Your order of 300 pcs is below our MOQ of 500 pcs per color."
- **THEN** 抽到的起订量是 500，不是买家的 300

#### Scenario: 运输时间与目的港
- **WHEN** 新增行为 "Delivery to your warehouse takes 25-30 days by sea." 或 "Destination port: Hong Kong."
- **THEN** 不抽大货周期，也不抽装运港

#### Scenario: 没有结束语的短回复
- **WHEN** 人工回复只有 "Hi Mark," 和 "MOQ is 500 pcs per color." 两段
- **THEN** 仍抽到起订量 500 pcs / color

### Requirement: 价格条款永不抽取
含以下任一内容的句子，系统 SHALL 整句跳过，SHALL NOT 从中抽取任何字段，也 SHALL NOT 因此起卡：
- 币种符号或代码，包括紧贴数字的写法（如 `USD4.80`、`RMB25/pc`）；
- 金额单位（元、美元、人民币、dollars 等）；
- 价格、报价、单价、费用（含样品费、运费）、免费样品；
- 折扣、返点、佣金；
- 付款条款、账期（如 `60 days credit`、`net 30`）；
- 百分比。

#### Scenario: 含价格的句子
- **WHEN** 新增行为 "MOQ 500 pcs, unit price USD 4.80 FOB Ningbo."
- **THEN** 不抽取任何字段，不起卡

#### Scenario: 币种紧贴数字
- **WHEN** 新增行为 "MOQ 500 pcs at USD4.80 FOB Ningbo." 或 "起订量500件，25元/件。"
- **THEN** 不抽取任何字段，不起卡

#### Scenario: 付款条款
- **WHEN** 新增行为 "30% deposit, balance before shipment, production 30 days."
- **THEN** 不抽取任何字段

### Requirement: 起卡规则与限流
对每个抽到的字段，系统 SHALL 先把回复里没写的部分用企业当前值补齐，得到提议值：
- 起订量没写按什么计、大货没写起算点：沿用当前值；
- 样品时效：现货样与定制样各自合并；
- 落款：只补当前为空的子字段；
- 装运港：现有 ∪ 新增。

只在以下情况起一张审批卡：
- 企业当前值为空；或
- 当前值与提议值不同（装运港只在有新港口时起卡）。

以下情况 SHALL NOT 起卡：
- 抽取值与当前值相同；
- 同一字段已有待审批卡；
- 同一字段 24 小时内已起过卡；
- 同一（字段，提议值）曾被驳回；
- 提议值过不了商务事实合并规则（批准后才失败会把卡消耗成 failed）；
- 组织里没有能批准的人；
- 来源是入驻测试询盘。

一次只为每个字段起一张卡（同一封回复里有多个值时取第一个）。

#### Scenario: 当前为空
- **WHEN** 企业未配置 MOQ，人工回复写了 "MOQ 500 pcs per color"
- **THEN** 起一张 `moq` 卡，提议值 500 pcs / color，当前值为空

#### Scenario: 与当前相同
- **WHEN** 企业已配置 MOQ 500 pcs / color，人工回复写了同样的值
- **THEN** 不起卡

#### Scenario: 只写了部分子字段
- **WHEN** 企业已配置现货样 3 天、定制样 7–10 天，人工回复只写了 "Stock samples ship within 3 days."
- **THEN** 提议值等于当前值，不起卡；定制样区间不会被清空

#### Scenario: 被驳回过
- **WHEN** 同一字段同一提议值的卡曾被驳回
- **THEN** 不再起卡

#### Scenario: 限流
- **WHEN** 同一字段已有待审批卡，或 24 小时内已起过卡
- **THEN** 不起新卡

#### Scenario: 起卡测试
- **WHEN** 运行 `npx tsx src/lib/revenue-spine/__tests__/fact-proposals.test.ts`
- **THEN** 起卡规则、限流、审批类型与角色门、批准写入、草稿引用的断言全部通过，退出码 0

### Requirement: 审批卡内容
审批卡 SHALL 为 `revenue_spine.propose_commercial_fact` 类型，有效期 7 天。审批人 SHALL 是能批准的人：组织所有者（平台角色为 admin / boss 时），否则在职的 boss，再否则在职的 admin。载荷 SHALL 包含：
- 字段、抽取原值、提议值、当前值、提议值的规范键；
- 证据句：触发该字段的那一句，已替换买家信息；
- 商机 id、来源草稿 id。

卡片标题与预览 SHALL 用中文写明字段、当前值与提议值。载荷与预览 SHALL NOT 包含整封回复、买家邮箱、电话或任何金额。

#### Scenario: 所有者不能批
- **WHEN** 组织所有者的平台角色是 sales，组织里有一位在职 boss
- **THEN** 卡片的审批人是这位 boss；组织里没有 boss 或 admin 时不起卡

#### Scenario: 卡片内容
- **WHEN** 为 `moq` 起卡，证据句里有买家联系人名
- **THEN** 预览写明"起订量：当前 未配置 → 提议 500 pcs / color"，证据句里联系人名被占位符替换

### Requirement: 只有企业负责人或管理员能批准
批准 `revenue_spine.propose_commercial_fact` SHALL 只允许平台角色为 admin、super_admin 或 boss 的人，规则与 `PUT /api/revenue/policy` 相同。平台角色 SHALL 按批准人的用户记录读取，不取调用方传入的角色：审批中心传入的是组织成员角色。其它角色批准时 SHALL 返回无权错误，审批 SHALL 保持待审批，不被消耗。驳回沿用既有审批权限。微信"回数字确认" SHALL NOT 处理该类型。

#### Scenario: 销售角色批准
- **WHEN** 角色为 sales 的组织成员批准该卡
- **THEN** 返回"仅企业负责人或管理员可批准商务事实提案"，审批仍为待审批

#### Scenario: 在审批中心批准
- **WHEN** 平台角色为 boss、组织角色为 org_owner 的人在审批中心批准该卡
- **THEN** 批准成功并写入商务事实

#### Scenario: 微信确认
- **WHEN** 微信批量确认筛选可确认的动作类型
- **THEN** 不包含该类型

### Requirement: 批准后写入并被草稿引用
批准后，执行器 SHALL 在批准时的最新商务事实上重新合并抽取原值（与起卡时同一补齐规则），写进该组织 `revenue_spine.business_profile` 的商务事实对应字段，其余字段保持原值，并发布新版本（旧版本保留可回滚）。合并结果已等于当前值时 SHALL 返回成功、不发布新版本。执行器 SHALL 写一条审计，包含字段、前后值、新版本号与来源草稿 id。

合并后提议值不合法（被商务事实合并规则丢弃）时 SHALL 执行失败，不写入。此后生成的草稿 SHALL 按既有读取口径引用该事实。

驳回 SHALL 只记录驳回，不写商务事实。

#### Scenario: 从未配置到可用
- **WHEN** 企业未配置 MOQ，批准提议值 500 pcs / color 的卡
- **THEN** 起订量查询从"未配置"变为可用，值为 500 pcs / color；其余商务事实不变

#### Scenario: 起卡后配置被改过
- **WHEN** 起卡时装运港为空、提议 Ningbo 与 Shanghai，批准前老板把装运港改成了 Qingdao
- **THEN** 批准后装运港为 Qingdao、Ningbo、Shanghai，青岛不丢

#### Scenario: 非法提议值
- **WHEN** 批准的卡提议值为数量 0
- **THEN** 执行失败，不发布新版本
