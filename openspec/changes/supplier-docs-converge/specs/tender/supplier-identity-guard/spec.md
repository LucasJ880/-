# Spec Delta

## MODIFIED Requirements

### Requirement: 供应商侧生成文件
「供应商询价单」（「一键生成文档」里的 `supplier_rfq`）是唯一的供应商侧生成文件，系统 SHALL 按以下规则生成：
- 抬头只有文件标题、询价编号、我方抬头、起草日期与回复截止；SHALL NOT 印项目名称、项目编号、采购方与投标截止。起草日期是系统生成的日期，不参与禁出清单比对。
- 内容只取自询价单本身（见 `tender/rfq-sheet-download`）；SHALL NOT 含项目 AI 上下文、项目名称、项目描述与 AI 分析综合的文字，因而不含客户、标号、预估金额、我方报价与中标价。
- 目的地按「目的地口径」：菜单生成没有人工填写的目的地，只取分析地点里的「城市, 省」，取不出就不写。
- 生成之前，询价单每一处供应商看得到的文字按询价邮件同样的口径过禁出清单与格式检查，模板的固定文字另按我方撰写再查一遍，命中即不生成（见「供应商侧文件命中时不生成」）。

「供应商技术确认表」与「国内供应商简报（China Brief）」已停止生成（见 `tender/rfq-sheet-download`「已停用的两类文件」），SHALL NOT 再从情报室事实、编辑备注或固定模板产出任何发给供应商的文字。

#### Scenario: 符合性确认表的对外抬头
- **WHEN** 用招标编号 `24062-27-057`、采购方 `Treasury Board of Canada Secretariat`、项目名称 `Sleeping Bags and Mats`、截标 `2026-12-05`、地点事实 `Delivery to 2 Constellation Crescent, Ottawa, ON K1A 0K9` 的项目生成供应商询价单
- **THEN** 文件里有标题「询价单 / 符合性确认表」与询价编号，没有 `24062-27-057`、`Treasury Board`、`Sleeping Bags and Mats`、`2026-12-05`、`Constellation` 与 `K1A`，目的地为 `Ottawa, ON`（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）

#### Scenario: 改前的抬头会被拦下
- **WHEN** 用 CHAIN-4b 之前生成的「供应商询价与符合性确认表」（抬头印着项目编号、采购方、投标截止的夹具）过同一项目的禁出清单
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
