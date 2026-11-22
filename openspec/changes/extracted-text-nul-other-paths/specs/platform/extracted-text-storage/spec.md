# Spec Delta

## Purpose

规定项目文件以外的五个入口——供应商询价回信、采购记录附件、AI 对话附件（含由消息文字或附件名生成的对话标题）、产品资料录入、报价成本表导入——从文件、邮件或网页抽出的文字与按字数截断出的文字，在送进模型、核对证据、比对与写入数据库之前怎样清掉不可入库的字符（U+0000 与落单的 UTF-16 代理字符），使这两类字符不再让写库失败、也不再让证据核对对不上。项目文件的两条解析路径见 `projects/document-text-extraction`。

## ADDED Requirements

### Requirement: 清理规则

本能力里的每一处清理 SHALL 与项目文件解析用同一条规则：每个 U+0000 换成一个空格，每个落单的 UTF-16 代理字符换成 U+FFFD，其余字符（成对的代理字符、中文、制表符、换行）原样保留，清理前后字数相同。不含这两类字符的文字 SHALL 逐字不变。JSON 形状的数据（报价成本表的抽取结果与复核数据、采购记录的明细）SHALL 对其中每一个字符串（含键名）按这条规则清理，结构与非字符串的值不变。

#### Scenario: 普通文字不变
- **WHEN** 五个入口处理的文字不含 U+0000 与落单代理字符（含中文、表情符号、制表符、换行）
- **THEN** 送进模型的提示、写入数据库的内容与对话标题与改动前逐字相同
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts`、`npx tsx src/lib/tender-rfq/__tests__/inbound-parse.test.ts`、`npx tsx src/lib/tender-rfq/__tests__/inbound-apply.test.ts`、`npx tsx src/lib/trade/__tests__/chat-attachments.test.ts`、`npx tsx src/lib/quote-engine/__tests__/quote-import.test.ts`、`npx tsx src/lib/procurement-records/__tests__/disclosure-analysis-pure.test.ts` 通过

#### Scenario: JSON 形状的数据
- **WHEN** 一份数据的键名与嵌套数组里的字符串含 U+0000 与落单高位代理字符，另有数字、布尔值与 null
- **THEN** 每个字符串按清理规则替换，数字、布尔值、null 与层级结构不变
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text.test.ts` 通过

### Requirement: 清理不扩大对外内容

清理 SHALL 只替换字符。系统 SHALL NOT 因本能力在通知、Muse 事件或审计里新增回信正文、附件文字或证据片段，SHALL NOT 新增模型调用，SHALL NOT 新增任何对外发送；询价回信入表后照常发的既有通知与 Muse 事件 SHALL NOT 含证据片段、附件文字、毛利率、项目估值与我方最终报价。

#### Scenario: 入表后的通知与审计
- **WHEN** 一封附件里有勾选框（被抽成 U+0000）的报价回信经清理后入表
- **THEN** 这次新增的通知标题与摘要里没有附件文字与证据片段；这封回信的审计只有结构化字段与证据片段，没有邮件正文与附件全文
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts` 通过

### Requirement: 询价回信的附件文字先清理再判断有没有文字

系统处理供应商询价回信时，SHALL 先清理每个附件抽出的文字与附件文件名，再判断该附件有没有可提取的文字；清理后只剩空白的附件 SHALL 记为「附件无可提取文本（可能是扫描件）」，SHALL NOT 记为已解析。之后用到附件文件名的地方（送进模型的附件清单、报价备注里的附件一栏）SHALL 都是清理后的文件名。

#### Scenario: 只有 U+0000 的附件
- **WHEN** 一封回信的 PDF 附件抽出的文字只由 U+0000 与换行组成
- **THEN** 该附件记为未解析，报价备注里写「〈文件名〉 附件无可提取文本（可能是扫描件）」
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 通过

#### Scenario: 附件文件名带 U+0000
- **WHEN** 回信附件的文件名里有一个 U+0000
- **THEN** 送进模型的附件清单与报价备注里，文件名该处为空格
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 通过

### Requirement: 询价回信送进模型的与核对证据的是同一份清理后的文字

系统处理询价回信时，送进模型的回信文字与用来核对证据、币种与起订量的文字 SHALL 是同一份；这份文字与送进模型的整段提示 SHALL NOT 含 U+0000 或落单代理字符，包括在送进模型的字数上限处截断后留下的半个代理对。

#### Scenario: 跨过勾选框的证据
- **WHEN** 回信附一份 PDF，「Unit price CAD 12.50 per flag」与「Delivery 30 days」在同一行、中间的勾选框被抽成 U+0000，模型给出的价格证据在勾选框处写成空格
- **THEN** 价格证据通过核对，单价 12.5 不被作废（改动前这条证据核对不上，价格被作废）
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 通过

#### Scenario: 模型照抄它看到的文字
- **WHEN** 同一封回信，模型把它收到的那一行原样抄作证据
- **THEN** 模型收到的提示里没有 U+0000，抄出的证据通过核对，该家询价条目变为「已报价」，没有「解析失败」审计，也没有「有一封供应商回信解析失败，请手工录入」通知（改动前抄出的证据带 U+0000，写报价备注报 22021，条目停在「已回复」）
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 与 `npx tsx src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts` 通过

#### Scenario: 截断劈开代理对
- **WHEN** 拼好的回信文字恰好在送进模型的字数上限处劈开一个表情符号
- **THEN** 送进模型的回信文字以 U+FFFD 结尾，没有落单代理字符
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 通过

### Requirement: 询价条目的报价备注入库前不含不可入库的字符

系统 SHALL 在写入询价条目报价备注之前清理这次追加的整段内容（证据片段、附件一栏、冲突说明）；写入的报价备注 SHALL NOT 含 U+0000 或落单代理字符。清理后入表的回信 SHALL 照常走既有的状态变化、报价 / 回信通知、Muse 事件与定时检查。

#### Scenario: 证据片段带落单代理字符
- **WHEN** 通过核对的证据片段以一个落单的高位代理字符结尾（原文里它与后一个字组成表情符号）
- **THEN** 报价备注里该字符为 U+FFFD，备注写入成功
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 通过

#### Scenario: 备注真实入库
- **WHEN** 隔离库里一家「已发出」的询价条目收到带勾选框附件的报价回信
- **THEN** 该条目的报价备注入库、不含 U+0000，单价与交期写入，同一封回信再跑一次入站检查不重复处理
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts` 通过

### Requirement: 询价回信附件里有被换掉的 U+0000 时在报价备注里注明

询价回信的某个附件抽出的文字里有 U+0000 被换成空格、且该附件仍记为已解析时，系统 SHALL 在报价备注附件一栏该附件的「已解析」之后写「（有 N 处无法识别的符号，可能是勾选框或无法识别的字形，请对照原件核对）」，N 为该附件被换掉的 U+0000 个数；没有 U+0000 的附件 SHALL 照旧只写「已解析」。这句话与个数 SHALL NOT 进入通知、Muse 事件与送进模型的提示，个数只记在报价备注与这封回信的审计里；这句话 SHALL NOT 改变入表、证据核对与比价回读报价备注的结果。

#### Scenario: 附件里一个勾选框
- **WHEN** 回信的 PDF 附件「q.pdf」里一个勾选框被抽成 U+0000，附件其余文字正常
- **THEN** 报价备注附件一栏为「附件：q.pdf 已解析（有 1 处无法识别的符号，可能是勾选框或无法识别的字形，请对照原件核对）」，价格与交期照常入表，送进模型的提示里没有这句话
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 通过

#### Scenario: 附件没有 U+0000
- **WHEN** 回信附件的文字不含 U+0000
- **THEN** 附件一栏与改动前相同，只写「〈文件名〉 已解析」
- **AND** 测试 `npx tsx src/lib/tender-rfq/__tests__/inbound-apply.test.ts` 与 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 通过

#### Scenario: 比价回读不受影响
- **WHEN** 同一段报价备注，一份附件一栏带这句话、一份不带
- **THEN** 比价回读出的起订量、贸易条款、多档价、强制项与缺字段两份相同
- **AND** 测试 `npx tsx src/lib/tender-rfq/__tests__/notes-parse.test.ts` 与 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 通过

### Requirement: 采购记录附件的页面与工作表文字先清理再判断与入库

系统解析采购记录附件时，SHALL 先清理 PDF 每一页抽出的文字，再判断该页是否需要 OCR、再写入解析单元；SHALL 清理 Excel 每个工作表转出的文字、单元标签与记进工作表范围的工作表名。CSV 与纯文本附件 SHALL 保持现有判断：读出的文字含 U+0000 时记为「文件损坏」，原因「文本文件含二进制内容」。

#### Scenario: 勾选框被抽成 U+0000 的披露文件
- **WHEN** 一份披露文件 PDF 的一页抽出「…check the box.\n\u0000 The Bidder declares…」
- **THEN** 附件状态为「已解析」，该页入库文字为「…check the box.\n  The Bidder declares…」（改动前写解析单元报 22021，附件停在「解析中」，定时任务最多重试 5 次后一直停着）
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 与 `npx tsx src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts` 通过

#### Scenario: 只有 U+0000 的页
- **WHEN** 一页抽出 30 个 U+0000、没有别的文字
- **THEN** 该页标为需要 OCR，附件不因此失败
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 通过

#### Scenario: Excel 单元格里的 U+0000
- **WHEN** 一份 xlsx 披露文件某个单元格为「Flag\u0000 nylon」
- **THEN** 附件状态为「已解析」，该工作表的单元文字里这一格为「Flag  nylon」
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts` 通过

#### Scenario: CSV 含 U+0000 的判断不变
- **WHEN** 一份 CSV 附件里有一个 U+0000
- **THEN** 附件状态为「文件损坏」，原因「文本文件含二进制内容」，与改动前相同
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 通过

### Requirement: 采购记录附件抽出的明细入库前不含不可入库的字符

系统从披露文件抽出明细后，写入的每条明细的每个文字字段（原文片段、产品、规格、单号等）SHALL NOT 含 U+0000 或落单代理字符，包括按字数截断后留下的半个代理对；写入后 SHALL 照常更新文件状态并运行按口径分析。

#### Scenario: 原文片段截断劈开代理对
- **WHEN** 一份 xlsx 披露文件里一行带金额的明细拼起来超过 1000 字，第 1000 字处劈开一个表情符号
- **THEN** 这条明细入库，原文片段以 U+FFFD 结尾，状态为待复核，申请的分析照常运行（改动前附件显示「已解析」、明细为零、分析没有运行，之后也不再重试）
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts` 通过

### Requirement: AI 对话附件在服务端收下时清理

系统收到 AI 对话消息带的附件时（主助手、项目「问青砚」、外贸对话），存进消息记录的与送进模型的 SHALL 都是清理后的附件，文件名与正文都 SHALL NOT 含 U+0000 或落单代理字符：新客户端提交的附件列表 SHALL 先清理文件名与正文、再做「有没有可分析的文本」与长度校验；旧客户端只提交的单个文件文字（主助手与项目「问青砚」接受）SHALL 在按字数截断文件名与正文之后清理，不留截断处的半个代理对。新方式下附件正文清理后只剩空白时，系统 SHALL 以 400 拒绝并返回「附件「〈文件名〉」没有可分析的文本内容」，不写消息；旧方式下按没有附件处理。

#### Scenario: 文档附件带 U+0000
- **WHEN** 用户发一条消息，附件正文是勾选框被抽成 U+0000 的 PDF 文字
- **THEN** 消息存下，存下的附件正文里该处为空格（改动前写消息报 22P05，接口返回 500，消息没有存下）
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 与 `npx tsx src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts` 通过

#### Scenario: 附件正文只有 U+0000
- **WHEN** 新客户端提交的附件「a.pdf」正文只由 U+0000 组成
- **THEN** 校验失败，返回「附件「a.pdf」没有可分析的文本内容」
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 通过

#### Scenario: 旧客户端的文字劈开代理对
- **WHEN** 旧客户端只提交文件文字，按 15 万字截断时劈开一个表情符号
- **THEN** 折算出的附件正文以 U+FFFD 结尾
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 通过

#### Scenario: 旧客户端的文件名劈开代理对
- **WHEN** 旧客户端提交的文件名超过 200 字，第 200 字处劈开一个表情符号
- **THEN** 折算出的附件文件名为前 200 字、以 U+FFFD 结尾，消息存下
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 与 `npx tsx src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts` 通过

### Requirement: 对话标题截断后入库前清理

系统用消息文字或附件名（没有文字时为「附件：〈文件名〉」）生成对话标题并按字数截断时（主助手与项目「问青砚」截 60 字、外贸对话截 30 字后加「...」、助手跟进任务截 60 字），写入的标题 SHALL NOT 含 U+0000 或落单代理字符：截断处劈开的半个代理对 SHALL 换成 U+FFFD，标题其余部分与改动前相同。

#### Scenario: 只发附件、文件名在标题截断处劈开表情符号
- **WHEN** 用户在新对话里只发一个附件，「附件：〈文件名〉」的第 60 字处劈开一个表情符号
- **THEN** 对话标题为前 60 字、以 U+FFFD 结尾，标题写入成功（改动前写标题报 `InvalidArg`，这一轮对话报错）
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 与 `npx tsx src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts` 通过

#### Scenario: 外贸对话的标题
- **WHEN** 外贸对话的第一条消息文字在第 30 字处劈开一个表情符号
- **THEN** 对话标题为前 30 字（最后一个为 U+FFFD）加「...」
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 通过

#### Scenario: 每个生成标题的地方都经过清理
- **WHEN** 检查两个对话接口与助手跟进任务的源码
- **THEN** 5 处生成对话标题的地方都经同一处「截断再清理」，没有直接截断后写库的写法
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 通过（接线断言）

### Requirement: 转为市场调研时写入的市场证据入库前不含不可入库的字符

带附件的消息被转为后台市场调研时，写入调研任务输入的「市场证据」SHALL NOT 含 U+0000 或落单代理字符，包括按字数截断后留下的半个代理对。

#### Scenario: 市场证据截断劈开代理对
- **WHEN** 写入调研任务的市场证据恰好在截断处劈开一个表情符号
- **THEN** 调研任务建成（状态「等待研究」），市场证据以 U+FFFD 结尾（改动前这次写库被拒，接口返回 500）
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts` 通过

### Requirement: 产品资料录入的文字先清理再抽取事实

系统从产品资料任务的输入（文件：PDF、Excel；网页；文字；语音转写）抽取产品事实之前，SHALL 先清理这一段文字；抽出的事实的值、规范值、原文行与冲突记录里的值 SHALL NOT 含 U+0000 或落单代理字符，值与原文行照旧去掉首尾空白。

#### Scenario: 规格表里的勾选框
- **WHEN** 一份产品规格 PDF 的一行抽出「\u0000 Color: Red」
- **THEN** 抽出事实「color = Red」，原文行为「Color: Red」，「分析输入」这一步完成，任务状态按缺字段照常变为 `NEEDS_INPUT` 或 `PLAN_READY`（改动前写事实失败，这一步停在进行中，接口返回 500，每次重跑都一样）
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts` 通过

#### Scenario: 每种来源都先清理
- **WHEN** 检查产品资料录入的源码
- **THEN** 文件、网页、文字、语音四种来源的文字都经同一处清理后才进入事实抽取
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 通过（接线断言）

### Requirement: 报价成本表导入的抽取结果入库前不含不可入库的字符

系统导入报价成本表（Excel、CSV、PDF）时，送进 AI 归类的行文字与用来对上可引用单元的工作表名 SHALL 是清理后的文字；写入的抽取结果、复核数据、元数据与供应商名 SHALL NOT 含 U+0000 或落单代理字符，包括抽取与 AI 归类按字数截断后留下的半个代理对。

#### Scenario: Excel 单元格里的 U+0000
- **WHEN** 导入一份 xlsx，说明列某格为「Flag\u0000 nylon 3x5」
- **THEN** 导入状态为「待审核」，该行说明为「Flag  nylon 3x5」（改动前写导入记录报 22P05，显示「抽取失败：…」）
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 与 `npx tsx src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts` 通过

#### Scenario: 说明截断劈开代理对
- **WHEN** 一行说明超过 300 字，第 300 字处劈开一个表情符号
- **THEN** 导入状态为「待审核」，该行说明与原文片段以 U+FFFD 结尾
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 与 `npx tsx src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts` 通过

#### Scenario: 工作表名带 U+0000 时仍能对上可引用单元
- **WHEN** 导入一份 xlsx，工作表名里有一个 U+0000
- **THEN** 该表的行照常带上可引用单元的页号与标签（与项目文件解析清理后的单元标签对得上）
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts` 通过

### Requirement: 报价成本表导入的失败原因入库前收口

报价成本表导入失败时，系统 SHALL 与项目文件解析失败原因同样收口：失败原因不超过 500 字，写入前按清理规则清理。

#### Scenario: 失败原因带落单代理字符
- **WHEN** 导入失败的报错文字在第 500 字处劈开一个表情符号
- **THEN** 导入状态为「失败」，失败原因不超过 500 字、以 U+FFFD 结尾，界面显示「抽取失败：〈原因〉」
- **AND** 测试 `npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 通过（接线断言：写失败原因的那一处经过收口）
