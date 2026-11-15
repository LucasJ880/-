## Purpose
规定跨项目的询价追踪：看到哪些项目、每家供应商一行写什么、系统下一步的日期从哪来、价格从哪来、在页面上能做什么、首页建议与旧接口怎么改。

## ADDED Requirements

### Requirement: 看得到哪些
追踪接口 SHALL 只返回当前组织里、当前登录者对其有项目读权限（与项目询价明细相同：平台超管、负责人、组织管理员、项目成员）的招投标项目的在途询价（与催单扫描同一口径：近 90 天发出、状态为已发出 / 已回信 / 已报价，加上近 14 天标为未响应的），轮次已取消或已完成的 SHALL NOT 出现。组织 SHALL 由服务端按登录者解析，SHALL NOT 取请求里的值。项目上限 200、行上限 1000，超出 SHALL 标明截断。

#### Scenario: 只能看一个项目的人
- **WHEN** 一个只是其中一个项目成员的普通组织成员打开追踪页；另一个不是任何项目成员的普通组织成员也打开
- **THEN** 前者只看到那个项目；后者什么都看不到（没有价格）；别的组织的项目从不出现（`npx tsx src/lib/tender-rfq/__tests__/tracker-db.isolated.test.ts`）

### Requirement: 系统下一步与判定一致
每一行的「下一步」SHALL 与催单扫描的判定一致：写「下次自动催 X」时，在 X 时刻扫描 SHALL 起草催单、在 X 之前 1 毫秒 SHALL 不起草；写「将于 X 标未响应」时同理；有待批催单卡写「催单卡待批」，扫描仍会在某天标未响应时写出那一天；没有邮件线程写「手工联系，系统不会自动催」。催单间隔 SHALL 与扫描用同一来源（轮次跟进授权里定格的天数，否则负责人偏好与组织设置）。日期 SHALL 按组织时区，回复截止按日期字面。

#### Scenario: 一致性表
- **WHEN** 未催、催过一次、催满两次、截止已过、有待批卡、被驳回过、手工联系、已报价缺字段各一例
- **THEN** 页面写的日期正是扫描起草或标未响应的时刻（`npx tsx src/lib/tender-rfq/__tests__/tracker-pure.test.tsx`）

### Requirement: 需要我处理与计数
「需要我处理」SHALL 只含：催单卡待批、回信没报价、报价缺字段、过了回复截止还没回。顶部计数与 `/bids` 汇总卡 SHALL 是同一组数；汇总卡与任何通知 SHALL NOT 出现金额。

#### Scenario: 分类与计数
- **WHEN** 一页里四类各有一家，另有等回复、已报价、未响应的
- **THEN** 每类分对；汇总卡数字与页面顶部相同，且不含金额（`tracker-pure.test.tsx`；`tracker-db.isolated.test.ts`）

### Requirement: 价格只有一个出处
已报价的行 SHALL 显示原币种单价 / 总价、交期、有效期，以及比价矩阵给出的落地价（CAD）与「最便宜」标记；矩阵换算不出时 SHALL 写原因。追踪 SHALL NOT 自己换汇或算落地价。一次最多为 50 轮取比价矩阵，其余写明请到比价面板查看。返回 SHALL NOT 含项目估值、我方报价、中标价、毛利、价格情景。

#### Scenario: 与比价面板一致
- **WHEN** 同一轮两家报价进表，一家缺运费参数
- **THEN** 追踪页的落地价与「最便宜」与该轮比价矩阵逐家相同；缺参数的那家写「落地价未换算（…）」（`tracker-pure.test.tsx`；`tracker-db.isolated.test.ts`）

#### Scenario: 白名单
- **WHEN** 读取追踪接口
- **THEN** 返回里没有估值、我方报价、中标价、毛利（`tracker-db.isolated.test.ts`）

### Requirement: 现在就催
`POST /api/projects/[id]/tender-rfq/chase` SHALL 要项目写权限，SHALL 只为该项目该轮里指定的 1–8 家起草催单卡（与 Muse `chase` 同一规则，不看天数），返回新卡（附审批信息与正文）与跳过的人话原因。SHALL NOT 直接发信。

#### Scenario: 起草与跳过
- **WHEN** 一家在等回复、一家已有待批卡、一家是手工联系的
- **THEN** 第一家起草一张待批卡；另两家分别说明「已有一张待批的催单卡」「这家是手工联系的，没有邮件线程可回复」；没有任何邮件发出（`tracker-db.isolated.test.ts`）

### Requirement: 首页建议与旧接口
首页「供应商未回复」SHALL 只算状态为已发出、发出时间早于负责人催单天数的；按钮 SHALL 去询价追踪。`POST /api/projects/[id]/inquiries/batch-followup` SHALL 返回 410，SHALL NOT 调模型或写库。

#### Scenario: 首页建议
- **WHEN** 一家已发出 5 天没回、一家还是 pending
- **THEN** 只提醒前者，按钮去追踪页（`tracker-db.isolated.test.ts`）

#### Scenario: 旧接口
- **WHEN** 调 batch-followup
- **THEN** 410（`tracker-db.isolated.test.ts`）
