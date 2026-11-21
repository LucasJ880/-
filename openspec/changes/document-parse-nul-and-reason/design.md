# Design：解析出的文字带 U+0000 也能入库，解析失败显示原因

## Context

动机见 proposal.md「Why」。两条解析路径都把文字原样写库：

- 页级解析 `parseDocumentPagesAndStore`（`src/lib/tender-auto-analysis/page-parse.ts`）：`extractPdfPagesFromBuffer` 用 unpdf 逐页取字 → `classifyPageText` 判近乎空白 → 事务里 `projectDocumentPage.createMany` 写逐页文字、`projectDocument.update` 写整份文字；非 PDF 经 `extractNonPdfUnits` 切表格 / 文本块单元同样写库。招标分析只读这条路径的逐页文字。
- 旧的整份文字解析 `parseAndStoreContent`（`src/lib/files/parse-content.ts`）：项目文件抽屉的自动处理（接口 `process-next`）用它，写 `ProjectDocument.contentText`。

PostgreSQL 的 `text` 不收 U+0000（报 22021 `invalid byte sequence for encoding "UTF8": 0x00`）；Prisma 序列化落单的 UTF-16 代理字符时报 `unexpected end of hex escape`。两种都在写库时抛出，被各自的 catch 收成 `parseStatus = failed`、`parseError = <报错>`（已在本机隔离库上复现，两条路径相同）。Lucas 本地读 Appendix B 不会失败，是因为只读了文字、没写库。

`parseError` 今天只有两处出现：项目文件列表那一行截前 60 字（Prisma 报错只剩「Invalid `prisma…` invocation:」），以及「处理下一个」的进度文字。招标分析的覆盖清单（`package-coverage.ts`）只给排除原因的标签「文件解析失败」。

覆盖清单有两份：分析详情接口现算的（`getPackageCoverage`，面板顶部那一段用），以及分析完成时存进综合解读的快照（`loadCoverageForRun` → `analystSynthesis.coverage`，「排除 K（原因）」展开用）。综合解读整块会被投标草稿的取数（`tender-bid-draft/gather.ts` 的 `analystBrief`）带进模型提示。

## Goals / Non-Goals

**Goals:**
- 不论 unpdf / mammoth / xlsx 抽出什么，写库都不因字符本身失败。
- 解析失败时人能在分析面板与文件列表上直接看到原因原文。

**Non-Goals（不动的模块 / 文件）:**
- `node_modules/unpdf` 与 `package.json` 依赖：不升级、不换库、不加解密库。
- `classifyPageText` 的阈值 `NEAR_EMPTY_PAGE_CHARS`、`MAX_PDF_PAGES`、`PACKAGE_ANALYSIS_MAX_PDF_PAGES`、`MAX_TEXT_LENGTH` / `MAX_CONTENT_TEXT_CHARS`：不改。
- `parseError` 记的内容（报错原文）：不改。本次只做三件收口的事——旧路径解析器返回的报错补上 500 字上限、所有写入点写入前清掉不可入库的字符、旧路径在重新解析开始时与「不提取文字的类型」分支清掉上一次的原因（见 D7）。
- `src/lib/tender-understanding/**`（证据核验、归一化）：不改；它对空白做折叠，换成空格不影响引文比对。
- `src/app/api/projects/[id]/files/process-next/route.ts` 与文件管理器的自动重试逻辑：不改。
- `src/lib/tender-analyst/contract.ts` 的 `AnalystCoverage` 字段：不加字段（快照不带原文）。

## Decisions

### D1 U+0000 换成空格，落单代理字符换成 U+FFFD

- U+0000 → 空格：Appendix B 里它是勾选框字形（SymbolMT，Identity-H，没有 ToUnicode），位置在两段文字之间；换成空格不会把左右两个词粘在一起。证据核验与去重都先折叠空白（`normalizeWhitespace`），多出的空格不影响引文比对。
  - 否决：直接删掉。整页都是 U+0000 的字体（每个字都映射成 0）删完会把相邻词粘连，换空格后整页变空白，正好落到「需要 OCR」。
  - 否决：换成「☐」之类的可见符号。是在猜原字形，可能错（同一字体里还有别的字形也会抽成 0）。
- 落单代理字符 → U+FFFD：Unicode 对不成对代理字符的标准替换，与 `String.prototype.toWellFormed` 结果相同；成对的代理字符（表情符号、扩展区汉字）不动。
  - 否决：用 `toWellFormed()`。TypeScript 目标 ES2017 / lib 的类型支持不稳定，正则实现更直接、可测。

### D2 一个纯函数，放在写库边界

新文件 `src/lib/files/extracted-text.ts` 导出 `toStorableText(text)`（与一个只读判断 `hasUnstorableChars`），两条路径在**写库之前**调用：PDF 逐页文字在 `classifyPageText` 之前；整份文字在截断（`slice`）之后再清理一遍——截断可能把一对代理字符劈开，产生新的落单字符。

- 否决：在 Prisma 中间件 / 扩展里统一处理所有字符串字段。影响全库所有写入，范围远超本次。
- 否决：只在 page-parse 里改。旧路径写的是同一张表的 `contentText`，同样会失败（文件列表会一直显示失败）。

### D3 覆盖清单的原文用独立字段，不并进排除原因的文字

`ExcludedFileDetail` 多一个 `parseError: string | null`（只有解析失败的文件有值）；`exclusionReason` 的标签不变。存进综合解读的快照由 `package-coverage.ts` 里的一个纯函数**显式只取原来的六项**（`loadCoverageForRun` 调它；三处写快照的地方都经过 `loadCoverageForRun`）。原文只随真正显示它的分析详情接口返回：投标简报与工作台汇总两个接口的界面只用计数与说明，它们拿到的覆盖清单先去掉原文。

- 否决：三个接口都带原文。后两个接口没有任何界面读这个字段，多带一处就多一处泄露面（原文里有服务端路径与报错）。

- 否决：把原文拼进 `exclusionReason`（「文件解析失败：…」）。改动最小，但快照会把原文带进综合解读，再经投标草稿取数进模型提示；原文里可能有数据库报错与服务端路径。

### D4 「排除 K（原因）」展开列表用现算的原文

分析面板把现算覆盖清单里「文件名 → parseError」的对照交给综合解读视图；视图按文件名取原文显示。快照里有而现算里已经没有的文件（之后重新处理成功了，或被删了）显示「文件解析失败（上次分析时的记录，文件状态之后已变，重新分析后更新）」——不说「已重新解析成功」，因为对照里没有也可能是文件被删。快照里没有文件 id，只能按文件名对：两个同名的失败文件共用后一个的原文。

- 否决：快照里存原文（见 D3）。
- 否决：综合解读视图自己再调一次接口。面板已经拿到同一份数据。

### D5 文件列表显示全文，在文件行下方

解析失败的文件在行下方加一行红色小字「原因：〈parseError〉」，自动换行、保留原文里的换行；没有记录原因时写「原因：系统未记录原因」（与分析面板一致）；行内仍是「解析失败」。文案放在不依赖数据库的 `exclusion-text.ts` 里，界面与测试共用。分析面板的清单下面另加一句固定的「下一步怎么办」（去「项目文件」重新处理，再重新分析；仍失败把原因发给管理员）。

- 否决：保留截前 60 字 + 悬停看全文。Prisma 报错前 60 字没有信息量；手机上没有悬停。

### D6 回归测试用测试里现做的 PDF，不入库真实文件

隔离库测试在测试里拼一份最小 PDF：一页正文里有一个 Type0 / Identity-H、没有 ToUnicode 的字体字符（unpdf 抽成 U+0000，与 Appendix B 同一机理），前后是「check the box.」「The Bidder declare」；另一页整页只有这种字符。经本地文件存储走真实的两条解析路径写入本机 PostgreSQL。

- 否决：把 Appendix B 放进仓库做夹具。是客户的招标文件，带采购方身份。

### D7 纯文本 / CSV 按实际编码读，读不了的明确失败

以前 UTF-16 的 txt / csv 按 UTF-8 读出来约一半是 U+0000，写库失败、文件被标成失败——是碰巧被数据库挡住的。清理之后 U+0000 变成空格，这类文件会变成「解析成功、内容是隔一个字一个空格的乱码」并进入分析，比失败更糟。所以在解码这一步处理：以 UTF-16 字节序标记（FF FE / FE FF）开头的按 UTF-16 解码；否则按 UTF-8，解出来 U+0000 超过 10% 的记为解析失败，原因是一句能看懂的话。零星的 U+0000（低于 10%）照 D1 换成空格。

- 否决：不处理，写进「已知限制」。把以前看得见的失败变成看不见的乱码，是本次改动引入的退步。
- 否决：猜测没有字节序标记的 UTF-16 / GBK 等编码并尝试解码。猜错的代价是另一种乱码；明确失败 + 提示另存为 UTF-8 更稳妥。
- 否决：阈值用「出现任何 U+0000 就失败」。真实的 UTF-8 文本里偶尔混进一个 U+0000 是能读的，不该整份失败。

失败原因的写入一并收口：页级解析与旧路径的所有写入点都先截到 500 字再清理（报错文字本身也可能带 U+0000，截断也可能劈开代理对——那样连「记下失败原因」这一步都会失败，文件停在解析中）。

### D8 清理、去空白、截断的顺序

- 旧路径：清理 → 去首尾空白 → 截到 20 万字 → 再清理。先清理再去空白，是为了整页 U+0000 换出来的空格不留在整份文字两端。
- 页级解析的 PDF：每页清理 → 判断近乎空白 → 各页拼接 → 截断 → 再清理。
- 页级解析的非 PDF：原文清理 → 去首尾空白 → 切单元 → 每个单元的文字与标签再清理（按 6000 字切块、取标题前 60 个字都会劈开代理对）→ 拼接 → 截断 → 再清理。
- 已知限制：一页里只有页眉页脚是正常文字、正文全是 U+0000 时，该页清理后字数仍够，不会被判成「需要 OCR」（判断按去掉首尾空白后的长度）。这类文件以前是整份失败，现在是该页正文为空白。

- 否决：把「近乎空白」改成按非空白字符数判断。会改变既有文件的判定，超出本次范围（Non-Goals 第 2 条）。

顺带的影响：`extractPdfPagesFromBuffer` 的另外两个调用方（报价导入、评测脚本）拿到的也是清理过的页面文字。

## 与八条硬纪律的关系

1. 零 schema：遵守——不加模型 / 字段 / 迁移；`parseError` 是既有字段。
2. 出站先审批：不涉及（没有任何对外发送）。
3. 禁止第三套队列：不涉及（不新增任何调度、队列、租约）。
4. 脱敏：遵守——解析失败原文只随分析详情接口与项目文件列表接口返回（两者都要求项目读权限）、只在这两处界面出现，不进 Muse 通道、通知与模型提示（D3、spec「解析失败原文不进模型与对外通道」）。例外说明：文件抽屉用的 `process-next` 接口在响应里也带 `parseError`，而它只查登录、不查项目权限——这是既有问题，不在本次范围，另开任务。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守——纯字符替换，没有新增模型调用。
8. 测试注册：`extracted-text.test.ts`（进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`）、`page-parse-nul-db.isolated.test.ts`（进 `scripts/test-all.sh`）同一 task 内注册，`bash scripts/check-test-registry.sh` 通过。

## 验证方式

- `npx tsx src/lib/files/__tests__/extracted-text.test.ts`：U+0000 → 空格、落单高 / 低位代理 → U+FFFD、成对代理与中文 / 制表 / 换行不变、截断劈开代理对后再清理。
- `npx tsx src/lib/tender-auto-analysis/__tests__/page-parse-nul-db.isolated.test.ts`（本机 PostgreSQL，`DATABASE_ENVIRONMENT=isolated`）：两条路径都 `done`、逐页与整份文字不含 U+0000、勾选框页的文字、整页 U+0000 → 需要 OCR；在改动前的代码上失败（`failed`，`parseError` 含 22021）——输出贴进报告。
- `npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts`：解析失败带原文、其它原因为空、快照只取六项、去掉原文的清单、面板 / 展开列表 / 文件列表的文案。
- 既有：`page-parse.test.ts`、`blob-access.test.ts`、`analyst-synthesis.test.ts` 照旧通过。
- `npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、CI 子集、`npm test`（对照既有失败清单）、`openspec validate document-parse-nul-and-reason --strict`。
- 真实应用截图（隔离库造数据），放 `docs/acceptance/fix-13/`：分析面板覆盖清单、「排除 K（原因）」展开列表、项目文件列表、重新处理之后的文件列表与面板。

## Risks / Trade-offs

- [U+0000 原本代表的字形（勾选框）在文字里看不出来] → 与原来「整份失败、什么都没有」相比是净改进；勾选框本身不是要求文字。
- [原文里有数据库报错、服务端路径，项目成员能看到] → Evan 明确要求显示原文；只对有项目读权限的人、只在网页上；不进模型与对外通道。
- [已失败的文件不会自己恢复] → 打开「项目文件」抽屉时自动重新处理失败的文件（既有行为）；报告写明上线后的操作：打开「项目文件」抽屉或点「重新处理」，然后重新发起分析。
- [法文版没实测] → 机理相同；上线后重新解析时核对状态。
- [文件抽屉一打开就自动重新处理，重新处理一开始就清掉失败原因] → 上线后要先在分析面板把两份附录 B 的原因保存下来，再打开抽屉（报告「上线后操作」第 0 步）；否则生产上的原始报错就看不到了。
- [带字节序标记的 UTF-16 文本以前失败、现在成功] → 属于修正；没有标记的 UTF-16 与二进制仍然失败，原因更清楚。
- [两个同名的失败文件在展开列表里共用一段原因] → 快照里没有文件 id；面板顶部的清单按文件逐个取，不受影响。

## Migration Plan

无数据迁移、无开关。合并部署即生效；回滚 = 回退本 PR。上线后在「12-3 Indoor Canadian Flag」打开「项目文件」抽屉触发重新处理，确认两份附录 B 不再显示「解析失败」，再重新发起分析。
