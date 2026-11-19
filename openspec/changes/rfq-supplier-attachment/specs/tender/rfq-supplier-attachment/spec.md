## Purpose

发给供应商的询价邮件附带一份重新排版的 PDF「询价单 / 符合性确认表」。内容只取自询价单已经筛好、已经过招标身份防护的部分，附件的内容进入审批哈希，起草后再变就整张卡拒发。

## ADDED Requirements

### Requirement: 开关只管起草
系统 SHALL 只在 `TENDER_RFQ_ATTACHMENT_ENABLED` 为 `1`、`true`、`on` 或 `yes`（不分大小写，去首尾空白）且组织在 `TENDER_RFQ_ATTACHMENT_ORG_ALLOWLIST`（逗号分隔的组织 id；留空 = 所有组织）里时，为新起草的发询价审批卡生成附件。开关关闭时，起草出的审批卡载荷、载荷哈希、卡摘要与邮件正文 SHALL 与本功能之前逐字节相同。已经起草的卡 SHALL 按卡上记录的执行：带附件的卡在开关关闭后照样核对并带附件发出，不带附件的卡在开关打开后照样不带附件发出。

#### Scenario: 开关真值表
- **WHEN** 分别取开关未设、`0`、`1`、` TRUE `，白名单为空、含本组织、只含别的组织
- **THEN** 只有开关为真且白名单为空或含本组织时判为打开（`npx tsx src/lib/tender-rfq/__tests__/attachment.test.ts`）

#### Scenario: 开关关闭时起草的卡
- **WHEN** 开关关闭，用同一项目、同一组供应商经网页送审
- **THEN** 载荷里没有附件字段，载荷哈希等于只按各家邮件计算的值，邮件正文没有附件那一句，没有生成 PDF（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/attachment-db.isolated.test.ts`）

#### Scenario: 开关关闭后执行已起草的带附件卡
- **WHEN** 开关打开时起草了一张带附件的卡，之后关闭开关再执行这张卡
- **THEN** 照样核对并带附件发出（同一测试）

### Requirement: 附件的内容
附件 SHALL 是一份 PDF，文件名为 `询价单-{询价编号}.pdf`，同一轮所有收件人收到同一份。附件 SHALL 只含以下内容，且全部取自这一轮询价单本身：标题「询价单 / 符合性确认表」；询价编号；我方抬头；起草日期（组织时区，`YYYY-MM-DD`）；回复截止；补充说明（有时）；规格要求表（每条一行：序号、要求编号、强制或评分、中文规格、原文规格（与中文不同时）、招标文件页码（有时），以及留空的「是否满足（满足 / 偏离）」与「说明」两栏，表头在每一页重复）；商务条件（数量、贸易条款与目的地、交付要求、回复截止，写法与邮件正文相同）；请逐条回答的问题；需随报价提供的材料；页脚一句「请在每条要求的『是否满足』栏填写后随报价一并回复；某项无法满足请直接说明。」。规格要求、问题与材料的顺序与条数 SHALL 与同一轮邮件正文相同。附件的渲染内容对同样的输入 SHALL 完全相同（不含生成时刻、随机数或收件人）。

#### Scenario: 附件与邮件同一份清单
- **WHEN** 一轮询价有 3 条已确认的供应商侧要求（其中 1 条中文与原文相同）与 1 条保险类要求、若干问题与需提供的材料
- **THEN** 附件内容有 3 行规格（保险类不进；中文与原文相同的那一行不重复印原文），规格、问题与材料的顺序与邮件正文一致；同样的输入渲染两次结果相同；文件名为 `询价单-{询价编号}.pdf`（`npx tsx src/lib/tender-rfq/__tests__/attachment.test.ts`）

### Requirement: 附件不输出什么
附件里我方撰写的部分（标题、栏目名、固定句子、我方抬头、发起人填写的栏目）SHALL NOT 含项目名称；附件全部内容 SHALL NOT 含招标编号、采购方名称、截标日期、精确交货地址、任何供应商名称或邮箱、我方报价、项目估值、毛利率与预算，SHALL NOT 含原标书的任何页面或图片。招标要求的原文与译文按既有招标身份防护的口径处理（项目名称类不在其中比对）。附件模板的固定文字 SHALL 过本项目的禁出清单与邮箱 / 电话格式检查（项目名称类也查）；起草日期是系统生成的日期，SHALL NOT 参与禁出清单比对。

#### Scenario: 联邦标的附件
- **WHEN** 用招标编号 `24062-27-057`、采购方 `Treasury Board of Canada Secretariat`、项目名称 `Sleeping Bags and Mats`、截标 `2026-12-05`、地点事实 `Delivery to 2 Constellation Crescent, Ottawa, ON K1A 0K9` 的项目在开关打开时送审
- **THEN** 附件渲染内容不含 `24062-27-057`、`Treasury Board`、`Sleeping Bags and Mats`、`2026-12-05`、`Constellation`、`K1A` 与任何供应商名称，目的地为 `Ottawa, ON`（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/attachment-db.isolated.test.ts`）

#### Scenario: 模板文字被改坏
- **WHEN** 附件模板的固定文字含本项目的项目名称（测试里注入）
- **THEN** 判为命中项目名称、位置为「询价附件」，不产出附件（`attachment.test.ts`）

#### Scenario: 起草日期恰好是截标日期
- **WHEN** 起草日期为 `2026-12-05`，与截标日期相同
- **THEN** 模板文字不命中（`attachment.test.ts`）

### Requirement: 起草时生成，失败就不起草
开关打开时，系统 SHALL 在建询价轮次之前生成这份 PDF 并检查：PDF 生成出错、输出不是 PDF、PDF 没有嵌入中文字体（Noto Sans SC），或大小超过 5 MB（5 × 1024 × 1024 字节）时，SHALL NOT 建询价轮次、SHALL NOT 建审批卡，返回附件失败（原因为「生成出错」或「超过 5 MB」）；SHALL NOT 改为不带附件起草。模板文字命中禁出清单时按既有的招标身份命中处理（`IDENTITY_LEAK`），位置为「询价附件」。

#### Scenario: PDF 生成出错
- **WHEN** 开关打开，PDF 生成函数抛错（测试里注入），经网页送审
- **THEN** 返回附件失败，原因为「生成出错」；项目没有新的询价轮次与审批卡（`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/attachment-db.isolated.test.ts`）

#### Scenario: 超过 5 MB
- **WHEN** 注入的 PDF 生成函数返回超过 5 MB 的合法 PDF
- **THEN** 返回附件失败，原因为「超过 5 MB」；零轮次零卡（同一测试）

#### Scenario: 中文字体缺失
- **WHEN** 生成的 PDF 没有嵌入 Noto Sans SC（中文会是空白）
- **THEN** 判为生成失败（`attachment.test.ts`）

### Requirement: 附件失败时的说明
起草时附件失败：
- 网页送审 SHALL 返回 422、`errorCode: "ATTACHMENT_FAILED"`，没有出路链接；说明在生成出错时为「询价附件（PDF）没能生成（生成出错），这一轮没有建。稍后重试；一直不行请联系管理员。」，超过 5 MB 时为「询价附件（PDF）超过 5 MB，这一轮没有建。要求条数太多时请分几轮询价。」。
- 自动起草 SHALL 不起草，原因码 `ATTACHMENT_FAILED`，`quiet` 为 false，说明为「询价附件（PDF）没能生成，没有自动起草。可以在询价入口手动发起。」，去处为询价入口。
- Muse `rfq` 意图 SHALL 返回 `VALIDATION_FAILED`，说明同网页送审。
说明 SHALL NOT 含错误码、异常原文或堆栈。

#### Scenario: 网页送审的说明
- **WHEN** 开关打开，PDF 生成函数抛错，经网页送审
- **THEN** 422、`ATTACHMENT_FAILED`，说明含「没能生成（生成出错）」，不含异常原文（`attachment-db.isolated.test.ts`；文案 `npx tsx src/lib/tender-rfq/__tests__/web-entry-pure.test.ts`）

#### Scenario: 自动起草的文案
- **WHEN** 自动起草时附件失败
- **THEN** 结果为 `{ drafted: false, reason: "ATTACHMENT_FAILED", quiet: false }`，说明为上文那句，去处为询价入口（`npx tsx src/lib/tender-rfq/__tests__/auto-draft-pure.test.ts`；送审结果到原因码的映射 `attachment.test.ts` 源码断言）

#### Scenario: Muse 入口
- **WHEN** 附件超过 5 MB 时经 Muse 入口（同一起草流程）起草
- **THEN** 起草结果为 `ATTACHMENT_FAILED`、说明含「超过 5 MB」（`attachment-db.isolated.test.ts`；`rfq` 意图把这类结果落到 `VALIDATION_FAILED` 是既有映射，`attachment.test.ts` 源码断言）

### Requirement: 邮件正文提到附件
带附件的卡，每一家的询价邮件正文 SHALL 在「为便于比对……」那一句之前多一句「附件《{文件名}》是本邮件询价清单的 PDF 版，内容相同，便于转给技术同事逐条核对。」（不写页数：执行时重新生成 PDF，页数以卡上为准）；不带附件时正文 SHALL 不变。这一句同样过禁出清单（模板句子的检查）。

#### Scenario: 正文多一句
- **WHEN** 开关打开，送审一轮
- **THEN** 每一家正文都含「附件《询价单-{询价编号}.pdf》是本邮件询价清单的 PDF 版」；开关关闭时不含（`attachment-db.isolated.test.ts`）

### Requirement: 附件进审批载荷与哈希
带附件的卡，载荷 SHALL 记录附件的文件名、页数、字节数、内容指纹（附件渲染内容的 SHA-256 十六进制）、附件版式版本与重新排出内容所需的起草参数（询价编号、起草时刻、起草日期、回复截止提前量、发起人填写的补充说明 / 附加问题 / 目的地 / 数量阶梯）；载荷 SHALL NOT 存 PDF 字节。载荷哈希 SHALL 覆盖附件的文件名与内容指纹；不带附件的卡，载荷哈希的算法与结果 SHALL 与本功能之前相同。审批卡摘要 SHALL 在主题那一行之后多一行「附件：{文件名}（{页数} 页，{大小}）」，大小按 KB（不足 1 MB，取整，至少 1）或 MB（保留一位小数）显示。

#### Scenario: 哈希兼容
- **WHEN** 对同一组邮件分别计算不带附件与带附件的载荷哈希
- **THEN** 不带附件的结果与本功能之前的算法结果相同；带附件的结果不同，且改动文件名或内容指纹中任何一个都会改变结果（`attachment.test.ts`）

#### Scenario: 载荷里没有 PDF 字节
- **WHEN** 开关打开时送审一轮
- **THEN** 载荷里的附件字段只有上述元数据，序列化后不到 4 KB，载荷里没有 PDF 内容；卡摘要含「附件：询价单-」一行（`attachment-db.isolated.test.ts`）

### Requirement: 执行前核对附件
执行带附件的发询价卡时，系统 SHALL 在既有的载荷哈希与招标身份复核、发件账号检查之后，发出第一封之前，用执行时的项目资料（截标日期、禁出清单、当前可用分析的要求与关键事实）与载荷里的起草参数、发件抬头、贸易条款重新排出附件内容，比对内容指纹：
- 附件版式版本与当前不同：整张卡拒发，错误码 `RFQ_ATTACHMENT_TEMPLATE_CHANGED`，说明「系统更新了询价附件的版式，这张卡一封都没有发，请重新发起一轮询价」。
- 重新排不出来（例如已确认的要求没有了）或指纹不一致：整张卡拒发，错误码 `RFQ_ATTACHMENT_CHANGED`，说明「询价附件的内容在起草后变了（要求、关键事实或截标日期有改动），这张卡一封都没有发，请重新发起一轮询价」。
- 重新排出时命中招标身份：按既有的 `RFQ_IDENTITY_LEAK` 拒发。
拒发 SHALL NOT 发出任何邮件、SHALL NOT 改变询价项的状态。

#### Scenario: 起草后改了一条要求
- **WHEN** 一张带附件的卡起草之后，其中一条已确认要求的中文翻译被改动，然后执行这张卡
- **THEN** 返回 `RFQ_ATTACHMENT_CHANGED`；发信函数被调用 0 次；询价项仍为待发（`attachment-db.isolated.test.ts`）

#### Scenario: 旧版式起草的卡
- **WHEN** 载荷里的附件版式版本与当前不同
- **THEN** 返回 `RFQ_ATTACHMENT_TEMPLATE_CHANGED`，发信 0 次（同一测试）

#### Scenario: 把附件从载荷里去掉
- **WHEN** 执行前载荷里的附件字段被删掉
- **THEN** 载荷哈希对不上，返回 `RFQ_PAYLOAD_TAMPERED`，发信 0 次（同一测试）

#### Scenario: 定版指纹
- **WHEN** 附件模板或会进附件的询价单生成规则被改动而版式版本没有加一
- **THEN** 定版指纹用例失败（`attachment.test.ts`）

### Requirement: 执行前核对的边界
询价项都已发过（重放）时，系统 SHALL NOT 再核对附件或生成 PDF。载荷里有附件字段但形状不对时，整张卡拒发（`RFQ_PAYLOAD_INVALID`），SHALL NOT 当作不带附件发出。不带附件的卡 SHALL NOT 做附件核对。

#### Scenario: 重放
- **WHEN** 一张带附件的卡 3 家都已发出后再执行一次
- **THEN** 不生成 PDF、不发信，结果写「此前已发」（`attachment-db.isolated.test.ts`）

#### Scenario: 形状不对的附件字段
- **WHEN** 载荷里的附件字段缺内容指纹
- **THEN** 读卡时当作没有附件（`attachment.test.ts`）；执行时整张卡拒发 `RFQ_PAYLOAD_INVALID`，发信 0 次（`attachment-db.isolated.test.ts`）

### Requirement: 执行时生成 PDF 并随信发出
核对通过后，系统 SHALL 生成一次 PDF，每一封带同一份发出。PDF 生成出错、输出不是 PDF、没有嵌入中文字体或超过 5 MB 时，整张卡拒发，错误码 `RFQ_ATTACHMENT_FAILED`，说明「询价附件（PDF）没能生成，这张卡一封都没有发，请稍后重新发起一轮询价」，SHALL NOT 发出任何邮件、SHALL NOT 改变询价项的状态、SHALL NOT 不带附件发出。不带附件的卡发出的邮件 SHALL NOT 带附件。

#### Scenario: 内容没变
- **WHEN** 同一张卡在资料不变时执行
- **THEN** 每家各发出一封，每封都带一个 `application/pdf` 附件、文件名与载荷相同，三封是同一份（`attachment-db.isolated.test.ts`）

#### Scenario: 执行时 PDF 生成失败
- **WHEN** 内容指纹一致，PDF 生成函数抛错，或生成的 PDF 没有中文字体
- **THEN** 返回 `RFQ_ATTACHMENT_FAILED`，说明不含异常原文，发信 0 次，询价项仍为待发（同一测试）

### Requirement: 发出附件的审计
带附件的卡这一次真的发出至少一封后，系统 SHALL 写一条审计 `tender.rfq_attachment_sent`，记询价轮次、文件名、页数、字节数、PDF 字节的 SHA-256、内容指纹与发出家数；SHALL NOT 记 PDF 内容。一封都没发出（含重放）时 SHALL NOT 写这条审计。

#### Scenario: 审计与实际发出的附件相符
- **WHEN** 带附件的卡发出 3 家，然后再执行一次（重放）
- **THEN** 审计一条，PDF 字节的 SHA-256 等于发信参数里附件字节的 SHA-256，发出家数为 3；重放不再发、不再记（`attachment-db.isolated.test.ts`）

### Requirement: 带附件的原始邮件
发信时传入附件的，原始邮件 SHALL 为 `multipart/mixed`：第一部分为正文（类型与字符集同不带附件时，base64 编码，每行不超过 76 个字符），其后每个附件一部分（`Content-Type` 为附件类型、`Content-Disposition: attachment`、base64 编码每行不超过 76 个字符）。文件名含非 ASCII 字符时，`Content-Disposition` SHALL 同时带 RFC 2231 的 `filename*=UTF-8''…` 与 RFC 2047 编码的 `filename`，`Content-Type` 带 RFC 2047 编码的 `name`；文件名与类型里的换行与引号 SHALL 被去掉。分隔线 SHALL 不会出现在任何一部分的内容里。不传附件或传空数组时，原始邮件 SHALL 与本功能之前逐字节相同。

#### Scenario: 不带附件逐字节不变
- **WHEN** 用同一组参数（含与不含回复地址、线程回复头、纯文本与 HTML 正文）分别按本功能之前的写法与现在的写法生成原始邮件，后者不传附件或传空数组
- **THEN** 两者逐字节相同（`npx tsx src/lib/__tests__/google-email-mime.test.ts`）

#### Scenario: 中文文件名
- **WHEN** 附件文件名为 `询价单-RFQ-SUNNY-2026-AB12C.pdf`
- **THEN** 解码后的原始邮件含 `multipart/mixed`、`filename*=UTF-8''%E8%AF%A2%E4%BB%B7%E5%8D%95-RFQ-SUNNY-2026-AB12C.pdf` 与 RFC 2047 编码的 `filename`；按分隔线拆开后附件部分 base64 解码与原字节相同；正文部分解码后与原正文相同（同一测试）

### Requirement: 审批卡上的附件
项目页询价区、询价追踪与询价入口抽屉里的发询价审批卡 SHALL 在邮件列表上方显示「每封都附带同一份 PDF：{文件名}（{页数} 页，{大小}）」与「预览」链接；不带附件的卡 SHALL 不显示这一行。催单与追问卡 SHALL NOT 显示附件。

#### Scenario: 卡上的附件行
- **WHEN** 读一张带附件的待批发询价卡的邮件预览
- **THEN** 每封邮件的预览都带附件的文件名、页数、字节数与预览链接 `/api/projects/{项目}/tender-rfq/attachment?actionId={卡}`；不带附件的卡与催单卡的预览没有附件（`attachment.test.ts`；`attachment-db.isolated.test.ts`）

### Requirement: 卡上提前说附件已变
读带附件的待批发询价卡时，系统 SHALL 按执行时同样的方式重排比对（不生成 PDF）。内容在起草后变了或版式已更新时，卡上 SHALL 显示「询价附件的内容在起草后变了（要求、关键事实或截标日期有改动），批准后会被拒发。请驳回这张卡，再重新发起一轮询价。」（版式更新时为「系统更新了询价附件的版式，这张卡批准后会被拒发。请驳回这张卡，再重新发起一轮询价。」），SHALL NOT 显示批准按钮与预览链接，驳回照常可用。

#### Scenario: 起草后又改了一条要求
- **WHEN** 一张带附件的卡起草之后，一条已确认要求的中文翻译被改动，再读这张卡的邮件预览
- **THEN** 附件信息标为内容已变（`attachment-db.isolated.test.ts`）

### Requirement: 附件预览
系统 SHALL 提供只读的附件预览：`GET /api/projects/{项目}/tender-rfq/attachment?actionId={卡}`。
- 只有能读这个项目的人能打开（与项目页询价区给同一批人看每封邮件正文一致；附件内容是正文的子集）；未登录 401；其余（含卡不是本组织本项目的发询价卡、卡上没有附件）一律 404「没有找到这份询价附件」，不区分原因。
- 按载荷与执行时同样的方式重新排出内容；不一致时返回 409，说明同卡上的「内容在起草后变了 / 系统更新了版式」那句。
- 一致时返回 200、`Content-Type: application/pdf`、`Content-Disposition: inline`（文件名同载荷）、`Cache-Control: private, no-store`；PDF 生成失败返回 503，说明「询价附件（PDF）暂时生成不了，请稍后再试」。
- 预览 SHALL NOT 改变审批卡、询价轮次与询价项的任何状态，SHALL NOT 发出邮件。

#### Scenario: 能读项目的人预览
- **WHEN** 起草人打开一张带附件的待批卡的预览
- **THEN** 200、`application/pdf`、`inline`、`private, no-store`，内容以 `%PDF-` 开头；卡仍是待批、询价项仍为待发、没有发信（`attachment-db.isolated.test.ts`）

#### Scenario: 不该看的
- **WHEN** 别的组织的用户打开预览；用别的项目的地址打开这张卡；打开一张不带附件的卡
- **THEN** 都是 404，说明相同（同一测试）

#### Scenario: 内容变了
- **WHEN** 改动一条已确认要求后打开预览
- **THEN** 409，说明含「内容在起草后变了」与「请驳回这张卡」（同一测试）

### Requirement: 催单与追问不带附件
催单与缺字段追问邮件 SHALL NOT 带附件；它们的模板、模板指纹与原始邮件 SHALL 与本功能之前相同。

#### Scenario: 催单执行
- **WHEN** 运行既有的催单执行器测试，并检查催单执行器的发信调用
- **THEN** 既有测试不改期望值通过（`npx tsx src/lib/tender-rfq/__tests__/chase-execute.test.ts`）；催单执行器的发信参数里没有附件（`attachment.test.ts` 源码断言）
