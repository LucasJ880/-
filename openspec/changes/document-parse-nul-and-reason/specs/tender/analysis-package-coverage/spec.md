# Spec Delta

## Purpose

规定招标分析的文件覆盖清单：上传、纳入、排除各多少，每个被排除的文件为什么没纳入；解析失败的文件给出系统记下的失败原文，使人不用问就知道文件为何被排除。

## ADDED Requirements

### Requirement: 覆盖清单的逐文件排除明细带解析失败原文

招标分析的文件覆盖清单里，每个因解析失败被排除的文件 SHALL 带上该文件当前 `parseError` 的原文；其它原因（格式不支持、超出页数上限）被排除的文件该字段 SHALL 为空。分析详情、投标简报、工作台汇总三个接口返回的覆盖清单 SHALL 带这个字段。

#### Scenario: 解析失败的文件带原文
- **WHEN** 项目上传 6 个文件，其中 2 个 `parseStatus = failed`、`parseError` 为「Invalid `prisma.projectDocumentPage.createMany()` invocation: … 22021 …」
- **THEN** 覆盖清单为「上传 6 · 纳入分析 4 · 排除 2」，两个排除明细的排除原因为「文件解析失败」、解析失败原文为各自的 `parseError`
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts` 通过

#### Scenario: 其它原因不带原文
- **WHEN** 一个文件因超出 80 页上限被排除
- **THEN** 它的解析失败原文为空

### Requirement: 分析面板显示解析失败原文

分析面板「上传 · 纳入分析 · 排除」下面的逐文件明细，对解析失败的文件 SHALL 显示「〈文件名〉 · 未纳入：文件解析失败（原因：〈parseError 原文〉）」；没有记录原因时 SHALL 显示「（原因：系统未记录原因）」。分析结果里「排除 K（原因）」展开后的列表 SHALL 按同样的写法显示，原文取该文件当前的记录。

#### Scenario: 面板上看到原因
- **WHEN** 打开「12-3 Indoor Canadian Flag」的分析面板，两份附录 B 解析失败
- **THEN** 两行都写「未纳入：文件解析失败（原因：…）」，括号里是各自 `parseError` 的原文

#### Scenario: 原因缺失
- **WHEN** 一个解析失败的文件 `parseError` 为空
- **THEN** 该行写「未纳入：文件解析失败（原因：系统未记录原因）」

### Requirement: 解析失败原文不进模型与对外通道

覆盖清单里的解析失败原文 SHALL NOT 写进分析结果里保存的综合解读（覆盖块只保留既有字段），SHALL NOT 出现在任何模型提示、Muse 通道或通知里。

#### Scenario: 综合解读的覆盖块不带原文
- **WHEN** 一次分析完成并保存综合解读
- **THEN** 保存的覆盖块里被排除文件只有文件名、类型、解析状态、内容指纹就绪、页数、排除原因六项
