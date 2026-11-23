# Spec Delta

## MODIFIED Requirements

### Requirement: 询价邮件用中性询价编号
发给供应商的询价邮件 SHALL 用询价编号称呼项目，编号为 `RFQ-{组织代码}-{年份}-{5 位码}`：组织代码取本组织代码的第一段字母数字、转大写、最多 8 个字符，组织代码为空时为 `QY`；年份为项目创建时间在组织时区的年份；5 位码由项目标识确定，只用数字与不含 I、L、O、U 的大写字母。同一项目的各轮询价、询价入口与供应商侧生成文件 SHALL 用同一个编号。邮件标题 SHALL 为 `询价 {编号}`，有轮次号时接 `（第 N 轮）`，有回复截止时接 ` — 请于 {回复截止} 前回复`；正文对项目的介绍 SHALL 为 `{我方抬头} 现就询价 {编号} 邀请贵司报价，请按以下清单逐项回复。`。正文里数量行 SHALL 以 `- 数量：` 开头；必须类要求 SHALL 写作 `{要求编号} 【必须】`（本次之前写作 `【强制】{要求编号}`，回信解析两种都认，见 `tender/rfq-supplier-attachment`「询价邮件正文的写法」）。邮件标题与正文 SHALL NOT 含项目名称、招标编号、采购方名称与截标日期。

#### Scenario: 联邦标的询价邮件
- **WHEN** 用「禁出清单的来源与类别」里的联邦标项目（组织代码 `sunny-home-deco`、项目创建于 2026 年）起草第 1 轮询价
- **THEN** 标题以 `询价 RFQ-SUNNY-2026-` 开头、接 5 位码与 `（第 1 轮）`；标题与正文都不含 `24062-27-057`、`Treasury Board`、`Sleeping Bags and Mats` 与 `2026-12-05`（`npx tsx src/lib/tender-rfq/__tests__/supplier-identity-guard-db.isolated.test.ts`）

#### Scenario: 同一项目编号不变
- **WHEN** 同一项目先后起草第 1 轮与第 2 轮询价，并生成供应商询价单
- **THEN** 两封邮件与询价单文件里的询价编号相同；另一个项目的编号不同（`npx tsx src/lib/bid-workflow/__tests__/project-identity-deny.test.ts`；`supplier-identity-guard-db.isolated.test.ts`；询价单文件与邮件同号见 `NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）

### Requirement: 供应商侧生成文件
「供应商询价单」（「一键生成文档」里的 `supplier_rfq`）是唯一的供应商侧生成文件，系统 SHALL 按以下规则生成：
- 抬头只有标题「询价单」、我方抬头、联系人、展示发件人邮箱、询价编号、起草日期与回复截止；SHALL NOT 印项目名称、项目编号、采购方与投标截止。起草日期不参与禁出清单比对。
- 内容只取自询价单本身（见 `tender/rfq-sheet-download`）；SHALL NOT 含项目 AI 上下文、项目描述与 AI 分析综合的文字，我方撰写的部分 SHALL NOT 含项目名称。
- 目的地只取分析地点里的「城市, 省」，取不出就不写。
- 生成之前，每一处供应商看得到的文字按询价邮件同样的口径过禁出清单与格式检查，模板固定文字另按我方撰写再查一遍，命中即不生成。

「供应商技术确认表」与「国内供应商简报（China Brief）」已停止生成，SHALL NOT 再产出发给供应商的文字。

#### Scenario: 符合性确认表的对外抬头
- **WHEN** 用招标编号 `24062-27-057`、采购方 `Treasury Board of Canada Secretariat`、项目名称 `Sleeping Bags and Mats`、截标 `2026-12-05`、地点事实 `Delivery to 2 Constellation Crescent, Ottawa, ON K1A 0K9` 的项目生成供应商询价单
- **THEN** 文件里有标题「询价单」与询价编号，没有 `24062-27-057`、`Treasury Board`、`Sleeping Bags and Mats`、`2026-12-05`、`Constellation` 与 `K1A`，目的地为 `Ottawa, ON`（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）

#### Scenario: 改前的抬头会被拦下
- **WHEN** 用 CHAIN-4b 之前生成的「供应商询价与符合性确认表」（项目名称 `测试项目`、项目编号 `COS-1`、采购方 `Buyer Agency`、截标 `2026-09-04`；抬头印着项目编号、采购方、投标截止的夹具）过这个项目的禁出清单
- **THEN** 命中招标编号、采购方名称与截标日期三类（`npx tsx src/lib/projects/generate/__tests__/tender-doc-html.test.ts`）

#### Scenario: 旧路径不再带项目上下文
- **WHEN** 读生成文件的源码
- **THEN** 两段旧的固定英文模板与分析综合版的供应商询价表都已移除；供应商询价单的生成路径不拼接项目 AI 上下文、项目名称与项目描述（`npx tsx src/lib/tender-rfq/__tests__/sheet-download.test.ts` 源码断言）

#### Scenario: China Brief 的取材
- **WHEN** 请求生成或预览 China Brief，编辑备注写着采购方名称
- **THEN** 接口返回 400 与「已停用」的说明，不读取情报室事实与备注，不产出任何简报文字，不建记录（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）

#### Scenario: 分析综合里的身份信息带不进来
- **WHEN** 项目的分析综合在要求说明里写着采购方名称，已确认的要求里没有，生成供应商询价单
- **THEN** 照常生成，渲染内容里没有采购方名称（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）

### Requirement: 供应商侧文件命中时不生成
供应商询价单生成之前，系统 SHALL 让整份内容过禁出清单与格式检查，项目名称类只查我方撰写的部分（标题、栏目名、固定文字与我方抬头）。命中时 SHALL NOT 写文件、SHALL NOT 建文件记录；生成接口 `POST /api/projects/{id}/generate-pdf` SHALL 返回 422、`errorCode: "IDENTITY_LEAK"` 与写明类别与位置的说明（「询价单没有生成，也没有保存文件：里面会出现招标身份信息（命中：{类别}·{位置}）。请到「招标要求」核对已确认的要求；改不了的请联系管理员。」）。说明 SHALL NOT 含命中的原文。

#### Scenario: 分析里的要求写了采购方
- **WHEN** 当前可用分析里一条已确认的供应商侧要求 `R-07` 的原文写着采购方名称，生成供应商询价单
- **THEN** 422、`IDENTITY_LEAK`，说明为「询价单没有生成，也没有保存文件：里面会出现招标身份信息（命中：采购方名称·要求 R-07）。请到「招标要求」核对已确认的要求；改不了的请联系管理员。」；生成记录数不变（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`；错误类型与说明见 `npx tsx src/lib/bid-workflow/__tests__/project-identity-deny.test.ts`）

#### Scenario: 截标当天生成
- **WHEN** 起草日期恰好等于截标日期
- **THEN** 照常生成（起草日期不参与比对）（`npx tsx src/lib/tender-rfq/__tests__/sheet-download.test.ts`）

#### Scenario: 回复截止落在截标当天
- **WHEN** 在截标前 2 天生成供应商询价单（本次之前回复截止会落在截标当天并被拦下）
- **THEN** 回复截止取截标前一天，照常生成，文件里没有截标日期（`npx tsx src/lib/tender-rfq/__tests__/sheet-download.test.ts`；经菜单路径端到端见 `NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）

## ADDED Requirements

### Requirement: 回复截止早于截标日
询价单的回复截止 SHALL 是「截标日期减回复截止提前量」与「今天加 2 天」里较晚的一个，且 SHALL NOT 晚于截标前一天；日期按组织时区计。算出来的日期早于今天（截标就在今天或已过）时 SHALL 不写日期，邮件与附件里写「请尽快」。项目没有截标日期时同样写「请尽快」。回复截止 SHALL NOT 等于截标日期。

#### Scenario: 截标前两天与提前量为零
- **WHEN** 组织时区为 `America/Toronto`、截标为当地 `2026-12-05`：分别在当地 11-19、12-03、12-04、12-05 起草（提前量 7 天）；另在 11-19 起草、提前量为 0
- **THEN** 回复截止分别是 `2026-11-28`、`2026-12-04`、`2026-12-04`、「请尽快」；提前量为 0 时是 `2026-12-04`；五种情形都不等于 `2026-12-05`，询价单都生成得出来（`npx tsx src/lib/tender-rfq/__tests__/build.test.ts`）

#### Scenario: 截标时刻在当地是前一天
- **WHEN** 截标为 `2026-12-06T03:00:00Z`（多伦多当地 12-05 22:00），在 12-04 起草
- **THEN** 回复截止按当地日期算，是 `2026-12-04`，不是 `2026-12-05`（同一测试）
