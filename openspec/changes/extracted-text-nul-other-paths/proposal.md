# Proposal：其它文字抽取入口入库前清理 U+0000 / 落单代理字符（FIX-14）

TASKFLOW：FIX-14（Phase F（续）— 情报串联，FIX-13 之后）

## Why

FIX-13（#546）只修了项目文件的两条解析路径；询价回信、采购记录附件、AI 对话附件、产品资料录入、报价成本表导入这五个入口仍把抽出的文字原样送进证据核对与数据库，一个勾选框被抽成 U+0000、或按字数截断劈开一对代理字符，就会让写库失败（文本列 22021、jsonb 列 22P05、落单代理字符在 Prisma 客户端就被拒），或让跨过勾选框的报价证据核对不上而被作废。询价回信每 10 分钟无人值守地跑，打开询价自动化开关（`TENDER_RFQ_AUTO_DRAFT_ENABLED` 等三个）之后回信量变大，所以询价回信这一条必须在开关打开之前上线。

## What Changes

- 清理询价回信的附件文字与附件文件名：在判断「有没有可提取的文字」之前换掉 U+0000 与落单代理字符；只有 U+0000 的附件按「附件无可提取文本（可能是扫描件）」记录。
- 清理送进模型的询价回信文字：正文与附件拼好、截到 16000 字之后再清理一遍，模型看到的与证据核对用的是同一份。
- 清理写进询价条目报价备注（`InquiryItem.quoteNotes`）的整段新增内容，写库前做。
- 注明询价回信附件里被换掉的 U+0000：报价备注附件一栏在该附件的「已解析」后写「（有 N 处无法识别的符号，可能是勾选框或无法识别的字形，请对照原件核对）」，不进通知、Muse 与模型提示（design G5，Lucas 2026-11-22 已定 B）。
- 清理采购记录附件 PDF 每一页的文字，在判断该页是否需要 OCR 之前做。
- 清理采购记录附件 Excel 每个工作表转出的文字、单元标签与记进工作表范围的工作表名。
- 清理采购记录附件抽出的明细的每个文字字段，在按字数截断之后、写库之前做。
- 清理 AI 对话附件的文件名与正文：新客户端的附件列表在「有没有可分析的文本」与长度校验之前清理；旧客户端的单个文件文字在截断（文件名 200 字、正文 15 万字）之后清理；新方式下清理后只剩空白的附件返回 400「附件「〈文件名〉」没有可分析的文本内容」。
- 清理对话标题：主助手 / 项目「问青砚」（3 处）、外贸对话（1 处）与助手跟进任务（1 处）由消息文字或附件名生成、按 60 / 30 字截断的标题，在截断之后、写库之前清理（design G6，Lucas 2026-11-22 已定 A）。
- 清理转为后台市场调研时写进调研任务输入的「市场证据」，在截断之后、写库之前做。
- 清理产品资料任务每个输入（PDF、Excel、网页、文字、语音转写）的文字，在抽取产品事实之前做。
- 清理报价成本表导入的抽取结果：抽取结果出来之后、匹配可引用单元与 AI 归类之前清理一遍，写入导入记录之前再清理一遍（含供应商名）。
- 收口报价成本表导入的失败原因：改用 FIX-13 的失败原因收口（不超过 500 字、写入前清理）。
- 新增一个按结构遍历的纯函数：对 JSON 形状的值里每个字符串（含键）调用 FIX-13 的清理函数，不另立字符规则；放在 FIX-13 的 `src/lib/files/extracted-text.ts`。
- 新增回归测试：一个不用数据库的测试（真实 unpdf 读 FIX-13 夹具现拼的勾选框 PDF、测试里现拼的 xlsx 与字符串，外加接线断言，进 CI 子集）与一个隔离库测试（五个入口各走一遍真实写库），都注册进 `scripts/test-all.sh`。
- 改三处询价开关的前提：实现 PR 里把 `docs/QINGYAN_CHAIN-0_ENV_CHECK.md` 第 7 行「建议值」、该表「填写顺序」与 TASKFLOW 的 CHAIN-0 行改成「CHAIN-4b 合并且 FIX-14 部署之后」再开。

## Capabilities

### New Capabilities

- `platform/extracted-text-storage`：项目文件以外的入口（询价回信、采购记录附件、AI 对话附件与对话标题、产品资料录入、报价成本表导入）抽出或截断出的文字，在送进模型、核对证据、比对与写库之前怎样清掉不可入库的字符；不改变送往 Muse、通知、审计与模型的内容范围。

### Modified Capabilities

（无。`procurement/disclosure-analysis`「解析与阻塞」里「有效文字过少的页标 `OCR_REQUIRED`」不变，本次只是让只有 U+0000 的页落进这一条；项目文件见 FIX-13 的 `projects/document-text-extraction`，本次不改。）

## Impact

- 开工：原定 FIX-19 合并后再开工；FIX-19 未合并（等生产只读查询结果），按交接文档 §0.5k 第 9 条的例外先开工——两者没有共同文件，FIX-19 后合并时由它合入 main（tasks 开工前提、design「相邻改动」）。
- 依赖：FIX-13（#546）已于 2026-11-22 合并（main `13c7ed33`，FIX-13 最终提交 `f8cc2bdb`）；复用它的 `toStorableText` 与 `toStorableParseError`，以及测试夹具 `src/lib/tender-auto-analysis/__tests__/fixtures/nul-pdf.ts`。
- 代码：`src/lib/tender-rfq/inbound-parse.ts`、`src/lib/tender-rfq/inbound-apply.ts`；`src/lib/procurement-records/attachments.ts`；`src/lib/chat-attachments/core.ts`、`src/app/api/ai/threads/[threadId]/messages/route.ts`、`src/app/api/trade/chat/[sessionId]/messages/route.ts`、`src/lib/assistant/followup-task.ts`、`src/lib/market-intelligence/research-runtime.ts`；`src/lib/product-content/intake/analyze.ts`；`src/lib/quote-engine/import/import-service.ts`；`src/lib/files/extracted-text.ts`（加一个遍历函数）。
- 文档（实现 PR 里改）：`docs/QINGYAN_CHAIN-0_ENV_CHECK.md`（「填写顺序」与第 7 行建议值）；`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`（CHAIN-0 行的开关前提、新增 FIX-14 行）；新增 `docs/QINGYAN_FIX-14_REPORT.md`。
- 接口：`POST /api/ai/threads/[threadId]/messages`、`POST /api/trade/chat/[sessionId]/messages` 对「附件正文只有 U+0000」的请求由写库失败的 500 改为 400「附件「〈文件名〉」没有可分析的文本内容」；其余接口的请求与返回形状不变。
- 行为变化：以前因写库失败的询价回信、采购附件、对话消息、产品资料分析、成本表导入现在能成功；以前跨过 U+0000 的询价证据被作废，现在能通过核对；采购附件里去掉 U+0000 后有效文字不足 20 个的页改判「需要 OCR」（以前 U+0000 也算有效文字）；对话标题在截断处劈开表情符号时以 U+FFFD 结尾，不再让这一轮对话报错（外贸对话以前在消息与回复都已存下之后返回 500）。以前失败、现在入表的询价回信照常走既有的报价 / 回信通知、Muse 事件与定时检查（缺字段时起草追问卡，经审批或既有的跟进授权才发出）。
- Muse：不改 `src/lib/muse-bridge/**`。间接影响：修好后入表的回信照常推既有的 `quote.parsed` / `missing_fields`（按钮指向 `compare` / `next_step` / `rfq`）与 `reply.received`（按钮指向 `status`）事件；`compare` 意图回读的报价备注里多出以前被作废的价格与交期。
- 测试：新增 `src/lib/files/__tests__/extracted-text-other-paths.test.ts`（进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`）、`src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts`（只进 `scripts/test-all.sh`）；遍历函数的用例补进 FIX-13 已注册的 `src/lib/files/__tests__/extracted-text.test.ts`。
- 无 schema、无新开关、无新依赖、无新模型调用；**没有开关，合并即在生产生效**。不拆 change（G2 已定 A）：五个入口一个 PR，三个询价开关要等整个 FIX-14 合并部署之后才开。

## Out of scope

- 项目文件的两条解析路径（FIX-13 已修）；FIX-13 的清理规则（U+0000 → 空格、落单代理字符 → U+FFFD）不改。
- 供应商画册解析（`src/lib/supplier/brochure-parser.ts`）：抽出的文字只进模型提示，接口不写库；模型填出的表单由人保存，属于人输入。
- 外贸客户线索导入（`api/trade/prospects/import`）、展会名片导入（`src/lib/trade/booth-cards.ts`）、客户 CSV 导入（`api/sales/import-csv`）、三个知识库导入接口（`api/org/knowledge/import`、`api/trade/knowledge/import`、`api/projects/[id]/knowledge-bases/[kbId]/import`）：都是同步请求、导入人自己上传的表格或 Markdown，失败在同一个请求里报错，不停在中间状态、不在后台重试、不在询价自动化路径上（G4 已定 A：不另开任务，只写进报告「没做的」）。
- 用户自己在页面上输入后直接保存的文字：对话消息正文、产品资料文字输入的保存、成本表导入复核时的人工修改、采购明细复核时的人工修改，保存时都不清理（浏览器里打的字本身不含这两类字符；产品资料的文字输入在抽取事实时照样经过清理；由打的字截断生成的对话标题按 What 里「清理对话标题」一条处理）。
- 上面 5 处对话标题以外、把用户打的字按字数截断后写库的地方：本次没有逐处排查，写进报告「没做的」，另开任务（tasks 7.1 登记进 TASKFLOW）。
- AI 对话附件的图片路径（`blobPath`）与 MIME：不是抽取出的文字，不清理；正常上传拿到的路径由服务端生成（`chat-attachments/upload-image.ts:56`），手工构造带 U+0000 的路径仍会写库失败返回 500，另开任务（tasks 7.1 登记）。
- 采购记录附件 CSV / 纯文本的读法：仍按 UTF-8 读，含 U+0000 仍记「文件损坏」（G3 已定 A）；带字节序标记的 UTF-16 CSV 因此被判损坏，另开任务、等有真实样本再定（tasks 7.1 登记）。
- 采购记录附件的认领、重试与失败状态：重试 5 次后停在「解析中」、`FAILED` 不被定时任务重试，都是既有行为，不改，两条各另开任务（tasks 7.1 登记）；已经停住或已解析却没有明细的附件按 G1（已定 A）上线后人工处理，不写补救代码（design「Migration Plan」第 1 步）。
- 询价回信解析失败时的处理（记失败审计、通知「请手工录入」、不重试）与失败之前已把条目改成「已回复」、已推「收到回复」事件的既有顺序（写库失败时不回滚、失败后不重试，另开任务，tasks 7.1 登记）；已经记为失败、或证据已被作废的历史回信不重新处理（上线后列给人核，见 design「Migration Plan」）。
- 只进模型提示、不写库的其它截断（报价成本表 AI 归类送模型的 200 字、AI 对话按预算展开附件）。
- 产品资料录入与 AI 上传接口的解析报错文字（`parseResultJson.error`、分析步骤的 `parseNotes`）：产品资料这两处写 jsonb 前没有清理与收口，另开任务（tasks 7.1 登记）；AI 上传接口的报错只返回浏览器，不写库。
- 不做 OCR、不升级 unpdf / xlsx / mammoth、不换解析库。
