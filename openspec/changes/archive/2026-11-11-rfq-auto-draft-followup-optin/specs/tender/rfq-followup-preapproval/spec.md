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
系统 SHALL 为每个用户在每个组织里提供一个开关「自动起草的轮次带跟进授权」，默认关闭。开关 SHALL 只能由本人在网页上开启或关闭，SHALL NOT 能在 Muse 里设置，SHALL NOT 能由别人代为开启。开启处 SHALL 展示授权范围与催单一、催单二、追问三段模板的预览，并在二次确认期间保持展开。开启或关闭 SHALL 要求操作者对所在项目有写权限，并 SHALL 留下一条记录（谁、何时、开或关）；状态没有变化时 SHALL NOT 重复记录。系统自动起草时 SHALL 只看触发起草的操作者本人的开关。关闭 SHALL 只影响之后起草的轮次；已经批准并带授权的轮次不受影响。

#### Scenario: 默认关闭
- **WHEN** 一个从未设置过的用户触发自动起草
- **THEN** 起草的卡不带跟进授权（`npx tsx src/lib/tender-rfq/__tests__/auto-followup-optin.test.ts`；`auto-draft-db.isolated.test.ts`）

#### Scenario: 只用本人的开关
- **WHEN** 同组织的甲开启了开关、乙没有，乙触发自动起草
- **THEN** 起草的卡不带跟进授权（`auto-draft-db.isolated.test.ts`）

#### Scenario: 开启与关闭留记录
- **WHEN** 用户在网页上开启开关，之后又关闭
- **THEN** 各有一条记录，记下操作者与开或关；关闭之后触发的自动起草不带授权，关闭之前已批准的轮次仍按授权自动跟进（`auto-draft-db.isolated.test.ts`）

#### Scenario: 没有写权限不能设置
- **WHEN** 对项目没有写权限的人调用设置接口，或请求体里夹带了别人的用户号
- **THEN** 请求被拒，什么都没有写（`auto-draft-db.isolated.test.ts`）

### Requirement: 个人开关随功能开关的可用性
开启个人开关 SHALL 要求跟进授权与自动起草两个功能开关对该组织都打开；任一关闭时开启 SHALL 被拒绝，开着的个人开关 SHALL NOT 产生任何效果。关闭 SHALL 在任何时候都可以，包括功能开关关闭期间。功能开关关闭期间，界面 SHALL 只对开关不是「关」的用户显示它并注明现在不生效；两个功能开关都关闭时 SHALL NOT 显示。

#### Scenario: 功能开关关闭期间
- **WHEN** 个人开关为开，跟进授权的功能开关对该组织关闭
- **THEN** 自动起草的卡不带授权；入口里他的开关仍然出现并标明现在不生效；这时开启请求返回未找到、关闭请求成功；功能重新打开后，已经关掉的开关不会自己恢复（`auto-draft-db.isolated.test.ts`）

#### Scenario: 两个功能开关都关闭
- **WHEN** 两个功能开关都对该组织关闭
- **THEN** 询价入口的响应里没有个人开关的字段（`auto-draft-db.isolated.test.ts`）

### Requirement: 个人开关的状态不被别处改动，并绑定开启时的模板
个人开关的状态 SHALL NOT 因组织设置的任何其它写入（管理员改设置、定时任务、Muse 的偏好与绑定）而改变。开启时系统 SHALL 记下当时的邮件模板指纹；之后模板发生变化时，这个开关 SHALL 失效：自动起草的卡不带授权，界面显示「已失效」，本人看过新模板后可以重新开启。

#### Scenario: 别处回写旧设置不会恢复开关
- **WHEN** 用户关闭了开关，随后另一处写入把它先前读到的整块组织设置写回
- **THEN** 开关仍是关（`auto-draft-db.isolated.test.ts`）

#### Scenario: 模板改过之后失效
- **WHEN** 用户在旧模板下开启过开关，之后模板变了，他触发自动起草
- **THEN** 起草的卡不带授权，入口里他的开关状态为「已失效」；他重新开启后恢复生效，记录里是新的模板指纹（`auto-followup-optin.test.ts`；`auto-draft-db.isolated.test.ts`）

### Requirement: 带授权的待批卡始终显示授权
一张待批的发询价卡的载荷里带有跟进授权时，网页上的原地审批处 SHALL 显示授权范围与三段模板预览，不论跟进授权的功能开关此刻是否打开。功能开关关闭时 SHALL 另外注明：关闭期间这些邮件仍逐封待批，功能重新打开后这份授权恢复生效。

#### Scenario: 卡起草之后功能开关被关掉
- **WHEN** 一张带授权的发询价卡还在待批，跟进授权的功能开关被关闭，有人打开项目页准备批准
- **THEN** 审批处仍显示授权范围与三段模板，并注明现在是关闭状态；同一时刻没有带授权待批卡的项目，入口里没有任何跟进的内容（`auto-draft-db.isolated.test.ts`；`npx tsx src/lib/tender-rfq/__tests__/web-entry-pure.test.ts`）

### Requirement: 自动起草带授权的卡在人批准之后才生效
自动起草的卡带跟进授权时，授权 SHALL 与卡上的其它内容一样只在人批准这张卡之后生效；批准之前 SHALL NOT 有任何邮件发出。批准之后，哪些邮件算在授权之内、如何执行、如何停止、留下什么审计 SHALL 与网页勾选的轮次完全相同。

#### Scenario: 批准之后自动催单
- **WHEN** 一张自动起草且带授权的卡被人批准并发出，某家供应商超过间隔天数未回复
- **THEN** 扫描判定为覆盖，催单以批准这张卡的人的身份发出，并留下自动发送的审计（`auto-draft-db.isolated.test.ts`，本地隔离库 + 假邮件）

#### Scenario: 批准之前零出站
- **WHEN** 自动起草了一张带授权的卡，还没有人批准
- **THEN** 没有任何邮件发出，扫描不为这一轮起草催单（`auto-draft-db.isolated.test.ts`）
