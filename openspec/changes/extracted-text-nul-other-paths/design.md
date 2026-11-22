# Design：其它文字抽取入口入库前清理 U+0000 / 落单代理字符

## Context

动机见 proposal.md「Why」。FIX-13（#546，代码在 `fad35ae2`）新增 `src/lib/files/extracted-text.ts`：`toStorableText`（`:48`，U+0000 → 空格、落单代理字符 → U+FFFD，没有这两类字符时原样返回）、`toStorableParseError`（`:64`，先截 500 字再清理），并让 `extractPdfPagesFromBuffer` 返回清理过的页面文字（`page-parse.ts:124`）。本 change 复用这两个函数，不另立字符规则。下面的行号都以 main `2ef4f9c8` 为准（FIX-13 报告 §7.1 的行号是旧 main `91d928e4` 的，已逐条重核：§7.1 涉及的文件在两个提交之间没有改动（`git diff --stat 91d928e4 2ef4f9c8` 对这些文件为空），行号仍对；任务书里「`attachments.ts:186-190` 写单元」实际是 `:188–193`）。

### 数据库与 Prisma 实际怎么报错（2026-11-22 本机实测）

用本机 PostgreSQL 16.15 新建一个临时库、只建一张带 text 与 jsonb 列的表，用仓库的 Prisma 6.19.2 客户端写入：

| 写入 | 结果 |
|---|---|
| text 列带 U+0000（`create` 与 `createMany` 相同） | `PostgresError 22021 invalid byte sequence for encoding "UTF8": 0x00`（`PrismaClientUnknownRequestError`，没有 `code`） |
| jsonb 列带 U+0000（值里或键名里，`create` 与 `createMany` 相同） | `PostgresError 22P05 unsupported Unicode escape sequence`，DETAIL `\u0000 cannot be converted to text.` |
| text 或 jsonb 列带落单的高位代理字符（含在末尾） | 到不了数据库：`PrismaClientKnownRequestError`，`code = InvalidArg`，`unexpected end of hex escape at line 1 column N`（`update` 相同） |
| text 或 jsonb 列带落单的低位代理字符 | 同上，`lone leading surrogate in hex escape` |
| 成对的代理字符（表情符号） | 正常写入 |
| 用 SQL 直接写 jsonb 的 `\ud800` 转义 | `22P02 invalid input syntax for type json`（Prisma 路径到不了这一步） |
| 先 `JSON.stringify` 再写 text 列（审计 `audit/logger.ts:93–94`） | 不受影响：U+0000 与落单代理字符都被转义成 ASCII 的 `\u0000` / `\ud800` |

另：`JSON.parse(JSON.stringify(x))` 不会去掉这两类字符（报价成本表导入就是这样写 jsonb 的，`import-service.ts:183–184`）；xlsx 0.18.5 读文件时把 `_x0000_` 解成 U+0000，写出 xlsx / xls / csv 再读回都带 U+0000（实测）——Excel 也能把 U+0000 带进来。

### 五个入口逐个核对

| 入口 | 抽字 | 写库点 | 列类型 | 改动前，失败时用户看到什么 |
|---|---|---|---|---|
| 询价回信 | 附件 `tender-rfq/inbound-parse.ts:118–123`（unpdf）、`:151–163`（Word / Excel / 文本），`:164–167` 去首尾空白后判断有没有文字；正文与附件拼接并截到 16000 字 `:176–182`；同一份 `text` 进模型提示（`:437`）与证据核对（`:456`） | 备注拼接 `inbound-apply.ts:200–209`（证据 `:67–69`，附件一栏 `:205–208`）→ `inbound-sync.ts:379`。已报价：`:390` 先把条目改成「已回复」→ `:405` `recordQuote`（`inquiry/service.ts:335` 一条更新写备注与状态）；已回复：`:412` `markItemReplied`（`service.ts:282` 改状态，`:292` 推 `reply.received`）→ `:414` 写备注 | `InquiryItem.quoteNotes` text | 写备注报 22021 或 `InvalidArg` → `inbound-sync.ts:258–272`：记 `rfq_inbound:failed` 审计（它就是幂等键，`:198–201`、`:354–355`，这封信以后不再处理），通知「有一封供应商回信解析失败，请手工录入」（`:430–445`）；条目已经是「已回复」，走「已回复」的还已经推过「收到回复」Muse 事件。**另一种后果不报错**：见下文「证据核对与清理时机」 |
| 采购记录附件 | PDF `procurement-records/attachments.ts:110–113`（unpdf 逐页，`:113` 用原文判断要不要 OCR）；Excel `:135–140`；CSV / TXT `:122–127`（`:124` 含 U+0000 → `CORRUPT`「文本文件含二进制内容」；UTF-8 解码不会产生落单代理字符） | 解析单元 `:188–193`（`RecordsAttachmentUnit.text` / `unitLabel`）；附件 `:194–203`（`sheetRangesJson`）；明细 `:205–243`（`ProcurementLineItem` 的原文片段、产品、规格等；截断在 `extract-pure.ts:254`、`:300`、`:314`） | text / jsonb | 写单元失败不在任何 try 里：附件在认领时已改成 PARSING（`:170–173`），`after()` 只记日志（`api/procurement/requests/[id]/attachments/route.ts:28–34`）；每小时 25 分的 `tender-watch`（`vercel.json:88–89` → `scan-run.ts:500–504`，受 `PROCUREMENT_RECORDS_SCHEMA_READY` 管，`:467`）把认领超过 10 分钟的重新认领（`attachments.ts:35`、`:256`），每次 `parseAttempts + 1`，满 5 次后不再认领。界面一直「解析中」（`labels.ts:197`），分析的缺口一直写「〈文件名〉尚在解析」（`analysis-pure.ts:281`）；重新上传同一份文件直接返回旧记录（`attachments.ts:59–60`，路由只解析新记录 `route.ts:27`）。写明细失败（截断劈开代理对）时附件已经是「已解析」（`:194–203` 在前），明细为零，文件状态与分析没有更新（`:244–248` 没执行），也不再重试 |
| AI 对话附件 | `files/parse-buffer.ts:9–57`，`:82` 截 15 万字；`api/ai/upload-file/route.ts:48–60` 只把文字返回浏览器，不写库 | 服务端校验 `chat-attachments/core.ts:94–139`（新方式）、`:142–154`（旧方式 `fileText`，`:151` 截断）→ `AiMessage.attachments`：`api/ai/threads/[threadId]/messages/route.ts:276–277`、`:421–423`、`:443–445`，`assistant/followup-task.ts:207–219`；`TradeChatMessage.attachments`：`api/trade/chat/[sessionId]/messages/route.ts:44–48`、`:69–76`。市场调研分支：`route.ts:342`（`core.ts:197` 截断）、`:397–398`（截 8 万字）→ `market-intelligence/research-runtime.ts:211`（截 2 万字）→ `:149–153` 写 `MarketResearchRun.inputJson` | jsonb | 写消息报 22P05 或 `InvalidArg`，接口 500（主助手 / 项目「问青砚」经 `withAuth` 返回「服务器内部错误」，`common/api-helpers.ts:39–42`；外贸对话路由没有包装），消息没有存下 |
| 产品资料录入 | `product-content/intake/analyze.ts:216`（`parseFileBuffer`）、`:251`（网页，`:118–133` 截 5 万字）、`:167`（文字）、`:185`（语音转写）→ 事实抽取 `:33–85`（`.trim()` 不去 U+0000） | `:305–312` → `product-content/jobs/service.ts:557–648`（`ProductFact.value` / `normalizedValue` jsonb、`sourceLocation` text；冲突 `ProductFactConflict.currentValue` / `incomingValue` jsonb） | jsonb / text | 写事实不在逐个输入的 try 里（`analyze.ts:160–303`）：抛出后「分析输入」一步停在进行中（`:140–143` 置 running，`:337–346` 才置 done），接口 500「服务器内部错误」（`api/product-content/jobs/[id]/analyze/route.ts:22–29`）；文件类输入已标「已解析」，重跑会重新解析并再次失败。例：规格表一行「☐ Color: Red」→ 抽成「\u0000 Color: Red」，事实照样抽出，原文行带 U+0000 |
| 报价成本表导入 | `quote-engine/import/import-service.ts:154–160`（PDF 走 FIX-13 已清理的逐页取字；Excel / CSV `parse-xlsx.ts:414`）；截断 `parse-xlsx.ts:186`、`:191`、`:238`、`:255`、`:319`、`:334`、`:336`、`:407`，`parse-pdf.ts:57–58`、`:103`、`:109`、`:120`；可引用单元匹配 `import-service.ts:92–110`（按 `Sheet「工作表名」` 前缀对 FIX-13 清理过的单元标签）；AI 归类 `classify-ai.ts:51` 截 300 字 | `import-service.ts:177–189`（`extractedJson` / `reviewJson` / `metadataJson` jsonb，`supplierName` text） | jsonb / text | 被 `:191–195` 接住：导入记为「失败」，`errorMessage` 是 Prisma 报错的前 500 字，界面「抽取失败：…」（`components/quote-engine/cost-import-panel.tsx:65`、`:147`）；失败的记录不挡重新导入（`:132`）。实测：xlsx 单元格「Flag\u0000 nylon 3x5」进了说明与原文片段；超过 300 字的说明在第 300 字处劈开表情符号后以落单高位代理字符结尾 |
| 供应商画册 | `supplier/brochure-parser.ts:175–205` | 不写库：`api/suppliers/parse-brochure/route.ts:60–77` 只返回模型给的字段，表单由人保存 | — | — |

### 询价回信在「询价自动化开关」打开之后怎么跑

1. 发出：发询价卡经人批准后由执行器经 Gmail 发出，把 threadId 写进条目的 `contactNotes`（`tender-rfq/execute.ts:123–137`），这是入站唯一的匹配键。
2. 收信：`vercel.json:92–93` 每 10 分钟调 `/api/cron/tender-rfq-inbound`（`app/api/cron/tender-rfq-inbound/route.ts:16–31`，只校验 `CRON_SECRET`，**没有功能开关**）→ `syncAllOrgsInbound`（`inbound-sync.ts:511`）→ `loadInboundOrgContexts`（`:472–509`：近 90 天发出、状态 sent / replied / quoted / no_response、带 threadId 的条目）→ 逐封 `parseInboundQuote` → `planInquiryItemUpdate` → `applyPlan`；同一次末尾跑催单扫描（`:521–530`）。
3. 开关：CHAIN-0 核查表第 7 项（`docs/QINGYAN_CHAIN-0_ENV_CHECK.md:19`）的三个开关。`TENDER_RFQ_AUTO_DRAFT_ENABLED`（`tender-rfq/auto-draft-flags.ts:19–24`）打开后，要求审核与批准分析的四个接口（`tender-analysis/runs/[runId]/approve`、`requirements/[requirementId]/confirm`、`…/reject`、`requirements/batch-confirm`）调 `maybeAutoDraftRfq`（`auto-draft-service.ts:55`）自动起草第 1 轮发询价卡；`TENDER_RFQ_SUPPLIER_GROUPS_ENABLED` 让自动起草按分组选供应商；`TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED`（`followup-flags.ts:21`）让批准过的卡授权范围内的催单 / 缺字段追问逐封建审批记录后由系统发出。三个开关都不碰入站代码，但让发出去的询价与同一线程里的回信变多，入站这一步全程没有人看着。
4. 所以入站这条路今天对人工发出的询价已经在跑；开关打开后量变大、依赖它的自动步骤变多。修复必须在开关打开之前上线（见「上线顺序」）。

### 证据核对与清理时机（核实）

入站只有一份 `text`：它进模型提示，也用来核对证据、币种与起订量（`inbound-parse.ts:432–456`）。证据闸先 NFKC、去掉所有空白再比（`inbound-contract.ts:59–69`），U+0000 不是空白。用 FIX-13 的夹具现拼一份 PDF（同一行「Unit price CAD 12.50 per flag」+ 一个被抽成 U+0000 的字形 +「Delivery 30 days」），在 main 上用假模型跑 `parseInboundQuote` 与 `planInquiryItemUpdate`：

| 模型给的价格证据 | main 上的结果 |
|---|---|
| 「Unit price CAD 12.50 per flag Delivery 30 days」（勾选框处写成空格，真实模型最可能这样） | `prices[0]` 记 `EVIDENCE_NOT_IN_TEXT`，价格被作废——**不报错、不通知**，备注写「回信涉及报价但未提取到可核验字段」 |
| 「Unit price CAD 12.50 per flag \u0000Delivery 30 days」（照抄 U+0000） | 通过核对，备注带 U+0000 → 写库 22021 → 上表的失败路径 |
| 「Unit price CAD 12.50 per flag」（不跨过勾选框） | 正常 |

结论：清理必须作用在这一份共用的 `text` 上（送模型之前、核对之前同时生效）。只清提示：模型照清理后的文字抄的证据对不上原文。只在写库前清：第一行的价格照样被作废。两边都清之后，规范化后的 `text` 里不可能有 U+0000，带 U+0000 的证据一定核对不上，所以经证据进备注的 U+0000 不会再出现；落单代理字符还有一个缝——证据以半个表情符号结尾时，按码元仍能在原文里找到——由写备注前的清理兜住。

其它入口没有模型核对证据：采购明细与产品事实都由确定性规则从同一份文字里取，在取之前清理，原文片段与取出的值就一致；报价成本表的「证据」是行原文片段与可引用单元，匹配可引用单元靠工作表名对 FIX-13 清理过的单元标签，所以也要在匹配之前清理；AI 对话附件没有证据核对，存下的与送模型的是同一份。

### FIX-13 报告 §7.1「只扫到、没有追到写库」的四处

| 入口 | 追查结果 | 处理 |
|---|---|---|
| 外贸客户线索导入 `api/trade/prospects/import/route.ts` | `:47–58` 用 `file.text()`（UTF-8）或 SheetJS 读；`:72–77` 先拿全部公司名查重，公司名带 U+0000 时这条查询本身就报 22021（查询参数带 U+0000 同样被拒，实测；不在 try 里，整个请求 500）；`:89–105` 逐行建线索，逐行 catch，报错进返回的 `errors` | Out of scope（G4） |
| 展会名片 `trade/booth-cards.ts` | 解析接口 `api/trade/booth-cards/parse/route.ts:41–43` 不写库，只把卡片返回浏览器预览；录入接口 `api/trade/booth-cards/ingest/route.ts:39–47` 逐张收浏览器提交的卡片 | Out of scope（G4） |
| 客户 CSV `api/sales/import-csv/route.ts` | `:31–40` `file.text()` → `importCustomersCsv`（`sales/csv-import.ts:131`），失败整体返回 500「导入失败，请检查文件格式」 | Out of scope（G4） |
| 知识库导入 `api/org/knowledge/import`、`api/trade/knowledge/import`、`api/projects/[id]/knowledge-bases/[kbId]/import` | 只收 .md / .txt / .zip（`blob.text()` 或解压）；逐个文件建文档、没有逐个 try（`knowledge/org-knowledge.ts:140–167`），一个坏文件让后面的都不导入、前面已建的留着；接口返回 400 带报错原文（`api/org/knowledge/import/route.ts:103–108`） | Out of scope（G4） |

四处的共同点：同步请求、导入人自己的表格或 Markdown、失败在同一个请求里报出来、不停在中间状态、不在后台重试、不在询价自动化路径上、文字不经 PDF / Word 解析器。

## Goals / Non-Goals

**Goals:**
- 五个入口不论 unpdf / mammoth / xlsx / 网页 / 邮件给出什么文字，写库都不因这两类字符失败。
- 询价回信跨过勾选框的证据能通过核对；送进模型与核对证据的是同一份文字。
- 询价回信这一条在询价自动化开关打开之前上线。

**Non-Goals（不动的模块 / 文件）:**
- FIX-13 的 `src/lib/files/parse-content.ts`、`src/lib/tender-auto-analysis/page-parse.ts` 与 `toStorableText` / `toStorableParseError` / `decodeTextFile` 的规则：不改（只在 `extracted-text.ts` 里加一个遍历函数）。
- `src/lib/files/parse-buffer.ts`、`src/app/api/ai/upload-file/route.ts`：不改（D5）。
- `src/lib/tender-rfq/inbound-sync.ts`（编排、失败处理、幂等、游标）、`src/lib/tender-rfq/inbound-contract.ts`（证据闸）、`src/lib/inquiry/service.ts`、`src/lib/tender-rfq/chase-*.ts`：不改。
- `src/lib/procurement-records/extract-pure.ts`（截断长度、`pageNeedsOcr` 的 20 字阈值）与附件的认领 / 重试（`PARSE_STALE_MS`、5 次上限、`FAILED` 不重试）：不改（D4）。
- `src/lib/quote-engine/import/parse-xlsx.ts`、`parse-pdf.ts`、`classify-ai.ts`：不改（D7）。
- `src/lib/product-content/jobs/service.ts`、`src/lib/product-content/facts/conflict.ts`：不改（D6）。
- `src/lib/muse-bridge/**`、`src/lib/tender-rfq/tracking-notify*.ts`、`src/lib/notifications/**`、`src/lib/audit/logger.ts`：不改。
- `src/lib/supplier/brochure-parser.ts` 与上表四处导入接口：不改。
- `prisma/`、`package.json`、`vercel.json`：不改。

## Decisions

### D1 复用 FIX-13 的清理函数；JSON 形状的数据加一个遍历函数

所有文字都经 `toStorableText`；报价成本表的抽取结果、采购明细这类 JSON 形状的数据，用一个新加在 `src/lib/files/extracted-text.ts` 的遍历函数对每个字符串（含键名）调用 `toStorableText`，数组与对象逐层处理，数字、布尔、null 原样。它不是第二条字符规则，用例补进 FIX-13 已注册的 `extracted-text.test.ts`。

- 否决：各入口自己写替换。规则会分叉（FIX-13 选了空格而不是删掉，有理由，见 FIX-13 design D1）。
- 否决：在 Prisma 扩展里统一清理所有写入。影响全库所有写入，FIX-13 D2 已否决。
- 否决：报价成本表逐字段清理。字段多（说明、AI 给的说明 `suggestedDescription`、原文片段、备注、单位、分节、工作表名、警告、对账结果…）且随抽取版本增减，漏一个就整份失败。

### D2 清理时机：判断 / 比对 / 送模型之前清一次，之后还截断或拼接的写库前再清一次

每个入口在抽取结果出来之后、第一次被判断（有没有文字、要不要 OCR）、比对（证据、工作表名）或送进模型之前清理；之后还会被截断或拼接、并且要写库的，写库之前再清理一遍（截断会劈出新的落单代理字符，实测：询价 16000 字截断后以 `\ud83d` 结尾，成本表说明 300 字截断后同样）。逐入口：

| 入口 | 第一次（判断 / 比对 / 送模型之前） | 写库前再清 |
|---|---|---|
| 询价回信 | 每个附件的文字与文件名，在判断有没有文字之前；拼好并截到 16000 字的整段文字（模型与证据核对共用） | 这次追加的整段报价备注 |
| 采购记录附件 | PDF 每页文字在判断要不要 OCR 之前；工作表文字、单元标签、工作表名在写单元之前 | 每条明细（截断之后） |
| AI 对话附件 | 服务端收下附件时，在校验之前（存与送模型都是这一份） | 市场证据在最后一次截断（2 万字）之后 |
| 产品资料录入 | 每个输入的文字在抽取事实之前 | 不需要（事实只是这段文字的子串，没有再截断） |
| 报价成本表导入 | 抽取结果在匹配可引用单元与 AI 归类之前 | 整份抽取结果与供应商名在写导入记录之前；失败原因经 `toStorableParseError` |

- 否决：只在写库前清。询价回信跨过勾选框的价格照样被作废（上文核实）；采购附件只有 U+0000 的页仍判为「可读」；成本表工作表名带 U+0000 时对不上 FIX-13 清理过的单元标签。
- 否决：只在抽取处清。之后的截断会劈出新的落单代理字符。

### D3 询价回信：附件、整段文字、备注三处，再加一句备注

1. `inbound-parse.ts` 抽附件时：文字与文件名先清理，再按去首尾空白后是否为空判断「附件无可提取文本（可能是扫描件）」（与 FIX-13「先清理再判断近乎空白」同理；只有 U+0000 的附件以前被记成「已解析」）。同时记下这个附件被换掉的 U+0000 个数。
2. 拼好、截到 16000 字之后再清理一遍：这份就是送模型的、核对证据的、判断币种与起订量的 `text`。
3. `inbound-apply.ts` 生成这次追加的备注之后清理一遍（兜住半个表情符号的证据）；附件被换掉过 U+0000、仍记为已解析的，在附件一栏它的「已解析」后注明「（有 N 处无法识别的符号，可能是勾选框，请对照原件核对）」（见 G5）。

- 否决：证据核对时把 U+0000 当成空白。改了证据闸的语义，模型仍看到 U+0000，也解决不了落单代理字符。
- 否决：只清提示、不清核对用的文字。模型照清理后的文字抄的证据对不上原文。
- 否决：在 `inbound-sync.ts` 的 `applyPlan` 里清备注。`applyPlan` 只在默认依赖里，纯函数测试碰不到；在生成备注的纯函数里清，测试不用数据库。

### D4 采购记录附件：页面先清理再判断；写库异常的重试语义不改

PDF 每页先清理再调 `pageNeedsOcr`（与 FIX-13 D2 相同）；工作表文字、单元标签、`sheetRangesJson` 里的工作表名在写之前清理；明细在 `extractLinesFromUnits` 之后、`createMany` 之前整条过遍历函数（截断在 `extract-pure.ts` 里，清理放在写库边界，不改那里的截断）。CSV / TXT 的读法与「含 U+0000 即文件损坏」不变（见 G3）。

- 否决：把 `:188–243` 包进 try，写库失败改记 `FAILED`。`FAILED` 不会被定时任务再认领（`:171`、`:256` 只认 PENDING / PARSING），数据库一时连不上这种暂时性错误会变成永久失败，而 `FAILED` 的标签写的是「解析失败（稍后重试）」（`labels.ts:203`），说了假话。字符原因清理之后已经消失，暂时性错误保留现在的「过期后重试、最多 5 次」更合适；5 次之后停在「解析中」、没有原因，是另一个问题（Out of scope，已停住的附件见 G1）。
- 否决：在 `extract-pure.ts` 里把截断改成不劈开代理对。要改的截断点散在各处，以后新增的截断还会漏；写库边界只有一处。

### D5 AI 对话附件：在服务端校验附件的那一处清理

`chat-attachments/core.ts` 的新旧两种入口（`parseAttachmentsInput`、`attachmentsFromLegacyFile`）先清理文件名与正文，再做「有没有可分析的文本」与长度校验（替换一个换一个，长度不变）。三个路由与跟进任务拿到的都是这一份，存消息、送模型、拼市场证据都不用再各自处理。市场证据在 `research-runtime.ts:211` 截到 2 万字之后再清理一遍。新方式下正文清理后只剩空白的，按既有的「附件「…」没有可分析的文本内容」以 400 拒绝；旧方式按既有的「空文字视为没有附件」处理。

- 否决：在 `parse-buffer.ts` 统一清理。浏览器提交的附件不可信（旧客户端、缓存的页面、手工构造的请求都能带 U+0000），服务端仍要再清；产品资料的网页与语音来源也不经过它。
- 否决：在三个路由与跟进任务的四处写库前分别清。四处里漏一处就失败；校验只有一处，而且是「浏览器来的数据不可信」的既有边界（`core.ts:93` 的注释）。
- 不改：附件的 `blobPath`（只认既有前缀、不含 `..`）与 `mime`（正则校验）不是抽取出的文字，不在本次清理范围。

### D6 产品资料录入：在事实抽取的入口清理

`analyze.ts` 的事实抽取函数（`:33`）开头先清理传进来的文字，文件里的 PDF 与 Excel、网页、文字、语音转写都经过它（网页文字在 `:129` 截 5 万字之后才进来，所以这一处也兜住截断）。这样抽出的值照旧 `.trim()` 掉首尾空白，原文行同理（「\u0000 Color: Red」→「Color: Red」）。

- 否决：在 `jobs/service.ts` 写事实时清理。U+0000 在值的首尾时会留下首尾空格（「Red 」）；值、规范值、原文行、冲突记录的两列要在三处写入里逐列清（`:581–594`、`:600–626`、`:638` 起），漏一列就失败。

### D7 报价成本表导入：抽取后清一次，写库前再清一次

抽取结果出来之后马上过遍历函数（之后匹配可引用单元、送 AI 归类用的都是清理后的）；写 `quoteCostImport.update` 之前，整份抽取结果与供应商名再过一次（AI 归类给的说明（`suggestedDescription`）在 `classify-ai.ts:51` 截 300 字，可能劈开代理对）；`catch` 里的失败原因由 `e.message.slice(0, 500)` 改为 `toStorableParseError(e.message)`（同样 500 字上限，外加清理）。

- 否决：只在写库前清一次。工作表名带 U+0000 时，行的 `Sheet「…」` 前缀对不上 FIX-13 清理过的单元标签，行就丢了可引用单元。
- 否决：改 `classify-ai.ts` 的截断。只为一个字段，而写库前的清理已经兜住。

### D8 测试：一个不用库的、一个隔离库的，夹具现拼

- `src/lib/files/__tests__/extracted-text-other-paths.test.ts`（不用数据库，进 CI 子集）：真实 unpdf 读 FIX-13 夹具 `src/lib/tender-auto-analysis/__tests__/fixtures/nul-pdf.ts` 的 `buildPdf` / `buildCheckboxPdf` 现拼的 PDF；测试里用 SheetJS 现拼带 `_x0000_` 的 xlsx；字符串现拼表情符号劈开的场景。询价回信用两个假模型：一个在勾选框处写空格，一个原样照抄它收到的那一行（这样同一个测试在改动前因备注带 U+0000 / 价格被作废而失败、改动后通过，不必猜真实模型的行为）。另加接线断言（读源码）：产品资料四种来源（文件、网页、文字、语音转写）都经同一处清理、成本表失败原因经收口、三个对话路由只用校验后的附件写库。
- `src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts`（隔离库，只进 `scripts/test-all.sh`）：五个入口各走一遍真实写库——询价回信用 `defaultInboundSyncDeps()` 换掉 Gmail 与模型、保留真实的 `applyPlan` / `writeAudit` / 通知；采购附件用 `processAttachment(id, { readBuffer })`；AI 对话写 `AiMessage` / `TradeChatMessage` 与 `queueMarketResearchRequest`；产品资料用本地文件存储跑 `analyzeJobInputs`；成本表跑 `createImportFromUpload`。每个入口先在改动前的代码上看到失败（输出贴进报告）。
- 否决：每个模块各建两个测试文件。十个文件、十次注册，同一条规则的测试散在五处。
- 否决：用真实客户文件做夹具（与 FIX-13 D6 同理）。

### D9 规格放一个新能力 `platform/extracted-text-storage`

五个入口共用一条规则，规格按「哪个入口在什么时候清理、清理后对外看到什么」逐条写，放在一处。

- 否决：分别加进各自领域的规格。五个入口里只有采购附件有现成能力（`procurement/disclosure-analysis`），询价回信入站、AI 对话附件、产品资料、报价成本表导入都没有；为一条规则新建四个只有一两条要求的能力，同一条规则散在五处。`procurement/disclosure-analysis`「解析与阻塞」的要求本身不变（只是只有 U+0000 的页现在落进「有效文字过少」）。

## 上线顺序

1. FIX-13（#546）先合并：本 change 依赖它的 `toStorableText` / `toStorableParseError` 与测试夹具。
2. FIX-14 合并并部署到生产（没有开关，部署即生效）。
3. **之后**才能打开 CHAIN-0 核查表第 7 项的三个询价开关（`TENDER_RFQ_AUTO_DRAFT_ENABLED`、`TENDER_RFQ_SUPPLIER_GROUPS_ENABLED`、`TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED`）。开关打开的日期由有生产权限的人填进 `docs/QINGYAN_CHAIN-0_ENV_CHECK.md` 第 7 行，那一天必须晚于本 PR 的部署日期。
4. 若开关要在整个 FIX-14 合并之前打开，按 G2 选 B：tasks 1.1 单独成一个 PR 先合（它只动 `tender-rfq/inbound-parse.ts`、`inbound-apply.ts` 与两个新测试文件，不依赖其余几条）。

入站这条路对人工发出的询价今天已经在跑（第 2 节），所以第 2 步越早越好，不只是为了开关。

## 与八条硬纪律的关系

1. 零 schema：遵守——不加模型、字段、迁移；只改写入前的字符串。
2. 出站先审批：不新增任何出站。说明：修好之后，以前写库失败的那类回信会正常入表；入表后同一次检查里的催单扫描按既有规则（`chase-pure.ts:325–341`：已回复 / 已报价、仍缺字段、没追问过）起草缺字段追问卡，经人批准或既有的跟进授权（RFQ-AUTO-1，逐封建审批记录、以批准该轮的人的身份执行）才发出。改动前这类回信没有写下 `[auto]` 备注，`currentMissingFields` 返回空（`chase-pure.ts:110–113`），不会起草追问——这是写库失败的副作用，不是设计。
3. 禁止第三套队列：不涉及——复用既有的 `tender-rfq-inbound` cron、`tender-watch` cron 里的附件兜底与 `after()`；认领与重试不改。
4. 脱敏：遵守——清理只替换字符；不新增任何输出位置。询价通知与 Muse 事件本来就不读报价备注与证据（`tender-rfq/tracking-notify*.ts`、`muse-bridge/hooks.ts` 里没有 `quoteNotes` / `evidence`），审计照旧只记结构化字段与证据片段；规格「清理不扩大对外内容」写明 SHALL NOT。
5. 不爬登录页：不涉及（产品资料的网页抓取是既有行为，不改）。
6. 邮箱分离：不涉及（入站仍按组织设置的 `mailboxEmail` 找邮箱，`inbound-sync.ts:158–160`）。
7. 确定性优先：遵守——纯字符替换与计数，没有新增模型调用；询价回信的模型提示只在这两类字符处与以前不同。
8. 测试注册：`extracted-text-other-paths.test.ts`（进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`）、`extracted-text-other-paths-db.isolated.test.ts`（进 `scripts/test-all.sh`）在 tasks 1.1 同一步注册；遍历函数的用例进 FIX-13 已注册的 `extracted-text.test.ts`；`bash scripts/check-test-registry.sh` 通过。

## 验证方式

- `env -u DATABASE_URL -u DIRECT_URL npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts`：五个入口的纯函数与接线断言；询价回信两个假模型在改动前分别失败（`EVIDENCE_NOT_IN_TEXT`、备注带 U+0000）。
- `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts`（本机隔离库）：五个入口真实写库成功；在改动前的代码上失败（22021 / 22P05 / `InvalidArg`，采购附件停在 PARSING）——输出贴进报告。
- `npx tsx src/lib/files/__tests__/extracted-text.test.ts`：遍历函数的用例。
- 既有：`src/lib/tender-rfq/__tests__/inbound-parse.test.ts`、`inbound-apply.test.ts`、`src/lib/trade/__tests__/chat-attachments.test.ts`、`src/lib/quote-engine/__tests__/quote-import.test.ts`、`src/lib/procurement-records/__tests__/disclosure-analysis-pure.test.ts`、`procurement-records-db.isolated.test.ts`、FIX-13 的 `page-parse.test.ts` 照旧通过。
- `npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-ci-unit.sh`（末行 `CI unit subset PASS`）、`bash scripts/test-runtime-architecture.sh`、`npm test`（对照既有失败清单）、`openspec validate extracted-text-nul-other-paths --strict`、`git diff origin/main -- prisma/ vercel.json package.json package-lock.json` 为空。

## Risks / Trade-offs

- [U+0000 原本代表的字形（勾选框等）在文字里看不出来] → 与 FIX-13 相同；与「整份失败」相比是净改进。
- [询价回信：以前因跨过 U+0000 被作废的字段现在能通过核对] → 这是修正；但勾选框式的选项表（「☐ EXW ☐ FOB ☐ DDP」）清理后只剩选项文字，模型挑出的那个可能没有依据，而证据闸只查「证据在原文里、值在证据里」。回信是唯一不经人审就自动入表的入口（采购明细、成本表、产品事实都要人复核），所以只在回信的备注里注明「有 N 处无法识别的符号…请对照原件核对」（D3 第 3 点，G5）。没有核实同一字体里勾选与未勾选的字形是否都抽成 U+0000（附录 B 的是未勾选框）。
- [采购附件里有效文字不足 20 个、但加上 U+0000 够 20 个的页改判「需要 OCR」] → 这类页以前写库失败，没有「可读」的历史结果可比。
- [AI 对话：正文只有 U+0000 的附件由 500 变成 400 并带原因] → 修正；旧客户端的这类附件被当作没有附件（与旧客户端传空文字时相同）：有消息正文时照常发出，没有正文时按既有规则返回「消息不能为空」。
- [已经失败的历史数据不会自己恢复] → 采购附件重试次数没用完的，下一个整点 25 分自动重试成功；用完的见 G1；询价回信已记失败的不会再处理（幂等），仍需人工录入；产品资料与成本表重新点一次分析 / 重新导入即可；对话消息重新发送。报告写明上线后怎么查。

## Migration Plan

无数据迁移、无开关。合并部署即生效；回滚 = 回退本 PR。上线后：① 查生产 `RecordsAttachment` 里 `parseStatus = 'PARSING' AND "parseAttempts" >= 5` 的条数（按 G1 处理）；② 查 `AuditLog` 里 `action = 'rfq_inbound:failed'` 且 `afterData` 含 `22021` 或 `hex escape` 的回信，列给项目负责人人工录入；③ 「分析输入」一步停在进行中的产品资料任务、「失败」的成本表导入，由使用人重新点一次；④ 然后才按「上线顺序」第 3 步打开询价开关。

## 留给 GATE

**G1 已经停在「解析中」、重试次数用完的采购附件怎么办**
- A：不写补救代码。上线后由有生产权限的人查 `parseStatus = 'PARSING' AND "parseAttempts" >= 5` 的条数；没有就结束；有就按既有的生产操作流程（Owner Gate）把这几条的 `parseAttempts` 改成 0（`parseStartedAt` 已经超过 10 分钟），下一个整点 25 分的 `tender-watch` 会重新解析。后果：零代码；需要一次人工生产操作。
- B：本 change 加一个「重新解析」接口与按钮。后果：新增对外行为与权限判断，tasks 超过 8 条，要拆 change。
- 推荐 A：生产上是否开了 `PROCUREMENT_RECORDS_SCHEMA_READY`、有没有这样的附件都没核对，为零时 A 没有任何成本；B 是新功能，不该夹在修复里。

**G2 询价回信要不要拆成独立 change 先合**
- A：不拆。7 条 tasks，询价回信排第一，一个 PR 审一次。后果：开关要等整个 FIX-14 合并部署。
- B：拆。询价回信（tasks 1.1）单独成 FIX-14a 先合，其余四个入口为 FIX-14b。后果：开关可以早几天开；多一个 PR、一次多维审查、一次归档。
- 推荐 A，附条件：如果 Evan / Lucas 计划在 FIX-14 整体能合并之前就打开开关，改选 B。1.1 只动两个文件与两个新测试，单独拆出来不需要改动其它 task。

**G3 采购附件的 CSV / 纯文本要不要改用 FIX-13 的解码方式**
- A：不改。仍按 UTF-8 读，含 U+0000 一律「文件损坏 · 文本文件含二进制内容」。后果：带字节序标记的 UTF-16 CSV（Excel「Unicode 文本」导出的就是）继续被判损坏，但失败是看得见的，不是写库失败。
- B：改用 `decodeTextFile`。后果：带字节序标记的 UTF-16 能读；U+0000 合计不超过 10% 的文件不再判损坏，U+0000 换成空格；采购侧的行为变化要有人确认。
- 推荐 A：本次修的是「写库失败 / 卡住」，这一条现在不卡；政府披露文件常见什么编码没有数据，等有真实样本再定。

**G4 FIX-13 §7.1 只扫到的四处导入（外贸客户线索、展会名片、客户 CSV、三个知识库导入）要不要另开任务**
- A：不另开，写进 FIX-14 报告「没做的」。后果：这几处遇到带 U+0000 的文件时当场报错（外贸客户线索整个请求 500；知识库导入一个坏文件让后面的都不导入），导入人可以改文件重传。
- B：登记一个新任务，按本 change 的做法逐个清理。后果：多一个 change；目前没有遇到过的案例。
- 推荐 A：失败当场可见、可以重来、不在任何自动化路径上；等出现真实案例再开。

**G5 询价回信的附件里有 U+0000 被换掉时，要不要在报价备注里注明**
- A：不注明。后果：勾选框式选项表上，模型挑出的选项可能没有依据，人只有翻原件才会发现。
- B：注明（本稿已按 B 写进规格与 tasks 1.1）：附件一栏在「已解析」后写「（有 N 处无法识别的符号，可能是勾选框，请对照原件核对）」，只进报价备注，不进通知与 Muse，不改入表与核对规则。后果：这类回信的备注多一句话。
- C：附件里有 U+0000 时，跨过它的证据一律不采信。后果：回到改动前的作废行为（更严），正是本次要修的问题之一。
- 推荐 B：回信是五个入口里唯一不经人复核就自动入表的，一句确定性的提示成本最低；选 A 则删掉规格里「询价回信附件里有被换掉的 U+0000 时在报价备注里注明」这条要求与 tasks 1.1 里对应的一句。
