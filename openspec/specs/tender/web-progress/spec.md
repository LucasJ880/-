# tender/web-progress Specification

## Purpose
规定招投标项目页上「当前阶段」与六段进度条显示什么：阶段记录有两段只能人工推进、常常落后于实际，页面取阶段记录与实际进度里靠后的那个来显示，并在两者不一致时写明。只改显示，不改阶段记录。

## Requirements

### Requirement: 实际进度到了哪一段
「下一步」接口 SHALL 另外返回按实际进度到达的阶段，由同一次取数的事实确定：有提交时间 → 项目提交；最近 20 轮没取消的询价里有供应商已报价，或有没作废的投标报价单 → 供应商报价；这些轮次里有供应商已发出（含已回复、已谢绝、未响应）→ 供应商询价；有等待审核或已批准的分析 → 项目解读；都没有 → 立项。判断 SHALL 是确定性的，SHALL NOT 调用模型，SHALL NOT 写任何东西。

#### Scenario: 逐段
- **WHEN** 项目依次处于：只有文件；分析等待审核；一轮询价已发出；其中一家已报价；有提交时间
- **THEN** 实际进度依次是立项、项目解读、供应商询价、供应商报价、项目提交（`npx tsx src/lib/tender-next-step/__tests__/web-progress.test.ts`；`npx tsx src/lib/tender-next-step/__tests__/web-next-step-db.isolated.test.ts`）

#### Scenario: 报价在更早的一轮
- **WHEN** 第 1 轮有一家已报价，之后又开了第 2 轮、只发出还没人回
- **THEN** 实际进度是供应商报价（不因为当前这一轮还没人报价而退回供应商询价）（`web-next-step-db.isolated.test.ts`）

#### Scenario: 不算数的
- **WHEN** 轮次里的供应商都还没发出；或只有回复、报价还没录入；或有报价的那一轮被取消
- **THEN** 分别不算到了供应商询价、不算到了供应商报价、不算到了供应商报价（`web-next-step-db.isolated.test.ts`）

#### Scenario: 只有投标报价单
- **WHEN** 没有询价，但有一份没作废的投标报价单
- **THEN** 实际进度是供应商报价；报价单作废后不再算（`web-progress.test.ts`；`web-next-step-db.isolated.test.ts`）

### Requirement: 显示的阶段由接口给出
接口 SHALL 同时返回记录的阶段（与其余事实同一时刻读的阶段记录）与显示的阶段。项目没结束时显示的阶段 SHALL 是两者里靠后的那个；阶段记录靠后时（有人手工推进过） SHALL 以阶段记录为准。项目已结束（已放弃、已归档、招投标状态是终态）时显示的阶段 SHALL 就是记录的阶段。接口 SHALL NOT 因此修改阶段记录。

#### Scenario: 记录落后
- **WHEN** 阶段记录是项目分发，实际已有两家报价
- **THEN** 显示的阶段是供应商报价，记录的阶段是项目分发（`web-progress.test.ts`；`web-next-step-db.isolated.test.ts`）

#### Scenario: 记录超前
- **WHEN** 阶段记录是供应商报价（手工推进），实际只发出了询价
- **THEN** 显示的阶段是供应商报价（`web-progress.test.ts`）

#### Scenario: 已结束的项目
- **WHEN** 项目未中标（或已中标、已放弃），阶段记录是供应商询价，实际有一家报价
- **THEN** 显示的阶段是供应商询价（完成百分比不被抬高）（`web-progress.test.ts`；`web-next-step-db.isolated.test.ts`）

#### Scenario: 阶段记录刚被别处写过
- **WHEN** 页面开着的时候，批准询价或分析完成把阶段记录往前写了一段，页面重新取「下一步」
- **THEN** 记录的阶段是新的那一段（不沿用页面上旧的项目数据）（`web-next-step-db.isolated.test.ts`）

### Requirement: 页面按显示的阶段呈现
「下一步」可用时，项目页 SHALL 用接口给出的显示的阶段：每个页签上方的决策摘要标题、右侧项目上下文的当前阶段、项目进度区的「当前阶段」、六段进度条与完成百分比。「下一步」不可用（开关关闭、接口失败、非招投标项目）或给出的值认不出时 SHALL 与现在相同，只用页面上的阶段记录。页面 SHALL NOT 调用任何写阶段记录的接口。

#### Scenario: 记录落后
- **WHEN** 阶段记录是项目分发，实际已有两家报价
- **THEN** 决策摘要写「当前处于“供应商报价”阶段」，进度条走到供应商报价、完成 40%（`npx tsx src/components/tender/__tests__/project-progress-section.test.tsx`；截图 `docs/acceptance/flow-h1b/quotes-ready.png`）

#### Scenario: 开关关闭
- **WHEN** 开关关闭
- **THEN** 显示的阶段就是阶段记录，项目进度区渲染出的内容与不传这两项时逐字相同（`project-progress-section.test.tsx`；截图 `docs/acceptance/flow-h1b/flag-off.png`）

### Requirement: 不一致时写明
显示的阶段与记录的阶段不同时，项目进度区 SHALL 写明：显示的是按实际进度得出的阶段，记录的阶段是哪一段，阶段记录没有自动推进。这里说的记录的阶段 SHALL 是接口那一刻读到的，不是页面上可能已经过时的项目数据。两者相同时 SHALL NOT 出现这段说明。

#### Scenario: 说明
- **WHEN** 显示的是供应商报价、记录的是项目分发
- **THEN** 项目进度区有一行说明，写出「项目分发」（`project-progress-section.test.tsx`；截图 `docs/acceptance/flow-h1b/quotes-ready-progress.png`）

#### Scenario: 没有说明
- **WHEN** 显示的阶段与记录的阶段相同，或「下一步」不可用
- **THEN** 没有这一行（`project-progress-section.test.tsx`）

### Requirement: 三步卡让位
「下一步」卡片出现时，工作台 SHALL NOT 再显示三步卡。卡片不出现时三步卡 SHALL 照旧显示。

#### Scenario: 有卡片时
- **WHEN** 开关开启，打开一个招投标项目的工作台
- **THEN** 有「下一步」卡片，没有三步卡；开关关闭时相反（截图 `docs/acceptance/flow-h1b/quotes-ready.png`、`flag-off-three-step.png`；`web-progress.test.ts` 的源码断言）
