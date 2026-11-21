# Spec Delta

## Purpose

规定项目文件（PDF、Word、Excel、CSV、纯文本）解析出的文字怎样写入数据库、解析失败时怎样记下并显示原因，使解析库产出的不可入库字符不再让整份文件失败。

## ADDED Requirements

### Requirement: 解析出的文字入库前清掉不可入库的字符

系统把解析出的文字写入数据库之前（逐页文字、整份文字、表格与文本块单元及其标签，两条解析路径都一样），SHALL 把每个 U+0000 换成一个空格、把每个落单的 UTF-16 代理字符换成 U+FFFD，其余字符 SHALL 原样保留；按字数截断或切块之后 SHALL 再清理一遍。PDF 页面 SHALL 先清理再判断「近乎空白 / 需要 OCR」。清理之后系统 SHALL 照旧去掉整份文字解析的结果、非 PDF 原文与每个单元首尾的空白，近乎空白的页面只存去掉首尾空白后的文字。报价成本表导入读取 PDF 时用的是同一套逐页取字，它拿到的页面文字 SHALL 同样是清理过的。

#### Scenario: 勾选框被抽成 U+0000 的页面
- **WHEN** 一份 PDF 的第 2 页抽出「…check the box.\n\u0000 The Bidder declare…」
- **THEN** 该文件解析状态为「done」，第 2 页入库的文字为「…check the box.\n  The Bidder declare…」，库里该文件的任何文字都不含 U+0000
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/page-parse-nul-db.isolated.test.ts` 通过

#### Scenario: 落单代理字符
- **WHEN** 解析出的文字含一个没有配对的高位代理字符，或按字数截断、切块、取单元标签时把一对代理字符劈开
- **THEN** 落单的那个字符入库为 U+FFFD，文件解析状态为「done」
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text.test.ts` 与 `npx tsx src/lib/tender-auto-analysis/__tests__/page-parse-nul-db.isolated.test.ts` 通过

#### Scenario: 整页都是 U+0000
- **WHEN** 一页抽出的文字只由 U+0000 组成
- **THEN** 该页按近乎空白处理（标为需要 OCR，入库的文字为空），文件不因此失败；页级解析的整份文字不含这一页，整份文字解析的结果首尾不留下这一页换出来的空格
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/page-parse-nul-db.isolated.test.ts` 通过

#### Scenario: 表格里的 U+0000
- **WHEN** 一份 Excel 或 CSV 的某个单元格里有一个 U+0000
- **THEN** 两条解析路径都把文件解析为「done」，该单元格入库时 U+0000 为空格，同一行其它内容不变
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/page-parse-nul-db.isolated.test.ts` 通过

#### Scenario: 普通文字不变
- **WHEN** 解析出的文字不含 U+0000 与落单代理字符（含中文、制表符、换行、成对的代理字符如表情符号）
- **THEN** 清理不改动其中任何一个字符
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text.test.ts` 通过

### Requirement: 纯文本与 CSV 按实际编码读取，读不了的写明原因

系统读取纯文本与 CSV 文件时，文件以 UTF-16 的字节序标记开头的 SHALL 按 UTF-16 解码，其余按 UTF-8 解码。解出的文字里有 U+0000、且「U+0000 与无法解码的字符（U+FFFD）」合计超过全部字符的 10% 时，系统 SHALL 把该文件记为解析失败，失败原因为「文本文件不是 UTF-8 编码或含二进制内容，无法读取（请另存为 UTF-8 后重新上传）」，SHALL NOT 把这样的文字当作正文入库或纳入分析。

#### Scenario: 带字节序标记的 UTF-16 文本
- **WHEN** 上传一份带字节序标记的 UTF-16（小端或大端）纯文本，内容是「投标须知 Mandatory: bid bond 10% of the total price.」
- **THEN** 两条解析路径都把文件解析为「done」，入库的文字与原文逐字相同
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/page-parse-nul-db.isolated.test.ts` 通过

#### Scenario: 没有字节序标记的 UTF-16 文本
- **WHEN** 上传一份没有字节序标记的 UTF-16 CSV（按 UTF-8 读出来约一半是 U+0000）
- **THEN** 两条解析路径都把文件记为「failed」，`parseError` 是上面那句原因，没有任何文字入库
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/page-parse-nul-db.isolated.test.ts` 通过

#### Scenario: 没有字节序标记、以中文为主的 UTF-16 文本
- **WHEN** 一份没有字节序标记的 UTF-16 中文文本按 UTF-8 读出来 U+0000 很少、但两成以上是无法解码的字符
- **THEN** 判为读不了，原因同上
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text.test.ts` 通过

#### Scenario: UTF-32 文本
- **WHEN** 上传一份 UTF-32 小端的文本（它的字节序标记也以 UTF-16 小端的标记开头）
- **THEN** 判为读不了，不按 UTF-16 读成「隔一个字一个空格」
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text.test.ts` 通过

#### Scenario: 零星的 U+0000 不算读不了
- **WHEN** 一份 UTF-8 纯文本里只有个别 U+0000（合计不超过全部字符的 10%）
- **THEN** 文件照常解析为「done」，这些 U+0000 入库为空格
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text.test.ts` 与 `npx tsx src/lib/tender-auto-analysis/__tests__/page-parse-nul-db.isolated.test.ts` 通过

#### Scenario: 不含 U+0000 的其它编码
- **WHEN** 上传一份 GBK 编码、不含 U+0000 的文本
- **THEN** 照旧按 UTF-8 读（本能力不识别这类编码，行为与以前相同）

### Requirement: 解析失败记下原因

文件解析失败时，系统 SHALL 把文件解析状态记为「failed」并在 `parseError` 里记下原因（不超过 500 字，写入前同样清掉不可入库的字符）；同一文件下一次解析开始时 SHALL 清掉上一次的原因，成功后 SHALL 为空。

#### Scenario: 失败有原因
- **WHEN** 一份文件的解析失败（例如没有字节序标记的 UTF-16 文本），而它上一次失败留下的是另一段原因
- **THEN** 该文件 `parseStatus = failed`，`parseError` 非空、不超过 500 字，是这一次的原因
- **AND** 一段 700 字、带 U+0000 的报错写入时被截到 500 字、U+0000 换成空格（测试 `npx tsx src/lib/files/__tests__/extracted-text.test.ts`）
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/page-parse-nul-db.isolated.test.ts` 通过

#### Scenario: 以前失败的文件重新解析成功
- **WHEN** 一份 `parseStatus = failed`、`parseError` 记着 22021 报错的文件重新解析（两条解析路径任意一条）并成功
- **THEN** 该文件 `parseStatus = done` 且 `parseError` 为空
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/page-parse-nul-db.isolated.test.ts` 通过

#### Scenario: 不提取文字的文件类型
- **WHEN** 一份图片文件上一次留着失败原因，整份文字解析再处理它
- **THEN** 该文件 `parseStatus = done`，`parseError` 为空
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/page-parse-nul-db.isolated.test.ts` 通过

### Requirement: 项目文件列表显示解析失败的原因

项目文件列表里解析失败的文件 SHALL 在该行下方显示一行「原因：〈`parseError` 全文〉」（去掉首尾空白，不截断，中间的换行保留，不需要鼠标悬停）；没有记录原因时 SHALL 显示「原因：系统未记录原因」；不是解析失败状态的文件 SHALL NOT 显示这一行。行内的状态文字只写「解析失败」。系统 SHALL NOT 因这项显示把 `parseError` 送进任何模型提示、Muse 通道或通知。

#### Scenario: 失败原因全文可见
- **WHEN** 一份文件解析失败，`parseError` 为一段 300 字、带换行的数据库报错
- **THEN** 文件行下方显示「原因：」加这 300 字全文
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts` 通过

#### Scenario: 没有记录原因
- **WHEN** 一份解析失败的文件 `parseError` 为空或只有空白
- **THEN** 文件行下方显示「原因：系统未记录原因」

#### Scenario: 不是失败状态
- **WHEN** 一份文件正在解析或已解析成功，但 `parseError` 里还留着旧文字
- **THEN** 文件行下方不显示原因
