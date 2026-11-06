# Spec Delta

## Purpose

组织级「竞争对手」「采购机构」画像：从授标事实与我方招标项目汇总，只读、确定性、不出现合计金额或中标概率。

## ADDED Requirements

### Requirement: 竞争对手画像
系统 SHALL 按中标方（规范化名称）归集组织的授标事实，排除我方组织的中标并给出排除条数；每个对手 SHALL 分别给出已确认次数（ACTIVE 且人工确认或权威公开来源）与线索条数（AI 提取或疑似重复），列出它中过标的采购机构及次数和每条授标记录；线索记录 SHALL NOT 给出金额；撤回记录 SHALL NOT 计入。同样的输入 SHALL 得到同样的输出。

#### Scenario: 我方排除与分层
- **WHEN** 授标事实里有同一对手的两条已确认、一条 AI 提取，我方两条（大小写不同），一条撤回
- **THEN** 该对手已确认 2、线索 1，线索记录金额为空；我方不出现，排除条数为 2；撤回的不出现；`npx tsx src/lib/tender-intel/__tests__/org-profiles.test.ts` 覆盖

### Requirement: 采购机构画像
系统 SHALL 按规范化机构名合并授标事实与我方招标项目的采购方；每个机构 SHALL 给出授标条数（已确认 / 线索）、中标方列表（我方标出、不排除）、采购周期（只属于买家×可比范围组，样本不够为 UNKNOWN），以及我方项目按结果的计数（中标 / 未中标 / 未投 / 取消 / 进行中）和最近 5 个项目。我方项目 SHALL 只统计当前用户按项目可见性规则能看到的项目。

#### Scenario: 合并与可见性
- **WHEN** 同一机构的项目采购方写法大小写 / 标点不同，另有一个待派发项目与一个非 tender 项目
- **THEN** 只合并成一个机构；我方项目计数不含待派发与非 tender 项目；我方中标在中标方里标「我方」；`org-profiles-db.isolated.test.ts` 覆盖

### Requirement: 只读接口与降级
`GET /api/org/tender-intel-profiles` SHALL 只读；非本组织成员 SHALL 返回 403。授标情报开关关闭时 SHALL NOT 访问授标表，SHALL 返回 `awardsAvailable=false`、竞争对手为空、机构只按我方项目建立。

#### Scenario: 开关关闭
- **WHEN** `T4_AWARD_INTELLIGENCE_SCHEMA_READY` 关闭时请求接口
- **THEN** 返回 200，`awardsAvailable=false`，竞争对手为空，机构仍按我方项目显示且授标为 0；同一测试覆盖

### Requirement: 周期采购入口收起
情报中枢页签与侧栏 SHALL NOT 显示「周期采购」入口；该页面路径 SHALL 仍可访问。

#### Scenario: 导航
- **WHEN** 查看情报中枢页签与项目智能侧栏分组
- **THEN** 没有「周期采购」；`npx tsx src/lib/navigation/__tests__/position-nav.test.ts` 通过
