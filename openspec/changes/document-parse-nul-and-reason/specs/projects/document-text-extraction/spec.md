# Spec Delta

## Purpose

规定项目文件（PDF、Word、Excel、CSV、纯文本）解析出的文字怎样写入数据库、解析失败时怎样记下并显示原因，使解析库产出的不可入库字符不再让整份文件失败。

## ADDED Requirements

### Requirement: 解析出的文字入库前清掉不可入库的字符

系统把解析出的文字写入数据库之前（逐页文字、整份文字、表格与文本块单元，两条解析路径都一样），SHALL 把每个 U+0000 换成一个空格、把每个落单的 UTF-16 代理字符换成 U+FFFD，其余字符 SHALL 原样保留。PDF 页面 SHALL 先清理再判断「近乎空白 / 需要 OCR」。

#### Scenario: 勾选框被抽成 U+0000 的页面
- **WHEN** 一份 PDF 的第 2 页抽出「…check the box.\n\u0000 The Bidder declare…」
- **THEN** 该文件解析状态为「done」，第 2 页入库的文字为「…check the box.\n  The Bidder declare…」，库里该文件的任何文字都不含 U+0000
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/page-parse-nul-db.isolated.test.ts` 通过

#### Scenario: 落单代理字符
- **WHEN** 解析出的文字含一个没有配对的高位代理字符
- **THEN** 该字符入库为 U+FFFD，文件解析状态为「done」
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text.test.ts` 通过

#### Scenario: 整页都是 U+0000
- **WHEN** 一页抽出的文字只由 U+0000 组成
- **THEN** 该页按近乎空白处理（标为需要 OCR），文件不因此失败

#### Scenario: 普通文字不变
- **WHEN** 解析出的文字不含 U+0000 与落单代理字符（含中文、制表符、换行、成对的代理字符如表情符号）
- **THEN** 入库的文字与解析出的文字逐字相同

### Requirement: 解析失败记下原因

文件解析失败时，系统 SHALL 把文件解析状态记为「failed」并在 `parseError` 里记下原因（不超过 500 字）；同一文件下一次解析开始时 SHALL 清掉上一次的原因，成功后 SHALL 为空。

#### Scenario: 失败有原因
- **WHEN** 一份文件的解析或写库失败
- **THEN** 该文件 `parseStatus = failed` 且 `parseError` 非空

#### Scenario: 以前失败的文件重新解析成功
- **WHEN** 一份 `parseStatus = failed`、`parseError` 记着 22021 报错的文件重新解析（两条解析路径任意一条）并成功
- **THEN** 该文件 `parseStatus = done` 且 `parseError` 为空
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/page-parse-nul-db.isolated.test.ts` 通过

### Requirement: 项目文件列表显示解析失败的原因

项目文件列表里解析失败的文件 SHALL 在该行下方显示 `parseError` 的全文（不截断）；没有记录原因时 SHALL 只显示「解析失败」。SHALL NOT 把 `parseError` 放进任何模型提示、Muse 通道或通知。

#### Scenario: 失败原因全文可见
- **WHEN** 一份文件解析失败，`parseError` 为一段 300 字的数据库报错
- **THEN** 文件行下方显示这 300 字全文，不需要鼠标悬停
