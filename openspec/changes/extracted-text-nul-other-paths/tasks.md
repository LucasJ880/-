# Tasks：其它文字抽取入口入库前清理 U+0000 / 落单代理字符（FIX-14）

开工前提：

- 开工顺序（2026-11-23 按事实改）：FIX-17、FIX-21 已合并；**FIX-19 未合并**（卡在等生产只读查询结果），协调会话按交接文档 §0.5k 第 9 条的例外（不碰 FIX-19 文件的 change 可以先走）让 FIX-14 先开工。FIX-19 改的文件（`src/lib/files/document-source.ts`（新）、`src/app/api/projects/[id]/files/route.ts`、`src/lib/tender-auto-analysis/{package,package-ready,package-coverage,reply-resolution,display-labels}.ts`、`src/lib/tender-understanding/package-input.ts`、`src/lib/files/intelligence-extractor.ts`、`src/lib/tender-analyst-memo/v2/pipeline.ts`）与本 change 没有共同文件；两边都改 `scripts/test-all.sh`、`scripts/test-ci-unit.sh` 与 TASKFLOW，FIX-19 后合并时由它合入 main。开工前已 `git merge origin/main`（main `d94e4323`，不 rebase），合入后复核：本 change 要改或引用的代码文件在 `13c7ed33..d94e4323` 之间没有改动（`git diff --stat` 只有 `scripts/test-all.sh`、`scripts/test-ci-unit.sh`），design 与本文引用的行号仍对；`grep -c "| 待定 |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 为 **17**（FIX-21 / FIX-23 登记的后续任务），作为 7.1 的「原有」条数；TASKFLOW 的 CHAIN-0 行仍在 `:284`，FIX-13 行在 `:296`。
- FIX-13（#546）已于 2026-11-22 合并（main `13c7ed33`）——`src/lib/files/extracted-text.ts` 与夹具 `src/lib/tender-auto-analysis/__tests__/fixtures/nul-pdf.ts` 在 main 上。
- 按 `openspec/config.yaml` 先跑一遍将要触碰模块的已注册测试，记下通过数。
- GATE 已定（Lucas 2026-11-22）：G1 = A、G2 = A（不拆，一个 change 一个 PR）、G3 = A、G4 = A、G5 = B、G6 = A，各条见 design「留给 GATE」。

## 1. 询价回信（排第一：询价自动化三个开关打开之前必须已上线，见 design「上线顺序」）

- [x] 1.1 测试先行：新建 `src/lib/files/__tests__/extracted-text-other-paths.test.ts`（不用数据库）与 `src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts`（隔离库），同一步注册进 `scripts/test-all.sh`（前者同时进 `scripts/test-ci-unit.sh`）；先写询价回信的用例——用 FIX-13 夹具的 `buildPdf` 现拼同一行「Unit price CAD 12.50 per flag」+ U+0000 +「Delivery 30 days」的 PDF，两个假模型（勾选框处写空格 / 原样照抄收到的那一行）、16000 字处劈开表情符号、附件只有 U+0000、附件文件名带 U+0000、证据以半个表情符号结尾、附件一栏「（有 N 处无法识别的符号，可能是勾选框或无法识别的字形，请对照原件核对）」一句且送进模型的提示里没有它、带与不带这句话的同一段备注经 `parseAutoNotes` 结果相同；隔离库用 `defaultInboundSyncDeps()` 换掉 Gmail 与模型、保留真实写库，一家「已发出」的条目，断言入表、新增通知与审计里没有附件文字、同一封信再跑一次不重复处理——并在改动前的代码上看到失败；再改 `src/lib/tender-rfq/inbound-parse.ts`（附件文字与文件名在判断有没有文字之前清理并计数、计数经校验后类型里 `attachmentsSeen` 每一项的可选字段带出、拼好截到 16000 字之后再清理）与 `src/lib/tender-rfq/inbound-apply.ts`（这次追加的备注清理、附件一栏的那一句）；verify：`env -u DATABASE_URL -u DIRECT_URL npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 与 `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts` 全过，改动前的失败输出（写空格时 `prices[0]` 为 `EVIDENCE_NOT_IN_TEXT`；照抄时 `rfq_inbound:failed` 的 `error` 与条目停在 `replied`）留给报告；`npx tsx src/lib/tender-rfq/__tests__/inbound-parse.test.ts`、`npx tsx src/lib/tender-rfq/__tests__/inbound-apply.test.ts`、`npx tsx src/lib/tender-rfq/__tests__/notes-parse.test.ts` 照旧通过；`git diff origin/main -- src/lib/tender-rfq/inbound-sync.ts src/lib/tender-rfq/inbound-contract.ts src/lib/tender-rfq/notes-parse.ts` 为空；`bash scripts/check-test-registry.sh` 输出 OK

## 2. 采购记录附件

- [x] 2.1 在 `src/lib/files/extracted-text.ts` 加按结构遍历的清理函数（每个字符串含键名调 `toStorableText`，只往数组与普通对象里递归），用例补进 `src/lib/files/__tests__/extracted-text.test.ts`；`src/lib/procurement-records/attachments.ts` 里 PDF 每页文字在判断要不要 OCR 之前清理，工作表文字、单元标签、`sheetRangesJson` 的工作表名写之前清理，明细在写库前整条过遍历函数；CSV / TXT 不改；两个测试文件补用例（勾选框 PDF、30 个 U+0000 的页 → 需要 OCR、xlsx 单元格 `_x0000_`、CSV 含 U+0000 仍「文件损坏」、xlsx 一行明细在第 1000 字处劈开表情符号；隔离库经 `processAttachment(id, { readBuffer })`，先在改动前看到附件停在 `PARSING` / 明细为零）；verify：两个新测试与 `npx tsx src/lib/files/__tests__/extracted-text.test.ts` 全过，`npx tsx src/lib/procurement-records/__tests__/disclosure-analysis-pure.test.ts` 与 `NODE_ENV=test npx tsx src/lib/procurement-records/__tests__/procurement-records-db.isolated.test.ts` 照旧通过

## 3. AI 对话附件、对话标题与市场调研

- [ ] 3.1 `src/lib/chat-attachments/core.ts`：新方式先清理文件名与正文、再做「有没有可分析的文本」与长度校验；旧方式照旧截断（文件名 200 字、正文 15 万字）、截断之后清理、清理之后再判空；加一个「截断到 N 字再清理」的标题函数，`src/app/api/ai/threads/[threadId]/messages/route.ts`（`:431`、`:720`、`:1241`）、`src/app/api/trade/chat/[sessionId]/messages/route.ts`（`:123`，「...」在清理之后拼）、`src/lib/assistant/followup-task.ts`（`:235`）生成标题改用它；`src/lib/market-intelligence/research-runtime.ts` 的市场证据在截到 2 万字之后再清理；两个测试文件补用例（正文带 U+0000、正文只有 U+0000 → 「附件「a.pdf」没有可分析的文本内容」、旧方式正文第 15 万字与文件名第 200 字处劈开表情符号、只发附件时「附件：〈文件名〉」第 60 字处劈开表情符号、外贸对话标题第 30 字处劈开；接线断言：两个对话路由与跟进任务只用校验后的附件写库、5 处标题都经同一个标题函数、没有直接截断标题的写法；隔离库写 `AiMessage` / `TradeChatMessage`（含旧方式文件名劈开的附件）、用劈开表情符号的标题写 `AiThread.title` / `TradeChatSession.title`，并用在截断处劈开表情符号的市场证据跑 `queueMarketResearchRequest`，先在改动前看到 22P05 / `InvalidArg`）；verify：两个新测试全过；`npx tsx src/lib/trade/__tests__/chat-attachments.test.ts`、`npx tsx src/lib/assistant/__tests__/durable-followup-pure.test.ts` 与读这两个路由源码的既有守卫测试（`npx tsx src/lib/agent-core/__tests__/mail-untrusted-guard.test.ts`、`tool-list-modules.test.ts`、`mail-tool-visibility.test.ts`，`npx tsx src/lib/rbac/__tests__/effective-platform-role.test.ts`，`npx tsx src/lib/authorization/__tests__/digital-employee.test.ts`、`residual-reads.test.ts`）照旧通过

## 4. 产品资料录入

- [ ] 4.1 `src/lib/product-content/intake/analyze.ts` 的事实抽取入口先清理传入的文字（文件（PDF、Excel）、网页、文字、语音转写四种来源都经过它）；两个测试文件补用例（隔离库用本地文件存储跑 `analyzeJobInputs`：规格 PDF 一行「\u0000 Color: Red」→ 事实 color = Red、原文行「Color: Red」、「分析输入」一步完成，先在改动前看到这一步停在 running；不用库的接线断言：四种来源都经同一处清理）；verify：两个新测试全过，`npx tsx src/lib/product-content/__tests__/priority-conflict.test.ts` 照旧通过

## 5. 报价成本表导入

- [ ] 5.1 `src/lib/quote-engine/import/import-service.ts` 抽取结果出来之后过一次遍历函数（在匹配可引用单元与 AI 归类之前）、写导入记录之前整份与供应商名再过一次，`catch` 里的失败原因改用 `toStorableParseError`；两个测试文件补用例（xlsx 说明格「Flag\u0000 nylon 3x5」、超过 300 字的说明在第 300 字处劈开表情符号（不用库的测抽取结果，隔离库的测导入状态「待审核」与入库内容）、工作表名带 U+0000 时仍带上可引用单元、失败原因收口的接线断言；隔离库跑 `createImportFromUpload`，先在改动前看到状态 `FAILED`、`errorMessage` 含 `22P05`）；verify：两个新测试全过，`npx tsx src/lib/quote-engine/__tests__/quote-import.test.ts` 照旧通过

## 6. 验收

- [ ] 6.1 全部门禁；verify：`npm test` 与既有失败清单（`docs/QINGYAN_CHAIN-3_REPORT.md` §4）对照无新增失败；CI 环境变量下 `bash scripts/test-ci-unit.sh` 末行 `CI unit subset PASS`；`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出码 0；`npm run lint:baseline` PASS；`bash scripts/test-runtime-architecture.sh` PASS；`openspec validate extracted-text-nul-other-paths --strict` valid；`git diff origin/main -- prisma/ vercel.json package.json package-lock.json` 为空

## 7. 报告、开关前提与 TASKFLOW

- [ ] 7.1 写 `docs/QINGYAN_FIX-14_REPORT.md`、改三处询价开关前提、更新 TASKFLOW。
  - 报告内容：
    - 五个入口各自的写库点与改动前 / 改动后；改动前失败的测试输出；
    - 「留给 GATE」六条的结论（Lucas 2026-11-22：G1 A、G2 A、G3 A、G4 A、G5 B、G6 A）；
    - **没有开关，合并即在生产生效**；回滚 = 回退本 PR；
    - 上线顺序：三个询价开关要等本 PR 部署之后才开（G2 已定 A，不拆，没有先合询价回信的捷径）；
    - 合并后要人做的事（design「Migration Plan」五步）：要跑的只读查询，附 SQL——采购附件 (a) / (b) 两类、部署前 90 天的 `rfq_inbound:failed` 与带 `EVIDENCE_NOT_IN_TEXT` 的 `rfq_inbound:applied`、停在 running 的「分析输入」、`FAILED` 的成本表导入；名单就从这几条查询来，询价回信按项目分组、产品资料与成本表按创建人分组；谁来做——有生产数据库权限的人跑查询，采购附件两类的写操作走 Owner Gate（Evan 拍板）、之后由定时任务自动重新认领，询价回信由项目负责人核对与补录，产品资料与成本表由创建人重新跑一次，AI 对话查不出名单、用户重发即可；这些做完才开询价开关；
    - 多维审查结论；
    - 没做的：四处导入接口（G4 已定 A：只写在这里，不登记后续任务）、对话标题 5 处以外把用户打的字截断后写库的地方、手工构造的 `blobPath`，以及下面登记的其余后续任务。
  - 三处询价开关前提（本实现 PR 里改）：`docs/QINGYAN_CHAIN-0_ENV_CHECK.md` 的「填写顺序」（`:8`）与第 7 行「建议值」（`:19`）、`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的 CHAIN-0 行（main `13c7ed33` 与 `d94e4323` 上都是 `:284`，以 grep 定位为准），都改成「CHAIN-4b 合并且 FIX-14 部署之后」再开三个询价开关；核查表「原值 / 新值 / 日期」三列不填。
  - `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`：「Phase F（续）— 情报串联」表 FIX-13 之后新增 FIX-14 一行，依赖 FIX-13，状态 `[~]`。同时登记 7 条后续任务，各一行，编号写「待定」，状态 `[ ]`：
    1. 对话标题 5 处以外，把用户打的字按字数截断后写入文本列的地方没有逐处排查，截断劈开表情符号会写库失败（全仓 `.slice(0, N)` 之后写库的地方）；
    2. AI 对话附件的 `blobPath`：手工构造带 U+0000 的路径写库报 22P05、接口返回 500（`src/lib/chat-attachments/core.ts:122` 只去首尾空白与查前缀）；
    3. 采购记录附件认领满 5 次后一直停在「解析中」、不记原因，界面上没有出路（`src/lib/procurement-records/attachments.ts:172`、`:256`）；
    4. 采购记录附件 `FAILED`（如「存储读取失败，稍后重试」）不被定时任务再认领，标签却写「解析失败（稍后重试）」（`attachments.ts:184`、`:256`，`src/lib/procurement-records/labels.ts:203`）；
    5. 采购记录附件 CSV / 纯文本按 UTF-8 读，带字节序标记的 UTF-16 CSV（Excel「Unicode 文本」导出）被判「文件损坏」，等有真实样本再定是否改用 `decodeTextFile`（G3 已定 A；`attachments.ts:122–124`）；
    6. 询价回信写库失败时不回滚：条目已被改成「已回复」，走「已回复」的还已推「收到回复」Muse 事件；失败后也不重试，只通知人工录入（`src/lib/tender-rfq/inbound-sync.ts:258–272`、`:390`、`:412–414`）；
    7. 产品资料录入的解析报错（`parseResultJson.error`）与「分析输入」一步的 `parseNotes`（含文件名、网址、异常原文）写 jsonb 前没有清理与收口（`src/lib/product-content/intake/analyze.ts:217–221`、`:301`、`:343`）。
  - verify：报告存在，含「没有开关，合并即在生产生效」与「合并后要人做的事」两节；`grep -c "FIX-14 部署之后" docs/QINGYAN_CHAIN-0_ENV_CHECK.md` 为 2；`grep -n "^| CHAIN-0 " docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 那一行含「FIX-14 部署之后」；`grep -n "^| FIX-14 " docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有一行且行号大于 FIX-13 那一行；`grep -c "| 待定 |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 不少于（原有 + 7），原有为开工前提里记下的条数（main `13c7ed33` 上为 0，合入 `d94e4323` 后为 17）。

## Workflow follow-up

- 开 PR 前按 `openspec/config.yaml`「多维审查」并行派子 agent（正确性与回归、安全 / 隐私与硬纪律、规格—代码—测试一致性、使用流畅与文案，另加「测试质量与门禁」），逐条核实后修，重跑测试；PR 正文写「多维审查」一节，并写明「询价自动化开关须在本 PR 部署之后才开（核查表与 TASKFLOW 的前提已在本 PR 改好）」。
- G2 已定 A：不拆，五个入口一个 PR、一次多维审查、一次归档；PR 正文写明「没有开关，合并即在生产生效」。
- PR 合并后 `/opsx:archive extracted-text-nul-other-paths --yes`（独立小 PR，至少一个子 agent 核对主规格与 delta、TASKFLOW 状态）。
