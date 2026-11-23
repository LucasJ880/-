# Spec Delta

## MODIFIED Requirements

### Requirement: 供应商侧生成文件
「供应商询价单」（「一键生成文档」里的 `supplier_rfq`）是唯一的供应商侧生成文件，内容与版式见 `tender/rfq-sheet-download`。系统 SHALL 按以下规则生成：
- 抬头只有文件标题、询价编号、我方抬头、起草日期与回复截止；SHALL NOT 印项目名称、项目编号、采购方与投标截止。起草日期是系统生成的日期，不参与禁出清单比对。
- SHALL NOT 含项目 AI 上下文、项目描述与 AI 分析综合的文字，因而不含客户、标号、预估金额、我方报价与中标价。
- 目的地只取分析地点里的「城市, 省」（菜单生成没有人工填写的目的地），取不出就不写。
- 生成之前，每一处供应商看得到的文字按询价邮件同样的口径过禁出清单与格式检查，模板的固定文字另按我方撰写再查一遍，命中即不生成（见「供应商侧文件命中时不生成」）。

「供应商技术确认表」与「国内供应商简报（China Brief）」已停止生成，SHALL NOT 再从情报室事实、编辑备注或固定模板产出任何发给供应商的文字。

#### Scenario: 符合性确认表的对外抬头
- **WHEN** 用招标编号 `24062-27-057`、采购方 `Treasury Board of Canada Secretariat`、项目名称 `Sleeping Bags and Mats`、截标 `2026-12-05`、地点事实 `Delivery to 2 Constellation Crescent, Ottawa, ON K1A 0K9` 的项目生成供应商询价单
- **THEN** 文件里有标题「询价单 / 符合性确认表」与询价编号，没有 `24062-27-057`、`Treasury Board`、`Sleeping Bags and Mats`、`2026-12-05`、`Constellation` 与 `K1A`，目的地为 `Ottawa, ON`（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）

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
供应商询价单生成之前，系统 SHALL 让整份内容过禁出清单与格式检查，项目名称类只查我方撰写的部分（标题、栏目名、固定文字与我方抬头）。命中时 SHALL NOT 写文件、SHALL NOT 建文件记录；生成接口 `POST /api/projects/{id}/generate-pdf` SHALL 返回 422、`errorCode: "IDENTITY_LEAK"` 与写明类别与位置的说明（「供应商侧文件含招标身份信息（命中：{类别}·{位置}），未生成。」）。说明 SHALL NOT 含命中的原文。

#### Scenario: 分析里的要求写了采购方
- **WHEN** 当前可用分析里一条已确认的供应商侧要求 `R-07` 的原文写着采购方名称，生成供应商询价单
- **THEN** 422、`IDENTITY_LEAK`，说明为「供应商侧文件含招标身份信息（命中：采购方名称·要求 R-07），未生成。」；生成记录数不变（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`；错误类型与说明见 `npx tsx src/lib/bid-workflow/__tests__/project-identity-deny.test.ts`）

#### Scenario: 截标当天生成
- **WHEN** 起草日期恰好等于截标日期
- **THEN** 照常生成（起草日期不参与比对）（`npx tsx src/lib/tender-rfq/__tests__/sheet-download.test.ts`）

#### Scenario: 回复截止落在截标当天
- **WHEN** 在截标前 2 天生成供应商询价单（回复截止按「不早于今天 + 2 天」的既有规则落在截标当天）
- **THEN** 不生成、不启动 PDF 生成，命中截标日期，位置为「询价附件」（询价单模板文字的位置名）——与起草询价是同一条既有规则，本次不改（`npx tsx src/lib/tender-rfq/__tests__/sheet-download.test.ts`；经菜单路径端到端、PDF 生成函数没被调用见 `NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）

### Requirement: 项目名称只在我方撰写的部分比对
项目名称类词条 SHALL 只在我方撰写的部分里比对：邮件标题、正文里由模板写的句子、发起人填写的栏目（补充说明、目的地、附加问题）、生成文件的抬头与固定文字。项目名称类词条 SHALL NOT 在招标要求的原文与译文、分析的交付要求事实里比对。其余四类词条与格式检查 SHALL 在全部供应商可见内容里比对。

#### Scenario: 要求原文与项目名称相同的词不拦
- **WHEN** 项目名称为 `Sleeping Bags and Mats`，一条已确认的产品类要求写着 `Sleeping bags and mats shall be rated to -20C`
- **THEN** 询价单生成成功，这条要求在行项里（`npx tsx src/lib/tender-rfq/__tests__/build.test.ts`）

#### Scenario: 自己填的栏目写了项目名称
- **WHEN** 同一项目，发起人在补充说明里写 `本轮只询 Sleeping Bags and Mats`
- **THEN** 询价单生成失败，命中项目名称，位置为补充说明（同一测试）

### Requirement: 命中即整份失败
询价单（每条行项、交付要求、发起人填写的栏目）、每一家的询价邮件标题与正文、供应商侧生成文件，任一处命中禁出清单或格式检查时，系统 SHALL 不产出这一份内容：送审时不建询价轮次、不建审批卡；生成文件时不写文件、不建文件记录。系统 SHALL NOT 把命中的部分替换或删去后继续产出。失败说明 SHALL 逐项写明命中的类别（招标编号 / 采购方名称 / 截标日期 / 交货地址 / 项目名称 / 邮箱地址 / 电话号码）与位置（栏目名、要求编号、邮件标题、询价单模板文字等），SHALL NOT 复述命中的原文。既有的出站敏感词检查 SHALL 照旧先做，先命中的按原有规则报。

#### Scenario: 要求里写了采购方名称
- **WHEN** 项目采购方为 `City of Ottawa`，一条已确认的交付类要求 `R-02` 写着 `Deliver to the City of Ottawa warehouse`，发起人在网页上送审
- **THEN** 不建询价轮次、不建审批卡；说明含「命中：采购方名称·要求 R-02」且不含 `City of Ottawa`（`npx tsx src/lib/tender-rfq/__tests__/build.test.ts`；`npx tsx src/lib/tender-rfq/__tests__/supplier-identity-guard-db.isolated.test.ts`）

#### Scenario: 内部敏感词与身份信息同时出现
- **WHEN** 补充说明同时含 `ourBidPrice` 与采购方名称
- **THEN** 按既有规则报出站敏感词，不报身份命中（`build.test.ts`）

### Requirement: 询价邮件用中性询价编号
发给供应商的询价邮件 SHALL 用询价编号称呼项目，编号为 `RFQ-{组织代码}-{年份}-{5 位码}`：组织代码取本组织代码的第一段字母数字、转大写、最多 8 个字符，组织代码为空时为 `QY`；年份为项目创建时间在组织时区的年份；5 位码由项目标识确定，只用数字与不含 I、L、O、U 的大写字母。同一项目的各轮询价、询价入口与供应商侧生成文件 SHALL 用同一个编号。邮件标题 SHALL 为 `询价 {编号}`，有轮次号时接 `（第 N 轮）`，有回复截止时接 ` — 请于 {回复截止} 前回复`；正文对项目的介绍 SHALL 为 `{我方抬头} 现就询价 {编号} 邀请贵司报价，请按以下清单逐项回复。`。正文里数量行（`- 数量：`）与强制要求标记（`【强制】{要求编号}`）的写法 SHALL 不变。邮件标题与正文 SHALL NOT 含项目名称、招标编号、采购方名称与截标日期。

#### Scenario: 联邦标的询价邮件
- **WHEN** 用「禁出清单的来源与类别」里的联邦标项目（组织代码 `sunny-home-deco`、项目创建于 2026 年）起草第 1 轮询价
- **THEN** 标题以 `询价 RFQ-SUNNY-2026-` 开头、接 5 位码与 `（第 1 轮）`；标题与正文都不含 `24062-27-057`、`Treasury Board`、`Sleeping Bags and Mats` 与 `2026-12-05`（`npx tsx src/lib/tender-rfq/__tests__/supplier-identity-guard-db.isolated.test.ts`）

#### Scenario: 同一项目编号不变
- **WHEN** 同一项目先后起草第 1 轮与第 2 轮询价，并生成供应商询价单
- **THEN** 两封邮件与询价单文件里的询价编号相同；另一个项目的编号不同（`npx tsx src/lib/bid-workflow/__tests__/project-identity-deny.test.ts`；`supplier-identity-guard-db.isolated.test.ts`；询价单文件与邮件同号见 `NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）

### Requirement: 内部文件不变
内部决策备忘录、分析师备忘录、RFI 问题清单、投标文件起草、同事任务单 SHALL 照旧印出项目名称、项目编号、采购方与截标日期，SHALL NOT 过禁出清单。

#### Scenario: 内部备忘录照旧
- **WHEN** 用项目名称 `测试项目`、项目编号 `COS-1`、采购方 `Buyer Agency`、截标 `2026-09-04` 的项目生成内部决策备忘录
- **THEN** 备忘录里有 `测试项目`、`COS-1`、`Buyer Agency` 与 `2026-09-04`（`npx tsx src/lib/projects/generate/__tests__/tender-doc-html.test.ts`）
