# Spec Delta

## Purpose

按组织 policy 查表执行的内部自治动作：长期无互动的开放商机自动转为搁置并通知负责人，不合格自动关闭留下 policy 键名，配额命中对管理层可见。全部默认关闭或沿用既有开关，外部动作一律仍走审批。

## ADDED Requirements

### Requirement: 自动搁置默认关闭
policy SHALL 提供 `autonomy.autoStale` 开关，默认 `false`；存量 policy 没有这一项时 SHALL 视为关闭，非布尔值 SHALL 视为关闭。开关关闭的组织 SHALL NOT 发生任何自动搁置、为此写的审计或通知，也 SHALL NOT 为此查询候选商机。

#### Scenario: 未配置零行为
- **WHEN** 组织 policy 没有 `autonomy` 配置，定时任务运行
- **THEN** 没有商机被自动搁置，没有对应审计与通知，候选查询没有发生

#### Scenario: 非布尔值
- **WHEN** policy 覆盖写入 `{"autonomy":{"autoStale":"yes"}}`
- **THEN** 合并后的 `autonomy.autoStale` 为 `false`

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/revenue-spine/__tests__/autonomy.test.ts`
- **THEN** 本 spec 全部 scenario 的断言通过，退出码 0

### Requirement: 自动搁置的条件
开关开启时，既有 Revenue Spine 定时任务 SHALL 在重算下一步之前，把同时满足以下条件的商机流转到 `stale`：
1. 当前阶段为开放阶段（新询盘到谈判）；
2. 最后互动时间早于 `followUp.staleAfterDays` 天前；没有互动记录时，按创建时间判断；
3. 买家最后来信时间为空，或早于同一时点；
4. 该商机没有状态为 `pending` 或 `approved` 的审批动作（按载荷中的商机 id 匹配）；
5. 客户未归档。

不满足任一条件的商机 SHALL NOT 被流转。

#### Scenario: 超期且无在途草稿
- **WHEN** 开关开启，`staleAfterDays = 21`，商机阶段 `follow_up`，最后互动 30 天前，买家从未来信，没有审批动作
- **THEN** 商机流转到 `stale`

#### Scenario: 有在途草稿
- **WHEN** 同上，但该商机有一个 `pending` 的询盘回复审批
- **THEN** 商机不流转

#### Scenario: 买家近期来信
- **WHEN** 同上，但买家 3 天前来信
- **THEN** 商机不流转

#### Scenario: 非开放阶段
- **WHEN** 商机阶段为 `nurture`、`stale` 或 `won`，其余条件满足
- **THEN** 商机不流转

### Requirement: 流转方式与审计
自动搁置 SHALL 经唯一阶段写入口完成，来源为 `system`，SHALL NOT 放宽阶段流转规则。每次流转的审计 SHALL 包含：
- 前后阶段；
- 来源 `system`；
- policy 键名 `autonomy.autoStale`；
- 含天数的原因文本。

审计动作 SHALL 出现在 company.log 时间线（不在时间线的排除名单里）。

#### Scenario: 审计内容
- **WHEN** 一个商机被自动搁置，`staleAfterDays = 21`
- **THEN** 审计记录为 `revenue_spine.opportunity.transition`，前阶段为原阶段、后阶段为 `stale`、来源 `system`、`policyKey = "autonomy.autoStale"`，原因含"21 天"

#### Scenario: 阶段规则不放宽
- **WHEN** 运行自治测试
- **THEN** 阶段流转规则表与改动前逐项相同，且每个开放阶段本来就允许转 `stale`

### Requirement: 通知负责人
每轮自动搁置后，系统 SHALL 给每个负责人发一条站内通知，类型 `followup`，汇总本轮被搁置的商机数与前几个商机标题，链接到 `/revenue`。没有负责人的商机 SHALL 计入创建人的通知。通知 SHALL NOT 包含买家邮箱、电话或任何金额。通知失败 SHALL NOT 回滚已完成的流转，也 SHALL NOT 中断本组织的后续步骤。

#### Scenario: 按负责人汇总
- **WHEN** 一轮内负责人 A 的 3 个商机、负责人 B 的 1 个商机被搁置
- **THEN** A 收到一条"已自动搁置 3 个长期无互动商机"，B 收到一条"已自动搁置 1 个长期无互动商机"

#### Scenario: 无负责人
- **WHEN** 被搁置的商机没有负责人，创建人为 C
- **THEN** C 收到通知

### Requirement: 上限与幂等
每个组织每轮 SHALL 最多流转 200 个商机，并遵守定时任务既有的维护时间预算；剩余的 SHALL 留到下一轮。已经是 `stale` 的商机 SHALL NOT 再次成为候选。单个商机流转失败 SHALL NOT 中断同组织其它商机。

#### Scenario: 第二轮
- **WHEN** 上一轮已把商机 X 搁置，下一轮运行
- **THEN** X 不再被流转、不再被通知

#### Scenario: 单个失败
- **WHEN** 一轮有 3 个候选，其中第 2 个流转返回失败
- **THEN** 第 1、3 个照常流转，结果里记 1 个失败

### Requirement: 不产生外部动作
自治动作 SHALL NOT 创建审批动作、草稿、邮件或任何对外发送，SHALL NOT 自动批准或驳回任何审批，SHALL NOT 新增定时任务或队列。

#### Scenario: 静态检查
- **WHEN** 运行自治测试
- **THEN** 源码断言自治模块不调用审批创建、发送或执行器；`vercel.json` 的定时任务清单未改变

### Requirement: 不合格自动关闭带 policy 键名
FDE 在 `businessProfile.excludedCategoryAction = "decline"`、询盘只命中不做类目而判为不合格时，转 `disqualified` 的审计 SHALL 包含 `policyKey = "businessProfile.excludedCategoryAction"`。这一行为 SHALL 仍不起草任何回复。`excludedCategoryAction` 为默认 `review` 时，这类询盘 SHALL NOT 被判为不合格。

#### Scenario: decline
- **WHEN** 运行自治测试
- **THEN** 源码断言 FDE 判不合格的流转在 decline 命中时传入该 policy 键名，且不合格分支不创建草稿；评分在 `review` 时把只命中不做类目的询盘判为需要信息而非不合格

### Requirement: 配额命中对管理层可见
FDE 运行 SHALL 继续经过 `DAILY_AGENT_RUNS` 配额预留。硬限额命中时 SHALL 写 `QUOTA_HARD_LIMIT_BLOCKED` 审计，并通知组织 owner / admin。岗位健康度 SHALL 据此显示配额命中。本 change SHALL NOT 改变配额本身。

#### Scenario: 链路静态检查
- **WHEN** 运行自治测试
- **THEN** 源码断言链路完整：
  - FDE 运行创建走配额预留；
  - 预留走配额评估；
  - 评估在硬限额时写审计并通知 owner / admin；
  - 岗位健康度读取该审计或通知。

### Requirement: dogfood 开启脚本
`scripts/seed-revenue-autonomy.ts` SHALL 默认只打印计划不写入；带 `--apply` 时 SHALL 为指定组织（缺省 `sunny-home-deco`）发布一版 policy，只把 `autonomy.autoStale` 设为 `true`，其余 policy 保持原值。已开启时 SHALL NOT 重复发布。代码里的默认值 SHALL 保持关闭。

#### Scenario: 计划
- **WHEN** 现有 policy 覆盖为 `{"followUp":{"staleAfterDays":30}}`，计算开启计划
- **THEN** 新覆盖为 `{"followUp":{"staleAfterDays":30},"autonomy":{"autoStale":true}}`

#### Scenario: 已开启
- **WHEN** 现有覆盖已含 `autonomy.autoStale = true`
- **THEN** 计划为不发布
