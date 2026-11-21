# FIX-13 报告：解析出的文字带 U+0000 也能入库，解析失败显示原因

| 项 | 值 |
|---|---|
| change | `document-parse-nul-and-reason`（新能力 `projects/document-text-extraction` 3 条要求、`tender/analysis-package-coverage` 3 条要求） |
| TASKFLOW | FIX-13（Phase F（续）— 生产实测修复，2026-11-20） |
| 来源 | Lucas 2026-11-20 生产实测「12-3 Indoor Canadian Flag」：上传 6 个文件、纳入分析 4 个，`2026004-Appendix-B-RFP-e(PDF).pdf` / `-f(PDF).pdf` 被标成「文件解析失败」，界面不显示原因 |
| 拍板 | 修法（写库前清掉 U+0000 与落单代理字符、不解密）Lucas 已定；界面显示 `parseError` 原文是 Evan 的要求；四件套经产品侧审过（任务书 `QINGYAN_FIX-12-13_LANDING_TASKBRIEF` T2）；Evan 2026-11-21 授权本会话全权负责（含合并） |
| 分支 | `claude/amazing-planck-0s5wnb-parse-error`（基于 main `91d928e4`） |
| 性质 | 修既有的两条文件解析路径 + 三处界面文字。零 schema、零新模型调用、没有出站。**没有开关——合并即生效** |

## 0. 一句话

以前：PDF 里有一种勾选框（或类似符号），解析时会变成一个数据库存不了的隐形字符，整份文件就存不进去，被标成「文件解析失败」，而且哪里都看不到原因。现在：这个字符存库前换成空格，文件能正常解析；以后再有文件解析失败，分析面板和项目文件列表都会直接写出系统记下的原因。

已经失败的两份附录 B 不会自己恢复，上线后要按 §5 操作一次。

术语：U+0000 = 一个不可见的「空字符」；「落单代理字符」= 表情符号这类由两个编码单元组成的字符被从中间截断后剩下的半个；「页级解析」= 招标分析用的逐页文字（`parseDocumentPagesAndStore`）；「整份文字解析」= 项目文件列表用的那条旧路径（`parseAndStoreContent`）。

## 1. 原因与复现

- Lucas 本地用 unpdf 1.4.0 读英文版附录 B：第 2 页利益冲突一节的勾选框（SymbolMT 字体，Identity-H 编码，没有 ToUnicode 表）被抽成 U+0000（`"...check the box.\n\u0000 The Bidder declare..."`）；去掉权限加密后的版本同样如此——**与加密无关**。
- PostgreSQL 的文本列不收 U+0000（错误码 22021）；截断把一对代理字符劈开时，Prisma 报 `unexpected end of hex escape`。两条解析路径都是把文字原样写库，于是整份文件写库失败、被标成 `failed`。
- 本会话在隔离库上用现拼的 PDF 复现了这一机理（不入库任何客户文件）：见 §3「改动前」。
- **没核对的**：生产上这两份文件 `parseError` 的原文；法文版 `-f(PDF).pdf` 没有单独实测，按同一来源推断相同（§5 第 4 步核对）。

## 2. 做了什么

1. **清理函数**（新文件 `src/lib/files/extracted-text.ts`）：U+0000 → 空格（不删，免得左右两个词粘在一起）；落单代理字符 → U+FFFD；其它字符（中文、表情符号、制表、换行）原样不动。
2. **页级解析**（`page-parse.ts`）：PDF 每页先清理再判断「近乎空白 / 需要 OCR」（整页都是 U+0000 的页面清理后是空白，落到「需要 OCR」）；Word / Excel / CSV / 纯文本在切单元之前清理原文、切完再清理一遍（按 6000 字切块会劈开代理对）；整份文字截断之后再清理。
3. **整份文字解析**（`parse-content.ts`）：先清理、再去首尾空白、截断后再清理一遍。
4. **覆盖清单带出原因**（`package-coverage.ts`）：被排除文件多一个 `parseError` 字段，只有因解析失败被排除的文件有值。分析详情、投标简报、工作台汇总三个接口的返回里都多了这个字段。
5. **原因不进模型**（`package-coverage.ts` 的 `toAnalystCoverage`，`v2-persist.ts` 调用）：存进综合解读的覆盖快照显式只取原来的六项——综合解读会经投标草稿进模型提示，失败原文（可能含数据库报错与服务端路径）不能跟着进去。
6. **界面三处**：
   - 分析面板「上传 N · 纳入分析 M · 排除 K」下面：`〈文件名〉 · 未纳入：文件解析失败（原因：〈原文〉）`；没有记录时写「（原因：系统未记录原因）」。
   - 分析结果里「排除 K（原因）」展开列表：同样的写法，原文取文件当前的记录；文件之后已经重新解析成功的，只显示「文件解析失败」。
   - 项目文件列表：失败的文件在行下方用红字显示「原因：〈全文〉」，不截断、不用悬停（原来只截前 60 个字，Prisma 报错时只剩「Invalid `prisma…` invocation:」）。

与四件套的出入（都在规格之内，实施时定的）：

- 旧路径 `parseAndStoreContent` 原先在重新解析开始时不清上一次的 `parseError`，文件类型不支持时也不清；规格要求「下一次解析开始时清掉」，本次补上（两处各加一个字段）。
- 文案放进一个不依赖数据库的小文件 `src/lib/tender-auto-analysis/exclusion-text.ts`，界面与测试共用，面板上的两种写法因此有了单元测试。
- 规格增量补了两个场景：「以前失败的文件重新解析成功」「分析完成之后文件重新解析成功」。
- 四件套里把按钮写成「重试」，实际界面上叫「重新处理」，已改正（proposal、design）。
- design「Risks」里「明确要求显示原文」的人由 Lucas 改为 Evan（Evan 2026-11-21 确认）；「本地用 unpdf 复现」仍是 Lucas（同日确认）。

## 3. 测试：改动前 / 改动后

`src/lib/tender-auto-analysis/__tests__/page-parse-nul-db.isolated.test.ts`：测试里现拼一份两页的 PDF（第 1 页整页 U+0000，第 2 页「…check the box.\n\u0000 The Bidder declares…」，与附录 B 第 2 页同形）和一份带 U+0000、会被截断劈开代理对的纯文本；文件放本地文件存储；真实的 `parseDocumentPagesAndStore` 与 `parseAndStoreContent` 写入本机 PostgreSQL。

**改动前**（main `91d928e4` 的代码 + 这份测试，task 1.1）——18 项里 16 项失败，两条路径都是 `failed`：

```
  ✓ 前提：unpdf 把第 2 页的勾选框抽成 U+0000，夹在「check the box.」与「The Bidder declares」之间
  ✓ 前提：第 1 页抽出的文字只由 U+0000 组成
  ✗ 页级解析：带 U+0000 的 PDF 解析状态为 done，没有失败原因 {"res":{"ok":false,…,"parseStatus":"failed","error":" Invalid `tx.projectDocumentPage.createMany()` invocation in …/page-parse.ts:257:40 … ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: \"22021\", message: \"in"}
  ✗ 页级解析：两页都入库 {"pages":0,"pageCount":null}
  ✗ 整份文字解析：带 U+0000 的 PDF 解析状态为 done，没有失败原因 {"parseStatus":"failed","parseError":"\nInvalid `db.projectDocument.update()` invocation in\n…/parse-content.ts:123:30\n … PostgresError { code: \"22021\", message: \"invalid byte sequence for encoding \\\"UTF8\\\": 0x00\", …"}
  ✗ 页级解析：带 U+0000 与被劈开的代理对的纯文本解析状态为 done {"res":{"ok":false,…"error":" Invalid `tx.projectDocumentPage.createMany()` invocation in …/page-parse.ts:322:38 … unexpected end of hex escape at line 1 column 12383"}
  ✗ 以前解析失败的文件重新解析（两条路径）：都变为 done，上一次的失败原因清空 …
  （其余 11 项 ✗ 是同一失败的后续断言）
FIX-13 page-parse NUL DB: 2 passed, 16 failed
```

（`…` 处省略了文件 id 与路径前缀；页级路径的报错在 500 字上限处被截断，所以只看得到 `code: "22021"`。）

**改动后**——18 / 18，连跑两次结果相同：

```
  ✓ 页级解析：带 U+0000 的 PDF 解析状态为 done，没有失败原因
  ✓ 页级解析：两页都入库
  ✓ 页级解析：第 2 页的 U+0000 入库为一个空格（与后面原有的空格连成两个），其余文字逐字不变
  ✓ 页级解析：整页都是 U+0000 的第 1 页按近乎空白处理（需要 OCR），文件不因此失败
  ✓ 页级解析：库里逐页文字与整份文字都不含 U+0000
  ✓ 页级解析：整份文字 = 有字的那一页
  ✓ 整份文字解析：带 U+0000 的 PDF 解析状态为 done，没有失败原因
  ✓ 整份文字解析：入库的文字不含 U+0000，两句正文逐字都在；整页 U+0000 的那一页不留下一串空格
  ✓ 页级解析：带 U+0000 与被劈开的代理对的纯文本解析状态为 done
  ✓ 页级解析：每个文本块单元都不含 U+0000 与落单代理字符
  ✓ 页级解析：被劈开的代理字符入库为 U+FFFD，U+0000 入库为空格
  ✓ 页级解析：整份文字截断到上限之内，不含 U+0000 与落单代理字符
  ✓ 整份文字解析：同一份纯文本解析状态为 done
  ✓ 整份文字解析：截断正好劈开一对代理字符 → 末尾入库为 U+FFFD，全文不含 U+0000 与落单代理字符
  ✓ 以前解析失败的文件重新解析（两条路径）：都变为 done，上一次的失败原因清空
  ✓ 页级解析：同一份文件再解析一次，仍是 2 页、文字相同
FIX-13 page-parse NUL DB: 18 passed, 0 failed
```

| 测试 | 开工前 | 结束 |
|---|---|---|
| `page-parse-nul-db.isolated.test.ts`（新，隔离库） | — | __ISO__ |
| `files/__tests__/extracted-text.test.ts`（新，纯函数） | — | __PURE__ |
| `package-coverage.test.ts` | 14 | __COV__ |
| `page-parse.test.ts` / `document-units.test.ts` / `blob-access.test.ts` / `analyst-synthesis.test.ts` | 14 / 39 / 13 / 30 | 不变 |

## 4. 门禁

__GATES__

## 5. 上线后操作（已在真实应用里走过一遍）

合并部署后，已经失败的两份附录 B 要重新处理一次。**两个「重新分析」按钮都会跳过状态还是「解析失败」的文件**（`src/lib/tender-auto-analysis/package.ts:164`），所以必须先做第 1 步，再重新分析。

| 步 | 点哪里 | 系统做什么 | 应该看到什么 |
|---|---|---|---|
| 1 | 打开「12-3 Indoor Canadian Flag」项目页，点页面上方的「项目文件 · 6」打开文件抽屉 | 抽屉一打开就自动重新处理失败的文件（不用点任何按钮；红色提示条上的「重新处理」是同一个动作）。走的是**整份文字解析**这条路 | 两份附录 B 先短暂显示「解析失败」和下面的红字原因，然后进度条走「文件解析 → AI 摘要 → 情报分析」，结束后两行都不再有「解析失败」（显示「AI 可读」或「AI 摘要」） |
| 2 | 关掉抽屉，进「招标要求」页签 | — | 分析面板顶部的覆盖清单从「上传 6 · 纳入分析 4 · 排除 2」变成「上传 6 · 纳入分析 4」。**这时两份附录 B 还没被分析**，只是不再算排除；面板上暂时没有文字提示这一点（§7 第 3 条） |
| 3 | 点「AI 数字员工 · 投标分析」卡片右侧的「重新分析」 | 一键分析重新跑。这一次会对两份附录 B 做**页级解析**（招标分析读的是逐页文字，第 1 步不产生逐页文字），然后纳入分析 | 分析完成后覆盖清单为「上传 6 · 纳入分析 6」 |
| 4 | 回到文件抽屉看一眼法文版 `-f(PDF).pdf` | — | 法文版没有单独实测过。若它仍是「解析失败」，行下方现在会直接写出原因，把那段文字发给开发即可 |

补充：

- 第 3 步也可以用分析面板里的「重新分析当前投标文件包」（走旧的自动分析管线，5 分钟内最多 3 次），同样会先做页级解析。
- 本会话实际验证到哪一步：第 1、2 步在本机真实应用上走过（文件由「解析失败」变为「AI 可读」；数据库里两份文件 `parseStatus = done`、文字不含 U+0000）；第 3 步的页级解析用同一个函数单独跑过（两份文件各 2 页入库，一页正文、一页「需要 OCR」）；**完整的重新分析没有跑**（本机没有模型密钥）。
- 第 1 步结束时是否自动发起分析：取决于 `TENDER_AUTO_PACKAGE_ANALYSIS_ENABLED`（默认关）。即使打开，以前自动分析过的项目也不会因此重新分析——所以第 3 步要手动点。生产上这个开关的状态未核对。
- 如果生产上 FIX-12（#540）还没合并，第 3 步仍可能遇到 300 秒超时；两个修复互不依赖，但重测最好等两个都上线。

截图（隔离库上的演示数据，`docs/acceptance/fix-13/`）：

| 文件 | 内容 |
|---|---|
| `01-analysis-panel-coverage.png` | 分析面板覆盖清单：两份附录 B「未纳入：文件解析失败（原因：…）」，一份有原文、一份「系统未记录原因」 |
| `02-analyst-excluded-list.png` | 分析结果里「排除 2（原因）」展开后的同样写法 |
| `03-file-list-parse-error.png` | 项目文件列表：失败文件行下方的原因全文；红色提示条与「重新处理」按钮 |
| `04-file-list-after-retry.png` | 自动重新处理之后：两份附录 B 显示「AI 可读」（图里红色提示条还在，是本机没有模型密钥、AI 摘要失败造成的） |
| `05-analysis-panel-after-reparse.png` | 重新解析之后、重新分析之前的覆盖清单：「上传 6 · 纳入分析 4」 |

## 6. 多维审查

__REVIEW__

## 7. 没做的

### 7.1 其它四条文字抽取路径（只读核对，任务书 T3；都不在本 PR 里改）

逐个读代码查了「抽出的文字最终写进哪张表哪一列、中间有没有清理」：

| 路径 | 结论 | 依据 |
|---|---|---|
| `src/lib/procurement-records/attachments.ts`（采购记录附件） | **会失败** | PDF 逐页文字原样写进 `RecordsAttachmentUnit.text`（`@db.Text`）：`attachments.ts:111–113` 取字 → `:189–192` `createMany`，中间没有清理；`:124` 的 U+0000 检查只管 CSV / TXT。写库抛错时附件停在 `PARSING`，cron 每 10 分钟重新认领再失败（`:170–172`、`:253–271`）。整个模块在开关 `PROCUREMENT_RECORDS_SCHEMA_READY` 之后，生产是否打开未核对 |
| `src/lib/files/parse-buffer.ts` → `api/ai/upload-file`（AI 对话的文档附件） | **会失败**（读代码结论，没在应用里实测） | 接口本身不写库，把文字返回给浏览器（`upload-file/route.ts:53–59`）；浏览器发消息时把文字放进 `attachments` 提交，服务端 `parseAttachmentsInput`（`src/lib/chat-attachments/core.ts:94–139`）不清理，存进消息表的 `attachments`（JSON 列）。PostgreSQL 的 jsonb 同样不收 U+0000（本机实测 `select '{"a":"x\u0000y"}'::jsonb` 报 `\u0000 cannot be converted to text`）。后果：带这种附件的那条消息发不出去 |
| `src/lib/files/parse-buffer.ts` → `src/lib/product-content/intake/analyze.ts`（产品资料录入） | **有条件会失败** | 文字按行找「字段: 值」，命中的行把值与整行写进 `ProductFact.value`（JSON 列）与 `sourceLocation`（`analyze.ts:226` → `jobs/service.ts:581–594`）。只有命中字段名的那一行里带 U+0000 才失败；没命中的行不写库 |
| `src/lib/tender-rfq/inbound-parse.ts`（供应商询价回复的附件） | **有条件会失败** | 附件文字本身不写库，只进模型提示和证据核对（`inbound-parse.ts:128–181`、`:424–458`）。写库的是模型返回并核对过的证据片段：拼进 `InquiryItem.quoteNotes`（`inbound-apply.ts:156–167`、`:209` → `inbound-sync.ts:379`）；审计里的证据经 `JSON.stringify` 转义，不受影响（`audit/logger.ts:93`）。只有模型把 U+0000 原样抄进证据片段、且片段通过核对时，写 `quoteNotes` 才会报 22021；后果是这封回信记为失败、发通知、转人工录入（不循环重试）。模型会不会原样返回 U+0000 没有实测 |
| `src/lib/supplier/brochure-parser.ts`（供应商画册） | **不写库** | 文字只进模型提示（`brochure-parser.ts:175–205`）；接口返回的是模型产出的字段，`api/suppliers/parse-brochure/route.ts` 不写库 |

处理：另开一个小 change（TASKFLOW FIX-14）复用 `toStorableText`，覆盖上面四条会失败 / 有条件会失败的路径；其中询价回复附件那一条要在打开询价开关之前修掉，排在「切片之外仍可能超过 300 秒」之前。

### 7.2 本次走查发现、不在本 PR 范围的

1. **文件抽屉的自动重新处理会循环**（既有行为）：一轮处理结束后页面整体刷新，抽屉重新挂载，只要还有文件处于解析失败或 AI 摘要失败，就再发起一轮（本机 80 秒内 3 轮，每轮都重新调 AI 摘要与情报分析）。FIX-13 之前的两份附录 B 正属于「一直失败」的情况：抽屉开着时会反复重试并反复调用模型。本机是因为没有模型密钥触发的；生产上的表现未核对。→ 另开任务。
2. **`parseError` 里有服务端路径与代码片段**（旧路径把 Prisma 报错连同堆栈第一行写进去）：按 Evan 的要求原样显示给有项目读权限的人，不进模型与对外通道。是否把写入的内容收短，另议。
3. **重新解析之后、重新分析之前，面板不提示「有 2 个文件等待重新分析」**：接口其实返回了这句说明（`coverage.note`），面板没有显示；同一时刻分析结果里的快照仍写「排除 2」。→ 并入「降级结果用白话说清楚」（任务书 T6）。
4. **「重新分析」按钮在卡片上看起来像普通文字**（没有底色与边框，本机开发构建上观察到）：既有样式，未改。
5. 不做 OCR、不升级 unpdf、不换解析库、不改 `parseError` 的写法与 500 字上限（proposal「Out of scope」）。
