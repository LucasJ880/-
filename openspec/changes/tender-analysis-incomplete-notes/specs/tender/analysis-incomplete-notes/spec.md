# Spec Delta

## Purpose

规定招投标 V2 分析「做完了，但有地方没做完」时，系统怎样如实告诉人。

- 落库时，在分析记录既有的摘要 JSON 里记下哪里没做完。
- 分析面板、投标合规矩阵、局限说明与完成通知，按这份记录用固定的白话句子说明四件事：
  - 已纳入的文件里哪些内容段 AI 没读完；
  - 「项目解读」页有没有生成；
  - 「项目解读」页的 AI 复核是没做完还是没通过；
  - 有几条澄清问题没能核对文件里是否已有答案。
- 句子全部查表得出，不由模型生成。
- 讲「哪些文件没纳入这次分析」的提示归文件覆盖清单（能力 `tender/analysis-package-coverage`）；本能力只讲已纳入的文件里没做完的地方。
- 没有这份记录的旧分析，显示不变。

## ADDED Requirements

### Requirement: 分析落库时记下没做完的地方

分片续跑的分析交回落库时，系统 SHALL 在该分析记录既有的摘要 JSON 里写一份「未完成记录」，包含下面四项里实际发生的那些：

1. 没读完的内容段：每一段因尝试次数用尽而被排除的内容，记文件名、起止页码（不按页的文件记起止单元标签）与原因；
2. 「项目解读」页没生成：落库时这份分析没有「项目解读」（第一遍两次都没写成，或写成了但组装时出错），记原因与第一遍的尝试次数；
3. 复核没做完：这份分析有「项目解读」，但它的 AI 复核没有得到结果，记原因与复核的尝试次数；
4. 没核对成的澄清问题：见下一条要求。

前三项的原因只有两种：最后一次失败的错误码是 `CALL_DEADLINE_EXCEEDED` 时为「时间不够」，其余（包括没有错误码）为「出错」。四项都没有发生时，系统 SHALL NOT 写入这份记录。

#### Scenario: 一段内容三次都没读成
- **WHEN** 文件《RFP.pdf》第 5–8 页那一段尝试 3 次都失败，最后一次的错误码是 `CALL_DEADLINE_EXCEEDED`，分析照常落库
- **THEN** 未完成记录的第 1 项有一条：文件名「RFP.pdf」、第 5 页到第 8 页、原因「时间不够」
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/v2-incomplete.test.ts` 通过

#### Scenario: 第一遍两次都没写成
- **WHEN** 「项目解读」的第一遍尝试 2 次都失败，最后一次的错误码是 `CALL_DEADLINE_EXCEEDED`
- **THEN** 未完成记录的第 2 项为：原因「时间不够」、尝试 2 次；第 3 项不出现
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/v2-incomplete.test.ts` 通过

#### Scenario: 第一遍写成了但组装出错
- **WHEN** 「项目解读」的第一遍第 1 次就写成，落库前组装「项目解读」时出错，落库的分析里没有「项目解读」
- **THEN** 未完成记录的第 2 项为：原因「出错」、尝试 1 次
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/v2-incomplete.test.ts` 通过

#### Scenario: 复核没有结果
- **WHEN** 「项目解读」已写出，复核尝试 2 次都失败，最后一次的错误码不是 `CALL_DEADLINE_EXCEEDED`
- **THEN** 未完成记录的第 3 项为：原因「出错」、尝试 2 次
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/v2-resumable.test.ts` 通过

#### Scenario: 没有没做完的地方时什么都不写
- **WHEN** 所有内容段都读完，「项目解读」与复核都完成，所有澄清核对都得到结果或没有发起
- **THEN** 摘要 JSON 里没有未完成记录这个键
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/v2-resumable.test.ts` 通过（含「无事可记时没有未完成记录」一例）

### Requirement: 没核对成的澄清问题记编号与问题全文

未完成记录的第 4 项 SHALL 只收这样的澄清问题：在文件里找得到相关页，但「文件里是否已有答案」的核对没有得到结果（检查点里这条的结果为空，或者没有这条的结果）。

- 每条记编号与问题全文；问题全文 SHALL 与落库的澄清问题文字逐字相同。
- 两类澄清问题 SHALL NOT 记入第 4 项：找不到相关页、因而没有发起核对的；核对得到了结果的（不论结论是有答案还是没有答案）。

#### Scenario: 四条澄清问题四种情况
- **WHEN** 有四条澄清问题：
  - 第 1 条在文件里找不到相关页，没有发起核对；
  - 第 2 条核对得到了结果，结论是文件里没有答案；
  - 第 3 条有相关页，核对以调用失败结束；
  - 第 4 条有相关页，检查点里没有它的结果。
- **THEN** 未完成记录的第 4 项只有第 3、4 条（编号 `CL-003`、`CL-004` 与问题全文），第 1、2 条不在其中
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/v2-incomplete.test.ts` 通过

#### Scenario: 问题全文与落库的一致
- **WHEN** 第 4 项里有一条澄清问题
- **THEN** 它的问题全文与这份分析落库的那条澄清问题的问题文字逐字相同
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/v2-incomplete.test.ts` 通过

### Requirement: 未完成记录不改数据结构与续跑检查点

系统 SHALL NOT 为未完成记录新增任何数据表、字段或迁移，SHALL NOT 改变续跑检查点的结构或版本；记录全部由落库那一刻已有的数据算出。

#### Scenario: 上线时正在跑的分析
- **WHEN** 一份分析的检查点是本能力上线前写的，其中一条澄清问题的核对在上线前已经失败；上线后这份分析继续跑完
- **THEN** 检查点照常被接着用、不从头重跑；那一条澄清问题同样记入第 4 项
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/v2-incomplete.test.ts` 通过

### Requirement: 没读完的内容段用固定句子写明位置

系统 SHALL 用下面这一句说明没读完的内容段：

`已纳入的文件里，有 {N} 段内容 AI 没读完：{位置}。这几段的内容没有进这次分析，请人工翻看原文。`

- `{N}` 是没读完的段数。
- `{位置}` SHALL 按内容段在文件包里的先后顺序逐段写出，用「、」连接：
  - 按页的文件写「《文件名》第 a–b 页」，只有一页写「《文件名》第 a 页」；
  - 不按页的文件写「《文件名》首单元标签 至 末单元标签」，只有一个单元写「《文件名》单元标签」；
  - 超过 6 段时只写前 6 段，后面接「等 {N} 处」。
- 这一句 SHALL NOT 随原因（时间不够 / 出错）改变。
- 这一句 SHALL NOT 用「没纳入」「未纳入」来说内容段（「纳入」只用来说文件），SHALL NOT 用「没有读到」（文件覆盖清单说解析失败的文件用这个词）。

#### Scenario: 两段没读完
- **WHEN** 未完成记录里有两段没读完：《RFP.pdf》第 5–8 页、《附件 A.pdf》第 3 页
- **THEN** 句子为「已纳入的文件里，有 2 段内容 AI 没读完：《RFP.pdf》第 5–8 页、《附件 A.pdf》第 3 页。这几段的内容没有进这次分析，请人工翻看原文。」
- **AND** 测试 `npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 通过

#### Scenario: 表格文件写单元标签
- **WHEN** 没读完的一段属于《报价表.xlsx》，首单元标签为「Sheet「Pricing」· 行 1–40」，末单元标签为「Sheet「Pricing」· 行 81–120」
- **THEN** 句子为「已纳入的文件里，有 1 段内容 AI 没读完：《报价表.xlsx》Sheet「Pricing」· 行 1–40 至 Sheet「Pricing」· 行 81–120。这几段的内容没有进这次分析，请人工翻看原文。」
- **AND** 测试 `npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 通过

#### Scenario: 超过 6 段
- **WHEN** 有 9 段没读完
- **THEN** 句子以「已纳入的文件里，有 9 段内容 AI 没读完」开头，只列前 6 段的位置，后面接「等 9 处」
- **AND** 测试 `npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 通过

#### Scenario: 原因不同句子相同
- **WHEN** 同一段内容分别以「时间不够」与「出错」记入未完成记录
- **THEN** 两次得到的句子逐字相同
- **AND** 测试 `npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 通过

### Requirement: 局限说明里讲没读完内容的那一句不带错误码与内部用词

分析结果的局限说明里，讲「有内容没读完」的条目：

- SHALL 就是上一条要求规定的句子，单次编排与分片续跑相同，位置都按文件包里的先后顺序；
- SHALL NOT 出现任何英文错误码；
- SHALL NOT 出现「窗口」「LLM」「抽取」这些内部用词。

局限说明的其它条目不变。

#### Scenario: 分片续跑里一段内容尝试用尽
- **WHEN** 分片续跑的分析里有一段内容尝试 3 次都失败
- **THEN** 落库的局限说明里有一条以「已纳入的文件里，有 1 段内容 AI 没读完：《」开头的句子；全部局限说明里不含「窗口」，也不含 `CALL_DEADLINE_EXCEEDED`、`TRANSIENT_MODEL_ERROR`、`INVALID_STRUCTURED_OUTPUT`
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/v2-resumable.test.ts`（RESUME-06）通过

#### Scenario: 重试后读成功
- **WHEN** 一段内容失败两次后第三次成功
- **THEN** 局限说明里没有讲「没读完」的条目
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/v2-resumable.test.ts`（RESUME-05）通过

#### Scenario: 单次编排里并发失败的两段
- **WHEN** 单次编排里文件包第 2 段与第 5 段都没读成，第 5 段先返回失败
- **THEN** 局限说明那一句里，第 2 段的位置写在第 5 段前面
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/v2-resumable.test.ts` 通过

### Requirement: 面板、矩阵与通知用同一套判定决定说哪几项

系统 SHALL 按下面的固定顺序与条件，从未完成记录得出「要说的事项」：

1. 内容没读完：记录里有没读完的内容段；
2. 没有生成「项目解读」页：记录里有第 2 项，该组织开着投标包 AI 体验，且这份分析确实没有「项目解读」；
3. 复核没做完：记录里有第 3 项，该组织开着投标包 AI 体验，且这份分析有「项目解读」；
4. 澄清问题没核对：记录里有没核对成的澄清问题。

分析面板、投标合规矩阵与完成通知 SHALL 用同一份结果，不各自另判。

- 「这份分析有没有『项目解读』」SHALL 按分析详情接口决定下发不下发「项目解读」的同一条规则判断（版本对不上的当作没有）。
- 该组织没开投标包 AI 体验时，第 2、3 项 SHALL NOT 出现在任何一处（这样的组织看不到「项目解读」页）。
- 记录的形状不对（不是对象、版本号不认识、字段类型不对）时，系统 SHALL 当作没有这份记录。

#### Scenario: 没开投标包 AI 体验的组织
- **WHEN** 未完成记录里有两段没读完的内容与「『项目解读』没生成」，该组织没开投标包 AI 体验
- **THEN** 要说的事项只有「内容没读完」一项；面板与完成通知都不提「项目解读」页
- **AND** 测试 `npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 通过

#### Scenario: 开着投标包 AI 体验
- **WHEN** 同样的记录，该组织开着投标包 AI 体验，分析里没有「项目解读」
- **THEN** 要说的事项依次为「内容没读完」「没有生成「项目解读」页」
- **AND** 测试 `npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 通过

#### Scenario: 记录的形状不对
- **WHEN** 摘要 JSON 里未完成记录这个键的值不是约定的形状
- **THEN** 要说的事项为空；面板不显示那一块，矩阵不显示那一句，完成通知按既有规则收尾
- **AND** 测试 `npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 通过

### Requirement: 分析面板在分析状态那一栏正下方说明没做完的地方

要说的事项不为空时，「招标要求」页签上的分析面板 SHALL 显示一块：

- 位置：在「招标文件自动分析」分析状态那一栏（标题、分析状态与文件纳入情况）的正下方。
- 内容：标题为「这次分析有几处没做完」，下面按事项顺序每条一行（句子见下一条要求）。

这一块的约束：
- SHALL 留在面板的进度部分里，在投标合规矩阵之前。
- SHALL NOT 放进文件覆盖清单里，SHALL NOT 重复覆盖清单讲的「哪些文件没纳入这次分析」。
- 投标包 AI 体验关闭（不显示覆盖清单）时，这一块照样显示第 1、4 项。
- 要说的事项为空时，SHALL NOT 显示这一块。
- 面板挂在其它位置、不带分析状态那一栏的实例（如「提交」页签），SHALL NOT 显示这一块。
- SHALL NOT 禁用或拦截「批准分析」。

#### Scenario: 与解析失败的文件同时出现
- **WHEN** 投标包 AI 体验开启，两份附录 B 解析失败被排除，已纳入的《RFP.pdf》第 5–8 页那一段没读完
- **THEN** 覆盖清单与提示各自只讲文件，那一段只在新加的那一块里出现：
  - 覆盖清单照旧把《RFP.pdf》列为纳入的文件，两份附录 B 写「未纳入：文件解析失败（原因：…）」；
  - 清单下面照旧是讲文件的「解析失败的文件 AI 没有读到。…」；
  - 《RFP.pdf》第 5–8 页只出现在「这次分析有几处没做完」那一块，句子以「已纳入的文件里」开头。
- **AND** 测试 `npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 通过（含分析面板接线的断言：那一块在分析状态那一栏之后、投标合规矩阵之前，不在覆盖清单那一块里）

#### Scenario: 没有没做完的地方
- **WHEN** 分析没有未完成记录
- **THEN** 分析状态那一栏下面没有这一块
- **AND** 测试 `npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 通过

### Requirement: 那一块每种事项用固定的一句话

那一块里，每种事项 SHALL 用下面这一句：

1. 内容没读完：见「没读完的内容段用固定句子写明位置」；
2. 没有生成「项目解读」页：`这次没有生成「项目解读」页。从文件里逐条摘出的要求在「投标合规矩阵」里，请人工逐条核对后判断。`
3. 复核没做完：`「项目解读」页的 AI 复核这次没有做完：这一页只经过第一遍整理，还没有复核过，请人工重点核对。`
4. 澄清问题没核对：`有 {N} 条澄清问题，系统没能核对文件里是否已经有答案；向采购方发出之前，请先自己到文件里查一遍。`（`{N}` 是记录里没核对成的条数）

这一块的标题与各句 SHALL NOT 用「上面」「下面」「上方」「下方」指位置；要指去处时，写那一块或那张卡片的名字。

#### Scenario: 没有生成「项目解读」页
- **WHEN** 未完成记录为「『项目解读』没生成、尝试 2 次」，该组织开着投标包 AI 体验，分析里没有「项目解读」
- **THEN** 那一块的标题为「这次分析有几处没做完」，唯一的一行为「这次没有生成「项目解读」页。从文件里逐条摘出的要求在「投标合规矩阵」里，请人工逐条核对后判断。」
- **AND** 测试 `npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 通过

#### Scenario: 有「项目解读」，一段没读完、复核没做完、三条澄清没核对
- **WHEN** 分析有「项目解读」，未完成记录里有一段没读完的内容、「复核没做完」与 3 条没核对成的澄清问题
- **THEN** 那一块依次显示三行：
  1. 没读完内容的那一句；
  2. 「「项目解读」页的 AI 复核这次没有做完：这一页只经过第一遍整理，还没有复核过，请人工重点核对。」；
  3. 「有 3 条澄清问题，系统没能核对文件里是否已经有答案；向采购方发出之前，请先自己到文件里查一遍。」
- **AND** 测试 `npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 通过

### Requirement: 投标合规矩阵在分析已完成但有内容没读完时写明可能不全

满足两个条件时，投标合规矩阵 SHALL 在顶部显示下面这一句：分析已完成（等待审核或已批准，与矩阵判定「已完成」的规则相同）；要说的事项里有「内容没读完」。

`以下要求可能不全：已纳入的文件里有 {N} 段内容 AI 没读完，位置见「这次分析有几处没做完」。`

- `{N}` 是没读完的段数。
- 分析未完成时，SHALL NOT 显示这一句（矩阵既有的「本次分析未完成，以下可能不全」说明这种情况）。
- 要说的事项里没有「内容没读完」时，SHALL NOT 显示这一句。
- 这一句 SHALL NOT 列出文件名与页码，SHALL NOT 改变矩阵的标注、确认与「批准分析」。

#### Scenario: 已完成，两段没读完
- **WHEN** 分析等待审核，要说的事项为「内容没读完（2 段）」与「澄清问题没核对（1 条）」
- **THEN** 矩阵顶部显示「以下要求可能不全：已纳入的文件里有 2 段内容 AI 没读完，位置见「这次分析有几处没做完」。」
- **AND** 测试 `npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 通过（含矩阵卡片接线的断言：渲染面板交来的那一句，自身不含这一句的文字）

#### Scenario: 分析未完成
- **WHEN** 分析为「AI 分析未完成」，摘要里有未完成记录，记录里有两段没读完
- **THEN** 矩阵不显示这一句
- **AND** 测试 `npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 通过

#### Scenario: 只有澄清问题没核对
- **WHEN** 分析已批准，要说的事项只有「澄清问题没核对（3 条）」
- **THEN** 矩阵不显示这一句
- **AND** 测试 `npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 通过

### Requirement: 复核没做完与未通过分开说

「项目解读」页显示时，页底部的复核横幅 SHALL 按下面的规则选句子：

- 要说的事项里有「复核没做完」：`「项目解读」页的 AI 复核这次没有做完：这一页只经过第一遍整理，还没有复核过，请人工重点核对。`
- 没有这一项，而分析标了「需人工复核」：横幅保持既有的句子「部分结论未通过 AI 质检，需人工重点复核（详见 QA 记录 N 条）。」
- 没有这一项，也没标「需人工复核」：不显示横幅。

「项目解读」页在投标合规矩阵下方收起的分区里，展开后默认停在这一页。

有「复核没做完」这一项时，系统 SHALL NOT 在任何地方显示「未通过 AI 质检」这句话。

系统 SHALL NOT 为了区分这两种情况，改变已存的复核状态取值或「需人工复核」标志。复核没做完的分析，这两样与本能力上线前存的完全相同：状态为「需人工复核」，标志为真。

#### Scenario: 复核没做完
- **WHEN** 未完成记录里有「复核没做完」，分析有「项目解读」，该组织开着投标包 AI 体验，展开「项目解读」页
- **THEN** 横幅为「「项目解读」页的 AI 复核这次没有做完：这一页只经过第一遍整理，还没有复核过，请人工重点核对。」，不出现「未通过 AI 质检」
- **AND** 测试 `npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 通过

#### Scenario: 复核做完且判为需人工复核
- **WHEN** 复核得到结果并标了「需人工复核」，未完成记录里没有「复核没做完」
- **THEN** 横幅仍是「部分结论未通过 AI 质检，需人工重点复核（详见 QA 记录 N 条）。」
- **AND** 测试 `npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 通过

#### Scenario: 已存的复核状态不变
- **WHEN** 复核尝试 2 次都失败，分析落库
- **THEN** 已存的「项目解读」里，复核状态为「需人工复核」，「需人工复核」标志为真，与本能力上线前相同
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/v2-resumable.test.ts` 通过（RESUME-09 补状态取值的断言），`npx tsx src/lib/tender-analyst/__tests__/analyst-synthesis.test.ts` 的全部断言不改、照旧通过

### Requirement: 分析详情接口返回未完成说明

`GET /api/projects/[id]/tender-analysis/runs/[runId]` 的响应 SHALL 增加 `incompleteNotes`。

- 没有未完成记录、记录形状不对、或要说的事项为空时，为 `null`。
- 否则为对象 `{ heading, lines, reviewBanner, matrixLine }`：
  - `heading`：「这次分析有几处没做完」；
  - `lines`：那一块按事项顺序的句子数组；
  - `reviewBanner`：复核横幅的句子；要说的事项里没有「复核没做完」时为 `null`；
  - `matrixLine`：投标合规矩阵顶部那一句；不满足上一条要求的条件时为 `null`。

响应里的其它字段 SHALL 保持不变。接口 SHALL NOT 把这些内容下发给界面：未完成记录的原始内容、原因、尝试次数、错误码、澄清问题编号、检查点内容。

#### Scenario: 有记录的分析
- **WHEN** 分析等待审核、有「项目解读」，该组织开着投标包 AI 体验，未完成记录里有一段没读完的内容与「复核没做完」
- **THEN** `incompleteNotes` 各字段为：
  - `heading` 为「这次分析有几处没做完」；
  - `lines` 有两句；
  - `reviewBanner` 为复核没做完的那一句；
  - `matrixLine` 为「以下要求可能不全：已纳入的文件里有 1 段内容 AI 没读完，位置见「这次分析有几处没做完」。」
- **AND** 测试 `npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 通过

#### Scenario: 接口不下发记录原文
- **WHEN** 读取一份带未完成记录的分析详情
- **THEN** 响应里找不到未完成记录这个键、原因取值与错误码，只有 `incompleteNotes` 里的句子
- **AND** 测试 `npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 通过（含接口源码的断言）

### Requirement: 完成通知如实说有地方没做完

要说的事项不为空时，分析完成的站内通知（标题「招标分析已完成，待确认」）摘要 SHALL 以下面这一句收尾，SHALL NOT 出现「可以开始确认招标要求」：

`这次有地方没做完（{清单}），请先看「招标要求」页里「这次分析有几处没做完」的说明`

`{清单}` 是要说的事项各自的短语，按事项顺序用「、」连接：`有 {N} 段内容没读完`、`没有生成「项目解读」页`、`「项目解读」页的 AI 复核没做完`、`有 {N} 条澄清问题没核对`。

与既有句子的关系：
- 分析标了「需人工复核」、且要说的事项里没有「复核没做完」时，既有的「AI 审校标记了需要人工复核的地方，请优先查看」SHALL 保留在这一句之前。
- 要说的事项里有「复核没做完」时，SHALL NOT 出现「AI 审校标记了」这一句。
- 要说的事项为空时，收尾句 SHALL 与既有规则相同。

通知的收件人、标题、去重键、元数据与摘要里的条数 SHALL 保持不变。通知 SHALL NOT 列出文件名、页码、澄清问题的文字或解析失败原文。

#### Scenario: 两段没读完、复核没做完
- **WHEN** 项目「Halifax 旗帜」的分析完成：12 个文件全部纳入、关键要求 9 条、风险 4 项、待澄清 6 条；要说的事项为「内容没读完（2 段）」与「复核没做完」
- **THEN** 通知摘要为「「Halifax 旗帜」：已分析全部 12 个文件；关键要求 9 条、风险 4 项、待澄清 6 条；这次有地方没做完（有 2 段内容没读完、「项目解读」页的 AI 复核没做完），请先看「招标要求」页里「这次分析有几处没做完」的说明。」，优先级为高
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/alerts.test.ts` 通过

#### Scenario: 没有生成「项目解读」页
- **WHEN** 项目「Halifax 旗帜」的分析完成，没有「项目解读」，要说的事项只有「没有生成「项目解读」页」
- **THEN** 通知摘要为「「Halifax 旗帜」：这次有地方没做完（没有生成「项目解读」页），请先看「招标要求」页里「这次分析有几处没做完」的说明。」，优先级为高
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/alerts.test.ts` 通过

#### Scenario: 复核做完并标了需人工复核，另有一段没读完
- **WHEN** 分析完成，复核得到结果并标了需人工复核，要说的事项只有「内容没读完（1 段）」
- **THEN** 通知摘要以「AI 审校标记了需要人工复核的地方，请优先查看；这次有地方没做完（有 1 段内容没读完），请先看「招标要求」页里「这次分析有几处没做完」的说明。」结尾，优先级为高
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/alerts.test.ts` 通过

#### Scenario: 没有没做完的地方
- **WHEN** 分析完成，没有未完成记录
- **THEN** 通知的收尾句与优先级和本能力上线前相同（既有断言 ALERT-09、ALERT-10 不改、照旧通过）
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/alerts.test.ts` 通过

### Requirement: 完成通知按没做完的轻重定优先级

分析完成的站内通知，按下面的规则定优先级：

- 要说的事项里有「内容没读完」或「没有生成「项目解读」页」时，优先级 SHALL 为高；
- 否则 SHALL 按既有规则：标了需人工复核为高，没标为中；
- 要说的事项为空时，优先级 SHALL 与既有规则相同。

#### Scenario: 只有澄清问题没核对
- **WHEN** 分析完成，没标需人工复核，要说的事项只有「澄清问题没核对（3 条）」
- **THEN** 通知摘要以「这次有地方没做完（有 3 条澄清问题没核对），请先看「招标要求」页里「这次分析有几处没做完」的说明。」结尾，优先级为中
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/alerts.test.ts` 通过

#### Scenario: 内容没读完时标高
- **WHEN** 分析完成，没标需人工复核，要说的事项只有「内容没读完（1 段）」
- **THEN** 通知优先级为高
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/alerts.test.ts` 通过

### Requirement: 完成通知讲文件覆盖时不说错原因

分析完成的站内通知摘要里，讲文件覆盖的那一句：

- 有没纳入的文件时，SHALL 写「已分析 {a}/{u} 个文件（其余 {u−a} 个文件未纳入这次分析）」；
- SHALL NOT 一律写「其余格式不支持逐条溯源」：没纳入的原因也可能是解析失败或超出页数上限，原因由分析面板的覆盖清单说明；
- 全部纳入时，照旧写「已分析全部 {u} 个文件」。

#### Scenario: 有文件没纳入
- **WHEN** 上传 6 个文件、纳入分析 4 个（另外 2 个解析失败）
- **THEN** 通知摘要里讲文件覆盖的那一句为「已分析 4/6 个文件（其余 2 个文件未纳入这次分析）」，摘要里没有「格式不支持」
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/alerts.test.ts` 通过

#### Scenario: 全部纳入
- **WHEN** 上传的 12 个文件全部纳入分析
- **THEN** 那一句仍是「已分析全部 12 个文件」（既有断言 ALERT-09 照旧通过）
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/alerts.test.ts` 通过

### Requirement: 没有未完成记录的分析显示不变

摘要 JSON 里没有未完成记录的分析（包括本能力上线前已存的全部分析）SHALL 与上线前显示得相同：

- 分析状态那一栏下面没有新增的那一块；
- 投标合规矩阵顶部没有新增的那一句；
- 复核横幅按既有规则；
- 分析详情接口的 `incompleteNotes` 为 `null`。

系统 SHALL NOT 解析旧分析里已存的文字（局限说明、复核记录）去推断哪里没做完。

#### Scenario: 旧分析
- **WHEN** 一份上线前落库的分析，复核当时没做完，已存的复核记录里带英文错误码
- **THEN** 接口返回的 `incompleteNotes` 为 `null`，横幅仍是「部分结论未通过 AI 质检，需人工重点复核（详见 QA 记录 N 条）。」
- **AND** 测试 `npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 通过

### Requirement: 说明文字查表得出，不含内部信息，不出站，不改分析过程

**查表得出**：本能力新增或改写的全部句子，SHALL 由固定模板按未完成记录填入段数、位置、条数得出。系统 SHALL NOT 为此发起任何模型调用，SHALL NOT 让模型生成或改写这些句子。

**不含内部信息**：这些句子 SHALL NOT 含下面这些内容：
- 英文错误码、模型名称；
- 「窗口」「截止」「检查点」「切片」等内部用词；
- 「综合」二字（与 AI 任务详情页上数字员工的「综合汇总」分开）；
- 毛利率、项目估值、我方最终报价。

**不出站**：
- 本能力 SHALL NOT 产生任何新的对外发送。
- 这些句子 SHALL NOT 进入 Muse 通道；本能力不新增、不改动任何 Muse 事件与意图的文字。
- 这些句子 SHALL NOT 写进澄清问题的问题文字或理由文字。
- 这些句子 SHALL NOT 出现在发给采购方的任何文档或邮件草稿里：RFI 导出、「向业主提问」起草的邮件。

**不改分析过程**：本能力 SHALL NOT 改变分析过程本身。重试次数、各阶段门槛、何时让出、被跳过的内容、被记为未解决的澄清问题，都与改动前相同。

#### Scenario: 句子里没有内部用词
- **WHEN** 生成本能力的每一种句子：那一块的标题与四种行、复核横幅、矩阵那一句、通知的四个短语与收尾句、文件覆盖那一句的括号
- **THEN** 每一句去掉填入的文件名、单元标签与项目名之后：
  - 都不含「窗口」「截止」「检查点」「切片」「综合」；
  - 不含由大写字母与下划线组成的错误码（如 `CALL_DEADLINE_EXCEEDED`）；
  - 不含模型名称。
- **AND** 测试 `npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 通过

#### Scenario: 落库的澄清问题文字不变
- **WHEN** 一条澄清问题的核对没有得到结果，分析落库
- **THEN** 这条澄清问题落库的问题文字与理由文字，和不记录时逐字相同
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/v2-incomplete.test.ts` 通过

#### Scenario: 不增加模型调用
- **WHEN** 同一份输入、同一批模型输出，分别在改动前后的代码上跑完分片续跑
- **THEN** 模型调用的次数与顺序相同
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/v2-resumable.test.ts` 与 `npx tsx src/lib/tender-auto-analysis/__tests__/v2-slice-deadline.test.ts` 照旧通过
