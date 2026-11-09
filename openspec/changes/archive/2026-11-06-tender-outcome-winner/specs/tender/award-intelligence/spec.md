# Spec Delta

## Purpose

组织级授标情报投影（deriveAwardIntelligence）里"竞争对手"域的口径：竞争对手只来自其他中标方，我方组织自己的中标记录不计入竞争对手，但仍保留在历史授标与买家中标方列表里。

## ADDED Requirements

### Requirement: 竞争对手域排除我方
授标情报投影 SHALL 接受我方组织名，按授标记录同一规范化比较，把我方中标的记录从"竞争对手"的已确认与线索两处排除，并给出被排除的条数 `ownAwardCount`；历史授标列表与买家的中标方列表 SHALL 保持原样（语义为中标方，包括我方）。不提供组织名时投影 SHALL 与改动前一致。组织级授标接口 SHALL 传入当前组织名；"历史中标"页 SHALL 在有排除时显示"已排除我方自己的中标记录 N 条"。

#### Scenario: 排除我方
- **WHEN** 授标记录里有我方两条（一条人工确认、一条线索，大小写不同）和对手各一条，并传入我方组织名
- **THEN** 竞争对手已确认只剩对手、线索只剩对手线索，`ownAwardCount` 为 2，历史授标仍为 4 条；`award-semantics.test.ts`（SEM-T4-09）覆盖

#### Scenario: 不传组织名
- **WHEN** 不传组织名
- **THEN** 结果与改动前一致，我方仍按中标方出现在竞争对手域，`ownAwardCount` 为 0；同一测试覆盖
