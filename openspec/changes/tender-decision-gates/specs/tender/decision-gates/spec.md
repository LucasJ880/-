## Purpose
规定招投标项目在两种情况下怎样提醒人：投标决定是不投（No-Go）之后去询价或起草投标文件；基于还没批准的分析起草投标文件。只提醒，不拦。

## ADDED Requirements

### Requirement: No-Go 之后的提醒
开关对项目的组织开启、且项目当前的投标决定是不投（No-Go）时，询价入口 SHALL 多一条不阻断的提醒，写明定下不投的日期（按组织时区）与「照常可以询价，请确认是否还要问供应商要价」；投标文件起草卡片 SHALL 显示同一类提醒。询价入口的可用与否、起草能否进行 SHALL NOT 因此改变。投标决定是投、暂缓或还没决定时 SHALL NOT 有提醒；决定改回投之后提醒 SHALL 消失。

#### Scenario: 定了不投
- **WHEN** 项目的投标决定是 No-Go，读取询价入口与投标文件起草的元信息
- **THEN** 询价入口的提醒里有这一条、入口仍然可用；起草元信息里有这一条提醒（`npx tsx src/lib/tender-decision-gates/__tests__/decision-gates-db.isolated.test.ts`；`npx tsx src/lib/tender-decision-gates/__tests__/decision-gates.test.tsx`）

#### Scenario: 改回投、暂缓、没决定
- **WHEN** 投标决定改回 GO，或是 HOLD，或还没有
- **THEN** 没有这一条提醒（`decision-gates-db.isolated.test.ts`）

#### Scenario: 开关关闭
- **WHEN** 开关关闭或组织不在名单里
- **THEN** 询价入口的提醒与起草元信息都与原来相同（`decision-gates-db.isolated.test.ts`）

### Requirement: 基于未批准分析起草的标注
开关开启时，投标文件起草所用的那一份分析（最新的等待审核或已批准的分析）还没批准的，起草卡片 SHALL 在起草前提示「当前分析还没批准，起草会基于未确认的要求」；起草时 SHALL 记下所用分析的标识与它当时是否已批准；那份草稿的卡片信息与生成的草稿文件 SHALL 写明它基于未确认的要求。所用分析已批准时 SHALL NOT 有这些标注。标注 SHALL NOT 改变起草的内容与提示词。

#### Scenario: 分析还在等审核时起草
- **WHEN** 当前分析是等待审核，起草投标文件
- **THEN** 起草前的元信息说当前分析还没批准；起草之后记下的信息说基于未批准的分析；生成的草稿文件里有「基于未确认的要求」的横幅（`decision-gates-db.isolated.test.ts`；`decision-gates.test.tsx`）

#### Scenario: 分析已批准
- **WHEN** 当前分析已批准，起草投标文件
- **THEN** 没有这些标注（`decision-gates-db.isolated.test.ts`；`decision-gates.test.tsx`）

### Requirement: 只提醒，不拦、不改记录
本能力 SHALL NOT 阻止询价或起草，SHALL NOT 修改投标决定、分析或要求的任何状态，SHALL NOT 发起任何对外动作。

#### Scenario: 读取前后
- **WHEN** 读取询价入口与起草元信息并返回了提醒
- **THEN** 投标决定、分析、要求、审批卡与审计都没有变化（`decision-gates-db.isolated.test.ts`）
