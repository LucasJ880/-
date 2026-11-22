# Tasks：其它文字抽取入口入库前清理 U+0000 / 落单代理字符（FIX-14）

前提：main 已含 FIX-13（#546）——`src/lib/files/extracted-text.ts` 与夹具 `src/lib/tender-auto-analysis/__tests__/fixtures/nul-pdf.ts` 存在。开工前按 `openspec/config.yaml` 先跑一遍将要触碰模块的已注册测试，记下通过数。

## 1. 询价回信（排第一：询价自动化三个开关打开之前必须已上线，见 design「上线顺序」）

- [ ] 1.1 测试先行：新建 `src/lib/files/__tests__/extracted-text-other-paths.test.ts`（不用数据库）与 `src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts`（隔离库），同一步注册进 `scripts/test-all.sh`（前者同时进 `scripts/test-ci-unit.sh`）；先写询价回信的用例——用 FIX-13 夹具的 `buildPdf` 现拼同一行「Unit price CAD 12.50 per flag」+ U+0000 +「Delivery 30 days」的 PDF，两个假模型（勾选框处写空格 / 原样照抄收到的那一行）、16000 字处劈开表情符号、附件只有 U+0000、附件文件名带 U+0000、证据以半个表情符号结尾、附件一栏「有 N 处无法识别的符号…」一句；隔离库用 `defaultInboundSyncDeps()` 换掉 Gmail 与模型、保留真实写库，一家「已发出」的条目，断言入表、新增通知与审计里没有附件文字、同一封信再跑一次不重复处理——并在改动前的代码上看到失败；再改 `src/lib/tender-rfq/inbound-parse.ts`（附件文字与文件名在判断有没有文字之前清理并计数、拼好截到 16000 字之后再清理）与 `src/lib/tender-rfq/inbound-apply.ts`（这次追加的备注清理、附件一栏的那一句）；verify：`env -u DATABASE_URL -u DIRECT_URL npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts` 与 `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts` 全过，改动前的失败输出（写空格时 `prices[0]` 为 `EVIDENCE_NOT_IN_TEXT`；照抄时 `rfq_inbound:failed` 的 `error` 含 `22021`、条目停在 `replied`）留给报告；`npx tsx src/lib/tender-rfq/__tests__/inbound-parse.test.ts`、`npx tsx src/lib/tender-rfq/__tests__/inbound-apply.test.ts` 照旧通过；`bash scripts/check-test-registry.sh` 输出 OK

## 2. 采购记录附件

- [ ] 2.1 在 `src/lib/files/extracted-text.ts` 加按结构遍历的清理函数（每个字符串含键名调 `toStorableText`），用例补进 `src/lib/files/__tests__/extracted-text.test.ts`；`src/lib/procurement-records/attachments.ts` 里 PDF 每页文字在判断要不要 OCR 之前清理，工作表文字、单元标签、`sheetRangesJson` 的工作表名写之前清理，明细在写库前整条过遍历函数；CSV / TXT 不改；两个测试文件补用例（勾选框 PDF、30 个 U+0000 的页 → 需要 OCR、xlsx 单元格 `_x0000_`、CSV 含 U+0000 仍「文件损坏」、xlsx 一行明细在第 1000 字处劈开表情符号；隔离库经 `processAttachment(id, { readBuffer })`，先在改动前看到附件停在 `PARSING` / 明细为零）；verify：两个新测试与 `npx tsx src/lib/files/__tests__/extracted-text.test.ts` 全过，`npx tsx src/lib/procurement-records/__tests__/disclosure-analysis-pure.test.ts` 与 `NODE_ENV=test npx tsx src/lib/procurement-records/__tests__/procurement-records-db.isolated.test.ts` 照旧通过

## 3. AI 对话附件与市场调研

- [ ] 3.1 `src/lib/chat-attachments/core.ts` 的新旧两种入口先清理文件名与正文、再做「有没有可分析的文本」与长度校验；`src/lib/market-intelligence/research-runtime.ts` 的市场证据在截到 2 万字之后再清理；两个测试文件补用例（正文带 U+0000、正文只有 U+0000 → 「附件「a.pdf」没有可分析的文本内容」、旧方式 15 万字处劈开表情符号、三个对话路由只用校验后的附件写库的接线断言；隔离库写 `AiMessage` / `TradeChatMessage`，并用在截断处劈开表情符号的市场证据跑 `queueMarketResearchRequest`，先在改动前看到 22P05 / `InvalidArg`）；verify：两个新测试全过，`npx tsx src/lib/trade/__tests__/chat-attachments.test.ts` 照旧通过

## 4. 产品资料录入

- [ ] 4.1 `src/lib/product-content/intake/analyze.ts` 的事实抽取入口先清理传入的文字（文件（PDF、Excel）、网页、文字、语音转写四种来源都经过它）；两个测试文件补用例（隔离库用本地文件存储跑 `analyzeJobInputs`：规格 PDF 一行「\u0000 Color: Red」→ 事实 color = Red、原文行「Color: Red」、「分析输入」一步完成，先在改动前看到这一步停在 running；不用库的接线断言：四种来源都经同一处清理）；verify：两个新测试全过，`npx tsx src/lib/product-content/__tests__/priority-conflict.test.ts` 照旧通过

## 5. 报价成本表导入

- [ ] 5.1 `src/lib/quote-engine/import/import-service.ts` 抽取结果出来之后过一次遍历函数（在匹配可引用单元与 AI 归类之前）、写导入记录之前整份与供应商名再过一次，`catch` 里的失败原因改用 `toStorableParseError`；两个测试文件补用例（xlsx 说明格「Flag\u0000 nylon 3x5」、超过 300 字的说明在第 300 字处劈开表情符号、工作表名带 U+0000 时仍带上可引用单元、失败原因收口的接线断言；隔离库跑 `createImportFromUpload`，先在改动前看到状态 `FAILED`、`errorMessage` 含 `22P05`）；verify：两个新测试全过，`npx tsx src/lib/quote-engine/__tests__/quote-import.test.ts` 照旧通过

## 6. 验收

- [ ] 6.1 全部门禁；verify：`npm test` 与既有失败清单（`docs/QINGYAN_CHAIN-3_REPORT.md` §4）对照无新增失败；CI 环境变量下 `bash scripts/test-ci-unit.sh` 末行 `CI unit subset PASS`；`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出码 0；`npm run lint:baseline` PASS；`bash scripts/test-runtime-architecture.sh` PASS；`openspec validate extracted-text-nul-other-paths --strict` valid；`git diff origin/main -- prisma/ vercel.json package.json package-lock.json` 为空

## 7. 报告与 TASKFLOW

- [ ] 7.1 写 `docs/QINGYAN_FIX-14_REPORT.md`（五个入口各自的写库点与改动前 / 改动后、改动前失败的测试输出、上线顺序、上线后操作（design「Migration Plan」四步）、多维审查结论、没做的（四处导入接口等））+ 更新 TASKFLOW 状态列（`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`「Phase F（续）— 情报串联」表 FIX-13 之后新增 FIX-14 一行，`[~]`）；verify：报告存在，`grep -n "FIX-14" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有一行且在 FIX-13 那一行之后

## Workflow follow-up

- 开 PR 前按 `openspec/config.yaml`「多维审查」并行派子 agent（正确性与回归、安全 / 隐私与硬纪律、规格—代码—测试一致性、使用流畅与文案，另加「测试质量与门禁」），逐条核实后修，重跑测试；PR 正文写「多维审查」一节，并写明「询价自动化开关须在本 PR 部署之后才开」。
- 若 GATE 对 G2 选 B：1.1 单独成 PR（FIX-14a）先合，2.1–5.1 为 FIX-14b。
- PR 合并后 `/opsx:archive extracted-text-nul-other-paths --yes`（独立小 PR，至少一个子 agent 核对主规格与 delta、TASKFLOW 状态）。
