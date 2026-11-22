# Spec Delta

## Purpose

规定招标分析的文件覆盖清单：上传、纳入、排除各多少，每个被排除的文件为什么没纳入；解析失败的文件给出系统记下的失败原文，使人不用问就知道文件为何被排除、下一步怎么办。

## ADDED Requirements

### Requirement: 覆盖清单的逐文件排除明细带解析失败原文

招标分析的文件覆盖清单里，每个因解析失败被排除的文件 SHALL 带上该文件当前 `parseError` 的原文（去掉首尾空白）；其它原因（格式不支持、超出页数上限）被排除的文件该字段 SHALL 为空。分析详情接口返回的覆盖清单 SHALL 带这个字段；投标简报、工作台汇总两个接口返回的覆盖清单里这个字段 SHALL 恒为空（它们只用计数与说明，不显示原文）。

#### Scenario: 解析失败的文件带原文
- **WHEN** 项目上传 6 个文件，其中 2 个 `parseStatus = failed`、`parseError` 为「Invalid `prisma.projectDocumentPage.createMany()` invocation: … 22021 …」
- **THEN** 覆盖清单为「上传 6 · 纳入分析 4 · 排除 2」，两个排除明细的排除原因为「文件解析失败」、解析失败原文为各自的 `parseError`
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts` 通过

#### Scenario: 其它原因不带原文
- **WHEN** 一个文件因超出 80 页上限被排除
- **THEN** 它的解析失败原文为空
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts` 通过

#### Scenario: 不显示原文的接口不带原文
- **WHEN** 投标简报或工作台汇总接口返回一份有解析失败文件的覆盖清单
- **THEN** 清单的计数、说明与排除原因的标签不变，每个被排除文件的解析失败原文都为空
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts` 通过

### Requirement: 分析面板显示解析失败原文与下一步

投标包 AI 体验开启时，分析面板「上传 · 纳入分析 · 排除」下面的逐文件明细，对解析失败的文件 SHALL 显示「〈文件名〉 · 未纳入：文件解析失败（原因：〈parseError 原文〉）」；没有记录原因时 SHALL 显示「（原因：系统未记录原因）」。清单里只要有解析失败的文件，面板 SHALL 在清单下面加一句「解析失败的文件 AI 没有读到。原因里写了怎么处理的，先照着做；没写的，请到右上角「项目文件」里重新处理，再回到这里重新分析；仍然失败请把上面的原因发给管理员。」；没有解析失败的文件时 SHALL NOT 显示这句话。

分析结果里「排除 K（原因）」展开后的列表（内容来自分析完成时保存的清单），对解析失败的文件 SHALL 在「文件解析失败」后面按同样的写法带上原因，原文取该文件当前的记录；该文件当前已经不在解析失败之列时，SHALL 显示「文件解析失败（这是上次分析时的情况；文件之后已重新处理或已删除，重新分析后这里会更新）」。展开列表按文件名对应当前的记录：两个同名的解析失败文件 SHALL 显示同一段原因（后一个文件的）。

#### Scenario: 面板上看到原因
- **WHEN** 打开一个项目的分析面板，两份附录 B 解析失败
- **THEN** 两行都写「未纳入：文件解析失败（原因：…）」，括号里是各自 `parseError` 的原文；清单下面有「解析失败的文件 AI 没有读到。原因里写了怎么处理的，先照着做…」这句话
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts` 通过

#### Scenario: 原因缺失
- **WHEN** 一个解析失败的文件 `parseError` 为空
- **THEN** 该行写「未纳入：文件解析失败（原因：系统未记录原因）」
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts` 通过

#### Scenario: 分析完成之后文件重新解析成功
- **WHEN** 一份分析完成时两份附录 B 解析失败，之后这两份文件重新解析成功、还没有重新分析
- **THEN** 这份分析的「排除 K（原因）」展开列表里这两行写「文件解析失败（这是上次分析时的情况；文件之后已重新处理或已删除，重新分析后这里会更新）」，不带「（原因：…）」；面板清单下面写「有 2 个能读的文件还没纳入这次分析，重新分析后会一起纳入。」
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts` 通过

#### Scenario: 只有其它原因的排除
- **WHEN** 被排除的文件都是格式不支持或超出页数上限
- **THEN** 每行照旧只写排除原因，清单下面不出现「解析失败的文件 AI 没有读到…」这句话
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts` 通过

#### Scenario: 两个同名的解析失败文件
- **WHEN** 一份分析的展开列表里有两个同名的解析失败文件，各自的原因不同
- **THEN** 两行显示同一段原因（后一个文件的）；这份清单在分析完成时只按文件名保存，分不出是哪一份
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts` 通过

### Requirement: 分析面板提醒还没纳入的能读文件

投标包 AI 体验开启时，能读的文件数（上传里格式支持、没有解析失败、没有超出页数上限的）比这次纳入分析的多 N 个时，分析面板 SHALL 在覆盖清单下面加一句「有 N 个能读的文件还没纳入这次分析，重新分析后会一起纳入。」；不多时 SHALL NOT 显示。

#### Scenario: 能读的文件比纳入的多
- **WHEN** 能读的文件有 6 个、这次分析纳入了 4 个（不论另外有没有被排除的文件）
- **THEN** 面板清单下面写「有 2 个能读的文件还没纳入这次分析，重新分析后会一起纳入。」；能读的不比纳入的多时不出现这句
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts` 通过（含分析面板接线的断言）

### Requirement: 解析失败原文不进模型与对外通道

覆盖清单里的解析失败原文 SHALL NOT 写进分析结果里保存的综合解读（覆盖块只保留既有字段）；系统 SHALL NOT 因覆盖清单带了这个字段而把它送进任何模型提示、Muse 通道或通知。

#### Scenario: 综合解读的覆盖块不带原文
- **WHEN** 一次分析完成并保存综合解读
- **THEN** 保存的覆盖块里被排除文件只有文件名、类型、解析状态、内容指纹就绪、页数、排除原因六项，序列化后不含失败原文
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts` 通过
