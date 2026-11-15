# tender/rfq-round-analysis-update Specification

## Purpose
规定询价引擎发出的询价轮次在之后招标分析更新时怎样提示人：只按时间判断、只提示、不说具体哪条变了、不做任何对外动作。

## Requirements

### Requirement: 分析更新之后的轮次提示
开关对项目的组织开启时，询价入口接口 SHALL 为询价引擎发出的每一轮判断：询价单取要求用的那一份分析（项目最新创建的等待审核或已批准的分析）是否在这一轮的发送卡创建（邮件正文定下）之后才完成或才批准。是的话 SHALL 为这一轮返回一句提示，写明起草日期、分析更新日期（按组织时区），以及引用的要求可能已经变了、请核对；询价区 SHALL 在这一轮的状态行下显示。更新之后已经又起草过一轮时，之前的轮次 SHALL NOT 再提示。那一份在起草之前就完成且批准、或没有可用的分析时 SHALL NOT 有提示。失败的、进行中的、已被取代的、别的项目或别的组织的分析 SHALL NOT 算。单条要求的确认或驳回 SHALL NOT 算作更新。

#### Scenario: 起草之后分析更新过
- **WHEN** 一轮询价的发送卡在 11 月 10 日创建并已发出，11 月 12 日有一份新的分析完成、等待审核
- **THEN** 接口为这一轮返回提示，写明 11 月 10 日起草、11 月 12 日更新（`npx tsx src/lib/tender-rfq/__tests__/analysis-update-note-db.isolated.test.ts`；`npx tsx src/lib/tender-rfq/__tests__/analysis-update-note.test.tsx`）

#### Scenario: 起草时还在进行、起草很久之后才发出、起草之后才批准
- **WHEN** 新的一份在起草之前开始、之后才完成；或这一轮起草之后过了几天才发出，分析在这几天里更新；或询价单用的那一份在起草之后才批准
- **THEN** 三种情况都有提示（`analysis-update-note-db.isolated.test.ts`；`analysis-update-note.test.tsx`）

#### Scenario: 之后又发了一轮
- **WHEN** 分析更新之后又起草了一轮
- **THEN** 两轮都没有提示（`analysis-update-note-db.isolated.test.ts`；`analysis-update-note.test.tsx`）

#### Scenario: 更早创建的分析最近才完成
- **WHEN** 一份更早创建的分析最近才完成，询价单用的是之后创建、起草之前就完成的那一份
- **THEN** 没有提示（`analysis-update-note-db.isolated.test.ts`）

#### Scenario: 分析在起草之前就完成了
- **WHEN** 分析在发送卡创建之前完成，之后没有新的
- **THEN** 这一轮没有提示（`analysis-update-note-db.isolated.test.ts`）

#### Scenario: 之后的分析失败、还在进行、属于别的项目
- **WHEN** 发送卡创建之后只有失败的、进行中的分析，或别的项目、别的组织有新的分析
- **THEN** 这一轮没有提示（`analysis-update-note-db.isolated.test.ts`）

#### Scenario: 开关关闭
- **WHEN** 开关关闭，或组织不在名单里
- **THEN** 接口不返回这一项（`analysis-update-note-db.isolated.test.ts`）

### Requirement: 只提示，不说具体哪条、不做对外动作
提示 SHALL NOT 说出具体哪条要求变了，SHALL NOT 带出要求原文或邮件正文。判断与显示 SHALL NOT 建审批卡、SHALL NOT 发信、SHALL NOT 改询价轮次或要求的任何状态。

#### Scenario: 读取前后什么都没变
- **WHEN** 读取询价入口接口，返回了提示
- **THEN** 审批卡、询价轮次与条目、要求、审计都没有新增或改动；提示里没有要求编号与原文；别的组织的人读不到（403）（`analysis-update-note-db.isolated.test.ts`）
