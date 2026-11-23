# FIX-14 报告：其它五个文字抽取入口写库前清理 U+0000 / 落单代理字符

> **白话说明（合并后谁会发现什么变了）**：供应商回信的附件里有勾选框（PDF 里抽不出字、被抽成 U+0000 的字形），或者文字按字数截断时正好劈开一个表情符号，以前询价回信、采购记录附件、AI 对话、产品资料分析、报价成本表导入这五处会写库失败——回信记「解析失败，请手工录入」、附件一直「解析中」、对话发不出去、分析卡在进行中、成本表「抽取失败」；询价回信里跨过勾选框的价格还会被悄悄作废。合并之后这些都能正常入库、价格能通过核对；询价页上这类回信的报价备注附件一栏会多一句「（有 N 处无法识别的符号，可能是勾选框或无法识别的字形，请对照原件核对）」。

| 项 | 值 |
|---|---|
| change | `extracted-text-nul-other-paths`（新能力 `platform/extracted-text-storage`，13 条要求） |
| TASKFLOW | FIX-14（Phase F（续）— 情报串联表，紧接 FIX-13），另登记 7 条「编号待定」后续任务 |
| 依赖 | FIX-13（#546，main `13c7ed33`）：复用 `toStorableText` / `toStorableParseError` 与夹具 `src/lib/tender-auto-analysis/__tests__/fixtures/nul-pdf.ts` |
| GATE | Lucas 2026-11-22：G1 A、G2 A、G3 A、G4 A、G5 B、G6 A（见 §10） |
| 分支 | `claude/zen-turing-azudvx-fix14`；四件套定稿提交 `e889c585`；开工时合入 main `d94e4323`（不 rebase） |
| 性质 | 修写库失败与证据被误作废。零 schema、零新模型调用、没有新增出站、没有新队列 / 定时任务、不改 `src/lib/muse-bridge/**`。**没有开关，合并即在生产生效** |

## 1. 开工前复核

- 开工顺序（与四件套原写的不同，已按事实改四件套）：原定 FIX-19 合并后再开工。FIX-19 未合并（等生产只读查询结果），协调会话按交接文档 §0.5k 第 9 条的例外（不碰 FIX-19 文件的 change 可以先走）让 FIX-14 先开工。FIX-19 改的文件（`src/lib/files/document-source.ts`（新）、`src/app/api/projects/[id]/files/route.ts`、`src/lib/tender-auto-analysis/{package,package-ready,package-coverage,reply-resolution,display-labels}.ts`、`src/lib/tender-understanding/package-input.ts`、`src/lib/files/intelligence-extractor.ts`、`src/lib/tender-analyst-memo/v2/pipeline.ts`）与本 change 没有共同文件；两边都改 `scripts/test-all.sh`、`scripts/test-ci-unit.sh` 与 TASKFLOW，FIX-19 后合并时由它合入 main。
- 合入 main `d94e4323`（含 FIX-13 / 17 / 21 / 23、CHAIN-4c / 2b / 3b / 3c、BIDPAGE-1 等）后：本 change 要改或引用的代码文件在 `13c7ed33..d94e4323` 之间没有改动（`git diff --stat` 只有 `scripts/test-all.sh`、`scripts/test-ci-unit.sh`），四件套里的行号逐条与代码对过，都对；TASKFLOW 的 CHAIN-0 行仍在 `:284`、FIX-13 行在 `:296`；`grep -c "| 待定 |"` 原有 **17** 条（FIX-21 / FIX-23 登记的），本次加 7 条后为 24。
- 开工前跑了将要触碰模块的已注册测试，记下基线（全过）：`extracted-text` 42、`inbound-parse` 38、`inbound-apply` 72、`notes-parse` 17、`chat-attachments` 54、`quote-import` 74、`disclosure-analysis-pure` 50、`priority-conflict` 10、`durable-followup-pure` 73、`mail-untrusted-guard` 56、`tool-list-modules` 37、`mail-tool-visibility` 69、`effective-platform-role` 63、`digital-employee` 50、`residual-reads` 76、`page-parse` 29、`procurement-records-db.isolated` 158、`tracking-notify-wiring` 67。

## 2. 做了什么

规则与 FIX-13 完全相同，不另立：每个 U+0000 换成一个空格，每个落单的 UTF-16 代理字符换成 U+FFFD，其余字符原样，前后字数相同；不含这两类字符的文字逐字不变（`toStorableText` 没有这类字符时原样返回同一个字符串）。JSON 形状的数据用新加的 `toStorableJson`（`src/lib/files/extracted-text.ts`）按结构遍历，对每个字符串（含键名）调 `toStorableText`，只往数组与普通对象里递归，不改传进来的值。

| 入口 | 改了哪里 | 改动前（实测） | 改动后 |
|---|---|---|---|
| 询价回信 | `src/lib/tender-rfq/inbound-parse.ts`：每个附件的文字与文件名先清理再判断有没有文字，并记下被换掉的 U+0000 个数（校验后类型 `attachmentsSeen` 每项可选 `nulCount`，只在大于 0 时出现）；正文与附件拼好、截到 16000 字之后再清理（模型与证据核对共用这一份）。`src/lib/tender-rfq/inbound-apply.ts`：这次追加的整段报价备注写库前清理；附件一栏「已解析」后加那句提示 | 模型在勾选框处写空格：价格证据 `EVIDENCE_NOT_IN_TEXT` 被作废，不报错、不通知，条目变「已回复」、备注「缺：价格」；模型照抄：备注带 U+0000，`recordQuote` 写库失败（报错只留前 300 字，22021 被截掉，只看得到 ``Invalid `db.inquiryItem.update()` invocation…``），记 `rfq_inbound:failed`，通知「有一封供应商回信解析失败，请手工录入」，条目停在「已回复」 | 两种模型都通过核对：单价 12.5、交期 30 天入表，条目「已报价」，照常发「报价了」通知与既有 Muse 事件；备注附件一栏「附件：q.pdf 已解析（有 1 处无法识别的符号，可能是勾选框或无法识别的字形，请对照原件核对）」；只有 U+0000 的附件记「附件无可提取文本（可能是扫描件）」 |
| 采购记录附件 | `src/lib/procurement-records/attachments.ts`：PDF 每页文字先清理再判断要不要 OCR；工作表文字、单元标签、`sheetRangesJson` 的工作表名先清理；明细写库前整条过 `toStorableJson`。CSV / TXT 不改（G3-A） | 勾选框 PDF / xlsx 单元格 `_x0000_`：写解析单元报 22021，附件停在「解析中」；一行明细在第 1000 字处劈开表情符号：附件「已解析」、明细为零、按口径分析没跑（`InvalidArg`） | 都「已解析」，页文字「…check the box.\n  The Bidder declares…」，只有 U+0000 的页标需要 OCR；长明细入库、原文片段以 U+FFFD 结尾、待复核，分析照常多一个版本 |
| AI 对话附件与对话标题 | `src/lib/chat-attachments/core.ts`：新方式先清理文件名与正文再判空与长度；旧方式截断（文件名 200 字、正文 15 万字）之后清理，清理掉东西且只剩空白时按没有附件处理；新增 `storableTitle`（截断再清理）。5 处标题改用它：`src/app/api/ai/threads/[threadId]/messages/route.ts` 3 处（60 字）、`src/app/api/trade/chat/[sessionId]/messages/route.ts` 1 处（30 字，「...」在清理之后拼）、`src/lib/assistant/followup-task.ts` 1 处（60 字）。`src/lib/market-intelligence/research-runtime.ts`：市场证据截到 2 万字后清理 | 附件正文带 U+0000：写消息 22P05，接口 500，消息没存下；旧客户端文件名 / 标题 / 市场证据在截断处劈开表情符号：`InvalidArg`（外贸对话是消息与回复都已存、模型已调用之后才 500） | 消息存下、附件正文该处为空格；标题以 U+FFFD 结尾写入成功；调研任务建成（等待研究）；新客户端正文只有 U+0000 的附件 **400「附件「〈文件名〉」没有可分析的文本内容」**（唯一的接口返回变化） |
| 产品资料录入 | `src/lib/product-content/intake/analyze.ts`：事实抽取函数第一步清理传进来的文字（文件 PDF / Excel、网页、文字、语音转写四种来源都经这一处） | 规格 PDF 一行「\u0000 Color: Red」：写事实 22021，「分析输入」停在 running，任务停在 ANALYZING，接口 500，每次重跑一样 | 事实 color = Red、原文行「Color: Red」，这一步完成，任务按缺字段照常到 NEEDS_INPUT / PLAN_READY |
| 报价成本表导入 | `src/lib/quote-engine/import/import-service.ts`（只改 `createImportFromUpload` 内部）：抽取结果出来马上整份过 `toStorableJson`（对可引用单元与 AI 归类之前）；写导入记录前抽取结果、元数据与供应商名再清理一遍；失败原因 `e.message.slice(0, 500)` → `toStorableParseError(e.message)` | 状态「失败」，`errorMessage` 含 22P05 或 `unexpected end of hex escape`，界面「抽取失败：…」；工作表名带 U+0000 时行对不上可引用单元 | 状态「待审核」，说明「Flag  nylon 3x5」；第 300 字处劈开表情符号的说明与原文片段以 U+FFFD 结尾；工作表名带 U+0000 的行照常带上可引用单元的页号与标签 |

两个协调点（BIDPAGE 会话只读这两个文件的结果）：`import-service.ts` 与 `inbound-apply.ts` 的导出签名与返回形状都没改，只改了内部——`createImportFromUpload` 返回的 `extraction` 现在是清理后的那一份；`inbound-apply.ts` 只加了模块内的私有函数（没有新增或改动导出），`planInquiryItemUpdate` 的 `parsed` 参数类型来自 `inbound-parse.ts` 的 `ParsedQuote`，其中 `attachmentsSeen` 每项多一个可选的 `nulCount`。读到的结果的不同：成本表导入记录里 U+0000 变空格、落单代理字符变 U+FFFD；询价报价备注的附件一栏可能多那句提示（要从备注取字段请经 `notes-parse.ts`，附件一栏不进任何回读字段）。

## 3. 与四件套不一致、已改四件套的地方

1. 开工顺序：tasks「开工前提」、design Context 与「相邻改动」、proposal Impact 原写「FIX-19 合并后合入 main 再开工」，改成事实（FIX-19 未合并、按 §0.5k 第 9 条例外先开工、两者无共同文件、FIX-19 后合并时由它合入 main），并写明合入 `d94e4323` 后的复核结果与「| 待定 |」原有 17 条；tasks 7.1 verify 里「原有」的说明同步（「main `13c7ed33` 上为 0，合入 `d94e4323` 后为 17」）。
2. 行号：四件套的代码行号以 main `13c7ed33` 为准，合入后逐条核对都对，没有改。本次改动之后这些文件的行号有移动，TASKFLOW 里 7 条后续任务的行号按**改动后**的代码写（例如采购附件的认领 `attachments.ts:176`、`:261`，CSV 判断 `:124–126`，产品资料报错 `analyze.ts:222–225`、`:305`、`:347`，`blobPath` 在 `core.ts:128`），tasks 7.1 里的是改动前的行号。
3. 实现细节（不改范围与对外行为，四件套没写到这一层，记在这里）：
   - 旧客户端的判空：design D5 写「截断之后清理、清理之后再判一次空」。实现为「清理掉了东西、且清理后只剩空白」才按没有附件处理，保证不含这两类字符的输入（哪怕前 15 万字全是空白这种极端情况）与改动前完全相同。
   - 旧客户端文件名只由 U+0000 组成时，清理后是一串空格，按既有的「没有文件名」处理成「上传文件」。
   - 新方式文件名先清理再去首尾空白：只有 U+0000 的文件名按既有的「附件缺少文件名」拒绝。
   - 询价回信的 U+0000 个数按附件抽出的原文（清理与去首尾空白之前）计；`nulCount` 只在大于 0 时出现，所以没有 U+0000 的附件审计与改动前逐字相同。
   - 「合并后要人做的事」第 2 步的第二条查询：design 写「`attachmentsSeen` 里有已解析 PDF」，审计里只记文件名与是否解析、没有 MIME，SQL 按「有任一已解析附件」查（比只查 `.pdf` 宽，xlsx 的 `_x0000_` 也会产生 U+0000），见 §9。

## 4. 验证

### 4.1 新增测试（都已注册：前者进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`，后者只进 `scripts/test-all.sh`）

`env -u DATABASE_URL -u DIRECT_URL npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts`（不用数据库）：真实 unpdf 读 FIX-13 夹具现拼的 PDF、SheetJS 现写的 xlsx、字符串现拼的截断场景；询价回信两个假模型（勾选框处写空格 / 原样照抄收到的那一行）；另有接线断言（读源码）。

| 段 | 项数 | 在改动前的代码上 |
|---|---|---|
| 询价回信 | 23 | 7 过 16 败（`prices[0]` 为 `EVIDENCE_NOT_IN_TEXT`；照抄时备注带 U+0000；16000 字处以 `\ud83d` 结尾；只有 U+0000 的附件记「已解析」…） |
| 采购记录附件 | 9 | 3 过 6 败 |
| AI 对话附件与对话标题 | 20 | 6 过 14 败（含接线断言） |
| 产品资料录入 | 2 | 0 过 2 败（接线断言） |
| 报价成本表导入 | 8 | 「前提」1 项通过后中途抛错（`toStorableJson is not a function`）；只换回 `import-service.ts` 时 5 过 3 败（3 项接线断言） |
| 合计 | **62 过 0 败** | 把本 change 改的 11 个源文件换回 `origin/main` 版本：17 过 38 败后在成本表段抛错 |

`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts`（隔离库 `qy_iso_f`）：五个入口各走一遍真实写库。

| 段 | 项数 | 在改动前的代码上（11 个源文件换回 `origin/main`） |
|---|---|---|
| 询价回信（`defaultInboundSyncDeps()` 只换掉 Gmail 与模型，`applyPlan` / `writeAudit` / 通知都是真的） | 9 | 1 过 8 败：`failed: 1`，`rfq_inbound:failed` 的 `error` 为 ``Invalid `db.inquiryItem.update()` invocation in …/inquiry/service.ts:335:40 …``（前 300 字，看不到 22021），条目停在 `replied`，通知「有一封供应商回信解析失败，请手工录入」 |
| 采购记录附件（`saveAttachment` + `processAttachment(id, { readBuffer })`） | 8 | 0 过 8 败：两份附件写单元 `PostgresError 22021`、停在 `PARSING`；长明细 `unexpected end of hex escape`、附件 `PARSED`、明细 0、分析 0 → 0 |
| AI 对话附件、对话标题与市场调研（写 `AiMessage` / `TradeChatMessage` / `AiThread.title` / `TradeChatSession.title`，跑 `queueMarketResearchRequest`） | 6 | 0 过 6 败：附件 `22P05 unsupported Unicode escape sequence`，文件名 / 两种标题 / 市场证据 `unexpected end of hex escape` |
| 产品资料录入（本地文件存储跑 `analyzeJobInputs`） | 3 | 0 过 3 败：写事实 22021，`analyze_inputs` 为 `running`，任务 `ANALYZING` |
| 报价成本表导入（`createImportFromUpload`） | 6 | 0 过 6 败：三次导入都 `FAILED`，`errorMessage` 含 `22P05` 或 `unexpected end of hex escape at line 1 column 632` |
| 合计 | **32 过 0 败** | **1 过 31 败**（唯一通过的是「同一封回信再跑一次按已处理跳过」） |

`npx tsx src/lib/files/__tests__/extracted-text.test.ts`：42 → **52**（新增 `toStorableJson` 10 项：键名与嵌套数组、数字 / 布尔 / null 不变、Date 等类实例原样、不改入参、`__proto__` 键仍是自有属性）；改动前的代码上导入即失败。

每个 task 实施时也单独做了「先在改动前看到失败」：1.1（不用库 7/16、隔离库 2/7）、2.1（隔离库采购段 0/8）、3.1（隔离库对话段 0/6）、4.1、5.1（隔离库成本表段 3 项失败），做法是把该 task 改的源文件 `git stash` 后跑、再还原。

### 4.2 既有测试（改动后照旧通过）

`inbound-parse` 38、`inbound-apply` 72、`notes-parse` 17、`tracking-notify-wiring` 67、`chat-attachments` 54、`durable-followup-pure` 73、`durable-followup-m1.isolated` 61、`mail-untrusted-guard` 56、`tool-list-modules` 37、`mail-tool-visibility` 69、`effective-platform-role` 63、`digital-employee` 50、`residual-reads` 76、`b1-tenant-context-static` 20、`research-runtime` 13、`quote-import` 74、`quote-ops-contract` 75、`disclosure-analysis-pure` 50、`procurement-records-db.isolated` 158、`priority-conflict` 10、`page-parse` 29。`git diff origin/main -- src/lib/tender-rfq/inbound-sync.ts src/lib/tender-rfq/inbound-contract.ts src/lib/tender-rfq/notes-parse.ts` 为空。

### 4.3 门禁

| 门禁 | 命令 | 结果 |
|---|---|---|
| 全量 | 新库 `qy_full_fix14`（`DROP / CREATE DATABASE` 后 `npx prisma migrate deploy`）上 `npm test`（提交 `b4f416d0`） | **722/732 通过、10 失败**，失败清单与本机 main 基线逐条相同：来信观察 DB（MAIL-2）、Sunny 工艺单 DB、Phase3A-3 Approvals Smoke、Phase3A-4 Governance Smoke、Phase3A-4 Acceptance、Autopilot A2-P0 Isolated E2E、Phase3A-5 Overview Acceptance、T4 授标情报真实 Postgres 矩阵、客户报价 PDF 分页布局、招标询价自动起草第 1 轮 DB；本 change 的两个新测试 62 / 32 全过，`extracted-text` 52 过 |
| CI 子集 | `env -u DATABASE_ENVIRONMENT DATABASE_URL=…ci… DIRECT_URL=…ci… JWT_SECRET=ci-only-… NODE_ENV=test npm run test:ci` | 末行 `CI unit subset PASS`（新测试 62 过） |
| 类型 | `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` | 退出码 0 |
| lint | `npm run lint:baseline` | PASS（errors 38 / 基线 53，没有新增 fingerprint） |
| 测试注册 | `bash scripts/check-test-registry.sh` | OK（已注册 698 个，基线 66 条未增） |
| 运行时架构 | `bash scripts/test-runtime-architecture.sh` | PASS（9 过） |
| OpenSpec | `openspec validate extracted-text-nul-other-paths --strict` | valid |
| 冻结面 | `git diff origin/main -- prisma/ vercel.json package.json package-lock.json .claude/launch.json openspec/specs openspec/config.yaml` | 为空 |
| 开关前提 | `grep -c "FIX-14 部署之后" docs/QINGYAN_CHAIN-0_ENV_CHECK.md`；`grep -n "^| CHAIN-0 " docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`；`grep -n "^| FIX-14 "`；`grep -c "| 待定 |"` | 2；CHAIN-0 行含「FIX-14 部署之后」；FIX-14 在 `:297`（FIX-13 在 `:296`）；24（原有 17 + 7） |

全量跑完之后只改了一处：`inbound-apply.ts` 里那句提示的函数由导出改为模块内私有（行为不变，免得多出一个导出）；改后重跑了 `inbound-apply` 72、`inbound-parse` 38、`notes-parse` 17、新测试 62，以及上表的 CI 子集、类型、lint。

## 5. 没验证到的

- 没有用真实模型跑询价回信：两个假模型覆盖了「勾选框处写空格」与「原样照抄」两端，真实模型的写法在这两者之间。
- 没有核实同一字体里「已勾选」与「未勾选」的字形是否都抽成 U+0000（夹具与 FIX-13 附录 B 的都是未勾选框）。勾选框式选项表（「☐ EXW ☐ FOB ☐ DDP」）清理后只剩选项文字，模型挑出的选项可能没有依据——这正是 G5-B 那句提示要人去翻原件的原因，提示本身不改入表与核对的结果。
- AI 对话两个路由没有整条 HTTP 走一遍（主助手路由要过鉴权、限流、分流与流式模型调用，外贸路由会调模型）：隔离库测试直接用路由里同一组函数（`parseAttachmentsInput` / `attachmentsFromLegacyFile` / `attachmentsTitleSource` / `storableTitle`）的结果写库，另有接线断言核对路由与跟进任务只用校验后的附件写库、5 处标题都经 `storableTitle`。
- 报价成本表的 AI 归类路径（`ai.enabled`）没有在隔离库里跑（不调模型）；AI 给的说明在写库前的第二遍清理里兜住，由接线断言核对顺序。
- 没有访问生产，「合并后要人做的事」里的查询条数未知。

## 6. 没有开关，合并即在生产生效；回退办法

没有开关，合并部署后五个入口立即按新规则处理。回退 = 回退本 PR（零 schema，没有数据迁移；回退后已入库的清理过的文字照样能读）。

## 7. 上线顺序与询价开关的前提

三个询价开关（`TENDER_RFQ_AUTO_DRAFT_ENABLED`、`TENDER_RFQ_SUPPLIER_GROUPS_ENABLED`、`TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED`）要等本 PR 部署之后才开（G2 已定 A：不拆，没有「询价回信先合」的捷径；要在 FIX-14 合并之前开，先回 GATE 重新定 G2）。本 PR 已改三处前提：`docs/QINGYAN_CHAIN-0_ENV_CHECK.md` 的「填写顺序」与第 7 行建议值（`grep -c "FIX-14 部署之后"` 为 2）、TASKFLOW 的 CHAIN-0 行，都改成「CHAIN-4b 合并且 FIX-14 部署之后」；核查表第 7 行的日期必须晚于本 PR 的部署日期，「原值 / 新值 / 日期」三列不填。CHAIN-4b 行「staging 真实标包实测做完之前不开 CHAIN-0 第 7 项」的既有前提照旧。入站这条路今天对人工发出的询价已经在跑，所以本 PR 越早部署越好，不只是为了开关。

## 8. 没做的与后续任务

后续任务已登记进 TASKFLOW（FIX-14 一行之后，编号「待定」，状态 `[ ]`）：

1. 对话标题 5 处以外，把用户打的字按字数截断后写入文本列的地方逐处排查（已知 `src/lib/assistant/dispatch.ts:196` 持久分流写 `AiThread.title`，`input.userContent.slice(0, 60)`，design Non-Goals 写明本次不改这个文件）。
2. AI 对话附件的 `blobPath`：手工构造带 U+0000 的路径写库 22P05、500（`src/lib/chat-attachments/core.ts:128`）。
3. 采购记录附件认领满 5 次后一直「解析中」、不记原因（`attachments.ts:176`、`:261`）。
4. 采购记录附件 `FAILED` 不被定时任务再认领，标签却写「解析失败（稍后重试）」（`attachments.ts:188`、`:261`，`labels.ts:203`）。
5. 采购记录附件 CSV / 纯文本按 UTF-8 读，带字节序标记的 UTF-16 CSV 被判「文件损坏」（G3-A；`attachments.ts:124–126`）。
6. 询价回信写库失败时不回滚、失败后不重试（`inbound-sync.ts:258–272`、`:390`、`:412–414`）。
7. 产品资料的 `parseResultJson.error` 与 `parseNotes` 写 jsonb 前没有清理与收口（`analyze.ts:222–225`、`:305`、`:347`）。

没做、也不登记（G4 已定 A）：FIX-13 §7.1 只扫到的四处导入——外贸客户线索导入（`api/trade/prospects/import`；公司名带 U+0000 时查重那条查询本身就 22021、整个请求 500）、展会名片导入（`src/lib/trade/booth-cards.ts`）、客户 CSV 导入（`api/sales/import-csv`）、三个知识库导入（`api/org/knowledge/import`、`api/trade/knowledge/import`、`api/projects/[id]/knowledge-bases/[kbId]/import`；一个坏文件让后面的都不导入）。共同点：同步请求、导入人自己的文件、失败当场可见可重来、不在任何自动化路径上。

其余 Out of scope 照四件套：供应商画册解析不写库；用户在页面上打的字保存时不清理；只进模型提示不写库的截断（成本表 AI 归类送模型的 200 字、对话按预算展开附件）；不做 OCR、不换解析库。

## 9. 合并后要人做的事

按顺序做；查询都是只读（`BEGIN READ ONLY … ROLLBACK`），由**有生产数据库权限的人**跑，把 `:deploy_at` 换成本 PR 的生产部署时间（UTC）。下面的 SQL 已在本机隔离库上跑通（`psql -v ON_ERROR_STOP=1`，6 条查询都返回 0 行）。

```sql
\set deploy_at '''2026-12-01 00:00:00+00'''   -- 换成本 PR 的生产部署时间
BEGIN READ ONLY;

-- 1a 采购附件：认领满 5 次、一直停在「解析中」
SELECT a.id, a."orgId", a."requestId", a."originalFilename", a."parseAttempts", a."parseStartedAt"
FROM "RecordsAttachment" a
WHERE a."parseStatus" = 'PARSING' AND a."parseAttempts" >= 5
ORDER BY a."orgId", a."uploadedAt";

-- 1b 采购附件：披露文件「已解析」却没有任何明细，且解析之后申请没有跑过分析（写明细失败时分析没跑）
SELECT a.id, a."orgId", a."requestId", a."originalFilename", a."parsedAt"
FROM "RecordsAttachment" a
WHERE a.kind = 'DISCLOSURE_FILE' AND a."parseStatus" = 'PARSED'
  AND NOT EXISTS (SELECT 1 FROM "ProcurementLineItem" l WHERE l."attachmentId" = a.id)
  AND NOT EXISTS (SELECT 1 FROM "ProcurementAnalysis" an WHERE an."requestId" = a."requestId" AND an."createdAt" >= a."parsedAt")
ORDER BY a."orgId", a."parsedAt";

-- 2a 询价回信：部署前 90 天内全部「解析失败」（不按报错文字筛：失败原因只留前 300 字，22021 可能被截掉）
SELECT al."projectId", al."createdAt", al."targetId" AS gmail_message_id,
       (al."afterData")::jsonb ->> 'itemId' AS inquiry_item_id, (al."afterData")::jsonb ->> 'error' AS error
FROM "AuditLog" al
WHERE al.action = 'rfq_inbound:failed' AND al."targetType" = 'rfq_inbound_message'
  AND al."createdAt" >= (:deploy_at)::timestamptz - INTERVAL '90 days' AND al."createdAt" < (:deploy_at)::timestamptz
ORDER BY al."projectId", al."createdAt";

-- 2b 询价回信：部署前 90 天内入了表、但有证据被判「不在原文里」且带已解析附件的（价格 / 交期可能被悄悄作废）
SELECT al."projectId", al."createdAt", al."targetId" AS gmail_message_id,
       (al."afterData")::jsonb ->> 'itemId' AS inquiry_item_id,
       (al."afterData")::jsonb -> 'rejected' AS rejected, (al."afterData")::jsonb -> 'attachmentsSeen' AS attachments_seen
FROM "AuditLog" al
WHERE al.action = 'rfq_inbound:applied' AND al."targetType" = 'rfq_inbound_message'
  AND al."createdAt" >= (:deploy_at)::timestamptz - INTERVAL '90 days' AND al."createdAt" < (:deploy_at)::timestamptz
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE((al."afterData")::jsonb -> 'rejected', '[]'::jsonb)) r WHERE r ->> 'reason' = 'EVIDENCE_NOT_IN_TEXT')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE((al."afterData")::jsonb -> 'attachmentsSeen', '[]'::jsonb)) x WHERE x ->> 'parsed' = 'true')
ORDER BY al."projectId", al."createdAt";

-- 3a 产品资料：「分析输入」停在进行中
SELECT j."createdById", j.id AS job_id, j.title, s."startedAt"
FROM "ProductContentStep" s JOIN "ProductContentJob" j ON j.id = s."jobId"
WHERE s."stepKey" = 'analyze_inputs' AND s.status = 'running' AND s."startedAt" < (:deploy_at)::timestamptz
ORDER BY j."createdById", s."startedAt";

-- 3b 报价成本表：部署前「失败」的导入（不按报错文字筛：原因只留前 500 字）；reimported_since = 之后同一份文件已重新导入且没失败
SELECT i."createdById", i."projectId", i."sourceFilename", i."createdAt", i."errorMessage",
       EXISTS (SELECT 1 FROM "QuoteCostImport" later WHERE later."quoteId" = i."quoteId" AND later."contentHash" = i."contentHash"
               AND later."createdAt" > i."createdAt" AND later.status <> 'FAILED') AS reimported_since
FROM "QuoteCostImport" i
WHERE i.status = 'FAILED' AND i."createdAt" < (:deploy_at)::timestamptz
ORDER BY i."createdById", i."createdAt";

ROLLBACK;
```

1. **采购附件（G1 已定 A：不写补救代码）**：1a、1b 都为零就结束。有的话按 G1-A 的字段改法走 Owner Gate（Evan 拍板）做一次生产写操作：1a 类把 `parseAttempts` 改成 0；1b 类把 `parseStatus` 改回 `PENDING`、`parseAttempts` 改成 0。之后由每小时 25 分的 `tender-watch` 自动重新认领（解析单元按 `(attachmentId, unitIndex)`、明细按 `(attachmentId, dedupeKey)` 跳过已有的，分析多一个版本），不用人点。1b 的查法可能混进少数真的没有明细、又没跑过分析的文件，重跑对它们无害。生产上没开 `PROCUREMENT_RECORDS_SCHEMA_READY` 时这两张表可能是空的。
2. **询价回信**：2a、2b 两份名单按 `projectId` 分组交项目负责人：2a 确认是否都已人工录入（已记失败的回信不会再被自动处理，幂等键就是这条审计）；2b 对照原件补录被作废的价格 / 交期（这类回信当时备注写「回信涉及报价但未提取到可核验字段」，缺价格的可能已起草过追问卡）。
3. **产品资料与成本表**：3a、3b 的名单按 `createdById` 交给各自的创建人，由创建人重新跑一次分析 / 重新导入一次（`reimported_since` 为真的可以跳过）。
4. **AI 对话**：改动前写库失败的消息没有存下，查不出名单，不用做；用户重发即可。
5. 上面几步做完，才按 §7 打开询价开关（核查表第 7 行的日期晚于本 PR 的部署日期）。

## 10. GATE 六条的结论（Lucas 2026-11-22，都与原推荐相同）

| # | 问题 | 结论 |
|---|---|---|
| G1 | 采购附件两类历史失败怎么补 | **A**：不写补救代码，上线后按 §9 第 1 步查，有就走 Owner Gate |
| G2 | 询价回信要不要拆成独立 change 先合 | **A**：不拆，一个 change 一个 PR；三个询价开关等整个 FIX-14 合并部署之后才开 |
| G3 | 采购附件 CSV / 纯文本要不要改用 FIX-13 的解码 | **A**：不改读法；UTF-16 CSV 被判损坏登记为后续任务 5 |
| G4 | FIX-13 §7.1 只扫到的四处导入要不要另开任务 | **A**：不另开，只写在 §8「没做的」 |
| G5 | 询价回信附件里有 U+0000 被换掉时要不要在报价备注里注明 | **B**：注明「（有 N 处无法识别的符号，可能是勾选框或无法识别的字形，请对照原件核对）」，只进报价备注与审计里的个数，不进通知、Muse 与模型提示，不改入表、核对与比价回读 |
| G6 | 对话标题截断后清理的范围 | **A**：5 处都清理（含跟进任务）；5 处以外登记为后续任务 1 |

## 11. 与八条硬纪律的关系

1. 零 schema：遵守——`git diff origin/main -- prisma/` 为空；只改写入前的字符串。
2. 出站先审批：不新增任何出站。修好后以前写库失败的回信会正常入表，入表后同一次检查里的催单扫描按既有规则起草缺字段追问卡，经人批准或既有的跟进授权（RFQ-AUTO-1）才发出。
3. 禁止第三套队列：不涉及——复用既有的 `tender-rfq-inbound` cron、`tender-watch` 里的附件兜底与 `after()`，认领与重试不改。
4. 脱敏：遵守——只替换字符，不新增输出位置；询价通知与 Muse 事件不读报价备注（隔离库测试断言新增通知的标题与摘要里没有附件文字、证据片段与那句提示）；比价回读经 `notes-parse.ts` 只取起订量、贸易条款、多档价、强制项与缺字段，那句提示不在任何回读字段里（带 / 不带这句话 `parseAutoNotes` 结果相同）；审计照旧只有结构化字段与证据片段，附件多一个符号个数。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及（入站仍按组织设置的 `mailboxEmail` 找邮箱，`inbound-sync.ts` 未改）。
7. 确定性优先：遵守——纯字符替换与计数，没有新增模型调用；询价回信的模型提示只在这两类字符处与以前不同。
8. 测试注册：两个新测试同一提交注册，`bash scripts/check-test-registry.sh` OK（已注册 698 个，基线 66 条未增）。

## 12. 提交

| task | 提交 |
|---|---|
| 1.1 询价回信（含两个新测试与注册、四件套开工顺序按事实改） | `2a502461` |
| 2.1 采购记录附件 + `toStorableJson` | `9f71b29a` |
| 3.1 AI 对话附件、对话标题与市场调研 | `bb3c9ada` |
| 4.1 产品资料录入 | `24c4dbb4` |
| 5.1 报价成本表导入 | `b4f416d0` |
| 6.1 门禁 + 7.1 报告、开关前提与 TASKFLOW | 本提交 |

## 13. 多维审查

（留空，由协调会话补）
