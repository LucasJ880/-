# Design：询价单模板第 2 版（RFQ-PDF-2）

## Context

动机见 proposal.md。决定做法所需的现状（main `22a87fb7`）：

- 询价单的内容规则在 `src/lib/tender-rfq/build.ts`：`buildRfqDocument`（纯函数）产出 `RfqDocument`，`renderRfqEmail` 把它渲染成邮件正文，`rfqCommercialTermsZh` 是邮件与附件共用的商务条件。行项保持输入顺序（`service.ts` `loadRfqRequirementInputs` 按要求编号升序读），带 `seq` 与 `sourcePage`。
- 附件模板在 `attachment.ts`：`model()` → `renderRfqAttachmentHtml`（HTML，同输入同输出）与 `rfqAttachmentTextBlocks`（身份检查用的文字）；`RFQ_ATTACHMENT_TEMPLATE_VERSION = 1`；`attachment.test.ts` 有一条定版指纹用例。RFQ-PDF-1 之后菜单的供应商询价单（`sheet-download.ts` `composeRfqSheet`）与邮件附件走同一个模板与同一个 `renderCheckedRfqSheet`，所以改模板两边一起变。
- `RfqDocument` 的 `seq` / `sourcePage` / `questions` / `attachmentsRequested` / `quantityTiers` / `quantityNote` 只在 `tender-rfq` 目录内被读（`attachment.ts`、`build.ts`）。
- 回信解析只有一处依赖正文格式：`inbound-contract.ts` `rfqContextFromBody` 用 `/^-\s*数量：/` 取第一档数量、用 `/【强制】(\S+)/g` 取强制要求编号（下游 `inbound-parse.ts`、`landed-cost.ts`、`compare-service.ts`）。催单、追问、Muse 都不解析询价正文。
- 回复截止 `computeReplyBy(closeDate, now, lead)`：取「截标 − 提前量」与「今天 + 2 天」里较晚的，按 UTC 日期；截标前 2 天正好等于截标日期，被模板文字的禁出清单检查拦下（位置「询价附件」）。禁出清单里的截标日期按组织时区算。
- 内部字段检查 `INTERNAL_FIELD_PATTERNS`（8 个模式）只查规格原文、译文与交付要求，不查要求编号与数量。
- 语言判断 `needsChineseTranslation`（`src/lib/tender-auto-analysis/requirement-lang.ts`，纯函数）；补翻入口是「招标要求」页签里「投标合规矩阵」卡的「翻译成中文」按钮。
- 联系人：`Organization.settingsJson.tenderProfile.quoteHeader.preparedByDefault`（`src/lib/tender-profile/contract.ts`）；展示发件人 `tenderRfq.fromEmail`，授权邮箱 `tenderRfq.mailboxEmail`（`round-pure.ts` `readTenderRfqSettings`）。禁出清单已把这两个邮箱当「本组织自己的地址」白名单。
- 执行前重排 `attachment-service.ts` `rebuildRfqAttachment` 用载荷里定格的起草参数（`attachment.draft`）+ 执行时的项目资料重新排版并比对内容指纹。
- 版式参考稿 `claude/QINGYAN_RFQ-PDF_TARGET_LAYOUT.html` 不在仓库里；按任务书 §5 的文字与版式数值做。

## Goals / Non-Goals

**Goals**：工厂拿到的一份询价单能直接填、能按编号回、系统读得回来；同样内容更短（14 条 ≤ 3 页，60 条 ≤ 8 页）；RFQ-PDF-1 带出的四件事一起收掉；版式版本只升一次。

**Non-Goals（不动的）**：

- `src/lib/tender-rfq/chase-*.ts`、`followup-*.ts`（催单 / 追问模板与模板指纹）、`execute.ts`（只因类型变动跟着编译）、`compare*.ts`、`landed-cost.ts`、`inbound-parse.ts`、`inbound-sync.ts`、`inbound-apply.ts`、`notes-parse.ts`、`tracker*.ts`。
- `inbound-contract.ts` 除 `rfqContextFromBody` 里那一个正则之外的全部内容；`INBOUND_MISSING_FIELDS` 与 `INBOUND_MISSING_LABEL` 不改。
- `attachment-flags.ts`（开关）；`src/lib/muse-bridge/**`；`src/lib/pdf/html-to-pdf.ts`（页边距不变）。
- `src/lib/bid-workflow/project-identity-deny.ts` 的比对规则与 `project-identity-sources.ts`；`RFQ_ATTACHMENT_SEGMENT_WHERE`（位置名「询价附件」）不改名。
- `src/lib/tender-auto-analysis/requirement-translate.ts`（不新增翻译调用）；`bid-fit-matrix-card.tsx`。
- `generate-docs.ts` 的落库与内部文件；`pdf-doc-types.ts`。
- Prisma schema、`vercel.json`、`next.config.ts`、环境变量、cron。

## Decisions

### D1 内容规则放在 `build.ts`，模板只管排版

`RfqDocument` 改成第 2 版模板要的样子（`RFQ_CONTRACT_VERSION` 不变，它不出站）：

- `lineItems`：去掉 `seq` 与 `sourcePage`；加 `kind: "必须" | "加分"`、`group`（四组之一）、`missingZh: boolean`。按「组序 → 要求编号升序（码点序）」排好，邮件与附件直接照这个顺序渲染。
- `missingTranslationCount`；`contactName: string | null`、`contactEmail: string`（入参同名，由调用方读出后传入）。
- `quantityTiers`（只在发起人填了时有）、`quantityFactZh`（没填而有可用的数量事实时：事实的中文原文）、`quantityNote`（两者都没有时）。
- `fixedQuestions`（Q1–Q5，只进邮件）与 `extraQuestions`（发起人填的，邮件与附件都印）；`attachmentsRequested`（派生项）与常量 `RFQ_COMPLIANCE_EVIDENCE_ZH`（固定一组六项）。
- 分组表 `RFQ_LINE_GROUPS` 导出（组名 + 类别），测试与样张脚本共用。

- 否决：`build.ts` 不动、分组与用词都在模板里算——邮件正文也要同样的分组、用词与顺序（任务书第 7 项），两个渲染器各算一遍迟早不一致；RFQ-PDF-1 已经把「同一份内容」定成这条线的不变式。
- 否决：保留 `seq` 字段只是不印——留着就会有人再印出来；它在 `tender-rfq` 之外没有读取方。

### D2 数量：阶梯只认人填的，事实照原文印

发起人填了阶梯 → 印阶梯并作为报价表的行。没填而有可用的数量事实（人工确认或高置信，与现在同一个判定）→ 「询价内容」印事实的中文原文，报价表一行、数量格留空让工厂按上面的数量填。都没有 → 「客户未明确数量，请按贵司常规阶梯（如 100 / 500 / 1000）分别报价。」（把现有那句里的「招标文件」换成「客户」——供应商手里没有招标文件；保留「未明确」三个字，回信解析靠它判断「正文没给数量」）。数量事实的原文作为招标文本进招标身份检查（位置「数量」）与内部字段检查。

邮件正文的 `- 数量：` 一行是给回信解析读的：`rfqContextFromBody` 取这一行的第一个数字当「首档数量」，落地价（`landed-cost.ts`）、比价（`compare-service.ts`、`tender-pricing/compare-cost-source.ts`）与 Muse 摘要都用它。所以没填阶梯、而数量事实里解析得出数字时，这一行写作 `{数字}（{事实的中文原文}）`——数字仍按本次之前的办法解析（取 `contentOriginal ?? contentZh` 里的第一个数字，`doc.quantityFactQty`），下游取到的首档数量不变；供应商同时看得到带单位的原文。解析不出数字时只写原文。附件的「询价内容」只印事实原文（任务书第 1 项），报价表不出现这个解析出的数字。「正文没给数量」的判断从含「未明确」收紧为含「未明确数量」（两句固定话都含这五个字），免得事实原文里偶然出现的「未明确」让首档数量读不出来。留空招标原文的那一份（`rfqTemplateOnlyDocument`）同时清掉数量事实与解析出的数字。

数量事实的取用判定不变（人工确认或高置信 HIGH / VERIFIED，与本次之前解析数量、交付要求、目的地用的是同一个判定）；任务书写的是「已确认的数量事实」，这里沿用既有判定而不为数量单独收紧——收紧会让现在有数量的询价变成「客户未明确数量」。

- 否决：邮件数量行也只印事实原文——开工前审查用两边的解析逻辑模拟过：原文 `Approximately 1,240 units over a 3-year term`、中文「三年合同期约 1,240 套」，之前读出 1240，只印中文原文会读出 3，落地价与比价的默认首档数量跟着错。

- 否决：继续从数量事实里解析出一个数字当阶梯——事实常是「三年合同期约 1,240 套」这样的句子，取第一个数字会把「3」印进报价表；照原文印才有单位（任务书现状第 4 条）。

### D3 报价表的六个栏目与回信解析一一对应，对应关系写成常量

`attachment.ts` 导出 `RFQ_QUOTE_FIELD_LABELS: Record<InboundMissingField, string>`（price→单价（含包装）、currency→币种、incoterm→贸易条款、moq→最小起订量、deliveryDays→生产交期（天）、validUntil→报价有效期至），模板的表头与三格从它取字。类型上它必须覆盖 `INBOUND_MISSING_FIELDS` 的每一项，多一项少一项都编译不过；测试再断言一次。

- 否决：栏目名直接写在模板里、测试里另写一张对应表——对应关系只存在于测试里，改模板的人看不到。

### D4 版式

A4 竖版，页边距不变（`html-to-pdf.ts` 的 14 / 12 mm）。字号：正文 9.5pt；英文对照 8pt（样张另出 7.5pt）；表头与组标题 9pt；勾选栏 8pt；各节标题 11pt；标题 20pt。颜色只有黑、深灰（#444）与浅灰底（#eee / #f5f5f5），线条 #888。

规格确认表列宽（`table-layout: fixed`）：编号 11%、要求 47%、类型 7%、是否满足 15%、差异说明 20%。编号格 `overflow-wrap:anywhere`（长编号在格内换行）；三个勾选框各占一行、不折行；`thead` 每页重复；`tr{break-inside:avoid}`；组标题是一行跨五列的灰底行，并 `break-after:avoid`（不落在页尾）。签章栏是带边框的块，`break-inside:avoid`，并与回复方式那一句包在同一个不拆页的容器里。节号按实际出现的节顺序编（没有附加问题时「请随报价提供」是四）。

英文字号做成渲染入参 `englishPt`（缺省 8，只接受 8 与 7.5）：只给样张脚本用，起草、执行、菜单都不传，所以线上只有一种版式、内容指纹稳定。Evan 定 7.5 的话改缺省值与定版指纹，版式版本仍是 2（都发生在合并之前）。

- 否决：7.5pt 另做一个开关或组织设置——字号是版式的一部分，做成可配置就要进载荷与内容指纹，为一次性的选择引入长期的分支。
- 否决：勾选框横排——15% 的列宽（约 28 mm）放不下三个带字的框，会挤占「要求」一列。

### D5 邮件正文的写法与回信解析的兼容

规格行：`{要求编号} 【必须】{中文}`，下一行 `   原文：{原文}`（与中文不同时）；每组前一行 `【{组名}】（N 条）`。没有译文的行：`{要求编号} 【加分】（暂无中文译文，以原文为准）` + 原文行。Q1 改为「以下必须满足的要求请逐条回复「满足 / 部分满足（说明差异）/ 不满足」：{编号…}」；Q2–Q5 不变。材料清单：派生项，然后 `首次合作或尚未提供过的，请一并提供：` 与六项。结尾 `为便于比对，请按要求编号逐条回复；做不到的请直接写明，我们更看重准确。`（保留「为便于比对」开头，附件那一句仍插在它前面）。带附件时的那一句把「填好表格随报价一起发回」改为「把填好的表以 Excel 或可复制文字的 PDF 发回（请不要只发照片或扫描件）」。

`rfqContextFromBody` 的强制编号改为两种写法的并集：`/【强制】(\S+)/g`（本次之前发出的正文，库里的旧卡与旧轮次都是它）与 `/^(\S+) 【必须】/gm`。数量行的正则不动。

- 否决：正文里继续写【强制】、只在附件里改【必须】——任务书明确两边同步，且工厂按附件回「必须项」时正文说的是「强制」。
- 否决：回信解析只认新写法——已发出的轮次的正文还是旧写法，它们的回信会全部读成「未知编号」。

### D6 回复截止不晚于截标前一天，按组织时区算

`computeReplyBy(closeDate, now, lead, timeZone)`：四个日期都先换成组织时区的 `YYYY-MM-DD` 再比（字符串比较）：`较晚(截标 − 提前量, 今天 + 2 天)`，再与「截标日 − 1 天」取较早；结果早于今天 → `null`（写「请尽快」）。`RfqBuildInput` 加必填的 `timeZone`（纯函数不读设置；必填是为了不让哪个调用方漏传），四处调用（起草——自动起草也走它、入口预判、执行前重排、菜单询价单）都传组织时区——禁出清单的截标日期本来就按它算，两边口径从此一致。

回复截止为空（写「请尽快」）以前只在项目没有截标日期时出现，现在离截标不到一天时也会出现。受影响的三处：询价抽屉里的括注改为「请尽快（项目没有截标日，或离截标不到一天）」；跟进授权（`followup-coverage.ts`）在没有回复截止时本来就不设催单的截止日，行为不变；询价设置页对「回复提前量」的说明（`settings-form.ts`）仍然成立。

- 否决：把回复截止从禁出清单比对里豁免——那等于把截标日期印给供应商。
- 否决：仍按 UTC 日期、只加「不等于截标日」的上限——截标时刻在当地晚上时 UTC 日期比当地晚一天，上限会差一天，照样可能印出当地的截标日期。

### D7 内部字段检查：加词、加查编号与数量

`INTERNAL_FIELD_PATTERNS` 加：`我方报价`、`我方成本`、`内部成本`、`目标毛利`、`our bid price`、`target margin`、`internal cost`。受检文字从「规格原文、译文、交付要求」扩到要求编号与数量事实。不加 `cost`、`budget`、`成本`、`预算` 这类单词：招标文件正文里常见（`at no additional cost`），那是人写的自由文本那一档才用的词表。

- 否决：招标原文也用全量敏感词表——CHAIN-4b 之前的设计已经说明会把正常的招标条款拦下，询价发不出去。

### D8 联系人与邮箱：调用方读、载荷定格

`service.ts`（起草）、`web-entry.ts`（入口预判）、`sheet-download.ts`（菜单）用同一个纯函数 `round-pure.ts` `readRfqContactName(组织设置)` 读联系人、用 `settings.fromEmail` 作邮箱，传给 `buildRfqDocument`。

默认经办人是投标档案里给客户报价单用的 120 字自由文本，可能带职务、电话、邮箱。`readRfqContactName` 只在它像一个人名时返回它：没填、超过 40 字、含「@」、含电话样的数字串 → 返回 `null`，抬头不印这一项，**不让询价失败**。联系人只印在 PDF 抬头、不进邮件正文，所以它不进 `buildRfqDocument` 的敏感词与身份检查，而是随附件的模板文字（`rfqAttachmentTemplateSegments`，位置「询价附件」）按我方撰写过禁出清单——要印的时候才查，不带附件的询价不会因为它被拦。邮箱是本组织的展示发件人，在禁出清单的白名单里。

载荷的 `attachment.draft` 加两个可选字段：`contactName` 与 `timeZone`（`readPayloadAttachment` 读不到时当 `null`；旧卡没有这两个键，仍读得出、再由版式版本走 `template` 分支）。执行前重排用它们与载荷里已有的 `fromEmail`，不现读——档案里的经办人或组织时区起草后改了，不该让一张已批准的卡以「项目资料有改动」被拒发。不带附件的卡没有 `attachment` 这个键，载荷与哈希算法不变（哈希只覆盖文件名与内容指纹）。

- 否决：联系人按全量敏感词表检查、命中就整份失败——词表里有 `cost`、`margin` 这样的子串，经办人叫 Acosta 就发不出询价；而且附件开关关着时根本不印它，却会拦下邮件。
- 否决：带电话或邮箱的经办人照印——授权邮箱在禁出清单的白名单里，写进经办人不会被拦，会把它印给供应商（邮箱分离）。

- 否决：重排时现读投标档案——见上，会制造与项目资料无关的拒发。
- 否决：邮件正文也印联系人——任务书第 7 项没有要求，落款仍是我方抬头。

### D9 缺译文：判断在 `build.ts`，提醒在两个入口

`lineItem.missingZh` = 没有译文（或译文与原文相同）且 `needsChineseTranslation(原文)`。有译文就照印：`needsChineseTranslation` 的判据是中文占比低于 15%，「提供 MSDS/SDS 与 OEKO-TEX Standard 100 证书」这样的真译文占比也很低，按占比判会把它藏成「暂无中文译文」。翻译失败时翻译服务保留原文（译文为空或等于原文），正好落在「缺」这一边。附件与邮件在中文位置印「（暂无中文译文，以原文为准）」。`web-entry.ts` 用预构建出的 `missingTranslationCount` 给入口状态的 `warnings` 追加一句（纯函数 `missingTranslationWarningZh(n)` 放在 `web-entry-pure.ts`）；菜单路径由 `buildProjectRfqSheet` 带回条数，`generate-docs` 的返回值带 `notices`，路由放进响应，菜单在成功后显示在原来显示错误的位置（中性颜色）。两句提醒的措辞略有不同（入口说「再发」，菜单说「重新生成」），都指向「招标要求」里投标合规矩阵的「翻译成中文」。

- 否决：缺译文时阻止生成或送审——任务书明确只提示；翻译失败是常态（模型超时会保留原文）。
- 否决：生成时自动补翻——新增模型调用，违反确定性优先。

### D10 两句说明

菜单询价单「没有已确认的要求」不再用生成器的原句，改用 `sheet-download.ts` 自己的一句（规格里的新文字）；生成器的原句不动（Muse 与入口另有各自的说明）。「含招标身份信息」那句改 `project-identity-messages.ts` 的 `identityLeakDocMessageZh`（只有菜单询价单在用）。身份命中的说明按命中位置给两条出路（要求或数量 → 「招标要求」；抬头、联系人或询价附件 → 组织管理员）。位置名「询价附件」不改：D6 之后最常见的误命中（回复截止）已经没有了，改名要动 `tender/rfq-supplier-attachment` 里好几处场景。

- 否决：改生成器的原句——Muse `rfq` 意图与询价入口各有自己的说明，原句只剩菜单在用；在 `sheet-download.ts` 里换一句不牵动别的入口。
- 否决：身份命中只指向「招标要求」——命中在抬头、联系人或模板文字时，那里改不了。

### D11 版式版本与旧卡

`RFQ_ATTACHMENT_TEMPLATE_VERSION = 2`。旧版式起草的卡在执行与读卡时按既有逻辑走 `template` 分支（`RFQ_ATTACHMENT_TEMPLATE_CHANGED`、卡上只给驳回），不改这段逻辑。定版指纹用例更新为第 2 版的值。菜单询价单的生成记录元数据里的 `templateVersion` / `conclusionVersion` 随之变成 2，旧记录不动。

- 否决：版式版本不升、靠内容指纹不一致拒发旧卡——旧卡会被说成「起草后项目资料有改动」，而其实是系统换了版式；`template` 分支就是为这种情况留的。

### D12 样张与真实 Chromium 检查

新增 `scripts/rfq-sheet-sample.ts`（手工脚本，不进 `test-all.sh`；找不到 Chromium 时打印 SKIP）：用联邦标样例生成 14 条与 60 条两份 8pt、14 条一份 7.5pt 的 PDF，输出页数、字节数、是否内嵌 Noto Sans SC；用 `unpdf` 取文字层坐标判断长编号 `MAND-TECH-0012` 与「类型」列不重叠；`pdftoppm` 可用时把首页转成 PNG。PDF 与 PNG 存进 `docs/acceptance/rfq-pdf-2/`，报告引用。

- 否决：把页数断言放进已注册的测试——CI 与多数本机环境没有 Chromium，要么永远跳过、要么让全量测试依赖浏览器。

## 与八条硬纪律的关系

1. 零 schema：遵守。联系人读已有的 `tenderProfile`；载荷里的新字段在既有 JSON 里；`git diff origin/main -- prisma/` 为空。
2. 出站先审批：不新增发送路径。邮件仍经审批卡与执行器；附件内容仍进内容指纹；菜单文件仍是下载。
3. 禁止第三套队列：不涉及。
4. 脱敏：收紧。内部字段词表加词、要求编号与数量也查；数量事实原文进招标身份检查；抬头只印展示发件人。命中即整份失败，不做局部替换。
5. 不爬登录页：不涉及。
6. 邮箱分离：抬头印 `fromEmail`（展示发件人）；`mailboxEmail`（授权邮箱）不进询价单的任何内容，测试断言渲染结果里没有它；发信仍只按组织设置里的授权邮箱。
7. 确定性优先：零模型调用。分组、用词、译文判断、合规清单、回复截止都是查表或规则。
8. 测试注册：不新增 `__tests__` 文件（都在既有已注册的测试里加用例）；`bash scripts/check-test-registry.sh` 通过。

## 验证方式

- `npx tsx src/lib/tender-rfq/__tests__/build.test.ts`（分组与顺序、三种数量、回复截止五种日期与时区、内部字段、缺译文、新正文）。
- `npx tsx src/lib/tender-rfq/__tests__/attachment.test.ts`（模板固定文字里没有「招标文件 p.」「序号」「评分」「拍照」「扫描作为附件」；报价六栏与回信字段对应；首屏、分组、勾选、清单、签章栏；版式版本 2 与定版指纹；旧版本的卡走 template 分支）。
- `npx tsx src/lib/tender-rfq/__tests__/inbound-parse.test.ts`（新旧正文都读得出编号与数量）；`web-entry-pure.test.ts`、`sheet-download.test.ts`（提醒与说明）。
- 隔离库：`attachment-db`、`sheet-download-db`、`supplier-identity-guard-db`、`auto-draft-db`（期望随正文与模板更新；夹具改为注入时刻）。
- `npx tsx scripts/rfq-sheet-sample.ts`（真实 Chromium：页数 14 条 ≤ 3、60 条 ≤ 8；长编号不重叠；两种字号的页数与首页截图）。
- 门禁：`npm test`（与 main 基线逐项对照失败名单）、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`openspec validate rfq-sheet-template-v2 --strict`、`git diff origin/main -- prisma/ vercel.json` 为空。

## Risks / Trade-offs

- [已起草的带附件卡全部要重新发起] 版式版本变了 → 既有的 template 分支与文案；附件开关默认关，生产上没有这样的卡。
- [正文格式变了，回信解析读不出编号] → D5 两种写法都认，`inbound-parse.test.ts` 用两封正文各测一次；数量行格式不变。
- [数量事实原文可能很长或带内部字样] → 进身份与内部字段检查；模板里这一格自动换行。
- [按组织时区算回复截止，与本次之前的 UTC 算法在个别时刻差一天] → 版式版本本来就升，旧卡不比对；规格写明按组织时区。
- [勾选框与分组让表变高] → 靠去掉两列空白、缩小英文字号换回来。样张脚本实测（真实 Chromium）：14 条 8pt 3 页、7.5pt 2 页；60 条两种字号都是 6 页——验收线（14 条 ≤ 3 页、60 条 ≤ 8 页）已达到；样张脚本把这两条线当成失败条件，改模板后重跑。
- [主规格 `tender/rfq-supplier-attachment` 的 Purpose 还写着「询价单 / 符合性确认表」] → 增量改不了 Purpose，主规格又不手写；归档后这一句与新标题「询价单」不一致，记入报告，留给下一次碰这份规格的 change。
- [参考稿不在仓库] → 按任务书文字做，样张交 Evan 看；字号定之前不合并。
- [内部字段加词误伤招标原文] → 只加「我方 / 内部 / 目标 / our / target / internal」限定的词；`at no additional cost`、`budget` 有反例用例。

## Migration Plan

无数据迁移、无环境变量。合并即生效：之后起草的询价邮件正文是新写法；附件开关仍关。回滚 = revert（revert 后版式版本回到 1，期间起草的带附件卡同样要重新发起）。

## Open Questions

英文对照用 8pt 还是 7.5pt：由 Evan 打印样张后定（任务书 §4 第 6 项）。不影响规格、做法与任务拆分——只改一个缺省值与定版指纹。
