# Spec Delta

## Purpose

规定招标文件包由哪些文件组成：只纳入用户经项目文件上传进来的文件。系统自己生成的文件、报价导入的供应商报价、外部系统带来的外部链接都不算招标文件。就绪判断与内容指纹只算纳入的文件；读招标全文的其它地方用同一口径；已经误纳入这些文件的旧分析要写明它们不该在里面。

## ADDED Requirements

### Requirement: 招标文件包只纳入用户上传的文件

系统为一个项目确定招标文件包时，SHALL 只从经项目文件上传进来的文件里选。这一规则对所有入口都适用：一键 AI 分析建分析清单、分析面板的「分析投标文件」与「重新分析当前投标文件包」、上传之后的自动入队、执行摘要计算当前文件包。

以下文件 SHALL NOT 进入文件包：
- 「一键生成文档」与其它生成入口产出的文件：投标分析师备忘录、国内供应商简报、国内供应商询价、供应商技术确认表、内部项目分析、同事执行任务单、RFI 问题清单、投标文件起草。
- 客户报价 PDF。
- 投标准备清单。
- 报价工具导入的供应商报价。
- 外部系统建项时带来的外部链接文件。
- 今后任何不是经项目文件上传写入的文件。

上传文件的既有纳入规则不变：文件类型、解析状态、单文件页数上限、只作补遗的文件、内容指纹。

#### Scenario: 生成的国内供应商简报不再被当成主文件（12-3 复现）
- **WHEN** 一个投标项目有两份上传的招标 PDF（「RFP Window Coverings.pdf」「Addendum 1.pdf」，已解析、有内容指纹），另有一份「一键生成文档」生成的「China Supplier Sourcing Brief v1」（PDF、已解析、有内容指纹）
- **THEN** 文件包只有两份上传文件，没有生成文件
- **AND** 不出现「两份以上文件被判为主文件」的分类歧义提示
- **AND** 测试 `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/tender-auto-analysis/__tests__/package-source-db.isolated.test.ts` 通过（隔离库；同一测试在改动前的代码上失败）

#### Scenario: 一键 AI 分析的分析清单不含生成文件
- **WHEN** 对上一个场景的项目发起一键 AI 分析，校验输入这一步建分析清单
- **THEN** 清单只有两份上传文件
- **AND** 测试 `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/tender-workforce/__tests__/t1b-integration.test.ts` 通过

#### Scenario: 报价导入的供应商报价不进文件包
- **WHEN** 项目里有一份经报价工具导入的供应商报价表（xlsx、已解析、有内容指纹）和一份上传的招标 PDF
- **THEN** 文件包只有上传的招标 PDF

#### Scenario: 外部链接文件不再让整次入队失败
- **WHEN** 外部系统建项时带来一份文件类型为 pdf 的外部链接（没有存储内容、没有内容指纹、待解析），项目另有一份上传的招标 PDF（已解析、有内容指纹）
- **THEN** 文件包只有上传的那份，入队不因「缺少内容指纹」失败
- **AND** 改动前同一项目的入队以「投标 PDF 缺少内容指纹」失败（同一隔离库测试断言改动前失败）

#### Scenario: 项目里只有系统生成的文件
- **WHEN** 项目里只有生成文件和投标准备清单，没有上传文件
- **THEN** 文件包为空，各分析入口按既有的「没有可分析的投标文件」结果处理，不建分析

### Requirement: 就绪判断与内容指纹只算上传文件

自动入队判断文件包是否就绪时，系统 SHALL 只看用户上传的文件。非上传文件不论处在哪种解析状态，SHALL NOT 让结果变成「仍在处理」或「缺内容指纹」，也 SHALL NOT 计入就绪的文件数。

文件包的内容指纹 SHALL 只由纳入的上传文件算出。以下动作 SHALL NOT 改变文件包的内容指纹，SHALL NOT 让执行摘要把现有分析显示为过期：
- 在项目里生成文件
- 生成投标准备清单
- 生成客户报价 PDF
- 导入供应商报价

选文件时，系统 SHALL NOT 读取非上传文件的存储内容，SHALL NOT 给它们补写内容指纹。

#### Scenario: 待解析的外部链接不挡就绪
- **WHEN** 项目有一份已解析的上传 PDF 和一份待解析的外部链接 PDF
- **THEN** 就绪判断为已就绪，文件数为 1
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/package-ready.test.ts` 通过

#### Scenario: 分析完成之后再生成文件
- **WHEN** 一份分析完成之后，在「一键生成文档」里生成国内供应商简报
- **THEN** 当前文件包的内容指纹仍等于这份分析的指纹，执行摘要不把它显示为过期

#### Scenario: 不给生成文件补写内容指纹
- **WHEN** 一份生成文件没有内容指纹、有存储地址且存储里真有这个文件
- **THEN** 确定文件包之后，这份文件的内容指纹仍为空，也不在文件包里
- **AND** 测试 `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/tender-auto-analysis/__tests__/package-source-db.isolated.test.ts` 通过

#### Scenario: 已经纳入生成文件的旧分析显示为过期
- **WHEN** 一份分析的文件清单里有生成文件，项目的上传文件没有变
- **THEN** 当前文件包的内容指纹与这份分析的指纹不同，执行摘要把这份分析显示为过期

#### Scenario: 旧流程自动入队对受影响项目只多建一份
- **WHEN** 旧流程的自动入队开关开着、没有改派到一键 AI 分析，项目的最新分析（等待审核或已批准）清单里有生成文件，文件流水线处理完毕触发自动入队
- **THEN** 新建一份只含上传文件的完整分析
- **AND** 这一份还在进行或等待审核时再触发自动入队，复用这一份，不再新建

### Requirement: 覆盖清单的计数与新分析的文件列表一致

招标分析的覆盖清单「上传 N · 纳入分析 M」SHALL 只计用户上传的文件，这与改动前相同。新建的分析，其文件列表里 SHALL 只有用户上传的文件，覆盖清单不计的文件 SHALL NOT 出现在文件列表里。

#### Scenario: 混合来源的项目
- **WHEN** 项目有 2 份上传的招标 PDF、1 份生成文件、1 份报价导入文件、1 份投标准备清单，对它新建一份分析并完成
- **THEN** 覆盖清单为「上传 2 · 纳入分析 2」，分析的文件列表恰好是这 2 份上传文件
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts` 通过

### Requirement: 读招标全文的其它地方用同一口径

以下读取 SHALL 只取用户上传的文件：
- 生成项目情报时读取的文件
- 分析师备忘录（v2）的全文语料
- agent「标书分析」技能的文件清单

在 agent「标书分析」技能的文件清单里，非上传文件 SHALL 标为排除，排除原因为 `SYSTEM_GENERATED`。上传文件在清单里的判定 SHALL 与改动前相同。业主回复匹配 SHALL 只在用户上传的文件里找候选，这与改动前相同。

#### Scenario: agent 标书分析技能排除生成文件与报价导入
- **WHEN** 技能的文件清单里有一份上传的招标文件、一份生成文件、一份报价导入文件
- **THEN** 生成文件与报价导入文件被标为排除，原因 `SYSTEM_GENERATED`；上传的招标文件照旧纳入
- **AND** 测试 `npx tsx src/lib/tender-understanding/__tests__/input-completeness.test.ts` 通过

#### Scenario: 已被解析过的生成文件不进备忘录语料与项目情报
- **WHEN** 一份生成文件此前已被页级解析过（有页面行与正文），之后生成分析师备忘录或刷新项目情报
- **THEN** 备忘录的全文语料里没有它的页面，项目情报的输入里没有它
- **AND** 测试 `npx tsx src/lib/files/__tests__/document-source.test.ts` 通过（含这两处读取的接线断言）

### Requirement: 旧分析里不该纳入的文件写明

分析详情接口返回的文件列表里，不是用户上传的文件 SHALL 带角色标签「不是上传的招标文件（重新分析后不再纳入）」，SHALL NOT 标「主文件」或其它招标文件角色。上传文件的角色标签 SHALL 与改动前相同：补遗、附件、报价、表格、图纸、未分类、主文件。分析记录里保存的角色值不改。

#### Scenario: 打开 12-3 那份旧分析
- **WHEN** 打开一份文件清单里有「China Supplier Sourcing Brief v1」（生成文件，记录时角色为主文件）的旧分析
- **THEN** 文件列表里这一行显示「China Supplier Sourcing Brief v1 · 不是上传的招标文件（重新分析后不再纳入）」
- **AND** 两份上传文件的标签与改动前相同
- **AND** 测试 `npx tsx src/lib/files/__tests__/document-source.test.ts` 通过

### Requirement: 系统生成文件里的我方报价与估值不经文件包进入分析

部分系统生成的文件写有我方报价、预估金额、中标价，或者报价合计：「内部项目分析」写的是前三项，客户报价 PDF 写的是报价合计。这些内容 SHALL NOT 经招标文件包进入以下任何一处：
- 分析结果（事实、要求、章节、澄清、交付物）
- 综合解读
- 分析师备忘录的全文语料
- 项目情报的输入

分析详情接口对非上传文件 SHALL 只改角色标签的值，不新增字段；SHALL NOT 返回这些文件的正文、来源值或存储地址。

#### Scenario: 内部项目分析不进分析
- **WHEN** 项目里有一份「内部项目分析 v1」（PDF、已解析，正文含「我方报价：…」「中标价：…」）和一份上传的招标 PDF，对项目发起分析
- **THEN** 分析纳入的文件里没有这份内部项目分析，分析读到的页面里也没有它的任何页面
- **AND** 测试 `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/tender-auto-analysis/__tests__/package-source-db.isolated.test.ts` 通过

#### Scenario: 分析详情接口不带出来源与正文
- **WHEN** 打开一份文件清单里有非上传文件的旧分析
- **THEN** 接口返回的文件列表里每一项的字段与改动前相同（文档编号、角色、角色标签、标题、页数），没有来源值、正文或存储地址
- **AND** 测试 `npx tsx src/lib/files/__tests__/document-source.test.ts` 通过

### Requirement: 只有项目文件上传接口把文件记为用户上传

项目文件上传接口写入的文件 SHALL 记为用户上传。以下写入文件的入口 SHALL NOT 把文件记为用户上传：
- 一键生成与其它生成入口
- 客户报价 PDF
- 投标准备清单
- 报价工具导入
- 外部系统建项

外部系统建项不写来源时，沿用库里的默认值「外部链接」。

#### Scenario: 写入入口的来源值
- **WHEN** 检查六个写入文件的入口
- **THEN** 只有项目文件上传接口写「用户上传」
- **AND** 生成文件写 `generated`，客户报价 PDF 写 `generated_customer_quotation`，投标准备清单写 `ai_checklist`，报价导入写 `quote_import`
- **AND** 外部系统建项不写来源
- **AND** 测试 `npx tsx src/lib/files/__tests__/document-source.test.ts` 通过
