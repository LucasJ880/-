# Spec Delta

## MODIFIED Requirements

### Requirement: 只有网页发起且明确勾选的轮次带授权
跟进授权 SHALL 只在以下两种情形之一写入：（一）轮次由网页入口发起，且发起人明确勾选了自动跟进；（二）轮次由系统自动起草，且触发起草的操作者本人事先在网页上开启了「自动起草的轮次带跟进授权」的个人开关。两种情形都要求跟进授权的功能开关对该组织打开。经 Muse 发起的轮次 SHALL NOT 带授权。审批卡在所有展示它的界面上 SHALL 用一行文字写明授权范围（催单最多几次、是否追问）；网页上的原地审批 SHALL 另外展示催单一、催单二、追问三段模板的预览，以及「批准这张卡即一并批准这些后续邮件」「可随时停止」的说明。带授权的审批卡的标题 SHALL 标明「含自动跟进授权」。带授权的审批卡 SHALL NOT 能在 Muse 里批准（Muse 里只显示标题，看不到授权范围与模板）：Muse 收到对这类卡的批准时 SHALL 拒绝并说明要去网页批；驳回不受影响。

#### Scenario: Muse 发起的轮次
- **WHEN** 经 Muse `rfq` 意图发起一轮询价并批准
- **THEN** 载荷不含跟进授权，之后的催单逐张待批，Muse 的响应结构不变

#### Scenario: 卡上写明授权范围
- **WHEN** 打开一张带授权的待批卡
- **THEN** 摘要里有「含自动跟进：催单最多 2 次、缺字段追问 1 次」，网页上能看到三段模板预览（截图 `docs/acceptance/rfq-auto-1/approval-card.png`）

#### Scenario: 在 Muse 里批准带授权的卡
- **WHEN** 一轮在网页上勾选自动跟进后送审，有人在 Muse 里对这张卡回复「批准」
- **THEN** 不批准、不发信，回复说明这一轮带自动跟进授权、需在青砚项目页看完授权范围和邮件模板后批准（`npx tsx src/lib/muse-bridge/__tests__/muse-bridge-pure.test.ts`）

#### Scenario: 自动起草的轮次按本人的开关带授权
- **WHEN** 操作者开启了个人开关，随后他批准招标分析触发自动起草
- **THEN** 起草的发询价卡带跟进授权，内容与网页勾选时相同；标题同时标明「自动起草」与「含自动跟进授权」（`npx tsx src/lib/tender-rfq/__tests__/auto-draft-db.isolated.test.ts`）

#### Scenario: 没开启个人开关
- **WHEN** 操作者没有开启个人开关，他批准招标分析触发自动起草
- **THEN** 起草的卡不带跟进授权，催单与追问逐张待批（`auto-draft-db.isolated.test.ts`）

## ADDED Requirements

### Requirement: 自动起草带授权的个人开关
系统 SHALL 为每个用户在每个组织里提供一个开关「自动起草的轮次带跟进授权」，默认关闭。开关 SHALL 只能由本人在网页上开启或关闭，开启处 SHALL 展示授权范围与催单一、催单二、追问三段模板的预览。开关 SHALL NOT 能在 Muse 里设置，SHALL NOT 能由别人代为开启。开启或关闭 SHALL 要求操作者对所在项目有写权限，并 SHALL 写一条审计（谁、何时、开或关）。系统自动起草时 SHALL 只看触发起草的操作者本人的开关，SHALL NOT 使用同组织其他成员的开关。关闭开关 SHALL 只影响之后起草的轮次；已经批准并带授权的轮次不受影响（要停用需在该轮次上停止自动跟进）。跟进授权的功能开关对该组织关闭时，个人开关 SHALL NOT 产生任何效果，界面 SHALL NOT 显示它。

#### Scenario: 默认关闭
- **WHEN** 一个从未设置过的用户触发自动起草
- **THEN** 起草的卡不带跟进授权（`npx tsx src/lib/tender-rfq/__tests__/auto-followup-optin.test.ts`；`auto-draft-db.isolated.test.ts`）

#### Scenario: 只用本人的开关
- **WHEN** 同组织的甲开启了开关、乙没有，乙触发自动起草
- **THEN** 起草的卡不带跟进授权（`auto-draft-db.isolated.test.ts`）

#### Scenario: 开启与关闭留审计
- **WHEN** 用户在网页上开启开关，之后又关闭
- **THEN** 各有一条审计，记下操作者与开或关；关闭之后触发的自动起草不带授权，关闭之前已批准的轮次仍按授权自动跟进（`auto-draft-db.isolated.test.ts`）

#### Scenario: 没有写权限不能设置
- **WHEN** 对项目没有写权限的人调用设置接口
- **THEN** 请求被拒，开关不变（`auto-draft-db.isolated.test.ts`）

#### Scenario: 跟进授权的功能开关关闭
- **WHEN** 个人开关为开，但跟进授权的功能开关对该组织关闭
- **THEN** 自动起草的卡不带授权；询价入口的响应里没有 `autoDraftFollowUp`；设置接口返回未找到（`auto-draft-db.isolated.test.ts`）

### Requirement: 自动起草带授权的卡在人批准之后才生效
自动起草的卡带跟进授权时，授权 SHALL 与卡上的其它内容一样只在人批准这张卡之后生效；批准之前 SHALL NOT 有任何邮件发出。批准之后，哪些邮件算在授权之内、如何执行、如何停止、留下什么审计 SHALL 与网页勾选的轮次完全相同。

#### Scenario: 批准之后自动催单
- **WHEN** 一张自动起草且带授权的卡被人批准并发出，某家供应商超过间隔天数未回复
- **THEN** 扫描判定为覆盖，催单以批准这张卡的人的身份发出，并留下自动发送的审计（`auto-draft-db.isolated.test.ts`，本地隔离库 + 假邮件）

#### Scenario: 批准之前零出站
- **WHEN** 自动起草了一张带授权的卡，还没有人批准
- **THEN** 没有任何邮件发出，扫描不为这一轮起草催单（`auto-draft-db.isolated.test.ts`）
