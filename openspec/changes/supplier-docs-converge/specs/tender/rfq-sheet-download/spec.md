# Spec Delta

## Purpose

规定项目页「一键生成文档」里生成并下载的「供应商询价单 PDF」：内容只取自询价单本身、与询价邮件附件同一份模板与检查、哪些情形不生成与接口各返回什么、生成记录怎么记，以及已停用的两类供应商文件与内部文件回落的边界。

## ADDED Requirements

### Requirement: 询价单文件的内容来源
`POST /api/projects/{id}/generate-pdf`（`docType: "supplier_rfq"`）SHALL 生成一份供应商询价单 PDF，内容与发询价时的询价单用同一套规则排出：当前可用招标分析（该项目最新一份等待审核或已批准的分析）里已确认的供应商侧要求与关键事实、组织询价设置里的发件抬头与回复截止提前量、项目的截标日期、对供应商的中性询价编号。发起人填写项（数量阶梯、目的地、范围说明、附加问题）与贸易条款 SHALL 一律为空。起草日期 SHALL 取生成当时组织时区的日期。

#### Scenario: 只收已确认的供应商侧要求
- **WHEN** 项目的当前可用分析里有 3 条已确认的供应商侧要求、1 条已确认的保险类要求、1 条未确认的要求，生成 `supplier_rfq`
- **THEN** 200，询价单里有那 3 条要求的编号与规格，没有保险类与未确认的那两条；抬头是组织询价设置里的发件抬头；贸易条款一栏是「请注明报价贸易条款」（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）

#### Scenario: 组织没有配置询价设置或项目没有组织
- **WHEN** 项目所属组织没有保存过询价设置，或项目没有所属组织，生成 `supplier_rfq`
- **THEN** 发件抬头与回复截止提前量用询价设置的默认值（与起草询价读同一份设置、同一个回落），起草日期用系统默认时区；照常生成（`npx tsx src/lib/tender-rfq/__tests__/sheet-download.test.ts`）

#### Scenario: 起草日期按组织时区
- **WHEN** 组织时区为 `America/Toronto`，在 UTC `2026-12-02T03:30:00Z` 生成
- **THEN** 询价单上的起草日期是 `2026-12-01`（`npx tsx src/lib/tender-rfq/__tests__/sheet-download.test.ts`）

### Requirement: 与询价邮件附件是同一份
询价单文件 SHALL 用询价邮件附件的同一个模板渲染。同一个项目、同一起草时刻、发起人填写项与贸易条款都为空时，询价单文件的渲染内容 SHALL 与起草询价时附件的渲染内容逐字节相同（内容指纹相同）。生成询价单文件 SHALL NOT 受附件开关 `TENDER_RFQ_ATTACHMENT_ENABLED` 影响，SHALL NOT 建询价轮次、SHALL NOT 建审批卡、SHALL NOT 发出任何邮件。

#### Scenario: 内容指纹相同
- **WHEN** 附件开关打开，用同一项目在同一时刻先经网页送审一轮（不填任何栏目、贸易条款选「不指定」），再生成 `supplier_rfq`
- **THEN** 生成记录元数据里的内容指纹等于审批卡载荷里附件的内容指纹（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）

#### Scenario: 附件开关关闭时照样生成，且零出站
- **WHEN** 附件开关未设，生成 `supplier_rfq`
- **THEN** 200；项目的询价轮次数、审批卡数不变（同一测试）；生成询价单文件的代码不引用发信、建轮次与建审批卡的模块（`npx tsx src/lib/tender-rfq/__tests__/sheet-download.test.ts` 源码断言）

### Requirement: 询价单文件不输出什么
询价单文件 SHALL NOT 含 AI 分析综合里的任何文字（要求标题与说明、风险、报价关注、澄清问题），SHALL NOT 含项目 AI 上下文与项目描述，我方撰写的部分（标题、栏目名、固定文字、我方抬头）SHALL NOT 含项目名称，SHALL NOT 含我方报价、中标价、项目估值、毛利率与预算，SHALL NOT 含任何供应商名称或邮箱。招标身份（招标编号、采购方名称、截标日期、精确交货地址）与招标要求原文里恰好和项目名称相同的词，按 `tender/supplier-identity-guard` 处理。

#### Scenario: 分析综合里写着毛利与预算
- **WHEN** 项目的分析综合在技术要求说明里写着「毛利」「预算」与采购方名称，已确认的要求里没有这些词，生成 `supplier_rfq`
- **THEN** 200，询价单的渲染内容里没有「毛利」「预算」与采购方名称（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）

#### Scenario: 生成代码不再读分析综合
- **WHEN** 读生成文件的源码
- **THEN** 供应商询价单的生成路径不引用分析综合的供应商询价表模板与简报正文拼装，也不拼接项目 AI 上下文（`npx tsx src/lib/tender-rfq/__tests__/sheet-download.test.ts` 源码断言）

### Requirement: 没有可收入的要求时不生成
项目没有已确认且属于供应商侧的要求（含没有可用分析）时，接口 SHALL 返回 422、`errorCode: "NO_CONFIRMED_REQUIREMENTS"` 与说明「没有已确认且属于供应商侧的要求，先在青砚「招标要求」里逐条确认后再生成询价。」；SHALL NOT 写文件，SHALL NOT 建生成记录与项目文件记录，SHALL NOT 把之前的询价单记录标为可能过期。

#### Scenario: 一条已确认的要求都没有
- **WHEN** 项目只有未确认的要求，生成 `supplier_rfq`
- **THEN** 422、`NO_CONFIRMED_REQUIREMENTS` 与上面那句说明；生成记录数与项目文件记录数不变，之前那份询价单记录的过期标记不变（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）

### Requirement: 命中内部财务信息时不生成
询价单内容命中询价单生成规则里的内部财务信息检查（发件抬头按全量敏感词表；要求原文、译文与交付要求按「只属于我方内部的字段与词」）时，接口 SHALL 返回 422、`errorCode: "SENSITIVE_LEAK"` 与说明「询价内容里有不能发给供应商的内容（如我方价格或内部备注），询价单没有生成，也没有保存文件。请到「招标要求」核对已确认的要求，并看一下询价设置里的发件抬头；页面上改不了的请联系管理员。」；SHALL NOT 写文件、SHALL NOT 建记录。说明 SHALL NOT 含命中的原文。

#### Scenario: 已确认的要求里写着底价
- **WHEN** 一条已确认的供应商侧要求的译文含「我方底价 12 元」，生成 `supplier_rfq`
- **THEN** 422、`SENSITIVE_LEAK` 与上面那句说明，响应里没有「12 元」；生成记录数不变（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）

### Requirement: PDF 检查不过时不保存
生成出的字节 SHALL 过询价邮件附件同一套检查：是 PDF、内嵌中文字体 Noto Sans SC、不超过 5 MB（5 × 1024 × 1024 字节）。生成出错、输出不是 PDF 或没有内嵌中文字体时，接口 SHALL 返回 503、`errorCode: "RFQ_SHEET_RENDER_FAILED"` 与说明「询价单 PDF 没能生成，没有保存任何文件。请稍后再试；一直不行请联系管理员。」；超过 5 MB 时 SHALL 返回 422、`errorCode: "RFQ_SHEET_TOO_LARGE"` 与说明「询价单 PDF 超过 5 MB，没有保存。通常是已确认的供应商侧要求太多，请联系管理员处理。」。两种情况 SHALL NOT 写文件、SHALL NOT 建记录，SHALL NOT 改存 HTML 文件。

#### Scenario: 生成出的 PDF 没有内嵌中文字体
- **WHEN** 注入的 PDF 生成函数返回一份没有内嵌 Noto Sans SC 的合法 PDF，生成 `supplier_rfq`
- **THEN** 503、`RFQ_SHEET_RENDER_FAILED` 与上面那句说明；生成记录数与项目文件记录数不变，文件存储里没有新文件（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）

#### Scenario: 生成函数抛错与超过 5 MB
- **WHEN** 注入的 PDF 生成函数抛错；另一次返回超过 5 MB 的合法 PDF
- **THEN** 分别是 503 `RFQ_SHEET_RENDER_FAILED`、422 `RFQ_SHEET_TOO_LARGE`；都没有新记录、没有 HTML 文件（同一测试）

### Requirement: 生成记录与文件名
生成成功时接口 SHALL 返回 200 与 `document`（含记录 id、标题、版本、文件地址），并写入：一份 PDF 文件；一条生成记录，标题为「询价单-{询价编号} v{版本号}」，版本号 SHALL 为该项目 `supplier_rfq` 类已有记录数加一，同类之前的记录 SHALL 被标为可能过期；一条项目文件记录，文件类型为 PDF。菜单下载时的文件名 SHALL 为「{标题}.pdf」，因而含询价编号。生成记录的元数据 SHALL 记询价编号、起草时刻、起草日期、内容指纹、版式版本、回复截止提前量与页数，SHALL NOT 记项目名称。响应 SHALL NOT 再带 `fontLimitation` 字段。

#### Scenario: 第二次生成
- **WHEN** 项目已有一条之前生成的 `supplier_rfq` 记录（标题「国内供应商询价 v1」），再生成一次
- **THEN** 新记录标题为「询价单-{询价编号} v2」、未过期，旧记录被标为可能过期；存下的文件以 `%PDF-` 开头；元数据里有 64 位十六进制的内容指纹与当前版式版本，没有项目名称；菜单用标题拼下载文件名（`sheet-download.test.ts` 源码断言）（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）

### Requirement: 已停用的两类文件
接口 SHALL 拒绝生成 `tech_confirm`（供应商技术确认表）与 `china_supplier_brief`（国内供应商简报），含简报的预览：返回 400、`errorCode: "DOC_TYPE_RETIRED"` 与说明「「{文件名称}」已停用，请改用「供应商询价单 PDF」。之前生成的文件仍可在列表里打开、下载。」；SHALL NOT 生成任何内容、SHALL NOT 写文件或记录。其它不认识的类型（含请求体不是 JSON 对象、`docType` 不是字符串）SHALL 返回 400 与「docType 无效」，响应里列出的可用类型 SHALL 只有仍在生成的六类。请求体里的 `previewOnly`、`includePublicHistoricalAmounts`、`confirmNotes` SHALL 被忽略。

#### Scenario: 请求已停用的类型
- **WHEN** 分别 POST `docType: "tech_confirm"` 与 `docType: "china_supplier_brief"`（后者带 `previewOnly: true` 与 `confirmNotes`）
- **THEN** 都是 400、`DOC_TYPE_RETIRED`，说明分别含「供应商技术确认表」与「国内供应商简报」；响应里没有 `previewText`；生成记录数不变（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）

#### Scenario: 不认识的类型
- **WHEN** 分别 POST `docType: "nope"`、空对象、JSON `null`、`docType` 为数组
- **THEN** 都是 400，说明为「docType 无效」，没有 `errorCode: "DOC_TYPE_RETIRED"`；可用类型列表是六类，不含已停用的两类（同一测试）

### Requirement: 之前生成的文件保留
停用与改版 SHALL NOT 删除或改写之前生成的任何文件与记录。`GET /api/projects/{id}/generate-pdf` SHALL 照旧列出之前生成的 `tech_confirm`、`china_supplier_brief` 与旧版 `supplier_rfq` 记录（既有的乱码时代文件过滤规则不变），每条带可打开、可下载的文件地址。

#### Scenario: 列表里还有旧记录
- **WHEN** 项目有之前生成的 `tech_confirm`、`china_supplier_brief` 记录各一条，读生成文件列表
- **THEN** 两条都在列表里，标题与文件地址不变（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）

### Requirement: 菜单入口与说明
「一键生成文档」菜单 SHALL 有一项「供应商询价单 PDF」（对应 `supplier_rfq`），SHALL NOT 再有「国内供应商简报 PDF（China Brief）」与「供应商技术确认表 PDF」两项；「标书与报价」页签 SHALL NOT 再显示国内供应商简报面板。生成结束（成功或失败）后菜单 SHALL 收起下拉层；失败时 SHALL 在菜单下方原样显示接口返回的说明（下拉层是浮层，不收起会盖住这句话）。文件列表里之前生成的两类已停用文件 SHALL 标「已停用的旧文件」。空状态提示 SHALL 为「生成供应商询价单、内部分析或同事任务单，自动读取当前项目资料。生成后可直接下载发送。」。新建情报室的默认交付物清单 SHALL NOT 再含「国内供应商中文 PDF」一项；已建情报室里存下的清单 SHALL NOT 被改写。

#### Scenario: 菜单项与面板
- **WHEN** 读菜单、页签与情报室默认清单的源码
- **THEN** 菜单选项里有 `supplier_rfq` 与「供应商询价单 PDF」，没有 `tech_confirm`、`china_supplier_brief`；失败时显示的是接口响应里的 `error`，生成结束后无论成败都收起下拉层；列表里已停用类型的记录带「已停用的旧文件」；页签不再引用简报面板；默认交付物清单里没有 `china_supplier_brief`，仍有「厂家询价表」（`npx tsx src/lib/tender-rfq/__tests__/sheet-download.test.ts` 源码断言）

### Requirement: 内部文件的生成与回落不变
分析师备忘录、内部项目分析、同事任务单、RFI 问题清单、投标文件起草 SHALL 照旧生成；PDF 转换失败时 SHALL 照旧改存 HTML 文件并在生成记录的元数据里写明降级原因。

#### Scenario: 内部文件照旧回落
- **WHEN** 读内部文件的落库代码，并在 PDF 生成不可用时生成一份同事任务单
- **THEN** 落库代码保留「PDF 优先、失败存 HTML 并标注原因」；任务单存成 HTML、元数据的渲染方式以 `html_fallback:` 开头（`npx tsx src/lib/pdf/__tests__/cjk-pdf.test.ts` 源码断言；`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`）
