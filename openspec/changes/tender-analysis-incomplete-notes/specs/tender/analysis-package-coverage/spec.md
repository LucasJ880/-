# Spec Delta

## MODIFIED Requirements

### Requirement: 分析面板提醒还没纳入的能读文件

投标包 AI 体验开启时，能读的文件数（上传里格式支持、没有解析失败、没有超出页数上限的）比这次纳入分析的多 N 个时，分析面板 SHALL 在覆盖清单下面加一句「有 N 个能读的文件还没纳入这次分析，重新分析后会一起纳入。」；不多时 SHALL NOT 显示。

覆盖清单下面的提示（这一句与「解析失败的文件 AI 没有读到。…」那一句）SHALL 只讲文件有没有纳入这次分析。已纳入的文件里没读完的内容段、没有生成的「项目解读」、没做完的复核、没核对成的澄清问题 SHALL NOT 写进覆盖清单或这两句提示，由运行头部正下方「这次分析有几处没做完」那一块另外说明（能力 `tender/analysis-incomplete-notes`）；覆盖清单与这两句提示的文字、显示条件 SHALL 保持不变。

#### Scenario: 能读的文件比纳入的多
- **WHEN** 能读的文件有 6 个、这次分析纳入了 4 个（不论另外有没有被排除的文件）
- **THEN** 面板清单下面写「有 2 个能读的文件还没纳入这次分析，重新分析后会一起纳入。」；能读的不比纳入的多时不出现这句
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts` 通过（含分析面板接线的断言）

#### Scenario: 文件没纳入与内容段没读完同时出现
- **WHEN** 投标包 AI 体验开启，两份附录 B 解析失败被排除，已纳入的《RFP.pdf》第 5–8 页那一段没读完
- **THEN** 覆盖清单与它下面的提示只讲两份附录 B，不提《RFP.pdf》第 5–8 页；那一段只出现在运行头部正下方「这次分析有几处没做完」那一块
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts` 与 `npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 通过（含分析面板接线的断言）
