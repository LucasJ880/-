# FIX-14 报告：其它文字抽取入口写库前清理 U+0000 / 落单代理字符

> **白话说明（合并后谁会发现什么变了）**：供应商回信、采购记录附件、AI 对话、产品资料、报价成本表这几处，以前碰上 PDF 里的勾选框（抽不出字的符号），或者文字被截断时正好切开一个表情符号，就存不进库——回信显示「解析失败，请手工录入」，附件一直「解析中」，对话发不出去，产品资料任务停在「分析中」，成本表「抽取失败」，回信里跨过勾选框的价格还会被悄悄丢掉；合并之后这些都能正常存下，价格也能对上。询价回信的附件里有这种符号时，项目「投标」页询价表的「备注」列里（格子截断，要把鼠标放上去看全文）会多一句「（有 N 处符号没读出来，已当空格处理，多半是勾选框；请打开原件核对勾选项和价格）」；AI 对话里只有这种符号、没有字的文档，上传时就会提示「没有可提取的文字（扫描件请直接传图片）」。合并之前已经失败的回信、附件、分析和导入不会自动补，也不会再发通知：要由有生产数据库权限的人按 §9 查出名单，交给项目负责人或创建人补录、重跑。

| 项 | 值 |
|---|---|
| change | `extracted-text-nul-other-paths`（已归档到 `openspec/changes/archive/2026-11-23-extracted-text-nul-other-paths/`；新能力 `platform/extracted-text-storage`，14 条要求） |
| TASKFLOW | FIX-14（Phase F（续）— 情报串联表，紧接 FIX-13），另登记 9 条「编号待定」后续任务与 FIX-24 一行 |
| PR | #569，2026-11-23 合并（合并提交 `07759375`）；归档后 `openspec validate --specs --strict` 159 / 159 |
| 依赖 | FIX-13（#546，main `13c7ed33`）：复用 `toStorableText` / `toStorableParseError` 与夹具 `src/lib/tender-auto-analysis/__tests__/fixtures/nul-pdf.ts` |
| GATE | Lucas 2026-11-22：G1 A、G2 A、G3 A、G4 A、G5 B、G6 A（见 §10）；G5-B 的措辞按文案审查调整（Lucas 授权按推荐） |
| 分支 | `claude/zen-turing-azudvx-fix14`；四件套定稿提交 `e889c585`；开工时合入 main `d94e4323`，多维审查修订前合入 main `2a0eb964`（都不 rebase；`openspec/config.yaml` 取 main 的） |
| 性质 | 修写库失败与证据被误作废。零 schema、零新模型调用、没有新增出站、没有新队列 / 定时任务、不改 `src/lib/muse-bridge/**`。**没有开关，合并即在生产生效** |

## 1. 开工前复核

- 开工顺序（与四件套原写的不同，已按事实改四件套）：原定 FIX-19 合并后再开工。FIX-19 未合并（等生产只读查询结果），协调会话按交接文档 §0.5k 第 9 条的例外（不碰 FIX-19 文件的 change 可以先走）让 FIX-14 先开工。FIX-19 改的文件（`src/lib/files/document-source.ts`（新）、`src/app/api/projects/[id]/files/route.ts`、`src/lib/tender-auto-analysis/{package,package-ready,package-coverage,reply-resolution,display-labels}.ts`、`src/lib/tender-understanding/package-input.ts`、`src/lib/files/intelligence-extractor.ts`、`src/lib/tender-analyst-memo/v2/pipeline.ts`）与本 change 没有共同代码文件；两边都改 `scripts/test-all.sh`、`scripts/test-ci-unit.sh` 与 TASKFLOW，FIX-19 后合并时由它合入 main。
- 合入 main `d94e4323`（含 FIX-13 / 17 / 21 / 23、CHAIN-4c / 2b / 3b / 3c、BIDPAGE-1 等）后：本 change 要改或引用的代码文件在 `13c7ed33..d94e4323` 之间没有改动（`git diff --stat` 只有 `scripts/test-all.sh`、`scripts/test-ci-unit.sh`），四件套里的行号逐条与代码对过，都对；`grep -c "| 待定 |"` 原有 17 条。多维审查后又合入 main `2a0eb964`（含 #536 / #539 / TREE-1 #559 等）：本 change 的代码文件仍没有被 main 改动，只有 `openspec/config.yaml`（取 main 的）与两个测试脚本多了别人的行；「| 待定 |」原有 19 条。
- 开工前跑了将要触碰模块的已注册测试，记下基线（全过）：`extracted-text` 42、`inbound-parse` 38、`inbound-apply` 72、`notes-parse` 17、`chat-attachments` 54、`quote-import` 74、`disclosure-analysis-pure` 50、`priority-conflict` 10、`durable-followup-pure` 73、`mail-untrusted-guard` 56、`tool-list-modules` 37、`mail-tool-visibility` 69、`effective-platform-role` 63、`digital-employee` 50、`residual-reads` 76、`page-parse` 29、`procurement-records-db.isolated` 158、`tracking-notify-wiring` 67。

## 2. 做了什么

规则与 FIX-13 完全相同，不另立：每个 U+0000 换成一个空格，每个落单的 UTF-16 代理字符换成 U+FFFD，其余字符原样，前后字数相同；不含这两类字符的文字逐字不变（`toStorableText` 没有这类字符时原样返回同一个字符串）。JSON 形状的数据用新加的 `toStorableJson`（`src/lib/files/extracted-text.ts`）按结构遍历，对每个字符串（含键名）调 `toStorableText`，只往数组与普通对象（含原型为 null 的对象）里递归，不改传进来的值。

| 入口 | 改了哪里 | 改动前（实测） | 改动后 |
|---|---|---|---|
| 询价回信 | `src/lib/tender-rfq/inbound-parse.ts`：每个附件的文字与文件名先清理再判断有没有文字，并记下被换掉的 U+0000 个数（校验后类型 `attachmentsSeen` 每项可选 `nulCount`，只在大于 0 时出现；邮件正文里的 U+0000 不计数）；正文与附件拼好、截到 16000 字之后再清理（模型与证据核对共用这一份）。`src/lib/tender-rfq/inbound-apply.ts`：这次追加的整段报价备注写库前清理；附件一栏「已解析」后加那句提示 | 模型在勾选框处写空格：价格证据 `EVIDENCE_NOT_IN_TEXT` 被作废，不报错、不通知，条目变「已回复」、备注「缺：价格」；模型照抄：备注带 U+0000，`recordQuote` 写库失败（报错只留前 300 字，22021 被截掉，只看得到 ``Invalid `db.inquiryItem.update()` invocation…``），记 `rfq_inbound:failed`，通知「有一封供应商回信解析失败，请手工录入」，条目停在「已回复」 | 两种模型都通过核对：单价 12.5、交期 30 天入表，条目「已报价」，照常发「报价了」通知与既有 Muse 事件（带 / 不带勾选框的同一封回信，新增通知逐字相同）；备注附件一栏「附件：q.pdf 已解析（有 1 处符号没读出来，已当空格处理，多半是勾选框；请打开原件核对勾选项和价格）」；只有 U+0000 的附件记「附件无可提取文本（可能是扫描件）」 |
| 采购记录附件 | `src/lib/procurement-records/attachments.ts`：PDF 每页文字先清理再判断要不要 OCR；工作表文字、单元标签、`sheetRangesJson` 的工作表名先清理；明细写库前整条过 `toStorableJson`。CSV / TXT 不改（G3-A） | 勾选框 PDF / xlsx 单元格 `_x0000_`：写解析单元报 22021，附件停在「解析中」；一行明细在第 1000 字处劈开表情符号：附件「已解析」、明细为零、按口径分析没跑（`InvalidArg`） | 都「已解析」，页文字「…check the box.\n  The Bidder declares…」，只有 U+0000 的页标需要 OCR；长明细入库、原文片段以 U+FFFD 结尾、待复核，分析照常多一个版本 |
| AI 对话附件与对话标题 | `src/lib/chat-attachments/core.ts`：新方式先清理文件名与正文再判空与长度；旧方式截断（文件名 200 字、正文 15 万字）之后清理，清理掉东西且只剩空白时按没有附件处理，文件名被清理改动时再去首尾空白；新增 `storableTitle`（截断再清理）。6 处标题改用它：`src/app/api/ai/threads/[threadId]/messages/route.ts` 3 处（`:432`、`:721`、`:1242`，60 字）、`src/app/api/trade/chat/[sessionId]/messages/route.ts` 1 处（`:124`，30 字，「...」在清理之后拼）、`src/lib/assistant/followup-task.ts` 1 处（`:236`，60 字）、`src/lib/assistant/dispatch.ts` 1 处（`:196`，主助手分流落库，60 字，多维审查补上）。`src/components/chat-attachments/use-chat-attachments.ts:129`：浏览器上传判空按同一条规则。`src/lib/market-intelligence/research-runtime.ts`：市场证据截到 2 万字后清理 | 附件正文带 U+0000：写消息 22P05，接口 500，消息没存下；旧客户端文件名 / 标题 / 市场证据在截断处劈开表情符号：`InvalidArg`（外贸对话是消息与回复都已存、模型已调用之后才 500）；只有 U+0000 的文档在浏览器里显示可发送 | 消息存下、附件正文该处为空格；标题写入成功，末尾会显示一个「�」；调研任务建成（等待研究）；只有 U+0000 的文档上传时就提示「没有可提取的文字（扫描件请直接传图片）」，服务端收到这样的附件返回 **400「附件「〈文件名〉」没有可提取的文字（扫描件请直接传图片）」**；没有这两类字符、正文本来就是空白或缺字段的附件（含图片正文为空）照旧 400「附件「〈文件名〉」没有可分析的文本内容」，逐字不变 |
| 产品资料录入 | `src/lib/product-content/intake/analyze.ts`：事实抽取函数第一步清理传进来的文字（文件 PDF / Excel、网页、文字、语音转写四种来源都经这一处） | 规格 PDF 一行「\u0000 Color: Red」：写事实 22021，「分析输入」停在 running，任务停在「分析中」（ANALYZING），接口 500，每次重跑一样；Excel 文字在 15 万字截断处劈开表情符号同样失败 | 事实 color = Red、原文行「Color: Red」，这一步完成，任务按缺字段照常到 NEEDS_INPUT / PLAN_READY；劈开处的事实值以 U+FFFD 结尾 |
| 报价成本表导入 | `src/lib/quote-engine/import/import-service.ts`（只改 `createImportFromUpload` 内部）：抽取结果出来马上整份过 `toStorableJson`（对可引用单元与 AI 归类之前）；写导入记录前抽取结果、元数据与供应商名再清理一遍（AI 归类给的说明在这之后才定）；失败原因 `e.message.slice(0, 500)` → `toStorableParseError(e.message)` | 三份夹具（说明格带 `_x0000_`、说明第 300 字处劈开表情符号、工作表名带 `_x0000_`）整份导入都「失败」，`errorMessage` 含 `22P05` 或 `unexpected end of hex escape`，界面「抽取失败：…」；AI 归类给的说明带这两类字符时同样失败 | 状态「待审核」，说明「Flag  nylon 3x5」；第 300 字处劈开表情符号的说明与原文片段以 U+FFFD 结尾；工作表名带 U+0000 的行照常带上可引用单元的页号与标签；AI 给的说明入库为「Widget  assembly �」 |

两个协调点（BIDPAGE 会话只读这两个文件的结果）：`import-service.ts` 与 `inbound-apply.ts` 的导出签名与返回形状都没改，只改了内部——`createImportFromUpload` 返回的 `extraction` 现在是清理后的那一份；`inbound-apply.ts` 只加了模块内的私有函数（没有新增或改动导出），`planInquiryItemUpdate` 的 `parsed` 参数类型来自 `inbound-parse.ts` 的 `ParsedQuote`，其中 `attachmentsSeen` 每项多一个可选的 `nulCount`。读到的结果的不同：成本表导入记录里 U+0000 变空格、落单代理字符变 U+FFFD；询价报价备注的附件一栏可能多那句提示（要从备注取字段请经 `notes-parse.ts`，附件一栏不进任何回读字段）。

## 3. 与四件套不一致、已改四件套的地方

1. 开工顺序：tasks「开工前提」、design Context 与「相邻改动」、proposal Impact 原写「FIX-19 合并后合入 main 再开工」，改成事实（FIX-19 未合并、按 §0.5k 第 9 条例外先开工、两者没有共同代码文件、FIX-19 后合并时由它合入 main），并写明合入后的复核结果与「| 待定 |」原有条数。
2. 行号：四件套的代码行号以 main `13c7ed33` 为准，合入后逐条核对都对，没有改。本次改动之后这些文件的行号有移动，TASKFLOW 里后续任务的行号按**改动后**的代码写（例如采购附件的认领 `attachments.ts:176`、`:261`，CSV 判断 `:124–126`，产品资料报错 `analyze.ts:222–225`、`:305`、`:347`，`blobPath` 在 `core.ts:129`），tasks 7.1 里的是改动前的行号。
3. 实现细节（不改范围；多维审查后都已写进 design / 规格）：旧客户端「清理掉了东西、且清理后只剩空白」才按没有附件处理（`core.ts:159`），没清理掉什么时与改动前完全相同；文件名只由 U+0000 组成时新方式「附件缺少文件名」、旧方式「上传文件」；文件名以 U+0000 结尾两种方式都得「a.pdf」；询价回信的 U+0000 个数按附件抽出的原文计，`nulCount` 只在大于 0 时出现。
4. 多维审查（五个维度，审查对象 `503e99f9`，没有阻断项）后按协调会话定的修订清单改了四件套：
   - G6 的范围按 A 的原话补上漏掉的第 6 处标题 `src/lib/assistant/dispatch.ts:196`（design Non-Goals 删掉这一处，proposal What / Out of scope、规格「对话标题截断后入库前清理」改成 6 处，新增「分流落库的标题」场景）。
   - G5-B 的措辞按文案审查改为「（有 N 处符号没读出来，已当空格处理，多半是勾选框；请打开原件核对勾选项和价格）」（design G5 写明「措辞按文案审查调整，Lucas 2026-11-22 授权按推荐」）。新措辞里有一个「；」：比价回读按「；」切开后两半分别以「附件：」与「请打开原件」开头，都不进任何回读字段；`notes-parse.test.ts` 17 项与「带 / 不带这句话 `parseAutoNotes` 结果相同」照旧通过（design D3 第 5 点原写「这句话里没有『；』」，已改）。
   - 「不进模型提示」收窄为「不进询价回信解析时的模型提示」，并写明报价备注整份会进既有的报价草稿（`src/lib/ai/prompts/trade.ts:137`）与报价分析（`trade.ts:41`）提示（规格、design 硬纪律第 4 条与 G5 后果⑥、proposal、TASKFLOW、本报告 §10）。
   - AI 对话 400 的文字改成与浏览器上传时同一句，浏览器上传判空按同一条规则（规格、design D5、proposal What / Impact）。
   - 规格补场景：U+0000 夹在数字中间、一份附件里 3 个勾选框、邮件正文里的 U+0000、通知与改动前相同、文件名以 U+0000 结尾或只有 U+0000、分流落库的标题；「只有 U+0000 的附件」场景按夹具改成「只由 U+0000 组成（5 个）」；「普通文字不变」的测试列表采购一路换成 `procurement-records-db.isolated.test.ts`、产品资料一路指明新测试的段落；「清理规则」里「结构不变」加限定（键名由代码决定、不会撞名时）。
   - design：Risks 写明数字中间的 U+0000 与正文不计数（审查 S3 / R4）；D5 旧方式判空按代码写；D7 第二遍清理的理由改准（模型 JSON 里的转义，`classify-ai.ts:14` 已限 200 字，`:51` 的截断劈不开）；G5 后果①写清提示在哪看得到、后果②写「个数大于 0 时」；Migration Plan 第 2 步写明为什么按「任一已解析附件」查。
   - proposal：Impact「接口」补旧客户端 400「消息不能为空」，Muse 一条改为「比价表里多出以前被作废的价格与交期；那句提示不在任何回读字段里，Muse 不会念」，开工一条改为「没有共同代码文件」。
   - tasks 7.1：后续任务 7 → 9 条，另登记 FIX-24；「| 待定 |」原有条数写到 `2a0eb964` 的 19。
   - 规格要求条数是 **14**（`grep -c '^### Requirement'`），上一版报告写 13 是错的，已改。
5. 交叉验证（在 `41870a9a` 上）后按协调会话的意见改：AI 对话 400 的新措辞只在清理确实清掉了这两类字符、清理后只剩空白时用；没有这两类字符、正文本来就是空白或缺字段的附件（含图片附件正文为空）照旧「没有可分析的文本内容」——上一轮把所有空白正文都改成了新句子，对已经传了图片的人说「直接传图片」不对，也违反「不含这两类字符的输入改前改后逐字相同」（规格补「本来就是空白的附件正文」场景，design D5、proposal What / Impact、本报告 §2、TASKFLOW 同步）；补一个多附件计数用例抓住 4 个存活变异；§5 已知限制加两条。规格「AI 对话附件在服务端收下时清理」的正文因此超过 500 字（`openspec validate --strict` 告警），把文件名去空白、旧客户端判空等细节移进场景（新增「旧客户端的文字只有 U+0000」场景），正文 353 字，要求条数仍是 14。

## 4. 验证

### 4.1 新增测试（都已注册：前者进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`，后者只进 `scripts/test-all.sh`）

`env -u DATABASE_URL -u DIRECT_URL npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts`（不用数据库）：真实 unpdf 读 FIX-13 夹具现拼的 PDF、SheetJS 现写的 xlsx、字符串现拼的截断场景；询价回信两个假模型（勾选框处写空格 / 原样照抄收到的那一行）；另有接线断言（读源码）。**81 过 0 败**；把本 change 改的 13 个源文件换回 `origin/main` 版本：22 过 52 败后在成本表段中途抛错（`toStorableJson is not a function`）。CI 只跑这个不连库的测试，上游漏清理（询价附件文字、拼好的整段文字、新方式附件这几处）只有它在 CI 里能抓到，所以它必须一直留在 CI 子集。

`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts`（隔离库 `qy_iso_f`）：五个入口各走一遍真实写库。**38 过 0 败**；13 个源文件换回 `origin/main`：**1 过 37 败**（唯一通过的是「同一封回信再跑一次按已处理跳过」）。

| 段 | 改动前的代码上的典型失败 |
|---|---|
| 询价回信（`defaultInboundSyncDeps()` 只换掉 Gmail 与模型，`applyPlan` / `writeAudit` / 通知都是真的） | `failed: 1`，`rfq_inbound:failed` 的 `error` 为 ``Invalid `db.inquiryItem.update()` invocation in …/inquiry/service.ts:335:40 …``（前 300 字，看不到 22021），条目停在 `replied`，通知「有一封供应商回信解析失败，请手工录入」 |
| 采购记录附件（`saveAttachment` + `processAttachment(id, { readBuffer })`） | 两份附件写单元 `PostgresError 22021`、停在 `PARSING`；长明细 `unexpected end of hex escape`、附件 `PARSED`、明细 0、分析 0 → 0 |
| AI 对话附件、对话标题与市场调研（写 `AiMessage` / `TradeChatMessage` / `AiThread.title` / `TradeChatSession.title`，跑 `createAssistantScenarioBinding` 与 `queueMarketResearchRequest`） | 附件 `22P05 unsupported Unicode escape sequence`，文件名 / 三种标题 / 市场证据 `unexpected end of hex escape` |
| 产品资料录入（本地文件存储跑 `analyzeJobInputs`） | 写事实 22021，`analyze_inputs` 为 `running`，任务 `ANALYZING` |
| 报价成本表导入（`createImportFromUpload`，含用假模型跑 AI 归类） | 导入都 `FAILED`，`errorMessage` 含 `22P05` 或 `unexpected end of hex escape at line 1 column 632` |

`npx tsx src/lib/files/__tests__/extracted-text.test.ts`：42 → **53**（新增 `toStorableJson` 11 项：键名与嵌套数组、数字 / 布尔 / null 不变、Date 等类实例原样、不改入参、`__proto__` 键仍是自有属性、原型为 null 的对象也清理）；改动前的代码上导入即失败。

每个 task 实施时也单独做了「先在改动前看到失败」：1.1（不用库 7/16、隔离库 2/7）、2.1（隔离库采购段 0/8）、3.1（隔离库对话段 0/6）、4.1、5.1（隔离库成本表段 3 项失败），做法是把该 task 改的源文件 `git stash` 后跑、再还原。

### 4.2 审查后补的用例：在对应变异下失败、还原后通过

每条变异只改一处源码、跑对应测试、`git checkout` 还原（脚本与逐条结果在 scratchpad 的 `fix14-impl-mut/`）。还原后：不用库 78/0、隔离库 37/0（补「Material: Polyester」一项之前）、`extracted-text` 53/0。

| 审查项 | 变异 | 变异下 | 失败的断言 |
|---|---|---|---|
| T1 | `countNul` 只记有无（N 恒 1） | 不用库 77/1 | 价格行里 3 个勾选框 → 「有 3 处」 |
| T2 | 个数换个写法进模型的附件清单 | 不用库 77/1 | 附件清单一行逐字为「附件：q.pdf」 |
| T3 | 备注带提示时多发一条换措辞的通知 | 隔离库 35/2 | 新增通知里没有那句提示；带 / 不带勾选框通知差分 |
| T4 | 主助手路由 / 外贸路由附件校验失败 400 → 500（各一次） | 不用库 77/1（两次都是） | 两个对话路由附件校验失败返回 400 |
| T5 | 新方式文件名先去空白再清理 | 不用库 76/2 | 文件名只有 U+0000 → 缺少文件名；「a.pdf\u0000」→「a.pdf」 |
| T6 | 旧方式判空去掉「清理掉了东西」条件 | 不用库 77/1 | 前 15 万字全是空白照旧折算成附件 |
| T7 | 旧方式文件名去掉「上传文件」回落 | 不用库 77/1 | 文件名只有 U+0000 → 「上传文件」 |
| T8 | `toStorableJson` 不往原型为 null 的对象里递归 | `extracted-text` 52/1 | 原型为 null 的对象也清理 |
| T9 | 去掉写库前第二遍 `toStorableJson` | 隔离库 35/2；不用库 77/1 | AI 归类说明入库为「Widget  assembly �」（变异下 `FAILED`）；接线 |
| T10 | 产品资料只换 U+0000、不处理落单代理字符 | 隔离库 36/1；不用库 77/1 | Excel 15 万字截断处的事实值「Re�」（变异下 InvalidArg）；接线 |
| T11 | 分流落库标题改用 `.substring(0, 60)` | 不用库 75/3 | 没有 slice / substring / substr 截断后写库；6 处都经 `storableTitle` |
| T12 | 旧方式文件名清理后不去首尾空白 | 不用库 76/2 | 「a.pdf\u0000」→「a.pdf」；只有 U+0000 → 「上传文件」 |
| C1 | 分流落库标题换回 `.slice(0, 60)` | 隔离库 36/1；不用库 75/3 | 分流落库标题以 U+FFFD 结尾（变异下 InvalidArg）；接线 |
| U3 | 浏览器上传判空换回 `text.trim()` | 不用库 77/1 | 浏览器判空接线 |
| S3 / 正文 U+0000 | `inbound-parse.ts` 换回 `origin/main` 版本 | 不用库两项都失败 | 数字中间的 U+0000：改动前证据被作废；正文 U+0000：改动前价格被作废 |
| 交叉验证：400 措辞 | 所有空白正文都用新句子（即 `41870a9a` 的写法） | 不用库 80/1 | 本来就是空白 / 图片正文为空 / 没有正文字段 → 原句 |
| 交叉验证：400 措辞 | 所有空白正文都用原句 | 不用库 80/1 | 正文只有 U+0000 → 新句子 |
| 交叉验证 M02 | `nulCount` 为 0 也写进 `attachmentsSeen` | 不用库 79/2 | 两个附件逐字断言；没有 U+0000 的附件不多字段 |
| 交叉验证 M03 | 每个已解析附件都记全封总数 | 不用库 79/2 | 两个附件逐字断言；b.pdf 只写「已解析」 |
| 交叉验证 M20 | `countNul` 跳过第 0 位 | 不用库 79/2 | 两个附件逐字断言（a.pdf 变成 2）；备注一栏 |
| 交叉验证 M22 | 正文里的 U+0000 计进第一个附件 | 不用库 79/2 | 两个附件逐字断言（a.pdf 变成 4）；备注一栏 |

审查员另列的 Q04 / Q05（冗余防御，实际等价）、Q06 / Q07（没有注入缝，`toStorableParseError` 已单测）、D02（文字 / 语音来自库）按清单不补。

### 4.3 既有测试（改动后照旧通过）

`inbound-parse` 38、`inbound-apply` 72、`notes-parse` 17、`tracking-notify-wiring` 67、`chat-attachments` 54、`durable-followup-pure` 73、`durable-followup-m1.isolated` 61、`daily-brief-scenario` 6、`dispatch-policy` 11、`human-signals` 80、`mail-untrusted-guard` 56、`tool-list-modules` 37、`mail-tool-visibility` 69、`effective-platform-role` 63、`digital-employee` 50、`residual-reads` 76、`b1-tenant-context-static` 20、`research-runtime` 13、`quote-import` 74、`quote-ops-contract` 75、`disclosure-analysis-pure` 50、`procurement-records-db.isolated` 158、`priority-conflict` 10、`page-parse` 29。`git diff origin/main -- src/lib/tender-rfq/inbound-sync.ts src/lib/tender-rfq/inbound-contract.ts src/lib/tender-rfq/notes-parse.ts` 为空。

### 4.4 门禁（交叉验证修订后、合入 main `325cbdc0` 后重跑）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 全量 | 删库重建 `qy_full_fix14`（`DROP / CREATE DATABASE` 后 `npx prisma migrate deploy`）上 `npm test < /dev/null`（提交 `3ecdce90`） | **735/745 通过、10 失败**，与本机 main 基线逐条相同：来信观察 DB（MAIL-2）、Sunny 工艺单 DB、Phase3A-3 Approvals Smoke、Phase3A-4 Governance Smoke、Phase3A-4 Acceptance、Autopilot A2-P0 Isolated E2E、Phase3A-5 Overview Acceptance、T4 授标情报真实 Postgres 矩阵、客户报价 PDF 分页布局、招标询价自动起草第 1 轮 DB；三项偶发（Supplier Intel S1 T20、网站询盘并发认领、CAL-1 日历观察 DB）这次都通过。本 change 的两个新测试 81 / 38 全过，`extracted-text` 53 过 |
| CI 子集 | `env -u DATABASE_ENVIRONMENT DATABASE_URL=…ci… DIRECT_URL=…ci… JWT_SECRET=ci-only-… NODE_ENV=test npm run test:ci` | 末行 `CI unit subset PASS`（新测试 81 过） |
| 类型 | `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` | 退出码 0 |
| lint | `npm run lint:baseline` | PASS（errors 38，没有新增 fingerprint） |
| 测试注册 | `bash scripts/check-test-registry.sh` | OK（已注册 710 个，基线 66 条未增） |
| 运行时架构 | `bash scripts/test-runtime-architecture.sh` | PASS |
| OpenSpec | `openspec validate extracted-text-nul-other-paths --strict` | valid（没有告警） |
| 归档演练 | 把 `openspec/` 拷到 scratchpad 里跑 `openspec archive extracted-text-nul-other-paths --yes`，前后各跑 `openspec validate --specs --strict` | 归档前 157 过 0 败 → 归档后 158 过 0 败，「+ 14 added」，没有超过 500 字的告警 |
| 冻结面 | `git diff origin/main -- prisma/ vercel.json package.json package-lock.json .claude/launch.json openspec/specs openspec/config.yaml` | 为空 |
| 开关前提 | `grep -c "FIX-14 部署之后" docs/QINGYAN_CHAIN-0_ENV_CHECK.md`；`grep -n "^| CHAIN-0 " docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`；`grep -n "^| FIX-14 \|^| FIX-24 "`；`grep -c "| 待定 |"` | 2；CHAIN-0 行含「FIX-14 部署之后」与四条前提；FIX-14 在 `:299`（FIX-13 在 `:298`）、FIX-24 在 `:309`；28（main 原有 19 + 9） |

前几轮：审查前（`b4f416d0`）722/732、10 项与基线相同；多维审查修订后（`101efab9`）731/742、11 项失败，多出的 CAL-1 日历观察 DB 是夹具时间戳 `mwt2hvol` 含「t2」撞上断言 `!g1.text.includes("t2")`（`src/lib/calendar-watch/__tests__/calendar-watch-db.isolated.test.ts:415`），与本 change 无关，单独重跑两次 80/80。

## 5. 没验证到的与已知限制

没验证到的：

- 没有用真实模型跑询价回信：两个假模型覆盖了「勾选框处写空格」与「原样照抄」两端，真实模型的写法在这两者之间。
- 没有核实同一字体里「已勾选」与「未勾选」的字形是否都抽成 U+0000（夹具与 FIX-13 附录 B 的都是未勾选框）。勾选框式选项表（「☐ EXW ☐ FOB ☐ DDP」）清理后只剩选项文字，模型挑出的选项可能没有依据——这正是 G5-B 那句提示要人去打开原件的原因，提示本身不改入表与核对的结果。
- AI 对话两个路由没有整条 HTTP 走一遍（主助手路由要过鉴权、限流、分流与流式模型调用，外贸路由会调模型）：隔离库测试直接用路由里同一组函数（`parseAttachmentsInput` / `attachmentsFromLegacyFile` / `attachmentsTitleSource` / `storableTitle`）的结果写库，分流落库走真实的 `createAssistantScenarioBinding`；另有接线断言核对两个路由附件校验失败返回 400、只用校验后的附件写库、6 处标题都经 `storableTitle`。浏览器上传判空只有接线断言，没有在浏览器里点过。
- 没有访问生产，§9 查询的条数未知（查询本身在隔离库造数据跑通过，见 §9）。

已知限制（都不改代码）：

- **那句提示基本只在一个地方看得到**：报价备注只在项目「投标」页询价表的「备注」列显示，格子截断（`src/components/inquiry/inquiry-detail.tsx:547–560`），提示排在最末，只有悬停看全文时可见，手机上看不到；询价追踪页、比价表、「报价了」通知与 Muse 都不显示。让它露出来登记为后续任务 8。
- **报价备注会整份进既有的模型提示**：报价草稿（`src/lib/ai/prompts/trade.ts:137`，经 `api/projects/[id]/quotes/ai/generate-draft/route.ts` 与 `src/lib/agent/skills/quote.ts`）与报价分析（`trade.ts:41`，数据来自 `src/lib/inquiry/service.ts:461`）。那句提示、以及以前写库失败的回信入表后的证据片段与附件文件名会随备注进去——既有链路，不是本次新增；文件名能伪造备注结构的问题另开 FIX-24（§8）。
- **U+0000 夹在数字中间**：附件「Unit price CAD 1\u000025 per flag」清理后是「1 25」，模型报 125、证据写「CAD 125」能通过核对（改动前作废）。证据闸本来就去掉全部空白再比，原文本来就是「1 25」时改动前也通过；模型编造的、证据里没有的数字仍作废。缓解是附件一栏那句提示（要人打开原件核对价格）；**邮件正文里的 U+0000 不计数、没有提示**。
- **整份只有 U+0000 的附件被说成「扫描件」**：询价回信记「附件无可提取文本（可能是扫描件）」、采购 PDF 整页只有 U+0000 时记「需要 OCR」、AI 对话提示「扫描件请直接传图片」——下一步（人工看原件 / 传图片）是对的，原因写的不准。
- **工作表名清理后撞名**：「A\u0000」与「A 」两张表清理后同名，成本表可引用单元的 `evidence.sheet` 可能指到另一张、采购附件的单元标签与 `sheetRangesJson` 出现两条同名（`import-service.ts:93–110`、`:164`；`attachments.ts:139`）。只有文件作者能构造（Excel 界面不允许这样的表名），不越权；改动前整份导入失败。
- **`toStorableJson` 键名撞键时后出现的覆盖**：`{"a\u0000":1,"a ":2}` → `{"a ":2}`。三个调用点的键都是代码写死的字段名，实际不撞；函数注释写明只用于键名由代码决定的数据。
- **今后对审计 `afterData` 做 `::jsonb` 的查询会撞上转义**：部署后入表的回信，审计 `afterData` 里 `prices` 的证据片段可能带 `\u0000` / 落单 `\ud83d` 这类转义（审计先 `JSON.stringify` 再存 text 列，写库不失败），PostgreSQL 把这样的 text 转 `jsonb` 时会报错（22P05 / 22P02）。§9 的查询只看 `createdAt < deploy_at` 的行，不受影响；以后有人对部署后的行做 `::jsonb` 查询要先排除或改用文本匹配。
- **询价回信的失败审计没有收口**：`src/lib/tender-rfq/inbound-sync.ts:260` 的 `error.slice(0, 300)`（写进 `:262–268` 的 `rfq_inbound:failed` 审计）没经 `toStorableParseError`；审计是 String 列、先 `JSON.stringify`，写库不会失败，超出本次范围，不改。
- **主助手页收到 400 时刚发的消息会消失**：已有回复的对话里，发送收到 400（比如这次的「没有可提取的文字…」）时页面会「找回回复」，刚发的消息消失、也不显示报错（`src/app/(main)/assistant/page.tsx:793–795`、`:319–370`）；改动前 500 也一样，不是变坏。浏览器上传时已经先提示，正常使用碰不到这个 400。登记为后续任务 9。

## 6. 没有开关，合并即在生产生效；回退办法

没有开关，合并部署后各入口立即按新规则处理。回退 = 回退本 PR（零 schema，没有数据迁移；回退后已入库的清理过的文字照样能读）。

## 7. 上线顺序与询价开关的前提

三个询价开关（`TENDER_RFQ_AUTO_DRAFT_ENABLED`、`TENDER_RFQ_SUPPLIER_GROUPS_ENABLED`、`TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED`）要以下四条都满足才开（G2 已定 A：不拆，没有「询价回信先合」的捷径；要在 FIX-14 合并之前开，先回 GATE 重新定 G2）：

1. CHAIN-4b staging 真实标包实测已做（TASKFLOW CHAIN-4b 行）；
2. FIX-14（PR #569）已合并、且那次生产部署成功（在 Vercel → Deployments 按合并提交核对）；
3. 本报告 §9 第 1–4 步已做；
4. FIX-24（供应商附件文件名不能伪造报价备注字段，§8）已合并部署。

三个白名单（`*_ORG_ALLOWLIST`）都填 Sunny 的组织 id，不能留空（为空 = 所有组织）。本 PR 已把这些写进 `docs/QINGYAN_CHAIN-0_ENV_CHECK.md` 的「填写顺序」与第 7 行建议值（`grep -c "FIX-14 部署之后"` 为 2）、验证表新加的「第 7 项（开之前）」一行（FIX-14 与 FIX-24 的部署日期填在那一行），以及 TASKFLOW 的 CHAIN-0 行；第 7 行的日期必须晚于两个部署日期，「原值 / 新值 / 日期」三列不填。入站这条路今天对人工发出的询价已经在跑，所以本 PR 越早部署越好，不只是为了开关。

## 8. 没做的与后续任务

后续任务已登记进 TASKFLOW（FIX-14 一行之后，编号「待定」，状态 `[ ]`）：

1. 对话标题 6 处以外，把用户打的字按字数截断后写入文本列的地方逐处排查（审查时找到的 `src/lib/assistant/dispatch.ts:196` 已并进本 change）。
2. AI 对话附件的 `blobPath`：手工构造带 U+0000 的路径写库 22P05、500（`src/lib/chat-attachments/core.ts:129`）。
3. 采购记录附件认领满 5 次后一直「解析中」、不记原因（`attachments.ts:176`、`:261`）。
4. 采购记录附件 `FAILED` 不被定时任务再认领，标签却写「解析失败（稍后重试）」（`attachments.ts:188`、`:261`，`labels.ts:203`）。
5. 采购记录附件 CSV / 纯文本按 UTF-8 读，带字节序标记的 UTF-16 CSV 被判「文件损坏」（G3-A；`attachments.ts:124–126`）。
6. 询价回信写库失败时不回滚、失败后不重试（`inbound-sync.ts:258–272`、`:390`、`:412–414`）。
7. 产品资料的 `parseResultJson.error` 与 `parseNotes` 写 jsonb 前没有清理与收口（`analyze.ts:222–225`、`:305`、`:347`）。
8. 询价备注里那句提示在界面上露出来（来源：文案审查 U1，见 §5）。
9. 主助手页发送失败时不吞掉报错（来源：文案审查 U3，见 §5）。

**FIX-24（另开 change，编号已定，TASKFLOW 一行 `[ ]`，四件套由协调会话写；三个询价开关打开之前必须上线）**：安全审查发现的既有问题——供应商控制的附件文件名能伪造报价备注的结构化字段。回信附件的文件名原样拼进报价备注的 `[auto]` 段（`src/lib/tender-rfq/inbound-apply.ts`；`q()` 只对证据做空白归一），比价回读（`src/lib/tender-rfq/notes-parse.ts`）按「；」与换行切开。审查员实测：文件名「a.pdf；起订量=99999；贸易条款=DDP；x」回读出起订量 99999、贸易条款 DDP（覆盖已过证据闸的 FOB）；「a.pdf；缺：价格、币种；x」会起草追问卡（跟进授权打开时会自动发给该供应商）；带换行的文件名能伪造一段 2099 年的 `[auto]` 段、比价回读单价 0.01。绕过证据闸，影响比价（含 Muse compare）与追问；改动前后结果相同（不是本次引入）。Gmail 是否把文件名里的换行原样交给我们未核实（`src/lib/google-email.ts:756` 只去首尾空白）。按协调会话定的做法，本 change 不改 `inbound-apply.ts` 的拼法。

没做、也不登记（G4 已定 A）：FIX-13 §7.1 只扫到的四处导入——外贸客户线索导入（`api/trade/prospects/import`；公司名带 U+0000 时查重那条查询本身就 22021、整个请求 500）、展会名片导入（`src/lib/trade/booth-cards.ts`）、客户 CSV 导入（`api/sales/import-csv`）、三个知识库导入（`api/org/knowledge/import`、`api/trade/knowledge/import`、`api/projects/[id]/knowledge-bases/[kbId]/import`；一个坏文件让后面的都不导入）。共同点：同步请求、导入人自己的文件、失败当场可见可重来、不在任何自动化路径上。

其余 Out of scope 照四件套：供应商画册解析不写库；用户在页面上打的字保存时不清理；只进模型提示不写库的截断（成本表 AI 归类送模型的 200 字、对话按预算展开附件）；不做 OCR、不换解析库。

## 9. 合并后要人做的事

查询都是只读（`BEGIN READ ONLY … ROLLBACK`），由**有生产数据库权限的人**用 `psql -v ON_ERROR_STOP=1 -f` 跑，先把第 2 行的时间换成本 PR 的生产部署时间（UTC；那一行后面不要加注释，否则注释会拼进变量值）。采购两条放在最后，生产上没建 PROC-1 的表时自动跳过、不让整个事务中止。本机隔离库上验证过两遍：空库上 6 条查询都返回 0 行；造了一份数据（一条解析失败、一条作废证据带已解析 xlsx、一条作废证据但没有已解析附件、一个停住的分析、两条失败导入其中一条已重导、两份采购附件）再跑，2a / 2b / 3a 各 1 行、3b 2 行（`reimported_since` 一真一假）、1a / 1b 各 1 行，没有已解析附件的那条不在 2b 里；把表名换成不存在的再跑，打印「1a / 1b 跳过」，退出码 0。

```sql
-- 把下一行的时间换成本 PR 的生产部署时间（UTC）；这一行后面不要加注释
\set deploy_at '''2026-12-01 00:00:00+00'''
BEGIN READ ONLY;

-- 2a 询价回信：部署前 90 天内全部「解析失败」（不按报错文字筛：失败原因只留前 300 字，22021 可能被截掉）
SELECT al."projectId", p.name AS project_name, pi."roundNumber" AS round, s.name AS supplier_name,
       al."createdAt", al."targetId" AS gmail_message_id, ii.id AS inquiry_item_id, ii.status AS item_status,
       (al."afterData")::jsonb ->> 'error' AS error
FROM "AuditLog" al
LEFT JOIN "InquiryItem" ii ON ii.id = (al."afterData")::jsonb ->> 'itemId'
LEFT JOIN "ProjectInquiry" pi ON pi.id = ii."inquiryId"
LEFT JOIN "Supplier" s ON s.id = ii."supplierId"
LEFT JOIN "Project" p ON p.id = al."projectId"
WHERE al.action = 'rfq_inbound:failed' AND al."targetType" = 'rfq_inbound_message'
  AND al."createdAt" >= (:deploy_at)::timestamptz - INTERVAL '90 days' AND al."createdAt" < (:deploy_at)::timestamptz
ORDER BY al."projectId", al."createdAt";

-- 2b 询价回信：部署前 90 天内入了表、但有证据被判「不在原文里」且带已解析附件的（价格 / 交期可能被悄悄作废）
SELECT al."projectId", p.name AS project_name, pi."roundNumber" AS round, s.name AS supplier_name,
       al."createdAt", al."targetId" AS gmail_message_id, ii.id AS inquiry_item_id,
       (al."afterData")::jsonb -> 'rejected' AS rejected, (al."afterData")::jsonb -> 'attachmentsSeen' AS attachments_seen
FROM "AuditLog" al
LEFT JOIN "InquiryItem" ii ON ii.id = (al."afterData")::jsonb ->> 'itemId'
LEFT JOIN "ProjectInquiry" pi ON pi.id = ii."inquiryId"
LEFT JOIN "Supplier" s ON s.id = ii."supplierId"
LEFT JOIN "Project" p ON p.id = al."projectId"
WHERE al.action = 'rfq_inbound:applied' AND al."targetType" = 'rfq_inbound_message'
  AND al."createdAt" >= (:deploy_at)::timestamptz - INTERVAL '90 days' AND al."createdAt" < (:deploy_at)::timestamptz
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE((al."afterData")::jsonb -> 'rejected', '[]'::jsonb)) r WHERE r ->> 'reason' = 'EVIDENCE_NOT_IN_TEXT')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE((al."afterData")::jsonb -> 'attachmentsSeen', '[]'::jsonb)) x WHERE x ->> 'parsed' = 'true')
ORDER BY al."projectId", al."createdAt";

-- 3a 产品资料：「分析输入」停在进行中（任务页显示「分析中」）
SELECT u.name AS creator_name, u.email AS creator_email, j.id AS job_id, j.title, s."startedAt"
FROM "ProductContentStep" s
JOIN "ProductContentJob" j ON j.id = s."jobId"
LEFT JOIN "User" u ON u.id = j."createdById"
WHERE s."stepKey" = 'analyze_inputs' AND s.status = 'running' AND s."startedAt" < (:deploy_at)::timestamptz
ORDER BY u.email, s."startedAt";

-- 3b 报价成本表：部署前「失败」的导入（不按报错文字筛：原因只留前 500 字）；reimported_since = 之后同一份文件已重新导入且没失败
SELECT u.name AS creator_name, u.email AS creator_email, i."projectId", p.name AS project_name, i."sourceFilename", i."createdAt", i."errorMessage",
       EXISTS (SELECT 1 FROM "QuoteCostImport" later WHERE later."quoteId" = i."quoteId" AND later."contentHash" = i."contentHash"
               AND later."createdAt" > i."createdAt" AND later.status <> 'FAILED') AS reimported_since
FROM "QuoteCostImport" i
LEFT JOIN "User" u ON u.id = i."createdById"
LEFT JOIN "Project" p ON p.id = i."projectId"
WHERE i.status = 'FAILED' AND i."createdAt" < (:deploy_at)::timestamptz
ORDER BY u.email, i."createdAt";

-- 1a / 1b 采购附件：生产上没建 PROC-1 的表时跳过（不让整个事务中止）
SELECT to_regclass('public."RecordsAttachment"') IS NOT NULL AS has_procurement_tables \gset
\if :has_procurement_tables
-- 1a 认领满 5 次、一直停在「解析中」（不满 5 次的，每小时 25 分的定时任务会自己重跑）
SELECT a.id, a."orgId", a."requestId", r.title AS request_title, a."originalFilename", a."parseAttempts", a."parseStartedAt"
FROM "RecordsAttachment" a
LEFT JOIN "RecordsRequest" r ON r.id = a."requestId"
WHERE a."parseStatus" = 'PARSING' AND a."parseAttempts" >= 5
ORDER BY a."orgId", a."uploadedAt";

-- 1b 披露文件「已解析」却没有任何明细，且解析之后申请没有跑过分析（写明细失败时分析没跑）
SELECT a.id, a."orgId", a."requestId", r.title AS request_title, a."originalFilename", a."parsedAt"
FROM "RecordsAttachment" a
LEFT JOIN "RecordsRequest" r ON r.id = a."requestId"
WHERE a.kind = 'DISCLOSURE_FILE' AND a."parseStatus" = 'PARSED'
  AND NOT EXISTS (SELECT 1 FROM "ProcurementLineItem" l WHERE l."attachmentId" = a.id)
  AND NOT EXISTS (SELECT 1 FROM "ProcurementAnalysis" an WHERE an."requestId" = a."requestId" AND an."createdAt" >= a."parsedAt")
ORDER BY a."orgId", a."parsedAt";
\else
\echo '没有采购记录表（生产没建 PROC-1 的表）：1a / 1b 跳过'
\endif

ROLLBACK;
```

按顺序做：

1. **询价回信**：2a、2b 两份名单（带项目名、轮次、供应商名）按 `projectId` 分组交项目负责人。2a 是当时记了解析失败的回信——这些回信系统不会再自动处理，也不会再发通知，请确认是否都已人工录入，没录的在项目「投标」页询价表该家那一行点「录入报价 / 更新报价」。2b 是入了表、但价格 / 交期当时被悄悄作废的回信（备注写「回信涉及报价但未提取到可核验字段」，缺价格的可能已起草过追问卡），请打开原件补录。
2. **产品资料**：3a 名单按创建人（姓名 / 邮箱）交给各自的人，在产品资料任务页重新点一次「分析输入」。
3. **报价成本表**：3b 名单按创建人交给各自的人，在报价的成本导入面板里重新「上传并抽取」同一份文件（`reimported_since` 为真的已经重新导入过，可以跳过）。
4. **采购附件（G1 已定 A：不写补救代码）**：1a、1b 都为零就结束。认领不满 5 次、还停在「解析中」的附件不用管，每小时 25 分的 `tender-watch` 会自己重跑。有 1a / 1b 的，按 G1-A 的字段改法走 Owner Gate（Evan 拍板）做一次生产写操作：1a 类把 `parseAttempts` 改成 0；1b 类把 `parseStatus` 改回 `PENDING`、`parseAttempts` 改成 0。之后由 `tender-watch` 自动重新认领（解析单元按 `(attachmentId, unitIndex)`、明细按 `(attachmentId, dedupeKey)` 跳过已有的，分析多一个版本），不用人点。1b 的查法可能混进少数真的没有明细、又没跑过分析的文件，重跑对它们无害。
5. **AI 对话**：改动前写库失败的消息没有存下，查不出名单，不用做；用户重发即可。
6. 上面几步做完、§7 的四条前提都满足，才打开询价开关（核查表第 7 行的日期晚于 FIX-14 与 FIX-24 的部署日期，三个白名单只填 Sunny 的组织 id）。

## 10. GATE 六条的结论（Lucas 2026-11-22，都与原推荐相同）

| # | 问题 | 结论 |
|---|---|---|
| G1 | 采购附件两类历史失败怎么补 | **A**：不写补救代码，上线后按 §9 第 4 步查，有就走 Owner Gate |
| G2 | 询价回信要不要拆成独立 change 先合 | **A**：不拆，一个 change 一个 PR；三个询价开关等整个 FIX-14 合并部署之后才开 |
| G3 | 采购附件 CSV / 纯文本要不要改用 FIX-13 的解码 | **A**：不改读法；UTF-16 CSV 被判损坏登记为后续任务 5 |
| G4 | FIX-13 §7.1 只扫到的四处导入要不要另开任务 | **A**：不另开，只写在 §8「没做的」 |
| G5 | 询价回信附件里有 U+0000 被换掉时要不要在报价备注里注明 | **B**：注明「（有 N 处符号没读出来，已当空格处理，多半是勾选框；请打开原件核对勾选项和价格）」（措辞按文案审查调整，Lucas 授权按推荐），只进报价备注与审计里的个数；不进通知、Muse 与询价回信解析时的模型提示（报价备注整份会进既有的报价草稿 / 报价分析提示，这句话随备注进去）；不改入表、核对与比价回读 |
| G6 | 对话标题截断后清理的范围 | **A**：凡由消息文字或附件名生成的对话标题都清理——原定 5 处，多维审查补上漏掉的 `dispatch.ts:196`，共 6 处；6 处以外登记为后续任务 1 |

## 11. 与八条硬纪律的关系

1. 零 schema：遵守——`git diff origin/main -- prisma/` 为空；只改写入前的字符串。
2. 出站先审批：不新增任何出站。修好后以前写库失败的回信会正常入表，入表后同一次检查里的催单扫描按既有规则起草缺字段追问卡，经人批准或既有的跟进授权（RFQ-AUTO-1）才发出。
3. 禁止第三套队列：不涉及——复用既有的 `tender-rfq-inbound` cron、`tender-watch` 里的附件兜底与 `after()`，认领与重试不改。
4. 脱敏：遵守——只替换字符，不新增输出位置；询价通知与 Muse 事件不读报价备注（隔离库测试断言新增通知的标题与摘要里没有附件文字、证据片段与那句提示，带 / 不带勾选框通知逐字相同）；比价回读经 `notes-parse.ts` 只取起订量、贸易条款、多档价、强制项与缺字段，那句提示不在任何回读字段里（带 / 不带这句话 `parseAutoNotes` 结果相同）；审计照旧只有结构化字段与证据片段，附件多一个符号个数。报价备注整份进报价草稿 / 报价分析提示是既有链路（§5）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及（入站仍按组织设置的 `mailboxEmail` 找邮箱，`inbound-sync.ts` 未改）。
7. 确定性优先：遵守——纯字符替换与计数，没有新增模型调用；询价回信的模型提示只在这两类字符处与以前不同。
8. 测试注册：两个新测试同一提交注册，`bash scripts/check-test-registry.sh` OK。

## 12. 提交

| 内容 | 提交 |
|---|---|
| 1.1 询价回信（含两个新测试与注册、四件套开工顺序按事实改） | `2a502461` |
| 2.1 采购记录附件 + `toStorableJson` | `9f71b29a` |
| 3.1 AI 对话附件、对话标题与市场调研 | `bb3c9ada` |
| 4.1 产品资料录入 | `24c4dbb4` |
| 5.1 报价成本表导入 | `b4f416d0` |
| 6.1 门禁 + 7.1 报告、开关前提与 TASKFLOW | `503e99f9` |
| 多维审查修订：代码与测试（合入 main `2a0eb964`） | `52f4eb22` |
| 多维审查修订：四件套、报告、核查表与 TASKFLOW | `101efab9` |
| 多维审查修订：门禁数字写进报告 | `41870a9a` |
| 交叉验证修订：代码与测试（合入 main `325cbdc0`） | `3ecdce90` |
| 交叉验证修订：四件套、报告、TASKFLOW；门禁数字 | `e103d5ef` |

## 13. 多维审查

五个维度各一个子 agent，各自在 `503e99f9` 的干净快照上做，互相不看结论——**都没有阻断项**：

| 维度 | 主要发现 | 处理 |
|---|---|---|
| 正确性与回归（145 组正常输入改前改后对照 + 隔离库 8 组真实写库） | 正常输入逐字相同；「不进模型提示」字面不成立（报价备注整段进报价草稿 / 报价分析两个既有提示）；`toStorableJson` 撞键；成本表第二次清理的理由写错 | 措辞收窄并列出两个既有消费者；撞键写进注释与已知限制；理由改正 |
| 安全 / 隐私与八条硬纪律（36 种注入输入） | 八条都遵守；开关前提写得不全；U+0000 对证据闸透明（数字拼接）；工作表名清理后撞名；**既有问题：供应商附件文件名能伪造报价备注字段** | 核查表第 7 行写全前提；Risks 写明；已知限制；文件名伪造另开 **FIX-24**（询价开关前提 ④） |
| 规格—代码—测试一致性（改前数字重跑、§9 SQL 实跑、归档演练） | 主助手分流落库的标题漏了一处；§9 SQL 照原样跑不通；要求条数是 14 不是 13 | `dispatch.ts:196` 一并清理（6 处）；SQL 修到能跑并带项目名 / 供应商 / 用户；条数改正 |
| 使用流畅与文案 | 提示句基本看不到（只在投标页询价表备注列悬停可见）；只有勾选框字形的对话附件前后端两个说法；白话说明太长、有术语 | 如实写清在哪看得到（露出来另登记后续）；前端判空把 U+0000 当空白、前后端同一句；提示措辞改通俗；白话重写 |
| 测试质量（64 个变异：41 行为断言抓住、12 只靠源码匹配、11 存活，其中 2 个等价） | 9 个真缺口：个数计数、提示进模型提示换措辞、400 状态码、成本表 AI 归类路径、产品资料落单代理字符等 | T1–T11 全补，每个在对应变异下失败 |

**交叉验证**（另起一个没参与实现与上面审查的子 agent，在 `41870a9a` 上亲自跑：五个入口 6 组正常输入改前改后对照 124 个输出键、新提示句「；」回读 35 / 35、自己设计的 22 个变异抓 18、与 main `325cbdc0` 试合无冲突并在合并后的树上跑门禁、§9 SQL 实跑、归档演练）：**代码可以合并**。它提的：400 新措辞对没有这两类字符的空正文附件也生效（改成只在清掉了东西时用新句）；4 个存活变异（补一个多附件用例）；`afterData::jsonb` 与失败审计未收口（写进已知限制）——都在 `3ecdce90`（代码与测试）与`e103d5ef`（文档）处理，见 §3。这一轮之后：不用库测试 78 → 81（空白正文 / 图片空正文 / 没有正文字段照旧原句；正文带 U+0000 + 两个附件逐字断言个数），400 措辞两个方向的变异各 80/1，M02 / M03 / M20 / M22 各 79/2，还原后 81/0。
