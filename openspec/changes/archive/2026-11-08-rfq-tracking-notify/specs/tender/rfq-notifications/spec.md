# Spec Delta

## Purpose
询价进展的站内通知：供应商报价或回信自动入表、定时检查起草了催单 / 追问、供应商被标为未响应时，告诉项目负责人与本轮发起人，并让入站提醒跳到对应的询价轮次。只覆盖系统自动发生的事件，人在页面上自己做的动作不发通知。

## ADDED Requirements

### Requirement: 四个询价通知类型
系统 SHALL 把以下四个通知类型登记进通知类型注册表，并在通知设置页与邮件里统一使用这些名称：

| 类型 | 名称 |
|---|---|
| `rfq_quote_received` | 供应商报价了 |
| `rfq_reply_received` | 供应商回信（无报价） |
| `rfq_chase_ready` | 催单待批 |
| `rfq_no_response` | 供应商未响应 |

这四个类型 SHALL 按 `notifications/preferences`「新增类型对老用户默认开启」判定开关：本次上线前保存过类型清单的用户一律视为开启；上线后在设置页关掉并保存的，视为关闭。

#### Scenario: 设置页列出新类型
- **WHEN** 打开通知设置页的类型开关列表
- **THEN** 列表中出现"供应商报价了""供应商回信（无报价）""催单待批""供应商未响应"四项

#### Scenario: 十月保存过清单的老用户
- **WHEN** 用户 2026-10 保存过类型清单，清单里没有 `rfq_chase_ready`，定时检查为他负责的项目起草了催单
- **THEN** 他收到 `rfq_chase_ready` 通知

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/notifications/__tests__/collab-preferences.test.ts`
- **THEN** 四个类型已登记、名称正确、对上线前保存的清单视为开启的断言全部通过，退出码 0

### Requirement: 报价通知
供应商回信被自动识别为报价并写入询价明细（该家从「已发出」或「已回复」变为「已报价」）后，系统 SHALL 在同一次入站检查内给收件人各发一条 `rfq_quote_received` 通知。人工在询价明细里录入报价 SHALL NOT 发这条通知。

#### Scenario: 带价回信
- **WHEN** 甲厂回信含单价与交期，入站检查把它写入第 2 轮的询价明细
- **THEN** 项目负责人与第 2 轮发起人各收到一条"甲厂报价了 · {项目}"

#### Scenario: 人工录报价
- **WHEN** 用户在询价明细里手工给乙厂录入报价
- **THEN** 不产生 `rfq_quote_received` 通知

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/tender-rfq/__tests__/inbound-apply.test.ts`
- **THEN** "报价入表调用一次询价通知、解析失败与自己发出的邮件不调用"的断言通过，退出码 0

### Requirement: 回信通知
供应商回信写入询价明细但没有识别出报价（该家从「已发出」变为「已回复」）后，系统 SHALL 在同一次入站检查内给收件人各发一条 `rfq_reply_received` 通知。这条通知 SHALL NOT 声称已起草追问。

解析失败、线程里我们自己发出的邮件、不属于任何询价线程的邮件、处理后状态不变的回信，SHALL NOT 发 `rfq_quote_received` 或 `rfq_reply_received`。

#### Scenario: 回信没写价
- **WHEN** 乙厂回信只问了交货地址，入站检查把它记为已回复
- **THEN** 收件人各收到一条"乙厂回信了，没有报价 · {项目}"，摘要为"第 2 轮询价：需要你看一眼原文。"

#### Scenario: 解析失败
- **WHEN** 一封回信解析出错
- **THEN** 只发既有的"回信解析失败，请手工录入"提醒，不发报价或回信通知

### Requirement: 催单待批通知
定时检查（每次入站检查末尾的催单扫描）为某一轮新起草了催单或缺字段追问审批卡时，系统 SHALL 把这一轮本次新起草的全部卡合成一条 `rfq_chase_ready` 通知发给项目负责人。同一次检查里同一轮 SHALL NOT 产生第二条。本次没有新起草卡的轮次不发。

优先级：含催单（供应商没回）时 SHALL 为 high；只有追问时 SHALL 为 medium。

用户手动发起的「现在就催」（含 Muse `chase` 意图）SHALL NOT 发这条通知。

#### Scenario: 一轮两封催单一封追问
- **WHEN** 一次定时检查在第 2 轮为丙厂、丁厂起草了催单，为甲厂起草了追问
- **THEN** 项目负责人只收到一条"3 封催单 / 追问已起草，等你批准 · {项目}"，优先级 high

#### Scenario: 手动催单
- **WHEN** 用户在项目里手动为丙厂起草催单
- **THEN** 不产生 `rfq_chase_ready` 通知

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/tender-rfq/__tests__/tracking-notify-pure.test.ts` 与 `npx tsx src/lib/tender-rfq/__tests__/tracking-notify-wiring.test.ts`
- **THEN** "一轮多张卡合成一条""只有定时检查发、手动起草不发"的断言全部通过，退出码 0

### Requirement: 未响应通知
定时检查把某家供应商标为未响应（催满两次仍未回，或回复截止已过仍未回）时，系统 SHALL 给收件人发一条 `rfq_no_response` 通知；每家每一次标记一条。

#### Scenario: 催满两次
- **WHEN** 戊厂被催了两次仍未回复，定时检查把它标为未响应
- **THEN** 收件人各收到一条"戊厂没有回复，已标未响应 · {项目}"，摘要为"第 2 轮：催了两次仍未回复。可以换一家供应商再问。"

### Requirement: 询价通知的收件人
- `rfq_quote_received`、`rfq_reply_received`、`rfq_no_response` 的收件人 SHALL 为项目负责人与本轮发起人；两者是同一人时只发一条。
- `rfq_chase_ready` 的收件人 SHALL 为项目负责人（定时检查起草的卡以他为发起人）。

这些通知没有操作人。收件人 SHALL 按 `notifications/activity-events`「协作通知的收件人范围」过滤（账号在职、是项目所属组织的 active 成员），并按「协作通知经过投递门禁」判定（站内总开关、类型开关、只看高优先级、免打扰）。

#### Scenario: 负责人就是发起人
- **WHEN** 第 2 轮由项目负责人 A 发起，甲厂报价入表
- **THEN** A 只收到一条 `rfq_quote_received`

#### Scenario: 发起人已离开组织
- **WHEN** 第 2 轮发起人 B 已不是组织的 active 成员，甲厂报价入表
- **THEN** 只有项目负责人收到通知

### Requirement: 询价通知的文字规则
询价通知标题与摘要里的占位 SHALL 按以下规则填写：
- `{项目}` 为项目名，超过 24 个字截断并加「…」；
- `{n}` 为轮次序号，`{d}` 为该轮使用的催单天数，`{k}` 为张数或家数；
- 多家名单用「、」连接，超过 3 家写「甲厂、乙厂、丙厂等 {k} 家」；
- 缺的字段按 价格、币种、交期、有效期、起订量、贸易条款 的顺序用「、」连接。

#### Scenario: 项目名过长
- **WHEN** 项目名为 30 个字
- **THEN** 标题里的项目名为前 24 个字加"…"

#### Scenario: 名单超过 3 家
- **WHEN** 同一轮 5 家供应商超过 3 天没回，定时检查起草了 5 封催单
- **THEN** 摘要为"第 2 轮：甲厂、乙厂、丙厂等 5 家超过 3 天没回。48 小时内不批会过期。"

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/tender-rfq/__tests__/tracking-notify-pure.test.ts`
- **THEN** 截断、名单与字段顺序的断言全部通过，退出码 0

### Requirement: 报价与回信通知的文案
报价与回信通知 SHALL 按下表生成，优先级均为 medium：

| 事件 | 标题 | 摘要 |
|---|---|---|
| 报价，字段齐 | `{供应商}报价了 · {项目}` | `第 {n} 轮询价：报价已自动进表，可以去比价了。` |
| 报价，缺字段 | `{供应商}报价了 · {项目}` | `第 {n} 轮询价：报价已自动进表；还缺：{字段}。` |
| 回信无报价 | `{供应商}回信了，没有报价 · {项目}` | `第 {n} 轮询价：需要你看一眼原文。` |

#### Scenario: 报价缺字段
- **WHEN** 甲厂报价入表，缺有效期与币种，项目为「Alberta 露营装备」第 2 轮
- **THEN** 标题为"甲厂报价了 · Alberta 露营装备"，摘要为"第 2 轮询价：报价已自动进表；还缺：币种、有效期。"

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/tender-rfq/__tests__/tracking-notify-pure.test.ts`
- **THEN** 表中三行各一个用例通过，退出码 0

### Requirement: 催单待批通知的文案（只有催单）
本轮新起草的全是催单（供应商没回）时，催单待批通知 SHALL 按下表生成，优先级为 high：

| 张数 | 标题 | 摘要 |
|---|---|---|
| 1 封 | `{供应商}该催了，催单已起草，等你批准 · {项目}` | `第 {n} 轮：超过 {d} 天没回。48 小时内不批会过期。` |
| 多封 | `{k} 家供应商该催了，催单已起草，等你批准 · {项目}` | `第 {n} 轮：{名单}超过 {d} 天没回。48 小时内不批会过期。` |

#### Scenario: 一封催单
- **WHEN** 第 2 轮只有丙厂超过 3 天没回，定时检查起草了一封催单
- **THEN** 标题为"丙厂该催了，催单已起草，等你批准 · {项目}"，摘要为"第 2 轮：超过 3 天没回。48 小时内不批会过期。"

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/tender-rfq/__tests__/tracking-notify-pure.test.ts`
- **THEN** 1 封与多封各一个用例通过，退出码 0

### Requirement: 催单待批通知的文案（只有追问）
本轮新起草的全是缺字段追问时，催单待批通知 SHALL 按下表生成，优先级为 medium：

| 张数 | 标题 | 摘要 |
|---|---|---|
| 1 封 | `{供应商}的报价缺{字段}，追问已起草 · {项目}` | `第 {n} 轮：批准后在原邮件线程里追问。48 小时内不批会过期。` |
| 多封 | `{k} 家报价缺信息，追问已起草 · {项目}` | `第 {n} 轮：批准后在原邮件线程里追问。48 小时内不批会过期。` |

#### Scenario: 一封追问
- **WHEN** 第 2 轮甲厂报价缺有效期，定时检查起草了一封追问
- **THEN** 标题为"甲厂的报价缺有效期，追问已起草 · {项目}"，优先级 medium

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/tender-rfq/__tests__/tracking-notify-pure.test.ts`
- **THEN** 1 封与多封各一个用例通过，退出码 0

### Requirement: 催单待批通知的文案（催单与追问）
本轮新起草的既有催单又有追问时，催单待批通知 SHALL 为：
- 标题：`{k} 封催单 / 追问已起草，等你批准 · {项目}`，`{k}` 为卡的总张数；
- 摘要：`第 {n} 轮：{催单名单}超过 {d} 天没回；{追问部分}。48 小时内不批会过期。`；只有一家追问时 `{追问部分}` 为 `{供应商}报价缺{字段}`，多家时为 `{名单}报价缺信息`；
- 优先级：high。

#### Scenario: 两封催单一封追问
- **WHEN** 第 2 轮丙厂、丁厂超过 3 天没回，甲厂报价缺有效期，定时检查起草了 3 张卡
- **THEN** 标题为"3 封催单 / 追问已起草，等你批准 · {项目}"，摘要为"第 2 轮：丙厂、丁厂超过 3 天没回；甲厂报价缺有效期。48 小时内不批会过期。"

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/tender-rfq/__tests__/tracking-notify-pure.test.ts`
- **THEN** 一家追问与多家追问各一个用例通过，退出码 0

### Requirement: 未响应通知的文案
未响应通知 SHALL 按下表生成，优先级为 medium：

| 原因 | 标题 | 摘要 |
|---|---|---|
| 催满两次 | `{供应商}没有回复，已标未响应 · {项目}` | `第 {n} 轮：催了两次仍未回复。可以换一家供应商再问。` |
| 截止已过 | `{供应商}没有回复，已标未响应 · {项目}` | `第 {n} 轮：回复截止已过仍未回复。可以换一家供应商再问。` |

#### Scenario: 截止已过
- **WHEN** 第 2 轮回复截止已过，己厂仍未回，定时检查把它标为未响应
- **THEN** 摘要为"第 2 轮：回复截止已过仍未回复。可以换一家供应商再问。"

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/tender-rfq/__tests__/tracking-notify-pure.test.ts`
- **THEN** 两种原因各一个用例通过，退出码 0

### Requirement: 询价通知的去重
同一收件人 SHALL 最多收到一条：
- 同一家、同一封回信的报价或回信通知；
- 同一轮、同一批新起草的审批卡的催单待批通知；
- 同一家的未响应通知。

重复触发（同一封回信被重新处理、同一次检查重跑）SHALL NOT 产生第二条。

#### Scenario: 重跑
- **WHEN** 同一封带价回信因重试被再处理一次
- **THEN** 收件人仍只有一条该回信的 `rfq_quote_received`

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/tender-rfq/__tests__/tracking-notify-pure.test.ts`
- **THEN** 四类去重键的格式与"同一批卡顺序不同去重键相同"的断言通过，退出码 0

### Requirement: 询价通知不输出敏感内容
询价通知的标题、摘要与 metadata SHALL NOT 包含：
- 金额、单价、总价，以及任何带币种的数值；
- 毛利率、项目估值、我方最终报价。

供应商名与项目名按 `notifications/activity-events`「敏感内容的判定」逐段判定，命中的那一段 SHALL 换成 `（含敏感信息，请在青砚查看）`，标题其余部分照常输出。

#### Scenario: 报价通知不带价
- **WHEN** 甲厂报价单价 USD 89.50 入表
- **THEN** 通知标题与摘要都不出现"89.50"或"USD"

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/tender-rfq/__tests__/tracking-notify-pure.test.ts`
- **THEN** "标题摘要不命中敏感判定""含金额的项目名整段替换"的断言通过，退出码 0

### Requirement: 询价通知的跳转与对象
四类询价通知 SHALL 以询价轮次为对象：`entityType` 为 `tender_rfq_round`，`entityId` 为轮次 id，并带项目 id；点开跳到该项目「标书与报价」并展开这一轮（地址见 `notifications/click-targets`「询价轮次的跳转地址」）。邮件里的对象名 SHALL 为 `项目「{项目}」第 {n} 轮询价`。

#### Scenario: 点开催单待批
- **WHEN** 项目负责人点开项目 P 第 2 轮（id R）的"催单待批"通知
- **THEN** 跳到 `/projects/P?tab=bid#rfq-round-R`，第 2 轮展开，审批面板可见

### Requirement: 入站提醒的归类与跳转
既有两条入站提醒 SHALL 归入询价类别（`category = tender_rfq`），不再归入 Muse 类别：
- 「有一封供应商回信解析失败，请手工录入」：对象改为该回信所属的询价轮次（`tender_rfq_round`），点开跳到该轮；
- 「询价回信无法自动入表：请重新授权 Gmail 读取权限」：对象不变。

两条提醒的标题、摘要、优先级与去重键 SHALL 不变，已写入过提醒的回信 SHALL NOT 再提醒一次。

#### Scenario: 解析失败提醒跳到该轮
- **WHEN** 第 2 轮（id R）某家的回信解析失败
- **THEN** 项目负责人收到"有一封供应商回信解析失败，请手工录入"，`category` 为 `tender_rfq`，点开跳到 `/projects/{项目}?tab=bid#rfq-round-R`

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/tender-rfq/__tests__/tracking-notify-wiring.test.ts`
- **THEN** 两条提醒的类别、解析失败提醒的对象与去重键不变的断言通过，退出码 0

### Requirement: 询价通知失败不影响收信与催单
写询价通知出错时，系统 SHALL 只记录错误：回信照常入表、审计照常写、入站游标照常推进、催单卡照常起草、未响应照常标记，本次检查的结果计数不变。

#### Scenario: 通知写入失败
- **WHEN** 甲厂报价入表后，写通知时数据库报错
- **THEN** 甲厂仍为已报价、这封回信的审计已写，下一次检查不再处理这封回信

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/tender-rfq/__tests__/inbound-apply.test.ts`
- **THEN** "询价通知抛错时入表结果与审计不受影响"的断言通过，退出码 0
