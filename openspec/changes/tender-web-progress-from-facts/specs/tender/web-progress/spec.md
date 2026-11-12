## Purpose
规定招投标项目页上「当前阶段」与六段进度条显示什么：阶段记录有两段只能人工推进、常常落后于实际，页面取阶段记录与实际进度里靠后的那个来显示，并在两者不一致时写明。只改显示，不改阶段记录。

## ADDED Requirements

### Requirement: 实际进度到了哪一段
「下一步」接口 SHALL 另外返回按实际进度到达的阶段，由同一次取数的事实确定：有提交时间 → 项目提交；任何一轮（已取消的不算）里有供应商已报价 → 供应商报价；有供应商已发出、已回复或已有结果 → 供应商询价；有等待审核或已批准的分析 → 项目解读；都没有 → 立项。判断 SHALL 是确定性的，SHALL NOT 调用模型，SHALL NOT 写任何东西。

#### Scenario: 逐段
- **WHEN** 项目依次处于：只有文件；分析等待审核；一轮询价已发出；其中一家已报价；有提交时间
- **THEN** 实际进度依次是立项、项目解读、供应商询价、供应商报价、项目提交（`npx tsx src/lib/tender-next-step/__tests__/web-progress.test.ts`；`npx tsx src/lib/tender-next-step/__tests__/web-next-step-db.isolated.test.ts`）

#### Scenario: 报价在更早的一轮
- **WHEN** 第 1 轮有一家已报价，之后又开了第 2 轮、只发出还没人回
- **THEN** 实际进度是供应商报价（不因为当前这一轮还没人报价而退回供应商询价）（`web-next-step-db.isolated.test.ts`）

### Requirement: 显示的阶段取靠后的那个
「下一步」可用时，项目页显示的阶段 SHALL 是阶段记录与实际进度里靠后的那个：决策摘要的标题、项目进度区的「当前阶段」、六段进度条与完成百分比 SHALL 都用它。阶段记录比实际进度靠后时（有人手工推进过） SHALL 以阶段记录为准。页面 SHALL NOT 因此修改阶段记录。「下一步」不可用（含开关关闭）时 SHALL 与现在相同，只用阶段记录。

#### Scenario: 记录落后
- **WHEN** 阶段记录是项目分发，实际已有两家报价
- **THEN** 决策摘要写「当前处于“供应商报价”阶段」，进度条走到供应商报价（`web-progress.test.ts`；截图 `docs/acceptance/flow-h1b/quotes-ready.png`）

#### Scenario: 记录超前
- **WHEN** 阶段记录是供应商报价（手工推进），实际只发出了询价
- **THEN** 显示供应商报价（`web-progress.test.ts`）

#### Scenario: 开关关闭
- **WHEN** 开关关闭
- **THEN** 显示的阶段就是阶段记录，页面与现在相同（截图 `docs/acceptance/flow-h1b/flag-off.png`）

### Requirement: 不一致时写明
显示的阶段与阶段记录不同时，项目进度区 SHALL 写明：显示的是按实际进度得出的阶段，记录的阶段是哪一段，阶段记录没有自动推进。两者相同时 SHALL NOT 出现这段说明。

#### Scenario: 说明
- **WHEN** 显示的是供应商报价、记录的是项目分发
- **THEN** 项目进度区有一行说明，写出「项目分发」（截图 `docs/acceptance/flow-h1b/quotes-ready.png`；`web-progress.test.ts`）

### Requirement: 三步卡让位
「下一步」卡片出现时，工作台 SHALL NOT 再显示三步卡。卡片不出现时三步卡 SHALL 照旧显示。

#### Scenario: 有卡片时
- **WHEN** 开关开启，打开一个招投标项目的工作台
- **THEN** 有「下一步」卡片，没有三步卡；开关关闭时相反（截图 `docs/acceptance/flow-h1b/quotes-ready.png`、`flag-off.png`；`web-progress.test.ts` 的源码断言）
